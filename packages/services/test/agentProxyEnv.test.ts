
  it("locates the resolveSpawnEnv closure at all", () => {
    // 守卫上面的 slice：起点或终点找不到时 block 会静默变空，让后续 toContain 失去意义。
    expect(spawnEnvStart).toBeGreaterThanOrEqual(0);
    expect(spawnEnvBlock.length).toBeGreaterThan(0);
  });

  it("injects the origin patch inside resolveSpawnEnv", () => {
    expect(spawnEnvBlock).toContain("buildAgentEndpointOriginEnv(");
  });

  it("feeds it the settings-aware resolver, not the env-only one", () => {
    // 承重项：必须用 resolveCurrentZCodeEndpointOrigin（含 settings 覆盖）。
    // 接成 resolveRuntimeZCodeEndpointOrigin(process.env) 会让这次修复完全失效，
    // 而两侧仍然"看起来"都在解析 origin。
    expect(spawnEnvBlock).toContain(
      "buildAgentEndpointOriginEnv(await resolveCurrentZCodeEndpointOrigin())",
    );
  });

describe("node.ts lazy CUA spawn helper selection", () => {
  const source = readFileSync(resolve(__dirname, "../src/node.ts"), "utf8");
  const spawnEnvStart = source.indexOf("resolveSpawnEnv: async (");

  it("locates the resolveSpawnEnv closure at all", () => {
    expect(spawnEnvStart).toBeGreaterThanOrEqual(0);
  });

  it("routes darwin through the lazy branch with the stable broker socket (MC-3)", () => {
    expect(spawnEnvStart).toBeGreaterThanOrEqual(0);
    const cuaBlock = source.slice(spawnEnvStart, spawnEnvStart + 4000);
    const darwinIdx = cuaBlock.indexOf('process.platform === "darwin"');
    expect(darwinIdx).toBeGreaterThanOrEqual(0);
    expect(cuaBlock.slice(darwinIdx, darwinIdx + 60)).toContain("win32");
    const stableSocketIdx = cuaBlock.indexOf("resolveBrokerSocketPath()");
    expect(stableSocketIdx).toBeGreaterThan(darwinIdx);
  });

  it("keeps win32 spawn off the acquire path (MC-4)", () => {
    expect(spawnEnvStart).toBeGreaterThanOrEqual(0);
    const cuaBlock = source.slice(spawnEnvStart, spawnEnvStart + 6000);
    expect(cuaBlock).toContain("getStableCuaPipeName()");
    expect(cuaBlock.indexOf("getOrCreateDefaultCuaProductHelper(context)")).toBe(-1);
    expect(cuaBlock).toContain("ZCODE_CUA_WIN_HELPER_RECIPE");
  });
});
