import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseDocument } from "yaml";

const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
const extended = parseDocument(
  await readFile(
    new URL(".github/workflows/extended-checks.yml", root),
    "utf8",
  ),
).toJS();

test("application typecheck retains Main, remote Main and shared testing", () => {
  const command = manifest.scripts.typecheck;
  for (const target of [
    "packages/desktop/tsconfig.main.json",
    "packages/desktop/tsconfig.remote-main.json",
    "packages/shared/tsconfig.testing.json",
  ])
    assert.ok(command.includes(target), target);
  assert.equal(command.includes("tsconfig.e2e.json"), false);
  assert.equal(command.includes("packages/zcode-cua"), false);
});

test("historical E2E types keep a real independent failure and diagnostic artifact", () => {
  const audit = extended.jobs["desktop-main-audit"];
  assert.equal(audit.needs, undefined);
  assert.equal(audit["continue-on-error"], undefined);
  const check = audit.steps.find((step) => step.id === "e2e_audit");
  assert.ok(check.run.includes("tsc -p packages/desktop/tsconfig.e2e.json"));
  assert.equal(check["continue-on-error"], undefined);
  assert.ok(check.if.includes("always()"));
  const upload = audit.steps.find(
    (step) => step.with?.name === "desktop-e2e-diagnostics",
  );
  assert.ok(upload.if.includes("always()"));
  assert.equal(upload.with.path, ".run-logs/desktop-e2e-typecheck.log");
  assert.equal(upload.with["if-no-files-found"], "error");
});

test("pre-push uses the core suite while historical tests remain an independent workflow", () => {
  assert.ok(
    manifest.scripts["verify:pre-push"].includes("pnpm run test:ci:core"),
  );
  assert.equal(
    manifest.scripts["verify:pre-push"].includes("test:unit:affected"),
    false,
  );
  const historical = extended.jobs["historical-tests"];
  assert.equal(historical.needs, undefined);
  assert.equal(historical["continue-on-error"], undefined);
  // 2026-10-20：全量套件改为分组执行（组级时限 + 逐组 JSON），入口不再是单条 vitest 命令。
  assert.ok(
    historical.steps.some(
      (step) => step.run === "node .ci-tools/scripts/run-full-suite-groups.mjs --shard=${{ matrix.shard }}",
    ),
  );
});
