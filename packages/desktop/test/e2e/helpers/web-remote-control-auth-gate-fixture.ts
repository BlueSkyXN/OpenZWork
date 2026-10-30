import { prepareWebRemoteControlSessionEventsFixture } from "./web-remote-control-session-events-fixture.js";

/** 保留的手机工作区与会话场景复用当前设备配对 fixture。 */
export async function prepareWebRemoteControlAuthGateFixture(options: {
  specs: string[];
  credentialsFile: string;
  settingsFile: string;
  workspacePath: string;
  webUrl?: string;
}): Promise<(() => Promise<void>) | null> {
  if (
    options.specs.some(
      (spec) =>
        spec.endsWith("conversation-session-virtual-project-mobile.test.ts") ||
        spec.endsWith("conversation-session-composer-settlement.test.ts") ||
        spec.endsWith("conversation-session-switch-stability.test.ts") ||
        spec.endsWith("conversation-session-new-task-missing-root-mobile.test.ts") ||
        spec.endsWith("command-center-history-search.test.ts") ||
        spec.endsWith("conversation-session-web-remote-terminal.test.ts") ||
        spec.endsWith("conversation-session-runtime-restart.test.ts") ||
        spec.endsWith("conversation-session-shared-cli.test.ts") ||
        // 远程批量 runner 的 HOME 没有登录态；复用本地账号/relay，避免卡在配对链接门禁。
        spec.endsWith("conversation-session-r3-mobile.test.ts") ||
        spec.endsWith("conversation-session-r3-mobile-permission.test.ts") ||
        spec.endsWith("conversation-session-r3-soak-dual.test.ts") ||
        spec.endsWith("conversation-session-web-remote-project-directory.test.ts") ||
        spec.endsWith("conversation-session-web-remote-recovery.test.ts") ||
        spec.endsWith("conversation-session-web-remote-unread.test.ts") ||
        spec.endsWith("conversation-session-workspace-mcp-trust.test.ts") ||
        spec.endsWith("conversation-session-id-compatibility.test.ts") ||
        spec.endsWith("conversation-session-gen-ui-context.test.ts"),
    )
  )
    return prepareWebRemoteControlSessionEventsFixture({
      ...options,
      // 新回归使用独立端口；既有手机用例仍保留固定入口。
      webUrl:
        options.webUrl ??
        (options.specs.some(
          (spec) =>
            spec.endsWith("conversation-session-web-remote-terminal.test.ts") ||
            spec.endsWith("conversation-session-composer-settlement.test.ts") ||
            spec.endsWith("conversation-session-switch-stability.test.ts") ||
            spec.endsWith("conversation-session-runtime-restart.test.ts") ||
            spec.endsWith("conversation-session-shared-cli.test.ts") ||
            spec.endsWith("conversation-session-new-task-missing-root-mobile.test.ts"),
        )
          ? "http://127.0.0.1:0/remote/v4"
          : "http://127.0.0.1:5173/remote/v4"),
    });
  if (options.specs.some((spec) => spec.endsWith("mobile-event-push.test.ts")))
    return prepareWebRemoteControlSessionEventsFixture({ ...options, mobilePush: true });
  if (options.specs.some((spec) => spec.endsWith("web-remote-control-session-events.test.ts")))
    return prepareWebRemoteControlSessionEventsFixture(options);
  return null;
}
