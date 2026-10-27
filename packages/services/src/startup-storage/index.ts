import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  dataRelocationPlanSchema,
  STORAGE_RELOCATION_COMMAND,
  storageRelocationReportSchema,
} from "@zcode/shared/data-directory";
import {
  STORAGE_MIGRATION_COMMAND,
  storageMigrationReportSchema,
} from "@zcode/shared/sqlite-migrations";
import type { StartupStorageContract } from "./contract.js";
export type { StartupStorageContract, AgentStorageMigrationInput } from "./contract.js";
const execute = promisify(execFile);
const MAX_COMMAND_OUTPUT_BYTES = 256 * 1024;
export const startupStorage: StartupStorageContract = {
  async relocateAgent({ command, env, plan }) {
    const args = command.args ?? [];
    const subcommand = args.findIndex((arg) => arg === "app-server" || arg === "agent-server");
    if (subcommand < 0) throw new Error("Storage relocation requires a resolved Agent command");
    const { stdout } = await execute(
      command.command,
      [
        ...args.slice(0, subcommand),
        STORAGE_RELOCATION_COMMAND,
        JSON.stringify(dataRelocationPlanSchema.parse(plan)),
      ],
      {
        cwd: command.cwd,
        env: { ...(env ?? process.env), ...command.env },
        windowsHide: true,
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      },
    );
    storageRelocationReportSchema.parse(JSON.parse(stdout));
  },
  async migrateAgent({ command, env }) {
    const args = command.args ?? [];
    const subcommand = args.findIndex((arg) => arg === "app-server" || arg === "agent-server");
    if (subcommand < 0) throw new Error("Storage migration requires a resolved Agent command");
    const { stdout } = await execute(
      command.command,
      [...args.slice(0, subcommand), STORAGE_MIGRATION_COMMAND],
      {
        cwd: command.cwd,
        env: { ...(env ?? process.env), ...command.env },
        windowsHide: true,
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      },
    );
    try {
      const {
        version: _version,
        kind: _kind,
        ...result
      } = storageMigrationReportSchema.parse(JSON.parse(stdout));
      return result;
    } catch (cause) {
      throw new Error("Invalid storage migration completion report", { cause });
    }
  },
};
