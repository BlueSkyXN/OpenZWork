import { configPackageSchema } from "./contract.js";

export const emptyCommands = configPackageSchema.parse({
  formatVersion: 1,
  appVersion: "1.0.0",
  sourcePlatform: "linux",
  sourceHomeDir: "/home/example",
  exportedAt: "2026-01-01T00:00:00.000Z",
  categories: { commands: { entries: [], payload: { sourceHomeDir: "/home/example", items: [] } } },
});
