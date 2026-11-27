import {
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { setDataBaseDir } from "@zcode/services/node";
import { open as openZip } from "yauzl";
import {
  collectLogArchiveFiles,
  createLogArchiveArtifacts,
  writeLogArchiveDirectory,
  writeLogArchiveZip,
} from "../src/main/exportLogs.js";

function zipEntries(archive: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    openZip(archive, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("Missing ZIP"));
      const names: string[] = [];
      zip.on("entry", (entry) => names.push(entry.fileName));
      zip.once("error", reject);
      zip.once("end", () => resolve(names.sort()));
    });
  });
}

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
    const binary = Buffer.alloc(8193, 0xff);
    await writeFile(join(source, "sample.bin"), binary);
    await link(join(source, "credential-secret"), join(source, "linked.log"));
    const files = await collectLogArchiveFiles(source);
    expect(files.map((file) => file.archivePath)).toEqual(["normal.log", "sample.bin"]);
    const artifacts = { files, aboutContent: "fixture" };
    const folder = join(root, "result");
    const archive = join(root, "result.zip");
    await writeLogArchiveDirectory(folder, artifacts);
    await writeLogArchiveZip(archive, artifacts, { stageRootDir: join(root, "stage") });
    expect(await readFile(join(folder, "normal.log"), "utf8")).toBe("fixture");
    const archived = await zipEntries(archive);
    expect(archived).toEqual(["about.txt", "normal.log", "sample.bin"]);
    expect(await readFile(join(folder, "sample.bin"))).toEqual(binary);
    if (process.platform !== "win32") {
      expect((await stat(folder)).mode & 0o077).toBe(0);
      expect((await stat(archive)).mode & 0o077).toBe(0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("OW-P053：源范围内的自定义凭据文件和备份也排除，轮转后的普通文件跳过", async () => {
  const root = await mkdtemp(join(tmpdir(), "oz-diagnostic-identity-"));
  try {
    const source = join(root, "source");
    await mkdir(source);
    vi.stubEnv("ZCODE_CREDENTIALS_FILE", join(source, "private-store.dat"));
    vi.stubEnv("ZCODE_CREDENTIAL_SECRET_FILE", join(source, "local-key.txt"));
    for (const name of [
      "private-store.dat",
      ".private-store.dat.bak",
      "local-key.txt",
      "stable.log",
      "rotating.log",
    ]) {
      await writeFile(join(source, name), "fixture");
    }
    const files = await collectLogArchiveFiles(source);
    expect(files.map((file) => file.archivePath)).toEqual(["rotating.log", "stable.log"]);
    await rename(join(source, "rotating.log"), join(source, "rotated.log"));
    await writeFile(join(source, "rotating.log"), "new generation");
    const result = join(root, "result");
    await writeLogArchiveDirectory(result, { files, aboutContent: "fixture" });
    expect((await readdir(result)).sort()).toEqual(["about.txt", "stable.log"]);
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")(
  "OW-P053：共享日志链接按真实范围收集，改变目标后两种导出均跳过",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "oz-diagnostic-links-"));
    try {
      const source = join(root, "source");
      const logs = join(source, "logs");
      const outside = join(root, "other");
      await mkdir(logs, { recursive: true });
      await mkdir(outside);
      await writeFile(join(logs, "normal.log"), "allowed");
      await writeFile(join(outside, "sample.log"), "fixture");
      await writeFile(join(source, "credential-secret"), "fixture");
      await symlink(join(logs, "normal.log"), join(source, "shared.log"));
      await symlink(join(source, "credential-secret"), join(source, "excluded.log"));
      await symlink(outside, join(source, "outside"), "dir");
      const files = await collectLogArchiveFiles(source);
      expect(files.map((entry) => entry.archivePath)).toEqual(["logs/normal.log", "shared.log"]);
      await rm(join(source, "shared.log"));
      await symlink(join(outside, "sample.log"), join(source, "shared.log"));

      const artifacts = { files, aboutContent: "fixture" };
      const folder = join(root, "result");
      await writeLogArchiveDirectory(folder, artifacts);
      expect(await readFile(join(folder, "logs/normal.log"), "utf8")).toBe("allowed");
      expect((await readdir(folder)).sort()).toEqual(["about.txt", "logs"]);
      const zipPath = join(root, "result.zip");
      await writeLogArchiveZip(zipPath, artifacts, { stageRootDir: join(root, "stage") });
      expect(await zipEntries(zipPath)).toEqual(["about.txt", "logs/normal.log"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("OW-P053：CLI 日志和诊断来自活动根，只从固定 HOME 读取命名配置", async () => {
  const root = await mkdtemp(join(tmpdir(), "oz-diagnostic-sources-"));
  const home = join(root, "home");
  const active = join(root, "active");
  const cli = join(active, ".openzwork/cli");
  try {
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    setDataBaseDir(active);
    const fixed = join(home, ".openzwork/cli");
    const app = join(active, ".openzwork/v2");
    for (const directory of [fixed, app, join(cli, "log"), join(cli, "memory-diagnostics")]) {
      await mkdir(directory, { recursive: true });
    }
    await writeFile(join(fixed, "config.json"), '{"locale":"en"}');
    await writeFile(join(fixed, "other.json"), "{}");
    await writeFile(join(cli, "config.json"), "{}");
    await writeFile(join(cli, "log/normal.log"), "fixture");
    const memory = "memory-123-00000000-0000-0000-0000-000000000000.jsonl";
    await writeFile(join(cli, "memory-diagnostics", memory), "{}");
    await writeFile(join(cli, "memory-diagnostics/other.jsonl"), "{}");
    if (process.platform !== "win32") {
      await symlink(fixed, join(cli, "rollout"), "dir");
      await mkdir(join(app, "logs"));
      const old = join(app, "logs/previous.log");
      await writeFile(old, "old");
      await utimes(old, new Date(0), new Date(0));
      await symlink(old, join(app, "alias.log"));
    }
    const artifacts = await createLogArchiveArtifacts(app);
    expect(artifacts.files.map((file) => file.archivePath)).toEqual([
      ".openzwork/cli/config.json",
      ".openzwork/cli/log/normal.log",
      ".openzwork/cli/memory-diagnostics/" + memory,
    ]);
    const result = join(root, "result");
    await writeLogArchiveDirectory(result, artifacts);
    const config = await readFile(join(result, ".openzwork/cli/config.json"), "utf8");
    expect(JSON.parse(config)).toEqual({ locale: "en" });
  } finally {
    setDataBaseDir(null);
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
