import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { createLocalPairingRelay } from "../../../helpers/local-pairing-relay.js";
import { openMobilePairingPage } from "../../../helpers/mobile-pairing.js";
import { skipOccupationOnboardingIfPresent } from "../../../helpers/occupation-onboarding.js";
import type { WebRemoteControlStatus, IPlatformService } from "@zcode/shared";

const artifacts = resolve(process.env.ZCODE_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/v1-connections");
let mobile: Browser | undefined;
const closes: Array<() => Promise<unknown>> = [];

async function status() {
  return JSON.parse(
    await browser.execute(async () => {
      const result = await (
        window as unknown as { zcode: IPlatformService }
      ).zcode.getWebRemoteControlStatus();
      // 配对链接只经临时 loopback 接收器传递，不进入 WebDriver 返回值和日志。
      return JSON.stringify({
        status: result.status,
        mobileConnected: result.mobileConnected,
        mode: result.connection?.mode,
      });
    }),
  ) as Pick<WebRemoteControlStatus, "status" | "mobileConnected"> & { mode?: string };
}
async function clickButton(pattern: string) {
  await browser.waitUntil(
    () =>
      browser.execute(
        (text) =>
          Array.from(
            document.querySelectorAll<HTMLButtonElement>(
              '[data-testid="web-remote-control-dialog-scroll"] button',
            ),
          ).some((item) => new RegExp(text).test(item.innerText.trim()) && !item.disabled),
        pattern,
      ),
    { timeout: 10_000 },
  );
  await browser.execute((text) => {
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="web-remote-control-dialog-scroll"] button',
      ),
    ).find((item) => new RegExp(text).test(item.innerText.trim()));
    if (!button || button.disabled) throw new Error("Remote control action unavailable");
    button.click();
  }, pattern);
}
async function openDialog() {
  await skipOccupationOnboardingIfPresent();
  if (await $('[data-testid="web-remote-control-dialog-scroll"]').isExisting()) {
    await $('[data-testid="web-remote-start"]').waitForEnabled({ timeout: 10_000 });
    return;
  }
  const trigger = $(
    'button[aria-label="移动端远程控制"], button[aria-label="Mobile remote control"]',
  );
  await trigger.waitForDisplayed({ timeout: 60_000 });
  await trigger.click();
  await $('[data-testid="web-remote-start"]').waitForEnabled({ timeout: 10_000 });
}
async function pairingLink(): Promise<string> {
  let receive!: (url: string) => void;
  const pairing = new Promise<string>((done) => {
    receive = done;
  });
  const receiver = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (request.method === "OPTIONS") {
      response.end();
      return;
    }
    let link = "";
    for await (const chunk of request) link += String(chunk);
    receive(link);
    response.end();
  });
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  const address = receiver.address();
  if (!address || typeof address === "string") throw new Error("Pairing receiver unavailable");
  try {
    await browser.execute((port) => {
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (link) => {
        navigator.clipboard.writeText = original;
        await fetch(`http://127.0.0.1:${port}`, { method: "POST", body: link });
      };
    }, address.port);
    await clickButton("^(复制链接|Copy link)$");
    return await pairing;
  } finally {
    receiver.closeAllConnections();
    await new Promise<void>((done) => receiver.close(() => done()));
  }
}
async function maskedDesktopScreenshot(name: string) {
  await browser.execute(() => {
    for (const image of document.querySelectorAll<HTMLImageElement>(
      '[data-testid="web-remote-control-scan-card"] img',
    ))
      image.style.visibility = "hidden";
  });
  try {
    await browser.saveScreenshot(join(artifacts, name));
  } finally {
    await browser.execute(() => {
      for (const image of document.querySelectorAll<HTMLImageElement>(
        '[data-testid="web-remote-control-scan-card"] img',
      ))
        image.style.visibility = "";
    });
  }
}

