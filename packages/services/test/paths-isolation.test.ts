import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { OPENZWORK_DATA_DIR_NAME } from "@zcode/shared";
import {
  getAppConfigDir,
  getAgentUserInstructionsFilePath,
  getConversationWorkspaceDir,
  getDataBaseDir,
  getTasksIndexDatabasePath,
  getZCodeDataRootDir,
  setDataBaseDir,
} from "../src/paths.js";

// WP-03 数据隔离：用户级数据根的外层目录名必须是 .openzwork（内部布局 v2/、workspace/ 等不变）。
// 全部用例只做路径计算，不触真实用户数据。

test("OPENZWORK_DATA_DIR_NAME 常量为 .openzwork", () => {
  assert.equal(OPENZWORK_DATA_DIR_NAME, ".openzwork");
});

test("setDataBaseDir 覆盖后根目录落在 .openzwork 下", () => {
  const base = join(tmpdir(), "ozw-paths-test-explicit");
  setDataBaseDir(base);
  assert.equal(getDataBaseDir(), base);
  assert.equal(getZCodeDataRootDir(), join(base, ".openzwork"));
  assert.equal(getAppConfigDir(), join(base, ".openzwork", "v2"));
  assert.equal(getTasksIndexDatabasePath(), join(base, ".openzwork", "v2", "tasks-index.sqlite"));
});

test("默认（真实 HOME）根目录同样落在 .openzwork 下", () => {
  const fakeHome = join(tmpdir(), "ozw-paths-test-home");
  const previousHome = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    setDataBaseDir(fakeHome);
    const root = getZCodeDataRootDir();
    assert.equal(root, join(fakeHome, ".openzwork"));
    // 根目录名绝不能是官方版目录 .zcode。
    assert.ok(!root.endsWith(join(fakeHome, ".zcode")));
    assert.equal(
      getConversationWorkspaceDir(),
      join(fakeHome, ".openzwork", "workspace", "default"),
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
});

test("用户级个性化指令文件路径落在 .openzwork，与 Agent 读取同根", () => {
  // 2026-11-07 回归：getAgentUserInstructionsFilePath 曾硬编码 .zcode，设置页写到
  // 官方 ZCode 的 AGENTS.md 而 Agent 读 .openzwork/AGENTS.md，保存后不生效。
  const fakeHome = join(tmpdir(), "ozw-paths-test-agents-md");
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  delete process.env.USERPROFILE;
  try {
    const filePath = getAgentUserInstructionsFilePath();
    assert.equal(filePath, join(fakeHome, ".openzwork", "AGENTS.md"));
    assert.ok(!filePath.includes(".zcode"));
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
  }
});
