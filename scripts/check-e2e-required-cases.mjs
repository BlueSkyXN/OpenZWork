#!/usr/bin/env node
// OW-P024：桌面 E2E 的目标用例门禁。
//
// 背景（REVIEW-3 B）：ci.yml 的 `--mochaOpts.grep '已保存工作流中枢 E2E'` 只匹配旧
// CRUD describe，新增的三个场景从未在 CI 运行，但 job 仍然显示成功——因为 wdio 的退出
// 码只反映「被收集到的用例」，漏选不算失败。这个脚本改成按本轮真实报告核对：
// 目标用例必须出现在 `summary.json` 的 tests.results 里，且状态为 passed。
//
// 覆盖不到的用例一律失败：缺失（grep 漏选）、跳过、失败、报告缺失。
// 只核对本清单内的用例，其它用例（例如既有失败欠账）不参与判定，因此将来增加用例
// 不会把 job 误判为失败。
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 本任务必须真实运行并通过的目标用例。
 * `title` 必须是 spec 里 `it(...)` 的标题原文：wdio 报告行只带 `it` 标题，不带
 * describe 链（见本文件顶部说明）；`describe` 只用于人读定位，不参与匹配。
 */
export const REQUIRED_E2E_CASES = [
  {
    id: "hub-crud",
    describe: "已保存工作流中枢 E2E",
    label: "原 CRUD：预置工作流可见、改说明、删除回空态",
    title: "预置的工作流可见，改说明只重写 frontmatter，删除后回到空态",
  },
  {
    id: "runs-error-retry",
    describe: "工作流中枢错误与刷新竞态 E2E（OW-P024 R4）",
    label: "历史失败→错误可见→重试→新历史出现、错误消失",
    title: "历史读取失败→错误可见→重试→新历史出现、错误消失",
  },
  {
    id: "stale-refresh",
    describe: "工作流中枢错误与刷新竞态 E2E（OW-P024 R4）",
    label: "倒序刷新：新请求 B 先完成，旧请求 A 后返回不得覆盖",
    title: "倒序刷新：新请求 B 先完成显示新内容，旧请求 A 最后返回不得覆盖",
  },
  {
    id: "overview-50",
    describe: "工作流总览 50 项目渲染与刷新 E2E（OW-P024 R4）",
    label: "50 项目总览渲染与刷新收敛",
    title: "50 个项目组全部渲染并完成读取；刷新后全部收敛",
  },
  {
    id: "global-runs-error-retry",
    describe: "全局工作流列表错误与重试 E2E（OW-P024 R4）",
    label: "全局组有旧历史时刷新失败→错误与旧徽标可见→重试后错误消失",
    title: "全局组有旧历史时刷新失败：错误与旧徽标同时可见，重试后错误消失",
  },
];

function normalize(text) {
  return String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * 匹配报告行：wdio 报告里的 `fullTitle` 只是 `it` 的标题（不含 describe 链），
 * 所以清单按 `it` 标题唯一匹配；同时兼容带 describe 前缀的形态（前缀越精确越好）。
 */
export function findResult(results, testTitle) {
  const wanted = normalize(testTitle);
  return (
    results.find((result) => {
      const actual = normalize(result.fullTitle ?? result.title);
      return actual === wanted || actual.endsWith(` ${wanted}`);
    }) ?? null
  );
}

export function auditRequiredCases(summary, required = REQUIRED_E2E_CASES) {
  const results = summary?.tests?.results;
  if (!Array.isArray(results)) {
    return {
      ok: false,
      missing: required.map((item) => item.id),
      problems: ["报告缺少 tests.results"],
    };
  }
  const missing = [];
  const problems = [];
  for (const item of required) {
    const result = findResult(results, item.title);
    if (!result) {
      missing.push(item.id);
      continue;
    }
    // 报告里有被跳过的用例：wdio 记为 status=skipped（可能仍带 passed=true），必须判失败。
    const status = String(result.status ?? "").toLowerCase();
    if (status === "skipped" || status === "pending") {
      problems.push(`${item.id}: 被跳过（status=${status}）`);
    } else if (result.passed !== true) {
      problems.push(
        `${item.id}: 未通过（status=${status || "unknown"}${result.error ? `; ${result.error}` : ""}）`,
      );
    }
  }
  return { ok: missing.length === 0 && problems.length === 0, missing, problems };
}

async function resolveSummaryPath(input) {
  const target = resolve(input);
  const targetInfo = await stat(target).catch(() => null);
  if (!targetInfo) return null;
  if (targetInfo.isDirectory()) {
    // 直接指向一次运行的产物目录。
    const direct = resolve(target, "summary.json");
    if ((await stat(direct).catch(() => null))?.isFile()) return direct;
    // 产物根目录（`.e2e-artifacts`）：取最近一次运行的 summary.json。
    const entries = await readdir(target, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const summary = resolve(target, entry.name, "summary.json");
      const info = await stat(summary).catch(() => null);
      if (info?.isFile()) candidates.push({ summary, mtimeMs: info.mtimeMs });
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return candidates[0]?.summary ?? null;
  }
  return targetInfo.isFile() ? target : null;
}

async function main(argv) {
  const input = argv[2] ?? process.env.ZCODE_E2E_SUMMARY_JSON;
  if (!input) {
    console.error("[e2e-required-cases] 缺少 summary.json 路径（参数或 ZCODE_E2E_SUMMARY_JSON）");
    return 2;
  }
  const summaryPath = await resolveSummaryPath(input);
  if (!summaryPath) {
    console.error(`[e2e-required-cases] 找不到 E2E 报告（${input}）——目标用例没有运行`);
    return 2;
  }
  let summary;
  try {
    summary = JSON.parse(await readFile(summaryPath, "utf8"));
  } catch (error) {
    console.error(
      `[e2e-required-cases] 读不到 E2E 报告 ${summaryPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }

  const { ok, missing, problems } = auditRequiredCases(summary);
  const passedCount = summary?.tests?.passed ?? "?";
  const totalCount = summary?.tests?.total ?? "?";
  console.log(
    `[e2e-required-cases] 报告 ${summaryPath}: ${passedCount}/${totalCount} 通过（目标用例 ${REQUIRED_E2E_CASES.length} 项）`,
  );
  for (const item of REQUIRED_E2E_CASES) {
    const result = findResult(summary?.tests?.results ?? [], item.title);
    const mark = result?.passed === true ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${item.id} — ${item.label}`);
  }
  if (missing.length > 0) {
    console.error(
      `[e2e-required-cases] 目标用例未出现在报告里（grep 漏选？）: ${missing.join(", ")}`,
    );
  }
  for (const problem of problems) console.error(`[e2e-required-cases] ${problem}`);
  if (!ok) {
    console.error("[e2e-required-cases] 目标 E2E 未全部真实通过");
    return 1;
  }
  console.log("[e2e-required-cases] 目标 E2E 全部通过");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv);
}
