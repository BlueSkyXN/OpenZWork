#!/usr/bin/env node
/**
 * pnpm 11 hoisted node-linker 在「根 workspace 与内层 apps/zcode-cli/packages/* 同为
 * workspace 成员」的布局下，会把内层包声明的外部依赖（如 contracts 的 zod@3.25.76）
 * 装进包内 node_modules/.ignored/ 而不是正常位置，导致包解析向上命中根的
 * node_modules/zod@4.6.5——contracts 源码是 v3 类型风格（ZodEffects、双参 z.record），
 * 对上 v4 就整片类型报错。pnpm 10 无此行为；升级 11.28.6（Windows 安装竞态修复）
 * 后引入。
 *
 * 本脚本在 install 之后把 .ignored/ 里被错误搁置的直接依赖移回
 * node_modules/ 正常位置。幂等：没有 .ignored/ 时直接成功。
 */
import { readdirSync, existsSync, renameSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INNER_PACKAGES_GLOB = "apps/zcode-cli/packages";

function restoreOne(packageNodeModules) {
  let moved = 0;
  // 形态一：node_modules/.ignored/<name>（顶层依赖）
  const ignoredDir = join(packageNodeModules, ".ignored");
  if (existsSync(ignoredDir)) {
    for (const entry of readdirSync(ignoredDir)) {
      if (entry.startsWith(".")) continue;
      const from = join(ignoredDir, entry);
      const to = join(packageNodeModules, entry);
      if (existsSync(to)) {
        rmSync(from, { recursive: true, force: true });
      } else {
        renameSync(from, to);
      }
      moved += 1;
    }
    rmSync(ignoredDir, { recursive: true, force: true });
  }
  // 形态二：scoped 目录里的 .ignored_<name>（如 @vitejs/.ignored_plugin-react）
  for (const entry of readdirSync(packageNodeModules)) {
    if (!entry.startsWith("@") || entry === "@types") continue;
    const scopeDir = join(packageNodeModules, entry);
    if (!existsSync(scopeDir)) continue;
    for (const scoped of readdirSync(scopeDir)) {
      if (!scoped.startsWith(".ignored_")) continue;
      const from = join(scopeDir, scoped);
      const realName = scoped.slice(".ignored_".length);
      const to = join(scopeDir, realName);
      if (existsSync(to)) {
        rmSync(from, { recursive: true, force: true });
      } else {
        renameSync(from, to);
      }
      moved += 1;
    }
  }
  return moved;
}

let total = 0;
const innerRoot = join(repoRoot, INNER_PACKAGES_GLOB);
if (existsSync(innerRoot)) {
  for (const pkg of readdirSync(innerRoot)) {
    const nm = join(innerRoot, pkg, "node_modules");
    if (!existsSync(nm)) continue;
    const moved = restoreOne(nm);
    if (moved > 0) console.log(`[restore-hoisted] ${pkg}: restored ${moved} entries from .ignored/`);
    total += moved;
  }
}
console.log(`[restore-hoisted] done, ${total} entries restored`);
