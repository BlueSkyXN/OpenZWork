import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostMessageTypes, hostIncomingMessageSchema } from "@zcode/shared";
import { preinstalledToolsAgentAvailability } from "@zcode/shared/preinstalled-tools/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasPreinstalledToolsDownloadTarget,
  loadPreinstalledToolsCatalog,
} from "#src/preinstalled-tools/catalog.js";

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
  it.each([
    ["linux", "https://mirror.example.invalid/tools", undefined],
    ["darwin", "not-a-url", undefined],
    ["darwin", "", undefined],
    ["darwin", "https://mirror.example.invalid/tools", "1"],
  ] as const)(
    "derives the Agent flag from resolved %s targets with source %s",
    async (platform, mirror, expected) => {
      vi.stubEnv("ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL", mirror);
      const binDir = await mkdtemp(join(tmpdir(), "openzwork-preinstalled-bin-"));
      try {
        const hasTarget = loadPreinstalledToolsCatalog({ error: vi.fn() }, platform, "x64").then(
          hasPreinstalledToolsDownloadTarget,
        );
        expect(await preinstalledToolsAgentAvailability(binDir, hasTarget)).toBe(expected);
        expect(await preinstalledToolsAgentAvailability(undefined, hasTarget)).toBeUndefined();
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    },
  );

  it("delivers the resolved catalog to the first local Agent without gating a non-desktop launch", async () => {
    const target = Promise.withResolvers<boolean>();
    const init = hostIncomingMessageSchema.parse({
      type: HostMessageTypes.InitLocal,
      zcodeBuiltinProviderConfigFilePath: "/fixture/provider.json",
      preinstalledToolsTargetPending: true,
    });
    expect(init.type === HostMessageTypes.InitLocal && init.preinstalledToolsTargetPending).toBe(
      true,
    );
    expect(await preinstalledToolsAgentAvailability(undefined, target.promise)).toBeUndefined();
    const flag = preinstalledToolsAgentAvailability(
      "unused-for-a-downloadable-target",
      target.promise,
    );
    const decision = hostIncomingMessageSchema.parse({
      type: HostMessageTypes.PreinstalledToolsDownloadTarget,
      hasTarget: true,
    });
    if (decision.type !== HostMessageTypes.PreinstalledToolsDownloadTarget)
      throw new Error("unexpected Host message");
    target.resolve(decision.hasTarget);
    expect(await flag).toBe("1");
  });

  it("checks installed entries again when a new Agent starts without a download target", async () => {
    vi.stubEnv("ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL", "");
    const binDir = await mkdtemp(join(tmpdir(), "openzwork-preinstalled-entry-"));
    const hasTarget = loadPreinstalledToolsCatalog({ error: vi.fn() }).then(
      hasPreinstalledToolsDownloadTarget,
    );
    try {
      await mkdir(join(binDir, "leftover-directory"));
      await writeFile(join(binDir, "orphan.shim"), "{}");
      expect(await preinstalledToolsAgentAvailability(binDir, hasTarget)).toBeUndefined();
      const name = process.platform === "win32" ? "zcode-python.exe" : "zcode-python";
      const path = join(binDir, name);
      await writeFile(path, "fixture");
      await chmod(path, 0o755);
      if (process.platform === "win32") await writeFile(join(binDir, "zcode-python.shim"), "{}");
      expect(await preinstalledToolsAgentAvailability(binDir, hasTarget)).toBe("1");
      await rm(path);
      expect(await preinstalledToolsAgentAvailability(binDir, hasTarget)).toBeUndefined();
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });
});
