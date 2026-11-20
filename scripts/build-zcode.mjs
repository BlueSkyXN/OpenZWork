#!/usr/bin/env node
import { loadEndpointEnv } from "./load-endpoint-env.mjs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  copyRuntimeNodeModules,
  patchNodePtyPrebuilds,
  stageTuiRuntime,
  stageBundledSkills,
} from "./zcode-distribution/assets.mjs";
import { hostTarget } from "../apps/zcode-cli/packages/cli/scripts/sea-targets.mjs";
import { OPENZWORK_APP_NAME } from "../packages/shared/src/productIdentity.ts";
import { runCommand } from "./spawn-command.mjs";
import { installScriptSource } from "./zcode-distribution/installer.mjs";

const root = resolve(import.meta.dirname, "..");
const defaultOutDir = resolve(root, "dist", "zcode");
const defaultBaseUrl = (await loadEndpointEnv()).ZCODE_DIST_BASE_URL?.trim() || "";
const packageDirName = "zcode";
const usage = `Usage:
  pnpm build:zcode
  node scripts/build-zcode.mjs --skip-build
  node scripts/build-zcode.mjs --version 3.3.3-dev.1
  node scripts/build-zcode.mjs --out-dir dist/zcode
  node scripts/build-zcode.mjs --base-url http://host/zcode/deps/zcode/

Options:
  --skip-build        Reuse existing web/server/agent build outputs.
  --version <text>    Release version. Defaults to root package.json version.
  --out-dir <path>    Output directory. Defaults to dist/zcode.
  --base-url <url>    Default install.sh download base URL.
  --archive-only     Write the current platform runtime archive and checksum to dist/zcode-archive without an install script.
  --help, -h          Show this help.
`;

