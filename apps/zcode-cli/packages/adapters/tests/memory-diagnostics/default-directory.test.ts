import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// OpenZWork（WP-03，v3.18.1 同步 B3）：上游默认把诊断写到官方数据根 .zcode/cli；
// 本仓合同是用户级 .openzwork/cli/memory-diagnostics。上游 recorder.test 只注入
// directory，不覆盖默认根；这里固定断言默认落盘根，防止后续上游同步把它带回官方根。
const homedirMock = vi.hoisted(() => vi.fn());

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: homedirMock };
});

describe("CLI 内存诊断默认落盘根（WP-03 数据根）", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("未显式传 directory 时写入 <home>/.openzwork/cli/memory-diagnostics", { timeout: 30_000 }, async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "openzwork-memdiag-home-"));
    tempDirs.push(fakeHome);
    homedirMock.mockReturnValue(fakeHome);

    const { startCliMemoryDiagnostics } = await import(
      "../../src/memory-diagnostics/index.js"
    );
    const diagnostics = startCliMemoryDiagnostics(() => ({ sessions: 1 }));
    try {
      // 采样窗口 15s（MEMORY_DIAGNOSTIC_INTERVAL_MS）；推进一个采样周期并等待落盘。
      await vi.waitFor(
        () => {
          const dir = join(fakeHome, ".openzwork", "cli", "memory-diagnostics");
          const files = readdirSync(dir);
          expect(files.length).toBeGreaterThan(0);
        },
        { timeout: 25_000, interval: 1_000 },
      );
    } finally {
      diagnostics.stop();
    }
    // 上游官方数据根不得被创建。
    expect(existsSync(join(fakeHome, ".zcode"))).toBe(false);
  });
});
