import { prepareWebRemoteControlSessionEventsFixture } from "./web-remote-control-session-events-fixture.js";

/** 保留的手机工作区与会话场景复用当前设备配对 fixture。 */
export async function prepareWebRemoteControlAuthGateFixture(options: {
  specs: string[];
  credentialsFile: string;
  settingsFile: string;
  workspacePath: string;
}): Promise<(() => Promise<void>) | null> {
  if (
    options.specs.some(
      (spec) =>
        spec.endsWith("conversation-session-virtual-project-mobile.test.ts") ||
        spec.endsWith("conversation-session-web-remote-project-directory.test.ts") ||
        spec.endsWith("conversation-session-web-remote-unread.test.ts"),
    )
  )
    return prepareWebRemoteControlSessionEventsFixture({
      ...options,
      webUrl: "http://127.0.0.1:5173/remote/v4",
    });
  if (options.specs.some((spec) => spec.endsWith("web-remote-control-session-events.test.ts")))
    return prepareWebRemoteControlSessionEventsFixture(options);
  return null;
}
