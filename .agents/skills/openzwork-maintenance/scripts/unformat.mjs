#!/usr/bin/env node
// 恢复被整文件格式化或被改写了空白的上游文件：换回上游排版，只保留实质改动。
// 每个结果都要通过等价证明（恢复结果与当前文件分别格式化后逐字节一致）才会被采用。
// 方法与取舍见 ../references/code-boundary/GUIDE.md「恢复被整文件格式化的上游文件」。
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  classify,
  countLineDiff,
  createOxfmtFormatter,
  gitText,
  lineDiff,
  loadMaintenance,
  measureFormatNoise,
  readTree,
} from "./scan.mjs";

const DATA_FILE = /\.(?:ya?ml|json)$/;
const lines = (text) => text.split("\n");

/** 差异块 [左起点, 左行数, 右起点, 右行数]；起点为 0 基，行数为 0 时起点表示插入位置。 */
function hunks(a, b, extra = []) {
  return [
    ...lineDiff(a, b, ["-U0", ...extra]).matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm),
  ].map((match) => {
    const leftLength = match[2] === undefined ? 1 : Number(match[2]);
    const rightLength = match[4] === undefined ? 1 : Number(match[4]);
    return [
      leftLength === 0 ? Number(match[1]) : Number(match[1]) - 1,
      leftLength,
      rightLength === 0 ? Number(match[3]) : Number(match[3]) - 1,
      rightLength,
    ];
  });
}

