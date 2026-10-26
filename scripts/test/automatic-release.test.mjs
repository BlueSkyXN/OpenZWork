import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planAutomaticRelease, selectReleaseRuns } from "../automatic-release.mjs";
import { ensureReleaseDraft, shouldMakeLatest } from "../publish-github-release.mjs";

const repo = "example/project";
const tag = "v3.16.3-openzwork";
const commit = "a".repeat(40);
const definitions = [
  ["core", "CI", "ci.yml"],
  ["extended", "Extended checks (non-blocking)", "extended-checks.yml"],
  ["installers", "Installers", "installers.yml"],
];
const runs = () =>
  definitions.map(([key, name, file], i) => ({
    id: 100 + i,
    key,
    name,
    path: `.github/workflows/${file}`,
    event: "push",
    display_title: `Release ${tag} / ${name}`,
    head_sha: commit,
    head_repository: { full_name: repo },
    status: "completed",
    conclusion: "success",
  }));

test("release selection requires all three exact tag runs regardless of completion order", () => {
  for (const order of [runs(), runs().reverse(), [runs()[1], runs()[0], runs()[2]]]) {
    assert.deepEqual(selectReleaseRuns(order, { repo, tag, commit }), {
      status: "ready",
      core: "100",
      extended: "101",
      installers: "102",
    });
  }
  assert.equal(selectReleaseRuns(runs().slice(0, 2), { repo, tag, commit }).status, "waiting");
});

test("GitHub 将 run name 返回为动态标题时仍按 workflow 路径识别同源门禁", async () => {
  const source = runs().map((run) => ({ ...run, name: run.display_title }));
  assert.equal(selectReleaseRuns(source, { repo, tag, commit }).status, "ready");
  const { input } = planner({ event: { workflow_run: source[2] }, listRuns: async () => source });
  assert.equal((await planAutomaticRelease(input)).status, "ready");
  for (const corrupt of [
    { path: ".github/workflows/unrelated.yml" },
    { name: "Release v9.0.0-openzwork / Installers" },
    { display_title: "Release v9.0.0-openzwork / Installers" },
  ]) {
    const invalid = source.map((run) => ({ ...run }));
    Object.assign(invalid[2], corrupt);
    assert.equal(selectReleaseRuns(invalid, { repo, tag, commit }).status, "waiting");
  }
});

test("branch Preview, PR, foreign repository, wrong source and wrong workflow cannot supply release gates", () => {
  for (const patch of [
    { display_title: "normal main push" },
    { event: "pull_request" },
    { head_repository: { full_name: "external/fork" } },
    { head_sha: "b".repeat(40) },
    { path: ".github/workflows/unrelated.yml" },
  ]) {
    const source = runs();
    Object.assign(source[2], patch);
    assert.equal(selectReleaseRuns(source, { repo, tag, commit }).status, "waiting");
  }
});

test("new failed, cancelled or unfinished runs supersede older success; rerunning the same run can unblock", () => {
  for (const conclusion of ["failure", "cancelled", "timed_out", "skipped"]) {
    const source = [...runs(), { ...runs()[0], id: 200, conclusion }];
    assert.throws(() => selectReleaseRuns(source, { repo, tag, commit }), /200/);
    source[3].status = "in_progress";
    source[3].conclusion = null;
    assert.equal(selectReleaseRuns(source, { repo, tag, commit }).status, "waiting");
    Object.assign(source[3], { status: "completed", conclusion: "success" });
    assert.equal(selectReleaseRuns(source, { repo, tag, commit }).core, "200");
  }
});

function planner(overrides = {}) {
  const calls = [];
  const input = {
    repo,
    eventName: "workflow_run",
    event: { workflow_run: runs()[2] },
    api: async (path) => {
      calls.push(path);
      if (path === `git/ref/tags/${tag}`) return { object: { type: "commit", sha: commit } };
      if (path === `contents/package.json?ref=${commit}`)
        return { content: Buffer.from(JSON.stringify({ version: "3.16.3" })).toString("base64") };
      if (path === `releases/tags/${tag}`) return null;
      throw new Error(`Unexpected API: ${path}`);
    },
    listRuns: async () => runs(),
    ...overrides,
  };
  return { calls, input };
}

test("automatic coordinator ignores ordinary events before reading release state", async () => {
  for (const event of [
    { workflow_run: { ...runs()[2], event: "pull_request" } },
    { workflow_run: { ...runs()[2], display_title: "main" } },
    { workflow_run: { ...runs()[2], head_repository: { full_name: "external/fork" } } },
  ]) {
    const { calls, input } = planner({ event });
    assert.equal((await planAutomaticRelease(input)).status, "ignored");
    assert.deepEqual(calls, []);
  }
});

test("coordinator verifies the current tag and package version; manual recovery uses the same gate", async () => {
  const { input } = planner();
  assert.equal((await planAutomaticRelease(input)).status, "ready");
  assert.equal(
    (await planAutomaticRelease({ ...input, eventName: "workflow_dispatch", tag })).status,
    "ready",
  );
  await assert.rejects(
    planAutomaticRelease({ ...input, eventName: "workflow_dispatch", tag: "main" }),
  );
  for (const corrupt of ["tag", "version"]) {
    await assert.rejects(
      planAutomaticRelease({
        ...input,
        api: async (path) => {
          const result = await input.api(path);
          if (corrupt === "tag" && path.startsWith("git/ref")) result.object.sha = "b".repeat(40);
          if (corrupt === "version" && path.startsWith("contents"))
            result.content = Buffer.from('{"version":"9.0.0"}').toString("base64");
          return result;
        },
      }),
    );
  }
});

