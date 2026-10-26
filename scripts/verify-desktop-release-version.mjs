import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { getDesktopVersion } from "./openzwork-version.mjs";
import { resolveDesktopProductIdentity } from "../packages/desktop/scripts/desktop-product-identity.mjs";

const exec = promisify(execFile);

export function readPackagedVersionMetadata(archive, extractFile) {
  // ASAR 按 path.sep 拆分目录；Windows 上写死斜杠会把存在的嵌套条目误报为缺失。
  return {
    pkg: JSON.parse(extractFile(archive, "package.json").toString()),
    metadata: JSON.parse(extractFile(archive, join("out", "metadata", "build-meta.json")).toString()),
  };
}

export function validatePackagedVersion(record, version) {
  const expected = getDesktopVersion(version);
  assert.equal(record.version, expected.appVersion);
  assert.equal(record.packageVersion, expected.appVersion);
  assert.equal(record.metadataVersion, expected.appVersion);
  assert.equal(record.upstreamVersion, expected.upstreamVersion);
  assert.equal(record.releaseRevision, expected.releaseRevision);
  assert.ok(["production", "preview"].includes(record.productFlavor));
  if (record.platform === "macos-arm64") {
    assert.equal(record.shortVersion, expected.upstreamVersion);
    assert.equal(record.nativeBuildVersion, expected.nativeBuildVersion);
  } else if (record.platform === "windows-amd64") {
    assert.equal(record.nativeBuildVersion, expected.nativeBuildVersion);
    assert.equal(record.productVersion, expected.nativeBuildVersion);
  } else {
    assert.equal(record.platform, "linux-amd64");
    assert.equal(record.debVersion, `${version}-${expected.releaseRevision}`);
    assert.equal(record.rpmVersion, `${version}|${expected.releaseRevision}`);
    assert.equal(record.pacmanVersion, `${version}-${expected.releaseRevision}`);
  }
}

export async function verifyPackagedVersion({ platform, version, root = process.cwd() }) {
  const expected = getDesktopVersion(version);
  const dist = resolve(root, "packages/desktop/dist");
  const identity = resolveDesktopProductIdentity();
  const unpacked = {
    "macos-arm64": `mac-arm64/${identity.productName}.app/Contents`,
    "windows-amd64": "win-unpacked",
    "linux-amd64": "linux-unpacked",
  }[platform];
  assert.ok(unpacked, `Unsupported release platform: ${platform}`);
  const resources = join(dist, unpacked, platform === "macos-arm64" ? "Resources" : "resources");
  const require = createRequire(join(root, "packages/desktop/package.json"));
  const { extractFile } = await import(pathToFileURL(require.resolve("@electron/asar")).href);
  const archive = join(resources, "app.asar");
  const { pkg, metadata } = readPackagedVersionMetadata(archive, extractFile);
  assert.equal(pkg.zcodeProductFlavor, identity.flavor);
  const record = {
    platform,
    version,
    packageVersion: pkg.version,
    metadataVersion: metadata.appVersion,
    upstreamVersion: metadata.upstreamVersion,
    releaseRevision: metadata.releaseRevision,
    productFlavor: pkg.zcodeProductFlavor,
  };
  if (platform === "macos-arm64") {
    const plist = join(dist, unpacked, "Info.plist");
    const value = async (key) =>
      (await exec("plutil", ["-extract", key, "raw", "-o", "-", plist])).stdout.trim();
    record.shortVersion = await value("CFBundleShortVersionString");
    record.nativeBuildVersion = await value("CFBundleVersion");
  } else if (platform === "windows-amd64") {
    const executable = join(dist, unpacked, `${identity.productName}.exe`).replaceAll("'", "''");
    const { stdout } = await exec("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Item -LiteralPath '${executable}').VersionInfo | Select-Object FileVersion,ProductVersion | ConvertTo-Json -Compress`,
    ]);
    const info = JSON.parse(stdout.replace(/^\uFEFF/, ""));
    record.nativeBuildVersion = info.FileVersion;
    record.productVersion = info.ProductVersion;
  } else {
    const files = await readdir(dist);
    const asset = (extension) => {
      const matches = files.filter((name) => name.endsWith(`.${extension}`));
      assert.equal(matches.length, 1, `Expected one ${extension} package`);
      return join(dist, matches[0]);
    };
    record.debVersion = (
      await exec("dpkg-deb", ["--field", asset("deb"), "Version"])
    ).stdout.trim();
    record.rpmVersion = (
      await exec("rpm", ["-qp", "--queryformat", "%{VERSION}|%{RELEASE}", asset("rpm")])
    ).stdout.trim();
    const { stdout } = await exec("tar", ["-xOf", asset("pkg.tar.zst"), ".PKGINFO"]);
    record.pacmanVersion = /^pkgver = (.+)$/m.exec(stdout)?.[1];
  }
  validatePackagedVersion(record, expected.appVersion);
  await writeFile(join(dist, "VERSION-VERIFICATION.json"), JSON.stringify(record, null, 2) + "\n");
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  console.log(
    JSON.stringify(
      await verifyPackagedVersion({ platform: process.env.RELEASE_PLATFORM, version }),
      null,
      2,
    ),
  );
}
