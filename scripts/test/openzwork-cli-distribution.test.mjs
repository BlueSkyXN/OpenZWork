import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { finished } from "node:stream/promises";
import { test } from "node:test";
import {
  stagePlatformPty,
  verifyPlatformRuntime,
} from "../zcode-distribution/platform-archive-openzwork.mjs";
import {
  closeSmokeWebSocket,
  didTuiExitSuccessfully,
  shouldSkipSmokeCleanup,
  stageOfficialPlugins,
  tarCreateArgs,
  tarExtractArgs,
  tarSupportsForceLocal,
  withSmokeTimeout,
} from "../zcode-distribution/assets.mjs";
import { officialSeaPlugins } from "../../apps/zcode-cli/packages/cli/scripts/sea-official-plugin-assets.mjs";

async function temp(t) {
  const root = await mkdtemp(join(tmpdir(), "oz-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function write(root, path, text = "") {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

test("platform archives use matching Linux PTY, keep Windows runtime files and omit build objects", async (t) => {
  const root = await temp(t);
  const source = join(root, "source");
  await write(source, "package.json", "{}");
  await write(source, "LICENSE", "license");
  await write(source, "lib/index.js");
  await write(source, "build/Release/pty.node", "official-linux-module");
  await write(source, "build/Release/obj/foo.o");
  await write(source, "prebuilds/win32-x64/conpty.node", "windows-module");
  await write(source, "prebuilds/win32-x64/conpty.pdb");
  await write(source, "prebuilds/win32-x64/conpty/conpty.dll");
  for (const target of ["linux-x64", "win32-x64"]) {
    const destination = join(root, target);
    await stagePlatformPty(source, destination, target);
    assert.deepEqual(await readdir(join(destination, "prebuilds")), [target]);
    assert.ok(!(await readdir(destination)).includes("build"));
  }
  assert.equal(
    await readFile(join(root, "linux-x64/prebuilds/linux-x64/pty.node"), "utf8"),
    "official-linux-module",
  );
  const windows = join(root, "win32-x64/prebuilds/win32-x64");
  assert.deepEqual((await readdir(windows)).sort(), ["conpty", "conpty.node"]);
  await readFile(join(windows, "conpty/conpty.dll"));
});

test("CLI tar commands follow the selected Windows tar implementation", async () => {
  const tarball = "D:\\a\\OpenZWork\\zcode-1.2.3.tar.gz";
  const packageParent = "D:\\a\\OpenZWork\\.work";
  const windows = { platform: "win32" };
  const createArgs = tarCreateArgs({
    tarball,
    packageParent,
    packageDirName: "zcode",
    forceLocal: true,
    ...windows,
  });
  const extractArgs = tarExtractArgs({ archive: tarball, forceLocal: true, ...windows });

  for (const args of [createArgs, extractArgs]) {
    assert.equal(args[0], "--force-local");
    assert.ok(args.includes(tarball));
    if (args === createArgs) assert.ok(args.includes(packageParent));
  }

  assert.equal(
    tarCreateArgs({
      tarball,
      packageParent,
      packageDirName: "zcode",
      forceLocal: false,
      ...windows,
    }).includes("--force-local"),
    false,
  );
  assert.equal(
    tarExtractArgs({ archive: tarball, forceLocal: false, ...windows }).includes("--force-local"),
    false,
  );
  assert.equal(
    await tarSupportsForceLocal({
      platform: "win32",
      execVersion: async () => ({ stdout: "tar (GNU tar) 1.35\n" }),
    }),
    true,
  );
  assert.equal(
    await tarSupportsForceLocal({
      platform: "win32",
      execVersion: async () => ({ stdout: "bsdtar 3.7\n" }),
    }),
    false,
  );
});

test("CLI smoke skips cleanup only after Windows loads ConPTY", () => {
  assert.equal(shouldSkipSmokeCleanup({ platform: "win32", conptyLoaded: false }), false);
  assert.equal(shouldSkipSmokeCleanup({ platform: "win32", conptyLoaded: true }), true);
  assert.equal(shouldSkipSmokeCleanup({ platform: "linux", conptyLoaded: true }), false);
  assert.equal(shouldSkipSmokeCleanup({ platform: "darwin", conptyLoaded: true }), false);
});

test("CLI smoke accepts a ConPTY exit without a numeric exit code", () => {
  assert.equal(didTuiExitSuccessfully({ exitCode: 0 }, "win32"), true);
  assert.equal(didTuiExitSuccessfully({ exitCode: undefined }, "win32"), true);
  assert.equal(didTuiExitSuccessfully({ exitCode: 1 }, "win32"), false);
  assert.equal(didTuiExitSuccessfully({ exitCode: undefined }, "darwin"), false);
  assert.equal(didTuiExitSuccessfully(undefined, "win32"), false);
});

test("CLI smoke WebSocket close falls back to terminating a stalled client", async () => {
  const createSocket = (terminateCloses) => {
    const socket = new EventEmitter();
    socket.close = () => {
      if (terminateCloses) socket.emit("close");
    };
    socket.terminate = () => {
      socket.emit("close");
    };
    return socket;
  };

  await closeSmokeWebSocket(createSocket(true), 20);
  await closeSmokeWebSocket(createSocket(false), 20);
});

test("CLI smoke timeout reports the stalled stage", async () => {
  await assert.rejects(
    withSmokeTimeout(new Promise(() => {}), "stalled stage", 10, () => "diagnostic"),
    /stalled stage timed out:\ndiagnostic/u,
  );
  assert.equal(await withSmokeTimeout(Promise.resolve("done"), "fast stage", 10), "done");
});

test("archive verifier distinguishes required TUI FFI and keyring binding from removed plugins", async (t) => {
  const root = await temp(t);
  for (const path of [
    "zcode",
    "zcode.cmd",
    "agent/node_modules/@mbears/opentui-core-linux-x64/libopentui.so",
    "agent/node_modules/@napi-rs/keyring/index.js",
    "agent/node_modules/@napi-rs/keyring-linux-x64-gnu/keyring.linux-x64-gnu.node",
    "agent/node_modules/koffi/build/koffi/linux_x64/koffi.node",
    "agent/node_modules/unsafe-pointer/prebuilds/linux-x64/unsafe-pointer.glibc.node",
    "node_modules/node-pty/prebuilds/linux-x64/pty.node",
  ])
    await write(root, path);
  assert.deepEqual(await verifyPlatformRuntime(root, "linux-x64"), []);
  await write(root, "agent/node_modules/@zcode/zcode-cua-plugin/package.json");
  await write(root, "agent/packages/zcode-site-plugin/package.json");
  await write(root, "agent/node_modules/@napi-rs/keyring-darwin-arm64/keyring.darwin-arm64.node");
  await write(root, "agent/node_modules/@mbears/opentui-core-win32-x64/opentui.dll");
  await write(root, "node_modules/node-pty/build/Release/obj/foo.o");
  const errors = (await verifyPlatformRuntime(root, "linux-x64")).join("\n");
  assert.match(errors, /zcode-cua-plugin/);
  assert.match(errors, /zcode-site-plugin/);
  assert.match(errors, /keyring-darwin-arm64/);
  assert.match(errors, /opentui-core-win32-x64/);
  assert.match(errors, /node-pty[/\\]build/);
});

test("stageOfficialPlugins stages all retained official plugins and node-repl-host without stripped plugins", async (t) => {
  const root = await temp(t);
  const cliRoot = join(root, "cli");
  const packageRoot = join(root, "pkg");
  for (const plugin of officialSeaPlugins) {
    const pluginRoot = join(cliRoot, plugin.rootPath);
    await write(pluginRoot, ".zcode-plugin/plugin.json", JSON.stringify({ name: plugin.name }));
    await write(pluginRoot, "package.json", JSON.stringify({ name: plugin.packageName }));
    await write(pluginRoot, "node_modules/ignored/index.js", "ignored");
    const required = [
      ...(plugin.requiresRuntime !== false
        ? (plugin.requiredRuntimePaths ?? ["dist/mcp/server.js"])
        : []),
      ...(plugin.requiredSeedPaths ?? []),
    ];
    for (const relPath of required) {
      await write(pluginRoot, relPath, "asset");
    }
  }
  await stageOfficialPlugins(packageRoot, cliRoot);
  const stagedPackages = (await readdir(join(packageRoot, "agent/packages"))).sort();
  assert.equal(stagedPackages.length, 14);
  assert.ok(stagedPackages.includes("browser-use-plugin"));
  assert.ok(stagedPackages.includes("node-repl-host"));
  assert.ok(stagedPackages.includes("documents-plugin"));
  assert.ok(stagedPackages.includes("design-plugin"));
  assert.ok(!stagedPackages.includes("zcode-cua-plugin"));
  assert.ok(!stagedPackages.includes("zcode-site-plugin"));
  assert.ok(!stagedPackages.includes("image-search-plugin"));
  assert.equal(
    (await readdir(join(packageRoot, "agent/packages/browser-use-plugin"))).includes(
      "node_modules",
    ),
    false,
  );
});

test("Web only advertises the port confirmed by its own child", { timeout: 15000 }, async (t) => {
  // OW-P045：子进程实际监听后再宣布成功，启动失败时不能输出 URL。
  const root = await temp(t);
  await write(
    root,
    "package.json",
    JSON.stringify({ type: "module", productName: "OpenZWork", version: "1.2.3" }),
  );
  await write(root, "agent/zcode.cjs");
  await write(root, "web/index.html");
  const runner = join(root, "bin/zcode.mjs");
  await mkdir(dirname(runner));
  await cp(new URL("../zcode-distribution/runner.mjs", import.meta.url), runner);
  for (const { failure, args, lanOptOut, hasToken } of [
    { failure: true, args: [], lanOptOut: false, hasToken: false },
    { failure: false, args: [], lanOptOut: false, hasToken: false },
    { failure: false, args: ["--host", "::1"], lanOptOut: false, hasToken: false },
    {
      failure: false,
      args: ["--host", "2001:db8::2", "--token", "fixture"],
      lanOptOut: false,
      hasToken: true,
    },
    { failure: false, args: ["--host", "::"], lanOptOut: false, hasToken: true },
    { failure: false, args: ["--host", "0.0.0.0"], lanOptOut: false, hasToken: true },
    { failure: false, args: ["--host", "0.0.0.0", "--no-token"], lanOptOut: true, hasToken: false },
  ]) {
    await write(
      root,
      "server/entry-http.js",
      failure
        ? "process.exit(1)"
        : [
            "import assert from 'node:assert/strict';",
            "assert.equal(process.argv.includes('--no-token'), " + lanOptOut + ");",
            "assert.equal(Boolean(process.env.ZCODE_SERVER_AUTH_TOKEN), " + hasToken + ");",
            "process.send({ type: 'web-listening', port: 48123 });",
            "process.on('disconnect', () => process.stdout.write('fixture shutdown complete\\n', () => process.exit(0)));",
          ].join("\n"),
    );
    const child = spawn(process.execPath, [runner, "--web", "--no-open", ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!failure && child.connected && stdout.includes("Local:")) child.disconnect();
    });
    const [code] = await once(child, "exit");
    await finished(child.stdout);
    assert.equal(code, failure ? 1 : 0);
    if (failure) assert.doesNotMatch(stdout, /Local:|is running/);
    else {
      assert.match(stdout, /OpenZWork Web is running/);
      assert.match(stdout, /fixture shutdown complete/);
      const url = new URL(stdout.match(/Local:\s+(\S+)/)[1]);
      const host = args[1];
      assert.equal(
        url.hostname,
        host === "::1" || host === "2001:db8::2" ? `[${host}]` : "127.0.0.1",
      );
      assert.equal(url.port, "48123");
      assert.equal(url.searchParams.has("token"), hasToken);
    }
  }
});
