import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import releaseConfig from "../../.release-it.mjs";

const load = async (file) =>
  parse(await readFile(new URL(`../../.github/workflows/${file}`, import.meta.url), "utf8"));
const [ci, extended, installers, release] = await Promise.all(
  ["ci.yml", "extended-checks.yml", "installers.yml", "release.yml"].map(load),
);

test("formal tags run all three existing gates and carry a common release identity", () => {
  for (const workflow of [ci, extended, installers]) {
    assert.deepEqual(workflow.on.push.tags, ["v*-openzwork"]);
    assert.equal(
      workflow["run-name"],
      "${{ github.ref_type == 'tag' && format('Release {0} / {1}', github.ref_name, github.workflow) || '' }}",
    );
  }
  assert.equal(releaseConfig.git.tagName, "v${version}-openzwork");
  assert.equal(releaseConfig.github.release, false);
  assert.equal(releaseConfig.npm.publish, false);
  const env = installers.jobs.installer.env;
  assert.equal(
    env.RELEASE_TAG,
    "${{ inputs.release_tag || (github.ref_type == 'tag' && github.ref_name) || '' }}",
  );
  assert.equal(
    env.RELEASE_COMMIT,
    "${{ inputs.release_commit || (github.ref_type == 'tag' && github.sha) || '' }}",
  );
  assert.equal(
    installers.jobs.installer.steps.find(
      (step) => step.name === "Record release installer provenance",
    ).if,
    "env.RELEASE_TAG != ''",
  );
});

test("automatic release waits for completed workflows and prepares with read-only permissions", () => {
  assert.deepEqual(release.on.workflow_run, {
    workflows: ["CI", "Extended checks (non-blocking)", "Installers"],
    types: ["completed"],
  });
  assert.deepEqual(release.permissions, { actions: "read", contents: "read" });
  assert.equal(release.jobs.prepare.permissions, undefined);
  assert.match(release.jobs.prepare.if, /head_repository.full_name == github.repository/);
  assert.match(release.jobs.prepare.if, /workflow_run.event == 'push'/);
  assert.equal(release.jobs.prepare.steps[0].with.ref, undefined);
  assert.equal(release.jobs.prepare.steps[0].with["persist-credentials"], false);
});

test("only a ready plan can publish; dry verification skips every mutation", () => {
  const job = release.jobs.publish;
  assert.equal(job.needs, "prepare");
  assert.equal(job.if, "needs.prepare.outputs.status == 'ready' && inputs.verify_only != true");
  assert.deepEqual(job.permissions, { actions: "read", contents: "write" });
  assert.deepEqual(job.concurrency, {
    group: "openzwork-release-publication",
    "cancel-in-progress": false,
  });
  assert.deepEqual(installers.jobs.publish.concurrency, job.concurrency);
  assert.equal(
    installers.concurrency["cancel-in-progress"],
    "${{ !inputs.publish_installer_run }}",
  );
  for (const publishing of [job, installers.jobs.publish]) {
    assert.ok(
      publishing.steps.some((step) => step.run === "node scripts/publish-github-release.mjs"),
    );
    assert.ok(
      !publishing.steps.some((step) =>
        /pnpm install|download-artifact/.test(step.run || step.uses || ""),
      ),
    );
  }
  const env = job.steps.at(-1).env;
  assert.equal(env.AUTO_CREATE_RELEASE, "true");
  for (const [key, output] of Object.entries({
    RELEASE_TAG: "tag",
    RELEASE_COMMIT: "commit",
    CORE_RUN: "core",
    EXTENDED_RUN: "extended",
    INSTALLERS_RUN: "installers",
  })) {
    assert.equal(env[key], `\u0024{{ needs.prepare.outputs.${output} }}`);
    assert.equal(release.jobs.prepare.outputs[output], `\u0024{{ steps.plan.outputs.${output} }}`);
  }
});

test("tag creation never supplies the zero before SHA as an explicit architecture baseline", () => {
  const step = ci.jobs.checks.steps.find((step) => step.name === "Architecture boundaries");
  assert.match(step.env.ARCHITECTURE_BASE, /github.ref_type == 'branch'/);
  assert.match(step.env.ARCHITECTURE_BASE, /github.event.before != '0{40}'/);
  assert.match(step.env.ARCHITECTURE_BASE, /github.event.pull_request.base.sha/);
});
