import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  getFeatureBoundaryGraphStats,
  getFeatureBoundaryNeighborhood,
  type FeatureBoundaryGraph,
} from "../src/data/featureBoundaryGraph.js";
import { normalizeFeatureBoundaryGraph } from "../src/data/featureBoundaryGraphSource.js";

// OpenZWork(OW-P023)：从测试文件定位仓库根，dev-docs 内部与根 vitest 两个入口的 cwd 不同。
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const fixture: FeatureBoundaryGraph = {
  schemaVersion: 1,
  graphId: "fixture",
  purpose: "test",
  nodes: [
    {
      id: "capability.alpha",
      kind: "capability",
      label: "Alpha",
      aliases: [],
      docs: [],
      codeSeeds: [],
      invariants: [],
    },
    {
      id: "service.beta",
      kind: "service",
      label: "Beta",
      aliases: [],
      docs: [],
      codeSeeds: [],
      invariants: [],
    },
    {
      id: "state.gamma",
      kind: "state-owner",
      label: "Gamma",
      aliases: [],
      docs: [],
      codeSeeds: [],
      invariants: [],
    },
  ],
  edges: [
    {
      from: "capability.alpha",
      to: "service.beta",
      type: "served-by",
      rank: "must-inspect",
    },
    {
      from: "state.gamma",
      to: "capability.alpha",
      type: "projects-to",
      rank: "should-inspect",
    },
  ],
};

describe("feature boundary graph helpers", () => {
  it("保留节点、边和按类型统计", () => {
    expect(getFeatureBoundaryGraphStats(fixture)).toEqual({
      nodeCount: 3,
      edgeCount: 2,
      unresolvedEndpointCount: 0,
      kindCounts: {
        capability: 1,
        service: 1,
        "state-owner": 1,
      },
    });
  });

  it("返回选中节点的一阶邻居，并补出未声明端点", () => {
    const graph: FeatureBoundaryGraph = {
      ...fixture,
      edges: [
        ...fixture.edges,
        {
          from: "capability.alpha",
          to: "missing.delta",
          type: "depends-on",
          rank: "conditional",
        },
      ],
    };

    const neighborhood = getFeatureBoundaryNeighborhood(graph, "capability.alpha");
    expect(neighborhood.nodes.map((node) => node.id)).toEqual([
      "capability.alpha",
      "service.beta",
      "state.gamma",
      "missing.delta",
    ]);
    expect(neighborhood.edges).toHaveLength(3);
    expect(neighborhood.edges[2]).toMatchObject({
      source: "capability.alpha",
      target: "missing.delta",
    });
  });

  it("解析 OpenZWork feature boundary YAML，校验结构与引用边界", async () => {
    // OW-P023：生产数据测试读取 OpenZWork 版本（上游断言 324/629 的计数在上游原文同样失败），
    // 改为结构、引用与裁剪边界断言，不再断言节点总数。
    const source = await readFile(
      resolve(
        REPO_ROOT,
        ".agents/skills/feature-boundary-planner/references/zcode-feature-graph-openzwork.yaml",
      ),
      "utf8",
    );
    const graph = normalizeFeatureBoundaryGraph(parseYaml(source));
    const stats = getFeatureBoundaryGraphStats(graph);

    // 结构边界：节点与边非空、无重复节点、无重复边（from|type|to）。
    expect(stats.nodeCount).toBeGreaterThan(0);
    expect(stats.edgeCount).toBeGreaterThan(0);
    const nodeIds = graph.nodes.map((node) => node.id);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    const edgeKeys = graph.edges.map((edge) => `${edge.from}|${edge.type}|${edge.to}`);
    expect(new Set(edgeKeys).size).toBe(edgeKeys.length);

    // 引用边界：docs 与 codeSeeds 指向仓库内现存文件（normalize 后 codeSeeds 为 "symbol · file" 字符串）。
    const { stat } = await import("node:fs/promises");
    for (const node of graph.nodes) {
      for (const doc of node.docs) {
        await expect(stat(resolve(REPO_ROOT, doc))).resolves.toBeTruthy();
      }
      for (const seed of node.codeSeeds) {
        const seedFile = seed.split(" · ").pop() ?? seed;
        await expect(stat(resolve(REPO_ROOT, seedFile))).resolves.toBeTruthy();
      }
    }

    // 裁剪边界：已裁剪功能的节点不得回流（抽样代表，CUA/idle-task/oauth/遥测/分享）。
    const droppedPrefixes = [
      "capability.computer-use",
      "capability.idle-task",
      "service.oauth",
      "service.telemetry-core",
      "capability.conversation-sharing",
    ];
    for (const prefix of droppedPrefixes) {
      expect(nodeIds).not.toContain(prefix);
    }
  });
});
