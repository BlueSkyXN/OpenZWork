import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { readPackagedVersionMetadata, validatePackagedVersion } from "../verify-desktop-release-version.mjs";

const version = "3.16.2+openzwork.1";
const common = {
  version,
  packageVersion: version,
  metadataVersion: version,
  upstreamVersion: "3.16.2",
  releaseRevision: "1",
  productFlavor: "production",
};
const records = [
  { ...common, platform: "macos-arm64", shortVersion: "3.16.2", nativeBuildVersion: "3.16.2.1" },
  { ...common, platform: "windows-amd64", productVersion: "3.16.2.1", nativeBuildVersion: "3.16.2.1" },
  {
    ...common,
    platform: "linux-amd64",
    debVersion: `${version}-1`,
    rpmVersion: `${version}|1`,
    pacmanVersion: `${version}-1`,
  },
];

test("真实 ASAR 归档可按本机路径读取嵌套版本元数据", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "openzwork-version-asar-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "input");
  await mkdir(join(source, "out", "metadata"), { recursive: true });
  const pkg = { version, zcodeProductFlavor: "production" };
  const metadata = { appVersion: version, upstreamVersion: "3.16.2", releaseRevision: "1" };
  await writeFile(join(source, "package.json"), JSON.stringify(pkg));
  await writeFile(join(source, "out", "metadata", "build-meta.json"), JSON.stringify(metadata));
  const require = createRequire(new URL("../../packages/desktop/package.json", import.meta.url));
  const { createPackage, extractFile } = await import(pathToFileURL(require.resolve("@electron/asar")).href);
  const archive = join(root, "app.asar");
  // 当前 ASAR API 返回已调用 end 的写入流；等待 finish 后再读，避免 Windows 读到空 payload。
  await finished(await createPackage(source, archive));
  assert.deepEqual(readPackagedVersionMetadata(archive, extractFile), { pkg, metadata });
});

test("三平台安装包版本保留修订号，任一版本字段丢失或错配都会拒绝", () => {
  for (const record of records) {
    validatePackagedVersion(record, version);
    for (const key of Object.keys(record)) {
      assert.throws(() => validatePackagedVersion({ ...record, [key]: "mismatch" }, version), key);
      const missing = { ...record };
      delete missing[key];
      assert.throws(() => validatePackagedVersion(missing, version), key);
    }
  }
});
