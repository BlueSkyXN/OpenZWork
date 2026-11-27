// OpenZWork 维护门禁：台账、上游文档原文与 OpenZWork 版本登记、经验库与上游文件格式噪声。
// 规则见 docs/openzwork/maintenance-model.md；需要完整 Git 历史（上游基准提交）与已安装的 oxfmt。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyIdentity,
  classify,
  loadCiTests,
  runCheck,
} from "../../.agents/skills/openzwork-maintenance/scripts/scan.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const trimFormatter = (files) => files.map(({ text }) => text.replace(/[ \t]+$/gm, ""));

test("夹具家目录下的用户数据库沿用 OpenZWork 根，项目目录保留自己的配置", () => {
  for (const file of ["cli/db/db.sqlite", "v2/tasks-index.sqlite"]) {
    assert.equal(
      applyIdentity(`join(fixture.home, ".zcode/${file}")`),
      `join(fixture.home, ".openzwork/${file}")`,
    );
    const project = `join(workspace, ".zcode/${file}")`;
    assert.equal(applyIdentity(project), project);
  }
});

test("loadCiTests 与 runCheck 排除 run-repo-script-tests.mjs 过滤的工程 Vitest 文件", () => {
  const dir = mkdtempSync(join(tmpdir(), "openzwork-ci-guard-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  const write = (relPath, text) => {
    mkdirSync(dirname(join(dir, relPath)), { recursive: true });
    writeFileSync(join(dir, relPath), text);
  };
  const commit = (msg) => {
    git("add", "-A", "--force");
    git("commit", "-q", "--no-verify", "-m", msg);
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q");
    git("config", "user.email", "scan-test@example.invalid");
    git("config", "user.name", "scan-test");
    git("config", "commit.gpgsign", "false");
    write("package.json", JSON.stringify({ version: "1.0.0" }));
    write("architecture-policy.yaml", "version: 1\nmodules:\n  - id: upstream\n    roots: [src]\n");
    write(".github/workflows/ci.yml", "jobs: {}\n");
    write("src/keep.ts", "export const keep = 1;\n");
    const base = commit("upstream 1.0.0");

    git("checkout", "-q", "-b", "fork");
    write(
      "package.json",
      JSON.stringify({
        version: "1.0.0+openzwork.1",
        scripts: {
          "test:repo-scripts":
            "node scripts/run-repo-script-tests.mjs --test-concurrency=1 scripts/test/*.test.mjs",
        },
      }),
    );
    write(
      ".github/workflows/ci.yml",
      [
        "name: CI",
        "jobs:",
        "  checks:",
        "    steps:",
        "      - name: scripts",
        '        run: "pnpm test:repo-scripts"',
        '      - run: "pnpm exec wdio --spec samples/filtered.test.ts --mochaOpts.grep one"',
        "  manual:",
        "    if: github.event_name == 'workflow_dispatch'",
        "    steps:",
        '      - run: "pnpm exec vitest run samples/manual.test.ts"',
      ].join("\n"),
    );
    write("src/feat.ts", "export const feat = 1;\n");
    write("scripts/test/node-runner.test.mjs", "export {};\n");
    write("scripts/test/eng-only.test.mjs", "export {};\n");
    write(
      "scripts/engineering-test-files.json",
      JSON.stringify(["scripts/test/eng-only.test.mjs"]),
    );
    write("tests/ci/core-tests.json", JSON.stringify({ version: 1, suites: [] }));
    write("docs/openzwork/upstream/v1.0.0-integration.md", "# 1.0.0\n");
    write(
      "docs/openzwork/README.md",
      "# 索引\n\n## 与上游的差异\n\n- OZ-F001、OZ-F002\n\n## 维护\n",
    );
    write("docs/openzwork/upstream-doc-variants.yaml", "version: 1\nvariants: []\n");
    for (const kind of ["pitfall", "diff", "decision"]) {
      const file = kind === "diff" ? "diff.yaml" : `${kind}s.yaml`;
      write(
        `.agents/skills/openzwork-maintenance/knowledge/${file}`,
        `version: 1\nkind: ${kind}\nentries: []\n`,
      );
    }
    write(
      "docs/openzwork/ledger.yaml",
      [
        "version: 1",
        "upstream:",
        "  version: 1.0.0",
        `  commit: ${base}`,
        "entries:",
        "  - id: OZ-F001",
        "    kind: feature",
        "    status: active",
        "    title: 维护体系",
        "    summary: 维护门禁。",
        '    paths: ["docs/openzwork/**", ".agents/skills/openzwork-maintenance/**", "scripts/engineering-test-files.json", "tests/**"]',
        '    tests: ["scripts/test/node-runner.test.mjs"]',
        "    source: 测试",
        "  - id: OZ-F002",
        "    kind: feature",
        "    status: active",
        "    title: 示例功能",
        "    summary: 仅登记被过滤的工程测试。",
        '    paths: ["src/feat.ts"]',
        '    tests: ["scripts/test/eng-only.test.mjs"]',
        "    source: 测试",
        "",
      ].join("\n"),
    );
    commit("engineering test excluded");

    const ci = loadCiTests(classify(dir, base));
    assert.equal(ci.runs("samples/filtered.test.ts"), false);
    assert.equal(ci.runs("samples/manual.test.ts"), false);
    assert.equal(ci.runs("scripts/test/node-runner.test.mjs"), true);
    assert.equal(ci.runs("scripts/test/eng-only.test.mjs"), false);
    assert.match(
      runCheck(dir, { formatter: trimFormatter }).join("\n"),
      /OZ-F002: 没有核心 CI 中运行的保证/,
    );

    write(
      "tests/ci/core-tests.json",
      JSON.stringify({
        version: 1,
        suites: [{ capability: "eng", files: ["scripts/test/eng-only.test.mjs"] }],
      }),
    );
    commit("engineering test added to core-tests.json");
    assert.deepEqual(runCheck(dir, { formatter: trimFormatter }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("OpenZWork 维护门禁通过", () => {
  const errors = runCheck(root);
  assert.deepEqual(errors, [], `维护门禁未通过（修复方法见各条说明）：\n${errors.join("\n")}`);
});
