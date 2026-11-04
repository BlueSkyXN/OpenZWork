import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tsImport } from "tsx/esm/api";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry =
  "/packages/ui/test/browser/manual-review/pending/model-capability-matching.fixture.tsx";
const artifacts = join(tmpdir(), "openzwork-model-capability-matching");
let server, browser, origin, rules;

before(async () => {
  await mkdir(artifacts, { recursive: true });
  const { decodeZCodeBuiltinRelease } = await tsImport(
    pathToFileURL(join(root, "packages/provider-node/src/index.ts")).href,
    import.meta.url,
  );
  rules = decodeZCodeBuiltinRelease(
    JSON.parse(await readFile(join(root, "config/provider/zcode-builtin.json"), "utf8")),
  ).config.modelConfigRules;
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "model-capability-matching-fixture",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (req.url?.startsWith("/resolve?")) {
              const id = new URL(req.url, "http://localhost").searchParams.get("id");
              const result = rules.resolveWithMatch({
                providerId: "fixture",
                modelId: id,
                apiType: "anthropic-messages",
                baseUrl: "https://gateway.example/v1",
              });
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  inheritedConfig: result.config.toJSON(),
                  effectiveConfig: result.config.toJSON(),
                  recommendationMatch: result.matchKind,
                  issues: result.config.validateComplete(),
                }),
              );
              return;
            }
            if (!req.url?.startsWith("/fixture?")) return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                req.url,
                `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
              ),
            );
          });
        },
      },
    ],
    resolve: { alias: { "@": `${root}packages/ui/src` } },
    optimizeDeps: { entries: [entry.slice(1)] },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
  browser = await chromium.launch(
    process.env.CHROME_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
      : { channel: "chrome" },
  );
});
after(async () => {
  await browser?.close();
  await server?.close();
});

for (const [width, locale, theme] of [
  [1200, "zh-CN", "light"],
  [1200, "en-US", "dark"],
  [390, "zh-CN", "dark"],
  [390, "en-US", "light"],
]) {
  test(`MCR08 recommendation source ${width}/${locale}/${theme}`, { timeout: 30_000 }, async () => {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(10_000);
    const errors = [],
      writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/mutation", async (route) => {
      writes.push(route.request().postDataJSON());
      await route.fulfill({ body: "{}" });
    });
    try {
      await page.goto(`${origin}fixture?${new URLSearchParams({ locale, theme })}`);
      const id = page.locator("[data-model-identity-row] input");
      await id.fill("glm-5.3");
      await id.blur();
      await page.locator('[data-model-recommendation-source="model"]').waitFor();
      await page.locator("[data-model-advanced-trigger]").click();
      assert.deepEqual(await page.locator("[data-model-reasoning-chip]").allTextContents(), [
        "low",
        "high",
        "max",
      ]);
      await id.fill("unknown-future-model");
      await id.blur();
      const generic = page.locator('[data-model-recommendation-source="generic"]');
      await generic.waitFor();
      assert.equal(
        await generic.textContent(),
        locale === "zh-CN" ? "通用配置" : "Generic configuration",
      );
      assert.deepEqual(await page.locator("[data-model-reasoning-chip]").allTextContents(), [
        "disabled",
        "enabled",
      ]);
      await page.screenshot({
        path: join(artifacts, `${width}-${locale}-${theme}.png`),
        fullPage: true,
      });
      const toggle = page.locator('[data-model-recommended-config] [role="switch"]');
      await toggle.click();
      assert.equal(await page.locator("[data-model-recommendation-source]").count(), 0);
      await toggle.click();
      await generic.waitFor();
      await page
        .locator("[data-model-settings-footer]")
        .getByRole("button", {
          name: locale === "zh-CN" ? "保存" : "Save",
          exact: true,
        })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(writes.length, 1);
      assert.equal(writes[0].modelId, "unknown-future-model");
      assert.equal("recommendationMatch" in writes[0].personalConfig, false);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

test(
  "MCR08 stale resolution cannot restore the old Provider source",
  { timeout: 30_000 },
  async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    let resolveRoute;
    const received = new Promise((resolve) => {
      resolveRoute = resolve;
    });
    await page.route("**/resolve?*", (route) => resolveRoute(route));
    try {
      await page.goto(`${origin}fixture?locale=zh-CN&theme=light`);
      const id = page.locator("[data-model-identity-row] input");
      await id.fill("glm-5.3");
      await id.blur();
      const stale = await received;
      await page.getByTestId("external-scope").evaluate((node) => node.click());
      await stale.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ inheritedConfig: {}, issues: [], recommendationMatch: "channel" }),
      });
      await page.waitForFunction(
        () => document.querySelector("[data-model-identity-row] input")?.value === "a",
      );
      assert.equal(await page.locator("[data-model-recommendation-source]").count(), 0);
    } finally {
      await page.close();
    }
  },
);

test(
  "MCR08 saved-model source survives edit and restore; cancel does not save",
  { timeout: 30_000 },
  async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const writes = [];
    await page.route("**/mutation", (route) => {
      writes.push(route.request().postData());
      return route.fulfill({ body: "{}" });
    });
    try {
      await page.goto(`${origin}fixture?locale=zh-CN&theme=light&edit=1`);
      const badge = page.locator('[data-model-recommendation-source="generic"]');
      await badge.waitFor();
      assert.equal(
        await page.locator("[data-model-identity-row] input").getAttribute("readonly"),
        "",
      );
      await page.getByRole("button", { name: "重置表单", exact: true }).click();
      await badge.waitFor();
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.deepEqual(writes, []);
    } finally {
      await page.close();
    }
  },
);

test(
  "MCR08 channel recommendation is displayed from Host resolution",
  { timeout: 30_000 },
  async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.route("**/resolve?*", (route) => {
      const result = rules.resolveWithMatch({
        providerId: "fixture",
        modelId: "glm-5.3",
        apiType: "anthropic-messages",
        baseUrl: "https://openrouter.ai/api/v1",
      });
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          inheritedConfig: result.config.toJSON(),
          effectiveConfig: result.config.toJSON(),
          recommendationMatch: result.matchKind,
          issues: [],
        }),
      });
    });
    try {
      await page.goto(`${origin}fixture?locale=zh-CN&theme=light`);
      const id = page.locator("[data-model-identity-row] input");
      await id.fill("glm-5.3");
      await id.blur();
      const badge = page.locator('[data-model-recommendation-source="channel"]');
      await badge.waitFor();
      assert.equal(await badge.textContent(), "渠道推荐");
    } finally {
      await page.close();
    }
  },
);
