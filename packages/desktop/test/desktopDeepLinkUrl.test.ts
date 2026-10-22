import { describe, expect, it } from "vitest";

describe("desktop deep link url helpers", () => {
  it("recognizes workspace open urls and extracts the encoded folder path", async () => {
    const { extractWorkspaceOpenPath, isWorkspaceOpenUrl } =
      await import("../src/main/desktopDeepLinkUrl.js");

    const workspaceUrl = new URL("openzwork://workspace/open?path=%2FUsers%2Fdemo%2FProject%20A%26B");
    expect(isWorkspaceOpenUrl(workspaceUrl)).toBe(true);
    expect(extractWorkspaceOpenPath(workspaceUrl)).toBe("/Users/demo/Project A&B");
    expect(isWorkspaceOpenUrl(new URL("openzwork://workspace/other?path=%2Ftmp"))).toBe(false);
    expect(extractWorkspaceOpenPath(new URL("openzwork://workspace/open"))).toBeNull();
  });

  it.each(["openzwork://workspace/open/", "openzwork:/workspace/open", "openzwork:workspace/open"])(
    "保留跨平台工作区路径规范化: %s",
    async (url) => {
      const { isWorkspaceOpenUrl, extractWorkspaceOpenPath } =
        await import("../src/main/desktopDeepLinkUrl.js");
      expect(isWorkspaceOpenUrl(new URL(url + "?path=%2Ftmp%2Fdemo"))).toBe(true);
      expect(extractWorkspaceOpenPath(new URL(url + "?path=%2Ftmp%2Fdemo"))).toBe("/tmp/demo");
      expect(isWorkspaceOpenUrl(new URL("https://workspace/open?path=%2Ftmp"))).toBe(false);
    },
  );

  it("extracts workspace protocol urls from desktop argv variants", async () => {
    const { extractDeepLinkUrlFromArgs } = await import("../src/main/desktopDeepLinkUrl.js");
    const url = "openzwork://workspace/open?path=%2Ftmp%2Fdemo%20A";
    for (const args of [
      ["/opt/ZCode/zcode", url],
      ["/opt/ZCode/zcode", "--open-url=" + url],
      ["/opt/ZCode/zcode", encodeURIComponent(url)],
      ["/opt/ZCode/zcode", encodeURIComponent(encodeURIComponent(url))],
      ["/opt/ZCode/zcode", "openzwork://workspace/open", "?path=%2Ftmp%2Fdemo%20A"],
    ]) {
      expect(extractDeepLinkUrlFromArgs(args)).toBe(url);
    }
    expect(extractDeepLinkUrlFromArgs([url + "&amp;source=test"])).toBe(url + "&source=test");
  });

  it("returns null when argv does not contain a deep link", async () => {
    const { extractDeepLinkUrlFromArgs } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(extractDeepLinkUrlFromArgs(["/opt/ZCode/zcode", "--no-sandbox"])).toBeNull();
  });

  it("extracts Windows open workspace argv without URL decoding", async () => {
    const { extractOpenWorkspacePathFromArgs } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(
      extractOpenWorkspacePathFromArgs([
        "C:\\Program Files\\ZCode\\ZCode.exe",
        "--open-workspace",
        "C:\\Users\\demo\\Project A&B#1",
      ]),
    ).toBe("C:\\Users\\demo\\Project A&B#1");
    expect(
      extractOpenWorkspacePathFromArgs([
        "C:\\Program Files\\ZCode\\ZCode.exe",
        "--open-workspace=C:\\Users\\demo\\Project%20A",
      ]),
    ).toBe("C:\\Users\\demo\\Project%20A");
    expect(extractOpenWorkspacePathFromArgs(["ZCode.exe", "--open-workspace", 'C:"'])).toBe("C:\\");
    expect(extractOpenWorkspacePathFromArgs(["ZCode.exe", "--open-workspace", 'C:\\repo"'])).toBe(
      "C:\\repo\\",
    );
    expect(extractOpenWorkspacePathFromArgs(["ZCode.exe", "--open-workspace"])).toBeNull();
  });

  it("passes parsed deep links through single instance additionalData", async () => {
    const {
      createDeepLinkSingleInstanceData,
      extractDeepLinkUrlFromSingleInstanceData,
      extractOpenWorkspacePathFromSingleInstanceData,
    } = await import("../src/main/desktopDeepLinkUrl.js");

    const additionalData = createDeepLinkSingleInstanceData([
      "/opt/ZCode/zcode",
      encodeURIComponent(encodeURIComponent("openzwork://workspace/open?path=%2Ftmp%2Fdemo")),
      "--open-workspace=C:\\Users\\demo\\Project A",
    ]);

    expect(extractDeepLinkUrlFromSingleInstanceData(additionalData)).toBe(
      "openzwork://workspace/open?path=%2Ftmp%2Fdemo",
    );
    expect(extractOpenWorkspacePathFromSingleInstanceData(additionalData)).toBe(
      "C:\\Users\\demo\\Project A",
    );
    expect(extractDeepLinkUrlFromSingleInstanceData({ deepLinkUrl: "https://example.com" })).toBe(
      null,
    );
  });

  it("builds Windows Explorer registry operations for folder context menu", async () => {
    const { buildWindowsOpenFolderCommand, buildWindowsOpenFolderRegistryOperations } =
      await import("../src/main/desktopWindowsOpenFolderContextMenu.js");

    expect(buildWindowsOpenFolderCommand("C:\\Program Files\\ZCode\\ZCode.exe")).toBe(
      '"C:\\Program Files\\ZCode\\ZCode.exe" --open-workspace "%1"',
    );
    expect(
      buildWindowsOpenFolderCommand("C:\\Electron\\electron.exe", ["C:\\repo\\desktop\\main.js"]),
    ).toBe('"C:\\Electron\\electron.exe" "C:\\repo\\desktop\\main.js" --open-workspace "%1"');

    const operations = buildWindowsOpenFolderRegistryOperations({
      executablePath: "C:\\Program Files\\ZCode\\ZCode.exe",
      locale: "en-US",
    });

    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\ZCode.OpenInZCode\\command",
        "/ve",
        "/d",
        '"C:\\Program Files\\ZCode\\ZCode.exe" --open-workspace "%1"',
        "/f",
      ],
    });
    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Drive\\shell\\ZCode.OpenInZCode\\command",
        "/ve",
        "/d",
        '"C:\\Program Files\\ZCode\\ZCode.exe" --open-workspace "%1"',
        "/f",
      ],
    });
  });

  it("builds localized Windows Explorer registry menu labels", async () => {
    const { buildWindowsOpenFolderRegistryOperations, getWindowsOpenFolderMenuName } =
      await import("../src/main/desktopWindowsOpenFolderContextMenu.js");

    expect(getWindowsOpenFolderMenuName("zh-CN")).toBe("在ZCode中打开");
    expect(getWindowsOpenFolderMenuName("en-US")).toBe("Open in ZCode");

    const operations = buildWindowsOpenFolderRegistryOperations({
      executablePath: "C:\\Program Files\\ZCode\\ZCode.exe",
      locale: "zh-CN",
    });

    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\ZCode.OpenInZCode",
        "/ve",
        "/d",
        "在ZCode中打开",
        "/f",
      ],
    });
    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\ZCode.OpenInZCode",
        "/v",
        "MUIVerb",
        "/t",
        "REG_SZ",
        "/d",
        "在ZCode中打开",
        "/f",
      ],
    });
  });
});