function readArgValue(argv, arg, index) {
  if (arg.includes("=")) {
    return {
      nextIndex: index,
      value: arg.slice(arg.indexOf("=") + 1),
    };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${arg}`);
  }
  return {
    nextIndex: index + 1,
    value,
  };
}

function parseArgs(argv) {
  const options = {
    archiveOnly: false,
    baseUrl: defaultBaseUrl,
    help: false,
    outDir: undefined,
    skipBuild: false,
    version: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }
    // OpenZWork(OZ-F011): GitHub Release 直接分发运行包，无需为安装脚本配置下载根。
    if (arg === "--archive-only") {
      options.archiveOnly = true;
      continue;
    }
    if (arg === "--version" || arg.startsWith("--version=")) {
      const { nextIndex, value } = readArgValue(argv, arg, index);
      options.version = value;
      index = nextIndex;
      continue;
    }
    if (arg === "--out-dir" || arg.startsWith("--out-dir=")) {
      const { nextIndex, value } = readArgValue(argv, arg, index);
      options.outDir = resolve(root, value);
      index = nextIndex;
      continue;
    }
    if (arg === "--base-url" || arg.startsWith("--base-url=")) {
      const { nextIndex, value } = readArgValue(argv, arg, index);
      options.baseUrl = value.endsWith("/") ? value : `${value}/`;
      index = nextIndex;
      continue;
    }
    throw new Error(`Unknown option "${arg}". Run with --help for usage.`);
  }

  return options;
}

function commandText(command, args) {
  return [command, ...args].join(" ");
}

function run(command, args, options = {}) {
  console.log(`[zcode] ${commandText(command, args)}`);
  if (command === "pnpm") return runCommand(command, args, { cwd: root, ...options });
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw new Error(`${commandText(command, args)} failed: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(`${commandText(command, args)} failed`);
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function sha256File(file) {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function assertFile(file, label) {
  const fileStat = await stat(file).catch(() => null);
  if (!fileStat?.isFile()) {
    throw new Error(`Missing ${label}: ${file}`);
  }
}

async function assertDirectory(directory, label) {
  const directoryStat = await stat(directory).catch(() => null);
  if (!directoryStat?.isDirectory()) {
    throw new Error(`Missing ${label}: ${directory}`);
  }
}

async function buildOutputs(skipBuild) {
  if (skipBuild) {
    console.log("[zcode] skipping build; reusing existing outputs");
    return;
  }

  run("pnpm", ["--filter", "@zcode/cli...", "build"]);
  await rm(resolve(root, "packages", "server", "dist"), {
    force: true,
    recursive: true,
  });
  run("pnpm", ["--filter", "@zcode/server", "build"]);
  run("pnpm", ["--filter", "@zcode/web", "build"]);
}

async function stageZCodePackage({ packageRoot, version, platformArchive }) {
  const webDist = resolve(root, "packages", "web", "dist");
  const serverDist = resolve(root, "packages", "server", "dist");
  const agentBundle = resolve(root, "apps", "zcode-cli", "packages", "cli", "dist", "zcode.cjs");
  const agentProvider = resolve(root, "apps/zcode-cli/packages/cli/dist/provider");

  await assertDirectory(webDist, "web dist");
  await assertDirectory(serverDist, "server dist");
  await assertFile(resolve(serverDist, "entry-http.js"), "server HTTP entry");
  await assertFile(agentBundle, "agent app-server bundle");
  await assertFile(resolve(agentProvider, "zcode-builtin.json"), "Agent provider config");

  await rm(packageRoot, {
    force: true,
    recursive: true,
  });
  await mkdir(packageRoot, {
    recursive: true,
  });

  await cp(webDist, resolve(packageRoot, "web"), {
    recursive: true,
  });
  await cp(serverDist, resolve(packageRoot, "server"), {
    recursive: true,
  });
  await mkdir(resolve(packageRoot, "agent"), {
    recursive: true,
  });
  await cp(agentBundle, resolve(packageRoot, "agent", "zcode.cjs"));
  // TUI 入口通过真正的 CLI 路径定位伴随配置；只复制 JS 会在仓库外启动失败。
  await cp(agentProvider, resolve(packageRoot, "agent/provider"), { recursive: true });
  await cp(
    resolve(root, "apps/zcode-cli/packages/cli/dist/THIRD-PARTY-NOTICES.md"),
    resolve(packageRoot, "agent/THIRD-PARTY-NOTICES.md"),
  );
  await chmod(resolve(packageRoot, "agent", "zcode.cjs"), 0o755);

  await stageBundledSkills(packageRoot);
  // OpenZWork(OZ-F011)：Release 按主机原生 ABI 打包，自托管下载目录沿用原布局。
  const runtimeTarget = platformArchive ? process.platform + "-" + process.arch : undefined;
  await stageTuiRuntime(packageRoot, platformArchive ? [hostTarget()] : undefined);
  await copyRuntimeNodeModules(packageRoot, runtimeTarget);
  if (!platformArchive) await patchNodePtyPrebuilds(packageRoot);

  await mkdir(resolve(packageRoot, "bin"), {
    recursive: true,
  });
  const runner = resolve(packageRoot, "bin", "zcode.mjs");
  await cp(resolve(root, "scripts/zcode-distribution/runner.mjs"), runner);
  await chmod(runner, 0o755);
  await writeFile(resolve(packageRoot, "zcode"), '#!/usr/bin/env node\nimport "./bin/zcode.mjs";\n', { mode: 0o755 });
  await writeFile(resolve(packageRoot, "zcode.cmd"), '@echo off\r\nnode "%~dp0bin\\zcode.mjs" %*\r\nexit /b %errorlevel%\r\n');

  await writeFile(
    resolve(packageRoot, "package.json"),
    JSON.stringify(
      {
        name: "zcode-runtime",
        productName: OPENZWORK_APP_NAME,
        runtimeTarget,
        private: true,
        type: "module",
        version,
      },
      null,
      2,
    ),
  );
}

async function createTarball({ packageParent, releaseDir, tarballName }) {
  await mkdir(releaseDir, {
    recursive: true,
  });
  const tarball = resolve(releaseDir, tarballName);
  await rm(tarball, {
    force: true,
  });
  run("tar", ["--exclude", "._*", "--exclude", ".DS_Store", "-czf", tarball, "-C", packageParent, packageDirName], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  return tarball;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.help && !options.archiveOnly && !options.baseUrl)
    throw new Error("Configure ZCODE_DIST_BASE_URL in .env or pass --base-url");
  if (options.help) {
    console.log(usage);
    return;
  }

  const rootPackageJson = await readJson(resolve(root, "package.json"));
  const version = options.version ?? rootPackageJson.version;
  if (!version || typeof version !== "string") {
    throw new Error("Unable to resolve ZCode version.");
  }

  await buildOutputs(options.skipBuild);

  const outDir =
    options.outDir ?? (options.archiveOnly ? resolve(root, "dist/zcode-archive") : defaultOutDir);
  const workDir = resolve(outDir, ".work");
  const packageParent = workDir;
  const packageRoot = resolve(packageParent, packageDirName);
  const releaseDir = resolve(outDir, "releases", version);
  const tarballName = `${packageDirName}-${version}.tar.gz`;

  await rm(workDir, {
    force: true,
    recursive: true,
  });
  await stageZCodePackage({
    packageRoot,
    version,
    platformArchive: options.archiveOnly,
  });
  const tarball = await createTarball({
    packageParent,
    releaseDir,
    tarballName,
  });
  const sha256 = await sha256File(tarball);
  await writeFile(resolve(releaseDir, "sha256.txt"), `${sha256}  ${tarballName}\n`);

  if (!options.archiveOnly) {
    await writeFile(
      resolve(outDir, "latest.json"),
      JSON.stringify(
        {
          baseUrl: options.baseUrl,
          createdAt: new Date().toISOString(),
          name: "zcode",
          sha256,
          tarball: tarballName,
          version,
        },
        null,
        2,
      ),
    );
    const installScript = resolve(outDir, "install.sh");
    await writeFile(installScript, installScriptSource(options.baseUrl));
    await chmod(installScript, 0o755);
  }
  await rm(workDir, {
    force: true,
    recursive: true,
  });

  console.log(`[zcode] release directory: ${outDir}`);
  console.log(`[zcode] tarball: ${tarball}`);
  console.log(`[zcode] sha256: ${sha256}`);
}

await main();
