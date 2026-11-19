/** 从仓库根目录用 pnpm exec tsx 运行。Source、relay、手机前端和 Electron 各自使用隔离端口或数据根。 */
import { fork, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import type { E2EReportSummary } from "@zcode/e2e-report";
import { createLocalPairingRelay } from "./local-pairing-relay.js";

const script = fileURLToPath(import.meta.url),
  repo = fileURLToPath(new URL("../../../../../", import.meta.url));
const spec =
  "./test/e2e/conversation-session/remote/data-sync/manual-review/pending/config-package.test.ts";
async function runSource() {
  const { createServerHostServices, createTopicResourcePeers } =
    await import("@zcode/services/node");
  const { createHttpServer } = await import("@zcode/server");
  const peers = createTopicResourcePeers(),
    serverId = "t4-remote";
  const { services, workspaceIdentityMapper, migrationFailedPathCount } =
    await createServerHostServices({
      sourceServerId: serverId,
      providerProvisioningTargetEnabled: true,
      topicResourceRelayChannel: (r) => peers.getChannel(r),
      zcodeBuiltinProviderConfigFilePath: join(repo, "config/provider/zcode-builtin.json"),
    });
  const server = createHttpServer(services, 0, {
    host: "127.0.0.1",
    authRequired: true,
    authToken: "t4-loopback-fixture",
    serverId,
    workspaceIdentityMapper,
    migrationFailedPathCount,
    virtualProjects: true,
    topicResourcePeers: peers,
  });
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Source port unavailable");
  process.send?.({ url: "http://127.0.0.1:" + address.port });
}
async function runDesktop() {
  const runId = "config-package-" + Date.now();
  const artifactDir = join(repo, "packages/desktop/.e2e-artifacts", runId);
  const home = await mkdtemp(join(tmpdir(), "openzwork-t4-source-"));
  await mkdir(join(home, "workspace"));
  await mkdir(join(home, ".openzwork/commands"), { recursive: true });
  await writeFile(join(home, ".openzwork/commands/T4-local.md"), "remote marker");
  const relay = await createLocalPairingRelay();
  const mobile = await preview({
    configFile: false,
    root: join(repo, "packages/web"),
    base: "/remote/",
    build: { outDir: join(repo, "packages/desktop/out/web-remote") },
    preview: { host: "127.0.0.1", port: 0 },
  });
  const source = fork(script, ["--source"], {
    execArgv: ["--import", "tsx"],
    cwd: repo,
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ZCODE_DATA_BASE_DIR: home,
      ZCODE_DESKTOP_HOME_DIR: home,
      ZCODE_SERVER_WORKSPACE: join(home, "workspace"),
      ZCODE_CREDENTIAL_SECRET: randomBytes(32).toString("base64"),
    },
  });
  const stopped = once(source, "exit");
  let desktop: ReturnType<typeof spawn> | undefined;
  try {
    const [message] = await Promise.race([
      once(source, "message"),
      stopped.then(() => {
        throw new Error("isolated Source Server stopped before readiness");
      }),
    ]);
    const address = mobile.httpServer.address();
    if (!address || typeof address === "string") throw new Error("mobile port unavailable");
    const origin = "http://127.0.0.1:" + address.port;

    desktop = spawn(
      process.execPath,
      [
        join(repo, "scripts/mise-run.mjs"),
        "pnpm",
        "--filter",
        "@zcode/desktop",
        "exec",
        "wdio",
        "run",
        "wdio.conf.ts",
        "--spec",
        spec,
      ],
      {
        cwd: repo,
        stdio: "inherit",
        env: {
          ...process.env,
          ZCODE_E2E_RUN_ID: runId,
          ZCODE_E2E_ARTIFACT_DIR: artifactDir,
          ZCODE_E2E_HOME_DIR: join(repo, "packages/desktop", ".e2e-home-" + runId),
          ZCODE_E2E_MANUAL_REVIEW: "1",
          E2E_PROVIDER_HTTP_MODE: "replay",
          E2E_PROVIDER_REPLAY_FIXTURE_PATH: join(
            repo,
            "packages/desktop/test/e2e/fixtures/upstream/conversation-session/config-package.json",
          ),
          ZCODE_E2E_T4_SOURCE_HOME: home,
          ZCODE_E2E_T4_SOURCE_URL: message.url,
          ZCODE_E2E_T4_WEB_ORIGIN: origin,
          ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL: relay.wsUrl,
          ZCODE_WEB_REMOTE_CONTROL_URL: origin + "/remote/v4",
        },
      },
    );
    const [code] = await once(desktop, "exit");
    if (code !== 0) throw new Error(`WDIO exited with ${code ?? "a signal"} (${runId})`);
    // 启动阶段也可能返回 0。只有本轮报告记录了两条用例通过，才算完成验收。
    const summary: E2EReportSummary = JSON.parse(
      await readFile(join(artifactDir, "summary.json"), "utf8"),
    );
    const { tests } = summary;
    const expectedCases = ["CP-11", "CP-12"];
    if (
      summary.runId !== runId ||
      summary.exitCode !== 0 ||
      tests.failed !== 0 ||
      tests.passed !== expectedCases.length ||
      tests.total !== expectedCases.length ||
      !expectedCases.every((id) =>
        tests.results.some((test) => test.passed && test.title.startsWith(id + " ")),
      )
    ) {
      throw new Error(`CP-11/CP-12 acceptance incomplete: ${join(artifactDir, "summary.json")}`);
    }
  } finally {
    if (desktop?.exitCode === null) desktop.kill();
    if (source.exitCode === null) source.kill();
    await stopped;
    await relay.close();
    await mobile.close();
    await rm(home, { recursive: true, force: true });
  }
}
if (process.argv.includes("--source")) await runSource();
else await runDesktop();
