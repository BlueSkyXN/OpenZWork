// OZ-C012：界面语言持久化兼容合同回归（docs/specs/settings-locale-persistence-openzwork.md）。
// 驱动真实 createSettingService + 真实 setting.json 写盘队列 + 隔离 HOME/数据根；
// 不 mock 写盘路径，不读用户真实设置。修复前（v3.18.0 merge 4d263563 起）writeSettingsAt
// 直写 settings，本文件多语言/迁移用例失败。
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const envKeys = ["HOME", "ZCODE_DESKTOP_HOME_DIR", "ZCODE_DATA_BASE_DIR"] as const;
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const roots: string[] = [];

async function temp() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openzwork-locale-")));
  roots.push(root);
  return root;
}

// 每个用例独立 HOME/数据根 + 重置模块图，服务实例读写的都是本次临时 setting.json。
async function runtime() {
  const home = await temp();
  process.env.HOME = home;
  process.env.ZCODE_DESKTOP_HOME_DIR = home;
  delete process.env.ZCODE_DATA_BASE_DIR;
  vi.resetModules();
  const paths = await import("../src/paths.js");
  paths.setDataBaseDir(home);
  const settings = await import("../src/setting/settingService.js");
  await mkdir(join(home, ".openzwork", "v2"), { recursive: true });
  return {
    home,
    settingsFile: join(home, ".openzwork", "v2", "setting.json"),
    ...settings,
  };
}

type Context = Awaited<ReturnType<typeof runtime>>;

async function readRaw(context: Context): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(context.settingsFile, "utf-8")) as Record<string, unknown>;
}

// v3.17.x 旧客户端的严格枚举：落盘旧字段必须落在这些值内，旧版本 safeParse 才不会
// 把整份设置重置成默认值。
const legacyLocale = new Set(["zh-CN", "en-US"]);
const legacyPreference = new Set(["system", "zh-CN", "en-US"]);

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("settings locale persistence (OZ-C012)", () => {
  it.each(["ja-JP", "ru-RU", "ko-KR"] as const)(
    "persists %s with legacy-safe old fields and true uiLocale",
    async (locale) => {
      const context = await runtime();
      const service = context.createSettingService();
      await service.update({ locale, localePreference: locale });

      const raw = await readRaw(context);
      expect(raw.locale).toBe("en-US");
      expect(raw.localePreference).toBe("en-US");
      expect(raw.uiLocale).toBe(locale);
      expect(raw.uiLocalePreference).toBe(locale);
      expect(legacyLocale.has(raw.locale as string)).toBe(true);
      expect(legacyPreference.has(raw.localePreference as string)).toBe(true);
    },
  );

  it("keeps zh-CN and en-US semantics without new-field drift", async () => {
    const context = await runtime();
    const service = context.createSettingService();
    await service.update({ locale: "zh-CN", localePreference: "zh-CN" });

    let raw = await readRaw(context);
    expect(raw.locale).toBe("zh-CN");
    expect(raw.localePreference).toBe("zh-CN");
    expect(raw.uiLocale).toBe("zh-CN");
    expect(raw.uiLocalePreference).toBe("zh-CN");

    await service.update({ locale: "en-US", localePreference: "en-US" });
    raw = await readRaw(context);
    expect(raw.locale).toBe("en-US");
    expect(raw.localePreference).toBe("en-US");
    expect(raw.uiLocale).toBe("en-US");
    expect(raw.uiLocalePreference).toBe("en-US");
  });

  it("persists system preference as system for a non-zh/en locale", async () => {
    const context = await runtime();
    const service = context.createSettingService();
    await service.update({ locale: "ja-JP", localePreference: "system" });

    const raw = await readRaw(context);
    expect(raw.locale).toBe("en-US");
    expect(raw.localePreference).toBe("system");
    expect(raw.uiLocale).toBe("ja-JP");
    expect(raw.uiLocalePreference).toBe("system");
    expect(legacyPreference.has(raw.localePreference as string)).toBe(true);
  });

  it("recovers the real locale from a fresh service instance (cold recovery)", async () => {
    const context = await runtime();
    const service = context.createSettingService();
    await service.update({ locale: "ko-KR", localePreference: "ko-KR" });

    // 重开服务：重置模块图后用同一数据根新建实例，模拟下一次进程启动读取。
    vi.resetModules();
    const paths = await import("../src/paths.js");
    paths.setDataBaseDir(context.home);
    const settings = await import("../src/setting/settingService.js");
    const reopened = settings.createSettingService();
    const restored = await reopened.get();
    expect(restored.locale).toBe("ko-KR");
    expect(restored.localePreference).toBe("ko-KR");
  });

  it("migrates a legacy file whose old fields hold new-locale values", async () => {
    const context = await runtime();
    // 旧格式危险态：旧字段被写成旧版本无法解析的新值（内部测试期写入或降级残留）。
    await writeFile(
      context.settingsFile,
      JSON.stringify({ locale: "ja-JP", localePreference: "ja-JP", keepAwakeWhileRunning: true }),
      "utf-8",
    );

    const service = context.createSettingService();
    const settings = await service.get();
    // 内存识别真实语言（新字段缺失时按旧字段照常识别），不能回退成默认值。
    expect(settings.locale).toBe("ja-JP");
    expect(settings.localePreference).toBe("ja-JP");

    // get() 触发迁移重写：旧字段降级、新字段补齐，其他设置保留。
    const raw = await readRaw(context);
    expect(raw.locale).toBe("en-US");
    expect(raw.localePreference).toBe("en-US");
    expect(raw.uiLocale).toBe("ja-JP");
    expect(raw.uiLocalePreference).toBe("ja-JP");
    expect(raw.keepAwakeWhileRunning).toBe(true);
  });

  it("preserves unrelated settings across locale updates", async () => {
    const context = await runtime();
    const service = context.createSettingService();
    await service.update({ keepAwakeWhileRunning: true });
    await service.update({ locale: "ru-RU", localePreference: "ru-RU" });

    const raw = await readRaw(context);
    expect(raw.keepAwakeWhileRunning).toBe(true);
    expect(raw.uiLocale).toBe("ru-RU");
    // 保存后的读取仍拿到完整设置，语言与无关字段同源。
    const settings = await service.get();
    expect(settings.locale).toBe("ru-RU");
    expect(settings.keepAwakeWhileRunning).toBe(true);
  });
});
