import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { shouldShowOccupationOnboarding } from "../../ui/src/onboarding/onboardingVisibility.js";
import { seedRemoteOnboardingFixture } from "./e2e/helpers/remote-startup-profile.js";

const homes: string[] = [];
async function prepare(
  enabled: boolean,
  spec = "conversation-session-ssh-remote-connection-p0.test.ts",
) {
  const home = await mkdtemp(join(tmpdir(), "openzwork-remote-startup-"));
  homes.push(home);
  const appConfigDir = join(home, ".openzwork", "v2");
  await mkdir(appConfigDir, { recursive: true });
  await writeFile(join(appConfigDir, "setting.json"), JSON.stringify({ locale: "en-US" }));
  await seedRemoteOnboardingFixture({ enabled, specs: [spec], appConfigDir });
  const settings = JSON.parse(await readFile(join(appConfigDir, "setting.json"), "utf8"));
  return { settings, appConfigDir };
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("远程 E2E 的本地职业引导前置", () => {
  it("当前可见性规则认可职业设置，保留其他设置且不创建账号记录", async () => {
    const { settings, appConfigDir } = await prepare(true);
    expect(settings).toMatchObject({
      locale: "en-US",
      onboardingOccupation: "developer",
      memoryEnabled: false,
      proactiveSuggestionsEnabled: false,
    });
    expect(
      shouldShowOccupationOnboarding({
        requested: false,
        hasStoredOccupation: Boolean(settings.onboardingOccupation),
        dismissed: false,
        closedThisSession: false,
      }),
    ).toBe(false);
    await expect(readFile(join(appConfigDir, "onboarding-record.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    [false, "conversation-session-ssh-remote-connection-p0.test.ts"],
    [true, "conversation-session-rpn-project-navigation.test.ts"],
  ])("保留普通与导航专项的首次引导 (%s, %s)", async (enabled, spec) => {
    const { settings } = await prepare(enabled, spec);
    expect(settings).toEqual({ locale: "en-US" });
    expect(
      shouldShowOccupationOnboarding({
        requested: false,
        hasStoredOccupation: Boolean(settings.onboardingOccupation),
        dismissed: false,
        closedThisSession: false,
      }),
    ).toBe(true);
  });
});
