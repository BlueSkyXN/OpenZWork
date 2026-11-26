import { chmod, copyFile, cp, mkdir, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { keyringPlatformPackage } from "../stage-credential-keyring.mjs";

// OpenZWork(OZ-F011)：Node 包的 PTY JS 与 native 必须取自同一个已安装版本。
export async function stagePlatformPty(source, destination, target) {
  await mkdir(destination, { recursive: true });
  for (const name of ["package.json", "LICENSE", "lib"]) {
    await cp(join(source, name), join(destination, name), { recursive: true });
  }
  const prebuild = join(source, "prebuilds", target);
  const output = join(destination, "prebuilds", target);
  if (
    await stat(prebuild).then(
      (item) => item.isDirectory(),
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    )
  ) {
    await cp(prebuild, output, {
      recursive: true,
      filter: (file) => !/\.pdb$/i.test(file) && !basename(file).startsWith("._"),
    });
  } else if (target.startsWith("linux-")) {
    // 官方 Linux 包由 install 在本机编译，将匹配的模块放到 JS 的平台查找目录。
    await mkdir(output, { recursive: true });
    await copyFile(join(source, "build/Release/pty.node"), join(output, "pty.node"));
  } else {
    throw new Error(`Missing node-pty prebuild for ${target}: ${prebuild}`);
  }
  if (target.startsWith("darwin-")) await chmod(join(output, "spawn-helper"), 0o755);
}

export async function verifyPlatformRuntime(root, target) {
  const errors = [];
  const [platform, arch] = target.split("-");
  const agent = join(root, "agent/node_modules");
  const pty = join(root, "node_modules/node-pty");
  const keyringPackage = keyringPlatformPackage(target);
  const keyringDir = keyringPackage.slice("@napi-rs/".length);
  const keyringSuffix = keyringDir.slice("keyring-".length);
  // 真正被裁剪的是 CUA 插件。OpenTUI 的 Node FFI 使用 koffi 与 unsafe-pointer。
  const libraries = { darwin: "libopentui.dylib", linux: "libopentui.so", win32: "opentui.dll" };
  const directories = [
    [
      join(agent, "@mbears"),
      `opentui-core-${target}`,
      (name) => /^opentui-core-(linux|darwin|win32)-/.test(name),
    ],
    [join(agent, "@napi-rs"), keyringDir, (name) => name.startsWith("keyring-")],
    [join(agent, "koffi/build/koffi"), `${platform}_${arch}`, () => true],
    [join(agent, "unsafe-pointer/prebuilds"), target, () => true],
    [join(pty, "prebuilds"), target, () => true],
  ];
  for (const [dir, expected, matches] of directories) {
    const found = (
      await readdir(dir, { withFileTypes: true }).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      })
    )
      .filter((entry) => entry.isDirectory() && matches(entry.name))
      .map((entry) => entry.name);
    if (found.length !== 1 || found[0] !== expected)
      errors.push(`Expected only ${expected} in ${dir}, found ${found.join(", ")}`);
  }
  const required = [
    join(agent, "@mbears", `opentui-core-${target}`, libraries[platform]),
    join(agent, "@napi-rs/keyring/index.js"),
    join(agent, keyringPackage, `keyring.${keyringSuffix}.node`),
    join(agent, "koffi/build/koffi", `${platform}_${arch}`, "koffi.node"),
    join(
      agent,
      "unsafe-pointer/prebuilds",
      target,
      platform === "linux" ? "unsafe-pointer.glibc.node" : "unsafe-pointer.node",
    ),
    join(pty, "prebuilds", target, platform === "win32" ? "conpty.node" : "pty.node"),
    ...(platform === "darwin" ? [join(pty, "prebuilds", target, "spawn-helper")] : []),
    join(root, "zcode"),
    join(root, "zcode.cmd"),
  ];
  for (const path of required) {
    if (!(await stat(path).catch(() => undefined))?.isFile())
      errors.push(`Missing platform runtime: ${path}`);
  }
  for (const path of [
    join(pty, "build"),
    join(pty, "bin"),
    join(agent, "@zcode/zcode-cua-plugin"),
    join(agent, "@zcode/zcode-cua"),
    join(root, "agent/packages/zcode-cua-plugin"),
    join(root, "agent/packages/zcode-site-plugin"),
    join(root, "agent/packages/image-search-plugin"),
    join(root, "node_modules/@zcode/zcode-cua-plugin"),
  ]) {
    if (await stat(path).catch(() => undefined))
      errors.push(`Unexpected packaged directory: ${path}`);
  }
  return errors;
}
