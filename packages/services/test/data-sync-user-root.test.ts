import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { createCommandDataSyncMethods } from "../src/data-sync/commandDataSync.js";
import { createHookDataSyncMethods } from "../src/data-sync/hookDataSync.js";
import { createSkillDataSyncMethods } from "../src/data-sync/skillDataSync.js";

// WP-03 数据隔离回归（2026-11-07）：data-sync 三类服务的用户级读写根必须落在
// ~/.openzwork，不得触碰官方 ZCode 的 ~/.zcode。此前 commandsRoot/各 config 路径
// 指向 .zcode，远端同步会把命令、hooks、技能开关写进官方产品目录。
// 全部用例在临时 HOME 下执行，不触真实用户数据。

const homes: string[] = [];

async function useIsolatedHome(): Promise<string> {
  const home = join(
    tmpdir(),
    `ozw-data-sync-root-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(home, { recursive: true });
  homes.push(home);
  return home;
}

function withHomeEnv<T>(home: string, run: () => Promise<T>): Promise<T> {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  delete process.env.USERPROFILE;
  return run().finally(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
  });
}

afterEach(async () => {
  while (homes.length) {
    const home = homes.pop();
    if (home) await rm(home, { recursive: true, force: true });
  }
});

test("三类 data-sync 的写权限预检只落在 .openzwork，不创建 .zcode", async () => {
  await withHomeEnv(await useIsolatedHome(), async () => {
    const commandResult = await createCommandDataSyncMethods().checkSyncWriteAccess();
    assert.equal(commandResult.ok, true);
    assert.ok(existsSync(join(process.env.HOME!, ".openzwork", "commands")));
    assert.ok(existsSync(join(process.env.HOME!, ".openzwork", "cli")));

    await createHookDataSyncMethods().checkSyncWriteAccess();
    await createSkillDataSyncMethods({ maxItemBytes: 1024 * 1024 }).checkSyncWriteAccess();

    assert.ok(existsSync(join(process.env.HOME!, ".openzwork", "cli")));
    assert.equal(existsSync(join(process.env.HOME!, ".zcode")), false);
  });
});

test("命令导入的 createOnly 写入 ~/.openzwork/commands，.zcode 保持不存在", async () => {
  await withHomeEnv(await useIsolatedHome(), async () => {
    const commands = createCommandDataSyncMethods();
    const result = await commands.importSyncItems({
      items: [{ key: "/ozw-data-sync-regression", mode: "createOnly" }],
      payload: {
        sourceHomeDir: process.env.HOME!,
        items: [
          {
            key: "/ozw-data-sync-regression",
            name: "/ozw-data-sync-regression",
            relativePath: "ozw-data-sync-regression.md",
            content: new TextEncoder().encode(
              "---\ndescription: data-sync root regression\n---\nbody",
            ),
            enabled: true,
          },
        ],
      },
    });
    assert.deepEqual(
      result.results.map(({ key, status }) => ({ key, status })),
      [{ key: "/ozw-data-sync-regression", status: "created" }],
    );
    assert.ok(
      existsSync(join(process.env.HOME!, ".openzwork", "commands", "ozw-data-sync-regression.md")),
    );
    assert.equal(existsSync(join(process.env.HOME!, ".zcode")), false);
  });
});
