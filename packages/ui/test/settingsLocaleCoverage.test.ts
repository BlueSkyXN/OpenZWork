import { expect, it } from "vitest";
import enUS from "../src/i18n/locales/en-US.js";
import jaJP from "../src/i18n/locales/ja-JP.js";
import koKR from "../src/i18n/locales/ko-KR.js";
import ruRU from "../src/i18n/locales/ru-RU.js";
import zhCN from "../src/i18n/locales/zh-CN.js";

const sections = [
  "settings.usage.",
  "metrics.display.",
  "settings.systemPrompt.",
  "configPackage.",
  "webRemoteControl.connection.",
];
const ids = Object.keys(enUS).filter(
  (id) => id === "settings.remoteControlTitle" || sections.some((prefix) => id.startsWith(prefix)),
);
const parameters = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();

// OZ-C012：英文回退后的词表无法区分已有翻译和缺译，需要检查各语言实际交付的词条。
it.each(Object.entries({ jaJP, koKR, ruRU, zhCN }))(
  "%s 提供设置页文案并保留插值参数",
  (_, messages) => {
    expect(ids.filter((id) => !messages[id]?.trim())).toEqual([]);
    for (const id of ids) expect(parameters(messages[id]!), id).toEqual(parameters(enUS[id]!));
  },
);

it.each(Object.entries({ enUS, jaJP, koKR, ruRU, zhCN }))(
  "%s 的同步错误指向受管插件目录",
  (_, messages) => {
    expect(messages["remoteSync.blocked.externalDirectory"]).toContain("~/.openzwork/plugins");
  },
);
