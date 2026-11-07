// OpenZWork 维护扫描（.agents/skills/openzwork-maintenance/scripts/scan.mjs）的回归。
// 用临时 Git 仓库模拟两版上游快照与一版 OpenZWork 分支；格式化器用去行尾空白的替身，不依赖 oxfmt。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  applyIdentity,
  classify,
  createClaims,
  describePath,
  findFormatNoise,
  globToRegExp,
  loadMaintenance,
  previewUpstream,
  runCheck,
} from "../../.agents/skills/openzwork-maintenance/scripts/scan.mjs";

const trimFormatter = (files) => files.map(({ text }) => text.replace(/[ \t]+$/gm, ""));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "openzwork-scan-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const remove = (path) => rmSync(join(dir, path));
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
  write("src/home.ts", 'export const root = "~/.zcode/cli";\n');
  write("src/fmt.ts", "export const fmt = 1;   \n");
  const v1 = commit("upstream 1.0.0");
  write("package.json", JSON.stringify({ version: "1.1.0" }));
  remove("docs/old.md");
  const v2 = commit("upstream 1.1.0");
  git("checkout", "-q", "-b", "fork");
  write("package.json", JSON.stringify({ version: "1.1.0+openzwork.1" }));
  write("src/keep.ts", "export const keep = 2;\n");
  remove("src/gone.ts");
  write("src/ours.ts", "export const ours = 1;\n");
  write("docs/old.md", "# Old\n");
  write("src/home.ts", 'export const root = "~/.openzwork/cli";\n');
  write("src/fmt.ts", "export const fmt = 1;\n");
  write("docs/b.md", "# B\n\nOpenZWork 说明\n");
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
    source: 测试
`,
  );
  write(
    "docs/openzwork/upstream-doc-edits.yaml",
    "version: 1\nedits:\n  - path: docs/b.md\n    kind: content\n",
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
  return { dir, git, write, remove, commit, v1, v2, fork };
}

const check = (repo) => runCheck(repo.dir, { formatter: trimFormatter });

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

test("runCheck 要求上游文档编辑登记与实际一致", () => {
  const repo = fixture();
  repo.write("src/fmt.ts", "export const fmt = 1;   \n");
  repo.write("docs/a.md", "# A\n\n新增内容\n");
  repo.write("docs/b.md", "# B\n");
  repo.commit("doc drift");
  const errors = check(repo).join("\n");
  assert.match(errors, /上游文档 docs\/a\.md 与上游不一致但未登记/);
  assert.match(errors, /docs\/b\.md 当前为 upstream，删除这条登记/);
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
