import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry =
  "/packages/ui/test/browser/manual-review/pending/floating-layer-hit-regions.fixture.tsx";
const artifacts =
  process.env.ZCODE_E2E_ARTIFACT_DIR ?? join(tmpdir(), "openzwork-floating-hit-regions");
let server, browser, origin;
before(async () => {
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "floating-hit-region-fixture",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (!req.url?.startsWith("/fixture?")) return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                req.url,
                `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
              ),
            );
          });
        },
      },
    ],
    resolve: { alias: { "@": `${root}packages/ui/src` } },
    optimizeDeps: { entries: [entry.slice(1)] },
    server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
  browser = await chromium.launch(
    process.env.CHROME_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
      : { channel: "chrome" },
  );
  await mkdir(artifacts, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

for (const [width, locale] of [
  [1200, "en-US"],
  [390, "zh-CN"],
]) {
  for (const theme of ["light", "dark"]) {
    for (const kind of [
      "dropdown",
      "dropdown-sub",
      "context",
      "context-sub",
      "popover",
      "hover-card",
    ]) {
      test(`${kind}: ${width}/${theme}/${locale}`, async () => {
        const page = await browser.newPage({ viewport: { width, height: 700 } });
        page.setDefaultTimeout(5_000);
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        try {
          await page.goto(`${origin}fixture?kind=${kind}&theme=${theme}&locale=${locale}`);
          if (kind.startsWith("context"))
            await page.getByTestId("trigger").click({ button: "right" });
          if (kind.endsWith("-sub")) {
            // 先打开父菜单再进入子菜单，让 Radix 按实际交互顺序登记指针事件层。
            await page.getByTestId("submenu-trigger").focus();
            await page.keyboard.press("ArrowRight");
          }
          const surface = page.getByTestId("surface");
          await surface.waitFor();
          await surface.evaluate(async (element) => {
            await Promise.allSettled(
              element.getAnimations().map((animation) => animation.finished),
            );
          });
          // 浏览器点击绕过操作系统的窗口命中，必须另验真实 CSS；原生鼠标由 Electron 验收覆盖。
          assert.equal(
            await surface.evaluate((element) =>
              getComputedStyle(element).getPropertyValue("app-region"),
            ),
            "no-drag",
          );
          assert.equal(
            await page
              .getByTestId("drag-region")
              .evaluate((element) => getComputedStyle(element).getPropertyValue("app-region")),
            "drag",
          );
          if (kind === "dropdown") {
            const inputBox = await page.getByTestId("search").boundingBox();
            assert.ok(inputBox && inputBox.y < 48, "搜索框必须覆盖标题栏拖拽区");
          }
          await page.screenshot({ path: join(artifacts, `${kind}-${width}-${theme}-opened.png`) });
          await page.getByTestId("search").click();
          await page.keyboard.type("xrag");
          assert.equal(await page.getByTestId("search").inputValue(), "xrag");
          assert.equal(await page.getByTestId("filtered").textContent(), "XRAG");
          await page.screenshot({ path: join(artifacts, `${kind}-${width}-${theme}.png`) });
          await page.getByTestId("select-project").click();
          assert.equal(await page.getByTestId("selected").textContent(), "XRAG");
          assert.deepEqual(errors, []);
        } finally {
          await page.close();
        }
      });
    }
  }
}
