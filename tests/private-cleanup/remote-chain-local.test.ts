// WP-03 远端链路与发行安装的本地 UAT。
//
// 与 identity-paths.test.ts 的分工：那边验证路径解析（命令字符串、wrapper 兜底、
// workflows 存取），这边把**真实产物**拉起来——真实 esbuild 出的 zcode-server.cjs、
// 真实 buildRemoteServerCommand 启动命令、真实 connectRemote 握手、真实
// LocalUploadAssetInstaller.installFile 上传链、真实 installScriptSource 安装脚本。
// 传输层用本地 /bin/sh 后端替换 SSH/WSL/Docker（本机无 sshd/docker），其余全部走生产代码。
//
// 仍不覆盖：真实 SSH/WSL/Docker 传输、随包 agent 运行时部署（需重型 CLI 构建产物）、
// 发行包内的真实 CLI 负载（安装 UAT 用 stub 负载验证脚本机制）。
//
// 环境坑（2026-09-27 实测）：在官方 ZCode App 内嵌终端里，宿主导出的
// ZCODE_ENV / ZCODE_BUILTIN_PROVIDER_CONFIG_FILE / ZCODE_DATA_BASE_DIR 会渗入构建与
// 测试进程——build:remote 会因官方配置不满足本仓 schema 而失败（净化生效的证据），
// server 会把数据根解析到官方缓存目录。因此本测试给所有子进程构造**最小净化 env**
// （仅 PATH/TMPDIR/HOME），不继承 process.env 的任何 ZCODE_* 变量。
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildRemoteServerCommand,
  connectRemote,
} from "../../packages/server/src/remote/connect.ts";
import { REMOTE_BASE } from "../../packages/server/src/remote/deployShared.ts";
import { LocalUploadAssetInstaller } from "../../packages/server/src/remote/remoteAssetInstaller.ts";
import { resolvePosixHomePath } from "../../packages/server/src/remote/posixShell.ts";
import type { IRemoteBackend, StdioStream } from "../../packages/server/src/remote/backend.ts";
import { installScriptSource } from "../../scripts/zcode-distribution/installer.mjs";
import { assertExecutable, requireRemoteBundle } from "./remote-uat-preflight.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const serverBundlePath = join(repositoryRoot, "packages/server/dist/remote/zcode-server.cjs");
const zcodeVersion = (
  JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as { version: string }
).version;

if (process.platform !== "win32") await requireRemoteBundle(serverBundlePath);

test("remote UAT preflight rejects a missing bundle with a nonzero exit", () => {
  const fixture = mkdtempSync(join(tmpdir(), "openzwork-preflight-"));
  try {
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            fileURLToPath(new URL("./remote-uat-preflight.mjs", import.meta.url)),
            join(fixture, "missing.cjs"),
          ],
          { env: { ...process.env, CI: "true" }, encoding: "utf8", stdio: "pipe" },
        ),
      (error: unknown) => {
        const failure = error as { status: number; stderr: string };
        assert.notEqual(failure.status, 0);
        assert.match(String(failure.stderr), /Missing remote server bundle.*build:remote/);
        return true;
      },
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test(
  "remote UAT permission check rejects a file without executable bits",
  {
    skip: process.platform === "win32",
  },
  async () => {
    const fixture = mkdtempSync(join(tmpdir(), "openzwork-permissions-"));
    try {
      const file = join(fixture, "file");
      writeFileSync(file, "fixture");
      chmodSync(file, 0o644);
      await assert.rejects(assertExecutable(file), /chmod \+x/);
      chmodSync(file, 0o755);
      await assertExecutable(file);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);

/** 最小净化 env：切断宿主（官方 App 终端）注入的一切 ZCODE_* 变量与数据根覆盖。 */
function sanitizedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    HOME: home,
  };
}

/**
 * 本地远端后端：把 IRemoteBackend 的传输原语落到本机 /bin/sh 与文件系统。
 * `~/` 远端路径按 resolvePosixHomePath 落到注入的临时 HOME——与真实远端 shell 的
 * $HOME 展开语义一致（quotePosixPathArg 生成的命令在两边等价）。
 */
class LocalShBackend implements IRemoteBackend {
  private readonly children = new Set<{ kill(): void }>();
  private closed = false;

  constructor(private readonly home: string) {}

  private toLocalPath(remotePath: string): string {
    return resolvePosixHomePath(remotePath, this.home);
  }

  async detect() {
    return { platform: process.platform, arch: process.arch };
  }

  async exec(command: string): Promise<StdioStream> {
    const child = execFileSyncSh(command, this.home);
    this.children.add(child);
    const listeners = new Set<(code: number) => void>();
    child.on("close", (code) => {
      this.children.delete(child);
      for (const listener of listeners) listener(code ?? -1);
    });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      onClose: (listener) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    };
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    const target = this.toLocalPath(remotePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(localPath, target);
  }

  async exists(remotePath: string): Promise<boolean> {
    return existsSync(this.toLocalPath(remotePath));
  }

  async readFile(remotePath: string): Promise<string> {
    return execFileSync("cat", [this.toLocalPath(remotePath)], { encoding: "utf8" });
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const child of this.children) child.kill();
    this.children.clear();
  }
}

