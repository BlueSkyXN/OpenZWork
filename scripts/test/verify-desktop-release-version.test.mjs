import assert from "node:assert/strict";
import test from "node:test";
import { validatePackagedVersion } from "../verify-desktop-release-version.mjs";

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
