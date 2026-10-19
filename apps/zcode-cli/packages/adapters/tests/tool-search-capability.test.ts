import { describe, expect, it } from "vitest";
import { resolveToolSearchCapability, toolSearchHeaders } from "../src/model/tool-search.js";

describe("ToolSearch provider capability", () => {
  it("keeps the default off while exposing supported protocols", () => {
    expect(resolveToolSearchCapability("anthropic-messages", { type: "api-key" })).toEqual({
      protocolSupported: true,
      defaultEnabled: false,
    });
    expect(resolveToolSearchCapability("openai-chat-completions", { type: "api-key" })).toEqual({
      protocolSupported: false,
      defaultEnabled: false,
    });
  });
  it("adds the protocol header only when explicitly enabled", () => {
    const headers = { "Anthropic-Beta": "existing-beta", "X-Custom": "keep" };
    expect(toolSearchHeaders(headers, false)).toBe(headers);
    const enabled = toolSearchHeaders(headers, true)!;
    expect(enabled["X-Custom"]).toBe("keep");
    expect(enabled["Anthropic-Beta"]).toContain("existing-beta");
    expect(toolSearchHeaders(enabled, true)).toEqual(enabled);
  });
});
