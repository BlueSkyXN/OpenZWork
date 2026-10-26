// 七组历史测试的唯一清单；路径过滤器与组内隔离由原 Vitest 配置继续负责。
export const FULL_SUITE_GROUPS = [
  {
    name: "shared-and-rpc",
    filter: ["packages/shared", "packages/rpc", "packages/client", "packages/model-option-map"],
    minutes: 12,
  },
  { name: "services", filter: ["packages/services"], minutes: 20 },
  { name: "provider", filter: ["packages/provider", "packages/provider-node"], minutes: 12 },
  { name: "server", filter: ["packages/server", "packages/zcode-server-cli"], minutes: 12 },
  // src 保留源码旁的 contract.test.ts；仅过滤 test 会漏掉这些回归。
  { name: "desktop", filter: ["packages/desktop/test", "packages/desktop/src"], minutes: 30 },
  { name: "ui-and-web", filter: ["packages/ui", "packages/web"], minutes: 30 },
  {
    name: "root-scripts",
    filter: ["packages/shared/src/node/genUiPaths.test.ts", "packages/services/src/gen-ui"],
    minutes: 10,
  },
];

export const FULL_SUITE_SHARDS = {
  services: ["services"],
  "ui-and-web": ["ui-and-web"],
  supporting: ["shared-and-rpc", "provider", "server", "desktop", "root-scripts"],
};

export function selectFullSuiteGroups(shard) {
  if (shard === undefined) return FULL_SUITE_GROUPS;
  if (!Object.hasOwn(FULL_SUITE_SHARDS, shard)) {
    throw new Error(`Unknown full suite shard: ${shard}`);
  }
  return FULL_SUITE_GROUPS.filter((group) => FULL_SUITE_SHARDS[shard].includes(group.name));
}
