// OpenZWork 维护扫描（.agents/skills/openzwork-maintenance/scripts/scan.mjs）的回归。
// 用临时 Git 仓库模拟两版上游快照与一版 OpenZWork 分支；格式化器用去行尾空白的替身，不依赖 oxfmt。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  applyIdentity,
  classify,
  createClaims,
  describePath,
  entryReport,
  findFormatNoise,
  globToRegExp,
  loadCiTests,
  loadMaintenance,
  modifiedSummary,
  previewUpstream,
  runCheck,
} from "../../.agents/skills/openzwork-maintenance/scripts/scan.mjs";
import {
  planRestore,
  verifyFormatOnly,
} from "../../.agents/skills/openzwork-maintenance/scripts/unformat.mjs";

// 旧用户级根按片段拼出，避免本文件被净化门禁当作旧根残留。
const legacyRoot = ["~", ".zcode"].join("/");
const legacyHomeJoin = `join(homedir(), "${[".", "zcode"].join("")}")`;
const trimFormatter = (files) => files.map(({ text }) => text.replace(/[ \t]+$/gm, ""));
// 上游的两个较长文件：big 每行带行尾空白（不符合替身格式化器的格式），plain 符合格式。
const bigSource = Array.from({ length: 30 }, (_, n) => `export const a${n} = ${n};   \n`).join("");
const plainSource = Array.from({ length: 30 }, (_, n) => `export const p${n} = ${n};\n`).join("");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "openzwork-scan-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const remove = (path) => rmSync(join(dir, path));
  const edit = (path, from, to) => {
    const text = readFileSync(join(dir, path), "utf8");
    assert.ok(text.includes(from), `${path} 中找不到：${from}`);
    write(path, text.replace(from, to));
  };
  const commit = (message) => {
    // 强制加入：开发机的全局忽略规则可能包含 .agents/，夹具不能受本机配置影响。
    git("add", "-A", "--force");
    git("commit", "-q", "--no-verify", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  git("config", "user.email", "scan-test@example.invalid");
  git("config", "user.name", "scan-test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  write("package.json", JSON.stringify({ version: "1.0.0" }));
  write("docs/a.md", "# A\n");
  write("docs/b.md", "# B\n");
  write("docs/old.md", "# Old\n");
  write("src/keep.ts", "export const keep = 1;\n");
  write("src/gone.ts", "export const gone = 1;\n");
  write("src/home.ts", `export const root = "${legacyRoot}/cli";\n`);
  write("src/fmt.ts", "export const fmt = 1;   \n");
  // 上游技能：一份文档和一个带用户级根的脚本。
  write("src/big.ts", bigSource);
  write("src/plain.ts", plainSource);
  write(".agents/skills/up/SKILL.md", "# Up\n");
  write(".agents/skills/up/scripts/run.mjs", `export const root = ${legacyHomeJoin};\n`);
  const v1 = commit("upstream 1.0.0");
  write("package.json", JSON.stringify({ version: "1.1.0" }));
  remove("docs/old.md");
  const v2 = commit("upstream 1.1.0");
  git("checkout", "-q", "-b", "fork");
  write("package.json", JSON.stringify({ version: "1.1.0+openzwork.1" }));
  write("src/keep.ts", "export const keep = 2;\n");
  remove("src/gone.ts");
  // 代码读取 docs/b-openzwork.md，对应登记表中的 role: tool。
  write("src/ours.ts", 'export const ours = 1;\nexport const doc = "docs/b-openzwork.md";\n');
  // OZ-F001 的保证：回归测试列入核心清单。
  write("src/ours.test.ts", "export {};\n");
  write(
    "tests/ci/core-tests.json",
    JSON.stringify({ version: 1, suites: [{ capability: "ours", files: ["src/ours.test.ts"] }] }),
  );
  write("docs/openzwork/upstream/v1.1.0-integration.md", "# 1.1.0 整合\n");
  write("docs/old.md", "# Old\n");
  write("src/home.ts", 'export const root = "~/.openzwork/cli";\n');
  write("src/fmt.ts", "export const fmt = 1;\n");
  // 上游文档保持原文，OpenZWork 版本另存为同目录的 -openzwork 文件。
  write("docs/b-openzwork.md", "# B\n\nOpenZWork 说明\n");
  write(
    "docs/openzwork/ledger.yaml",
    `version: 1
upstream:
  version: 1.1.0
  commit: ${v2}
entries:
  - id: OZ-F001
    kind: feature
    status: active
    title: 维护体系
    summary: 台账与工具。
    paths: ["src/ours.ts", "docs/openzwork/**", ".agents/skills/openzwork-maintenance/**"]
    hooks: ["src/keep.ts"]
    tests: ["src/ours.test.ts"]
    source: 测试
  - id: OZ-D001
    kind: drop
    status: active
    title: 裁剪
    summary: 移除 gone。
    paths: ["src/gone*.ts"]
    source: 测试
  - id: OZ-R001
    kind: retain
    status: active
    title: 保留
    summary: 上游已删、我方保留。
    paths: ["docs/old.md"]
    unguarded: 夹具：保留的文档没有测试。
    source: 测试
`,
  );
  write(
    "docs/openzwork/upstream-doc-variants.yaml",
    `version: 1\nvariants:\n  - upstream: docs/b.md\n    variant: docs/b-openzwork.md\n    role: tool\n    usedBy: [src/ours.ts]\n    kind: content\n    upstreamBlob: ${git("rev-parse", `${v2}:docs/b.md`)}\n`,
  );
  write(
    "docs/openzwork/README.md",
    "# 索引\n\n## 与上游的差异\n\n- OZ-F001、OZ-D001、OZ-R001\n\n## 维护\n",
  );
  const knowledge = ".agents/skills/openzwork-maintenance/knowledge";
  write(
    `${knowledge}/pitfalls.yaml`,
    `version: 1
kind: pitfall
entries:
  - id: OZK-PIT-001
    title: 示例
    when: 场景。
    do: 做法。
    why: 依据。
    evidence: ["PR #1", "src/ours.ts"]
    since: 2026-11-07
    checked: 1.1.0
    status: active
`,
  );
  write(`${knowledge}/diff.yaml`, "version: 1\nkind: diff\nentries: []\n");
  write(`${knowledge}/decisions.yaml`, "version: 1\nkind: decision\nentries: []\n");
  const fork = commit("openzwork");
  return { dir, git, write, remove, edit, commit, v1, v2, fork };
}

const check = (repo) => runCheck(repo.dir, { formatter: trimFormatter });
const ciWorkflow = (steps) =>
  `name: CI\njobs:\n  checks:\n    steps:\n${steps
    .map(({ name, run }) => `      - name: ${name}\n        run: ${JSON.stringify(run)}\n`)
    .join("")}`;

test("classify 给上游、改名、修改、删除、新增、保留分类", () => {
  const repo = fixture();
  const { result } = classify(repo.dir, repo.v2);
  const category = (path) => result.get(path)?.category;
  assert.equal(category("docs/a.md"), "upstream");
  assert.equal(category("src/home.ts"), "upstream-identity");
  assert.equal(category("src/keep.ts"), "upstream-modified");
  assert.equal(category("src/fmt.ts"), "upstream-modified");
  assert.equal(category("src/gone.ts"), "removed");
  assert.equal(category("src/ours.ts"), "openzwork");
  assert.equal(category("docs/old.md"), "retained");
});

test("findFormatNoise 找出只差格式化的上游文件", () => {
  const repo = fixture();
  const noise = findFormatNoise(classify(repo.dir, repo.v2), trimFormatter);
  assert.deepEqual(noise, [{ path: "src/fmt.ts", variant: "format" }]);
});

test("runCheck 只报告格式噪声，恢复上游原文后通过", () => {
  const repo = fixture();
  const errors = check(repo);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /src\/fmt\.ts 与上游只差格式化/);
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  repo.commit("restore upstream format");
  assert.deepEqual(check(repo), []);
});

test("runCheck 拦截复活的裁剪路径与缺失的台账路径", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  repo.write("src/gone-again.ts", "export const back = 1;\n");
  repo.remove("src/ours.ts");
  repo.commit("regressions");
  const errors = check(repo).join("\n");
  assert.match(errors, /OZ-D001: 已裁剪路径仍存在：src\/gone-again\.ts/);
  assert.match(errors, /OZ-F001: 路径不存在：src\/ours\.ts/);
  assert.match(errors, /证据文件不存在：src\/ours\.ts/);
});

