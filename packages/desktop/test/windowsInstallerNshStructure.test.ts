import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 评审回归（2026-11-07）：NSIS 逻辑无法在 macOS 本地执行，编译测试也不覆盖分支可达性。
// 用结构断言守住三处跨命名/跨版本控制流，防止再次回归：
// 1) .openzwork 数据目录检测必须先于 listChildren 跳转（否则不可达死代码）；
// 2) 所有权清单读取必须带旧名兜底（升级时旧安装目录只有 .zcode-install-manifest）；
// 3) 卸载器日志必须双名处理（覆盖升级执行的是旧卸载器，写的是编译期旧名日志）。
const nsh = readFileSync(resolve(import.meta.dirname, "../build/installer.nsh"), "utf8");

function indexOfAll(text: string, needle: string): number[] {
  const offsets: number[] = [];
  let at = text.indexOf(needle);
  while (at !== -1) {
    offsets.push(at);
    at = text.indexOf(needle, at + 1);
  }
  return offsets;
}

describe("installer.nsh cross-name control flow", () => {
  it("detects both .zcode and .openzwork before descending into children", () => {
    const fnStart = nsh.indexOf("Function ZCodeFindNestedDataDir");
    const fnEnd = nsh.indexOf("FunctionEnd", fnStart);
    const body = nsh.slice(fnStart, fnEnd);
    const listChildrenLabel = body.indexOf("zcodeFindNestedDataDirListChildren:");
    const openzworkContent = body.indexOf('$R9\\.openzwork\\*.*"');
    const openzworkEmpty = body.indexOf(
      'IfFileExists "$R9\\.openzwork" 0 zcodeFindNestedDataDirListChildren',
    );
    expect(listChildrenLabel).toBeGreaterThan(-1);
    // 两种命名的直属检测都必须出现在递归子目录入口之前。
    expect(openzworkContent).toBeGreaterThan(-1);
    expect(openzworkContent).toBeLessThan(listChildrenLabel);
    expect(openzworkEmpty).toBeGreaterThan(-1);
    expect(openzworkEmpty).toBeLessThan(listChildrenLabel);
    // .zcode 未命中不得直接跳过 .openzwork 检测：跳转只允许出现在最后一个 .openzwork 检查上。
    const zcodeJumpToChildren = indexOfAll(
      body,
      'IfFileExists "$R9\\.zcode" 0 zcodeFindNestedDataDirListChildren',
    );
    expect(zcodeJumpToChildren).toEqual([]);
  });

  it("reads ownership manifest with the legacy name fallback", () => {
    const removeStart = nsh.indexOf("zcodeManifestRead:");
    const openNew = nsh.indexOf('FileOpen $R0 "$INSTDIR\\${ZCODE_INSTALL_MANIFEST_NAME}" r');
    const openLegacy = nsh.indexOf(
      'FileOpen $R0 "$INSTDIR\\${ZCODE_LEGACY_INSTALL_MANIFEST_NAME}" r',
    );
    expect(openNew).toBeGreaterThan(-1);
    expect(openLegacy).toBeGreaterThan(-1);
    expect(openNew).toBeLessThan(openLegacy);
    expect(openLegacy).toBeLessThan(removeStart);
  });

  it("handles the old uninstaller writing the legacy log name", () => {
    expect(nsh).toContain(
      '!define ZCODE_LEGACY_UNINSTALLER_LOG_PATH "$TEMP\\ZCode-uninstaller.log"',
    );
    // 升级前清掉旧名日志，避免旧内容串档进本次回放。
    const resetStart = nsh.indexOf("Function ZCodeResetUninstallerLog");
    const resetEnd = nsh.indexOf("FunctionEnd", resetStart);
    expect(nsh.slice(resetStart, resetEnd)).toContain(
      'Delete "${ZCODE_LEGACY_UNINSTALLER_LOG_PATH}"',
    );
    // 复审修正：Reset 以 w 模式创建空新日志，"文件存在"不能作为已写入的判据。
    // 必须按内容长度判定：空且旧名存在 → CopyFiles 归并，再回放新名。
    const showStart = nsh.indexOf("Function ZCodeShowUninstallerCleanupDetails");
    const showEnd = nsh.indexOf("FunctionEnd", showStart);
    const show = nsh.slice(showStart, showEnd);
    const sizeProbe = show.indexOf("FileSeek $R0 0 END $R3");
    const sizeBranch = show.indexOf("IntCmp $R3 0 0 zcodeShowUninstallerDetailsReplay");
    const copyLegacy = show.indexOf(
      'CopyFiles /SILENT "${ZCODE_LEGACY_UNINSTALLER_LOG_PATH}" "${ZCODE_UNINSTALLER_LOG_PATH}"',
    );
    const replayOpen = show.indexOf('FileOpen $R0 "${ZCODE_UNINSTALLER_LOG_PATH}" r', sizeBranch);
    expect(sizeProbe).toBeGreaterThan(-1);
    expect(sizeBranch).toBeGreaterThan(sizeProbe);
    expect(copyLegacy).toBeGreaterThan(sizeBranch);
    expect(replayOpen).toBeGreaterThan(copyLegacy);
    // 复审点名的错误形态不得回归：存在性判定直接跳过归并。
    expect(show).not.toContain(
      'IfFileExists "${ZCODE_UNINSTALLER_LOG_PATH}" zcodeShowUninstallerDetailsReady',
    );
  });
});
