import { describe, expect, it, vi } from "vitest";
import { createProviderModelDiscovery } from "./index.js";

const config = {
  api: {
    type: "openai-responses" as const,
    baseUrl: "https://example.com/v1",
    headers: { "x-test": "yes" },
  },
  access: { type: "api-key" as const, apiKey: "fixture-key" },
};

describe("provider model discovery", () => {
  it("uses the saved endpoint and headers, deduplicates IDs and ignores capabilities", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: [{ id: "z", context_length: 42 }, { id: "a" }, { id: "a" }] }),
        ),
    );
    const result = await createProviderModelDiscovery(fetcher).discover(config);
    expect(result).toEqual({
      ok: true,
      models: [{ modelId: "a" }, { modelId: "z" }],
      truncated: false,
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://example.com/v1/models");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-key");
    expect(new Headers(init.headers).get("x-test")).toBe("yes");
    expect(init.redirect).toBe("error");
  });
  it("reads Messages pagination with a fixed origin and key header", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "a" }], has_more: true, last_id: "a" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "b" }], has_more: false })),
      );
    const result = await createProviderModelDiscovery(fetcher).discover({
      ...config,
      api: { ...config.api, type: "anthropic-messages" },
    });
    expect(result.ok && result.models.map((item) => item.modelId)).toEqual(["a", "b"]);
    expect(String(fetcher.mock.calls[1]?.[0])).toBe("https://example.com/v1/models?after_id=a");
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("x-api-key")).toBe("fixture-key");
  });
  it.each([
    ["https://example.com", "https://example.com/v1/models"],
    ["https://example.com/gateway/", "https://example.com/gateway/v1/models"],
    ["https://example.com/gateway/v1/", "https://example.com/gateway/v1/models"],
  ])("uses the same Messages API prefix as inference for %s", async (baseUrl, expected) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }));
    await createProviderModelDiscovery(fetcher).discover({
      ...config,
      api: { type: "anthropic-messages", baseUrl },
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(expected);
  });
  it.each([
    [401, "authentication"],
    [404, "unsupported"],
    [429, "rate-limited"],
    [500, "http-error"],
  ] as const)("sanitizes HTTP %s", async (status, error) => {
    const result = await createProviderModelDiscovery(
      async () => new Response("fixture-key private response", { status }),
    ).discover(config);
    expect(result).toEqual({ ok: false, error, status });
    expect(JSON.stringify(result)).not.toContain("fixture-key");
  });
  it("distinguishes an empty list from malformed or oversized data", async () => {
    expect(
      await createProviderModelDiscovery(async () => Response.json({ data: [] })).discover(config),
    ).toEqual({ ok: true, models: [], truncated: false });
    expect(
      await createProviderModelDiscovery(async () => Response.json({ message: "bad" })).discover(
        config,
      ),
    ).toEqual({ ok: false, error: "invalid-response" });
    expect(
      await createProviderModelDiscovery(async () => new Response("x".repeat(2_097_153))).discover(
        config,
      ),
    ).toEqual({ ok: false, error: "response-too-large" });
  });
  it("reports invalid connection and request failures without leaking details", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("private connection fixture-key");
    });
    expect(await createProviderModelDiscovery(fetcher).discover({})).toEqual({
      ok: false,
      error: "invalid-connection",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await createProviderModelDiscovery(fetcher).discover(config)).toEqual({
      ok: false,
      error: "request-failed",
    });
  });
});