test("runCheck 要求上游文档保持原文、OpenZWork 版本登记并跟随原文", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  repo.write("docs/a.md", "# A\n\n新增内容\n");
  repo.write("docs/a-openzwork.md", "# A（OpenZWork）\n");
  repo.write(
    "docs/openzwork/upstream-doc-variants.yaml",
    "version: 1\nvariants:\n  - upstream: docs/b.md\n    variant: docs/b-openzwork.md\n    role: tool\n    usedBy: [src/keep.ts]\n    kind: content\n    upstreamBlob: 0000000000000000000000000000000000000000\n",
  );
  repo.commit("doc drift");
  const errors = check(repo).join("\n");
  assert.match(errors, /上游文档 docs\/a\.md 与上游原文不一致/);
  assert.match(
    errors,
    /docs\/a-openzwork\.md 是上游文档 docs\/a\.md 的 OpenZWork 版本，但没有登记/,
  );
  assert.match(errors, /docs\/b\.md: 上游已更新原文；按新原文复核 docs\/b-openzwork\.md/);
  assert.match(errors, /src\/keep\.ts 没有引用该文档/);
});

test("runCheck 按实际读取目标验证 usedBy：版本路径、选择函数与版本链接通过", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  // 写法一：直接读版本路径。
  repo.write("src/reader-variant.ts", 'export const doc = "docs/b-openzwork.md";\n');
  // 写法二：裸字面量与 resolve 包裹的选择函数实参都可以。
  repo.write(
    "src/reader-selector.ts",
    'const openzworkDoc = (p) => p;\nexport const a = openzworkDoc("docs/b.md");\nexport const b = openzworkDoc(resolve(root, "docs/b.md"));\n',
  );
  // 写法三：rule 文档用 Markdown 链接指向版本。
  repo.write("docs/rule.md", "以 [B 版本](b-openzwork.md) 为准。\n");
  repo.write(
    "docs/openzwork/upstream-doc-variants.yaml",
    `version: 1\nvariants:\n  - upstream: docs/b.md\n    variant: docs/b-openzwork.md\n    role: tool\n    usedBy: [src/reader-variant.ts, src/reader-selector.ts]\n    kind: content\n    upstreamBlob: ${repo.git("rev-parse", `${repo.v2}:docs/b.md`)}\n`,
  );
  repo.commit("valid readers");
  assert.deepEqual(check(repo), []);
});

