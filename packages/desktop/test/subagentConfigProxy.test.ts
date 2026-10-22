import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
const children = new Set<ChildProcess>();
afterEach(async () => {
  await Promise.all(
    [...children].map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        const deadline = setTimeout(() => child.kill("SIGKILL"), 2_000);
        child.once("close", () => {
          clearTimeout(deadline);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }),
  );
  children.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each([false, true])(
  "preloads the stdio proxy without replacing CLI startup (failure: %s)",
  async (failed) => {
    const root = await mkdtemp(join(tmpdir(), "subagent-proxy-"));
    roots.push(root);
    await writeFile(
      join(root, "subagent-config-control.json"),
      JSON.stringify({ failedSessionIds: failed ? ["parent"] : [] }),
    );
    const entry = join(root, "cli.mjs");
    await writeFile(
      entry,
      `
    import { createInterface } from "node:readline";
    console.log(JSON.stringify({ method: "storage/startup", params: { ready: true } }));
    console.log(JSON.stringify({ id: 1, method: "subagents/readRuntimeConfig", params: { sessionId: "parent" } }));
    createInterface({ input: process.stdin }).once("line", line => {
      console.log(JSON.stringify({ method: "done", response: JSON.parse(line), args: process.argv.slice(2), proxyChild: process.env.ZCODE_E2E_SUBAGENT_PROXY_CHILD, preload: process.env.NODE_OPTIONS }));
      process.exit(0);
    });
  `,
    );
    // Node 的 --import 在 Windows 需要 file URL，盘符路径会被误判为协议。
    const proxy = new URL("./e2e/helpers/subagent-config-proxy.mjs", import.meta.url).href;
    const child = spawn(process.execPath, [entry, "app-server", "--stdio"], {
      // 超时与测试失败都必须回收进程，避免代理缺陷把 CI 或开发机持续压满。
      timeout: 10_000,
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${JSON.stringify(proxy)}`,
        ZCODE_E2E_ARTIFACT_DIR: root,
        ZCODE_E2E_SUBAGENT_PROXY_CHILD: "",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(child);
    const frames: Array<Record<string, any>> = [];
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      const frame = JSON.parse(line);
      frames.push(frame);
      if (frame.method === "subagents/readRuntimeConfig")
        child.stdin.write(
          JSON.stringify({ id: frame.id, result: { kind: "built-in-fallback" } }) + "\n",
        );
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    expect(code, stderr).toBe(0);
    expect(frames.filter((frame) => frame.method === "storage/startup")).toHaveLength(1);
    expect(frames.at(-1)).toMatchObject({
      method: "done",
      args: ["app-server", "--stdio"],
      proxyChild: "1",
      preload: "",
      response: failed
        ? { error: { message: "E2E_CONFIG_UNAVAILABLE" } }
        : { result: { kind: "built-in-fallback" } },
    });
    const logs = (await readdir(root)).filter((path) => path.startsWith("subagent-config-rpc-"));
    expect(logs).toHaveLength(1);
    const records = (await readFile(join(root, logs[0]!), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({ kind: "read", sessionId: "parent", failed });
  },
);

it("does not spawn another proxy when a marked child still has the preload", async () => {
  const root = await mkdtemp(join(tmpdir(), "subagent-proxy-child-"));
  roots.push(root);
  const entry = join(root, "cli.mjs");
  await writeFile(entry, "console.log(JSON.stringify({ parentPid: process.ppid }));");
  const proxy = new URL("./e2e/helpers/subagent-config-proxy.mjs", import.meta.url).href;
  const child = spawn(process.execPath, [entry, "app-server", "--stdio"], {
    timeout: 10_000,
    env: {
      ...process.env,
      NODE_OPTIONS: `--import=${JSON.stringify(proxy)}`,
      ZCODE_E2E_ARTIFACT_DIR: root,
      ZCODE_E2E_SUBAGENT_PROXY_CHILD: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  expect(code, stderr).toBe(0);
  expect(JSON.parse(stdout)).toEqual({ parentPid: process.pid });
  expect((await readdir(root)).filter((path) => path.startsWith("subagent-config-rpc-"))).toEqual(
    [],
  );
});
