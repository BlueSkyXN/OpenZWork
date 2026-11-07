import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findE2EBashOutputPath,
  E2E_RUNTIME_RELATIVE_ROOT,
  E2E_RUNTIME_ROOT_REPLAY_TOKEN,
  createE2EReplayFixtureVariables,
  resolveE2EHomeDir,
  resolveE2EStorageRoot,
  resolveE2ERuntimePath,
  resolveE2ERuntimeRoot,
  resolveE2EShellPath,
  resolveE2EToolPath,
  E2E_AGENT_WORKSPACE_NAME,
} from "./e2e/helpers/e2e-runtime-paths.js";

// fork 采纳上游：我方原在文件头维护的 /tmp 路径守卫常量随上游移除（对应守卫用例已不在本文件）。
describe("Desktop E2E runtime paths", () => {
  it("writes helper files where the Agent cwd can resolve them (2026-11-07 评审回归)", async () => {
    // 评审最小复现：helper 经 resolveE2ERuntimePath 写文件，Agent 以
    // <home>/<E2E_AGENT_WORKSPACE_NAME> 为 cwd 按 .zcode-e2e 相对路径查找。
    // desktop-app 的 DEFAULT_WORKSPACE 若与运行时根不同源，这里会复现查找失败。
    const e2eHomeDir = await mkdtemp(join(tmpdir(), "ozw-runtime-root-"));
    try {
      const agentCwd = join(e2eHomeDir, E2E_AGENT_WORKSPACE_NAME);
      const helperPath = resolveE2ERuntimePath("bg-regression", "release-marker.txt");
      await mkdir(dirname(helperPath), { recursive: true });
      await writeFile(helperPath, "ready", "utf8");
      const relativeFromAgent = relative(agentCwd, helperPath);
      assert.equal(await readFile(join(agentCwd, relativeFromAgent), "utf8"), "ready");
      assert.equal(dirname(resolveE2ERuntimeRoot(e2eHomeDir)), agentCwd);
    } finally {
      await rm(e2eHomeDir, { recursive: true, force: true });
    }
  });

  it("keeps runtime files below the isolated Agent execution workspace", () => {
    const e2eHomeDir = resolve("root", "isolated-e2e-home");

    expect(resolveE2ERuntimeRoot(e2eHomeDir)).toBe(
      join(e2eHomeDir, "OpenZWorkProject", ".zcode-e2e"),
    );
    expect(resolveE2ERuntimePath("bg25", "release-child-bash")).toBe(
      join(resolveE2ERuntimeRoot(), "bg25", "release-child-bash"),
    );
  });

  it("uses portable absolute tool paths and workspace-relative shell paths", () => {
    expect(resolveE2EToolPath("bg25", "continued-work.txt")).toBe(
      resolveE2ERuntimePath("bg25", "continued-work.txt").replaceAll("\\", "/"),
    );
    expect(resolveE2EShellPath("bg25", "release-child-bash")).toBe(
      ".zcode-e2e/bg25/release-child-bash",
    );
    expect(E2E_RUNTIME_RELATIVE_ROOT).toBe(".zcode-e2e");
    expect(E2E_RUNTIME_ROOT_REPLAY_TOKEN).toBe("{{e2eRuntimeRoot}}");
    expect(createE2EReplayFixtureVariables(resolve("root", "fixture-home"))).toEqual({
      e2eRuntimeRoot: resolveE2ERuntimeRoot(resolve("root", "fixture-home")).replaceAll("\\", "/"),
    });
  });

  it("uses the existing E2E HOME precedence", () => {
    expect(
      resolveE2EHomeDir({
        cwd: resolve("root", "desktop"),
        env: { ZCODE_DATA_BASE_DIR: resolve("root", "data-base") },
      }),
    ).toBe(resolve("root", "data-base"));
    expect(
      resolveE2EHomeDir({
        cwd: resolve("root", "desktop"),
        env: {
          ZCODE_DATA_BASE_DIR: resolve("root", "data-base"),
          ZCODE_E2E_HOME_DIR: resolve("root", "explicit-home"),
        },
      }),
    ).toBe(resolve("root", "explicit-home"));
  });

  it("keeps the E2E CLI storage under the isolated .openzwork directory", () => {
    const homeDir = resolve("root", "isolated-e2e-home");

    expect(resolveE2EStorageRoot(homeDir)).toBe(join(homeDir, ".openzwork"));
  });
});

it("Bash 输出查找按 session/tool 隔离，区分清理完成与多个实际文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "e2e-output-path-"));
  const storageRoot = join(root, "storage");
  const sessionId = "session_current";
  const toolCallId = "tool_current";
  const create = async (dir: string, session = sessionId) => {
    const path = join(root, dir, session, `${toolCallId}-stdout.log`);
    await mkdir(join(root, dir, session), { recursive: true });
    await writeFile(path, "output");
    return path;
  };
  try {
    await create("zcode-bash-other", "session_other");
    const options = { tempRoot: root, storageRoot };
    expect(await findE2EBashOutputPath(sessionId, toolCallId, options)).toBeNull();
    const path = await create("zcode-bash-current");
    expect(await findE2EBashOutputPath(sessionId, toolCallId, options)).toBe(path);
    await create("zcode-bash-duplicate");
    await expect(findE2EBashOutputPath(sessionId, toolCallId, options)).rejects.toThrow("没有唯一");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
