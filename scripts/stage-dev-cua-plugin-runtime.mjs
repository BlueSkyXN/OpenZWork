/** 保留 Agent 构建脚本的兼容调用；原生 CUA 不纳入产品，不读取或暂存其资源。 */
export function stageDevCuaPluginRuntime(_options = {}) {
  return [];
}
