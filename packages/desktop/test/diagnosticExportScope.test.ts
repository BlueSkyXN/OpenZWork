import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { open as openZip } from "yauzl";
import {
  collectLogArchiveFiles,
  writeLogArchiveDirectory,
  writeLogArchiveZip,
} from "../src/main/exportLogs.js";

it("OW-P053：完整日志只收集诊断文件，ZIP 和目录使用私有权限", async () => {
  const root = await mkdtemp(join(tmpdir(), "oz-diagnostic-export-"));
  try {
    const source = join(root, "source");
    await mkdir(source);
    for (const name of [
      "credentials.json",
      ".credentials.json.old.bak",
      "credential-secret",
      "credential-secret.invalid-fixture.bak",
      "credentials.json.key-unavailable-fixture.bak",
      "credential-source",
      "plugin-secrets.json",
      "normal.log",
    ]) {
      await writeFile(join(source, name), "fixture");
    }
    const files = await collectLogArchiveFiles(source);
    expect(files.map((file) => file.archivePath)).toEqual(["normal.log"]);
    const artifacts = { files, aboutContent: "fixture" };
    const folder = join(root, "result");
    const archive = join(root, "result.zip");
    await writeLogArchiveDirectory(folder, artifacts);
    await writeLogArchiveZip(archive, artifacts, { stageRootDir: join(root, "stage") });
    expect(await readFile(join(folder, "normal.log"), "utf8")).toBe("fixture");
    const archived = await new Promise<string[]>((resolve, reject) => {
      openZip(archive, (error, zip) => {
        if (error || !zip) return reject(error ?? new Error("Missing ZIP"));
        const names: string[] = [];
        zip.on("entry", (entry) => names.push(entry.fileName));
        zip.once("error", reject);
        zip.once("end", () => resolve(names.sort()));
      });
    });
    expect(archived).toEqual(["about.txt", "normal.log"]);
    if (process.platform !== "win32") {
      expect((await stat(folder)).mode & 0o077).toBe(0);
      expect((await stat(archive)).mode & 0o077).toBe(0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
