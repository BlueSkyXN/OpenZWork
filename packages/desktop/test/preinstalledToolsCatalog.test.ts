import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPreinstalledToolsCatalog } from "#src/preinstalled-tools/catalog.js";

describe("loadPreinstalledToolsCatalog (OZ-C015)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns all five tools without targets and logs no error when ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL is unset", async () => {
    vi.stubEnv("ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL", "");
    const error = vi.fn();

    const tools = await loadPreinstalledToolsCatalog({ error });

    expect(error).not.toHaveBeenCalled();
    expect(tools?.map((tool) => tool.toolId)).toEqual([
      "python",
      "qpdf",
      "pandoc",
      "poppler",
      "libreoffice",
    ]);
    expect(tools?.every((tool) => tool.manifest === null)).toBe(true);
  });

  it("resolves ordered candidate download URLs when ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL is explicitly configured", async () => {
    vi.stubEnv(
      "ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL",
      " https://mirror-a.example.com/preinstalled/ , https://mirror-b.example.com/preinstalled ",
    );
    const error = vi.fn();

    const tools = await loadPreinstalledToolsCatalog({ error });

    expect(error).not.toHaveBeenCalled();
    expect(tools).toHaveLength(5);
    if (process.platform === "linux") {
      expect(tools?.every((tool) => tool.manifest === null)).toBe(true);
    } else {
      const configured = tools?.filter((tool) => tool.manifest !== null) ?? [];
      expect(configured.length).toBeGreaterThan(0);
      for (const item of configured) {
        expect(item.manifest?.downloadUrls[0]).toMatch(
          /^https:\/\/mirror-a\.example\.com\/preinstalled\//,
        );
        expect(item.manifest?.downloadUrls[1]).toMatch(
          /^https:\/\/mirror-b\.example\.com\/preinstalled\//,
        );
      }
    }
  });

  it("logs an error and keeps every tool target null when ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL is invalid", async () => {
    vi.stubEnv("ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL", "not-a-valid-http-url");
    const error = vi.fn();

    const tools = await loadPreinstalledToolsCatalog({ error });

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toContain("invalid ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL");
    expect(tools).toHaveLength(5);
    expect(tools?.every((tool) => tool.manifest === null)).toBe(true);
  });
});
