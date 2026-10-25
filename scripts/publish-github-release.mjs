import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const platforms = ["macos-arm64", "windows-amd64", "linux-amd64"];
const groups = [
  "shared-and-rpc",
  "services",
  "provider",
  "server",
  "desktop",
  "ui-and-web",
  "root-scripts",
];
const sha256Pattern = /^[a-f0-9]{64}$/;

export function validateRun(run, name, commit) {
  assert.equal(run.name, name);
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  if (commit) assert.equal(run.head_sha, commit);
}

export function validateManifest(manifest, expected) {
  for (const key of [
    "sourceTag",
    "sourceCommit",
    "sourceTree",
    "workflowCommit",
    "version",
    "platform",
    "runUrl",
  ])
    assert.equal(manifest[key], expected[key], key);
  assert.equal(manifest.productName, "OpenZWork");
  assert.equal(manifest.environment, "production");
  assert.equal(manifest.codeSigning, "unsigned");
  const formats = {
    "macos-arm64": ["mac", ["arm64"], ["dmg", "zip"]],
    "windows-amd64": ["win", ["x64"], ["exe"]],
    "linux-amd64": ["linux", ["x64", "amd64", "x86_64"], ["AppImage", "deb", "rpm", "pkg.tar.zst"]],
  };
  const [os, arches, extensions] = formats[expected.platform];
  assert.equal(manifest.assets.length, extensions.length);
  for (const extension of extensions) {
    const matches = manifest.assets.filter((asset) =>
      arches.some(
        (arch) => asset.name === `OpenZWork-${expected.version}-${os}-${arch}.${extension}`,
      ),
    );
    assert.equal(matches.length, 1, `Expected one ${extension} installer`);
  }
  for (const asset of manifest.assets) {
    assert.equal(basename(asset.name), asset.name);
    assert.ok(!asset.name.includes("\\"));
    assert.ok(Number.isSafeInteger(asset.size) && asset.size > 0);
    assert.match(asset.sha256, sha256Pattern);
  }
}

export function validateTests(report) {
  assert.equal(report.success, true);
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numFailedTestSuites, 0);
  assert.equal(report.numRuntimeErrorTestSuites ?? 0, 0);
  assert.ok(report.numTotalTests > 0);
  let passed = 0,
    skipped = 0;
  for (const file of report.testResults) {
    assert.equal(file.status, "passed", file.name);
    for (const test of file.assertionResults) {
      if (test.status === "passed") passed++;
      else {
        assert.ok(["skipped", "pending", "todo", "disabled"].includes(test.status), test.fullName);
        skipped++;
      }
    }
  }
  assert.equal(passed, report.numPassedTests);
  assert.equal(passed + skipped, report.numTotalTests);
  return { files: report.testResults.length, passed, skipped, failed: 0 };
}

export function validateSummary(summary) {
  assert.equal(summary.anyFailed, false);
  assert.equal(summary.groups.length, groups.length);
  assert.deepEqual(summary.groups.map((group) => group.group).sort(), [...groups].sort());
  for (const group of summary.groups) {
    assert.equal(group.status, "passed");
    assert.equal(group.exit, 0);
  }
}

