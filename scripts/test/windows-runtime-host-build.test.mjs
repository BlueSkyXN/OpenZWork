import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolveRuntimeHostBuild, verifyRuntimeHostPe } from "../build-windows-runtime-host.mjs";

test("Windows builds both supported architectures with the matching MSVC target", () => {
  // OW-P028：生成器随 runner 安装版本选择，两种目标架构必须仍显式传入。
  assert.deepEqual(resolveRuntimeHostBuild("x64", "win32").configureArgs, ["-A", "x64"]);
  assert.deepEqual(resolveRuntimeHostBuild("arm64", "win32").configureArgs, ["-A", "ARM64"]);
  assert.throws(() => resolveRuntimeHostBuild("ia32", "win32"), /architecture/);
});
test("cross builds explicitly select a Windows compiler", () => {
  assert.ok(
    resolveRuntimeHostBuild("x64", "linux").configureArgs.includes("-DCMAKE_SYSTEM_NAME=Windows"),
  );
  assert.ok(
    resolveRuntimeHostBuild("arm64", "linux", "example-clang++").configureArgs.includes(
      "-DCMAKE_CXX_COMPILER=example-clang++",
    ),
  );
});
test("packaging rejects wrong-architecture and corrupt PE binaries", () => {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 60);
  bytes.write("PE\0\0", 64);
  bytes.writeUInt16LE(0x8664, 68);
  verifyRuntimeHostPe(bytes, "x64");
  assert.throws(() => verifyRuntimeHostPe(bytes, "arm64"), /architecture/);
  assert.throws(() => verifyRuntimeHostPe(Buffer.from("bad"), "x64"), /PE/);
});
test("Windows preinstalled entry shim build does not hardcode a Visual Studio generator", async () => {
  // OW-P028：v4.0.0 新增的 preinstalled-entry-shim CMake 调用同样必须交由宿主 CMake 选择 VS，并保留 -A 与 PE 校验。
  const source = await readFile(
    new URL("../../packages/desktop/scripts/build-windows-preinstalled-entry-shim.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /["']Visual Studio 17 2022["']/);
  assert.doesNotMatch(source, /["']-G["']/);
  assert.match(source, /"-A"/);
  assert.match(source, /verifyPe\(/);
});