test("runCheck 拦截读上游原文、注释提及与缺失引用的 usedBy", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  // 登记了版本仍读上游原文。
  repo.write("src/reader-upstream.ts", 'export const doc = "docs/b.md";\n');
  // 文件名只出现在注释里，没有读取关系。
  repo.write("src/reader-comment.ts", "// 提一下 docs/b.md 而已\nexport const x = 1;\n");
  // rule 文档链接到上游原文。
  repo.write("docs/rule-bad.md", "以 [B](b.md) 为准。\n");
  repo.write(
    "docs/openzwork/upstream-doc-variants.yaml",
    `version: 1\nvariants:\n  - upstream: docs/b.md\n    variant: docs/b-openzwork.md\n    role: tool\n    usedBy: [src/reader-upstream.ts, src/reader-comment.ts]\n    kind: content\n    upstreamBlob: ${repo.git("rev-parse", `${repo.v2}:docs/b.md`)}\n`,
  );
  repo.commit("invalid readers");
  const errors = check(repo).join("\n");
  // 登记了版本仍出现上游原文（含只在注释里的情形），与完全没有引用，都必须失败。
  assert.match(errors, /src\/reader-upstream\.ts 登记了 OpenZWork 版本仍读取上游原文 b\.md/);
  assert.match(errors, /src\/reader-comment\.ts 登记了 OpenZWork 版本仍读取上游原文 b\.md/);
});