describe("E2E_V1_CONNECTIONS", () => {
  before(async () => {
    await mkdir(artifacts, { recursive: true });
    mobile = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--host-resolver-rules=MAP openzwork.test 127.0.0.1", "--no-proxy-server"],
    });
  });
  afterEach(async () => {
    await browser.execute(async () => {
      await (window as unknown as { zcode: IPlatformService }).zcode.stopWebRemoteControl();
    });
  });
  after(async () => {
    await browser
      .execute(async () => {
        await (window as unknown as { zcode: IPlatformService }).zcode.stopWebRemoteControl();
      })
      .catch(() => {});
    await mobile?.close();
    for (const close of closes.reverse()) await close();
  });
  it("V1-01/02/04/07: HTTP entry, pairing, task draft and stop", async function () {
    this.timeout(180_000);
    await openDialog();
    expect((await status()).status).toBe("idle");
    await $('[data-testid="web-remote-mode-official"]').click();
    expect((await status()).status).toBe("idle");
    await $('[data-testid="web-remote-mode-self-hosted"]').click();
    expect(await $('[data-testid="web-remote-relay-url"]').isDisplayed()).toBe(true);
    await $('[data-testid="web-remote-mode-direct"]').click();
    await $('[data-testid="web-remote-listen-host"]').setValue("127.0.0.1");
    await $('[data-testid="web-remote-start"]').click();
    await browser.waitUntil(async () => (await status()).status === "running", { timeout: 35_000 });
    const pairing = new URL(await pairingLink());
    const loopbackUrl = pairing.origin;
    pairing.hostname = "openzwork.test";
    const context = await mobile!.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    await page.goto(pairing.origin);
    await page.getByRole("textbox").waitFor();
    expect(await page.evaluate(() => isSecureContext)).toBe(false);
    expect(await page.evaluate(() => Boolean(globalThis.crypto?.subtle))).toBe(false);
    await page.screenshot({ path: join(artifacts, "http-entry.png") });
    await page.getByRole("textbox").fill(pairing.toString());
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await browser.waitUntil(async () => (await status()).mobileConnected === true, {
      timeout: 30_000,
    });
    await openMobilePairingPage(page, pairing.toString(), {
      artifactDir: artifacts,
      caseMarker: "E2E_V1_CONNECTIONS",
      phase: "direct",
      readySelector: '[data-testid="virtual-project-new-task"]',
    });
    await browser.waitUntil(async () => (await status()).mobileConnected === true);
    await page.getByTestId("virtual-project-new-task").click();
    await page.getByTestId("v4-composer-input").waitFor({ timeout: 30_000 });
    await page.getByTestId("v4-composer-input").fill("E2E_V1_HTTP_DRAFT");
    expect(await page.getByTestId("v4-composer-input").innerText()).toContain("E2E_V1_HTTP_DRAFT");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: join(artifacts, "http-mobile-draft.png") });
    await maskedDesktopScreenshot("direct-connected.png");
    await clickButton("^(关闭远程控制|停止|Stop.*)$");
    await browser.waitUntil(async () => (await status()).status === "idle");
    await expect(fetch(loopbackUrl)).rejects.toThrow();
    await context.close();
    await writeFile(
      join(artifacts, "direct-result.json"),
      JSON.stringify({ insecureHttp: true, paired: true, draft: true, portClosed: true }),
    );
  });
  it("V1-05/06/08: self-hosted V1 relay with a separately hosted page", async function () {
    this.timeout(150_000);
    const relay = await createLocalPairingRelay();
    closes.push(relay.close);
    const root = resolve("out/web-remote");
    const assets = createServer((request, response) => {
      void (async () => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        const relative =
          pathname === "/remote/" || pathname === "/remote"
            ? "index.html"
            : pathname.replace(/^\/remote\//, "");
        const file = resolve(root, relative);
        if (!file.startsWith(root + sep)) {
          response.writeHead(404).end();
          return;
        }
        const mime: Record<string, string> = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
        };
        response.setHeader("Content-Type", mime[extname(file)] ?? "application/octet-stream");
        response.end(await readFile(file));
      })().catch(() => response.writeHead(404).end());
    });
    assets.listen(0, "127.0.0.1");
    await once(assets, "listening");
    const address = assets.address();
    if (!address || typeof address === "string") throw new Error("Static fixture unavailable");
    closes.push(async () => {
      assets.closeAllConnections();
      await new Promise<void>((done) => assets.close(() => done()));
    });
    await openDialog();
    await $('[data-testid="web-remote-mode-self-hosted"]').click();
    await $('[data-testid="web-remote-relay-url"]').setValue(relay.wsUrl);
    await $('[data-testid="web-remote-page-url"]').setValue(
      `http://127.0.0.1:${address.port}/remote/`,
    );
    await $('[data-testid="web-remote-start"]').click();
    await browser.waitUntil(async () => (await status()).status === "running", { timeout: 35_000 });
    const link = await pairingLink();
    expect(new URL(link).searchParams.get("relay")).toBe(relay.wsUrl);
    const context = await mobile!.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
    });
    const page = await context.newPage();
    await openMobilePairingPage(page, link, {
      artifactDir: artifacts,
      caseMarker: "E2E_V1_CONNECTIONS",
      phase: "self-hosted",
      readySelector: '[data-testid="virtual-project-new-task"]',
    });
    await browser.waitUntil(async () => (await status()).mobileConnected === true);
    expect((await status()).mode).toBe("self-hosted");
    await page.screenshot({ path: join(artifacts, "self-hosted-mobile.png") });
    await maskedDesktopScreenshot("self-hosted-connected.png");
    await clickButton("^(关闭远程控制|停止|Stop.*)$");
    await context.close();
  });
  it("V1-08: official V1 endpoint and official mobile page without OAuth", async function () {
    if (process.env.ZCODE_E2E_VERIFY_OFFICIAL_V1 !== "1") {
      this.skip();
      return;
    }
    this.timeout(180_000);
    await openDialog();
    await openDialog();
    await $('[data-testid="web-remote-mode-official"]').click();
    await $('[data-testid="web-remote-start"]').click();
    await browser.waitUntil(async () => (await status()).status === "running", { timeout: 40_000 });
    const link = await pairingLink();
    expect(new URL(link).origin).toBe("https://zcode.z.ai");
    const context = await mobile!.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    await openMobilePairingPage(page, link, {
      artifactDir: artifacts,
      caseMarker: "E2E_V1_CONNECTIONS",
      phase: "official",
      readySelector: "text=E2E_V1_OFFICIAL_TASK",
    });
    await browser.waitUntil(async () => (await status()).mobileConnected === true);
    expect((await status()).mode).toBe("official");
    await page.getByText("E2E_V1_OFFICIAL_TASK", { exact: true }).click();
    await page.locator('[contenteditable="true"]').first().waitFor({ timeout: 30_000 });
    await page
      .getByText("E2E_V1_PERSISTED_ASSISTANT", { exact: false })
      .first()
      .waitFor({ timeout: 30_000 });
    await page.locator('[contenteditable="true"]').first().fill("E2E_V1_OFFICIAL_DRAFT");
    expect(await page.locator('[contenteditable="true"]').first().innerText()).toContain(
      "E2E_V1_OFFICIAL_DRAFT",
    );
    await page.screenshot({ path: join(artifacts, "official-mobile.png") });
    await maskedDesktopScreenshot("official-connected.png");
    await clickButton("^(关闭远程控制|停止|Stop.*)$");
    await context.close();
  });
});