export function validateExistingAssets(remoteAssets, expected, requireAll = false) {
  const names = new Set();
  for (const asset of remoteAssets) {
    assert.ok(!names.has(asset.name), "Duplicate release asset");
    names.add(asset.name);
    assert.ok(expected.has(asset.name), `Unexpected release asset: ${asset.name}`);
    assert.equal(asset.state, "uploaded");
    assert.equal(asset.size, expected.get(asset.name).size);
    assert.equal(asset.digest, `sha256:${expected.get(asset.name).sha256}`);
  }
  if (requireAll) assert.equal(names.size, expected.size);
  return names;
}

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function streamCommand(command, args, file) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr = (stderr + data).slice(-16_384);
  });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${command} exited ${code}: ${stderr.replace(/(https?:\/\/[^\s?"]+)\?[^\s"]+/g, "$1?[redacted]")}`,
            ),
          ),
    );
  });
  try {
    await Promise.all([pipeline(child.stdout, createWriteStream(file)), exit]);
  } catch (error) {
    child.kill();
    await exit.catch(() => undefined);
    throw error;
  }
}

export async function publishRelease(env = process.env) {
  const repo = env.GH_REPO,
    tag = env.RELEASE_TAG,
    commit = env.RELEASE_COMMIT;
  assert.match(repo ?? "", /^[\w.-]+\/[\w.-]+$/);
  assert.match(tag ?? "", /^v\d+\.\d+\.\d+-openzwork$/);
  assert.match(commit ?? "", /^[a-f0-9]{40}$/);
  for (const key of ["INSTALLERS_RUN", "CORE_RUN", "EXTENDED_RUN"])
    assert.match(env[key] ?? "", /^\d+$/);
  assert.ok(env.RELEASE_NOTES?.trim(), "Release notes are required");
  const version = tag.slice(1, -"-openzwork".length);
  const gh = async (...args) => (await exec("gh", args, { maxBuffer: 32 * 1024 * 1024 })).stdout;
  const api = async (path) => JSON.parse(await gh("api", `repos/${repo}/${path}`));
  const verifyTag = async () => {
    let object = (await api(`git/ref/tags/${tag}`)).object;
    if (object.type === "tag") object = (await api(`git/tags/${object.sha}`)).object;
    assert.equal(object.type, "commit");
    assert.equal(object.sha, commit);
  };
  await verifyTag();
  const tree = (await api(`git/commits/${commit}`)).tree.sha;
  const readSourceJson = async (path) =>
    JSON.parse(Buffer.from((await api(`contents/${path}?ref=${commit}`)).content, "base64"));
  assert.equal((await readSourceJson("package.json")).version, version);
  const policy = await readSourceJson("tests/ci/core-tests.json");
  const declared = policy.suites.flatMap((suite) => suite.files);
  const root = await mkdtemp(join(env.RUNNER_TEMP || tmpdir(), "openzwork-publish-"));
  const assetsDir = join(root, "assets");
  await mkdir(assetsDir);
  const jsonInZip = async (file, name) =>
    JSON.parse((await exec("unzip", ["-p", file, name], { maxBuffer: 64 * 1024 * 1024 })).stdout);
  const getArtifact = async (runId, name) => {
    const candidates = (await api(`actions/runs/${runId}/artifacts?per_page=100`)).artifacts.filter(
      (artifact) => artifact.name === name,
    );
    candidates.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const artifact = candidates[0];
    assert.ok(artifact && !artifact.expired && artifact.size_in_bytes > 0, name);
    assert.match(artifact.digest ?? "", /^sha256:[a-f0-9]{64}$/);
    const file = join(root, `${runId}-${name}.zip`);
    // 网络中断可以重传同一不可变 artifact；每次都核验完整归档，不能复用部分文件。
    for (let attempt = 0; ; attempt++) {
      try {
        await streamCommand(
          "gh",
          ["api", `repos/${repo}/actions/artifacts/${artifact.id}/zip`],
          file,
        );
        assert.equal((await stat(file)).size, artifact.size_in_bytes);
        assert.equal(`sha256:${await digest(file)}`, artifact.digest);
        break;
      } catch (error) {
        if (attempt >= 1) throw error;
      }
    }
    return { artifact, file };
  };
  const coreRun = await api(`actions/runs/${env.CORE_RUN}`);
  const extendedRun = await api(`actions/runs/${env.EXTENDED_RUN}`);
  const installerRun = await api(`actions/runs/${env.INSTALLERS_RUN}`);
  validateRun(coreRun, "CI", commit);
  // 固定源码复验允许工作流来自更新提交；实际源码由三平台 source.json 逐份核对。
  validateRun(extendedRun, "Extended checks (non-blocking)");
  validateRun(installerRun, "Installers");
  assert.equal(installerRun.event, "workflow_dispatch");
  const validation = [];
  const manifests = [],
    archives = [];
  for (const platform of platforms) {
    const core = await getArtifact(env.CORE_RUN, `core-tests-${platform}`);
    const report = await jsonInZip(core.file, "core-tests.json");
    const coreCounts = validateTests(report);
    assert.equal(report.testResults.length, declared.length);
    for (const file of declared)
      assert.equal(
        report.testResults.filter((result) =>
          result.name.replaceAll("\\", "/").endsWith(`/${file}`),
        ).length,
        1,
        file,
      );
    const extended = await getArtifact(env.EXTENDED_RUN, `extended-tests-${platform}`);
    const source = await jsonInZip(extended.file, "source.json");
    assert.equal(source.sourceCommit, commit);
    assert.equal(source.sourceTree, tree);
    assert.equal(source.workflowCommit, extendedRun.head_sha);
    assert.equal(source.testPool, platform === "windows-amd64" ? "forks" : "threads");
    validateSummary(await jsonInZip(extended.file, "summary.json"));
    const counts = {};
    for (const group of groups)
      counts[group] = validateTests(await jsonInZip(extended.file, `${group}.json`));
    validation.push({ platform, core: coreCounts, extended: counts });
    const { artifact, file } = await getArtifact(
      env.INSTALLERS_RUN,
      `openzwork-installer-${platform}`,
    );
    const manifest = await jsonInZip(file, "RELEASE-MANIFEST.json");
    validateManifest(manifest, {
      sourceTag: tag,
      sourceCommit: commit,
      sourceTree: tree,
      workflowCommit: installerRun.head_sha,
      version,
      platform,
      runUrl: installerRun.html_url,
    });
    for (const asset of manifest.assets) {
      const target = join(assetsDir, asset.name);
      await streamCommand("unzip", ["-p", file, asset.name], target);
      assert.equal((await stat(target)).size, asset.size);
      assert.equal(await digest(target), asset.sha256);
    }
    manifests.push(manifest);
    archives.push({ id: artifact.id, name: artifact.name, sha256: artifact.digest.slice(7) });
    console.log(`${platform}: tests, source and installers verified`);
  }
  const provenance = {
    repository: repo,
    version,
    tag,
    sourceCommit: commit,
    sourceTree: tree,
    installerRun: installerRun.html_url,
    workflowCommit: installerRun.head_sha,
    archives,
    platforms: manifests,
    validation: {
      coreRun: coreRun.html_url,
      extendedRun: extendedRun.html_url,
      platforms: validation,
    },
  };
  await writeFile(join(assetsDir, "PROVENANCE.json"), JSON.stringify(provenance, null, 2) + "\n");
  const names = [
    ...manifests.flatMap((manifest) => manifest.assets.map((asset) => asset.name)),
    "PROVENANCE.json",
  ].sort();
  assert.equal(new Set(names).size, 8);
  const expected = new Map();
  for (const name of names)
    expected.set(name, {
      size: (await stat(join(assetsDir, name))).size,
      sha256: await digest(join(assetsDir, name)),
    });
  await writeFile(
    join(assetsDir, "SHA256SUMS"),
    [...expected].map(([name, asset]) => `${asset.sha256}  ${name}\n`).join(""),
  );
  expected.set("SHA256SUMS", {
    size: (await stat(join(assetsDir, "SHA256SUMS"))).size,
    sha256: await digest(join(assetsDir, "SHA256SUMS")),
  });
  const notesFile = join(root, "notes.md");
  await writeFile(notesFile, env.RELEASE_NOTES);
  // 草稿按列表或 ID 查询；GitHub 的按 tag 查询接口可能对未公开草稿返回 404。
  const releases = JSON.parse(
    await gh("api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`),
  )
    .flat()
    .filter((release) => release.tag_name === tag);
  assert.equal(releases.length, 1, "Create the reviewed draft release before publishing");
  const releaseId = releases[0].id;
  const readRelease = async () => {
    const release = await api(`releases/${releaseId}`);
    assert.equal(release.tag_name, tag);
    assert.equal(release.prerelease, false);
    return release;
  };
  for (const [name] of expected) {
    const release = await readRelease();
    const existing = validateExistingAssets(release.assets, expected);
    if (existing.has(name)) continue;
    assert.equal(release.draft, true, "Published releases cannot gain missing assets");
    try {
      await gh("release", "upload", tag, join(assetsDir, name), "-R", repo);
    } catch (error) {
      // 上传响应丢失时先回读；已有正确附件可以继续，禁止 clobber 或删除旧附件。
      if (!validateExistingAssets((await readRelease()).assets, expected).has(name)) throw error;
    }
  }
  validateExistingAssets((await readRelease()).assets, expected, true);
  await verifyTag();
  if ((await readRelease()).draft)
    await gh(
      "release",
      "edit",
      tag,
      "-R",
      repo,
      "--verify-tag",
      "--draft=false",
      "--prerelease=false",
      "--latest",
      "--notes-file",
      notesFile,
    );
  const published = await readRelease();
  assert.equal(published.draft, false);
  validateExistingAssets(published.assets, expected, true);
  assert.equal((await api("releases/latest")).id, releaseId);
  console.log(`Published ${published.html_url}: ${expected.size} verified assets`);
  return published.html_url;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await publishRelease();
