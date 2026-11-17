// OZ-CLH 补充（2026-11-17 J1.4）：openCommunity 本地配置链受控回归。
// desktopCommandHandlers.resolveLocalAppConfigPath 的两个产品形态都以仓库真实布局验收：
// - dev 形态（electron . 于 packages/desktop，appPath=packages/desktop）必须解析到仓库根
//   config/default.json，且 resolveCommunityUrl 按语言返回其中 community_urls；
// - packaged 形态从 resourcesPath 解析（PK01 已核包内 config 与源一致，这里验证 join 语义）。
// E2E 的 --app 入口形态 appPath 指向 out/main，上游 wdio.conf 同一机制（fec97590 同形），
// unpackaged E2E 解析不到配置属测试装配形态差异而非产品路径错误；dev 形态断言是该结论的依据。
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const desktopDir = join(repoRoot, "packages", "desktop");

vi.mock("electron", () => ({
  // dev 形态：electron . 于 packages/desktop 启动。
  app: { isPackaged: false, getAppPath: () => desktopDir },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: { openExternal: vi.fn() },
}));

const { resolveLocalAppConfigPath, resolveCommunityUrl } =
  await import("../src/main/desktopCommandHandlers.js");

const roots: string[] = [];
async function temp() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openzwork-community-")));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("openCommunity local config resolution (OZ-CLH)", () => {
  it("dev form resolves the repo-root config and returns per-locale community urls", async () => {
    const devPath = resolveLocalAppConfigPath({ appPath: desktopDir, isPackaged: false });
    expect(devPath).toBe(join(repoRoot, "config", "default.json"));

    const zhUrl = await resolveCommunityUrl({ locale: "zh-CN", logger: { warn: () => {} } });
    const enUrl = await resolveCommunityUrl({ locale: "en-US", logger: { warn: () => {} } });
    // 源 config/default.json：zh=飞书 applink、en=discord；本地链不得访问远端配置。
    expect(zhUrl).toBe(
      "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=47ag983c-8fcb-4d6d-814b-5395193a712c&qr_code=true",
    );
    expect(enUrl).toBe("https://discord.gg/z9aBcQXZQ3");
  });

  it("packaged form resolves config under resourcesPath (electron-builder layout)", async () => {
    const resources = await temp();
    await cp(join(repoRoot, "config"), join(resources, "config"), { recursive: true });

    const packagedPath = resolveLocalAppConfigPath({ isPackaged: true, resourcesPath: resources });
    expect(packagedPath).toBe(join(resources, "config", "default.json"));
  });
});
