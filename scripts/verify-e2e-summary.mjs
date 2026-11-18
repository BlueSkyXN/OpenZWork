#!/usr/bin/env node
// E2E 结果完整性门禁（CI-FIRST §3/H5）：从 runner 自己的 summary.json 核销「必需用例是否
// 真的收集并通过」。wdio 退出码只说明进程正常结束；summary 的 passRate 排除 skipped，
// 所以「一个 case 通过、另一个被 skip」也能凑出 passRate=1——这类报告必须被拒绝。
//
// 必需用例由调用方显式给出（workflow 里逐个点名 spec 与 case 标题片段），不采信报告自报的
// requestedSpecs：报告说什么被请求，不等于那些 case 真的跑了。
//
// 用法：
//   node scripts/verify-e2e-summary.mjs --summary <summary.json> --require <spec>=<caseTitle>…
//   node scripts/verify-e2e-summary.mjs --summary <summary.json> --require-file <json>
// require 文件形如 { "specs": [{ "spec": "./test/x.test.ts", "cases": ["WT04-1", "WT04-2"] }] }
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** 与 e2e-reporting 的 isSkippedResult 同口径：状态或 pending 语义视为未执行。 */
export function isSkipped(result) {
  const status = String(result?.status ?? "").toLowerCase();
  if (status === "skipped" || status === "pending" || status === "todo") return true;
  return result?.pending === true || result?.skipped === true;
}

function normalize(path) {
  return String(path ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "");
}

/**
 * 校验 summary 是否满足必需 spec/case 合同。
 * 返回 { ok, failures, coverage }，失败时逐条列出原因（供 CI 步骤直接报错）。
 */
export function verifyE2ESummary({ summary, required }) {
  const failures = [];
  const results = Array.isArray(summary?.tests?.results) ? summary.tests.results : [];
  const collected = new Set(results.map((result) => normalize(result.file)).filter(Boolean));

  if (summary?.exitCode !== 0) failures.push(`exitCode=${summary?.exitCode}`);
  if (results.length === 0) failures.push("0 collected tests");
  if ((summary?.tests?.failed ?? 0) > 0) failures.push(`failed=${summary.tests.failed}`);
  if ((summary?.stability?.infraFailureCount ?? 0) > 0)
    failures.push(`infra=${summary.stability.infraFailureCount}`);
  if ((summary?.stability?.flakyCount ?? 0) > 0)
    failures.push(`flaky=${summary.stability.flakyCount}`);
  // 必需集合里出现任何 skip 都不通过；非必需跳过另行说明，不在这里静默放行。
  const skipped = results.filter(isSkipped);
  if (skipped.length > 0)
    failures.push(
      `skipped=${skipped.length} (${skipped
        .map((result) => result.fullTitle ?? result.title ?? "<untitled>")
        .join(" | ")})`,
    );

  const coverage = [];
  for (const entry of required) {
    const spec = normalize(entry.spec);
    const specResults = results.filter((result) => normalize(result.file).endsWith(spec));
    const specSkipped = specResults.filter(isSkipped);
    const passedTitles = specResults
      .filter((result) => result.passed === true && !isSkipped(result))
      .map((result) => String(result.fullTitle ?? result.title ?? ""));
    const cases = entry.cases ?? [];
    const missingCases = cases.filter(
      (title) => !passedTitles.some((fullTitle) => fullTitle.includes(title)),
    );
    if (!collected.has(spec) && specResults.length === 0)
      failures.push(`${spec}: 0 collected (spec did not run)`);
    if (specResults.length > 0 && passedTitles.length === 0)
      failures.push(`${spec}: no passing case`);
    if (specSkipped.length > 0)
      failures.push(
        `${spec}: ${specSkipped.length} skipped case(s): ${specSkipped
          .map((result) => result.fullTitle ?? result.title ?? "<untitled>")
          .join(" | ")}`,
      );
    if (missingCases.length > 0)
      failures.push(`${spec}: missing required case(s): ${missingCases.join(", ")}`);
    coverage.push({
      spec,
      cases,
      collected: specResults.length,
      passed: passedTitles.length,
      skipped: specSkipped.length,
      missingCases,
    });
  }

  return { ok: failures.length === 0, failures, coverage };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const options = { required: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
    if (arg === "--summary" || arg.startsWith("--summary=")) {
      options.summaryPath = value;
      if (!arg.includes("=")) index += 1;
    } else if (arg === "--require-file" || arg.startsWith("--require-file=")) {
      options.requireFile = value;
      if (!arg.includes("=")) index += 1;
    } else if (arg === "--require" || arg.startsWith("--require=")) {
      const [spec, ...rest] = value.split("=");
      options.required.push({ spec, cases: rest.length ? rest.join("=").split(",") : [] });
      if (!arg.includes("=")) index += 1;
    }
  }
  if (!options.summaryPath) {
    console.error(
      "usage: node scripts/verify-e2e-summary.mjs --summary <summary.json> (--require <spec>=<case…> | --require-file <json>)",
    );
    process.exit(2);
  }
  if (options.requireFile) {
    const parsed = JSON.parse(await readFile(options.requireFile, "utf8"));
    options.required.push(...(parsed.specs ?? []));
  }
  const summary = JSON.parse(await readFile(options.summaryPath, "utf8"));
  const report = verifyE2ESummary({ summary, required: options.required });
  console.log(JSON.stringify({ ...report, runId: summary.runId }, null, 2));
  if (!report.ok) {
    console.error(`E2E summary incomplete: ${report.failures.join("; ")}`);
    process.exitCode = 1;
  }
}
