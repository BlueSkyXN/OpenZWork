import { ChannelClient, ChannelServer, createQueuePair, Emitter, ProxyChannel } from "@zcode/rpc";
import type { AgentLaneResourceSample } from "@zcode/shared";
import { describe, expect, it } from "vitest";
import { IZCodeAgentService } from "#src/zcode-agent/zcodeAgent.js";

describe("ZCode Agent resource telemetry RPC", () => {
  it.each([0, 50])(
    "uses an explicit dynamic event with %ims client queue latency without conversation state",
    async (latency) => {
      let markSubscribed!: () => void;
      const subscribed = new Promise<void>((resolve) => {
        markSubscribed = resolve;
      });
      const emitter = new Emitter<AgentLaneResourceSample>({
        onWillAddFirstListener: markSubscribed,
      });
      const [serverProtocol, clientProtocol] = createQueuePair();
      const server = new ChannelServer(serverProtocol, "test");
      const timers: ReturnType<typeof setTimeout>[] = [];
      const client = new ChannelClient({
        onMessage: clientProtocol.onMessage,
        send(buffer) {
          timers.push(setTimeout(() => clientProtocol.send(buffer), latency));
        },
      });
      server.registerChannel(
        IZCodeAgentService.channelName,
        ProxyChannel.fromService({
          onDynamicProcessResourceSample() {
            return emitter.event;
          },
        }),
      );
      const service = ProxyChannel.toService<IZCodeAgentService>(
        client.getChannel(IZCodeAgentService.channelName),
      );
      // lane 与 heap 等新字段必须原样穿过 RPC：远端 workspace 的样本靠这条链路回到 main。
      const sample: AgentLaneResourceSample = {
        arch: "x64",
        cpuCores: 2,
        cpuPercent: 25,
        heapUsedKb: 40_000,
        instanceToken: "9f2c4a1b7d0e5638",
        intervalMs: 60_000,
        lane: "chat",
        logicalCpuCount: 8,
        platform: "linux",
        rssKb: 128_000,
        totalMemoryGb: 32,
        uptimeMinutes: 7,
      };

      try {
        const received = new Promise<AgentLaneResourceSample>((resolve) => {
          service.onDynamicProcessResourceSample()(resolve);
        });
        // OW-P008：RPC 订阅经过异步队列；固定等 20ms 会在监听器注册前丢失一次性样本。
        // Emitter 注册首个监听器后发出就绪信号，再校验同一条动态事件的完整载荷。
        await subscribed;
        emitter.fire(sample);

        await expect(received).resolves.toEqual(sample);
      } finally {
        client.dispose();
        for (const timer of timers) clearTimeout(timer);
        server.dispose();
        emitter.dispose();
      }
    },
  );
});
