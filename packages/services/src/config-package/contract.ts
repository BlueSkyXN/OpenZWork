import { ServiceChannels, type ConfigCategory, type ConfigExportResult } from "@zcode/shared";
import { createServiceDescriptor } from "#src/descriptors.js";

export interface IConfigPackageService {
  exportToFile(path: string, categories: ConfigCategory[]): Promise<ConfigExportResult>;
}
export const IConfigPackageService = createServiceDescriptor<IConfigPackageService>(
  ServiceChannels.ConfigPackage,
);
