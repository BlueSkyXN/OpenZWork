import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const fixtureRoot = await mkdtemp(join(tmpdir(), "ozw-command-update-"));
const home = join(fixtureRoot, "home");
await mkdir(home);
process.env.HOME = home;
process.env.USERPROFILE = home;

const { createCommandsService } = await import("../src/commands/commandsService.js");
const service = createCommandsService({ isDesktopRuntime: true });
const configPath = join(home, ".openzwork", "cli", "config.json");

after(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

async function fixture(name = "original") {
  const workspacePath = await mkdtemp(join(fixtureRoot, "project-"));
  const { command } = await service.writeCommandFile({
    workspacePath,
    storageLevel: "project",
    config: { name, description: "original description", prompt: "original body" },
  });
  await service.setCommandEnabled({
    commandId: command.id,
    filePath: command.filePath,
    enabled: false,
  });
  const original =
    "---\ncustom-field: retained\ndescription: original description\n---\n\noriginal body";
  await writeFile(command.filePath, original);
  return {
    workspacePath,
    command,
    original,
    update: (newName: string, targetWorkspace = workspacePath) =>
      service.updateCommandFile({
        commandId: command.id,
        oldFilePath: command.filePath,
        workspacePath: targetWorkspace,
        storageLevel: "project",
        config: { name: newName, description: "updated description", prompt: "updated body" },
      }),
  };
}

test("重名改名失败时，原命令、目标命令与禁用配置保持原样", async () => {
  const current = await fixture();
  const targetPath = join(current.workspacePath, ".zcode", "commands", "occupied.md");
  await writeFile(targetPath, "existing target body");
  const originalConfig = await readFile(configPath, "utf8");

  await assert.rejects(current.update("occupied"), /already exists/);

  assert.equal(await readFile(current.command.filePath, "utf8"), current.original);
  assert.equal(await readFile(targetPath, "utf8"), "existing target body");
  assert.equal(await readFile(configPath, "utf8"), originalConfig);
});

test("移动目标的父目录无效时，原命令仍完整", async () => {
  const current = await fixture();
  const targetWorkspace = await mkdtemp(join(fixtureRoot, "blocked-project-"));
  await writeFile(join(targetWorkspace, ".zcode"), "blocking file");
  const originalConfig = await readFile(configPath, "utf8");

  await assert.rejects(current.update("renamed", targetWorkspace));

  assert.equal(await readFile(current.command.filePath, "utf8"), current.original);
  assert.equal(await readFile(configPath, "utf8"), originalConfig);
});

test("目标文件名无法写入时，原命令仍完整", async () => {
  const current = await fixture();
  const originalConfig = await readFile(configPath, "utf8");

  await assert.rejects(current.update("x".repeat(300)));

  assert.equal(await readFile(current.command.filePath, "utf8"), current.original);
  assert.equal(await readFile(configPath, "utf8"), originalConfig);
});

test("正常改名保留额外 frontmatter 和禁用状态，并移除旧路径", async () => {
  const current = await fixture();
  const { command } = await current.update("renamed");

  assert.equal(command.name, "/renamed");
  assert.equal(command.prompt, "updated body");
  assert.equal(command.enabled, false);
  assert.match(await readFile(command.filePath, "utf8"), /custom-field: retained/);
  await assert.rejects(readFile(current.command.filePath), { code: "ENOENT" });
  const listed = await service.list({ workspacePath: current.workspacePath });
  assert.deepEqual(
    listed.userCommands.map((item) => [item.name, item.enabled]),
    [["/renamed", false]],
  );
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.command[current.command.filePath], undefined);
  assert.deepEqual(config.command[command.filePath], { enable: false });
});

test("原路径编辑仍更新内容且保留禁用状态", async () => {
  const current = await fixture();
  const { command } = await current.update("original");

  assert.equal(command.filePath, current.command.filePath);
  assert.equal(command.prompt, "updated body");
  assert.equal(command.enabled, false);
  assert.match(await readFile(command.filePath, "utf8"), /custom-field: retained/);
});

test("仅改变文件名大小写仍可保存，目录保留新名称", async () => {
  const current = await fixture("Original");
  const { command } = await current.update("original");

  assert.equal(command.name, "/original");
  assert.equal(command.prompt, "updated body");
  assert.equal(command.enabled, false);
  assert.deepEqual(await readdir(join(current.workspacePath, ".zcode", "commands")), [
    "original.md",
  ]);
});

test("同时改到同一目标只有一个成功，失败方保留原命令", async () => {
  const first = await fixture("first");
  const second = await fixture("second");
  const targetWorkspace = await mkdtemp(join(fixtureRoot, "shared-project-"));
  const results = await Promise.allSettled([
    first.update("shared", targetWorkspace),
    second.update("shared", targetWorkspace),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejectedIndex = results.findIndex((result) => result.status === "rejected");
  const rejected = [first, second][rejectedIndex]!;
  const fulfilled = [first, second][1 - rejectedIndex]!;
  assert.equal(await readFile(rejected.command.filePath, "utf8"), rejected.original);
  await assert.rejects(readFile(fulfilled.command.filePath), { code: "ENOENT" });
  assert.match(
    await readFile(join(targetWorkspace, ".zcode", "commands", "shared.md"), "utf8"),
    /updated body/,
  );
});
