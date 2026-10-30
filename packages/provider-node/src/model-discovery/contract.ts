import type { ProviderConfigObject, ProviderModelDiscoveryResult } from "@zcode/provider";

/** 只读模型列表查询；配置来自所属 Environment，结果不含连接信息或凭据。 */
export interface ProviderModelDiscoveryContract {
  discover(config: ProviderConfigObject): Promise<ProviderModelDiscoveryResult>;
}
export type { ProviderModelDiscoveryResult } from "@zcode/provider";