/** 三方合并：以格式化后的上游为公共祖先，把实质改动合并到上游原文上；冲突处保留当前文件的写法。 */
function mergeRestore(base, formattedBase, head) {
  const dir = mkdtempSync(join(tmpdir(), "openzwork-unformat-"));
  try {
    writeFileSync(join(dir, "ours"), head);
    writeFileSync(join(dir, "base"), formattedBase);
    writeFileSync(join(dir, "theirs"), base);
    return spawnSync(
      "git",
      ["merge-file", "-p", "--ours", join(dir, "ours"), join(dir, "base"), join(dir, "theirs")],
      { maxBuffer: 1 << 28 },
    ).stdout.toString("utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 分段换回：格式化后的上游中我方没有动过的段，换回它对应的上游原文段。改动紧挨格式变化时比三方合并切得细。 */
function blockRestore(base, formattedBase, head) {
  const baseLines = lines(base);
  const formattedLines = lines(formattedBase);
  const headLines = lines(head);
  const formatBlocks = hunks(base, formattedBase).map(([bs, bl, fs, fl]) => ({ bs, bl, fs, fl }));
  const out = [];
  const emitUntouched = (from, to) => {
    let cursor = from;
    for (const block of formatBlocks) {
      const inside =
        block.fl > 0
          ? block.fs >= from && block.fs + block.fl <= to
          : block.fs > from && block.fs < to;
      if (!inside || block.fs < cursor) continue;
      out.push(
        ...formattedLines.slice(cursor, block.fs),
        ...baseLines.slice(block.bs, block.bs + block.bl),
      );
      cursor = block.fs + block.fl;
    }
    out.push(...formattedLines.slice(cursor, to));
  };
  let cursor = 0;
  for (const [fs, fl, hs, hl] of hunks(formattedBase, head)) {
    emitUntouched(cursor, fs);
    out.push(...headLines.slice(hs, hs + hl));
    cursor = fs + fl;
  }
  emitUntouched(cursor, formattedLines.length);
  return out.join("\n");
}

/** 空白对齐：上游原文与当前文件只差空白的行用上游原文，其余用当前文件。 */
function whitespaceRestore(base, head) {
  const baseLines = lines(base);
  const headLines = lines(head);
  const out = [];
  let cursor = 0;
  for (const [bs, bl, hs, hl] of hunks(base, head, ["-w"])) {
    out.push(...baseLines.slice(cursor, bs), ...headLines.slice(hs, hs + hl));
    cursor = bs + bl;
  }
  out.push(...baseLines.slice(cursor));
  return out.join("\n");
}

/**
 * 为给定路径（默认全部被修改的上游文件）计算恢复方案。
 * 返回有格式噪声的文件 { path, raw, real, noise, after, how, text }；没有可采用的方案时 how 为 undefined。
 */
export function planRestore(context, formatter, paths) {
  const { baseTree, headTree, blobs, result } = context;
  const text = (path, tree) => blobs.get(tree.get(path).blob);
  const wanted = paths?.length ? new Set(paths) : undefined;
  const files = [...result]
    .filter(
      ([path, { category }]) => category === "upstream-modified" && (!wanted || wanted.has(path)),
    )
    .map(([path]) => path)
    .filter((path) => !text(path, baseTree).includes(0) && !text(path, headTree).includes(0));
  const base = files.map((path) => text(path, baseTree).toString("utf8"));
  const head = files.map((path) => text(path, headTree).toString("utf8"));
  const formatted = formatter(
    files.flatMap((path, index) => [
      { path, text: base[index] },
      { path, text: head[index] },
    ]),
  );
  const rows = [];
  files.forEach((path, index) => {
    const formattedBase = formatted[index * 2];
    const formattedHead = formatted[index * 2 + 1];
    if (formattedBase === base[index] && formattedHead === head[index]) return;
    const measured = measureFormatNoise({
      base: base[index],
      head: head[index],
      formattedBase,
      formattedHead,
    });
    if (measured.noise === 0) return;
    rows.push({
      path,
      index,
      formattedHead,
      ...measured,
      candidates: [
        { how: "三方合并", text: mergeRestore(base[index], formattedBase, head[index]) },
        { how: "分段换回", text: blockRestore(base[index], formattedBase, head[index]) },
        { how: "空白对齐", text: whitespaceRestore(base[index], head[index]) },
      ],
    });
  });
  const flat = rows.flatMap((row) => row.candidates.map((candidate) => ({ row, candidate })));
  const reformatted = formatter(
    flat.map(({ row, candidate }) => ({ path: row.path, text: candidate.text })),
  );
  flat.forEach(({ row, candidate }, index) => {
    const after = countLineDiff(base[row.index], candidate.text);
    // 等价证明：恢复结果与当前文件分别格式化后逐字节一致，说明两者只差排版。
    const equivalent = reformatted[index] === row.formattedHead;
    // 恢复掉的行数不得超过实测噪声：超过说明把我方包了一层的代码的缩进也换回去了。
    // 数据文件缩进即语义，等价证明已经足够。
    const bounded = DATA_FILE.test(row.path) || row.raw - after <= row.noise;
    Object.assign(candidate, { after, valid: equivalent && bounded && after < row.raw });
  });
  return rows.map(({ path, raw, real, noise, candidates }) => {
    const best = candidates.filter(({ valid }) => valid).sort((a, b) => a.after - b.after)[0];
    return { path, raw, real, noise, after: best?.after ?? raw, how: best?.how, text: best?.text };
  });
}

/** 核对 rev 到 HEAD 之间改过的上游文件只改了排版：改动前后分别格式化后逐字节一致。返回不一致的路径。 */
export function verifyFormatOnly(repo, rev, formatter, base) {
  // 无效提交曾让 git diff 失败后返回空 stdout，误报为“核对 0 个文件，通过”。
  const commit = (ref) =>
    gitText(repo, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
  const from = commit(rev);
  const head = commit("HEAD");
  const baseTree = readTree(repo, commit(base));
  const changed = gitText(repo, ["diff", "--name-only", "--no-renames", "-z", from, head, "--"])
    .split("\0")
    .filter(Boolean)
    .filter((path) => baseTree.has(path));
  const inputs = changed.flatMap((path) => [
    { path, text: gitText(repo, ["show", `${from}:${path}`]) },
    { path, text: gitText(repo, ["show", `${head}:${path}`]) },
  ]);
  const formatted = formatter(inputs);
  return {
    checked: changed.length,
    mismatched: changed.filter((_, index) => formatted[index * 2] !== formatted[index * 2 + 1]),
  };
}

/** 先核对全部恢复目标，再写入；未提交的内容由工作区和暂存区保留。 */
export async function applyRestore(repo, rows, expectedHead) {
  if (gitText(repo, ["rev-parse", "HEAD"]).trim() !== expectedHead)
    throw new Error("HEAD 已变化，请重新运行恢复命令计算方案");
  const targets = rows.filter(({ how }) => how);
  if (!targets.length) return;
  // 方案来自 HEAD，直接写回会丢失目标的未提交修改。一次检查所有目标，避免先写一部分再失败。
  const dirty = gitText(repo, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=no",
    "--",
    ...targets.map(({ path }) => `:(literal)${path}`),
  ]);
  if (dirty)
    throw new Error(
      `目标文件存在未提交改动，请先保存并提交后再恢复：\n${dirty.split("\0").filter(Boolean).join("\n")}`,
    );
  for (const { path, text } of targets) await writeFile(join(repo, path), text);
}

const HELP = `用法：node .agents/skills/openzwork-maintenance/scripts/unformat.mjs [选项] [路径…]
  （无选项）        列出有格式噪声的上游文件和可恢复到的差异行数，不写文件
  --apply           把通过等价证明的恢复结果写入工作区
  --verify <提交>   核对该提交到 HEAD 之间改过的上游文件只改了排版
以已提交的 HEAD 为准；未指定路径时处理全部被修改的上游文件。
--apply 拒绝覆盖有暂存或未暂存改动的目标文件。`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) return console.log(HELP);
  const verifyAt = argv.indexOf("--verify");
  const rev = verifyAt >= 0 ? argv[verifyAt + 1] : undefined;
  if (verifyAt >= 0 && !rev) throw new Error("--verify 需要一个提交");
  const apply = argv.includes("--apply");
  const paths = argv.filter(
    (arg, index) => !arg.startsWith("--") && !(verifyAt >= 0 && index === verifyAt + 1),
  );
  const top = gitText(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const formatter = createOxfmtFormatter(top);
  if (!formatter) throw new Error("找不到 oxfmt；先执行 pnpm install");
  const base = loadMaintenance(top).ledger?.upstream?.commit;
  if (!base) throw new Error("台账缺少 upstream.commit");
  if (rev) {
    const { checked, mismatched } = verifyFormatOnly(top, rev, formatter, base);
    for (const path of mismatched) console.log(`不只是排版：${path}`);
    console.log(`核对了 ${checked} 个上游文件，${mismatched.length} 个不只是排版`);
    process.exitCode = mismatched.length ? 1 : 0;
    return;
  }
  const head = gitText(top, ["rev-parse", "HEAD"]).trim();
  const rows = planRestore(classify(top, base, head), formatter, paths);
  if (apply) await applyRestore(top, rows, head);
  let restored = 0;
  for (const row of rows.sort((a, b) => b.raw - b.after - (a.raw - a.after))) {
    console.log(
      `${String(row.raw).padStart(5)} → ${String(row.after).padStart(5)} 行  噪声 ${String(row.noise).padStart(4)}  ${row.how ?? "保持现状"}  ${row.path}`,
    );
    if (!row.how) continue;
    restored++;
  }
  console.log(
    `有格式噪声的上游文件 ${rows.length} 个，可恢复 ${restored} 个${apply ? "，已写入工作区" : "（加 --apply 写入）"}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
