import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  stagePlatformPty,
  verifyPlatformRuntime,
} from "../zcode-distribution/platform-archive-openzwork.mjs";
import {
  closeSmokeWebSocket,
  didTuiExitSuccessfully,
  shouldIgnoreSmokeCleanupError,
  tarCreateArgs,
  tarExtractArgs,
  tarSupportsForceLocal,
} from "../zcode-distribution/assets.mjs";

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

test("CLI smoke cleanup tolerates only a locked Windows native module", () => {
  const error = Object.assign(new Error("locked"), { code: "EPERM" });
  assert.equal(shouldIgnoreSmokeCleanupError(error, "win32"), true);
  assert.equal(shouldIgnoreSmokeCleanupError(error, "darwin"), false);
  assert.equal(
    shouldIgnoreSmokeCleanupError(Object.assign(new Error("denied"), { code: "EACCES" }), "win32"),
    false,
  );
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

test("archive verifier distinguishes required TUI FFI from the removed CUA plugin", async (t) => {
  const root = await temp(t);
  for (const path of [
    "zcode",
    "zcode.cmd",
    "agent/node_modules/@mbears/opentui-core-linux-x64/libopentui.so",
    "agent/node_modules/koffi/build/koffi/linux_x64/koffi.node",
    "agent/node_modules/unsafe-pointer/prebuilds/linux-x64/unsafe-pointer.glibc.node",
    "node_modules/node-pty/prebuilds/linux-x64/pty.node",
  ])
    await write(root, path);
  assert.deepEqual(await verifyPlatformRuntime(root, "linux-x64"), []);
  await write(root, "agent/node_modules/@zcode/zcode-cua-plugin/package.json");
  await write(root, "agent/node_modules/@mbears/opentui-core-win32-x64/opentui.dll");
  await write(root, "node_modules/node-pty/build/Release/obj/foo.o");
  const errors = (await verifyPlatformRuntime(root, "linux-x64")).join("\n");
  assert.match(errors, /zcode-cua-plugin/);
  assert.match(errors, /opentui-core-win32-x64/);
  assert.match(errors, /node-pty[/\\]build/);
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
  for (const failure of [true, false]) {
    await write(
      root,
      "server/entry-http.js",
      failure
        ? "process.exit(1)"
        : "process.send({ type: 'web-listening', port: 48123 }); process.on('disconnect', () => process.exit(0));",
    );
    const child = spawn(process.execPath, [runner, "--web", "--no-open"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!failure && child.connected && stdout.includes("http://127.0.0.1:48123/"))
        child.disconnect();
    });
    const [code] = await once(child, "exit");
    assert.equal(code, failure ? 1 : 0);
    if (failure) assert.doesNotMatch(stdout, /Local:|is running/);
    else assert.match(stdout, /OpenZWork Web is running/);
  }
});
