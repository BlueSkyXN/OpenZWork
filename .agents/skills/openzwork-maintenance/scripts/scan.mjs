#!/usr/bin/env node
// OpenZWork 来源扫描：以台账记录的上游基准给路径分类，预演合入上游新版本，并执行维护门禁检查。
// 用法与输出说明见 ../references/scan/GUIDE.md。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

export const LEDGER_PATH = "docs/openzwork/ledger.yaml";
export const VARIANTS_PATH = "docs/openzwork/upstream-doc-variants.yaml";
export const PATCHES_PATH = "docs/openzwork/patches/downstream-patches.yaml";
export const GATES_PATH = "tests/private-cleanup/cleanup.test.cjs";
export const KNOWLEDGE_DIR = ".agents/skills/openzwork-maintenance/knowledge";
export const KNOWLEDGE_FILES = {
  pitfall: "pitfalls.yaml",
  diff: "diff.yaml",
  decision: "decisions.yaml",
};
const KNOWLEDGE_PREFIX = { pitfall: "OZK-PIT-", diff: "OZK-DIF-", decision: "OZK-DEC-" };
const LEDGER_PREFIX = { feature: "OZ-F", change: "OZ-C", drop: "OZ-D", retain: "OZ-R" };
const LEDGER_STATUS = new Set(["active", "undecided", "retired"]);
const VARIANT_KINDS = new Set(["purge", "identity", "content"]);
// 保留 OpenZWork 版本的理由：代码读取、规则引用、OpenZWork 改写维护、待用户确认。
const VARIANT_ROLES = new Set(["tool", "rule", "maintained", "pending"]);
export const README_PATH = "docs/openzwork/README.md";
const MAX_ACTIVE_KNOWLEDGE = 40;
// 上游文档与技能（文档类扩展名）保持原文；OpenZWork 版本放在同目录，文件名加 -openzwork。代码文件按代码规则原地修改。
const DOC_ROOTS = ["docs/", ".agents/skills/"];
const DOC_EXT = /\.(?:md|mdx|ya?ml|json|txt)$/;
const isUpstreamDoc = (path) =>
  DOC_ROOTS.some((root) => path.startsWith(root)) && DOC_EXT.test(path);
export const variantOf = (path) => path.replace(/(\.[^./]+)$/, "-openzwork$1");
const upstreamOf = (path) => path.replace(/-openzwork(\.[^./]+)$/, "$1");
export const CATEGORIES = [
  "upstream",
  "upstream-format",
  "upstream-identity",
  "upstream-modified",
  "removed",
  "openzwork",
  "retained",
  "moved",
];

