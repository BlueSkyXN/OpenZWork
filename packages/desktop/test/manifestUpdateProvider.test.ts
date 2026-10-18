
function createProvider(
  Updater: typeof AppImageUpdater | typeof DebUpdater | typeof RpmUpdater | typeof PacmanUpdater,
) {
  return new ManifestUpdateProvider(
    { provider: "custom", endpointOrigin: "https://zcode.example.test" },
    Object.create(Updater.prototype),
    { platform: "linux", isUseMultipleRangeRequest: false, executor: {} as never },
  );
}

const artifacts = ["AppImage", "deb", "rpm", "pkg.tar.zst"].map((extension) => ({
  url: `https://cdn.example.test/releases/ZCode-3.12.2-linux-x64.${extension}`,
  sha512: `checksum-${extension}`,
}));
const manifest = { version: "3.12.2", releaseDate: "2026-09-16", files: artifacts };

describe("Linux manifest 与真实 updater 文件选择契约", () => {
  it.each(linuxUpdaters)("%s 从混合清单选择当前安装格式 %s", (Updater, extension) => {
    const resolved = createProvider(Updater).resolveFiles(manifest);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.url.href).toBe(artifacts.find((file) => file.url.endsWith(extension))?.url);
    expect(resolved[0]?.info.sha512).toBe(`checksum-${extension}`);
    const selected = findFile(
      resolved,
      extension === "pkg.tar.zst" ? "pacman" : extension,
      ["AppImage", "deb", "rpm", "pacman"].filter((item) => item !== extension),
    );
    expect(selected).toBe(resolved[0]);
  });

  it.each(linuxUpdaters)("%s 支持只发布当前格式 %s", (Updater, extension) => {
    const files = artifacts.filter((file) => file.url.endsWith(extension));
    expect(createProvider(Updater).resolveFiles({ ...manifest, files })[0]?.url.href).toBe(
      files[0]?.url,
    );
  });

  it.each(linuxUpdaters)("%s 缺少 %s 时不回退其他安装格式", (Updater, extension) => {
    expect(() =>
      createProvider(Updater).resolveFiles({
        ...manifest,
        files: artifacts.filter((file) => !file.url.endsWith(extension)),
      }),
    ).toThrow("Manifest contains no update file for");
  });

  it.each(linuxUpdaters)("%s 支持相对地址、查询参数和大小写 %s", (Updater, extension) => {
    const url = `releases/ZCode.${extension.toUpperCase()}?download=1`;
    const [file] = createProvider(Updater).resolveFiles({
      ...manifest,
      files: [{ url, sha512: "checksum" }],
    });
    expect(file?.url.href).toBe(`https://zcode.example.test/${url}`);
    expect(file?.info.sha512).toBe("checksum");
  });

  it("Pacman 使用安全的本地文件名，真实下载地址与原始清单不变", () => {
    const [file] = createProvider(PacmanUpdater).resolveFiles(manifest);
    expect(file?.info.url).toBe("ZCode-3.12.2-linux-x64.pkg.tar.zst");
    expect(file?.url.href).toBe(artifacts[3]?.url);
    expect(artifacts[3]?.url).toMatch(/^https:/);
  });

  it("兼容旧 pacman 后缀", () => {
    expect(
      createProvider(PacmanUpdater).resolveFiles({
        ...manifest,
        files: [{ url: "zcode.pacman", sha512: "checksum" }],
      })[0]?.url.pathname,
    ).toBe("/zcode.pacman");
  });

  it("所选文件仍必须包含校验值", () => {
    expect(() =>
      createProvider(DebUpdater).resolveFiles({
        ...manifest,
        files: [{ url: "zcode.deb", sha512: "" }],
      }),
    ).toThrow("missing checksum");
  });
});

describe("macOS / Windows 更新解析保持兼容", () => {
  it.each([
    [MacUpdater, "darwin", "zip", "dmg"],
    [NsisUpdater, "win32", "exe", "zip"],
  ] as const)("%s 保留清单，由原 updater 选择 %s %s", (Updater, platform, extension, other) => {
    const provider = new ManifestUpdateProvider(
      { provider: "custom", endpointOrigin: "https://zcode.example.test" },
      Object.create(Updater.prototype),
      { platform, isUseMultipleRangeRequest: false, executor: {} as never },
    );
    const files = [other, extension].map((ext) => ({ url: `releases/ZCode.${ext}`, sha512: ext }));
    const resolved = provider.resolveFiles({ ...manifest, files });
    expect(resolved).toHaveLength(2);
    expect(findFile(resolved, extension)?.info.sha512).toBe(extension);
    expect(resolved.map((file) => file.info)).toEqual(files);
  });

  it("兼容旧 manifest 的 path 与 sha512", () => {
    const provider = createProvider(DebUpdater);
    const resolved = provider.resolveFiles({
      ...manifest,
      files: [],
      path: "ZCode.deb",
      sha512: "legacy",
    });
    expect(resolved[0]?.url.href).toBe("https://zcode.example.test/ZCode.deb");
    expect(resolved[0]?.info.sha512).toBe("legacy");
  });
});