/** 后端 exec 的底层实现：/bin/sh -c，净化 env，cwd 落在临时 HOME。 */
function execFileSyncSh(command: string, home: string) {
  return spawn("/bin/sh", ["-c", command], { env: sanitizedEnv(home), cwd: home, stdio: "pipe" });
}

function waitForDirectory(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (existsSync(path)) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function execCapture(
  backend: LocalShBackend,
  command: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stream = await backend.exec(command);
  let stdout = "";
  let stderr = "";
  stream.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  stream.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const code = await new Promise<number>((resolve) => stream.onClose(resolve));
  return { code, stdout, stderr };
}

function layoutDeployedServer(home: string): string {
  const remoteRoot = resolvePosixHomePath(REMOTE_BASE, home);
  mkdirSync(remoteRoot, { recursive: true });
  copyFileSync(serverBundlePath, join(remoteRoot, "zcode-server.cjs"));
  // 真实部署上传的是平台 node 二进制；本地 UAT 以当前 node 顶位（符号链接保持可执行）。
  symlinkSync(process.execPath, join(remoteRoot, "node"));
  return remoteRoot;
}

test(
  "remote chain UAT: real bundle boots from the deployed .openzwork root, handshakes, and never touches .zcode",
  {
    skip: process.platform === "win32",
  },
  async () => {
    const home = mkdtempSync(join(tmpdir(), "openzwork-remote-uat-"));
    try {
      layoutDeployedServer(home);
      const backend = new LocalShBackend(home);

      // 部署版本检查用的 --version 命令：真实启动命令形态（env 注入 + REMOTE_BASE 展开）。
      const versionRun = await execCapture(
        backend,
        `${buildRemoteServerCommand(undefined, undefined)} --version`,
      );
      assert.equal(versionRun.code, 0, `stderr: ${versionRun.stderr}`);
      assert.equal(versionRun.stdout.trim(), zcodeVersion);

      // 真实 connectRemote：detect → exec 启动命令 → zcode-hello/ack 握手 → RPC 包装。
      const connection = await connectRemote(backend, {
        skipDeploy: true,
        handshakeTimeout: 20_000,
      });
      try {
        assert.ok(connection.services, "service accessor must come back after handshake");
        // server 侧 services 会把配置物化到数据根的 v2；等待它出现证明数据根落在 .openzwork。
        assert.equal(
          await waitForDirectory(join(home, ".openzwork", "v2"), 10_000),
          true,
          "server must materialize config under .openzwork",
        );
      } finally {
        await connection.disposeAndWait({ timeoutMs: 10_000 });
      }
      backend.dispose();

      // 核心隔离断言：真实 server 完整启动、握手、物化配置之后，旧官方根不存在。
      assert.equal(
        existsSync(join(home, ".zcode")),
        false,
        "booted server must never create the official root",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);

test(
  "remote chain UAT: real installFile lands the server bundle under .openzwork with executable bit and no staging residue",
  {
    skip: process.platform === "win32",
  },
  async () => {
    const home = mkdtempSync(join(tmpdir(), "openzwork-deploy-uat-"));
    const releaseDir = mkdtempSync(join(tmpdir(), "openzwork-release-uat-"));
    try {
      mkdirSync(join(releaseDir, "server"), { recursive: true });
      copyFileSync(serverBundlePath, join(releaseDir, "server", "zcode-server.cjs"));

      const backend = new LocalShBackend(home);
      const installer = new LocalUploadAssetInstaller(
        backend,
        { releaseDir, platformArch: `${process.platform}-${process.arch}` },
        { log: () => undefined, logWarn: (message) => console.error(String(message)) },
      );
      // deploy.ts 对 server-bundle 的真实调用形态：REMOTE_BASE 落点 + executable 替换链。
      await installer.installFile({
        componentId: "server-bundle",
        sourceRelativePath: "server/zcode-server.cjs",
        remotePath: `${REMOTE_BASE}/zcode-server.cjs`,
        executable: true,
      });

      const deployed = join(home, ".openzwork", "server", "zcode-server.cjs");
      assert.equal(existsSync(deployed), true, "bundle must land under .openzwork/server");
      await assertExecutable(deployed);
      const residue = readdirSync(join(home, ".openzwork", "server")).filter((name) =>
        name.includes(".new-"),
      );
      assert.deepEqual(residue, [], "staging files must be moved, not left behind");
      assert.equal(existsSync(join(home, ".zcode")), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(releaseDir, { recursive: true, force: true });
    }
  },
);

test(
  "installer UAT: real install.sh defaults to .openzwork/runtime, wires the bin command, and never touches .zcode",
  {
    skip: process.platform === "win32",
  },
  () => {
    const version = "0.0.0-uat";
    const home = mkdtempSync(join(tmpdir(), "openzwork-install-uat-"));
    const distRoot = mkdtempSync(join(tmpdir(), "openzwork-dist-uat-"));
    const stageDir = mkdtempSync(join(tmpdir(), "openzwork-stage-uat-"));
    try {
      // 最小发行目录：latest.json + releases/<version>/tar.gz，负载为 stub CLI（机制级 UAT，
      // 不含真实 CLI 构建——见文件头注的覆盖声明）。
      mkdirSync(join(stageDir, "zcode", "bin"), { recursive: true });
      writeFileSync(
        join(stageDir, "zcode", "bin", "zcode.mjs"),
        'console.log(`uat-cli ${process.argv.slice(2).join(" ")}`);\n',
      );
      mkdirSync(join(distRoot, "releases", version), { recursive: true });
      const tarball = `zcode-${version}.tar.gz`;
      execFileSync("tar", [
        "-czf",
        join(distRoot, "releases", version, tarball),
        "-C",
        stageDir,
        "zcode",
      ]);
      writeFileSync(join(distRoot, "latest.json"), JSON.stringify({ version, tarball }));

      const installScript = installScriptSource("https://example.invalid/zcode-dist");
      const installScriptPath = join(distRoot, "install.sh");
      writeFileSync(installScriptPath, installScript);
      chmodSync(installScriptPath, 0o755);

      const output = execFileSync("/bin/sh", [installScriptPath], {
        encoding: "utf8",
        env: { ...sanitizedEnv(home), ZCODE_DIST_BASE_URL: `file://${distRoot}` },
      });
      assert.match(output, new RegExp(`ZCode ${version} installed`));

      const releaseDir = join(home, ".openzwork", "runtime", "releases", version);
      assert.equal(
        existsSync(join(releaseDir, "bin", "zcode.mjs")),
        true,
        "runtime must install under .openzwork/runtime",
      );
      assert.equal(
        execFileSync("readlink", [join(home, ".openzwork", "runtime", "current")], {
          encoding: "utf8",
        }).trim(),
        releaseDir,
        "current symlink must point at the release",
      );

      const binCommand = join(home, ".local", "bin", "zcode");
      assert.equal(existsSync(binCommand), true, "bin command must be created");
      const runOutput = execFileSync("/bin/sh", [binCommand, "--version"], {
        encoding: "utf8",
        env: sanitizedEnv(home),
      });
      assert.equal(runOutput.trim(), "uat-cli --version");

      assert.equal(existsSync(join(home, ".zcode")), false, "install must stay inside .openzwork");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(distRoot, { recursive: true, force: true });
      rmSync(stageDir, { recursive: true, force: true });
    }
  },
);
