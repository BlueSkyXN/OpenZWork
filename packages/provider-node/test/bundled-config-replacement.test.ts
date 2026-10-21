import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { materializeZCodeBuiltinProviderConfig } from "../src/index.js";
import * as persistence from "@zcode/shared/node";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function environmentRoot() {
  const root = await mkdtemp(join(tmpdir(), "todo104-bundled-"));
  roots.push(root);
  return root;
}
function release(revision: number) {
  return JSON.stringify({
    schemaVersion: 1,
    revision,
    config: {
      providerConfigRules: { providerRules: [], templateRules: [] },
      modelConfigRules: {
        modelRules: [],
        modelApiRules: [],
        providerSiteRules: [],
        templateModelRules: [],
        builtinProviderModelRules: [],
      },
    },
  });
}

it("同内容并发启动复用固定资源且不改写文件", async () => {
  const environmentConfigRoot = await environmentRoot();
  const options = { environmentConfigRoot, content: release(1) };
  const file = await materializeZCodeBuiltinProviderConfig(options);
  const before = await stat(file, { bigint: true });
  expect(
    await Promise.all(
      Array.from({ length: 8 }, () => materializeZCodeBuiltinProviderConfig(options)),
    ),
  ).toEqual(Array(8).fill(file));
  expect((await stat(file, { bigint: true })).mtimeNs).toBe(before.mtimeNs);
  expect(await readdir(dirname(file))).toEqual(["zcode-builtin.json"]);
});

it("替换期间并发读取只见完整旧版或新版，不产生 hash 历史文件", async () => {
  const environmentConfigRoot = await environmentRoot();
  const file = await materializeZCodeBuiltinProviderConfig({
    environmentConfigRoot,
    content: release(1),
  });
  for (let index = 0; index < 30; index++) {
    const revision = (index % 2) + 1;
    const writer = materializeZCodeBuiltinProviderConfig({
      environmentConfigRoot,
      content: release(revision),
    });
    // 无结束条件的紧密读取循环会持续竞争 Windows rename 的句柄。
    // 每轮保留真实并发读写和完整性断言，以有限读负载验证原子替换，而非无限负载下的写入公平性。
    const reader = (async () => {
      for (let read = 0; read < 8; read++) {
        const fileContent = JSON.parse(await readFile(file, "utf8"));
        expect([1, 2]).toContain(fileContent.revision);
        expect(fileContent).toEqual(JSON.parse(release(fileContent.revision)));
      }
    })();
    await Promise.all([writer, reader]);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(JSON.parse(release(revision)));
  }
  expect(await readdir(dirname(file))).toEqual(["zcode-builtin.json"]);
});

it("资源校验或原子写入失败时保留旧内容，错误向调用方报告", async () => {
  const environmentConfigRoot = await environmentRoot();
  const file = await materializeZCodeBuiltinProviderConfig({
    environmentConfigRoot,
    content: release(1),
  });
  const before = await readFile(file, "utf8");
  await expect(
    materializeZCodeBuiltinProviderConfig({ environmentConfigRoot, content: "{}" }),
  ).rejects.toThrow();
  vi.spyOn(persistence, "atomicWritePrivateTextFile").mockRejectedValueOnce(
    new Error("fixture write failure"),
  );
  await expect(
    materializeZCodeBuiltinProviderConfig({ environmentConfigRoot, content: release(2) }),
  ).rejects.toThrow("fixture write failure");
  expect(await readFile(file, "utf8")).toBe(before);
  expect(await readdir(dirname(file))).toEqual(["zcode-builtin.json"]);
});
