import { describe, expect, it, vi } from "vitest";
import type { IChannel, IChannelClient } from "@zcode/rpc";
import { IMediaPreviewService } from "@zcode/services";
import { RemoteServiceAccess } from "../src/remoteServiceAccess.js";

describe("RemoteServiceAccess", () => {
  it("creates the media preview proxy for every remote service connection", () => {
    const channelNames: string[] = [];
    const channel: IChannel = {
      call: vi.fn(),
      listen: vi.fn(),
    };
    const channelClient: IChannelClient = {
      getChannel: (channelName) => {
        channelNames.push(channelName);
        return channel;
      },
    };

    const services = new RemoteServiceAccess(channelClient);

    expect(channelNames).toContain(IMediaPreviewService.channelName);
    expect(services.mediaPreviewService).toBeDefined();
  });
});
