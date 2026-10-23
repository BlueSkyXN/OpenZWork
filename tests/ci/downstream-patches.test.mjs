import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseDocument } from "yaml";

const root = new URL("../../", import.meta.url);
const registryFile = "docs/upstream/downstream-patches.yaml";
const specFile = "docs/spec/downstream-patch-registry.md";
const idPattern = /^OW-P\d{3}$/;
const versionPattern = /^\d+\.\d+\.\d+$/;
const textFields = ["title", "trigger", "impact", "cause", "evidence", "retire"];
const kinds = new Set(["product", "test", "build"]);
const statuses = new Set(["open", "fixed", "retired"]);

async function readText(file) {
  try {
    return await readFile(new URL(file, root), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function pathList(value) {
  return Array.isArray(value) && value.every(nonEmpty) ? value : undefined;
}

function markersIn(text) {
  return new Set(text.match(/OW-P\d{3}(?!\d)/g) ?? []);
}

/**
 * 只依据传入的仓库快照判断，便于用最小夹具确认每条规则都会拦截。
 * repo.texts：清单引用的路径 → 内容（缺失即不存在）；repo.covered(file)：回归是否进入核心 CI；
 * repo.markers：带编号标记的已跟踪文件 → 编号集合。
 */
function registryProblems(registry, repo) {
  if (registry?.version !== 1 || !Array.isArray(registry.patches)) {
    return [`${registryFile} 需要 version: 1 与 patches 列表`];
  }
  const problems = [];
  const owners = new Map();
  for (const patch of registry.patches) {
    const id = patch?.id;
    if (typeof id !== "string" || !idPattern.test(id)) {
      problems.push(`编号须为 OW-P 加三位数字：${JSON.stringify(id)}`);
      continue;
    }
    const report = (message) => problems.push(`${id}: ${message}`);
    if (owners.has(id)) {
      report("编号重复，新条目使用下一个未用编号");
      continue;
    }
    const files = pathList(patch.files);
    const regression = pathList(patch.regression ?? []);
    owners.set(id, {
      status: patch.status,
      files: new Set(files),
      regression: new Set(regression),
    });
    for (const field of textFields) {
      if (!nonEmpty(patch[field])) report(`缺少 ${field}`);
    }
    if (!kinds.has(patch.kind)) report("kind 须为 product、test 或 build");
    if (!files?.length) report("files 须列出缺陷或修复所在文件");
    if (!regression) report("regression 须为文件路径列表");
    const refs = pathList(patch.refs ?? []);
    if (!refs) report("refs 须为链接或仓库路径列表");
    for (const file of [...(files ?? []), ...(regression ?? []), ...(refs ?? [])]) {
      if (!/^https?:\/\//.test(file) && repo.texts.get(file) === undefined) {
        report(`路径不存在：${file}`);
      }
    }
    if (!statuses.has(patch.status)) {
      report("status 须为 open、fixed 或 retired");
      continue;
    }

    const { since, checked, fixedIn } = patch.upstream ?? {};
    if (!versionPattern.test(since ?? "")) report("upstream.since 须为上游版本号");
    if (patch.status === "retired") {
      if (!versionPattern.test(fixedIn ?? "")) report("retired 条目须填写 upstream.fixedIn");
    } else if (checked !== repo.version) {
      report(
        `根版本已是 ${repo.version}，按 ${specFile} 用原触发场景复核后，` +
          `把 upstream.checked 从 ${checked} 改为 ${repo.version}，或改为 retired`,
      );
    }
    if (patch.status === "open") {
      if (!/^P[1-3]$/.test(patch.priority ?? "")) report("open 条目须填写 priority：P1–P3");
      continue;
    }

    if (!nonEmpty(patch.fix)) report("缺少 fix");
    if (regression && regression.length === 0) report("fixed、retired 条目须登记 regression");
    const marked =
      patch.status === "fixed" ? [...(files ?? []), ...(regression ?? [])] : regression;
    for (const file of new Set(marked)) {
      const text = repo.texts.get(file);
      if (text !== undefined && !markersIn(text).has(id)) {
        report(`${file} 缺少编号标记：在修复处或回归断言旁的注释中写 ${id}，修复丢失时先重新应用`);
      }
    }
    for (const file of regression ?? []) {
      if (!repo.covered(file)) {
        report(`回归未进入核心 CI：把 ${file} 加入 tests/ci/core-tests.json 或 ci.yml 回归步骤`);
      }
    }
  }

  for (const [file, ids] of repo.markers) {
    for (const id of ids) {
      const owner = owners.get(id);
      if (!owner) {
        problems.push(`${file}: 编号标记 ${id} 未在 ${registryFile} 登记`);
      } else if (owner.status === "retired" && !owner.regression.has(file)) {
        problems.push(`${file}: ${id} 已撤销，撤除修复处的标记，只在回归中保留`);
      } else if (!owner.files.has(file) && !owner.regression.has(file)) {
        problems.push(`${file}: 带有 ${id} 标记，把该文件登记到条目的 files 或 regression`);
      }
    }
  }
  return problems;
}

async function nearestPackage(file) {
  for (let dir = posix.dirname(file); dir !== "."; dir = posix.dirname(dir)) {
    const manifest = await readText(`${dir}/package.json`);
    if (manifest !== undefined) return { dir, name: JSON.parse(manifest).name };
  }
  return undefined;
}

async function ciScope() {
  const core = JSON.parse(await readText("tests/ci/core-tests.json"));
  const ci = parseDocument(await readText(".github/workflows/ci.yml")).toJS();
  return {
    coreFiles: new Set(core.suites.flatMap((suite) => suite.files)),
    runs: ci.jobs.checks.steps.flatMap((step) => (step.run ? [step.run.split(/\s+/)] : [])),
  };
}

/** 回归登记在根 Vitest 核心清单，或出现在 ci.yml 步骤中：根路径，或 --filter 包名加包内路径。 */
function isCovered(file, { coreFiles, runs }, pkg) {
  if (coreFiles.has(file) || runs.some((words) => words.includes(file))) return true;
  if (!pkg) return false;
  const local = posix.relative(pkg.dir, file);
  return runs.some(
    (words) =>
      words.includes(local) &&
      words.some((word, index) => word === pkg.name && words[index - 1] === "--filter"),
  );
}

async function trackedMarkers() {
  let stdout = "";
  try {
    ({ stdout } = await promisify(execFile)(
      "git",
      [
        "grep",
        "-I",
        "-z",
        "-o",
        "-E",
        "OW-P[0-9]{3}",
        "--",
        ".",
        ":(exclude)docs",
        ":(exclude)*.md",
        ":(exclude)tests/ci/downstream-patches.test.mjs",
      ],
      { cwd: root, maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch (error) {
    // git grep 没有匹配时退出码为 1；其他失败如实抛出。
    if (error.code !== 1) throw error;
  }
  const markers = new Map();
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const [file, id] = line.split("\0");
    markers.set(file, (markers.get(file) ?? new Set()).add(id));
  }
  return markers;
}

test("downstream patch registry matches the current tree", async () => {
  const document = parseDocument(await readText(registryFile));
  assert.deepEqual(document.errors, [], `${registryFile}: valid YAML`);
  const registry = document.toJS();
  const patches = Array.isArray(registry?.patches) ? registry.patches : [];
  const paths = new Set(
    patches.flatMap((patch) =>
      [patch?.files, patch?.regression, patch?.refs].flatMap((list) =>
        Array.isArray(list) ? list.filter(nonEmpty) : [],
      ),
    ),
  );
  const texts = new Map();
  for (const file of paths) {
    if (!/^https?:\/\//.test(file)) texts.set(file, await readText(file));
  }
  const regressions = patches.flatMap((patch) =>
    patch?.status === "open" ? [] : (pathList(patch?.regression) ?? []),
  );
  const scope = await ciScope();
  const covered = new Set();
  for (const file of regressions) {
    if (isCovered(file, scope, await nearestPackage(file))) covered.add(file);
  }
  const { version } = JSON.parse(await readText("package.json"));
  const problems = registryProblems(registry, {
    version,
    texts,
    covered: (file) => covered.has(file),
    markers: await trackedMarkers(),
  });
  assert.deepEqual(problems, []);
});

function fixture(overrides = {}, repoOverrides = {}) {
  const patch = {
    id: "OW-P901",
    title: "示例缺陷",
    kind: "product",
    status: "fixed",
    upstream: { since: "1.0.0", checked: "1.1.0" },
    trigger: "触发",
    impact: "影响",
    cause: "根因",
    evidence: "证据",
    fix: "修复",
    files: ["src/a.ts"],
    regression: ["test/a.test.ts"],
    retire: "撤销条件",
    ...overrides,
  };
  const texts = new Map([
    ["src/a.ts", "// OW-P901：修复处\n"],
    ["test/a.test.ts", "// OW-P901：回归\n"],
    ["src/other.ts", "export {};\n"],
  ]);
  const markers = new Map([...texts].map(([file, text]) => [file, markersIn(text)]));
  return registryProblems(
    { version: 1, patches: [patch] },
    { version: "1.1.0", texts, covered: () => true, markers, ...repoOverrides },
  );
}

test("registry fixture without defects passes", () => {
  assert.deepEqual(fixture(), []);
});

test("an upstream version bump requires each active patch to be re-checked", () => {
  assert.match(
    fixture({}, { version: "1.2.0" }).join("\n"),
    /upstream\.checked 从 1\.1\.0 改为 1\.2\.0/,
  );
  assert.match(
    fixture({ status: "open", priority: "P2" }, { version: "1.2.0" }).join("\n"),
    /upstream\.checked/,
  );
  assert.deepEqual(
    fixture(
      {
        status: "retired",
        upstream: { since: "1.0.0", fixedIn: "1.2.0" },
        files: ["src/other.ts"],
      },
      { version: "1.2.0", markers: new Map([["test/a.test.ts", new Set(["OW-P901"])]]) },
    ),
    [],
  );
});

test("a fixed patch loses its guard when a marker or CI coverage disappears", () => {
  const texts = new Map([
    ["src/a.ts", "// 上游版本覆盖后标记消失\n"],
    ["test/a.test.ts", "// OW-P901：回归\n"],
  ]);
  const overwritten = fixture(
    {},
    { texts, markers: new Map([["test/a.test.ts", new Set(["OW-P901"])]]) },
  );
  assert.match(overwritten.join("\n"), /src\/a\.ts 缺少编号标记/);
  assert.match(fixture({}, { covered: () => false }).join("\n"), /回归未进入核心 CI/);
  assert.match(fixture({ regression: [] }).join("\n"), /须登记 regression/);
});

test("CI coverage accepts the core list, root paths and filtered package steps", () => {
  const scope = {
    coreFiles: new Set(["packages/a/test/core.test.ts"]),
    runs: [
      "pnpm exec vitest run packages/a/test/root.test.ts",
      "pnpm --filter @zcode/cli-a exec vitest run tests/cli.test.ts",
    ].map((run) => run.split(" ")),
  };
  const cliA = { dir: "apps/cli/packages/a", name: "@zcode/cli-a" };
  const cliB = { dir: "apps/cli/packages/b", name: "@zcode/cli-b" };
  assert.equal(isCovered("packages/a/test/core.test.ts", scope), true);
  assert.equal(isCovered("packages/a/test/root.test.ts", scope), true);
  assert.equal(isCovered("apps/cli/packages/a/tests/cli.test.ts", scope, cliA), true);
  assert.equal(isCovered("apps/cli/packages/b/tests/cli.test.ts", scope, cliB), false);
  assert.equal(isCovered("packages/a/test/other.test.ts", scope), false);
});

test("markers must point to registered files of a registered patch", () => {
  const markers = new Map([
    ["src/a.ts", new Set(["OW-P901"])],
    ["test/a.test.ts", new Set(["OW-P901"])],
    ["src/other.ts", new Set(["OW-P901", "OW-P902"])],
  ]);
  const problems = fixture({}, { markers }).join("\n");
  assert.match(problems, /src\/other\.ts: 带有 OW-P901 标记/);
  assert.match(problems, /src\/other\.ts: 编号标记 OW-P902 未在/);
  const retired = fixture({ status: "retired", upstream: { since: "1.0.0", fixedIn: "1.1.0" } });
  assert.match(retired.join("\n"), /src\/a\.ts: OW-P901 已撤销/);
});