test("annotated tags resolve to commits and completed releases replay without reading artifacts or runs", async () => {
  const { input } = planner();
  const result = await planAutomaticRelease({
    ...input,
    api: async (path) => {
      if (path === `git/ref/tags/${tag}`) return { object: { type: "tag", sha: "b".repeat(40) } };
      if (path === `git/tags/${"b".repeat(40)}`) return { object: { type: "commit", sha: commit } };
      if (path === `releases/tags/${tag}`)
        return {
          tag_name: tag,
          draft: false,
          prerelease: false,
          assets: Array.from({ length: 9 }, (_, i) => ({ name: `asset-${i}`, state: "uploaded" })),
        };
      return input.api(path);
    },
    listRuns: async () => {
      assert.fail("published release must not require expired artifacts");
    },
  });
  assert.equal(result.status, "published");
});

test("numeric semantic version comparison never makes a late older release Latest", () => {
  assert.equal(shouldMakeLatest(tag, null), true);
  assert.equal(shouldMakeLatest(tag, { tag_name: "v3.16.2-openzwork" }), true);
  assert.equal(shouldMakeLatest(tag, { tag_name: "v3.17.0-openzwork" }), false);
  assert.equal(shouldMakeLatest("v3.9.0-openzwork", { tag_name: "v3.10.0-openzwork" }), false);
  assert.equal(shouldMakeLatest(tag, { tag_name: tag }), true);
  assert.throws(() => shouldMakeLatest(tag, { tag_name: "unknown-release" }));
});

test("Latest 在官方基准与 OpenZWork 修订号之间正确前进且拒绝倒退", () => {
  const tags = [
    "v3.16.2-openzwork", "v3.16.2+openzwork.1", "v3.16.2+openzwork.999",
    "v3.16.3-openzwork", "v3.16.3+openzwork.1", "v3.16.3+openzwork.2", "v3.16.3+openzwork.10",
  ];
  for (let i = 0; i < tags.length; i++) {
    assert.equal(shouldMakeLatest(tags[i], { tag_name: tags[i] }), true);
    for (const later of tags.slice(i + 1)) {
      assert.equal(shouldMakeLatest(later, { tag_name: tags[i] }), true);
      assert.equal(shouldMakeLatest(tags[i], { tag_name: later }), false);
    }
  }
});

test("修订版协调器接受同源正式事件，版本后缀不一致时拒绝发布", async () => {
  const revisionTag = "v3.16.2+openzwork.1";
  const revisionRuns = runs().map((run) => ({ ...run, display_title: `Release ${revisionTag} / ${run.name}` }));
  for (const sourceVersion of ["3.16.2+openzwork.1", "3.16.2", "3.16.2+openzwork.2"]) {
    const { input } = planner({
      event: { workflow_run: revisionRuns[2] },
      listRuns: async () => revisionRuns,
      api: async (path) => {
        if (path === `git/ref/tags/${revisionTag}`) return { object: { type: "commit", sha: commit } };
        if (path.startsWith("contents/package.json"))
          return { content: Buffer.from(JSON.stringify({ version: sourceVersion })).toString("base64") };
        if (path === `releases/tags/${revisionTag}`) return null;
        throw new Error(`Unexpected API: ${path}`);
      },
    });
    if (sourceVersion === "3.16.2+openzwork.1") {
      assert.equal((await planAutomaticRelease(input)).status, "ready");
      assert.equal((await planAutomaticRelease({ ...input, eventName: "workflow_dispatch", tag: revisionTag })).status, "ready");
    } else await assert.rejects(planAutomaticRelease(input));
  }
});

test("automatic drafts use generated notes and recover lost create responses; explicit notes and existing drafts are retained", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "openzwork-draft-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const mode of ["new", "response-lost", "existing", "custom"]) {
    let release =
      mode === "existing" ? { id: 1, tag_name: tag, body: "Reviewed notes", draft: true } : null;
    const calls = [];
    const gh = async (...args) => {
      calls.push(args);
      if (args[0] === "api" && args.includes("--slurp"))
        return JSON.stringify([release ? [release] : []]);
      if (args[0] === "api" && args.includes("POST"))
        return JSON.stringify({ body: "Merged changes" });
      if (args.slice(0, 2).join(" ") === "release create") {
        assert.ok(args.includes("--draft") && args.includes("--verify-tag"));
        release = { id: 2, tag_name: tag, draft: true };
        if (mode === "response-lost") throw new Error("response lost");
        return "";
      }
      assert.fail(`Unexpected command: ${args}`);
    };
    const notesFile = join(dir, `${mode}.md`);
    const id = await ensureReleaseDraft(
      {
        repo,
        tag,
        version: "3.16.3",
        notes: mode === "custom" ? "Custom notes" : "",
        allowCreate: true,
        notesFile,
      },
      gh,
    );
    assert.equal(id, mode === "existing" ? 1 : 2);
    const notes = await readFile(notesFile, "utf8");
    assert.ok(
      notes.includes(
        mode === "existing"
          ? "Reviewed notes"
          : mode === "custom"
            ? "Custom notes"
            : "Merged changes",
      ),
    );
    if (mode === "existing" || mode === "custom")
      assert.ok(!calls.some((args) => args.includes("POST")));
  }
  await assert.rejects(
    ensureReleaseDraft(
      {
        repo,
        tag,
        version: "3.16.3",
        notes: "Manual notes",
        allowCreate: false,
        notesFile: join(dir, "manual.md"),
      },
      async () => "[[]]",
    ),
  );
});
