import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildRemoteServerCommand } from "../../packages/server/src/remote/connect.ts";
import { buildRemoteAgentBundleWrapper } from "../../packages/server/src/remote/zcodeAgentBundleWrapper.ts";
import { REMOTE_BASE, REMOTE_BASE_HOME_EXPR } from "../../packages/server/src/remote/deployShared.ts";
import {
  listSavedWorkflows,
  resolveSavedWorkflow,
  saveSavedWorkflow,
  savedWorkflowRoot,
} from "../../apps/zcode-cli/packages/core/src/tool/handlers/saved-workflows/store.ts";

test("remote server launch uses the deployed directory and exports the same runtime root", {
  skip: process.platform === "win32",
}, () => {
  const home = mkdtempSync(join(tmpdir(), "openzwork-remote-"));
  try {
    const runtimeRoot = join(home, REMOTE_BASE.slice(2));
    mkdirSync(runtimeRoot, { recursive: true });
    const node = join(runtimeRoot, "node");
    writeFileSync(node, '#!/bin/sh\nprintf "%s\\n" "$ZCODE_SERVER_RUNTIME_ROOT" "$1"\n');
    chmodSync(node, 0o755);
    const output = execFileSync("/bin/sh", ["-c", buildRemoteServerCommand(undefined, undefined)], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    }).trimEnd().split("\n");
    assert.equal(REMOTE_BASE_HOME_EXPR, `$HOME${REMOTE_BASE.slice(1)}`);
    assert.deepEqual(output, [runtimeRoot, join(runtimeRoot, "zcode-server.cjs")]);
    assert.equal(existsSync(join(home, ".zcode")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("remote Agent wrapper falls back to the deployed node without reading the old root", {
  skip: process.platform === "win32",
}, () => {
  const home = mkdtempSync(join(tmpdir(), "openzwork-agent-"));
  try {
    const runtimeRoot = join(home, REMOTE_BASE.slice(2));
    mkdirSync(runtimeRoot, { recursive: true });
    const node = join(runtimeRoot, "node");
    writeFileSync(node, '#!/bin/sh\nprintf "%s\\n" "$1" "$2"\n');
    chmodSync(node, 0o755);
    const wrapper = join(home, "zcode-agent");
    writeFileSync(wrapper, buildRemoteAgentBundleWrapper("test-provider"));
    const output = execFileSync("/bin/sh", [wrapper, "hello"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, ZCODE_SERVER_RUNTIME_ROOT: "" },
    }).trimEnd().split("\n");
    assert.deepEqual(output, [join(runtimeRoot, "agents/test-provider/zcode.cjs"), "hello"]);
    assert.equal(existsSync(join(home, ".zcode")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("global saved workflow writes, lists, and resolves only under the OpenZWork root", () => {
  const home = mkdtempSync(join(tmpdir(), "openzwork-workflow-"));
  const cwd = join(home, "project");
  try {
    mkdirSync(cwd);
    const saved = saveSavedWorkflow({
      cwd,
      homeDir: home,
      scope: "global",
      name: "isolation-check",
      meta: { description: "Verify the global directory" },
      script: "return 42;\n",
    });
    assert.equal(saved.path, join(home, ".openzwork/workflows/isolation-check.dwf.ts"));
    assert.equal(saved.path, join(savedWorkflowRoot(cwd, "global", { homeDir: home }).dir, "isolation-check.dwf.ts"));
    assert.ok(readFileSync(saved.path, "utf8").includes("return 42;"));
    assert.equal(listSavedWorkflows({ cwd, homeDir: home }).entries[0]?.name, "isolation-check");
    const resolved = resolveSavedWorkflow({ cwd, homeDir: home, name: "isolation-check" });
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.scope, "global");
      assert.equal(resolved.script, "return 42;\n");
    }
    assert.equal(existsSync(join(home, ".zcode")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
