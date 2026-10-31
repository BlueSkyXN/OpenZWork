import { ProviderConfigMap, ProviderTemplateMap, type ModelConfigRules } from "./config/index.js";

export interface ProviderSource<TSnapshot> {
  read(): Promise<TSnapshot>;
  onDidChange(listener: (reason: string) => void): () => void;
}

export interface ProviderConfigSnapshot {
  readonly revision: string;
  readonly zcodeBuiltinRevision: string;
  readonly personalRevision: string;
  readonly zcodeBuiltinProviders: ProviderConfigMap;
  readonly zcodeBuiltinProviderTemplates: ProviderTemplateMap;
  readonly personalProviders: ProviderConfigMap;
  readonly zcodeBuiltinModelRules: ModelConfigRules;
  readonly personalModels: ModelConfigRules;
  readonly personalProviderOrder?: readonly string[];
}

// OpenZWork 净化保留：AccountProviderConfigSnapshot 只承载 data-sync 的远端配置下发快照；
// 上游的 zhipu-account entitlement/fail-closed 机制随官方账号域剥离，states 简化为版本账本。
export interface AccountProviderStates {
  readonly personalRevision?: string;
}

export interface AccountProviderConfigSnapshot {
  readonly revision: string;
  readonly basedOnZCodeBuiltinRevision: string;
  readonly providers: ProviderConfigMap;
  readonly states?: AccountProviderStates;
}
