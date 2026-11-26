import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  preinstalledToolsReleaseSchema,
  preinstalledToolIdSchema,
  type PreinstalledToolsRelease,
} from "@zcode/shared/preinstalled-tools";

/** 发布根与 catalog 无关，Host 在资源准备前即可注入固定目录。 */
export function resolvePreinstalledToolsPaths(input: {
  dataRoot: string;
  release: PreinstalledToolsRelease;
}) {
  if (!isAbsolute(input.dataRoot)) throw new Error("预装工具数据根目录必须是绝对路径");
  const rootDir = join(
    input.dataRoot,
    "preinstalled-tools",
    preinstalledToolsReleaseSchema.parse(input.release),
  );
  return { rootDir, binDir: join(rootDir, "bin"), toolsDir: join(rootDir, "tools") };
}
export function resolvePreinstalledToolsBinDir(input: {
  dataRoot: string;
  release: PreinstalledToolsRelease;
}): string {
  return resolvePreinstalledToolsPaths(input).binDir;
}
/** OpenZWork(OZ-C015)：每次启动 Agent 重读已发布入口，避免把残留目录、临时文件或单独的 Windows sidecar 当作可用工具。 */
export async function preinstalledToolsAgentAvailability(
  binDir: string | undefined,
  hasDownloadTarget?: Promise<boolean>,
): Promise<"1" | undefined> {
  if (!binDir) return undefined;
  if (await hasDownloadTarget) return "1";
  const files = await readdir(binDir, { withFileTypes: true }).catch(() => []);
  const names = new Set(
    files.filter((file) => file.isFile() && !file.name.startsWith(".")).map((file) => file.name),
  );
  for (const name of names) {
    if (process.platform === "win32") {
      if (name.endsWith(".exe") && names.has(name.slice(0, -4) + ".shim")) return "1";
      continue;
    }
    if (name.endsWith(".shim")) continue;
    const executable = await access(join(binDir, name), constants.X_OK).then(() => true, () => false);
    if (executable) return "1";
  }
  return undefined;
}

/** 每个工具只写自己的发布点、版本和临时目录；入口目录由协调器统一重建。 */
export function resolvePreinstalledToolPaths(input: {
  dataRoot: string;
  release: PreinstalledToolsRelease;
  toolId: string;
}) {
  const paths = resolvePreinstalledToolsPaths(input);
  const rootDir = join(paths.toolsDir, preinstalledToolIdSchema.parse(input.toolId));
  return {
    rootDir,
    binDir: paths.binDir,
    recordPath: join(rootDir, "installation.json"),
    versionsDir: join(rootDir, "versions"),
    stagingDir: join(rootDir, "staging"),
  };
}

export {
  PreinstalledToolRewriteError,
  rewritePreinstalledToolBytes,
} from "#src/preinstalled-tools/rewrite-bytes.js";