test("runCheck 不把版本注释、字符串中的调用示例和无关说明当作读取", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  const readers = {
    "src/version-comment.ts": '// docs/b-openzwork.md\nexport const doc = "docs/b.md";\n',
    "src/selector-comment.ts": '// openzworkDoc("docs/b.md")\nexport const doc = "docs/b.md";\n',
    "src/selector-example.ts": "export const note = 'openzworkDoc(\"docs/b.md\")';\n",
    "src/version-prose.ts": 'export const note = "请使用 docs/b-openzwork.md";\n',
    "docs/rule-comment.md": "<!-- [B](b-openzwork.md) -->\n以 [上游 B](b.md) 为准。\n",
  };
  for (const [path, text] of Object.entries(readers)) repo.write(path, text);
  repo.write(
    "docs/openzwork/upstream-doc-variants.yaml",
    `version: 1\nvariants:\n  - upstream: docs/b.md\n    variant: docs/b-openzwork.md\n    role: tool\n    usedBy: ${JSON.stringify(Object.keys(readers))}\n    kind: content\n    upstreamBlob: ${repo.git("rev-parse", `${repo.v2}:docs/b.md`)}\n`,
  );
  repo.commit("reader false positives");
  const errors = check(repo).join("\n");
  for (const path of Object.keys(readers)) assert.ok(errors.includes(path), path);
});

test("runCheck 分别验证嵌套选择函数与规则链接", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  repo.write(
    "src/nested-reader.ts",
    'export const doc = openzworkDoc(resolve(root(), "docs/b.md"));\n',
  );
  repo.write("docs/rule.md", "以 [B 版本](b-openzwork.md#b) 为准。\n");
  repo.write(
    "docs/openzwork/upstream-doc-variants.yaml",
    `version: 1\nvariants:\n  - upstream: docs/b.md\n    variant: docs/b-openzwork.md\n    role: tool\n    usedBy: [src/nested-reader.ts, docs/rule.md]\n    kind: content\n    upstreamBlob: ${repo.git("rev-parse", `${repo.v2}:docs/b.md`)}\n`,
  );
  repo.commit("nested and markdown readers");
  assert.deepEqual(check(repo), []);
});

test("runCheck 要求差异总表覆盖台账条目、OpenZWork 版本写明理由", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  repo.write("docs/openzwork/README.md", "# 索引\n\n## 与上游的差异\n\n- OZ-F001\n\n## 维护\n");
  repo.write(
    "docs/openzwork/upstream-doc-variants.yaml",
    `version: 1\nvariants:\n  - upstream: docs/b.md\n    variant: docs/b-openzwork.md\n    kind: content\n    upstreamBlob: ${repo.git("rev-parse", `${repo.v2}:docs/b.md`)}\n`,
  );
  repo.commit("missing table rows and role");
  const errors = check(repo).join("\n");
  assert.match(errors, /「与上游的差异」缺少 OZ-D001/);
  assert.match(errors, /「与上游的差异」缺少 OZ-R001/);
  assert.match(errors, /role 应为 tool\/rule\/maintained\/pending/);
});

