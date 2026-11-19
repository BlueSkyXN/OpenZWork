import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { CONFIG_PACKAGE_LIMITS, type ConfigPackage } from "@zcode/shared";
import { validatePackage } from "./validate.js";
import { writePrivatePackage } from "./privateFile.js";

function checkPath(path: string) {
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error("config-package.path");
}
export async function writePackage(path: string, file: ConfigPackage) {
  checkPath(path);
  await validatePackage(file);
  const json = Buffer.from(JSON.stringify(file));
  if (json.length > CONFIG_PACKAGE_LIMITS.json) throw new Error("config-package.size");
  const bytes = await promisify(gzip)(json);
  if (bytes.length > CONFIG_PACKAGE_LIMITS.compressed) throw new Error("config-package.size");
  await writePrivatePackage(path, bytes);
  return bytes.length;
}

export async function readPackage(path: string): Promise<ConfigPackage> {
  checkPath(path);
  let parsed: unknown;
  try {
    const handle = await open(path, "r");
    let compressed: Buffer;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error();
      if (stat.size > CONFIG_PACKAGE_LIMITS.compressed) throw new RangeError();
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const buffer = Buffer.allocUnsafe(64 * 1024);
        const { bytesRead } = await handle.read(buffer);
        if (!bytesRead) break;
        total += bytesRead;
        if (total > CONFIG_PACKAGE_LIMITS.compressed) throw new RangeError();
        chunks.push(buffer.subarray(0, bytesRead));
      }
      compressed = Buffer.concat(chunks, total);
    } finally {
      await handle.close();
    }
    const bytes = await promisify(gunzip)(compressed, {
      maxOutputLength: CONFIG_PACKAGE_LIMITS.json,
    });
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (
      error instanceof RangeError ||
      (error as NodeJS.ErrnoException)?.code === "ERR_BUFFER_TOO_LARGE"
    )
      throw new Error("config-package.size");
    throw new Error("config-package.unreadable");
  }
  return validatePackage(parsed);
}
