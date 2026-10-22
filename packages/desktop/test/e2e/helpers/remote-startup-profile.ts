import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** 远程场景从已完成引导的隔离工作区开始；导航专项仍走自己的真实引导链。 */
export async function seedRemoteOnboardingFixture(options: {
  enabled: boolean;
  specs: readonly string[];
  appConfigDir: string;
}): Promise<void> {
  if (
    !options.enabled ||
    options.specs.some((spec) =>
      spec.endsWith("conversation-session-rpn-project-navigation.test.ts"),
    )
  )
    return;

  // 当前职业引导只读取本地 AppSettings，不再创建账号或设备锚定记录。
  await mkdir(options.appConfigDir, { recursive: true });
  const settingsPath = join(options.appConfigDir, "setting.json");
  const settings = await readFile(settingsPath, "utf8").then(
    (contents) => JSON.parse(contents),
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return {};
    },
  );
  await writeFile(
    settingsPath,
    JSON.stringify(
      {
        ...settings,
        onboardingOccupation: "developer",
        memoryEnabled: false,
        proactiveSuggestionsEnabled: false,
      },
      null,
      2,
    ),
  );
}
