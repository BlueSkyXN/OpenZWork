import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const desktopDir = resolve(repoRoot, "packages/desktop");
const pendingSpec =
  "./packages/desktop/test/e2e/plugins/manual-review/pending/plugin-admission-pending-fixture.test.ts";
const manualOnlySpec =
  "./packages/desktop/test/e2e/plugins/manual-review/pending/plugin-admission-never-fixture.test.ts";
const fixtureCheckCase = "plugin-fixture-check-probe";
const formalProbeSpec = resolve(desktopDir, "test/e2e/plugins", `${fixtureCheckCase}.test.ts`);
const formalProbeFixture = resolve(
  desktopDir,
  "test/e2e/fixtures/upstream/plugin-management",
  `${fixtureCheckCase}.json`,
);
const formalProbeManifest = resolve(
  desktopDir,
  "test/e2e/fixtures/cases/plugins",
  `${fixtureCheckCase}.json`,
);

// fork 保留我方 beforeAll：同时合成 pending 与 manual-only 两个准入探针（上游 manual-only 探针
// plugin-cdn-zip-official-cdn-smoke 依赖官方 CDN 域，我方树中不存在，须由测试自行合成）。
const createdAdmissionFiles: string[] = [];
beforeAll(() => {
  for (const [spec, never] of [[pendingSpec, false], [manualOnlySpec, true]] as const) {
    const caseName = spec.split("/").at(-1)!.replace(".test.ts", "");
    const files = [resolve(repoRoot, spec), resolve(desktopDir, "test/e2e/fixtures/upstream/plugin-management", caseName + ".json"), resolve(desktopDir, "test/e2e/fixtures/cases/plugins", caseName + ".json")];
    writeProbeFile(files[0]!, "// synthetic admission fixture");
    writeProbeFile(files[1]!, JSON.stringify({ version: 1, fixtures: [] }));
    writeProbeFile(files[2]!, JSON.stringify({ caseName, formalAdmission: never ? "never" : "reviewed" }));
    createdAdmissionFiles.push(...files);
  }
  writeProbeFile(formalProbeSpec, 'describe("E2E_PLUGIN_FIXTURE_CHECK_PROBE", () => {});\n');
  writeProbeFile(    formalProbeFixture,
    `${JSON.stringify(
      {
        version: 1,
        // 修复原因：pending 与 formal 共用 canonical fixture identity，probe 也必须模拟完整合同。
        caseName: fixtureCheckCase,
        spec: `./test/e2e/plugins/${fixtureCheckCase}.test.ts`,
        fixtures: [
          {
            id: fixtureCheckCase,
            match: {
              method: "POST",
              pathIncludes: "/messages",
              bodyIncludes: ["E2E_PLUGIN_FIXTURE_CHECK_PROBE"],
            },
            response: { statusCode: 200, text: "ok" },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  await writeProbeFile(
    formalProbeManifest,
    `${JSON.stringify(
      {
        version: 1,
        caseName: fixtureCheckCase,
        spec: `./test/e2e/plugins/${fixtureCheckCase}.test.ts`,
        providerFixtures: [
          "./test/e2e/fixtures/upstream/common.json",
          `./test/e2e/fixtures/upstream/plugin-management/${fixtureCheckCase}.json`,
        ],
        requests: [
          {
            id: fixtureCheckCase,
            kind: "main",
            source: "synthetic",
            syntheticReason:
              "Exercise plugin fixture-check routing without a promoted product case.",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  // 候选已经转正时，准入测试仍使用自己的 pending fixture，不能依赖产品文件的审核状态。
  await writeProbeFile(
    resolve(repoRoot, pendingSpec),
    'describe("E2E_PLUGIN_FIXTURE_CHECK_PROBE", () => {});\n',
  );
  for (const file of [formalProbeFixture, formalProbeManifest]) {
    await writeProbeFile(
      file.replace(fixtureCheckCase, "plugin-promotion-check-probe"),
      (await readFile(file, "utf8")).replaceAll(fixtureCheckCase, "plugin-promotion-check-probe"),
    );
  }
});

afterAll(() => {
  for (const file of createdAdmissionFiles) rmSync(file, { force: true });
  rmSync(formalProbeSpec, { force: true });
  rmSync(formalProbeFixture, { force: true });
  rmSync(formalProbeManifest, { force: true });});

describe("plugin lifecycle E2E admission scripts", () => {
  it("dry-runs promotion but requires explicit human review before applying", () => {
    const dryRun = runScript("promote-plugin-e2e.mjs", ["--spec", pendingSpec]);
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).toContain("Dry run plugin E2E promotion");
    expect(dryRun.stdout).toContain(
      "Do not apply until screenshots and behavior have passed human review",
    );

    const unreviewedApply = runScript("promote-plugin-e2e.mjs", ["--spec", pendingSpec, "--apply"]);
    expect(unreviewedApply.status).toBe(1);
    expect(unreviewedApply.stdout).toContain("Use --reviewed when applying plugin promotion");
  });

  it("rejects Docker admission for a pending manual-review spec", () => {
    const result = runScript("admit-plugin-e2e-docker.mjs", ["--spec", pendingSpec]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Spec must be a promoted formal plugin case");
  });

  it("routes promoted plugin specs to plugin case manifests and fixtures", () => {
    const result = runScript("check-e2e-fixtures.mjs", ["--spec", formalProbeSpec]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Case: ${fixtureCheckCase}`);
    expect(result.stdout).toContain("Fixture check passed");
  });

  it("never promotes the real official CDN manual smoke", () => {
    const result = runScript("promote-plugin-e2e.mjs", ["--spec", manualOnlySpec, "--reviewed"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("manual-only and cannot be promoted");
  });
});

function runScript(scriptName: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [resolve(repoRoot, "packages/desktop/scripts", scriptName), ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  );
}

async function writeProbeFile(path: string, content: string): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, content, "utf-8");
}
