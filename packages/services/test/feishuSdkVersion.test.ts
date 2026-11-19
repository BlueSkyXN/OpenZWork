import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

async function readSdkVersion(packagePath: string): Promise<string> {
  const manifest = JSON.parse(await readFile(new URL(packagePath, import.meta.url), "utf8"));
  const version = manifest.dependencies?.["@larksuiteoapi/node-sdk"];
  assert.equal(typeof version, "string", `${packagePath} 必须声明 @larksuiteoapi/node-sdk`);
  return version;
}

// OW-P038：桌面安装包与 services 必须用同一个包含两处长连接修复的稳定版本。
test("services 和 desktop 声明相同且不低于 1.74.0 的飞书 SDK 稳定版", async () => {
  const [services, desktop] = await Promise.all([
    readSdkVersion("../package.json"),
    readSdkVersion("../../desktop/package.json"),
  ]);
  assert.equal(services, desktop, "两处声明必须一致，以免编译和安装包运行时解析到不同版本");
  assert.match(services, /^\d+\.\d+\.\d+$/, "使用精确的稳定版本，不接受区间或预发布版");
  const [major, minor] = services.split(".").map(Number);
  assert.ok(major > 1 || (major === 1 && minor >= 74), `${services} 早于修复版本 1.74.0`);
});
