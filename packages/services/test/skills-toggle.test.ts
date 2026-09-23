import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

// WP-E1c 技能开关回归测试（docs/spec/skills-toggle.md §6 建议项的自动化沉淀）。
// 覆盖链路：skillsService.setEnabled 落盘 → adapters config schema 解析为 skillOverrides
// → bootstrap collectDisabledPaths → NodeSkillAdapter 发现期剔除。
//
// 隔离方式：skillsService 在模块加载时就把 CLI config 路径解析成常量
// （skillsService.ts:50-52 读取 HOME/USERPROFILE），因此必须在动态 import 之前
// 先把 HOME 指向临时目录，全程不读写真实用户数据根（与 paths-isolation.test.ts 同思路）。
const isolatedHome = mkdtempSync(join(tmpdir(), "ozw-skills-toggle-home-"));
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;

const { createSkillsService } = await import("../src/skills/skillsService.js");
// 跨 workspace 引用说明：@zcode/services 未声明对 @zcode/adapters、@zcode/bootstrap 的
// workspace 依赖（pnpm 链接不存在），且本任务禁止运行安装脚本补链接，测试只能以相对路径
// 直达两个包的源码公开导出（均为包内 export 的公开函数，不触实现细节）。
// test/ 目录不属于任何 tsconfig 工程（services 的 include 只有 src），仅由 tsx 运行时执行。
const { parseConfigFileToRuntimePatchWithDiagnostics } =
  await import("../../../apps/zcode-cli/packages/adapters/src/config/schema.js");
const { collectDisabledPaths } =
  await import("../../../apps/zcode-cli/packages/bootstrap/src/skill-command-overrides.js");
const { createNodeSkillAdapter } =
  await import("../../../apps/zcode-cli/packages/adapters/src/skills/index.js");

const cliConfigPath = join(isolatedHome, ".openzwork", "cli", "config.json");
const service = createSkillsService({ isDesktopRuntime: true });
const fixtureRoot = await mkdtemp(join(tmpdir(), "ozw-skills-toggle-ws-"));

after(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
  await rm(isolatedHome, { recursive: true, force: true });
});

/** 写一个带合法 frontmatter 的技能 fixture（agent 侧解析要求 name + description）。 */
async function writeSkillFixture(skillDir: string, name: string): Promise<string> {
  await mkdir(skillDir, { recursive: true });
  const skillMd = join(skillDir, "SKILL.md");
  await writeFile(
    skillMd,
    `---\nname: ${name}\ndescription: ${name} regression fixture\n---\n\nbody of ${name}\n`,
    "utf8",
  );
  return skillMd;
}

/** 每个用例从全新 config 出发（spec §6 A1.1/A4.1：默认全开、无 skills 段）。 */
async function resetCliConfig(): Promise<void> {
  await rm(cliConfigPath, { force: true });
}