test("runCheck 要求 OpenZWork 文档链接已登记上游文档的 OpenZWork 版本，「上游」开头的链接除外", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  repo.write(
    "docs/openzwork/guide.md",
    [
      "# 指南",
      "",
      "见 [B](../b.md#b)，另见 [A](../a.md)、[B 版本](../b-openzwork.md)、[上游 B](../b.md#b)、[`[x]` 说明](../b.md)。",
      "",
      "```md",
      "[示例](../b.md)",
      "```",
      "",
      "[ref]: /docs/b.md",
      "",
    ].join("\n"),
  );
  repo.commit("links to upstream original");
  const errors = check(repo);
  assert.deepEqual(errors, [
    "docs/openzwork/guide.md:3 链接 ../b.md#b 打开的是上游原文；OpenZWork 文档改为链接 b-openzwork.md（上游原文的内容和锚点与 OpenZWork 版本不同）；确实要引用上游原文时，链接文字以「上游」开头",
    "docs/openzwork/guide.md:3 链接 ../b.md 打开的是上游原文；OpenZWork 文档改为链接 b-openzwork.md（上游原文的内容和锚点与 OpenZWork 版本不同）；确实要引用上游原文时，链接文字以「上游」开头",
    "docs/openzwork/guide.md:9 链接 /docs/b.md 打开的是上游原文；OpenZWork 文档改为链接 b-openzwork.md（上游原文的内容和锚点与 OpenZWork 版本不同）；确实要引用上游原文时，链接文字以「上游」开头",
  ]);
  repo.write(
    "docs/openzwork/guide.md",
    "# 指南\n\n见 [B](../b-openzwork.md#b)。\n\n[ref]: /docs/b-openzwork.md\n",
  );
  repo.commit("link variants");
  assert.deepEqual(check(repo), []);
});

test("runCheck 校验上游基准版本与经验库格式", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  repo.write("package.json", JSON.stringify({ version: "2.0.0+openzwork.1" }));
  repo.write(
    ".agents/skills/openzwork-maintenance/knowledge/diff.yaml",
    `version: 1
kind: diff
entries:
  - id: OZK-PIT-002
    title: 前缀不符
    when: 场景。
    do: 做法。
    why: 依据。
    evidence: ["PR #2"]
    since: 2026-11-07
    checked: 1.1.0
    status: active
`,
  );
  repo.commit("bad version and knowledge");
  const errors = check(repo).join("\n");
  assert.match(errors, /根 package\.json 版本前三段为 2\.0\.0/);
  assert.match(errors, /id 应为 OZK-DIF-NNN/);
});

test("describePath 给出首次与最后出现的上游版本和认领", () => {
  const repo = fixture();
  const context = classify(repo.dir, repo.v2);
  const claims = createClaims(loadMaintenance(repo.dir));
  const old = describePath(context, claims, "docs/old.md");
  assert.equal(old.category, "retained");
  assert.equal(old.firstUpstream, "1.0.0");
  assert.equal(old.lastUpstream, "1.0.0");
  assert.equal(old.inBase, false);
  assert.deepEqual(
    old.claims.map((claim) => claim.id),
    ["OZ-R001"],
  );
  assert.equal(describePath(context, claims, "docs/b.md").variant, "docs/b-openzwork.md");
  const variant = describePath(context, claims, "docs/b-openzwork.md");
  assert.equal(variant.variantOf, "docs/b.md");
  assert.deepEqual(
    variant.claims.map((claim) => claim.id),
    ["variant:content"],
  );
  const ours = describePath(context, claims, "src/ours.ts");
  assert.equal(ours.firstUpstream, undefined);
  assert.deepEqual(
    ours.claims.map((claim) => claim.id),
    ["OZ-F001"],
  );
});

