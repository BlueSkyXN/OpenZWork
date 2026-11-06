import { access } from "node:fs/promises";
import { posix, resolve } from "node:path";

/** pnpm 11 可以是原生可执行文件；只有 JS 入口才交给 Node 解释。 */
export function resolvePnpmInvocation(pnpmPath, args, nodePath = process.execPath) {
  if (/\.[cm]?js$/iu.test(pnpmPath)) {
    return { command: nodePath, args: [pnpmPath, ...args] };
  }
  return { command: pnpmPath, args };
}

/** 当前各包都是直接 oxlint；未知脚本必须显式接入，不能被枚举器悄悄漏过。 */
export function parseLintCommand(command) {
  if (!/^oxlint(?: [\w./*-]+)*$/u.test(command) || /(?:--format| -f)(?: |$)/u.test(command))
    throw new Error(`不支持的 CLI lint 命令：${command}`);
  return command.split(" ").slice(1);
}

export async function resolvePackageLintArgs(command, packageDirectory) {
  const args = parseLintCommand(command);
  try {
    await access(resolve(packageDirectory, ".oxlintrc.json"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // 根配置排除整个 CLI；无包级配置时需要扫描声明的目标。有配置的包保留语料排除规则。
    if (!args.includes("--no-ignore")) args.push("--no-ignore");
  }
  return [...args, "--format", "json"];
}

export function classifyLintDiagnostics(diagnostics, { relativeDirectory, pristine }) {
  const accepted = [],
    errors = [],
    warnings = [];
  for (const diagnostic of diagnostics) {
    const path = posix.normalize(
      posix.join(relativeDirectory, diagnostic.filename.replaceAll("\\", "/")),
    );
    if (diagnostic.severity !== "error") warnings.push(diagnostic);
    else if (diagnostic.code === "eslint(max-lines)" && pristine.has(path))
      accepted.push(diagnostic);
    else errors.push(diagnostic);
  }
  return { accepted, errors, warnings };
}
