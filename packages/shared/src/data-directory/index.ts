import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acquireFileLock } from "@zcode/shared/node";
import { BUSINESS_DATA_ENTRIES, DATA_ROOT_RELOCATED_MARKER } from "./contract.js";
import type { DataDirectoryContract, DataRelocationPlan } from "./contract.js";
export * from "./contract.js";
export { localProjectId, projectMemoryDirectoryName } from "./identity.js";

/** 只转换已复制业务范围内的绝对引用，前缀相似目录、远端 URI 和用户正文均不匹配。 */
export function relocateDataPath(value: string, plan: DataRelocationPlan): string {
  if (!isAbsolute(value)) return value;
  for (const source of [plan.sourceRoot, ...(plan.sourceAliases ?? [])]) {
    const rel = relative(source, value);
    if (rel === "") return plan.targetRoot;
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) continue;
    const parts = rel.split(sep);
    if (!(BUSINESS_DATA_ENTRIES as readonly string[]).includes(parts[0]!)) continue;
    if (
      (parts[0] === "v2" && parts[1]?.startsWith("setting.json")) ||
      (parts[0] === "cli" && parts[1]?.startsWith("config.json"))
    )
      continue;
    return join(plan.targetRoot, rel);
  }
  return value;
}

export function relocateFileReference(value: string, plan: DataRelocationPlan): string {
  if (!value.startsWith("file:")) return relocateDataPath(value, plan);
  const path = fileURLToPath(value);
  const next = relocateDataPath(path, plan);
  return next === path ? value : pathToFileURL(next).href;
}

async function gateDirectory(root: string): Promise<string> {
  await mkdir(dirname(root), { recursive: true });
  // 同一个目录的软链接别名必须共享门禁；目标尚不存在时解析父目录。
  const actual = await realpath(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return realpath(dirname(root)).then((parent) => join(parent, relative(dirname(root), root)));
  });
  const gate = `${resolve(actual)}.data-access`;
  await mkdir(gate, { recursive: true });
  return gate;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export const dataDirectory: DataDirectoryContract = {
  async acquireUse(root) {
    const gate = await gateDirectory(root);
    const unlock = await acquireFileLock(join(gate, "admission"), [25, 50, 100], 200, 2000);
    try {
      try {
        await readFile(join(root, DATA_ROOT_RELOCATED_MARKER), "utf8");
        throw Object.assign(
          new Error("This data directory was relocated. Start with the new data directory."),
          { code: "DATA_DIRECTORY_RELOCATED" },
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const file = join(gate, `user-${process.pid}-${randomUUID()}.json`);
      await writeFile(file, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 });
      return async () => {
        await rm(file, { force: true });
      };
    } finally {
      await unlock();
    }
  },
  async exclusive(root, operation) {
    const gate = await gateDirectory(root);
    const unlock = await acquireFileLock(join(gate, "admission"), [25, 50, 100], 200, 2000);
    try {
      for (const name of await readdir(gate)) {
        if (!name.startsWith("user-")) continue;
        const file = join(gate, name);
        const raw = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
        if (raw === undefined) continue;
        const { pid } = JSON.parse(raw) as { pid: number };
        if (!Number.isSafeInteger(pid) || pid <= 0 || alive(pid)) {
          throw Object.assign(
            new Error(
              "Close other OpenZWork or CLI processes using this data directory, then retry.",
            ),
            { code: "DATA_DIRECTORY_IN_USE" },
          );
        }
        await rm(file, { force: true });
      }
      return await operation();
    } finally {
      await unlock();
    }
  },
};
