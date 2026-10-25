import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const definitions = [
  ["core", "CI", "ci.yml"],
  ["extended", "Extended checks (non-blocking)", "extended-checks.yml"],
  ["installers", "Installers", "installers.yml"],
];
const tagPattern = /^v\d+\.\d+\.\d+-openzwork$/;

export function selectReleaseRuns(runs, { repo, tag, commit }) {
  const selected = {};
  let waiting = false;
  for (const [key, name, file] of definitions) {
    // 同一提交的 main 构建仍是 Preview；只接受由正式 tag 生成的明确运行标题。
    const [run] = runs
      .filter(
        (entry) =>
          entry.path === `.github/workflows/${file}` &&
          entry.name === name &&
          entry.event === "push" &&
          entry.head_sha === commit &&
          entry.head_repository?.full_name === repo &&
          entry.display_title === `Release ${tag} / ${name}`,
      )
      .sort((a, b) => b.id - a.id);
    if (!run || run.status !== "completed") {
      waiting = true;
      continue;
    }
    assert.equal(run.conclusion, "success", `${name} run ${run.id} failed; rerun its failed jobs`);
    selected[key] = String(run.id);
  }
  return waiting ? { status: "waiting" } : { status: "ready", ...selected };
}

export async function planAutomaticRelease({ repo, eventName, event, tag, api, listRuns }) {
  assert.match(repo ?? "", /^[\w.-]+\/[\w.-]+$/);
  let triggeringCommit;
  if (eventName === "workflow_run") {
    const run = event.workflow_run;
    if (
      run?.event !== "push" ||
      run.status !== "completed" ||
      run.head_repository?.full_name !== repo
    )
      return { status: "ignored" };
    const match = /^Release (v\d+\.\d+\.\d+-openzwork) \/ (.+)$/.exec(run.display_title);
    if (
      !match ||
      !definitions.some(
        ([, name, file]) =>
          name === match[2] && name === run.name && run.path === `.github/workflows/${file}`,
      )
    )
      return { status: "ignored" };
    tag = match[1];
    triggeringCommit = run.head_sha;
  } else assert.equal(eventName, "workflow_dispatch");
  assert.match(tag ?? "", tagPattern);
  let object = (await api(`git/ref/tags/${tag}`)).object;
  if (object.type === "tag") object = (await api(`git/tags/${object.sha}`)).object;
  assert.equal(object.type, "commit");
  const commit = object.sha;
  assert.match(commit, /^[a-f0-9]{40}$/);
  if (triggeringCommit)
    assert.equal(commit, triggeringCommit, "Release tag changed after the triggering run");
  const metadata = await api(`contents/package.json?ref=${commit}`);
  const { version } = JSON.parse(Buffer.from(metadata.content, "base64"));
  assert.equal(tag, `v${version}-openzwork`);
  const release = await api(`releases/tags/${tag}`);
  if (release && !release.draft) {
    assert.equal(release.tag_name, tag);
    assert.equal(release.prerelease, false);
    assert.equal(release.assets.length, 9, "Published release must contain all nine assets");
    assert.equal(new Set(release.assets.map((asset) => asset.name)).size, 9);
    assert.ok(release.assets.every((asset) => asset.state === "uploaded"));
    return { status: "published", tag, commit };
  }
  return { tag, commit, ...selectReleaseRuns(await listRuns(commit), { repo, tag, commit }) };
}

async function main(env = process.env) {
  const exec = promisify(execFile);
  const gh = async (...args) => (await exec("gh", args, { maxBuffer: 16 * 1024 * 1024 })).stdout;
  const repo = env.GITHUB_REPOSITORY;
  assert.match(repo ?? "", /^[\w.-]+\/[\w.-]+$/);
  const api = async (path) => {
    try {
      return JSON.parse(await gh("api", `repos/${repo}/${path}`));
    } catch (error) {
      // 未公开草稿可能在按 tag 的读取接口返回 404；创建/续传仍由发布器按 ID 处理。
      if (path.startsWith("releases/tags/") && error.stderr?.includes("HTTP 404")) return null;
      throw error;
    }
  };
  const listRuns = async (commit) =>
    (
      await Promise.all(
        definitions.map(async ([, , file]) => {
          const pages = JSON.parse(
            await gh(
              "api",
              "--paginate",
              "--slurp",
              `repos/${repo}/actions/workflows/${file}/runs?event=push&head_sha=${commit}&per_page=100`,
            ),
          );
          return pages.flatMap((page) => page.workflow_runs);
        }),
      )
    ).flat();
  const result = await planAutomaticRelease({
    repo,
    eventName: env.GITHUB_EVENT_NAME,
    event: JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8")),
    tag: env.RELEASE_TAG,
    api,
    listRuns,
  });
  console.log(JSON.stringify(result, null, 2));
  if (env.GITHUB_OUTPUT)
    await appendFile(
      env.GITHUB_OUTPUT,
      Object.entries(result)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  if (env.GITHUB_STEP_SUMMARY)
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `Release ${result.tag || "event"}: **${result.status}**\n`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
