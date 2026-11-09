import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { capabilityGroups } from "../src/data/productCapabilityMap.js";

// OpenZWork(OW-P023)：以测试文件定位 dev-docs 根，dev-docs 内部与根 vitest 的 cwd 不同。
const devDocsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ownershipDataPath = resolve(
  devDocsRoot,
  "src/data/productCapabilityOwnership.ts",
);
const capabilityMapInteractionFiles = [
  "src/capability-map/CapabilityMapView.tsx",
  "src/capability-map/CapabilityMapDetail.tsx",
  "src/capability-map/CapabilityMapFlowElements.tsx",
  "src/capability-map/capabilityMapTypes.ts",
].map((path) => resolve(devDocsRoot, path));

describe("能力图不承载具体人员分工", () => {
  it("只保留角色型 owner，不在能力群数据中写入具体人名", () => {
    // 开源前移除了真实人名黑名单：改为正向约束，owner 必须是“<职责>负责人（<Role> Owner）”形态的角色描述，
    // 具体人名无法满足该形态。
    const roleOwnerPattern = /^\S.*负责人（[A-Za-z][A-Za-z &-]* Owner）$/;

    for (const group of capabilityGroups) {
      expect(group.owner).toMatch(roleOwnerPattern);
    }
  });

  it("不保留人员职责数据或人员选择交互", async () => {
    await expect(access(ownershipDataPath)).rejects.toThrow();
    const interactionSources = (
      await Promise.all(
        capabilityMapInteractionFiles.map((path) => readFile(path, "utf8")),
      )
    ).join("\n");

    expect(interactionSources).not.toMatch(
      /CapabilityOwnershipPanel|maintainer|responsibilityKind/,
    );
  });
});
