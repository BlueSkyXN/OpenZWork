import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/system-prompt-editor.fixture.tsx";
const artifacts = join(tmpdir(), `openzwork-prompt-editor-${process.pid}`);
let server, browser, origin, core, observation;
let actualReads = 0;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "prompt-editor-acceptance",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            try {
              if (req.url?.startsWith("/fixture?")) {
                res.setHeader("Content-Type", "text/html");
                res.end(
                  await vite.transformIndexHtml(
                    req.url,
                    `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
                  ),
                );
                return;
              }
              if (!["/prompt-catalog", "/prompt-preview", "/prompt-actual"].includes(req.url))
                return next();
              const chunks = [];
              for await (const chunk of req) chunks.push(chunk);
              const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
              res.setHeader("Content-Type", "application/json");
              if (req.url === "/prompt-catalog")
                res.end(JSON.stringify(core.getSystemPromptCatalog()));
              if (req.url === "/prompt-preview")
                res.end(JSON.stringify(core.buildSystemPromptPreview(body)));
              if (req.url === "/prompt-actual") {
                actualReads += 1;
                assert.equal(body.sessionId, "example-session");
                assert.equal(body.workspacePath, "/example/project");
                res.end(JSON.stringify(observation.read(body)));
              }
            } catch (error) {
              res.statusCode = 500;
              res.end(String(error));
            }
          });
        },
      },
    ],
    resolve: { alias: { "@": `${root}packages/ui/src` } },
    optimizeDeps: { entries: [entry.slice(1)] },
    server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
  });
  // 浏览器消费真正的 CLI builder；服务边界用无凭据的本机 HTTP 夹具隔离。
  core = await server.ssrLoadModule(
    "/apps/zcode-cli/packages/core/src/context/prompt-settings/index.ts",
  );
  const { ContextBuilder } = await server.ssrLoadModule(
    "/apps/zcode-cli/packages/core/src/context/builder.ts",
  );
  const { buildProviderRequestMessages } = await server.ssrLoadModule(
    "/apps/zcode-cli/packages/core/src/runtime/helpers/provider-request-messages.ts",
  );
  const { createDefaultSystemPromptSettings } = await server.ssrLoadModule(
    "/packages/shared/src/system-prompt/contract.ts",
  );
  const settings = createDefaultSystemPromptSettings();
  settings.sections.role = { mode: "replace", content: "ACTUAL_REQUEST_ROLE" };
  const builder = new ContextBuilder({
    workingDirectory: "/example/project",
    envInfo: {
      cwd: "/example/project",
      platform: "linux",
      shell: "bash",
      osVersion: "Example",
      nodeVersion: "24",
    },
    systemPromptSettings: settings,
  });
  const projection = buildProviderRequestMessages({
    entries: builder.build().systemMessages.map((message) => ({ message })),
  });
  observation = new core.SystemPromptObservation();
  observation.capture({
    sessionId: "example-session",
    requestId: "example-request",
    model: "example/model",
    capturedAt: "2030-01-01T00:00:00.000Z",
    builder: builder.copyForPromptPreview(),
    settings,
    blocks: projection.promptBlocks,
    complete: projection.promptComplete,
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: "chrome" });
  await mkdir(artifacts, { recursive: true });
  process.stdout.write(`Prompt editor artifacts: ${artifacts}\n`);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const profile = {
  schema: "openzwork.system-prompt-profile",
  schemaVersion: 1,
  id: "example",
  name: "Example profile",
  settings: {
    version: 1,
    mode: "sections",
    sections: { role: { mode: "replace", content: "IMPORTED_ROLE" } },
    replacement: "",
    customSections: [{ id: "delivery", title: "Delivery", content: "IMPORTED_CUSTOM" }],
  },
};

for (const [width, locale, theme] of [
  [1280, "zh-CN", "light"],
  [1280, "en-US", "dark"],
  [390, "zh-CN", "dark"],
  [390, "en-US", "light"],
]) {
  test(`SPE04/08/09/14 PP01/08 ${width}/${locale}/${theme}`, { timeout: 90_000 }, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${origin}fixture?locale=${locale}&theme=${theme}`);
      await page.getByTestId("system-prompt-editor").waitFor();
      assert.equal(
        await page
          .locator("html")
          .evaluate(
            (element, expected) => element.classList.contains(`theme-zai-${expected}`),
            theme,
          ),
        true,
      );
      await page.getByTestId("system-prompt-import").click();
      await page.getByTestId("system-prompt-profile-json").fill(JSON.stringify(profile));
      await page.getByTestId("system-prompt-profile-preview").click();
      await page.locator('[data-testid="system-prompt-text-diff"]:visible').first().waitFor();
      await page.getByText("IMPORTED_ROLE", { exact: true }).first().waitFor();
      await page.screenshot({
        path: join(artifacts, `import-${width}-${locale}-${theme}.png`),
        fullPage: true,
      });
      await page.getByTestId("system-prompt-profile-apply").click();
      assert.equal(await page.getByTestId("fixture-saves").textContent(), "0");
      await page.getByTestId("system-prompt-open-preview").click();
      await page
        .getByTestId("system-prompt-full-content")
        .getByText("IMPORTED_CUSTOM", { exact: false })
        .waitFor();
      await page.getByTestId("system-prompt-full-diff").click();
      await page.locator('[data-testid="system-prompt-text-diff"]:visible').first().waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({
        path: join(artifacts, `diff-${width}-${locale}-${theme}.png`),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await page.getByTestId("fixture-external-update").click();
      assert.equal(await page.getByTestId("system-prompt-save").isDisabled(), true);
      assert.equal(
        await page.getByTestId("system-prompt-chapter-content").inputValue(),
        "IMPORTED_ROLE",
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

test(
  "SPE02/05/07 actual content, comparison and dynamic example",
  { timeout: 90_000 },
  async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${origin}fixture?locale=en-US&theme=light`);
      await page.getByTestId("system-prompt-chapter-env_info").click();
      await page.getByTestId("system-prompt-generated-env_info").locator("summary").click();
      await page
        .getByTestId("system-prompt-generated-env_info")
        .getByText("/example/project", { exact: false })
        .waitFor();
      await page.getByTestId("system-prompt-open-preview").click();
      await page.getByTestId("system-prompt-actual-tab").click();
      await page.getByRole("combobox").click();
      await page.getByRole("option", { name: /Example session/ }).click();
      await page.getByRole("button", { name: "Load / refresh actual content" }).click();
      await page
        .getByTestId("system-prompt-actual")
        .getByText("ACTUAL_REQUEST_ROLE", { exact: false })
        .waitFor();
      await page.getByRole("button", { name: "Compare with draft" }).click();
      await page
        .locator(
          '[data-testid="system-prompt-actual"] [data-testid="system-prompt-text-diff"]:visible',
        )
        .first()
        .waitFor();
      await page.getByText("SAVED_ROLE", { exact: true }).first().waitFor();
      assert.equal(actualReads, 2);
      await page.screenshot({ path: join(artifacts, "actual-comparison.png"), fullPage: true });
    } finally {
      await page.close();
    }
  },
);

test(
  "SPE12/13 PP03/06/10/11/15 templates, export, invalid input and defaults",
  { timeout: 90_000 },
  async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${origin}fixture?locale=en-US&theme=dark`);
      await page.getByTestId("system-prompt-chapter-select").click();
      await page.getByRole("option", { name: "Communication", exact: true }).click();
      await page.getByTestId("system-prompt-template-concise").click();
      await page.getByTestId("system-prompt-text-diff").waitFor();
      await page.getByRole("button", { name: "Apply to draft" }).click();
      const templateText = await page.getByTestId("system-prompt-chapter-content").inputValue();
      assert.ok(templateText.length > 0);
      assert.equal(await page.getByTestId("fixture-saves").textContent(), "0");
      await page.getByRole("button", { name: "Export draft", exact: true }).click();
      const exported = JSON.parse(
        await page.getByRole("textbox", { name: "Export draft" }).inputValue(),
      );
      assert.equal(exported.settings.sections.communication.content, templateText);
      assert.equal(exported.settings.sections.role.content, "SAVED_ROLE");
      assert.equal(JSON.stringify(exported).includes("baseContent"), false);
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Save JSON file" }).click();
      const download = await downloadPromise;
      assert.deepEqual(JSON.parse(await readFile(await download.path(), "utf8")), exported);
      await page.keyboard.press("Escape");
      await page.getByTestId("system-prompt-import").click();
      await page.getByTestId("system-prompt-profile-json").fill("{");
      await page.getByTestId("system-prompt-profile-preview").click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByTestId("system-prompt-profile-apply").isDisabled(), true);
      await page.getByTestId("system-prompt-profile-json").fill(
        JSON.stringify({
          ...profile,
          settings: {
            ...profile.settings,
            sections: { unknown_section: { mode: "default", content: "" } },
          },
        }),
      );
      await page.getByTestId("system-prompt-profile-preview").click();
      assert.match(await page.getByRole("alert").textContent(), /sections/);
      assert.equal(await page.getByTestId("system-prompt-profile-apply").isDisabled(), true);
      await page.keyboard.press("Escape");
      assert.equal(
        await page.getByTestId("system-prompt-chapter-content").inputValue(),
        templateText,
      );
      await page.getByTestId("system-prompt-save").click();
      await page.getByTestId("fixture-saves").filter({ hasText: "1" }).waitFor();
      await page.getByRole("button", { name: "Restore defaults", exact: true }).click();
      await page.getByTestId("system-prompt-profile-apply").click();
      assert.equal(await page.getByTestId("fixture-saves").textContent(), "1");
      await page.getByTestId("system-prompt-save").click();
      await page.getByTestId("fixture-saves").filter({ hasText: "2" }).waitFor();
      await page.getByRole("button", { name: "Export draft", exact: true }).click();
      const reset = JSON.parse(
        await page.getByRole("textbox", { name: "Export draft" }).inputValue(),
      );
      assert.deepEqual(reset.settings.sections, {});
      assert.deepEqual(reset.settings.customSections, []);
      await page.keyboard.press("Escape");
      await page.getByTestId("system-prompt-mode-replace").click();
      await page.getByRole("button", { name: "Start from default rules", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Conditional rules" }).waitFor();
      await page.getByTestId("system-prompt-profile-apply").click();
      const replacement = await page.getByTestId("system-prompt-replacement").inputValue();
      assert.match(replacement, /interactive ZCode agent/);
      assert.equal(replacement.includes("/example/project"), false);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  },
);
