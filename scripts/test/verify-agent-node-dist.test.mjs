import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { verifyAgentNodeDist } from "../verify-agent-node-dist.mjs";

const exec = promisify(execFile);

async function temp() {
  return mkdtemp(join(tmpdir(), "verify-agent-node-dist-test-"));
}

/** 合成带 CLI 入口与 TUI 模块的最小运行包。 */
async function syntheticTarball(dir, { agentSource } = {}) {
  const staging = join(dir, "stage");
  await mkdir(join(staging, "zcode/agent/node_modules/@zcode/tui/dist"), { recursive: true });
  await mkdir(join(staging, "zcode/bin"), { recursive: true });
  await mkdir(join(staging, "zcode/server"), { recursive: true });
  await mkdir(join(staging, "zcode/web"), { recursive: true });
  await writeFile(
    join(staging, "zcode/package.json"),
    JSON.stringify({ version: "3.18.2+openzwork.1" }),
  );
  await writeFile(
    join(staging, "zcode/agent/zcode.cjs"),
    agentSource ?? 'const dataRoot = ".openzwork";\n'.repeat(3),
  );
  await writeFile(join(staging, "zcode/bin/zcode.mjs"), "");
  await writeFile(join(staging, "zcode/agent/node_modules/@zcode/tui/dist/index.js"), "");
  const tarball = join(dir, "zcode-test.tar.gz");
  await exec("tar", ["-czf", tarball, "-C", staging, "zcode"]);
  return tarball;
}

test("verify-agent-node-dist accepts the F4 layout and reports the tarball hash", async () => {
  const dir = await temp();
  try {
    const tarball = await syntheticTarball(dir);
    const report = await verifyAgentNodeDist({ tarball, expectedVersion: "3.18.2+openzwork.1" });
    assert.equal(report.ok, true, JSON.stringify(report.failures));
    assert.equal(report.version, "3.18.2+openzwork.1");
    assert.equal(report.dataRootHits, 3);
    assert.match(report.tarballSha256, /^[0-9a-f]{64}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verify-agent-node-dist fails on missing entries, version drift and trimmed markers", async () => {
  const dir = await temp();
  try {
    const tarball = await syntheticTarball(dir, {
      agentSource: ".openzwork\noauthCredentialRepo();\n",
    });
    const staging = join(dir, "stage");
    await rm(join(staging, "zcode/web"), { recursive: true, force: true });
    await rm(join(staging, "zcode/agent/node_modules/@zcode/tui"), {
      recursive: true,
      force: true,
    });
    await exec("tar", ["-czf", tarball, "-C", staging, "zcode"]);
    const report = await verifyAgentNodeDist({ tarball, expectedVersion: "3.18.1+openzwork.1" });
    assert.equal(report.ok, false);
    const joined = report.failures.join("\n");
    assert.match(joined, /required entry missing: web/);
    assert.match(
      joined,
      /required entry missing: agent\/node_modules\/@zcode\/tui\/dist\/index\.js/,
    );
    assert.match(joined, /packaged version 3\.18\.2\+openzwork\.1 != 3\.18\.1\+openzwork\.1/);
    assert.match(joined, /oauthCredentialRepo.*present/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
