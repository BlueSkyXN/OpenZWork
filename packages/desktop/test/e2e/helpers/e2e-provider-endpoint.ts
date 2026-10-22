/** 无账号版的普通模型 fixture 不注入产品控制面地址。 */
export function getE2EProviderEndpointEnv(
  _specs: readonly string[],
  _providerPreset: string,
  _httpMode: string,
): Record<string, string> {
  return {};
}
export function shouldUseProductionE2EProviderEndpoint(
  specs: readonly string[],
  providerPreset: string,
  httpMode: string,
): boolean {
  return Object.keys(getE2EProviderEndpointEnv(specs, providerPreset, httpMode)).length > 0;
}
