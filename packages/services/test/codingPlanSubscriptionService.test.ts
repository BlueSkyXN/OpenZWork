
    await expect(provider.getForceUpdateConfig()).resolves.toEqual({
      minimalVersion: "4.0.0",
    });
    expect(apiClient.request).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "GET",
      }),
    );

  it("getForceUpdateConfig 在字段缺失时返回 null", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 0,
          msg: "",
          data: {
            configs: {},
          },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(),
      },
    });

    await expect(provider.getForceUpdateConfig()).resolves.toBeNull();
  });

  it("getForceUpdateConfig 在 minimalVersion 类型不合法时返回 null", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 0,
          msg: "",
          data: {
            configs: {
              forceUpdate: {
                minimalVersion: 4,
              },
            },
          },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(),
      },
    });

    await expect(provider.getForceUpdateConfig()).resolves.toBeNull();
  });

  it("getStartPlanPreview 从 ZCode client config 读取未登录 Start Plan 预览", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 0,
          msg: "",
          data: {
            configs: {
              startPlanPreview: {
                planId: "zcode-v3-start-plan",
                name: "ZCode V3 Start Plan",
                entitlements: [
                  {
                    grantUnits: 10_000_000,
                    meter: "model_usage",
                    period: "daily",
                    showName: "GLM-5.2",
                    unitType: "token",
                  },
                ],
              },
            },
          },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(),
      },
    });

    const result = await provider.getStartPlanPreview();

    expect(result).toEqual({
      planId: "zcode-v3-start-plan",
      name: "ZCode V3 Start Plan",
      entitlements: [
        {
          grantUnits: 10_000_000,
          meter: "model_usage",
          period: "daily",
          showName: "GLM-5.2",
          unitType: "token",
        },
      ],
    });
    expect(apiClient.request).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("getBillingDiscount 仅在字段存在时返回活动配置", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 0,
          msg: "",
          data: {
            configs: {
              codingPlanBillingDiscount: {
                "zh-CN": {
                  cardTitle: "限时 150% 配额活动",
                  cardBody: "升级 Coding Plan，可在活动期内获得150% 配额",
                  badgeBody: "150% 配额",
                },
                "en-US": {
                  cardTitle: "Limited-time 150% Quota Campaign",
                  cardBody: "Upgrade your Coding Plan to get 150% quota during the campaign period",
                  badgeBody: "150% Quota",
                },
              },
            },
          },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(),
      },
    });

    await expect(provider.getBillingDiscount()).resolves.toEqual({
      "zh-CN": {
        cardTitle: "限时 150% 配额活动",
        cardBody: "升级 Coding Plan，可在活动期内获得150% 配额",
        badgeBody: "150% 配额",
      },
      "en-US": {
        cardTitle: "Limited-time 150% Quota Campaign",
        cardBody: "Upgrade your Coding Plan to get 150% quota during the campaign period",
        badgeBody: "150% Quota",
      },
    });
  });

  it("getBillingDiscount 在字段缺失时返回 undefined", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 0,
          msg: "",
          data: {
            configs: {},
          },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(),
      },
    });

    await expect(provider.getBillingDiscount()).resolves.toBeUndefined();
  });

  it("getStartPlanPreview、getStaticProducts 和 getBillingDiscount 共享同一次 client config 请求", async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    const apiClient: ApiClient = {
      request: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveRequest = resolve;
          }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(),
      },
    });

    const previewPromise = provider.getStartPlanPreview();
    const productsPromise = provider.getStaticProducts();
    const discountPromise = provider.getBillingDiscount();
    resolveRequest?.(
      createJsonResponse({
        code: 0,
        msg: "",
        data: {
          configs: {
            startPlanPreview: {
              planId: "zcode-v3-start-plan",
              name: "ZCode V3 Start Plan",
              entitlements: [
                {
                  grantUnits: 10_000_000,
                  meter: "model_usage",
                  period: "daily",
                  showName: "GLM-5.2",
                  unitType: "token",
                },
              ],
            },
            codingPlanStaticProducts: {
              [BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan]: [
                {
                  productId: "remote-bigmodel-lite",
                  productName: "Remote BigModel Lite",
                  productEquityList: [],
                  priceUnit: "month",
                  displayOrder: 1,
                  priceCurrency: "CNY",
                  payAmount: 49,
                },
              ],
            },
            codingPlanBillingDiscount: {
              "zh-CN": {
                cardTitle: "限时 150% 配额活动",
                cardBody: "升级 Coding Plan，可在活动期内获得150% 配额",
                badgeBody: "150% 配额",
              },
            },
          },
        },
      }),
    );

    const [preview, products, discount] = await Promise.all([
      previewPromise,
      productsPromise,
      discountPromise,
    ]);

    expect(apiClient.request).toHaveBeenCalledTimes(1);
    expect(preview?.planId).toBe("zcode-v3-start-plan");
    expect(products[BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan]?.[0]?.productId).toBe(
      "remote-bigmodel-lite",
    );
    expect(discount).toEqual({
      "zh-CN": {
        cardTitle: "限时 150% 配额活动",
        cardBody: "升级 Coding Plan，可在活动期内获得150% 配额",
        badgeBody: "150% 配额",
      },
    });
    await provider.getStartPlanPreview();
    await provider.getStaticProducts();
    await provider.getBillingDiscount();
    expect(apiClient.request).toHaveBeenCalledTimes(1);
  });

  it("client configs 缓存 1 小时后重新请求", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T00:00:00.000Z"));
    const apiClient: ApiClient = {
      request: vi
        .fn()
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 0,
            msg: "",
            data: {
              configs: {
                codingPlanBillingDiscount: {
                  "zh-CN": {
                    badgeBody: "第一版",
                  },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 0,
            msg: "",
            data: {
              configs: {
                codingPlanBillingDiscount: {
                  "zh-CN": {
                    badgeBody: "第二版",
                  },
                },
              },
            },
          }),
        ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(),
      },
    });

    await expect(provider.getBillingDiscount()).resolves.toEqual({
      "zh-CN": { badgeBody: "第一版" },
    });
    vi.setSystemTime(new Date("2026-06-12T00:59:59.000Z"));
    await expect(provider.getBillingDiscount()).resolves.toEqual({
      "zh-CN": { badgeBody: "第一版" },
    });
    expect(apiClient.request).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-06-12T01:00:01.000Z"));
    await expect(provider.getBillingDiscount()).resolves.toEqual({
      "zh-CN": { badgeBody: "第二版" },
    });
    expect(apiClient.request).toHaveBeenCalledTimes(2);
  });

  it("getEnterprisePricing 未登录时走公开定价接口且不读取 OAuth", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 200,
          data: {
            productList: [
              {
                productId: "enterprise-lite-monthly",
                tier: "LITE",
                subscribeMode: "ONE_TIME",
                subscribePeriod: "MONTHLY",
                purchaseMethodName: "按月采购",
                originalAmount: 270,
                discountAmount: 27,
                payAmount: 243,
                renewAmount: 243,
              },
            ],
          },
        }),
      ),
    };
    const credentialService = { load: vi.fn() };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService,
    });

    const result = await provider.getEnterprisePricing({
      authenticated: false,
    });

    expect(result.productList[0]?.productId).toBe("enterprise-lite-monthly");
    expect(credentialService.load).not.toHaveBeenCalled();
    expect(apiClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("getEnterprisePricing 登录态使用 BigModel OAuth token 且不添加 Bearer", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 200,
          data: { productList: [] },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    await provider.getEnterprisePricing({ authenticated: true });

    expect(apiClient.request).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(apiClient.request).mock.calls[0]?.[0])).toBe(
    );
    expect(vi.mocked(apiClient.request).mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: {
        Authorization: "oauth-token",
        "Content-Type": "application/json",
      },
    });
  });

  it("getEnterprisePricing 会用 customerInfo 给已购 Team Plan 补齐项目上下文", async () => {
    const apiClient: ApiClient = {
      request: vi
        .fn()
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "product-0e2085",
                  tier: "PRO",
                  subscribeMode: "CONTINUOUS",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-team",
                  organizationName: "默认机构",
                  projects: [
                    {
                      projectId: "proj-default",
                      projectName: "团队编程套餐项目",
                      projectType: 1,
                    },
                    {
                      projectId: "proj-team",
                      projectName: "自定义团队项目",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          }),
        ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    const result = await provider.getEnterprisePricing({ authenticated: true });

    expect(result.productList[0]).toMatchObject({
      organizationId: "org-team",
      projectId: "proj-team",
      projectName: "自定义团队项目",
      teamProjects: [
        {
          organizationId: "org-team",
          projectId: "proj-team",
          projectName: "自定义团队项目",
        },
      ],
    });
  });

  it("getEnterprisePricing 已购 Team Plan 只有机构 ID 时仍从机构数组补齐项目上下文", async () => {
    const apiClient: ApiClient = {
      request: vi
        .fn()
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "product-0e2085",
                  tier: "PRO",
                  subscribeMode: "CONTINUOUS",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                  organizationId: "org-target",
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-other",
                  organizationName: "其他机构",
                  projects: [
                    {
                      projectId: "proj-other",
                      projectName: "其他团队项目",
                      projectType: 2,
                    },
                  ],
                },
                {
                  organizationId: "org-target",
                  organizationName: "目标机构",
                  projects: [
                    {
                      projectId: "proj-default",
                      projectName: "默认项目",
                      projectType: 1,
                    },
                    {
                      projectId: "proj-team",
                      projectName: "目标团队项目",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          }),
        ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    const result = await provider.getEnterprisePricing({ authenticated: true });

    expect(result.productList[0]).toMatchObject({
      organizationId: "org-target",
      organizationName: "目标机构",
      projectId: "proj-team",
      projectName: "目标团队项目",
      teamProjects: [
        {
          organizationId: "org-target",
          projectId: "proj-team",
          projectName: "目标团队项目",
        },
      ],
    });
  });

  it("getEnterprisePricing pricing 未标记订阅但 customerInfo 有团队项目时补 Team Plan 入口", async () => {
    const apiClient: ApiClient = {
      request: vi
        .fn()
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "product-max",
                  tier: "MAX",
                  subscribeMode: "CONTINUOUS",
                  subscribePeriod: "MONTHLY",
                  subscribed: false,
                },
                {
                  productId: "product-pro-monthly",
                  tier: "PRO",
                  subscribeMode: "ONE_TIME",
                  subscribePeriod: "MONTHLY",
                  subscribed: false,
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-default",
                  organizationName: "默认机构",
                  projects: [
                    {
                      projectId: "proj-default",
                      projectName: "默认项目",
                      projectType: 1,
                    },
                  ],
                },
                {
                  organizationId: "org-team",
                  organizationName: "团队机构",
                  projects: [
                    {
                      projectId: "proj-team",
                      projectName: "团队编程套餐项目",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          }),
        ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    const result = await provider.getEnterprisePricing({ authenticated: true });

    expect(result.productList[1]).toMatchObject({
      productId: "product-pro-monthly",
      subscribed: true,
      organizationId: "org-team",
      projectId: "proj-team",
      projectName: "团队编程套餐项目",
    });
  });

  it("getEnterprisePricing 会为多个已购 Team Plan 项目预热 zcode-team-api-key", async () => {
    const requestUrls: string[] = [];
    const requestMethods: Array<string | undefined> = [];
    const apiClient: ApiClient = {
      request: vi.fn(async (input, init) => {
        const url = input.toString();
        requestUrls.push(url);
        requestMethods.push(init?.method);
        if (url.endsWith("/api/biz/subscription/enterprise/v2/pricing")) {
          return createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "product-pro-monthly",
                  tier: "PRO",
                  subscribeMode: "ONE_TIME",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                },
              ],
            },
          });
        }
        if (url.endsWith("/api/biz/customer/getCustomerInfo")) {
          return createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-a",
                  organizationName: "团队 A",
                  projects: [
                    {
                      projectId: "proj-a",
                      projectName: "项目 A",
                      projectType: 2,
                    },
                  ],
                },
                {
                  organizationId: "org-b",
                  organizationName: "团队 B",
                  projects: [
                    {
                      projectId: "proj-b",
                      projectName: "项目 B",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          });
        }
        if (url.endsWith("/organization/org-a/projects/proj-a/api_keys")) {
          if (init?.method === "GET") {
            return createJsonResponse({
              code: 200,
              data: [{ apiKey: "team-a-ak", keyType: 2, name: "zcode-team-api-key" }],
            });
          }
        }
        if (url.endsWith("/organization/org-b/projects/proj-b/api_keys")) {
          if (init?.method === "GET") {
            return createJsonResponse({ code: 200, data: [] });
          }
          if (init?.method === "POST") {
            expect(init.headers).toMatchObject({
              "bigmodel-organization": "org-b",
              "bigmodel-project": "proj-b",
            });
            expect(JSON.parse(String(init.body))).toEqual({
              name: "zcode-team-api-key",
              keyType: 2,
              usageScene: 1,
            });
            return createJsonResponse({
              code: 200,
              data: {
                apiKey: "team-b-ak",
                keyType: 2,
                name: "zcode-team-api-key",
              },
            });
          }
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    const result = await provider.getEnterprisePricing({ authenticated: true });

    expect(result.productList[0]?.teamProjects).toHaveLength(2);
    expect(result.productList[0]?.teamProjects).toMatchObject([
      {
        organizationId: "org-a",
        projectId: "proj-a",
        apiKeyStatus: "available",
      },
      {
        organizationId: "org-b",
        projectId: "proj-b",
        apiKeyStatus: "available",
      },
    ]);
    expect(requestUrls).toEqual([
    ]);
    expect(requestMethods).toEqual(["GET", "GET", "GET", "GET", "POST"]);
  });

  it("getEnterprisePricing 单个 Team Plan 项目 key 预热失败不阻断其他团队", async () => {
    const requestUrls: string[] = [];
    const apiClient: ApiClient = {
      request: vi.fn(async (input, init) => {
        const url = input.toString();
        requestUrls.push(url);
        if (url.endsWith("/api/biz/subscription/enterprise/v2/pricing")) {
          return createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "product-pro-monthly",
                  tier: "PRO",
                  subscribeMode: "ONE_TIME",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                },
              ],
            },
          });
        }
        if (url.endsWith("/api/biz/customer/getCustomerInfo")) {
          return createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-a",
                  organizationName: "团队 A",
                  projects: [
                    {
                      projectId: "proj-a",
                      projectName: "项目 A",
                      projectType: 2,
                    },
                  ],
                },
                {
                  organizationId: "org-b",
                  organizationName: "团队 B",
                  projects: [
                    {
                      projectId: "proj-b",
                      projectName: "项目 B",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          });
        }
        if (url.endsWith("/organization/org-a/projects/proj-a/api_keys")) {
          throw new Error("org-a key failed");
        }
        if (
          url.endsWith("/organization/org-b/projects/proj-b/api_keys") &&
          init?.method === "GET"
        ) {
          return createJsonResponse({
            code: 200,
            data: [{ apiKey: "team-b-ak", keyType: 2, name: "zcode-team-api-key" }],
          });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    const result = await provider.getEnterprisePricing({ authenticated: true });

    expect(result.productList[0]?.teamProjects).toHaveLength(2);
    expect(result.productList[0]?.teamProjects).toMatchObject([
      {
        organizationId: "org-a",
        projectId: "proj-a",
        apiKeyStatus: "unavailable",
        apiKeyUnavailableReason: "request_failed",
      },
      {
        organizationId: "org-b",
        projectId: "proj-b",
        apiKeyStatus: "available",
      },
    ]);
    expect(requestUrls).toContain(
    );
  });

  it("getEnterprisePricing 会把没有有效团队套餐授权的 Team Plan 项目标为不可用", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async (input, init) => {
        const url = input.toString();
        if (url.endsWith("/api/biz/subscription/enterprise/v2/pricing")) {
          return createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "product-pro-monthly",
                  tier: "PRO",
                  subscribeMode: "ONE_TIME",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                },
              ],
            },
          });
        }
        if (url.endsWith("/api/biz/customer/getCustomerInfo")) {
          return createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-missing",
                  organizationName: "团队 Missing",
                  projects: [
                    {
                      projectId: "proj-missing",
                      projectName: "项目 Missing",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          });
        }
        if (
          url.endsWith("/organization/org-missing/projects/proj-missing/api_keys") &&
          init?.method === "GET"
        ) {
          return createJsonResponse({ code: 200, data: [] });
        }
        if (
          url.endsWith("/organization/org-missing/projects/proj-missing/api_keys") &&
          init?.method === "POST"
        ) {
          return createJsonResponse({
            code: 500,
            success: false,
            msg: "您当前暂无有效的团队套餐授权记录，无法创建API Key",
            data: null,
          });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    const result = await provider.getEnterprisePricing({ authenticated: true });

    expect(result.productList[0]?.teamProjects?.[0]).toMatchObject({
      organizationId: "org-missing",
      projectId: "proj-missing",
      apiKeyStatus: "unavailable",
      apiKeyUnavailableReason: "no_valid_team_plan_authorization",
      apiKeyUnavailableMessage: "您当前暂无有效的团队套餐授权记录，无法创建API Key",
    });
  });

    vi.stubEnv("ZCODE_ENV", "test");
    const apiClient: ApiClient = {
      request: vi
        .fn()
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: { productList: [] },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: { productList: [] },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              giveBalance: 0,
              cashBalance: 0,
              totalBalance: 0,
            },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: [],
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: { status: "SUCCESS" },
          }),
        ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    await provider.getEnterprisePricing({ authenticated: false });
    await provider.getEnterprisePricing({ authenticated: true });
    await provider.getEnterpriseBalance();
    await provider.getEnterprisePendingOrders();
    await provider.checkEnterpriseOrderStatus({ orderNo: "ORDER-1" });

    expect(vi.mocked(apiClient.request).mock.calls.map((call) => String(call[0]))).toEqual([
    ]);

  it("企业套餐试算和下单使用 BigModel OAuth token 并原样传递金额", async () => {
    const apiClient: ApiClient = {
      request: vi
        .fn()
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              totalOriginalAmount: 2700,
              campaignDiscountAmount: 270,
              discountDetails: [],
              totalPayAmount: 2430,
              giveDeductAmount: 0,
              balanceDeductAmount: 0,
              thirdPayAmount: 2430,
            },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            code: 200,
            data: {
              orderNo: "20260507001",
              subscriptionNo: "SUB20260507",
              totalOriginalAmount: 2700,
              campaignDiscountAmount: 270,
              totalPayAmount: 2430,
              thirdPayAmount: 2430,
              discountDetails: [],
              payUrl: "https://openapi.alipay.com/pay",
              alipayJumpSchema: "alipays://platformapi/startApp",
              expireTime: "2026-05-07 10:30:00",
            },
          }),
        ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    const estimate = await provider.calculateEnterpriseOrder({
      productId: "enterprise-lite-monthly",
      maxSeats: 10,
      subscribePeriod: "MONTHLY",
      subscribeMode: "ONE_TIME",
      duration: 1,
      giveAmount: 0,
      balanceDeductAmount: 0,
    });
    await provider.createEnterpriseOrder({
      productId: "enterprise-lite-monthly",
      maxSeats: 10,
      subscribePeriod: "MONTHLY",
      subscribeMode: "ONE_TIME",
      purchaseType: "PAY",
      duration: 1,
      giveAmount: 0,
      balanceDeductAmount: 0,
      totalOriginalAmount: estimate.totalOriginalAmount,
      totalPayAmount: estimate.totalPayAmount,
      thirdPayAmount: estimate.thirdPayAmount,
    });

    expect(apiClient.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "oauth-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productId: "enterprise-lite-monthly",
          maxSeats: 10,
          subscribePeriod: "MONTHLY",
          subscribeMode: "ONE_TIME",
          duration: 1,
          giveAmount: 0,
          balanceDeductAmount: 0,
        }),
      }),
    );
    expect(apiClient.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          productId: "enterprise-lite-monthly",
          maxSeats: 10,
          subscribePeriod: "MONTHLY",
          subscribeMode: "ONE_TIME",
          purchaseType: "PAY",
          duration: 1,
          giveAmount: 0,
          balanceDeductAmount: 0,
          totalOriginalAmount: 2700,
          totalPayAmount: 2430,
          thirdPayAmount: 2430,
        }),
      }),
    );
  });

  it("getEnterpriseBalance 使用 BigModel OAuth token 查询企业余额", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 200,
          data: {
            giveBalance: 1000,
            cashBalance: 1500,
            totalBalance: 2500,
          },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService("oauth-token"),
    });

    await expect(provider.getEnterpriseBalance()).resolves.toEqual({
      giveBalance: 1000,
      cashBalance: 1500,
      totalBalance: 2500,
    });
    expect(String(vi.mocked(apiClient.request).mock.calls[0]?.[0])).toBe(
    );
    expect(vi.mocked(apiClient.request).mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: {
        Authorization: "oauth-token",
        "Content-Type": "application/json",
      },
    });
  });

  it("createSign 默认 ALI 且固定 isDelay=0", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 200,
          data: {
            orderId: "order-1",
            sign: "<form></form>",
            signType: "ALI",
          },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService(),
    });

    await provider.createSign({ bizId: "biz-1" });

    const init = (apiClient.request as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      bizId: "biz-1",
      payType: "ALI",
      renew: null,
      isDelay: 0,
      effectiveTime: null,
    });
  });

  it("updateSign 调用套餐变更签约接口", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 200,
          data: {
            orderId: "order-2",
            sign: "https://pay.example",
            signType: "ALI",
          },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService(),
    });

    await provider.updateSign({ bizId: "biz-2" });

    expect(apiClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("preview 透传安全校验 ticket 和 randstr", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 200,
          data: {
            productId: "product-1",
            bizId: "biz-1",
            soldOut: false,
            payAmount: 149,
          },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService(),
    });

    await provider.preview({
      productId: "product-1",
      ticket: "fixture-ticket",
      randstr: "fixture-randstr",
    });

    const init = (apiClient.request as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      productId: "product-1",
      ticket: "fixture-ticket",
      randstr: "fixture-randstr",
      salesChannel: "zcode",
    });
  });

  it("Z.ai preview 使用海外试算接口", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () => {
        return createJsonResponse({
          code: 200,
          data: {
            productId: "zai-product-pro",
            bizId: "zai-biz-1",
            soldOut: false,
            payAmount: 18,
          },
        });
      }),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(async (key) => (key === "oauth:zai:access_token" ? "zai-business-jwt" : null)),
      },
    });

    await provider.preview({
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      productId: "zai-product-pro",
      ticket: "fixture-ticket",
      randstr: "fixture-randstr",
    });

    expect(apiClient.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "zai-business-jwt",
          "Content-Type": "application/json",
        },
      }),
    );
    const init = (apiClient.request as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      productId: "zai-product-pro",
      ticket: "fixture-ticket",
      randstr: "fixture-randstr",
      salesChannel: "zcode",
    });
  });

  it("Z.ai 不走 BigModel 支付宝签约接口", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(async () => "zai-business-jwt"),
      },
    });

    await expect(
      provider.createSign({
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        bizId: "zai-biz-1",
      }),
    ).rejects.toThrow("coding_plan_zai_overseas_payment_required");
    expect(apiClient.request).not.toHaveBeenCalled();
  });

  it("Z.ai Stripe 支付使用 pay 服务接口", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () => {
        return createJsonResponse({
          code: 200,
          data: {
            orderId: "order-stripe-1",
            paymentIntentId: "pi_1",
            status: "SUCCEEDED",
          },
        });
      }),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(async () => "zai-business-jwt"),
      },
    });

    await provider.payStripe({
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      productId: "zai-product-pro",
      paymentMethodId: "pm_1",
      estimatePayAmount: {
        cashPayAmount: 0,
        givePayAmount: 0,
        thirdPartyPayAmount: 18,
      },
      bizId: "zai-biz-1",
      renew: true,
    });

    expect(apiClient.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "POST",
      }),
    );
    const init = (apiClient.request as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      productId: "zai-product-pro",
      paymentMethodId: "pm_1",
      estimatePayAmount: {
        thirdPartyPayAmount: 18,
      },
      bizId: "zai-biz-1",
      renew: true,
    });
  });

  it("Z.ai Stripe 绑卡和解绑使用 pay 服务接口", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async (input) => {
        if (String(input).includes("/stripe/bind")) {
          return createJsonResponse({
            code: 200,
            data: {
              paymentMethodId: "pm_1",
              brand: "visa",
              last4: "4242",
              requiresAction: false,
            },
          });
        }
        return createJsonResponse({
          code: 200,
          data: "ok",
        });
      }),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(async () => "zai-business-jwt"),
      },
    });

    await provider.bindStripeCard({
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      paymentMethodId: "pm_1",
    });
    await provider.unbindStripeCard({
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      paymentMethodId: "pm_1",
    });

    expect(apiClient.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ method: "POST" }),
    );
    expect(apiClient.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("Z.ai PayPal setupToken 和 subscribe 使用 pay 服务接口", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async (input) => {
        if (String(input).includes("/paypal/setupToken")) {
          return createJsonResponse({
            code: 200,
            data: {
              resultStatus: "SUCCESS",
              setupTokenId: "setup-token-1",
              approveUrl: "https://paypal.example/approve",
            },
          });
        }
        return createJsonResponse({
          code: 200,
          data: {
            resultStatus: "SUCCESS",
            payStatus: "SUCCESS",
            orderId: "paypal-order-1",
          },
        });
      }),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: {
        load: vi.fn(async () => "zai-business-jwt"),
      },
    });

    await provider.createPaypalSetupToken({
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
    });
    await provider.subscribePaypal({
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      productId: "zai-product-pro",
      setupTokenId: "setup-token-1",
      amount: 18,
      estimatePayAmount: {
        thirdPartyPayAmount: 18,
      },
      bizId: "zai-biz-1",
    });

    expect(apiClient.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ method: "POST" }),
    );
    expect(apiClient.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("productInfo 使用产品详情接口补齐套餐展示信息", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 200,
          data: {
            productId: "product-lite",
            productName: "GLM Coding Lite",
            productBigTitle: "GLM Coding Plan",
            productSmallTitle: "轻量日常使用",
          },
        }),
      ),
    };
    const provider = new BigModelCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createBigModelCredentialService(),
    });

    const result = await provider.productInfo({ productId: "product-lite" });

    expect(result.productName).toBe("GLM Coding Lite");
    expect(apiClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "oauth-token",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("鉴权 header helper 只返回裸 token", () => {
    expect(createBigModelLoginAuthHeaders("token-1")).toEqual({
      Authorization: "token-1",
      "Content-Type": "application/json",
    });
  });

  it("Z.ai 鉴权 header helper 只返回裸登录 token", () => {
    expect(createZaiLoginAuthHeaders("zai-token")).toEqual({
      Authorization: "zai-token",
      "Content-Type": "application/json",
    });
  });

describe("ZaiCodingPlanSubscriptionProvider (family-aware Team Plan)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // resolveZaiBusinessBaseUrl 会优先读它，覆盖 ZCODE_ENV 逻辑导致测试域名断言不稳定。
  // 测试里统一 stub 成空，强制走 ZCODE_ENV fallback 链。
  function createZaiCredentialService(token = "zai-business-jwt") {
    return {
      load: vi.fn(async (key: string) => (key === "oauth:zai:access_token" ? token : null)),
    };
  }

  it("getEnterprisePricing 未登录走 zai 域名公开定价接口", async () => {
    vi.stubEnv("ZAI_BUSINESS_BASE_URL", "");
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 200,
          data: {
            productList: [
              {
                productId: "zai-team-pro",
                tier: "PRO",
                subscribeMode: "ONE_TIME",
                subscribePeriod: "MONTHLY",
                originalAmount: 18,
                discountAmount: 0,
                payAmount: 18,
                renewAmount: 18,
              },
            ],
          },
        }),
      ),
    };
    const provider = new ZaiCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: { load: vi.fn() },
    });

    const result = await provider.getEnterprisePricing({
      authenticated: false,
    });

    expect(result.productList[0]?.productId).toBe("zai-team-pro");
    expect(String(vi.mocked(apiClient.request).mock.calls[0]?.[0])).toBe(
    );
  });

  it("getEnterprisePricing 登录态使用 zai 域名 + zai OAuth token（非 bigmodel）", async () => {
    vi.stubEnv("ZAI_BUSINESS_BASE_URL", "");
    const apiClient: ApiClient = {
      request: vi.fn(async () => createJsonResponse({ code: 200, data: { productList: [] } })),
    };
    const provider = new ZaiCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createZaiCredentialService("zai-business-jwt"),
    });

    await provider.getEnterprisePricing({ authenticated: true });

    expect(apiClient.request).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(apiClient.request).mock.calls[0]?.[0])).toBe(
    );
    // 关键：token 是 zai 的，不带 Bearer
    expect(vi.mocked(apiClient.request).mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: {
        Authorization: "zai-business-jwt",
        "Content-Type": "application/json",
      },
    });
  });

    vi.stubEnv("ZCODE_ENV", "test");
    // 开发机 ZAI_BUSINESS_BASE_URL 会覆盖 ZCODE_ENV fallback，这里 stub 成空强制走 fallback
    vi.stubEnv("ZAI_BUSINESS_BASE_URL", "");
    const apiClient: ApiClient = {
      request: vi.fn(async () => createJsonResponse({ code: 200, data: { productList: [] } })),
    };


    expect(String(vi.mocked(apiClient.request).mock.calls[0]?.[0])).toBe(
    );
  });

  it("getEnterprisePricing 缺少 zai OAuth token 时抛 zai_oauth_required 且不请求", async () => {
    const apiClient: ApiClient = { request: vi.fn() };
    const provider = new ZaiCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: { load: vi.fn(async () => null) },
    });

    await expect(provider.getEnterprisePricing({ authenticated: true })).rejects.toThrow(
      "zai_oauth_required",
    );
    expect(apiClient.request).not.toHaveBeenCalled();
  });

  it("getEnterprisePricing 用 zai 域名的 customerInfo 给已购 Team Plan 补齐项目上下文", async () => {
    vi.stubEnv("ZAI_BUSINESS_BASE_URL", "");
    const requestUrls: string[] = [];
    const apiClient: ApiClient = {
      request: vi.fn(async (input) => {
        const url = input.toString();
        requestUrls.push(url);
        if (url.endsWith("/api/biz/subscription/enterprise/v2/pricing")) {
          return createJsonResponse({
            code: 200,
            data: {
              productList: [
                {
                  productId: "zai-team-pro",
                  tier: "PRO",
                  subscribeMode: "CONTINUOUS",
                  subscribePeriod: "MONTHLY",
                  subscribed: true,
                },
              ],
            },
          });
        }
        if (url.endsWith("/api/biz/customer/getCustomerInfo")) {
          return createJsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "zai-org",
                  organizationName: "zai 默认机构",
                  projects: [
                    {
                      projectId: "zai-proj",
                      projectName: "zai 团队项目",
                      projectType: 2,
                    },
                  ],
                },
              ],
            },
          });
        }
        if (url.endsWith("/organization/zai-org/projects/zai-proj/api_keys")) {
          // team-api-key 预热：返回已有可用 key，避免 create 调用
          return createJsonResponse({
            code: 200,
            data: [{ apiKey: "zai-team-ak", keyType: 2, name: "zcode-team-api-key" }],
          });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    };
    const provider = new ZaiCodingPlanSubscriptionProvider({
      apiClient,
      credentialService: createZaiCredentialService("zai-token"),
    });

    const result = await provider.getEnterprisePricing({ authenticated: true });

    // 关键：pricing + customerInfo + team-api-key 预热都走 zai 域名，
    expect(requestUrls).toEqual([
    ]);
    expect(result.productList[0]).toMatchObject({
      organizationId: "zai-org",
      projectId: "zai-proj",
      projectName: "zai 团队项目",
    });
  });