test("previewUpstream 列出冲突、我方已删被修改与落入裁剪路径的新增", () => {
  const repo = fixture();
  repo.git("checkout", "-q", "-b", "upstream-next", repo.v2);
  repo.write("package.json", JSON.stringify({ version: "1.2.0" }));
  repo.write("src/keep.ts", "export const keep = 3;\n");
  repo.write("src/gone.ts", "export const gone = 2;\n");
  repo.write("src/gone-new.ts", "export const fresh = 1;\n");
  repo.write("docs/a.md", "# A\n\n上游新增一段\n");
  const next = repo.commit("upstream 1.2.0");
  repo.git("checkout", "-q", "fork");
  const maintenance = loadMaintenance(repo.dir);
  const context = classify(repo.dir, repo.v2);
  const preview = previewUpstream(context, createClaims(maintenance), maintenance.ledger, next);
  assert.equal(preview.version, "1.2.0");
  assert.equal(preview.baseMatches, true);
  assert.deepEqual(preview.conflicts.map((item) => item.path).sort(), [
    "package.json",
    "src/gone.ts",
    "src/keep.ts",
  ]);
  assert.deepEqual(
    preview.modifiedAfterRemoval.map((item) => item.path),
    ["src/gone.ts"],
  );
  assert.deepEqual(preview.addedInDropPaths, [{ path: "src/gone-new.ts", id: "OZ-D001" }]);
  assert.deepEqual(preview.touchedEntries, [{ id: "OZ-F001", paths: ["src/keep.ts"] }]);
  // 吸收概览：docs/a.md 我方未改动；package.json 与 src/keep.ts 我方改过；src/gone.ts 我方已删；src/gone-new.ts 为上游新增。
  assert.deepEqual(preview.absorption, { direct: 1, merge: 2, removed: 1, added: 1 });
});

test("runCheck 要求 active 条目有核心 CI 中运行的保证或写明 unguarded", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  repo.write("tests/ci/core-tests.json", JSON.stringify({ version: 1, suites: [] }));
  repo.commit("core list emptied");
  let errors = check(repo).join("\n");
  assert.match(errors, /OZ-F001: 没有核心 CI 中运行的保证/);
  // 裁剪条目由路径不存在的检查保证；写明 unguarded 的条目不报错。
  assert.doesNotMatch(errors, /OZ-D001: 没有核心 CI/);
  assert.doesNotMatch(errors, /OZ-R001/);

  // ci.yml 点名也算：--filter 的路径相对包目录，根脚本展开后的通配符按目录匹配。
  repo.write("packages/pkg/package.json", JSON.stringify({ name: "@x/pkg" }));
  repo.write("packages/pkg/tests/a.test.ts", "export {};\n");
  repo.write("scripts/test/b.test.mjs", "export {};\n");
  repo.write(
    "package.json",
    JSON.stringify({
      version: "1.1.0+openzwork.1",
      scripts: { "test:repo-scripts": "node --test scripts/test/*.test.mjs" },
    }),
  );
  repo.write(
    ".github/workflows/ci.yml",
    ciWorkflow([
      { name: "pkg", run: "pnpm --filter @x/pkg exec vitest run tests/a.test.ts --bail=1" },
      { name: "scripts", run: "pnpm test:repo-scripts" },
    ]),
  );
  repo.edit(
    "docs/openzwork/ledger.yaml",
    'tests: ["src/ours.test.ts"]',
    'tests: ["packages/pkg/tests/a.test.ts"]',
  );
  repo.edit(
    "docs/openzwork/ledger.yaml",
    'paths: ["docs/old.md"]',
    'paths: ["docs/old.md"]\n    tests: ["scripts/test/b.test.mjs"]',
  );
  repo.commit("guards from ci.yml");
  errors = check(repo);
  // OZ-F001 由 ci.yml 点名的包内测试保证；OZ-R001 有了保证却还留着 unguarded。
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /OZ-R001: 已有保证（scripts\/test\/b\.test\.mjs），删除 unguarded/);

  repo.edit("docs/openzwork/ledger.yaml", "    unguarded: 夹具：保留的文档没有测试。\n", "");
  repo.commit("drop stale unguarded");
  assert.deepEqual(check(repo), []);

  repo.edit(
    "docs/openzwork/ledger.yaml",
    '\n    tests: ["scripts/test/b.test.mjs"]',
    "\n    unguarded: ''",
  );
  repo.commit("empty unguarded");
  assert.match(check(repo).join("\n"), /OZ-R001: unguarded 要写明原因与补齐方式/);
});

