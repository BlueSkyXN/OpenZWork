// ============================================================
// Protocol-level capability gating
// ============================================================

// OpenZWork(OZ-C013): Responses 协议的原生搜索。
// 有效能力 = 模型开关 ∧ 协议白名单，只在 Provider 注册表产出执行模型配置的一处合取。
// 工具暴露判断、处理器入口检查和适配层都读它的结果，不各自重算；个人层原始配置
// 不被改写（ModelConfig 不可变，本函数返回派生实例）。
import type { z } from "zod";
import { ModelConfig, ModelPropertiesConfig } from "./config/model-config.js";
import { providerApiTypeDataSchema } from "./config/provider-data-schema.js";

export type ProviderApiTypeValue = z.infer<typeof providerApiTypeDataSchema>;

const NATIVE_WEB_SEARCH_API_TYPES: ReadonlySet<ProviderApiTypeValue> = new Set([
  "anthropic-messages",
  "openai-responses",
]);

/**
 * 协议不在白名单时，执行注册表中的原生联网搜索有效能力恒为 false；
 * 白名单内或开关本就关闭时原样返回，避免无谓的实例派生。
 */
export function applyProtocolNativeWebSearchCapability(
  modelConfig: ModelConfig,
  apiType: ProviderApiTypeValue,
): ModelConfig {
  if (NATIVE_WEB_SEARCH_API_TYPES.has(apiType)) return modelConfig;
  if (modelConfig.properties?.supportsNativeWebSearch !== true) return modelConfig;
  return modelConfig.overlay(
    new ModelConfig({
      properties: new ModelPropertiesConfig({
        ...modelConfig.properties.toJSON(),
        supportsNativeWebSearch: false,
      }),
    }),
  );
}
