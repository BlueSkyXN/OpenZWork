/* eslint-disable max-lines -- 模型供应商 schema、迁移和运行时投影 helper 需要共享同一套类型边界，暂时集中在单文件避免契约分散。 */

/** 旧版官方模板 id；仅供 legacy config.json 升级导入链把 builtin:* 映射到用户自有模板。 */
export const BUILTIN_PROVIDER_TEMPLATE_IDS = {
  zai: "zai-api",
  bigmodel: "bigmodel-api",
} as const;

/**
 * 已下线的官方套餐 provider id（账号链移除后不再产生新记录）。
 * 仅允许两类被动兼容消费：历史记录归组 / 展示标签解析，不得用于新连接或鉴权。
 */
const LEGACY_ACCOUNT_MODEL_PROVIDER_IDS = {
  zaiIndividualCodingPlan: "account:zai-individual-coding-plan",
  zaiTeamCodingPlan: "account:zai-team-coding-plan",
  zaiStartPlan: "account:zai-start-plan",
  bigmodelIndividualCodingPlan: "account:bigmodel-individual-coding-plan",
  bigmodelTeamCodingPlan: "account:bigmodel-team-coding-plan",
  bigmodelStartPlan: "account:bigmodel-start-plan",
} as const;

/** Start Plan 历史数据在模型选择 facade 里必须分类为普通连接，不参与付费额度判断。 */
export function isStartPlanModelProviderId(id: string): boolean {
  return (
    id === LEGACY_ACCOUNT_MODEL_PROVIDER_IDS.zaiStartPlan ||
    id === LEGACY_ACCOUNT_MODEL_PROVIDER_IDS.bigmodelStartPlan
  );
}

export type ModelProviderFamilyId = "zai" | "bigmodel";

const MODEL_PROVIDER_FAMILY_LABELS: Record<ModelProviderFamilyId, string> = {
  zai: "Z.ai",
  bigmodel: "BigModel",
};

const MODEL_PROVIDER_FAMILY_ID_BY_PROVIDER_ID = new Map<string, ModelProviderFamilyId>([
  [LEGACY_ACCOUNT_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan, "zai"],
  [LEGACY_ACCOUNT_MODEL_PROVIDER_IDS.zaiTeamCodingPlan, "zai"],
  [LEGACY_ACCOUNT_MODEL_PROVIDER_IDS.zaiStartPlan, "zai"],
  [LEGACY_ACCOUNT_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan, "bigmodel"],
  [LEGACY_ACCOUNT_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan, "bigmodel"],
  [LEGACY_ACCOUNT_MODEL_PROVIDER_IDS.bigmodelStartPlan, "bigmodel"],
]);

/** 历史官方 provider id 的家族归属解析；未知 id 一律返回 null，不做猜测。 */
export function resolveModelProviderFamilyIdByProviderId(
  providerId: string,
): ModelProviderFamilyId | null {
  return MODEL_PROVIDER_FAMILY_ID_BY_PROVIDER_ID.get(providerId) ?? null;
}

/** 历史官方 provider id 的展示标签；未知 id 返回 null，由调用方按自有 provider 兜底。 */
export function resolveModelProviderFamilyLabelByProviderId(providerId: string): string | null {
  const familyId = resolveModelProviderFamilyIdByProviderId(providerId);
  return familyId === null ? null : MODEL_PROVIDER_FAMILY_LABELS[familyId];
}

/** 一个正式 Model 的连通性测试结果。 */
export type ModelConnectivityResult =
  | { readonly success: true }
  | {
      readonly success: false;
      readonly error: {
        readonly message: string;
        /** 设置连接测试边界已确认的资格失败；其他执行错误保留原消息。 */
        readonly code?: "provider-unavailable" | "model-unavailable";
      };
    };