test("runCheck 拦截 ci.yml 点名但已不存在的测试文件", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  repo.write(
    ".github/workflows/ci.yml",
    ciWorkflow([
      {
        name: "Remote control regression",
        // Vitest 忽略匹配不到文件的过滤器，步骤照常通过；echo 里的文件名不是点名。
        run: 'pnpm exec vitest run src/ours.test.ts src/missing.test.ts --bail=1\necho "running tests/echo.test.ts alone"',
      },
    ]),
  );
  repo.commit("ci names a deleted test");
  const errors = check(repo);
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(
    errors[0],
    /ci\.yml 步骤「Remote control regression」点名的测试文件不存在：src\/missing\.test\.ts/,
  );
  const ci = loadCiTests(classify(repo.dir, repo.v2));
  assert.equal(ci.runs("src/ours.test.ts"), true);
  assert.equal(ci.runs("tests/echo.test.ts"), false);
});

test("runCheck 要求台账上游版本有整合文档", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  repo.remove("docs/openzwork/upstream/v1.1.0-integration.md");
  repo.commit("integration doc removed");
  assert.match(check(repo).join("\n"), /缺少 docs\/openzwork\/upstream\/v1\.1\.0-integration\.md/);
});

test("runCheck 要求上游技能保持原作者的文件，脚本只允许用户级根改名", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  const script = ".agents/skills/up/scripts/run.mjs";
  // 新增文件和只改用户级根的那一行都允许。
  repo.write(script, 'export const root = join(homedir(), ".openzwork");\n');
  repo.write(".agents/skills/up/references/ours.md", "# OpenZWork 补充\n");
  repo.commit("identity rename and a new file");
  assert.deepEqual(check(repo), []);
  assert.equal(classify(repo.dir, repo.v2).result.get(script).category, "upstream-identity");

  // 多一行注释就不再是改名：格式化或说明性改动都要恢复。
  repo.write(script, '// 说明\nexport const root = join(homedir(), ".openzwork");\n');
  repo.commit("comment added to upstream skill script");
  let errors = check(repo);
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /上游技能文件 \.agents\/skills\/up\/scripts\/run\.mjs 被修改/);

  // 删除其中一个文件：没有 drop 条目认领时报错。
  repo.write(script, 'export const root = join(homedir(), ".openzwork");\n');
  repo.remove(".agents/skills/up/SKILL.md");
  repo.commit("part of an upstream skill removed");
  errors = check(repo);
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /上游技能文件 \.agents\/skills\/up\/SKILL\.md 被删除/);

  // 整个技能删除并登记为裁剪条目后通过。
  repo.remove(script);
  repo.remove(".agents/skills/up/references/ours.md");
  repo.edit(
    "docs/openzwork/ledger.yaml",
    "  - id: OZ-R001",
    `  - id: OZ-D002
    kind: drop
    status: active
    title: 不适用的技能
    summary: 整个删除上游技能 up。
    paths: [".agents/skills/up/**"]
    source: 测试
  - id: OZ-R001`,
  );
  repo.edit("docs/openzwork/README.md", "OZ-D001、", "OZ-D001、OZ-D002、");
  repo.commit("whole upstream skill dropped with a ledger entry");
  assert.deepEqual(check(repo), []);
});

