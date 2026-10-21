import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFinderOpenFolderWorkflow } from "../src/main/desktopFinderOpenFolderWorkflow.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("desktopFinderOpenFolderWorkflow", () => {
  it("按中文 locale 写入 Finder 服务展示名", () => {
    const homeDir = createTempHome();
    const refreshServicesIndex = vi.fn();

    installFinderOpenFolderWorkflow({
      platform: "darwin",
      locale: "zh-CN",
      homeDir,
      logger: { info: vi.fn(), warn: vi.fn() },
      refreshServicesIndex,
    });

    const infoPlist = readInfoPlist(homeDir);
    expect(infoPlist).toContain("<string>在 OpenZWork 中打开</string>");
    expect(infoPlist).not.toContain("<string>Open in OpenZWork</string>");
    expect(refreshServicesIndex).toHaveBeenCalledTimes(1);
  });

  it("按英文 locale 写入 Finder 服务展示名并复用稳定 workflow 文件名", () => {
    const homeDir = createTempHome();
    const refreshServicesIndex = vi.fn();

    installFinderOpenFolderWorkflow({
      platform: "darwin",
      locale: "en-US",
      homeDir,
      logger: { info: vi.fn(), warn: vi.fn() },
      refreshServicesIndex,
    });

    const infoPlist = readInfoPlist(homeDir);
    expect(infoPlist).toContain("<string>Open in OpenZWork</string>");
    expect(infoPlist).not.toContain("<string>在 OpenZWork 中打开</string>");
    expect(infoPlist).toContain("<string>6</string>");
    expect(refreshServicesIndex).toHaveBeenCalledTimes(1);
  });

  it("使用已注册协议，并保留原版 Finder 服务文件", () => {
    const homeDir = createTempHome();
    const legacy = join(homeDir, "Library", "Services", "Open in ZCode.workflow");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "sentinel"), "upstream-service");
    installFinderOpenFolderWorkflow({ platform: "darwin", locale: "en-US", homeDir,
      logger: { info: vi.fn(), warn: vi.fn() }, refreshServicesIndex: vi.fn() });
    const document = readFileSync(join(homeDir, "Library", "Services", "Open in OpenZWork.workflow", "Contents", "document.wflow"), "utf8");
    expect(document).toContain("openzwork://workspace/open");
    expect(readFileSync(join(legacy, "sentinel"), "utf8")).toBe("upstream-service");
  });

  it("非 macOS 不安装 Finder 服务", () => {
    const homeDir = createTempHome();
    const refreshServicesIndex = vi.fn();

    installFinderOpenFolderWorkflow({
      platform: "linux",
      locale: "zh-CN",
      homeDir,
      logger: { info: vi.fn(), warn: vi.fn() },
      refreshServicesIndex,
    });

    expect(refreshServicesIndex).not.toHaveBeenCalled();
  });
});

function createTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "zcode-finder-workflow-"));
  tempDirs.push(dir);
  return dir;
}

function readInfoPlist(homeDir: string): string {
  return readFileSync(
    join(homeDir, "Library", "Services", "Open in OpenZWork.workflow", "Contents", "Info.plist"),
    "utf8",
  );
}
