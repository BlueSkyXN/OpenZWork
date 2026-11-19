import type { IConfigPackageService } from "./contract.js";

export function exportCommands(service: IConfigPackageService, selectedPath: string) {
  return service.exportToFile(selectedPath, ["commands"]);
}
