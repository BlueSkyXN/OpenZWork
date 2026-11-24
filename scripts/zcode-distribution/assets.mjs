import { execFile } from "node:child_process";
import { once } from "node:events";
import { chmod, cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import {
  collectSeaTuiAssets,
  seaTuiAssetPrefix,
} from "../../apps/zcode-cli/packages/cli/scripts/sea-tui-assets.mjs";
import { supportedTargets } from "../../apps/zcode-cli/packages/cli/scripts/sea-targets.mjs";
import {
  bundledSkillPackRequiredPaths,
  bundledSkillPackSkillsDirectory,
} from "../../apps/zcode-cli/packages/cli/scripts/sea-bundled-skill-assets.mjs";
import { officialSeaPlugins } from "../../apps/zcode-cli/packages/cli/scripts/sea-official-plugin-assets.mjs";
import { stageCredentialKeyring } from "../stage-credential-keyring.mjs";
import { stagePlatformPty } from "./platform-archive-openzwork.mjs";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../..");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const execTarVersion = promisify(execFile);

function forceLocalTarArgs(forceLocal, platform) {
  return forceLocal ?? platform === "win32" ? ["--force-local"] : [];
}

export async function tarSupportsForceLocal({
  execVersion = execTarVersion,
  platform = process.platform,
} = {}) {
  if (platform !== "win32") return false;
  const { stdout } = await execVersion("tar", ["--version"]);
  return stdout.includes("GNU tar");
}

export function tarCreateArgs({
  tarball,
  packageParent,
  packageDirName,
  forceLocal,
  platform = process.platform,
}) {
  // Windows GNU tar 会把 "D:\..." 的盘符当作远程主机，必须显式按本地文件处理。
  return [
    ...forceLocalTarArgs(forceLocal, platform),
    "--exclude",
    "._*",
    "--exclude",
    ".DS_Store",
    "-czf",
    tarball,
    "-C",
    packageParent,
    packageDirName,
  ];
}

export function tarExtractArgs({ archive, forceLocal, platform = process.platform }) {
  return [...forceLocalTarArgs(forceLocal, platform), "-xzf", archive];
}

// OpenZWork(OZ-F011): Windows 递归删除 ConPTY 锁定目录时可能无限等待。
export function shouldSkipSmokeCleanup({
  platform = process.platform,
  conptyLoaded = false,
} = {}) {
  return conptyLoaded && platform === "win32";
}

export function didTuiExitSuccessfully(event, platform = process.platform) {
  return event != null && (event.exitCode === 0 ||
    (platform === "win32" && event.exitCode === undefined));
}

export async function closeSmokeWebSocket(socket, timeoutMs = 2000) {
  const closed = once(socket, "close");
  socket.close();
  await Promise.race([
    closed,
    delay(timeoutMs).then(async () => {
      socket.terminate();
      await closed;
    }),
  ]);
}

export async function withSmokeTimeout(promise, label, timeoutMs, diagnostic = () => "") {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out:\n${diagnostic()}`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

const runtimePackageNames = [
  "@hono/node-server",
  "@hono/node-ws",
  "ssh2",
  "node-pty",
  "undici",
  "axios",
  "form-data",
  "combined-stream",
  "follow-redirects",
  "proxy-from-env",
  "ws",
  "hono",
  "yaml",
  "yazl",
  // HTTP bundle 将 yauzl 外置；发行包必须携带它，否则脱离仓库就无法启动后端。
  "yauzl",
  "node-forge",
];

export async function stageBundledSkills(
  packageRoot,
  sourceRoot = resolve(root, "apps/zcode-cli/packages/bundled-skills"),
) {
  const targetRoot = resolve(packageRoot, "agent/packages/bundled-skills");
  async function validate(packRoot) {
    for (const path of bundledSkillPackRequiredPaths) {
      const asset = resolve(packRoot, path);
      const info = await stat(asset).catch(() => undefined);
      if (!info?.isFile()) throw new Error(`Missing bundled skill required file: ${asset}`);
      await readFile(asset);
    }
  }
  // 普通 Node 包没有 SEA 内嵌资源；必须携带完整技能及相对引用，源与目标都验证。
  await validate(sourceRoot);
  await mkdir(targetRoot, { recursive: true });
  await cp(
    resolve(sourceRoot, bundledSkillPackSkillsDirectory),
    resolve(targetRoot, bundledSkillPackSkillsDirectory),
    { recursive: true },
  );
  await validate(targetRoot);
}

const officialPluginTopLevelAllowlist = [
  ".mcp.json",
  ".zcode-plugin",
  "README.md",
  "agents",
  "commands",
  "dist",
  "docs",
  "hooks",
  "output-styles",
  "package.json",
  "scripts",
  "skills",
  "templates",
];

const excludedOfficialPluginEntryNames = new Set([
  ".DS_Store",
  ".turbo",
  ".venv",
  "__pycache__",
  "coverage",
  "node_modules",
]);

function shouldCopyOfficialPluginAsset(pluginDirectory, source) {
  const rel = relative(pluginDirectory, source);
  if (!rel) return true;
  const parts = rel.split(sep);
  return (
    parts.every((part) => !excludedOfficialPluginEntryNames.has(part)) &&
    !parts.at(-1).endsWith(".pyc")
  );
}

// OpenZWork(OZ-F011)：独立 CLI 归档不是 SEA，必须与桌面包一致携带 13 个保留官方插件与 node-repl-host。
export async function stageOfficialPlugins(
  packageRoot,
  cliRoot = resolve(root, "apps/zcode-cli"),
) {
  for (const plugin of officialSeaPlugins) {
    const sourceRoot = resolve(cliRoot, plugin.rootPath);
    const manifestFile = resolve(sourceRoot, ".zcode-plugin/plugin.json");
    if (!(await stat(manifestFile).catch(() => undefined))?.isFile()) {
      throw new Error(`Missing official plugin manifest: ${manifestFile}`);
    }
    const requiredFiles = [
      ...(plugin.requiresRuntime !== false
        ? (plugin.requiredRuntimePaths ?? ["dist/mcp/server.js"])
        : []),
      ...(plugin.requiredSeedPaths ?? []),
    ];
    for (const relPath of requiredFiles) {
      const sourceAsset = resolve(sourceRoot, ...relPath.split("/"));
      if (!(await stat(sourceAsset).catch(() => undefined))?.isFile()) {
        throw new Error(`Missing official plugin asset for ${plugin.name}: ${sourceAsset}`);
      }
    }
    const targetRoot = resolve(packageRoot, "agent", plugin.rootPath);
    await mkdir(targetRoot, { recursive: true });
    for (const entryName of officialPluginTopLevelAllowlist) {
      const entrySource = resolve(sourceRoot, entryName);
      if (!(await pathExists(entrySource))) continue;
      await cp(entrySource, resolve(targetRoot, entryName), {
        dereference: true,
        recursive: true,
        filter: (source) => shouldCopyOfficialPluginAsset(sourceRoot, source),
      });
    }
    for (const relPath of requiredFiles) {
      const stagedAsset = resolve(targetRoot, ...relPath.split("/"));
      if (!(await stat(stagedAsset).catch(() => undefined))?.isFile()) {
        throw new Error(`Missing staged official plugin asset for ${plugin.name}: ${stagedAsset}`);
      }
    }
  }
}

export async function stageTuiRuntime(packageRoot, targets = supportedTargets) {
  const stagingDirectory = resolve(packageRoot, "../tui-staging");
  const copied = new Map();
  try {
    for (const target of targets) {
      const { assets, manifest } = await collectSeaTuiAssets({
        root: resolve(root, "apps/zcode-cli"),
        stagingDirectory,
        target,
      });
      for (const file of manifest.files) {
        const previous = copied.get(file.path);
        if (previous) {
          if (previous !== file.sha256)
            throw new Error(`Conflicting TUI asset: ${file.path} (${target})`);
          continue;
        }
        const destination = resolve(packageRoot, "agent", file.path);
        await mkdir(dirname(destination), { recursive: true });
        await cp(assets[`${seaTuiAssetPrefix}${file.path}`], destination);
        await chmod(destination, file.mode);
        copied.set(file.path, file.sha256);
      }
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}
const lydellNodePtyPackages = [
  "@lydell/node-pty-darwin-arm64",
  "@lydell/node-pty-darwin-x64",
  "@lydell/node-pty-linux-arm64",
  "@lydell/node-pty-linux-x64",
];

function shouldCopyPackagePath(packageDirectory, source) {
  const rel = relative(packageDirectory, source);
  if (!rel) {
    return true;
  }
  const parts = rel.split(sep);
  // OpenZWork(OZ-F011)：可选 native 依赖也可能在安装时留下调试符号与编译中间文件。
  return !parts.includes("node_modules") && !parts.includes(".git") &&
    !/\.(?:o|obj|pdb)$/i.test(parts.at(-1));
}

async function resolvePackageJsonPath(requireFrom, packageName) {
  try {
    return requireFrom.resolve(`${packageName}/package.json`);
  } catch (error) {
    if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
      throw error;
    }
    let current = dirname(requireFrom.resolve(packageName));
    for (;;) {
      const candidate = resolve(current, "package.json");
      if (await pathExists(candidate)) {
        try {
          const packageJson = await readJson(candidate);
          if (packageJson.name === packageName) {
            return candidate;
          }
        } catch {
          // Keep walking; malformed nested metadata should not pick the package root.
        }
      }
      const parent = dirname(current);
      if (parent === current) {
        throw error;
      }
      current = parent;
    }
  }
}

async function copyRuntimePackageTree({ packageName, packageRoot, requireFrom, seen }) {
  if (seen.has(packageName)) {
    return;
  }
  seen.add(packageName);

  let packageJsonPath;
  try {
    packageJsonPath = await resolvePackageJsonPath(requireFrom, packageName);
  } catch (error) {
    throw new Error(`Unable to resolve runtime package ${packageName}`, {
      cause: error,
    });
  }

  const packageDirectory = dirname(packageJsonPath);
  const destination = resolve(packageRoot, "node_modules", ...packageName.split("/"));
  await mkdir(dirname(destination), {
    recursive: true,
  });
  await cp(packageDirectory, destination, {
    dereference: true,
    force: true,
    recursive: true,
    filter: (source) => shouldCopyPackagePath(packageDirectory, source),
  });

  const packageJson = await readJson(packageJsonPath);
  const requireFromPackage = createRequire(packageJsonPath);
  const dependencies = Object.assign(
    {},
    packageJson.dependencies,
    packageJson.optionalDependencies,
  );
  for (const dependencyName of Object.keys(dependencies)) {
    try {
      await copyRuntimePackageTree({
        packageName: dependencyName,
        packageRoot,
        requireFrom: requireFromPackage,
        seen,
      });
    } catch (error) {
      if (!Object.hasOwn(packageJson.optionalDependencies ?? {}, dependencyName)) {
        throw error;
      }
      console.warn(`[zcode] optional package ${dependencyName} is unavailable; skipping`);
    }
  }
}

export async function copyRuntimeNodeModules(packageRoot, runtimeTarget) {
  const requireFromServer = createRequire(resolve(root, "packages", "server", "package.json"));
  const seen = new Set();
  for (const packageName of runtimePackageNames) {
    // OpenZWork(OZ-F011)：平台附件只复制本平台 PTY 的运行文件。
    if (runtimeTarget && packageName === "node-pty") {
      const source = dirname(await resolvePackageJsonPath(requireFromServer, packageName));
      await stagePlatformPty(source, resolve(packageRoot, "node_modules/node-pty"), runtimeTarget);
      seen.add(packageName);
      continue;
    }
    await copyRuntimePackageTree({
      packageName,
      packageRoot,
      requireFrom: requireFromServer,
      seen,
    });
  }
  // CLI 的浏览器运行时同样是外部依赖，不能依赖开发仓库的 hoisted node_modules。
  await copyRuntimePackageTree({
    packageName: "playwright-core",
    packageRoot: resolve(packageRoot, "agent"),
    requireFrom: createRequire(resolve(root, "apps/zcode-cli/packages/cli/package.json")),
    seen: new Set(),
  });
  // OpenZWork(OZ-F011)：CLI/TUI 与独立 Server 均将 @napi-rs/keyring 设为外部依赖，必须随包携带平台原生绑定。
  const keyringPlatformKey = runtimeTarget ?? `${process.platform}-${process.arch}`;
  const sharedRoot = resolve(root, "packages/shared");
  await stageCredentialKeyring({
    sourceRoot: sharedRoot,
    targetRoot: packageRoot,
    platformKey: keyringPlatformKey,
  });
  await stageCredentialKeyring({
    sourceRoot: sharedRoot,
    targetRoot: resolve(packageRoot, "agent"),
    platformKey: keyringPlatformKey,
  });
}

export async function patchNodePtyPrebuilds(packageRoot) {
  const requireFromServer = createRequire(resolve(root, "packages", "server", "package.json"));
  const nodePtyPrebuildRoot = resolve(packageRoot, "node_modules", "node-pty", "prebuilds");

  for (const packageName of lydellNodePtyPackages) {
    let packageJsonPath;
    try {
      packageJsonPath = await resolvePackageJsonPath(requireFromServer, packageName);
    } catch {
      console.warn(`[zcode] ${packageName} is unavailable; skipping node-pty prebuild patch`);
      continue;
    }
    const sourcePrebuildRoot = resolve(dirname(packageJsonPath), "prebuilds");
    const sourceStat = await stat(sourcePrebuildRoot).catch(() => null);
    if (!sourceStat?.isDirectory()) {
      continue;
    }
    for (const platformKey of await readdir(sourcePrebuildRoot)) {
      const targetPrebuildDir = resolve(nodePtyPrebuildRoot, platformKey);
      // Bug 原因：平台包是 1.2.0-beta.10（resize 要 5 个参数），旧逻辑整目录 force 覆盖，
      // 把官方 node-pty 自带的同版本 darwin native 换掉，官方 JS 只传 3 个参数，macOS 终端
      // resize 必然失败。官方包已自带的平台 prebuild 与其 JS 同版本，不能被覆盖；
      // 平台包只补官方包缺失的平台。
      if (await pathExists(targetPrebuildDir)) {
        continue;
      }
      await cp(resolve(sourcePrebuildRoot, platformKey), targetPrebuildDir, {
        dereference: true,
        recursive: true,
      });
    }
  }

  for (const helper of [
    resolve(nodePtyPrebuildRoot, "darwin-arm64", "spawn-helper"),
    resolve(nodePtyPrebuildRoot, "darwin-x64", "spawn-helper"),
  ]) {
    if (await pathExists(helper)) {
      await chmod(helper, 0o755);
    }
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
