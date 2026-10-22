import { describe, expect, it } from "vitest";
import { SERVER_REMOTE_PROTOCOL_VERSION, serverRemoteInfoSchema } from "@zcode/shared";

const serverInfo = {
  serverId: "remote-server",
  version: "3.12.0",
  protocolVersion: SERVER_REMOTE_PROTOCOL_VERSION,
  authRequired: false,
  workspaces: [],
  capabilities: { desktopContinuous: true, websocketRpc: true },
};

describe("Server 能力边界", () => {
  it("旧 Server 缺少资源能力仍能解析，且不被误判为支持订阅", () => {
    const parsed = serverRemoteInfoSchema.parse(serverInfo);
    expect(parsed).toEqual(serverInfo);
    expect(parsed.capabilities.processResourceTelemetry === true).toBe(false);
    expect(parsed.protocolVersion).toBe(1);
  });

  it.each([true, false, "false"])("忽略已退役的资源遥测能力 %s", (supported) => {
    const parsed = serverRemoteInfoSchema.parse({
      ...serverInfo,
      capabilities: { ...serverInfo.capabilities, processResourceTelemetry: supported },
    });
    expect(parsed.capabilities).not.toHaveProperty("processResourceTelemetry");
  });
});
