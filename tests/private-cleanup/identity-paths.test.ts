import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { buildRemoteServerCommand } from "../../packages/server/src/remote/connect.ts";
import { buildRemoteAgentBundleWrapper } from "../../packages/server/src/remote/zcodeAgentBundleWrapper.ts";
import { REMOTE_BASE, REMOTE_BASE_HOME_EXPR } from "../../packages/server/src/remote/deployShared.ts";
import { serializeSavedWorkflow } from "../../apps/zcode-cli/packages/core/src/tool/handlers/saved-workflows/frontmatter.ts";
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
    // 预置旧官方根的两份**合法** workflow：一份旧根独有，一份与即将写入新根的同名。
    // 合法性是断言强度的来源——隔离若是破的，它们必然出现在列表或解析结果里，
    // 而不是安静地掉进 invalid。空 HOME 只能证明"不写旧根"，这里补上"不读旧根"。
    const legacyRoot = join(home, ".zcode", "workflows");
    mkdirSync(legacyRoot, { recursive: true });
    const legacyOnlySource = serializeSavedWorkflow(
      { description: "legacy root only" },
      "return 'legacy-only';\n",
    );
    const legacyShadowSource = serializeSavedWorkflow(
      { description: "legacy same-name" },
      "return 'legacy';\n",
    );
    writeFileSync(join(legacyRoot, "legacy-only.dwf.ts"), legacyOnlySource);
    writeFileSync(join(legacyRoot, "isolation-check.dwf.ts"), legacyShadowSource);

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

    // 列表只含新根条目：旧根独有那份不出现，同名那份不会以旧根身份挤进 entries 或 invalid。
    const listed = listSavedWorkflows({ cwd, homeDir: home });
    assert.deepEqual(listed.entries.map((entry) => entry.name), ["isolation-check"]);
    assert.ok(listed.entries.every((entry) => !entry.path.includes(`${sep}.zcode${sep}`)));
    assert.deepEqual(listed.invalid, []);

    // 同名解析拿到新根内容；旧根独有名字按不存在处理——这是"不读旧根"的直接证据。
    const resolved = resolveSavedWorkflow({ cwd, homeDir: home, name: "isolation-check" });
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.scope, "global");
      assert.equal(resolved.script, "return 42;\n");
    }
    assert.deepEqual(resolveSavedWorkflow({ cwd, homeDir: home, name: "legacy-only" }), {
      ok: false,
      reason: "not_found",
    });

    // 旧根逐字节保持原样：不迁移、不改写、不新增文件。
    assert.equal(readFileSync(join(legacyRoot, "legacy-only.dwf.ts"), "utf8"), legacyOnlySource);
    assert.equal(readFileSync(join(legacyRoot, "isolation-check.dwf.ts"), "utf8"), legacyShadowSource);
    assert.deepEqual(readdirSync(legacyRoot).sort(), ["isolation-check.dwf.ts", "legacy-only.dwf.ts"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
