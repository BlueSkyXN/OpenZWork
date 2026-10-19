import { describe, expect, it } from "vitest";
import {
  WebRemoteControlTerminalTransport,
  createWebRemoteControlTaskViewPublisher,
} from "#src/web-remote-control/index.js";
describe("mobile relay public boundary", () => {
  it("exposes transport and task-view publisher through the module entry", () => {
    expect(typeof WebRemoteControlTerminalTransport).toBe("function");
    const publisher = createWebRemoteControlTaskViewPublisher(() => true);
    publisher.seed("epoch");
    publisher.suspend();
  });
});
