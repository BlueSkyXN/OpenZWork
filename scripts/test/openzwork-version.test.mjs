import assert from "node:assert/strict";
import test from "node:test";
import {
  compareOpenZWorkVersions,
  formatOpenZWorkTag,
  getDesktopVersion,
  parseOpenZWorkTag,
  parseOpenZWorkVersion,
} from "../openzwork-version.mjs";

test("官方基准优先，同基准按修订号数值排序，无后缀按零处理", () => {
  const versions = [
    "3.16.2",
    "3.16.2+openzwork.1",
    "3.16.2+openzwork.999",
    "3.16.3",
    "3.16.3+openzwork.1",
    "3.16.3+openzwork.2",
    "3.16.3+openzwork.10",
    "3.17.0",
    "4.0.0",
  ];
  for (let i = 0; i < versions.length; i++) {
    assert.equal(compareOpenZWorkVersions(versions[i], versions[i]), 0);
    for (const later of versions.slice(i + 1)) {
      assert.equal(compareOpenZWorkVersions(versions[i], later), -1);
      assert.equal(compareOpenZWorkVersions(later, versions[i]), 1);
    }
  }
  assert.equal(compareOpenZWorkVersions("3.9.0", "3.10.0"), -1);
  assert.equal(
    compareOpenZWorkVersions(
      "3.16.3+openzwork.9007199254740992",
      "3.16.3+openzwork.9007199254740993",
    ),
    -1,
  );
});

test("版本解析保留构建信息，正式标签兼容既有发行并可往返", () => {
  for (const [version, tag, upstreamVersion, revision] of [
    ["3.16.2", "v3.16.2-openzwork", "3.16.2", "0"],
    ["3.16.2+openzwork.1", "v3.16.2+openzwork.1", "3.16.2", "1"],
    ["3.16.3", "v3.16.3-openzwork", "3.16.3", "0"],
    ["3.16.3+openzwork.1", "v3.16.3+openzwork.1", "3.16.3", "1"],
  ]) {
    assert.equal(formatOpenZWorkTag(version), tag);
    const parsed = parseOpenZWorkVersion(version);
    assert.equal(parsed.version, version);
    assert.equal(parsed.upstreamVersion, upstreamVersion);
    assert.equal(parsed.revision, revision);
    assert.deepEqual(parseOpenZWorkTag(tag), parsed);
  }
});

test("拒绝四段版本、预发布、未知构建信息和不规范数字", () => {
  for (const version of [
    "3.16.2.1",
    "3.16.2b1",
    "3.16.2-beta.1",
    "3.16.2-openzwork.1",
    "3.16.2+build.1",
    "3.16.2+openzwork.0",
    "3.16.2+openzwork.01",
    "03.16.2",
    "3.016.2",
    "3.16.02",
    "3.16.2+openzwork.-1",
    "3.16.2+openzwork.1.extra",
    "v3.16.2",
    " 3.16.2",
    "3.16.2\n",
    null,
  ])
    assert.throws(() => parseOpenZWorkVersion(version));
  for (const tag of [
    "main",
    "v3.16.2",
    "v3.16.2-beta.1-openzwork",
    "v3.16.2+openzwork.1-openzwork",
    "v3.16.2+openzwork.0",
  ])
    assert.throws(() => parseOpenZWorkTag(tag));
});

test("桌面完整版本与数字构建号由同一发行号推导", () => {
  assert.deepEqual(getDesktopVersion("3.16.2+openzwork.1"), {
    appVersion: "3.16.2+openzwork.1",
    upstreamVersion: "3.16.2",
    releaseRevision: "1",
    nativeBuildVersion: "3.16.2.1",
  });
  assert.equal(getDesktopVersion("3.16.3").nativeBuildVersion, "3.16.3.0");
  assert.throws(() => getDesktopVersion("3.16.2+openzwork.65536"));
  assert.throws(() => getDesktopVersion("3.16.65536"));
});
