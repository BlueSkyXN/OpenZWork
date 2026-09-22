import { BUILTIN_PROVIDER_TEMPLATE_IDS } from "./model-provider-types.js";
import { normalizeOfficialGlmModelId } from "./official-glm-model-id.js";

// 不凭用户自定义 Provider 的名字猜所属站点；闲时 Ticket 的绑定身份也不能改。
// 历史 account:* 官方套餐 id 的正则分支保留：旧记录的 GLM 模型 id 归一化仍需命中。
export function migrateLegacyOfficialGlmModelId(providerId: string, modelId: string): string {
  return /^(?:builtin:(?:zai|bigmodel)(?:-start-plan|-coding-plan)?|account:(?:zai|bigmodel)-(?:start-plan|individual-coding-plan|team-coding-plan))$/.test(
    providerId,
  )
    ? normalizeOfficialGlmModelId(modelId)
    : modelId;
}

/**
 * 仅供已发布旧数据的单向升级使用，不是运行时 Provider 别名或选择兜底。
 * 依赖当前账号解释旧 Coding Plan 会使离线/SSH 迁移丢失原意图。
 * 官方账号链移除后，builtin:*-start-plan / builtin:*-coding-plan 不再映射到
 * account:* 套餐 id（改写会指向不存在的 provider）；返回 undefined 让调用方保留原文。
 * 迁移不查模型/档位是否可用；普通未知 ID 不构成旧格式证据。
 */
export function migrateLegacyModelProviderId(providerId: string): string | undefined {
  switch (providerId) {
    case "builtin:bigmodel":
      return BUILTIN_PROVIDER_TEMPLATE_IDS.bigmodel;
    case "builtin:zai":
      return BUILTIN_PROVIDER_TEMPLATE_IDS.zai;
    default:
      return providerId.startsWith("builtin:") ? undefined : providerId;
  }
}
