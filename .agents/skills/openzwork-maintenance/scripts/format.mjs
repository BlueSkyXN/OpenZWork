#!/usr/bin/env node
// OpenZWork 格式化入口：先按上游历史限制文件范围，再调用仓库已有的 oxfmt。
import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { classify, gitText, globToRegExp, loadMaintenance, readTree } from "./scan.mjs";

const normalize = (path) => path.split(sep).join("/");
const matches = (path, selector) =>
  selector === "." ||
  path === selector ||
  path.startsWith(`${selector}/`) ||
  globToRegExp(selector).test(path);

/** 使用当前工作区文件；来源保护取自已合入的上游历史，包含未提交的新文件和已暂存的移动。 */
export async function selectFormatFiles(repo, selectors = []) {
  const base = loadMaintenance(repo).ledger?.upstream?.commit;
  if (!base) throw new Error("台账缺少 upstream.commit，无法确定格式化范围");
  const context = classify(repo, base);
  const upstream = new Set(context.baseTree.keys());
  for (const { commit } of context.history.slice(1))
    for (const path of readTree(repo, commit).keys()) upstream.add(path);
  const own = (path) => {
    const category = context.result.get(path)?.category;
    return category === "openzwork" || (category === undefined && !upstream.has(path));
  };
  const moved = new Set();
  const renames = gitText(repo, [
    "diff",
    "--name-status",
    "--find-renames",
    "--diff-filter=R",
    "-z",
    "HEAD",
    "--",
  ])
    .split("\0")
    .filter(Boolean);
  for (let i = 0; i < renames.length; i += 3) if (!own(renames[i + 1])) moved.add(renames[i + 2]);

  const filters = selectors.map((selector) => {
    const exclude = selector.startsWith("!");
    const value = exclude ? selector.slice(1) : selector;
    if (!value) throw new Error("格式化路径不能为空");
    const path = normalize(relative(repo, resolve(repo, value))) || ".";
    if (isAbsolute(path) || path === ".." || path.startsWith("../"))
      throw new Error(`路径在仓库外：${selector}`);
    if (
      !exclude &&
      (upstream.has(path) || moved.has(path) || (context.result.has(path) && !own(path)))
    )
      throw new Error(`上游文件不参与格式化：${path}；只修改行为必需的行`);
    return { exclude, path };
  });
  const includes = filters.filter(({ exclude }) => !exclude);
  const excludes = filters.filter(({ exclude }) => exclude);
  const candidates = [
    ...new Set(
      gitText(repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        .split("\0")
        .filter(Boolean),
    ),
  ]
    .filter((path) => own(path) && !moved.has(path))
    .filter((path) => !includes.length || includes.some((filter) => matches(path, filter.path)))
    .filter((path) => !excludes.some((filter) => matches(path, filter.path)))
    .sort();
  const files = [];
  for (const path of candidates) {
    try {
      // 只传普通文件；目录或符号链接不能把格式化范围扩展到候选清单之外。
      if ((await lstat(join(repo, path))).isFile()) files.push(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return files;
}

async function runOxfmt(repo, files, mode) {
  const bin = join(
    dirname(createRequire(import.meta.url).resolve("oxfmt/package.json")),
    "bin/oxfmt",
  );
  // Windows 的命令行有长度限制；每批仍只包含明确选中的文件。
  const batches = [[]];
  let length = 0;
  for (const file of files) {
    if (length + file.length > 16000) {
      batches.push([]);
      length = 0;
    }
    batches.at(-1).push(`./${file}`);
    length += file.length + 4;
  }
  let code = 0;
  for (const paths of batches) {
    const status = await new Promise((done, reject) => {
      const child = spawn(
        process.execPath,
        [bin, `--${mode}`, "--no-error-on-unmatched-pattern", ...paths],
        { cwd: repo, stdio: "inherit" },
      );
      child.once("error", reject);
      child.once("close", (status, signal) =>
        status === null ? reject(new Error(`oxfmt 被信号 ${signal} 中断`)) : done(status),
      );
    });
    code = Math.max(code, status);
  }
  return code;
}

export async function formatOwnFiles(
  repo,
  { selectors = [], mode = "write", formatter = runOxfmt } = {},
) {
  const files = await selectFormatFiles(repo, selectors);
  // oxfmt 没有路径参数时会遍历当前目录；空清单必须在调用前结束。
  return { files, code: files.length ? await formatter(repo, files, mode) : 0 };
}

const HELP = `用法：pnpm fmt [--check | --list-different] [--list] [文件、目录或 glob…]
默认格式化 OpenZWork 自有文件；pnpm fmt:check 检查同一范围。
--list 只列出候选文件，不写入。glob 支持 *、**、?，可以用 ! 前缀排除。
上游原文、改名、修改、保留和移动文件不参与；沿用 oxfmt 的类型支持与忽略配置。`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) return console.log(HELP);
  const modes = args.filter((arg) => ["--check", "--write", "--list-different"].includes(arg));
  if (new Set(modes).size > 1) throw new Error("--check、--write、--list-different 只能选择一种");
  const selectors = args.filter((arg) => ![...modes, "--list", "--"].includes(arg));
  for (const arg of selectors)
    if (arg.startsWith("-")) throw new Error(`未知选项：${arg}；使用 --help 查看用法`);
  const repo = gitText(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  if (args.includes("--list")) {
    for (const file of await selectFormatFiles(repo, selectors)) console.log(file);
    return;
  }
  const { files, code } = await formatOwnFiles(repo, {
    selectors,
    mode: modes[0]?.slice(2) ?? "write",
  });
  if (!files.length) console.log("没有匹配的 OpenZWork 自有文件");
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
