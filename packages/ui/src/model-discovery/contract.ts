import type { ProviderSettingsFormModel } from "@/lib/providerSettingsFormTypes.js";

export interface ProviderModelDiscoveryDialogProps {
  providerId: string;
  providerName?: string;
  models: readonly ProviderSettingsFormModel[];
  open: boolean;
  onOpenChange(open: boolean): void;
  onAddModel(model: ProviderSettingsFormModel): Promise<void> | void;
  onConfigure(modelId: string): void;
}
