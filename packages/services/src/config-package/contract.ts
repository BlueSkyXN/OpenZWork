import {
  ServiceChannels,
  type ConfigCategory,
  type ConfigExportResult,
  type ConfigPreview,
  type ConfigSelection,
  type ConfigApplyResult,
} from "@zcode/shared";
import { createServiceDescriptor } from "#src/descriptors.js";

export interface IConfigPackageService {
  previewFile(path: string): Promise<ConfigPreview>;
  applyPreview(previewId: string, selected: ConfigSelection[]): Promise<ConfigApplyResult>;
  releasePreview(previewId: string): Promise<void>;
  exportToFile(path: string, categories: ConfigCategory[]): Promise<ConfigExportResult>;
}
export const IConfigPackageService = createServiceDescriptor<IConfigPackageService>(
  ServiceChannels.ConfigPackage,
);
