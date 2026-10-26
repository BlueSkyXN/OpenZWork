import assert from "node:assert/strict";

const number = "(?:0|[1-9]\\d*)";
const base = `(${number})\\.(${number})\\.(${number})`;
const versionPattern = new RegExp(`^${base}(?:\\+openzwork\\.([1-9]\\d*))?$`);
export const OPENZWORK_TAG_PATTERN = new RegExp(
  `^v${base}(?:-openzwork|\\+openzwork\\.[1-9]\\d*)$`,
);

export function parseOpenZWorkVersion(version) {
  assert.equal(typeof version, "string", "OpenZWork version must be a string");
  const match = versionPattern.exec(version);
  assert.ok(match && match[0] === version, `Invalid OpenZWork version: ${version}`);
  const components = match.slice(1, 4);
  return { version, upstreamVersion: components.join("."), revision: match[4] ?? "0", components };
}

export function formatOpenZWorkTag(version) {
  const parsed = parseOpenZWorkVersion(version);
  return `v${version}${parsed.revision === "0" ? "-openzwork" : ""}`;
}

export function parseOpenZWorkTag(tag) {
  assert.equal(typeof tag, "string", "OpenZWork tag must be a string");
  const match = OPENZWORK_TAG_PATTERN.exec(tag);
  assert.ok(match && match[0] === tag, `Invalid OpenZWork release tag: ${tag}`);
  return parseOpenZWorkVersion(tag.slice(1).replace(/-openzwork$/, ""));
}

export function compareOpenZWorkVersions(left, right) {
  const key = (version) => {
    const parsed = parseOpenZWorkVersion(version);
    return [...parsed.components, parsed.revision].map(BigInt);
  };
  const a = key(left),
    b = key(right);
  // 标准 SemVer 忽略 + 后的构建信息；发行排序必须显式比较最后的数字修订号。
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function getDesktopVersion(version) {
  const { upstreamVersion, revision, components } = parseOpenZWorkVersion(version);
  assert.ok(
    [...components, revision].every((part) => BigInt(part) <= 65535n),
    "Desktop version components must fit the Windows 0–65535 range",
  );
  return {
    appVersion: version,
    upstreamVersion,
    releaseRevision: revision,
    nativeBuildVersion: `${upstreamVersion}.${revision}`,
  };
}
