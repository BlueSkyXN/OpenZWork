import { describe, expect, it } from "vitest";
import {
  resolveAppShutdownPolicy,
} from "../src/main/appShutdownPolicy.js";

describe("app shutdown policy", () => {
  it("shortens frequent normal Windows shutdowns", () => {
    expect(resolveAppShutdownPolicy("normal", "win32")).toEqual({
      forceKillDelayMs: 4_000,
      waitTimeoutMs: 4_500,
    });
  });

  it("keeps the strict Windows update-install barrier", () => {
    expect(resolveAppShutdownPolicy("update-install", "win32")).toEqual({
      forceKillDelayMs: 7_500,
      waitTimeoutMs: 9_000,
    });
  });

  it("does not change non-Windows shutdown budgets", () => {
    expect(resolveAppShutdownPolicy("normal", "darwin")).toEqual({
      forceKillDelayMs: 7_500,
      waitTimeoutMs: 9_000,
    });
    expect(resolveAppShutdownPolicy("normal", "linux")).toEqual({
      forceKillDelayMs: 7_500,
      waitTimeoutMs: 9_000,
    });
  });
});
