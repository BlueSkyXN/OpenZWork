import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

const fixtureRoot = await mkdtemp(join(tmpdir(), "ozw-home-resources-"));
const home = join(fixtureRoot, "home");
await mkdir(home);
process.env.HOME = home;
process.env.USERPROFILE = home;

const { createSkillsService } = await import("../src/skills/skillsService.js");
const { createCommandsService } = await import("../src/commands/commandsService.js");
const { createNodeSkillAdapter } =
  await import("../../../apps/zcode-cli/packages/adapters/src/skills/index.js");
const { createNodeCustomCommandAdapter } =
  await import("../../../apps/zcode-cli/packages/adapters/src/commands/index.js");
const { resolveDefaultSkillRoots } =
  await import("../../../apps/zcode-cli/packages/adapters/src/skills/roots.js");
const { resolveDefaultCustomCommandRoots } =
  await import("../../../apps/zcode-cli/packages/adapters/src/commands/roots.js");

const skillsService = createSkillsService({ isDesktopRuntime: true });
const commandsService = createCommandsService({ isDesktopRuntime: true });
const skillAdapter = createNodeSkillAdapter({ homeDirectory: home });
const commandAdapter = createNodeCustomCommandAdapter({ homeDirectory: home });

async function writeResource(base: string, directory: string, name: string): Promise<void> {
  const skillPath = join(base, directory, "skills", name, "SKILL.md");
  const commandPath = join(base, directory, "commands", `${name}.md`);
  await mkdir(dirname(skillPath), { recursive: true });
  await mkdir(dirname(commandPath), { recursive: true });
  await writeFile(
    skillPath,
    `---\nname: ${name}\ndescription: ${name} fixture\n---\n\n${name} body\n`,
  );
  await writeFile(commandPath, `---\ndescription: ${name} fixture\n---\n\n${name} body\n`);
}

await writeResource(home, ".zcode", "legacy-only");
await writeResource(home, ".openzwork", "current-only");
await writeResource(home, ".agents", "compatible-user");
const legacySkillPath = join(home, ".zcode", "skills", "legacy-only", "SKILL.md");
const legacyCommandPath = join(home, ".zcode", "commands", "legacy-only.md");
const legacySkill = await readFile(legacySkillPath, "utf8");
const legacyCommand = await readFile(legacyCommandPath, "utf8");

after(async () => {
  assert.equal(await readFile(legacySkillPath, "utf8"), legacySkill);
  assert.equal(await readFile(legacyCommandPath, "utf8"), legacyCommand);
  await rm(fixtureRoot, { recursive: true, force: true });
});

async function assertHomeExcluded(cwd: string): Promise<void> {
  const skillRoots = await resolveDefaultSkillRoots(cwd, { homeDirectory: home });
  const commandRoots = await resolveDefaultCustomCommandRoots(cwd, { homeDirectory: home });
  assert.ok(!skillRoots.some((root) => root.path === join(cwd, ".zcode", "skills")));
  assert.ok(!commandRoots.some((root) => root.path === join(cwd, ".zcode", "commands")));
  const skills = await skillAdapter.discoverSkills({ workingDirectory: cwd });
  const commands = await commandAdapter.discoverCommands({ workingDirectory: cwd });
  assert.deepEqual(skills.skills.map((skill) => skill.name).sort(), [
    "compatible-user",
    "current-only",
  ]);
  assert.deepEqual(commands.commands.map((command) => command.name).sort(), [
    "compatible-user",
    "current-only",
  ]);
  await assert.rejects(
    skillAdapter.loadSkill({ workingDirectory: cwd, name: "legacy-only" }),
    /not found/i,
  );
  await assert.rejects(
    commandAdapter.loadCommand({ workingDirectory: cwd, name: "legacy-only" }),
    /not found/i,
  );
  const uiSkills = await skillsService.list({ workspacePath: cwd });
  const uiCommands = await commandsService.list({ workspacePath: cwd });
  assert.deepEqual(uiSkills.skills.map((skill) => skill.name).sort(), [
    "compatible-user",
    "current-only",
  ]);
  assert.deepEqual(uiCommands.userCommands.map((command) => command.name).sort(), [
    "/current-only",
  ]);
}

test("HOME 作为 cwd 时，CLI 与设置页不发现或加载官方根资源", async () => {
  await assertHomeExcluded(home);
  assert.match(
    (await skillAdapter.loadSkill({ workingDirectory: home, name: "current-only" })).content,
    /current-only body/,
  );
  assert.match(
    (await commandAdapter.loadCommand({ workingDirectory: home, name: "current-only" })).content,
    /current-only body/,
  );
});

test("HOME 是 Git 根时，子目录扫描仍排除 HOME，普通项目资源保持兼容", async () => {
  await mkdir(join(home, ".git"));
  const project = join(home, "project");
  await writeResource(project, ".zcode", "project-native");
  await writeResource(project, ".agents", "project-compatible");
  await assertHomeExcluded(home);
  const expected = ["compatible-user", "current-only", "project-compatible", "project-native"];
  const skills = await skillAdapter.discoverSkills({ workingDirectory: project });
  const commands = await commandAdapter.discoverCommands({ workingDirectory: project });
  assert.deepEqual(skills.skills.map((skill) => skill.name).sort(), expected);
  assert.deepEqual(commands.commands.map((command) => command.name).sort(), expected);
  assert.deepEqual(
    (await skillsService.list({ workspacePath: project })).skills.map((skill) => skill.name).sort(),
    expected,
  );
  const created = await commandsService.writeCommandFile({
    workspacePath: project,
    storageLevel: "project",
    config: { name: "created", description: "created fixture", prompt: "created body" },
  });
  assert.equal(created.command.filePath, join(project, ".zcode", "commands", "created.md"));
});

test("HOME 的符号链接别名不能恢复旧根扫描", { skip: process.platform === "win32" }, async () => {
  const alias = join(fixtureRoot, "home-alias");
  await symlink(home, alias, "dir");
  await assertHomeExcluded(alias);
});

test("新原生根为空时，设置页仍发现用户级兼容命令", async () => {
  const currentCommand = join(home, ".openzwork", "commands", "current-only.md");
  const content = await readFile(currentCommand, "utf8");
  await rm(currentCommand);
  try {
    const listed = await commandsService.list({ workspacePath: home });
    assert.deepEqual(
      listed.userCommands.map((command) => command.name),
      ["/compatible-user"],
    );
  } finally {
    await writeFile(currentCommand, content);
  }
});

test("设置页拒绝向 HOME 的原生项目命令目录写入", async () => {
  await assert.rejects(
    commandsService.writeCommandFile({
      workspacePath: home,
      storageLevel: "project",
      config: { name: "must-not-write", description: "fixture", prompt: "body" },
    }),
    /home|主目录/i,
  );
  await assert.rejects(
    commandsService.updateCommandFile({
      workspacePath: home,
      storageLevel: "project",
      commandId: "legacy",
      oldFilePath: legacyCommandPath,
      config: { name: "must-not-update", prompt: "replacement" },
    }),
    /home|主目录/i,
  );
  assert.equal(await readFile(legacyCommandPath, "utf8"), legacyCommand);
  await assert.rejects(readFile(join(home, ".zcode", "commands", "must-not-write.md")), {
    code: "ENOENT",
  });
});
