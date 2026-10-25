import {
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_SETTINGS_BACK_BUTTON,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@zcode/shared/test-ids";

/** 经真实设置导航进入卡片页；启动由调用方显式指定。 */
export async function openRemoteControlSettings(options: { start?: boolean } = {}): Promise<void> {
  if (!(await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).isExisting())) {
    const settings = $(`[data-testid="${TID_TASK_SETTINGS_BUTTON}"]`);
    await settings.waitForClickable({ timeout: 60_000 });
    await settings.click();
  }
  if (!(await $('[data-testid="remote-control-settings"]').isExisting())) {
    const section = $(`[data-testid="${testId(TID_SETTINGS_SECTION_NAV, "remoteControl")}"]`);
    await section.waitForClickable({ timeout: 30_000 });
    await section.click();
  }
  await $('[data-testid="remote-control-settings"]').waitForDisplayed({ timeout: 30_000 });
  if (options.start) {
    // 等待 Main 状态投影完成，避免重开设置时把已运行连接误判为 idle。
    await browser.waitUntil(
      async () =>
        (await $('[data-testid="web-remote-control-connection-card"]').isExisting()) ||
        (await $('[data-testid="web-remote-start"]').isEnabled()),
      { timeout: 30_000 },
    );
    const start = $('[data-testid="web-remote-start"]');
    if (await start.isExisting()) {
      await start.waitForClickable({ timeout: 30_000 });
      await start.click();
    }
  }
}

export async function leaveRemoteControlSettings(): Promise<void> {
  const back = $(`[data-testid="${TID_SETTINGS_BACK_BUTTON}"]`);
  if (await back.isExisting()) {
    await back.click();
    await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).waitForExist({
      reverse: true,
      timeout: 15_000,
    });
  }
}
