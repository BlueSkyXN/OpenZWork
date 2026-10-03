import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export async function isUserHomeDirectory(
  directory: string,
  homeDirectory: string = homedir(),
): Promise<boolean> {
  const path = resolve(directory);
  const home = resolve(homeDirectory);
  if (path === home) return true;
  // HOME 可能经符号链接或大小写别名进入工作区；只比字符串会把官方用户根重新当作项目根。
  const [canonicalPath, canonicalHome] = await Promise.all([
    realpath(path).catch(() => path),
    realpath(home).catch(() => home),
  ]);
  return canonicalPath === canonicalHome;
}
