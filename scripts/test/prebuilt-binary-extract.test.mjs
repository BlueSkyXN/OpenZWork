import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { resolveNativeSearchPrebuiltPlan } from "../native-search-tools-config.mjs";

const exec = promisify(execFile);

test("预览构建能在没有 PowerShell 的 Windows PATH 下解压 ugrep ZIP", async (t) => {
  // OW-P027：用随仓库交付的 Windows ZIP 走真实解压入口，验证产物可供打包。
  const dir = await mkdtemp(join(tmpdir(), "openzwork ZIP '"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const plan = resolveNativeSearchPrebuiltPlan({ platform: "win32", arch: "x64", env: {} });
  const { archivePath } = plan.artifacts.find((artifact) => artifact.toolId === "ugrep");
  const env = { ...process.env };
  if (process.platform === "win32") {
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "Path";
    env[pathKey] = dir;
  }
  const extractor = new URL("../prebuilt-binary-extract.mjs", import.meta.url);
  await exec(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const {extractPrebuiltArchive} = await import(process.argv[1]); " +
        "extractPrebuiltArchive({archivePath:process.argv[2],archiveExt:'zip',extractDir:process.argv[3]});",
      extractor.href,
      archivePath,
      dir,
    ],
    { env },
  );
  const binary = await readFile(join(dir, "ugrep.exe"));
  assert.equal(binary.toString("ascii", 0, 2), "MZ");
});
