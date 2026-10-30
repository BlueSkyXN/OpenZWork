import type { ProviderModelDiscoveryDialogProps } from "./contract.js";
export const discoveryExample: Pick<
  ProviderModelDiscoveryDialogProps,
  "providerId" | "open" | "models"
> = {
  providerId: "example",
  open: false,
  models: [],
};
