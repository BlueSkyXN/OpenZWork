import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TID_TASK_SETTINGS_BUTTON, TID_WORKSPACE_HELP_MENU_TRIGGER } from "@zcode/shared/test-ids";
import {
  getAllWindowInfo,
  switchToWorkspaceRendererWindow,
  waitForTestIdByDom,
} from "#e2e/helpers/desktop-app";
import { sel } from "#e2e/helpers/selectors";
import { skipOccupationOnboardingIfPresent } from "#e2e/helpers/occupation-onboarding";

async function expectProductWindowTitle() {
  await switchToWorkspaceRendererWindow("");
  await skipOccupationOnboardingIfPresent();
  // 桌面壳的品牌不依赖选中的项目；等待设置入口，避免旧 helper 的 ZCodeProject 路径假设。
  await waitForTestIdByDom(TID_TASK_SETTINGS_BUTTON);
  await expect(browser).toHaveTitle("OpenZWork");
  const currentUrl = await browser.getUrl();
  await browser.waitUntil(
    async () => {
      const window = (await getAllWindowInfo()).find((entry) => entry.url === currentUrl);
      return window?.title === "OpenZWork";
    },
    { timeoutMsg: "桌面页面已就绪，但原生窗口标题未显示 OpenZWork" },
  );
}

describe("桌面产品名称", () => {
  afterEach(async function () {
    const artifactDir = process.env.ZCODE_E2E_ARTIFACT_DIR;
    if (!artifactDir) return;
    await mkdir(artifactDir, { recursive: true });
    const marker = this.currentTest?.title.startsWith("DPN-03") ? "DPN-03" : "DPN-04";
    const page = await browser.execute(() => ({
      title: document.title,
      url: location.href,
      body: document.body.innerText,
      testIds: Array.from(document.querySelectorAll("[data-testid]")).map((element) =>
        element.getAttribute("data-testid"),
      ),
    }));
    await writeFile(
      join(artifactDir, `${marker}.json`),
      JSON.stringify({ page, windows: await getAllWindowInfo() }, null, 2),
    );
    await browser.saveScreenshot(join(artifactDir, `${marker}.png`));
    await browser.keys("Escape");
  });
  it("DPN-03：启动和页面重载后保持 OpenZWork 页面与原生窗口标题", async () => {
    // 只改 BrowserWindow 初始标题会被旧 HTML title 覆盖，必须读取加载后的真实原生标题。
    await expectProductWindowTitle();

    await browser.refresh();
    await expectProductWindowTitle();
  });

  it("DPN-04：工作区帮助菜单显示 OpenZWork", async () => {
    await switchToWorkspaceRendererWindow("");
    await skipOccupationOnboardingIfPresent();
    await waitForTestIdByDom(TID_WORKSPACE_HELP_MENU_TRIGGER);
    await $(sel(TID_WORKSPACE_HELP_MENU_TRIGGER)).click();
    // 菜单展开动画期间 getText 可能返回空串，等待目标项可见后再断言完整品牌文案。
    const about = $(
      '//*[@role="menuitem" and (normalize-space(.)="About OpenZWork" or normalize-space(.)="关于 OpenZWork")]',
    );
    await expect(about).toBeDisplayed();
    await expect(about).toHaveText(/^(About|关于) OpenZWork$/u);
  });
});