describe("createCodingPlanSubscriptionService (family routing)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createCredentialService() {
    return {
      load: vi.fn(async (key: string) => {
        if (key === "oauth:bigmodel:access_token") return "bigmodel-token";
        if (key === "oauth:zai:access_token") return "zai-token";
        return null;
      }),
    };
  }

  it("getEnterprisePricing 缺省 family 时走 bigmodel 域名（向后兼容）", async () => {
    const requestUrls: string[] = [];
    const apiClient: ApiClient = {
      request: vi.fn(async (input) => {
        requestUrls.push(input.toString());
        return createJsonResponse({ code: 200, data: { productList: [] } });
      }),
    };
    const service = createCodingPlanSubscriptionService({
      apiClient,
      credentialService: createCredentialService(),
    });

    await service.getEnterprisePricing({ authenticated: true });

  });

  it("getEnterprisePricing family=bigmodel 走 bigmodel 域名 + bigmodel token", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () => createJsonResponse({ code: 200, data: { productList: [] } })),
    };
    const service = createCodingPlanSubscriptionService({
      apiClient,
      credentialService: createCredentialService(),
    });

    await service.getEnterprisePricing({
      authenticated: true,
      family: "bigmodel",
    });

    expect(String(vi.mocked(apiClient.request).mock.calls[0]?.[0])).toBe(
    );
    expect(vi.mocked(apiClient.request).mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "bigmodel-token" },
    });
  });

  it("getEnterprisePricing family=zai 走 zai 域名 + zai token", async () => {
    vi.stubEnv("ZAI_BUSINESS_BASE_URL", "");
    const apiClient: ApiClient = {
      request: vi.fn(async () => createJsonResponse({ code: 200, data: { productList: [] } })),
    };
    const service = createCodingPlanSubscriptionService({
      apiClient,
      credentialService: createCredentialService(),
    });

    await service.getEnterprisePricing({ authenticated: true, family: "zai" });

    expect(String(vi.mocked(apiClient.request).mock.calls[0]?.[0])).toBe(
    );
    expect(vi.mocked(apiClient.request).mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "zai-token" },
    });
  });

  it("企业购买闭环接口仍走 bigmodel 域名（与 family 无关）", async () => {
    const apiClient: ApiClient = {
      request: vi.fn(async () =>
        createJsonResponse({
          code: 200,
          data: { giveBalance: 0, cashBalance: 0, totalBalance: 0 },
        }),
      ),
    };
    const service = createCodingPlanSubscriptionService({
      apiClient,
      credentialService: createCredentialService(),
    });

    await service.getEnterpriseBalance();

    expect(String(vi.mocked(apiClient.request).mock.calls[0]?.[0])).toBe(
    );
  });
});
