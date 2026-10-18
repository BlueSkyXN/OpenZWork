
  it("allows an explicit web remote control relay url override", () => {
    expect(
      resolveWebRemoteControlRelayWsUrl({
        endpointOrigin: TEST_ZCODE_ENDPOINT_ORIGIN,
        overrideUrl: " ws://localhost:8787/ws ",
      }),
    ).toBe("ws://localhost:8787/ws");

  it("derives BigModel API origin from ZCODE_ENV", () => {
    expect(buildBigModelApiUrl({ ZCODE_ENV: "test" }, "/api/biz/subscription/list")).toBe(
    );
  });

  it("derives BigModel Coding Plan manage urls from ZCODE_ENV", () => {
    expect(buildBigModelCodingPlanPersonalManageUrl({ ZCODE_ENV: "test" })).toBe(
    );
    expect(buildBigModelCodingPlanPersonalManageUrl({ ZCODE_ENV: "production" })).toBe(
    );
    expect(buildBigModelCodingPlanTeamManageUrl({ ZCODE_ENV: "test" })).toBe(
    );
    expect(buildBigModelCodingPlanTeamManageUrl({ ZCODE_ENV: "production" })).toBe(
    );
  });

  it("resolves all product endpoints for the test product environment", () => {
    expect(resolveRuntimeProductEndpointConfig({ ZCODE_ENV: "test" })).toMatchObject({
      zcodeEnv: "test",
      zcodeEndpointOrigin: TEST_ZCODE_ENDPOINT_ORIGIN,
      zaiOAuthOrigin: TEST_ZAI_OAUTH_ORIGIN,
      zaiBusinessBaseUrl: TEST_ZAI_BUSINESS_BASE_URL,
      zaiOAuthClientId: TEST_ZAI_OAUTH_CLIENT_ID,
      bigModelApiOrigin: TEST_BIGMODEL_API_ORIGIN,
    });
  });

  it("resolves all product endpoints for the production product environment", () => {
    expect(resolveRuntimeProductEndpointConfig({ ZCODE_ENV: "production" })).toMatchObject({
      zcodeEnv: "production",
      zcodeEndpointOrigin: DEFAULT_ZCODE_ENDPOINT_ORIGIN,
      zaiOAuthOrigin: DEFAULT_ZAI_OAUTH_ORIGIN,
      zaiBusinessBaseUrl: DEFAULT_ZAI_BUSINESS_BASE_URL,
      zaiOAuthClientId: DEFAULT_ZAI_OAUTH_CLIENT_ID,
      bigModelApiOrigin: DEFAULT_BIGMODEL_API_ORIGIN,
    });
  });

  it("builds product endpoint URLs from the selected environment", () => {
    expect(buildRuntimeZCodeApiUrl({ ZCODE_ENV: "test" }, "/api/v1/oauth/token")).toBe(
    );
    expect(buildRuntimeZaiOAuthUrl({ ZCODE_ENV: "test" }, "/api/oauth/authorize")).toBe(
    );
    expect(buildRuntimeZaiBusinessUrl({ ZCODE_ENV: "test" }, "/api/auth/z/login")).toBe(
    );
    expect(buildBigModelApiUrl({ ZCODE_ENV: "test" }, "/login")).toBe(
    );
  });

  it("keeps environment-scoped endpoint overrides centralized", () => {
    const env = {
      ZCODE_ENV: "test",
      ZCODE_TEST_BASE_URL: "https://test-zcode.example.com/path",
      ZAI_TEST_OAUTH_ORIGIN: "https://test-oauth.example.com/oauth",
      ZAI_TEST_BUSINESS_BASE_URL: "https://test-business.example.com/api",
      ZAI_TEST_OAUTH_CLIENT_ID: "client_test_override",
      BIGMODEL_TEST_API_BASE_URL: "https://test-bigmodel.example.com/base",
    };

    expect(resolveRuntimeProductEndpointConfig(env)).toMatchObject({
      zcodeEndpointOrigin: "https://test-zcode.example.com",
      zaiOAuthOrigin: "https://test-oauth.example.com",
      zaiBusinessBaseUrl: "https://test-business.example.com",
      zaiOAuthClientId: "client_test_override",
      bigModelApiOrigin: "https://test-bigmodel.example.com",
    });
  });

  it("keeps unscoped endpoint overrides above scoped endpoint overrides", () => {
    const env = {
      ZCODE_ENV: "test",
      ZAI_OAUTH_ORIGIN: "https://oauth-global.example.com",
      ZAI_TEST_OAUTH_ORIGIN: "https://oauth-test.example.com",
      ZAI_BUSINESS_BASE_URL: "https://business-global.example.com",
      ZAI_TEST_BUSINESS_BASE_URL: "https://business-test.example.com",
      ZAI_OAUTH_CLIENT_ID: "client_global",
      ZAI_TEST_OAUTH_CLIENT_ID: "client_test",
      BIGMODEL_API_BASE_URL: "https://bigmodel-global.example.com",
      BIGMODEL_TEST_API_BASE_URL: "https://bigmodel-test.example.com",
    };

    expect(resolveZaiOAuthOrigin(env)).toBe("https://oauth-global.example.com");
    expect(resolveZaiBusinessBaseUrl(env)).toBe("https://business-global.example.com");
    expect(resolveZaiOAuthClientId(env)).toBe("client_global");
    expect(resolveBigModelApiOrigin(env)).toBe("https://bigmodel-global.example.com");
  });

  it("ignores blank runtime endpoint overrides", () => {
    const env = {
      ZCODE_ENV: "test",
      ZCODE_BASE_URL: " ",
      ZCODE_TEST_BASE_URL: "\t",
      ZAI_OAUTH_ORIGIN: "",
      ZAI_TEST_OAUTH_ORIGIN: " ",
      ZAI_BUSINESS_BASE_URL: " ",
      ZAI_TEST_BUSINESS_BASE_URL: "",
      ZAI_OAUTH_CLIENT_ID: "",
      ZAI_TEST_OAUTH_CLIENT_ID: " ",
      BIGMODEL_API_BASE_URL: " ",
      BIGMODEL_TEST_API_BASE_URL: "",
    };

    expect(resolveRuntimeProductEndpointConfig(env)).toMatchObject({
      zcodeEndpointOrigin: TEST_ZCODE_ENDPOINT_ORIGIN,
      zaiOAuthOrigin: TEST_ZAI_OAUTH_ORIGIN,
      zaiBusinessBaseUrl: TEST_ZAI_BUSINESS_BASE_URL,
      zaiOAuthClientId: TEST_ZAI_OAUTH_CLIENT_ID,
      bigModelApiOrigin: TEST_BIGMODEL_API_ORIGIN,
    });
  });

  it("rejects non-http endpoint origins", () => {
    expect(() => normalizeZCodeEndpointOrigin("file:///tmp/zcode")).toThrow(/http or https/);
  });

  it("persists optional endpoint override in app settings", () => {
    expect(
    ).toBe(TEST_ZCODE_ENDPOINT_ORIGIN);
    expect(
      appSettingsPatchSchema.parse({ zcodeEndpointOrigin: "http://localhost:3030/foo" })
        .zcodeEndpointOrigin,
    ).toBe("http://localhost:3030");
  });
});
