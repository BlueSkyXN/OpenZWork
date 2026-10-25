// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_METRICS_DISPLAY_PREFERENCES,
  METRICS_PREFERENCES_STORAGE_KEY,
  fitMetricsFields,
  normalizeMetricsDisplayPreferences,
} from "@/conversation-metrics/contract.js";
import { createConversationMetricsPreferencesStore } from "@/store/conversationMetricsPreferencesStore.js";

describe("指标显示偏好与内容宽度", () => {
  it("保留合法空集合，过滤未知/重复项并按显示顺序归一化", () => {
    expect(
      normalizeMetricsDisplayPreferences({ version: 1, enabled: false, visibleFields: [] }),
    ).toEqual({ version: 1, enabled: false, visibleFields: [] });
    expect(
      normalizeMetricsDisplayPreferences({
        version: 1,
        visibleFields: ["turnTokens", "unknown", "speed", "speed", 3],
      }).visibleFields,
    ).toEqual(["speed", "turnTokens"]);
    expect(normalizeMetricsDisplayPreferences(null)).toEqual(DEFAULT_METRICS_DISPLAY_PREFERENCES);
    expect(normalizeMetricsDisplayPreferences({ version: 2 })).toEqual(
      DEFAULT_METRICS_DISPLAY_PREFERENCES,
    );
  });

  it("只选速度和本轮时窄容器可同时显示，全选先折叠低优先级项", () => {
    const items = [
      { id: "statusDuration" as const, width: 70 },
      { id: "speed" as const, width: 60 },
      { id: "firstText" as const, width: 70 },
      { id: "turnTokens" as const, width: 70 },
      { id: "cache" as const, width: 70 },
      { id: "sessionTokens" as const, width: 70 },
      { id: "toolCalls" as const, width: 70 },
    ];
    expect(
      fitMetricsFields(
        items.filter((item) => item.id === "speed" || item.id === "turnTokens"),
        200,
        40,
        8,
      ),
    ).toEqual(["speed", "turnTokens"]);
    expect(fitMetricsFields(items, 270, 40, 8)).toEqual(["statusDuration", "speed", "turnTokens"]);
    expect(fitMetricsFields(items, 900, 40, 8)).toEqual(items.map((item) => item.id));
    expect(fitMetricsFields(items, 30, 40, 8)).toEqual([]);
  });
});

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("指标偏好单一存储路径", () => {
  it("关闭保留选择，重建恢复；等值写入不重复保存", () => {
    const backing = storage();
    const owner = createConversationMetricsPreferencesStore(backing);
    owner.store.getState().update({ visibleFields: ["speed", "turnTokens"] });
    owner.store.getState().update({ enabled: false });
    expect(createConversationMetricsPreferencesStore(backing).store.getState().preferences).toEqual(
      { version: 1, enabled: false, visibleFields: ["speed", "turnTokens"] },
    );
    backing.setItem.mockClear();
    owner.store.getState().update({ enabled: false });
    expect(backing.setItem).not.toHaveBeenCalled();
    owner.store.getState().update({ enabled: true });
    expect(owner.store.getState().preferences.visibleFields).toEqual(["speed", "turnTokens"]);
    owner.store.getState().reset();
    expect(owner.store.getState().preferences).toEqual(DEFAULT_METRICS_DISPLAY_PREFERENCES);
  });

  it("同域窗口读取最新保存值，不回写陈旧事件，独立存储域保持隔离", () => {
    const backing = storage();
    const first = createConversationMetricsPreferencesStore(backing);
    const second = createConversationMetricsPreferencesStore(backing);
    const separate = createConversationMetricsPreferencesStore(storage());
    const events = new EventTarget();
    const dispose = second.connect(events);
    const otherDispose = separate.connect(new EventTarget());
    first.store.getState().update({ visibleFields: ["speed"] });
    first.store.getState().update({ visibleFields: ["turnTokens"] });
    backing.setItem.mockClear();
    events.dispatchEvent(
      new StorageEvent("storage", {
        key: METRICS_PREFERENCES_STORAGE_KEY,
        newValue: JSON.stringify({ version: 1, enabled: true, visibleFields: ["speed"] }),
      }),
    );
    expect(second.store.getState().preferences.visibleFields).toEqual(["turnTokens"]);
    expect(backing.setItem).not.toHaveBeenCalled();
    expect(separate.store.getState().preferences).toEqual(DEFAULT_METRICS_DISPLAY_PREFERENCES);
    dispose();
    otherDispose();
  });

  it("多个消费者共享监听，最后卸载后清理；重新挂载读取保存值", () => {
    const owner = createConversationMetricsPreferencesStore(storage());
    const events = new EventTarget();
    const add = vi.spyOn(events, "addEventListener");
    const remove = vi.spyOn(events, "removeEventListener");
    const first = owner.connect(events);
    const second = owner.connect(events);
    expect(add.mock.calls.map((call) => call[0])).toEqual(["storage", "focus"]);
    first();
    expect(remove).not.toHaveBeenCalled();
    second();
    expect(remove.mock.calls.map((call) => call[0])).toEqual(["storage", "focus"]);
  });

  it("损坏 JSON 只回退本分组，读取不覆盖原值；存储不可写仍可本窗口修改", () => {
    const backing = storage();
    backing.setItem(METRICS_PREFERENCES_STORAGE_KEY, "{broken");
    backing.setItem.mockClear();
    const owner = createConversationMetricsPreferencesStore(backing);
    expect(owner.store.getState().preferences).toEqual(DEFAULT_METRICS_DISPLAY_PREFERENCES);
    expect(backing.setItem).not.toHaveBeenCalled();
    const unavailable = createConversationMetricsPreferencesStore({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    unavailable.store.getState().update({ enabled: false });
    expect(unavailable.store.getState().preferences.enabled).toBe(false);
    unavailable.refresh();
    expect(unavailable.store.getState().preferences.enabled).toBe(false);
  });
});
