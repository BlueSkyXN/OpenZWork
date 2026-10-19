import { homedir } from "node:os";
import { join } from "node:path";
import { OPENZWORK_DATA_DIR_NAME } from "@zcode/shared";

export function getDefaultSessionDbPath(): string {
  return join(homedir(), OPENZWORK_DATA_DIR_NAME, "cli", "db", "db.sqlite");
}
