import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NodeZCodeBuiltinProviderConfigSource,
  decodeZCodeBuiltinRelease,
  encodeZCodeBuiltinRelease,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ZCode Built-in Release", () => {
  it("严格解析两层 Release，并拒绝缺字段和旧单层形状", () => {
    const release = decodeZCodeBuiltinRelease(releaseObject(2, "model-b"));

    expect(release.revision).toBe(2);
    expect(release.config.providers.get("builtin")?.builtinModelIds).toEqual(["model-b"]);
    expect(encodeZCodeBuiltinRelease(release)).toEqual(releaseObject(2, "model-b"));
    expect(() =>
      decodeZCodeBuiltinRelease({ schemaVersion: 1, providers: {}, models: [] }),
    ).toThrow();
    expect(() =>
      decodeZCodeBuiltinRelease({
        schemaVersion: 1,
        revision: 1,
        config: { providers: {} },
      }),
    ).toThrow();
  });

  it("拒绝远端或缓存重新发布已退出产品的 ZAPI", () => {
    const release = releaseObject(2, "model-b");

    expect(() =>
      decodeZCodeBuiltinRelease({
        ...release,
        config: {
          ...release.config,
          providerConfigRules: {
            ...release.config.providerConfigRules,
            providerRules: [
              ...release.config.providerConfigRules.providerRules,
              {
                providerId: "builtin:zapi",
                config: {
                  group: "zai-family",
                  access: {
                    type: "zhipu-account",
                    accountType: "zai",
                    mode: "start-plan",
                  },
                  builtinModelIds: ["retired-model"],
                },
              },
            ],
          },
        },
      }),
    ).toThrow("builtin:zapi");
  });

  it("启动选择兼容且 revision 最大的候选，并将它物化为活动文件", async () => {
    const root = await temporaryRoot();
    const bundledFilePath = join(root, "bundled.json");
    const activeFilePath = join(root, "cache", "active.json");
    await writeRelease(bundledFilePath, 2, "bundled-model");
    await writeRelease(activeFilePath, 3, "active-model");
    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath,
      activeFilePath,
      watch: false,
    });

    expect((await source.read()).providers.get("builtin")?.builtinModelIds).toEqual([
      "active-model",
    ]);
    expect(JSON.parse(await readFile(activeFilePath, "utf8"))).toEqual(
      releaseObject(3, "active-model"),
    );
    source.dispose();
  });

  it("损坏、过旧或不兼容 Active 不覆盖 Bundled", async () => {
    const root = await temporaryRoot();
    const bundledFilePath = join(root, "bundled.json");
    const activeFilePath = join(root, "cache", "active.json");
    await writeRelease(bundledFilePath, 4, "bundled-model");
    await writeRelease(activeFilePath, 3, "old-model");
    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath,
      activeFilePath,
      watch: false,
    });

    expect((await source.read()).providers.get("builtin")?.builtinModelIds).toEqual([
      "bundled-model",
    ]);
    expect(JSON.parse(await readFile(activeFilePath, "utf8"))).toEqual(
      releaseObject(4, "bundled-model"),
    );
    source.dispose();
  });

  it("Bundled 与 Active 的相同 revision 冲突时丢弃 Active 并以 Bundled 启动", async () => {
    const root = await temporaryRoot();
    const bundledFilePath = join(root, "bundled.json");
    const activeFilePath = join(root, "cache", "active.json");
    await writeRelease(bundledFilePath, 4, "bundled-model");
    await writeRelease(activeFilePath, 4, "other-model");
    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath,
      activeFilePath,
      watch: false,
    });

    expect((await source.read()).providers.get("builtin")?.builtinModelIds).toEqual([
      "bundled-model",
    ]);
    expect(JSON.parse(await readFile(activeFilePath, "utf8"))).toEqual(
      releaseObject(4, "bundled-model"),
    );
    source.dispose();
  });

  it("Active 缓存无法物化时仍直接使用 Bundled 完成启动", async () => {
    const root = await temporaryRoot();
    const bundledFilePath = join(root, "bundled.json");
    const activeFilePath = join(root, "cache", "active.json");
    await writeRelease(bundledFilePath, 4, "bundled-model");
    await mkdir(activeFilePath, { recursive: true });
    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath,
      activeFilePath,
      watch: false,
    });

    expect((await source.read()).providers.get("builtin")?.builtinModelIds).toEqual([
      "bundled-model",
    ]);
    source.dispose();
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zcode-builtin-release-"));
  roots.push(root);
  return root;
}

async function writeRelease(filePath: string, revision: number, modelId: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(releaseObject(revision, modelId)), "utf8");
}

function releaseObject(revision: number, modelId: string) {
  return {
    schemaVersion: 1,
    revision,
    config: {
      providerConfigRules: {
        providerRules: [
          {
            providerId: "builtin",
            config: {
              group: "zai-family",
              access: {
                type: "zhipu-account",
                accountType: "zai",
                mode: "start-plan",
              },
              builtinModelIds: [modelId],
            },
          },
        ],
        templateRules: [],
      },
      modelConfigRules: {
        modelRules: [],
        modelApiRules: [],
        providerSiteRules: [],
        templateModelRules: [],
        builtinProviderModelRules: [],
      },
    },
  };
}
