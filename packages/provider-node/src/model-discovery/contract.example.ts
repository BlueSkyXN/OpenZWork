import type { ProviderModelDiscoveryContract } from "./contract.js";
export function readModels(adapter: ProviderModelDiscoveryContract) {
  return adapter.discover({ api: { type: "openai-responses", baseUrl: "https://example.com/v1" } });
}