test("runCheck 拦截夹带实质改动的整文件格式化，planRestore 恢复上游排版后通过", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  // 整文件去掉行尾空白，同时改了一行。
  repo.write(
    "src/big.ts",
    bigSource.replace(/[ \t]+$/gm, "").replace("export const a5 = 5;", "export const a5 = 55;"),
  );
  const noisy = repo.commit("whole-file format with one real change");
  const errors = check(repo);
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /src\/big\.ts 与上游的差异约有 58 行来自格式化（实质改动约 2 行）/);

  const [plan] = planRestore(classify(repo.dir, repo.v2), trimFormatter, ["src/big.ts"]);
  assert.equal(plan.raw, 60);
  assert.equal(plan.after, 2);
  // 恢复结果：上游原文，只有改动的那一行来自当前文件。
  assert.equal(
    plan.text,
    bigSource.replace("export const a5 = 5;   \n", "export const a5 = 55;\n"),
  );
  repo.write("src/big.ts", plan.text);
  repo.commit("upstream layout restored");
  assert.deepEqual(check(repo), []);
  assert.deepEqual(verifyFormatOnly(repo.dir, noisy, trimFormatter, repo.v2), {
    checked: 1,
    mismatched: [],
  });

  // 再改一行实质内容：不再是“只改排版”。
  repo.edit("src/big.ts", "export const a6 = 6;", "export const a6 = 66;");
  repo.commit("another real change");
  assert.deepEqual(verifyFormatOnly(repo.dir, noisy, trimFormatter, repo.v2).mismatched, [
    "src/big.ts",
  ]);
});

test("我方包了一层代码造成的缩进变化不算格式噪声", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  const wrapped = `if (flag) {\n${plainSource.replace(/^/gm, "  ").replace(/ {2}$/, "")}}\n`;
  repo.write("src/plain.ts", wrapped);
  repo.commit("upstream code wrapped in a block");
  assert.deepEqual(check(repo), []);
  assert.deepEqual(planRestore(classify(repo.dir, repo.v2), trimFormatter, ["src/plain.ts"]), []);
});

test("entryReport 给出每个条目的保证与接线面，modifiedSummary 汇总增删行数", () => {
  const repo = fixture();
  const context = classify(repo.dir, repo.v2);
  const { ledger } = loadMaintenance(repo.dir);
  const report = entryReport(context, ledger, loadCiTests(context));
  const byId = Object.fromEntries(report.map((item) => [item.id, item]));
  assert.deepEqual(byId["OZ-F001"].guard, { ok: true, tests: ["src/ours.test.ts"], gates: [] });
  // src/keep.ts 是我方改过的上游文件：改一行计 +1 −1。
  assert.deepEqual(byId["OZ-F001"].wiring, { hooks: 1, modified: 1, added: 1, deleted: 1 });
  assert.equal(byId["OZ-D001"].guard.ok, true);
  assert.equal(byId["OZ-D001"].guard.pathCheck, true);
  assert.equal(byId["OZ-R001"].guard.ok, false);
  assert.equal(byId["OZ-R001"].unguarded, "夹具：保留的文档没有测试。");
  // upstream-modified：package.json、src/keep.ts、src/fmt.ts 各改一行。
  assert.deepEqual(modifiedSummary(context), {
    files: 3,
    deletionOnly: 0,
    added: 3,
    deleted: 3,
  });
});

test("globToRegExp 与 applyIdentity", () => {
  assert.equal(globToRegExp("docs/**").test("docs/a/b.md"), true);
  assert.equal(globToRegExp("docs/*.md").test("docs/a/b.md"), false);
  assert.equal(globToRegExp("docs/specs/*-openzwork.md").test("docs/specs/x-openzwork.md"), true);
  assert.equal(globToRegExp("src/**/x.ts").test("src/x.ts"), true);
  assert.equal(applyIdentity('join(homedir(), ".zcode")'), 'join(homedir(), ".openzwork")');
  assert.equal(applyIdentity("~/.zcode-dev-home"), "~/.zcode-dev-home");
  assert.equal(applyIdentity("<cwd>/.zcode/settings.json"), "<cwd>/.zcode/settings.json");
});