async function readCliConfigJson(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(cliConfigPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeCliConfigJson(config: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(cliConfigPath), { recursive: true });
  await writeFile(cliConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function createWorkspaceWithSkills(names: string[]): Promise<string> {
  const workspacePath = await mkdtemp(join(fixtureRoot, "ws-"));
  for (const name of names) {
    await writeSkillFixture(join(workspacePath, ".zcode", "skills", name), name);
  }
  return workspacePath;
}

/** spec §2.2：持久化 key 是 SKILL.md 的 realpath 形态绝对路径。 */
async function realSkillKey(skillMd: string): Promise<string> {
  return realpath(skillMd);
}

interface AgentSkillRoot {
  path: string;
  scope: "project" | "user";
  source: "zcode" | "agents";
  priority: number;
}

function projectSkillRoot(workspacePath: string): AgentSkillRoot {
  return {
    path: join(workspacePath, ".zcode", "skills"),
    scope: "project",
    source: "zcode",
    priority: 10,
  };
}

/** 从当前 CLI config 构造 agent 侧 adapter（真实文件 → schema 解析 → disabledPaths）。 */
async function adapterFromCliConfig() {
  const raw = JSON.parse(await readFile(cliConfigPath, "utf8")) as unknown;
  const { config } = parseConfigFileToRuntimePatchWithDiagnostics(raw);
  return {
    skillOverrides: config.skillOverrides,
    adapter: createNodeSkillAdapter({ disabledPaths: collectDisabledPaths(config.skillOverrides) }),
  };
}

test("A1/A4.1：默认全开，关闭仅落禁用态单条；设置页列表不剔除（A1.5）", async () => {
  await resetCliConfig();
  const workspacePath = await createWorkspaceWithSkills(["alpha", "beta", "gamma"]);
  const pathByName = new Map(
    (await service.list({ workspacePath })).skills.map((skill) => [skill.name, skill.path]),
  );

  // 全新 config：无 skills 段，所有技能默认开。
  const initial = await service.list({ workspacePath });
  assert.equal(initial.skills.length, 3);
  assert.ok(initial.skills.every((skill) => skill.enabled));
  assert.equal("skills" in (await readCliConfigJson()), false);

  // 关闭 alpha：config 只出现一条 realpath 形态 key 的 enable:false。
  const alpha = initial.skills.find((skill) => skill.name === "alpha");
  assert.ok(alpha);
  await service.setEnabled({ workspacePath, skillId: alpha.id, enabled: false });
  const alphaKey = await realSkillKey(pathByName.get("alpha") ?? "");
  const afterDisable = await readCliConfigJson();
  assert.deepEqual(afterDisable.skills, { [alphaKey]: { enable: false } });

  // §2.4 双路径语义：设置页发现不做禁用剔除，alpha 仍在列表且 Switch 投影为关。
  const projected = await service.list({ workspacePath });
  assert.equal(projected.skills.length, 3);
  const projectedAlpha = projected.skills.find((skill) => skill.name === "alpha");
  assert.ok(projectedAlpha);
  assert.equal(projectedAlpha.enabled, false);
  assert.ok(
    projected.skills.filter((skill) => skill.name !== "alpha").every((skill) => skill.enabled),
  );
});

test("A1.4/A4.2/A4.3：重新开启删条目、清空后删整段、手工 true 条目被归一清除", async () => {
  await resetCliConfig();
  const workspacePath = await createWorkspaceWithSkills(["alpha", "beta", "gamma"]);
  const listed = await service.list({ workspacePath });
  const idByName = new Map(listed.skills.map((skill) => [skill.name, skill.id]));
  const keyByName = new Map(
    await Promise.all(
      listed.skills.map(async (skill) => [skill.name, await realSkillKey(skill.path)] as const),
    ),
  );

  // 关闭两个再全部打开：skills 段整体消失（不是空对象、不是 enable:true 条目）。
  await service.setEnabled({ workspacePath, skillId: idByName.get("alpha") ?? "", enabled: false });
  await service.setEnabled({ workspacePath, skillId: idByName.get("beta") ?? "", enabled: false });
  await service.setEnabled({ workspacePath, skillId: idByName.get("alpha") ?? "", enabled: true });
  await service.setEnabled({ workspacePath, skillId: idByName.get("beta") ?? "", enabled: true });
  const reopened = await readCliConfigJson();
  assert.equal("skills" in reopened, false);

  // 手工写入 enable:true 条目：读取侧视为开；下一次任意开关写入时被归一清除。
  await writeCliConfigJson({
    skills: {
      [keyByName.get("alpha") ?? ""]: { enable: true },
      [keyByName.get("beta") ?? ""]: { enable: false },
    },
  });
  const handWritten = await service.list({ workspacePath });
  assert.equal(handWritten.skills.find((skill) => skill.name === "alpha")?.enabled, true);
  assert.equal(handWritten.skills.find((skill) => skill.name === "beta")?.enabled, false);
  await service.setEnabled({ workspacePath, skillId: idByName.get("gamma") ?? "", enabled: false });
  const normalized = await readCliConfigJson();
  assert.deepEqual(normalized.skills, {
    [keyByName.get("beta") ?? ""]: { enable: false },
    [keyByName.get("gamma") ?? ""]: { enable: false },
  });
});

test("A1.3 链路：落盘 config → schema 解析 → disabledPaths → agent 发现期剔除", async () => {
  await resetCliConfig();
  const workspacePath = await createWorkspaceWithSkills(["alpha", "beta"]);
  const roots = [projectSkillRoot(workspacePath)];
  const listed = await service.list({ workspacePath });
  const alpha = listed.skills.find((skill) => skill.name === "alpha");
  assert.ok(alpha);
  await service.setEnabled({ workspacePath, skillId: alpha.id, enabled: false });

  const { skillOverrides, adapter } = await adapterFromCliConfig();
  const alphaKey = await realSkillKey(alpha.path);
  assert.deepEqual(skillOverrides, { [alphaKey]: { enable: false } });

  // 发现期剔除：alpha 不进发现结果，beta 正常。
  const outcome = await adapter.discoverSkills({ workingDirectory: workspacePath, roots });
  assert.deepEqual(
    outcome.skills.map((skill) => skill.name),
    ["beta"],
  );

  // loadSkill 复用发现结果：按名加载被禁用技能直接 not found（§2.4 失效即达）。
  await assert.rejects(
    adapter.loadSkill({ name: "alpha", workingDirectory: workspacePath, roots }),
    /Skill not found: alpha/,
  );
  const loaded = await adapter.loadSkill({ name: "beta", workingDirectory: workspacePath, roots });
  assert.equal(loaded.content, "body of beta");
});

test("A4.4/schema：复数段相对路径 key 静默忽略；复数段优先于单数 legacy 段", async () => {
  await resetCliConfig();
  const workspacePath = await createWorkspaceWithSkills(["alpha"]);

  // 相对路径 key：CLI 解析侧忽略（不进 skillOverrides），desktop 列表同样视为开。
  await writeCliConfigJson({ skills: { "skills/rel/SKILL.md": { enable: false } } });
  const relativeParsed = parseConfigFileToRuntimePatchWithDiagnostics(
    await readCliConfigJson(),
  ).config;
  assert.equal(relativeParsed.skillOverrides, undefined);
  const relativeListed = await service.list({ workspacePath });
  assert.ok(relativeListed.skills.every((skill) => skill.enabled));

  // 同键冲突：复数段覆盖单数 legacy 段（schema.ts merge 顺序，后参覆盖前参）。
  const absoluteKey = "/abs/path/legacy/SKILL.md";
  const pluralWins = parseConfigFileToRuntimePatchWithDiagnostics({
    skill: { [absoluteKey]: { enable: false } },
    skills: { [absoluteKey]: { enable: true } },
  }).config;
  assert.deepEqual(pluralWins.skillOverrides, { [absoluteKey]: { enable: true } });
  assert.deepEqual(collectDisabledPaths(pluralWins.skillOverrides), []);

  // 单数 legacy 段单独存在时仍被解析并进入 disabledPaths。
  const legacyOnly = parseConfigFileToRuntimePatchWithDiagnostics({
    skill: { [absoluteKey]: { enable: false } },
  }).config;
  assert.deepEqual(collectDisabledPaths(legacyOnly.skillOverrides), [absoluteKey]);
});

test("A3：symlink 双路径——UI 落 realpath 目标，agent 从链接路径扫描仍被剔除；反向闭包", async () => {
  await resetCliConfig();
  // 用户级技能根（HOME 已隔离）：~/.openzwork/skills/foo -> 仓外目标目录软链。
  const userSkillsRoot = join(isolatedHome, ".openzwork", "skills");
  const targetSkillMd = await writeSkillFixture(join(isolatedHome, "somewhere", "foo"), "foo");
  await mkdir(userSkillsRoot, { recursive: true });
  await symlink(dirname(targetSkillMd), join(userSkillsRoot, "foo"));

  const workspacePath = await mkdtemp(join(fixtureRoot, "ws-"));
  const listed = await service.list({ workspacePath });
  const foo = listed.skills.find((skill) => skill.name === "foo");
  assert.ok(foo);
  // SkillSummary.path 是 realpath 目标形态（spec §2.6）。
  assert.equal(foo.path, await realpath(targetSkillMd));

  await service.setEnabled({ workspacePath, skillId: foo.id, enabled: false });
  const config = await readCliConfigJson();
  assert.deepEqual(config.skills, { [await realpath(targetSkillMd)]: { enable: false } });

  // agent 侧从链接路径根扫描：构造期 realpath 展开 + 比对期双比对命中目标路径。
  const roots = [
    { path: userSkillsRoot, scope: "user" as const, source: "zcode" as const, priority: 10 },
  ];
  const forward = await adapterFromCliConfig();
  const forwardOutcome = await forward.adapter.discoverSkills({
    workingDirectory: workspacePath,
    roots,
  });
  assert.deepEqual(
    forwardOutcome.skills.map((skill) => skill.name),
    [],
  );

  // 反向：config 改写成链接路径形态 key，同样命中（resolve 形态直接比对）。
  const linkFormKey = join(userSkillsRoot, "foo", "SKILL.md");
  await writeCliConfigJson({ skills: { [linkFormKey]: { enable: false } } });
  const reverse = await adapterFromCliConfig();
  const reverseOutcome = await reverse.adapter.discoverSkills({
    workingDirectory: workspacePath,
    roots,
  });
  assert.deepEqual(
    reverseOutcome.skills.map((skill) => skill.name),
    [],
  );

  // A3.4：悬空链接 + 不存在的禁用路径——构造与发现均不抛错（realpath 失败回退 resolve）。
  // 悬空链接本身扫描不到、不贡献技能；未被禁用的 foo 照常可发现（无副作用）。
  await symlink(join(isolatedHome, "not-exist-target"), join(userSkillsRoot, "dangling"));
  const dangling = createNodeSkillAdapter({
    disabledPaths: [join(isolatedHome, "gone", "SKILL.md")],
  });
  const danglingOutcome = await dangling.discoverSkills({ workingDirectory: workspacePath, roots });
  assert.deepEqual(
    danglingOutcome.skills.map((skill) => skill.name),
    ["foo"],
  );
});

test("A5：并发开关经写队列串行化，最终落盘与语义一致且文件合法", async () => {
  await resetCliConfig();
  const workspacePath = await createWorkspaceWithSkills(["alpha", "beta", "gamma"]);
  const listed = await service.list({ workspacePath });
  const idByName = new Map(listed.skills.map((skill) => [skill.name, skill.id]));
  const keyByName = new Map(
    await Promise.all(
      listed.skills.map(async (skill) => [skill.name, await realpath(skill.path)] as const),
    ),
  );

  // 连续快速切换 3 个不同技能，不做 await 间隔：writeQueue 串行保证无交错半写。
  await Promise.all([
    service.setEnabled({ workspacePath, skillId: idByName.get("alpha") ?? "", enabled: false }),
    service.setEnabled({ workspacePath, skillId: idByName.get("beta") ?? "", enabled: false }),
    service.setEnabled({ workspacePath, skillId: idByName.get("gamma") ?? "", enabled: true }),
  ]);

  const final = await readCliConfigJson();
  assert.deepEqual(final.skills, {
    [keyByName.get("alpha") ?? ""]: { enable: false },
    [keyByName.get("beta") ?? ""]: { enable: false },
  });
});

test("A6：技能改名后旧 skillId 失配抛错；孤儿条目不清理也不影响新路径", async () => {
  await resetCliConfig();
  const workspacePath = await createWorkspaceWithSkills(["alpha"]);
  const listed = await service.list({ workspacePath });
  const alpha = listed.skills.find((skill) => skill.name === "alpha");
  assert.ok(alpha);
  const staleSkillId = alpha.id;
  const staleKey = await realSkillKey(alpha.path);

  await service.setEnabled({ workspacePath, skillId: staleSkillId, enabled: false });

  // 目录改名后，旧 skillId 失配（path 变化 → id 的 pathHash 段变化）。
  await rename(dirname(alpha.path), join(workspacePath, ".zcode", "skills", "alpha-moved"));

  await assert.rejects(
    service.setEnabled({ workspacePath, skillId: staleSkillId, enabled: true }),
    (error: unknown) => error instanceof Error && error.message.includes(staleSkillId),
  );

  // 重新发现：同名技能按新路径出现且默认开（孤儿条目按路径匹配、不命中新路径）。
  const reListed = await service.list({ workspacePath });
  const moved = reListed.skills.find((skill) => skill.name === "alpha");
  assert.ok(moved);
  assert.notEqual(moved.path, staleKey);
  assert.equal(moved.enabled, true);

  // D-E1c-3：孤儿 enable:false 条目保留在 config（不清理），无行为危害。
  const config = await readCliConfigJson();
  assert.deepEqual(config.skills, { [staleKey]: { enable: false } });
});