// 用户级数据根改名（家目录下的 .zcode 改为 .openzwork）的确定性规则；只差这些改名的上游文件归为 upstream-identity。
export const IDENTITY_RULES = [
  [/((?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)[/\\])\.zcode(?![\w-])/g, "$1.openzwork"],
  [/((?:homedir|resolveUserHomeDir)\(\)\s*,\s*["'])\.zcode(["'])/g, "$1.openzwork$2"],
];
export function applyIdentity(text) {
  let out = text;
  for (const [pattern, replacement] of IDENTITY_RULES) out = out.replace(pattern, replacement);
  return out;
}

function git(repo, args, { input, allowFail = false } = {}) {
  const result = spawnSync("git", ["-C", repo, ...args], { input, maxBuffer: 1 << 30 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(" ")} 失败：${result.stderr.toString().trim()}`);
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr.toString() };
}
const gitText = (repo, args, options) => git(repo, args, options).stdout.toString("utf8");

export function readTree(repo, ref) {
  const tree = new Map();
  for (const line of gitText(repo, ["ls-tree", "-r", "-z", "--full-tree", ref]).split("\0")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const [mode, type, blob] = line.slice(0, tab).split(" ");
    if (type === "blob") tree.set(line.slice(tab + 1), { mode, blob });
  }
  return tree;
}

export function readBlobs(repo, blobs) {
  const unique = [...new Set(blobs)];
  const out = new Map();
  if (!unique.length) return out;
  const buffer = git(repo, ["cat-file", "--batch"], { input: unique.join("\n") + "\n" }).stdout;
  let offset = 0;
  for (const blob of unique) {
    const newline = buffer.indexOf(10, offset);
    const size = Number(buffer.subarray(offset, newline).toString().split(" ")[2]);
    out.set(blob, buffer.subarray(newline + 1, newline + 1 + size));
    offset = newline + 1 + size + 1;
  }
  return out;
}

function readAt(repo, ref, path) {
  const result = git(repo, ["show", `${ref}:${path}`], { allowFail: true });
  return result.status === 0 ? result.stdout.toString("utf8") : undefined;
}
function yamlAt(repo, ref, path) {
  const text = readAt(repo, ref, path);
  return text === undefined ? undefined : parseYaml(text);
}
function versionAt(repo, ref) {
  const text = readAt(repo, ref, "package.json");
  try {
    return text ? JSON.parse(text).version : undefined;
  } catch {
    return undefined;
  }
}
const isText = (buffer) => !buffer.includes(0);

/** 上游快照链：基准及其全部祖先（均为上游 sync 提交），新到旧。 */
export function upstreamHistory(repo, base) {
  return gitText(repo, ["rev-list", base])
    .split("\n")
    .filter(Boolean)
    .map((commit) => ({ commit, version: versionAt(repo, commit) }));
}

export function classify(repo, base, head = "HEAD") {
  const baseTree = readTree(repo, base);
  const headTree = readTree(repo, head);
  const history = upstreamHistory(repo, base);
  const older = new Set();
  for (const { commit } of history.slice(1))
    for (const path of readTree(repo, commit).keys()) older.add(path);
  const added = [...headTree.keys()].filter((path) => !baseTree.has(path));
  const removed = [...baseTree.keys()].filter((path) => !headTree.has(path));
  const addedByBlob = new Map(added.map((path) => [headTree.get(path).blob, path]));
  const removedByBlob = new Map(removed.map((path) => [baseTree.get(path).blob, path]));
  const result = new Map();
  const modified = [];
  for (const [path, entry] of baseTree) {
    const current = headTree.get(path);
    if (!current) {
      const movedTo = addedByBlob.get(entry.blob);
      result.set(path, movedTo ? { category: "moved", movedTo } : { category: "removed" });
    } else if (current.blob === entry.blob) result.set(path, { category: "upstream" });
    else modified.push(path);
  }
  for (const path of added) {
    const movedFrom = removedByBlob.get(headTree.get(path).blob);
    if (movedFrom) result.set(path, { category: "moved", movedFrom });
    else result.set(path, { category: older.has(path) ? "retained" : "openzwork" });
  }
  const blobs = readBlobs(
    repo,
    modified.flatMap((path) => [baseTree.get(path).blob, headTree.get(path).blob]),
  );
  for (const path of modified) {
    const before = blobs.get(baseTree.get(path).blob);
    const after = blobs.get(headTree.get(path).blob);
    const identity =
      isText(before) &&
      isText(after) &&
      applyIdentity(before.toString("utf8")) === after.toString("utf8");
    result.set(path, { category: identity ? "upstream-identity" : "upstream-modified" });
  }
  return { repo, base, head, history, baseTree, headTree, result, blobs };
}

/** 默认格式化器：用仓库的 oxfmt 与 .oxfmtrc.json（去掉 ignorePatterns）格式化给定文本。 */
export function createOxfmtFormatter(repo) {
  let bin;
  try {
    bin = join(
      dirname(createRequire(join(repo, "package.json")).resolve("oxfmt/package.json")),
      "bin/oxfmt",
    );
  } catch {
    return undefined;
  }
  const config = existsSync(join(repo, ".oxfmtrc.json"))
    ? JSON.parse(readFileSync(join(repo, ".oxfmtrc.json"), "utf8"))
    : {};
  delete config.ignorePatterns;
  delete config.$schema;
  return (files) => {
    const root = mkdtempSync(join(tmpdir(), "openzwork-fmt-"));
    try {
      writeFileSync(join(root, ".oxfmtrc.json"), JSON.stringify(config));
      files.forEach(({ path, text }, index) => {
        const target = join(root, String(index), path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, text);
      });
      // 个别文件无法解析时 oxfmt 返回非零，其余文件仍已格式化；未改动的文件按原文比较。
      spawnSync(process.execPath, [bin, "--no-error-on-unmatched-pattern", "."], {
        cwd: root,
        maxBuffer: 1 << 28,
      });
      return files.map(({ path }, index) => readFileSync(join(root, String(index), path), "utf8"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

/** 找出只差格式化（或改名加格式化）的上游文件。返回 undefined 表示没有可用的格式化器。 */
export function findFormatNoise(context, formatter = createOxfmtFormatter(context.repo)) {
  if (!formatter) return undefined;
  const { baseTree, headTree, blobs, result } = context;
  const candidates = [...result]
    .filter(([, { category }]) => category === "upstream-modified")
    .map(([path]) => path)
    .filter(
      (path) =>
        isText(blobs.get(baseTree.get(path).blob)) && isText(blobs.get(headTree.get(path).blob)),
    );
  const inputs = candidates.flatMap((path) => {
    const text = blobs.get(baseTree.get(path).blob).toString("utf8");
    return [
      { path, text },
      { path, text: applyIdentity(text) },
    ];
  });
  const formatted = formatter(inputs);
  const noise = [];
  candidates.forEach((path, index) => {
    const current = blobs.get(headTree.get(path).blob).toString("utf8");
    if (formatted[index * 2] === current) noise.push({ path, variant: "format" });
    else if (formatted[index * 2 + 1] === current) noise.push({ path, variant: "identity+format" });
  });
  return noise;
}

export function globToRegExp(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      index++;
      if (glob[index + 1] === "/") {
        index++;
        source += "(?:.*/)?";
      } else source += ".*";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export function loadMaintenance(repo, ref = "HEAD") {
  const knowledge = {};
  for (const [kind, file] of Object.entries(KNOWLEDGE_FILES))
    knowledge[kind] = yamlAt(repo, ref, `${KNOWLEDGE_DIR}/${file}`);
  return {
    ledger: yamlAt(repo, ref, LEDGER_PATH),
    variants: yamlAt(repo, ref, VARIANTS_PATH),
    patches: yamlAt(repo, ref, PATCHES_PATH),
    gates: readAt(repo, ref, GATES_PATH) ?? "",
    knowledge,
  };
}

/** 认领索引：台账条目（paths、hooks、tests、spec）、下游补丁（files、regression）与上游文档的 OpenZWork 版本登记。 */
export function createClaims({ ledger, variants, patches }) {
  const matchers = [];
  for (const entry of ledger?.entries ?? []) {
    for (const glob of [
      ...(entry.paths ?? []),
      ...(entry.hooks ?? []),
      ...(entry.tests ?? []),
      ...specList(entry),
    ]) {
      matchers.push({
        id: entry.id,
        kind: entry.kind,
        status: entry.status,
        regex: globToRegExp(glob),
      });
    }
  }
  const exact = new Map();
  const add = (path, claim) => exact.set(path, [...(exact.get(path) ?? []), claim]);
  for (const patch of patches?.patches ?? []) {
    for (const path of [...(patch.files ?? []), ...(patch.regression ?? [])])
      add(path, { id: patch.id, kind: "patch" });
  }
  for (const item of variants?.variants ?? [])
    add(item.variant, { id: `variant:${item.kind}`, kind: "variant" });
  return (path) => [
    ...matchers
      .filter((matcher) => matcher.regex.test(path))
      .map(({ id, kind, status }) => ({ id, kind, status })),
    ...(exact.get(path) ?? []),
  ];
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const specList = (entry) => (entry.spec === undefined ? [] : [entry.spec].flat());
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;

export function validateLedger(ledger, context, gates) {
  const errors = [];
  if (!ledger) return [`缺少 ${LEDGER_PATH}`];
  if (ledger.version !== 1) errors.push(`${LEDGER_PATH}: version 应为 1`);
  if (!SEMVER.test(ledger.upstream?.version ?? ""))
    errors.push(`${LEDGER_PATH}: upstream.version 应为 X.Y.Z`);
  if (!/^[0-9a-f]{40}$/.test(ledger.upstream?.commit ?? ""))
    errors.push(`${LEDGER_PATH}: upstream.commit 应为 40 位提交号`);
  const ids = new Set();
  const headPaths = [...context.headTree.keys()];
  for (const entry of ledger.entries ?? []) {
    const where = `${LEDGER_PATH}: ${entry.id ?? "(缺 id)"}`;
    const prefix = LEDGER_PREFIX[entry.kind];
    if (!prefix) errors.push(`${where}: kind 应为 ${Object.keys(LEDGER_PREFIX).join("/")}`);
    else if (!new RegExp(`^${prefix}\\d{3}$`).test(entry.id ?? ""))
      errors.push(`${where}: ${entry.kind} 条目的 id 应为 ${prefix}NNN`);
    if (ids.has(entry.id)) errors.push(`${where}: id 重复`);
    ids.add(entry.id);
    if (!LEDGER_STATUS.has(entry.status))
      errors.push(`${where}: status 应为 active/undecided/retired`);
    for (const field of ["title", "summary", "source"])
      if (!nonEmpty(entry[field])) errors.push(`${where}: 缺少 ${field}`);
    if (!Array.isArray(entry.paths) || entry.paths.length === 0)
      errors.push(`${where}: paths 至少一项`);
    for (const spec of specList(entry))
      if (!context.headTree.has(spec)) errors.push(`${where}: spec 不存在：${spec}`);
    for (const test of entry.tests ?? [])
      if (!context.headTree.has(test)) errors.push(`${where}: 测试不存在：${test}`);
    if (entry.status !== "active") continue;
    for (const glob of entry.paths ?? []) {
      const regex = globToRegExp(glob);
      const hits = headPaths.filter((path) => regex.test(path));
      if (entry.kind === "drop" && hits.length)
        errors.push(`${where}: 已裁剪路径仍存在：${hits.slice(0, 5).join(", ")}`);
      if (entry.kind !== "drop" && !hits.length)
        errors.push(`${where}: 路径不存在：${glob}（已移动请更新台账）`);
    }
    for (const glob of entry.hooks ?? []) {
      const regex = globToRegExp(glob);
      if (!headPaths.some((path) => regex.test(path)))
        errors.push(`${where}: hooks 路径不存在：${glob}`);
    }
    for (const gate of entry.gates ?? [])
      if (!gates.includes(gate)) errors.push(`${where}: ${GATES_PATH} 中找不到门禁：${gate}`);
  }
  return errors;
}

export function validateBase(ledger, context) {
  const errors = [];
  const { repo, base, head } = context;
  if (git(repo, ["merge-base", "--is-ancestor", base, head], { allowFail: true }).status !== 0) {
    errors.push(`上游基准 ${base} 不是 ${head} 的祖先；合入上游后更新 ${LEDGER_PATH} 的 upstream`);
  }
  const baseVersion = versionAt(repo, base);
  if (baseVersion !== ledger.upstream?.version)
    errors.push(
      `上游基准的 package.json 版本为 ${baseVersion}，台账记为 ${ledger.upstream?.version}`,
    );
  const headVersion = (versionAt(repo, head) ?? "").split("+")[0];
  if (headVersion !== ledger.upstream?.version)
    errors.push(
      `根 package.json 版本前三段为 ${headVersion}，与台账上游版本 ${ledger.upstream?.version} 不一致`,
    );
  return errors;
}

// 登记的文档版本选择函数（maintenance-model.md）：定义处带 OpenZWork(OZ-F001) 标记。
const VARIANT_SELECTOR_FUNCTIONS = ["openzworkDoc"];

// 验证 usedBy 文件实际选中 OpenZWork 版本。返回 { ok, reason }；isMarkdown 用于 rule 文档的链接判定。
function verifyVariantReader(text, item, isMarkdown) {
  const upstreamName = item.upstream.split("/").pop();
  const variantName = item.variant.split("/").pop();
  const variantBase = variantName.replace(/(\.[^./]+)$/, "");

  // 写法一：直接引用 OpenZWork 版本路径或文件名。
  if (text.includes(item.variant) || text.includes(variantName)) return { ok: true };

  // 写法二：把原文路径传给登记的选择函数（openzworkDoc(原路径)），版本存在时选中版本。
  for (const fn of VARIANT_SELECTOR_FUNCTIONS) {
    const selectorUsed = new RegExp(`${fn}\\s*\\(([\\s\\S]*?)\\)`, "g");
    let match;
    while ((match = selectorUsed.exec(text)) !== null) {
      const args = match[1];
      if (
        args.includes(item.upstream) ||
        args.includes(`"${item.upstream.split("/").pop()}"`) ||
        args.includes(`'${item.upstream.split("/").pop()}'`)
      )
        return { ok: true };
    }
  }

  // 写法三：rule 文档用 Markdown 链接指向 OpenZWork 版本。
  if (isMarkdown && new RegExp(`\\]\\([^)#]*${variantBase}-openzwork\\.[^)]*\\)`).test(text))
    return { ok: true };

  // 未选中版本：区分“引用了上游原文”与“完全没有读取关系”。
  if (text.includes(upstreamName))
    return {
      ok: false,
      reason: `登记了 OpenZWork 版本仍读取上游原文 ${upstreamName}；改为读版本路径、选择函数或版本链接`,
    };
  return {
    ok: false,
    reason: "没有引用该文档；关系已失效时删除 OpenZWork 版本或调整 role",
  };
}

export function validateVariants(doc, context) {
  const errors = [];
  if (!doc) return [`缺少 ${VARIANTS_PATH}`];
  if (doc.version !== 1) errors.push(`${VARIANTS_PATH}: version 应为 1`);
  const { baseTree, headTree, result } = context;
  const registered = new Set();
  for (const item of doc.variants ?? []) {
    const where = `${VARIANTS_PATH}: ${item.upstream ?? "(缺 upstream)"}`;
    if (!nonEmpty(item.upstream) || !nonEmpty(item.variant)) {
      errors.push(`${where}: 需要 upstream 与 variant`);
      continue;
    }
    if (registered.has(item.upstream)) errors.push(`${where}: 重复登记`);
    registered.add(item.upstream);
    if (item.variant !== variantOf(item.upstream))
      errors.push(`${where}: variant 应为 ${variantOf(item.upstream)}`);
    if (!VARIANT_KINDS.has(item.kind)) errors.push(`${where}: kind 应为 purge/identity/content`);
    if (!headTree.has(item.variant)) errors.push(`${where}: OpenZWork 版本不存在：${item.variant}`);
    if (!VARIANT_ROLES.has(item.role)) {
      errors.push(
        `${where}: role 应为 tool/rule/maintained/pending，写明保留 OpenZWork 版本的理由`,
      );
    } else if (item.role === "tool" || item.role === "rule") {
      // 代码读取或规则引用必须实际选中 OpenZWork 版本（maintenance-model.md 的三种写法），
      // 文件名只在注释或无关字符串里出现、或登记了版本仍读上游原文，都算关系失效。
      if (!Array.isArray(item.usedBy) || item.usedBy.length === 0) {
        errors.push(`${where}: role 为 ${item.role} 时 usedBy 至少列出一个读取或引用方`);
      }
      for (const by of item.usedBy ?? []) {
        const text = context.headTree.has(by)
          ? (readAt(context.repo, context.head, by) ?? "")
          : undefined;
        if (text === undefined) {
          errors.push(`${where}: usedBy 文件不存在：${by}`);
          continue;
        }
        const verdict = verifyVariantReader(text, item, by.endsWith(".md"));
        if (!verdict.ok) errors.push(`${where}: ${by} ${verdict.reason}`);
      }
    }
    const original = baseTree.get(item.upstream);
    if (!original) {
      errors.push(
        `${where}: 上游已删除原文；决定保留 ${item.variant}（去掉 -openzwork 后缀改为独立文档并删除登记）或一并删除`,
      );
    } else if (original.blob !== item.upstreamBlob) {
      errors.push(
        `${where}: 上游已更新原文；按新原文复核 ${item.variant}，再把 upstreamBlob 改为 ${original.blob}`,
      );
    }
  }
  for (const [path, { category }] of result) {
    if (!isUpstreamDoc(path)) continue;
    if (category === "upstream-modified" || category === "upstream-identity") {
      errors.push(
        `上游文档 ${path} 与上游原文不一致：恢复上游原文，把 OpenZWork 的内容写到 ${variantOf(path)} 并登记到 ${VARIANTS_PATH}`,
      );
    }
  }
  for (const path of headTree.keys()) {
    const original = upstreamOf(path);
    if (original !== path && baseTree.has(original) && !registered.has(original)) {
      errors.push(
        `${path} 是上游文档 ${original} 的 OpenZWork 版本，但没有登记到 ${VARIANTS_PATH}`,
      );
    }
  }
  for (const { file, line, target, variant } of findUpstreamLinks(context, registered)) {
    errors.push(
      `${file}:${line} 链接 ${target} 打开的是上游原文；OpenZWork 文档改为链接 ${variant.split("/").pop()}（上游原文的内容和锚点与 OpenZWork 版本不同）；确实要引用上游原文时，链接文字以「上游」开头`,
    );
  }
  return errors;
}

// 行内链接的文字与目标；文字以「上游」开头表示有意引用上游原文（OpenZWork 版本没有对应内容）。
const INLINE_LINK = /\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*<?([^)\s>]+)>?/g;
const REFERENCE_LINK = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/;

/**
 * OpenZWork 自有的 Markdown（分类 openzwork）里，指向「有 OpenZWork 版本的上游文档」的相对链接。
 * 这类链接应改指 OpenZWork 版本，否则读者打开的是上游原文，锚点也可能不存在。
 * 链接文字以「上游」开头的视为有意引用上游原文，不计入。
 */
export function findUpstreamLinks(context, registered) {
  const own = [...context.result]
    .filter(([path, { category }]) => category === "openzwork" && /\.mdx?$/.test(path))
    .map(([path]) => path);
  const blobs = readBlobs(
    context.repo,
    own.map((path) => context.headTree.get(path).blob),
  );
  const hits = [];
  for (const file of own) {
    let fenced = false;
    const lines = blobs.get(context.headTree.get(file).blob).toString("utf8").split("\n");
    lines.forEach((text, index) => {
      if (/^\s*(?:```|~~~)/.test(text)) fenced = !fenced;
      if (fenced) return;
      const reference = REFERENCE_LINK.exec(text)?.[1];
      const targets = [...text.matchAll(INLINE_LINK)]
        .filter((match) => !match[1].trimStart().startsWith("上游"))
        .map((match) => match[2]);
      for (const target of reference ? [...targets, reference] : targets) {
        const [path] = target.split("#");
        if (!path || /^[a-z][\w+.-]*:/i.test(path)) continue;
        let resolved;
        try {
          resolved = posix.normalize(
            path.startsWith("/")
              ? decodeURI(path.slice(1))
              : posix.join(posix.dirname(file), decodeURI(path)),
          );
        } catch {
          continue;
        }
        if (registered.has(resolved)) {
          hits.push({ file, line: index + 1, target, variant: variantOf(resolved) });
        }
      }
    });
  }
  return hits;
}

/** 差异总表：台账中每个 active、undecided 条目都要出现在 README 的「与上游的差异」中。 */
export function validateDifferenceTable(ledger, readme) {
  if (readme === undefined) return [`缺少 ${README_PATH}`];
  const start = readme.indexOf("## 与上游的差异");
  if (start < 0) return [`${README_PATH} 缺少「## 与上游的差异」一节`];
  const next = readme.indexOf("\n## ", start + 1);
  const section = readme.slice(start, next < 0 ? undefined : next);
  return (ledger?.entries ?? [])
    .filter((entry) => entry.status === "active" || entry.status === "undecided")
    .filter((entry) => !section.includes(entry.id))
    .map((entry) => `${README_PATH}「与上游的差异」缺少 ${entry.id}（${entry.title}）`);
}

export function validateKnowledge(knowledge, context) {
  const errors = [];
  const all = new Map();
  for (const [kind, doc] of Object.entries(knowledge)) {
    const file = `${KNOWLEDGE_DIR}/${KNOWLEDGE_FILES[kind]}`;
    if (!doc) {
      errors.push(`缺少 ${file}`);
      continue;
    }
    if (doc.version !== 1 || doc.kind !== kind)
      errors.push(`${file}: 应为 version: 1、kind: ${kind}`);
    let active = 0;
    for (const entry of doc.entries ?? []) {
      const where = `${file}: ${entry.id ?? "(缺 id)"}`;
      if (!new RegExp(`^${KNOWLEDGE_PREFIX[kind]}\\d{3}$`).test(entry.id ?? ""))
        errors.push(`${where}: id 应为 ${KNOWLEDGE_PREFIX[kind]}NNN`);
      if (all.has(entry.id)) errors.push(`${where}: id 重复`);
      all.set(entry.id, entry);
      for (const field of ["title", "when", "do", "why"])
        if (!nonEmpty(entry[field])) errors.push(`${where}: 缺少 ${field}`);
      if (nonEmpty(entry.title) && [...entry.title].length > 40)
        errors.push(`${where}: title 不超过 40 字`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.since ?? "")))
        errors.push(`${where}: since 应为 YYYY-MM-DD`);
      if (!SEMVER.test(String(entry.checked ?? "")))
        errors.push(`${where}: checked 应为上游版本 X.Y.Z`);
      if (!Array.isArray(entry.evidence) || entry.evidence.length === 0)
        errors.push(`${where}: evidence 至少一项`);
      for (const item of entry.evidence ?? []) {
        if (/^[\w.@-]+(?:\/[\w.@-]+)+$/.test(item) && !context.headTree.has(item))
          errors.push(`${where}: 证据文件不存在：${item}`);
      }
      if (entry.status === "active") active++;
      else if (entry.status !== "superseded")
        errors.push(`${where}: status 应为 active/superseded`);
    }
    if (active > MAX_ACTIVE_KNOWLEDGE)
      errors.push(
        `${file}: active 条目 ${active} 条，超过 ${MAX_ACTIVE_KNOWLEDGE}；先合并同类条目`,
      );
  }
  for (const entry of all.values()) {
    if (entry.status !== "superseded") continue;
    const next = all.get(entry.supersededBy);
    if (!next || next.status !== "active")
      errors.push(`${entry.id}: supersededBy 应指向 active 条目`);
  }
  return errors;
}

/** 全部门禁；返回违规列表（空表示通过）。 */
export function runCheck(repo, { base, head = "HEAD", formatter } = {}) {
  const maintenance = loadMaintenance(repo, head);
  if (!maintenance.ledger) return [`缺少 ${LEDGER_PATH}（检查以 ${head} 的已提交内容为准）`];
  const context = classify(repo, base ?? maintenance.ledger.upstream.commit, head);
  const errors = [
    ...validateBase(maintenance.ledger, context),
    ...validateLedger(maintenance.ledger, context, maintenance.gates),
    ...validateVariants(maintenance.variants, context),
    ...validateDifferenceTable(maintenance.ledger, readAt(repo, head, README_PATH)),
    ...validateKnowledge(maintenance.knowledge, context),
  ];
  const noise = findFormatNoise(context, formatter ?? createOxfmtFormatter(repo));
  if (!noise) errors.push("找不到 oxfmt，无法检查格式噪声；先执行 pnpm install");
  for (const { path, variant } of noise ?? []) {
    errors.push(
      `${path} 与上游只差${variant === "format" ? "格式化" : "改名和格式化"}：恢复为上游原文${variant === "format" ? "" : "并只保留 .openzwork 改名"}`,
    );
  }
  return errors;
}

export function summarize(context, claims) {
  const rows = new Map(CATEGORIES.map((category) => [category, { total: 0, claimed: 0 }]));
  for (const [path, { category }] of context.result) {
    const row = rows.get(category);
    row.total++;
    if (claims(path).length) row.claimed++;
  }
  return rows;
}

export function describePath(context, claims, path) {
  const { result, history, headTree, repo, head } = context;
  const seen = [...history]
    .reverse()
    .filter(
      ({ commit }) =>
        git(repo, ["cat-file", "-e", `${commit}:${path}`], { allowFail: true }).status === 0,
    );
  const text = headTree.has(path) ? (readAt(repo, head, path) ?? "") : "";
  const markers = [...new Set(text.match(/OW-P\d{3}|OpenZWork\((?:OZ-[FCDR]\d{3})\)/g) ?? [])];
  return {
    path,
    exists: headTree.has(path),
    category: result.get(path)?.category ?? "untracked",
    ...result.get(path),
    firstUpstream: seen[0]?.version,
    lastUpstream: seen.at(-1)?.version,
    inBase: seen.at(-1)?.commit === history[0]?.commit,
    claims: claims(path),
    markers,
    // 上游文档的 OpenZWork 版本：原文与版本互相指向，便于先读原文再读我方改动。
    variant:
      headTree.has(variantOf(path)) && variantOf(path) !== path ? variantOf(path) : undefined,
    variantOf:
      upstreamOf(path) !== path && context.baseTree.has(upstreamOf(path))
        ? upstreamOf(path)
        : undefined,
  };
}

/** 预演合入上游提交 target：冲突、我方已删文件被上游修改、上游新增的裁剪路径、台账条目受影响的文件。 */
export function previewUpstream(context, claims, ledger, target) {
  const { repo, head, base } = context;
  const commit = gitText(repo, ["rev-parse", `${target}^{commit}`]).trim();
  const mergeBase = gitText(repo, ["merge-base", head, commit]).trim();
  const delta = gitText(repo, ["diff", "--no-renames", "--name-status", "-z", base, commit])
    .split("\0")
    .filter(Boolean);
  const changes = [];
  for (let index = 0; index < delta.length; index += 2)
    changes.push({ status: delta[index], path: delta[index + 1] });
  const merge = git(
    repo,
    ["merge-tree", "--write-tree", "--name-only", "--no-messages", head, commit],
    { allowFail: true },
  );
  const conflicts =
    merge.status === 1 ? merge.stdout.toString("utf8").split("\n").slice(1).filter(Boolean) : [];
  const drops = (ledger?.entries ?? []).filter(
    (entry) => entry.kind === "drop" && entry.status === "active",
  );
  const dropRegexes = drops.flatMap((entry) =>
    entry.paths.map((glob) => ({ id: entry.id, regex: globToRegExp(glob) })),
  );
  const touchedEntries = new Map();
  for (const { path } of changes) {
    for (const claim of claims(path)) {
      if (claim.kind === "drop") continue;
      touchedEntries.set(claim.id, [...(touchedEntries.get(claim.id) ?? []), path]);
    }
  }
  return {
    target: commit,
    version: versionAt(repo, commit),
    mergeBase,
    baseMatches: mergeBase === base,
    changes: changes.length,
    conflicts: conflicts.map((path) => ({
      path,
      category: context.result.get(path)?.category ?? "new",
      claims: claims(path),
    })),
    modifiedAfterRemoval: changes
      .filter(
        ({ status, path }) => status === "M" && context.result.get(path)?.category === "removed",
      )
      .map(({ path }) => ({ path, claims: claims(path) })),
    addedInDropPaths: changes
      .filter(({ status }) => status === "A")
      .flatMap(({ path }) =>
        dropRegexes.filter(({ regex }) => regex.test(path)).map(({ id }) => ({ path, id })),
      ),
    touchedEntries: [...touchedEntries].map(([id, paths]) => ({ id, paths })),
  };
}

function parseArgs(argv) {
  const options = { paths: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--repo") options.repo = argv[++index];
    else if (arg === "--base") options.base = argv[++index];
    else if (arg === "--upstream") options.upstream = argv[++index];
    else if (arg === "--list") options.list = argv[++index];
    else if (arg === "--path") {
      while (argv[index + 1] && !argv[index + 1].startsWith("--"))
        options.paths.push(argv[++index]);
    } else if (["--check", "--json", "--format", "--unclaimed"].includes(arg))
      options[arg.slice(2)] = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数：${arg}（--help 查看用法）`);
  }
  return options;
}

const HELP = `用法：pnpm openzwork:scan [选项]
  （无选项）            来源分类汇总与认领情况
  --path <路径…>        单个路径的来源、首次出现的上游版本、分类、认领与标记
  --list <分类>         列出某一分类的路径；加 --unclaimed 只列未认领的
  --upstream <提交|tag>  预演合入上游新版本
  --check               执行维护门禁（以已提交的 HEAD 为准）
  --format              汇总时附带格式噪声检查
  --base <提交>         覆盖台账中的上游基准
  --json                输出 JSON
分类：${CATEGORIES.join(", ")}`;

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(HELP);
  const repo = gitText(options.repo ?? process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  if (options.check) {
    const errors = runCheck(repo, { base: options.base });
    if (options.json) console.log(JSON.stringify({ errors }, null, 2));
    else
      console.log(
        errors.length
          ? `维护门禁未通过（${errors.length} 项）：\n- ${errors.join("\n- ")}`
          : "维护门禁通过",
      );
    process.exitCode = errors.length ? 1 : 0;
    return;
  }
  const maintenance = loadMaintenance(repo, "HEAD");
  const base = options.base ?? maintenance.ledger?.upstream?.commit;
  if (!base) throw new Error(`缺少上游基准：在 ${LEDGER_PATH} 填写 upstream.commit，或传 --base`);
  const context = classify(repo, base, "HEAD");
  const claims = createClaims(maintenance);
  let output;
  if (options.paths.length)
    output = options.paths.map((path) => describePath(context, claims, path));
  else if (options.upstream)
    output = previewUpstream(context, claims, maintenance.ledger, options.upstream);
  else if (options.list) {
    if (!CATEGORIES.includes(options.list)) throw new Error(`未知分类：${options.list}`);
    output = [...context.result]
      .filter(
        ([path, { category }]) =>
          category === options.list && (!options.unclaimed || !claims(path).length),
      )
      .map(([path, info]) => ({ path, ...info, claims: claims(path) }));
  } else {
    const rows = summarize(context, claims);
    if (options.format) {
      const noise = findFormatNoise(context) ?? [];
      rows.get("upstream-format").total = noise.length;
      rows.get("upstream-modified").total -= noise.length;
    }
    output = {
      base,
      version: maintenance.ledger?.upstream?.version,
      categories: Object.fromEntries(rows),
    };
  }
  if (options.json) return console.log(JSON.stringify(output, null, 2));
  printHuman(output, options);
}

function printHuman(output, options) {
  const claimText = (claims) =>
    claims.length ? claims.map((claim) => claim.id).join(", ") : "未认领";
  if (options.paths.length) {
    for (const item of output) {
      console.log(`${item.path}`);
      console.log(
        `  分类：${item.category}${item.movedTo ? ` → ${item.movedTo}` : ""}${item.movedFrom ? ` ← ${item.movedFrom}` : ""}`,
      );
      console.log(
        `  上游：${item.firstUpstream ? `首次出现于 ${item.firstUpstream}，最后出现于 ${item.lastUpstream}${item.inBase ? "（当前基准仍有）" : "（上游已删除）"}` : "上游从未出现"}`,
      );
      console.log(`  认领：${claimText(item.claims)}`);
      if (item.markers.length) console.log(`  标记：${item.markers.join(", ")}`);
      if (item.variant) console.log(`  OpenZWork 版本：${item.variant}`);
      if (item.variantOf) console.log(`  上游原文：${item.variantOf}`);
    }
  } else if (options.upstream) {
    console.log(
      `目标 ${output.target.slice(0, 12)}（${output.version}），上游改动 ${output.changes} 个文件`,
    );
    if (!output.baseMatches)
      console.log(`注意：合并基 ${output.mergeBase.slice(0, 12)} 与台账基准不一致`);
    console.log(`\n冲突 ${output.conflicts.length} 个：`);
    for (const item of output.conflicts)
      console.log(`  ${item.path}  [${item.category}]  ${claimText(item.claims)}`);
    console.log(`\n上游修改了我方已删除的文件 ${output.modifiedAfterRemoval.length} 个：`);
    for (const item of output.modifiedAfterRemoval)
      console.log(`  ${item.path}  ${claimText(item.claims)}`);
    console.log(`\n上游新增文件落在裁剪路径内 ${output.addedInDropPaths.length} 个：`);
    for (const item of output.addedInDropPaths) console.log(`  ${item.path}  ${item.id}`);
    console.log(`\n上游改动涉及的台账条目 ${output.touchedEntries.length} 个：`);
    for (const item of output.touchedEntries)
      console.log(
        `  ${item.id}: ${item.paths.slice(0, 8).join(", ")}${item.paths.length > 8 ? ` 等 ${item.paths.length} 个` : ""}`,
      );
  } else if (options.list) {
    for (const item of output) console.log(`${item.path}  ${claimText(item.claims)}`);
    console.log(`共 ${output.length} 个`);
  } else {
    console.log(`上游基准 ${output.version}（${output.base.slice(0, 12)}）`);
    console.log("分类                 文件数   已认领");
    for (const [category, { total, claimed }] of Object.entries(output.categories)) {
      console.log(
        `${category.padEnd(20)} ${String(total).padStart(6)}   ${category === "upstream" ? "-" : claimed}`,
      );
    }
    if (!options.format) console.log("（upstream-format 需加 --format 才会计算）");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
