// OW-P024 回归：工作流查询 lane 的进程数量、生命周期与内容归属。
// spec：docs/specs/saved-workflow-query-lifecycle-openzwork.md。
//
// 场景全部使用真实 createZCodeAgentService + 真实 CLI 子进程 + 隔离数据目录
// （setDataBaseDir + 绝对 ZCODE_SESSION_DB_PATH + 子进程 HOME 指向夹具根），
// processLifecycleReporter 只做观测，不 mock ProcessManager/getClient；
// 纯 schema / 资格策略断言单独成组并标注其证明范围。
//
// 运行前置：`node scripts/build-desktop-agent-cli.mjs` 已构建 CLI（默认 resolver
// 沿 findUpward 命中 apps/zcode-cli/packages/cli/dist/zcode.cjs，与产品同一读取链）。
// 性能与默认 idle 采样用环境变量开启，见文末两个 env 门控用例。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentLaneResourceSampleSchema } from "@zcode/shared";
import { setDataBaseDir } from "../src/paths.js";
import { createZCodeAgentService } from "../src/zcode-agent/zcodeAgentService.js";
import {
  resolveShareLocalWorkflowQueryRuntime,
  WORKFLOW_QUERY_LANE_IDLE_TIMEOUT_MS,
} from "../src/zcode-agent/workflow-query/contract.js";
import type { RuntimeProcessLifecycleReporter } from "../src/process/runtimeProcessLifecycle.js";

const execFileAsync = promisify(execFile);

/** 性能样本的工程规格（spec A11）：50 项目、5 轮冷加载。 */
const PERF_DEFAULT_PROJECTS = 50;
const PERF_DEFAULT_ROUNDS = 5;
/** 共享场景的项目数（CI 里也保持 50：单进程下 RPC 量不是瓶颈）。 */
const SCENARIO_PROJECTS = 50;
/** 非共享 / 交错场景用小样本：证明按 key 隔离即可，不重放启动风暴。 */
const ISOLATION_PROJECTS = 3;

function workflowFile(projectIndex: number, workflowIndex: number): string {
  return [
    "/* zcode-workflow",
    `description: 项目 ${projectIndex} 的 ${workflowIndex} 号工作流`,
    "*/",
    "export default async ({ agent }) => {",
    `  await agent("项目 ${projectIndex} 的 ${workflowIndex} 号脚本");`,
    "};",
    "",
  ].join("\n");
}

/** 损坏文件：frontmatter 缺失，应出现在 invalid 列表而不是抛错。 */
const BROKEN_WORKFLOW = "这不是一个合法的保存工作流\n";

interface FixtureProject {
  dir: string;
  workspacePath: string;
  workflowNames: string[];
}

/**
 * 固定 50 项目夹具：proj-00..proj-49，绝大多数有 2 个工作流；含空项目、
 * 损坏文件项目与跨项目同名工作流（same-name 在两个项目里 description 不同）。
 */
async function buildProjectFixture(root: string, count: number): Promise<FixtureProject[]> {
  const projects: FixtureProject[] = [];
  for (let index = 0; index < count; index += 1) {
    const dir = join(root, `proj-${String(index).padStart(2, "0")}`);
    const workflowsDir = join(dir, ".zcode", "workflows");
    await mkdir(workflowsDir, { recursive: true });
    const names: string[] = [];
    // proj-07：空项目（目录在、无工作流）。
    if (index === 7) {
      projects.push({ dir, workspacePath: dir, workflowNames: names });
      continue;
    }
    for (const workflowIndex of [1, 2]) {
      const name = `flow-${workflowIndex}`;
      await writeFile(join(workflowsDir, `${name}.dwf.ts`), workflowFile(index, workflowIndex));
      names.push(name);
    }
    // proj-11：含一个损坏文件（合法工作流照常列出，坏文件进 invalid）。
    if (index === 11) {
      await writeFile(join(workflowsDir, "broken.dwf.ts"), BROKEN_WORKFLOW);
    }
    // proj-19 / proj-20：跨项目同名工作流，description 不同。
    if (index === 19 || index === 20) {
      await writeFile(
        join(workflowsDir, "same-name.dwf.ts"),
        [
          "/* zcode-workflow",
          `description: 同名工作流，属于项目 ${index}`,
          "*/",
          "export default async ({ agent }) => {};\n",
        ].join("\n"),
      );
      names.push("same-name");
    }
    projects.push({ dir, workspacePath: dir, workflowNames: names });
  }
  return projects;
}

interface SpawnRecord {
  pid: number;
  lane?: string;
  workspacePath: string;
  startedAt: number;
}
interface ReadyRecord {
  pid: number;
  lane?: string;
  startupDurationMs: number;
  readyAt: number;
}
interface ExitRecord {
  pid: number;
  lane?: string;
  endedAt: number;
  terminationReason?: string;
  exitCode: number | null;
  signal: string | null;
}

function createRecorder(): {
  reporter: RuntimeProcessLifecycleReporter;
  spawns: SpawnRecord[];
  readys: ReadyRecord[];
  exits: ExitRecord[];
  /** lane 为空 = chat 主泳道（manager 缺省不标记）。 */
  chatSpawns(): number;
  laneSpawns(lane: string): number;
} {
  const spawns: SpawnRecord[] = [];
  const readys: ReadyRecord[] = [];
  const exits: ExitRecord[] = [];
  const reporter: RuntimeProcessLifecycleReporter = {
    onSpawn(event) {
      spawns.push({
        pid: event.pid,
        lane: event.lane,
        workspacePath: event.workspacePath,
        startedAt: event.startedAt,
      });
    },
    onReady(event) {
      readys.push({
        pid: event.pid,
        lane: event.lane,
        startupDurationMs: event.startupDurationMs,
        readyAt: event.readyAt,
      });
    },
    onExit(event) {
      exits.push({
        pid: event.pid,
        lane: event.lane,
        endedAt: event.endedAt,
        terminationReason: event.terminationReason,
        exitCode: event.exitCode,
        signal: event.signal,
      });
      if (event.stderrTail?.length) {
        process.stderr.write(
          `[workflow-query-test] pid=${event.pid} lane=${event.lane ?? "chat"} stderr: ${event.stderrTail.join(" | ")}\n`,
        );
      }
    },
  };
  return {
    reporter,
    spawns,
    readys,
    exits,
    chatSpawns: () => spawns.filter((event) => !event.lane || event.lane === "chat").length,
    laneSpawns: (lane) => spawns.filter((event) => event.lane === lane).length,
  };
}

async function isPidAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 采样一棵进程树的总 RSS（KB）：ps 全量 + 按 ppid 递归归并后代。 */
async function sampleProcessTreeRssKb(rootPids: number[]): Promise<number> {
  if (rootPids.length === 0) return 0;
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid=,rss="], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const rows = stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 3 && parts.every((part) => /^\d+$/.test(part)))
    .map((parts) => ({ pid: Number(parts[0]), ppid: Number(parts[1]), rssKb: Number(parts[2]) }));
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const children = new Map<number, number[]>();
  for (const row of rows) {
    const list = children.get(row.ppid) ?? [];
    list.push(row.pid);
    children.set(row.ppid, list);
  }
  let total = 0;
  const stack = [...rootPids];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const row = byPid.get(pid);
    if (row) total += row.rssKb;
    for (const child of children.get(pid) ?? []) stack.push(child);
  }
  return total;
}

async function listTreePids(rootPids: number[]): Promise<number[]> {
  if (rootPids.length === 0) return [];
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid="], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const rows = stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 2 && parts.every((part) => /^\d+$/.test(part)))
    .map((parts) => ({ pid: Number(parts[0]), ppid: Number(parts[1]) }));
  const children = new Map<number, number[]>();
  for (const row of rows) {
    const list = children.get(row.ppid) ?? [];
    list.push(row.pid);
    children.set(row.ppid, list);
  }
  const seen = new Set<number>();
  const stack = [...rootPids];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const child of children.get(pid) ?? []) stack.push(child);
  }
  return [...seen];
}

describe("工作流查询 lane（OW-P024）", () => {
  let root: string;
  let sessionDbPath: string;
  let projects: FixtureProject[];
  let activeDisposers: Array<() => Promise<void>>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "workflow-query-lane-"));
    sessionDbPath = join(root, "cli", "db", "db.sqlite");
    await mkdir(join(root, "cli", "db"), { recursive: true });
    setDataBaseDir(root);
    // Main 固定 DB 条件：绝对 ZCODE_SESSION_DB_PATH 优先于任何用户/项目配置（Env 40）。
    process.env.ZCODE_SESSION_DB_PATH = sessionDbPath;
    activeDisposers = [];
  });

  afterEach(async () => {
    for (const dispose of activeDisposers.reverse()) {
      await dispose().catch(() => undefined);
    }
    setDataBaseDir(null);
    delete process.env.ZCODE_SESSION_DB_PATH;
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  function createScenarioService(
    options: {
      share?: boolean;
      workflowQueryIdleTimeoutMs?: number;
      spawnFallbackCwd?: string;
      commandResolver?: import("../src/zcode-agent/zcodeAgentProcessManager.js").ZCodeAgentCommandResolver;
    } = {},
    recorder = createRecorder(),
  ) {
    // CLI 启动需要内置 provider 模板：复制仓库 tracked 夹具（纯模板、无凭据）到测试根，
    // 再按 Desktop Host 的 createNodeProviderRuntimePathEnv 同款 env 注入。
    const builtinProviderConfigPath = join(root, "zcode-builtin.json");
    const personalProviderConfigPath = join(root, "provider_config.json");
    const service = createZCodeAgentService({
      processLifecycleReporter: recorder.reporter,
      resolveSpawnEnv: async () => {
        await writeFile(
          builtinProviderConfigPath,
          await readFile(join(process.cwd(), "config", "provider", "zcode-builtin.json"), "utf-8"),
        );
        await writeFile(personalProviderConfigPath, "{}");
        return {
          // CLI 子进程的 HOME 指向夹具根：全局档根目录与用户配置读取都不落真实家目录。
          HOME: root,
          USERPROFILE: root,
          ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtinProviderConfigPath,
          ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: personalProviderConfigPath,
        };
      },
      ...(options.share === undefined ? {} : { shareLocalWorkflowQueryRuntime: options.share }),
      ...(options.workflowQueryIdleTimeoutMs === undefined
        ? {}
        : { workflowQueryIdleTimeoutMs: options.workflowQueryIdleTimeoutMs }),
      ...(options.spawnFallbackCwd === undefined
        ? {}
        : { spawnFallbackCwd: options.spawnFallbackCwd }),
      ...(options.commandResolver === undefined
        ? {}
        : { commandResolver: options.commandResolver }),
    });
    activeDisposers.push(() => Promise.resolve(service.disposeAllAndWait()));
    return { service, recorder };
  }

  it(
    "A01 共享开关下 50 项目两项读取只 spawn 1 个 workflow-query CLI，chat spawn=0，内容按项目归属",
    { timeout: 120_000 },
    async () => {
      projects = await buildProjectFixture(root, SCENARIO_PROJECTS);
      const { service, recorder } = createScenarioService({ share: true });

      // 模拟总览挂载：每个项目组两项读取并发（列表 + 运行历史）。
      const results = await Promise.all(
        projects.map(async (project) => {
          const target = { workspacePath: project.workspacePath };
          const [list, runs] = await Promise.all([
            service.listSavedWorkflows(target),
            service.listSavedWorkflowRuns({ ...target, limit: 50 }),
          ]);
          return { project, list, runs };
        }),
      );
      const completedAt = Date.now();
      expect(completedAt).toBeGreaterThan(0);

      // 内容归属：每个请求都读到本项目的真实文件（target 不因载体共用而漂移）。
      for (const { project, list, runs } of results) {
        const names = [...list.workflows].map((entry) => entry.name).sort();
        expect(names).toEqual([...project.workflowNames].sort());
        const index = projects.indexOf(project);
        if (index !== 7) {
          for (const entry of list.workflows) {
            expect(entry.description).toContain(`项目 ${index}`);
          }
        }
        expect(list.dir).toBe(join(project.workspacePath, ".zcode", "workflows"));
        expect(Array.isArray(runs.runs)).toBe(true);
      }
      // 空项目（proj-07）没有合法条目也没有坏文件；坏文件项目（proj-11）只影响自己。
      expect(results[7]!.list.workflows).toHaveLength(0);
      expect(results[7]!.list.invalid).toHaveLength(0);
      expect(results[11]!.list.invalid.map((entry) => entry.path)).toEqual([
        join(projects[11]!.workspacePath, ".zcode", "workflows", "broken.dwf.ts"),
      ]);
      // 同名工作流跨项目：各自列出的 description 不同。
      expect(
        results[19]!.list.workflows.find((entry) => entry.name === "same-name")!.description,
      ).toContain("属于项目 19");
      expect(
        results[20]!.list.workflows.find((entry) => entry.name === "same-name")!.description,
      ).toContain("属于项目 20");

      // 进程数量（OW-P024 的核心断言）：单 key 单实例（getClient 多次调用不新建进程），
      // 查询不再按项目登记 chat runtime。
      expect(recorder.laneSpawns("workflow-query")).toBe(1);
      expect(recorder.chatSpawns()).toBe(0);
    },
  );

  it("A02 非共享分支按项目分 key，短 idle 后整树退出，重进再起", { timeout: 120_000 }, async () => {
    projects = await buildProjectFixture(root, ISOLATION_PROJECTS);
    const { service, recorder } = createScenarioService({
      share: false,
      workflowQueryIdleTimeoutMs: 300,
    });

    await Promise.all(
      projects.map(async (project) => {
        const target = { workspacePath: project.workspacePath };
        const [list] = await Promise.all([
          service.listSavedWorkflows(target),
          service.listSavedWorkflowRuns({ ...target, limit: 50 }),
        ]);
        expect(list.workflows.length).toBe(project.workflowNames.length);
      }),
    );

    // Server/远端语义：启动峰值保留（每项目一个查询进程），但 lane 独立、空闲即收。
    expect(recorder.laneSpawns("workflow-query")).toBe(ISOLATION_PROJECTS);
    expect(recorder.chatSpawns()).toBe(0);
    const queryPids = recorder.spawns
      .filter((event) => event.lane === "workflow-query")
      .map((event) => event.pid);
    expect(new Set(queryPids).size).toBe(ISOLATION_PROJECTS);

    // idle 回收：等计时器到期 + 关闭屏障完成，进程树全部退出。
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const deadline = Date.now() + 15_000;
    while (recorder.exits.length < ISOLATION_PROJECTS && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(recorder.exits.filter((event) => event.lane === "workflow-query")).toHaveLength(
      ISOLATION_PROJECTS,
    );
    for (const pid of queryPids) {
      expect(await isPidAlive(pid)).toBe(false);
    }

    // 重进：同样的读再拉起一代（每 key 一个，不残留旧进程）。
    await service.listSavedWorkflows({ workspacePath: projects[0]!.workspacePath });
    expect(recorder.laneSpawns("workflow-query")).toBe(ISOLATION_PROJECTS + 1);
  });

  it(
    "A03 共享关闭（等价 custom command / 固定 DB 缺失分支）时结果与共享分支逐字一致",
    { timeout: 120_000 },
    async () => {
      projects = await buildProjectFixture(root, ISOLATION_PROJECTS);
      const shared = createScenarioService({ share: true });
      // Desktop 装配会传 zcodeAgentSpawnFallbackCwd（工作区目录被删时的 spawn cwd 兜底）；
      // 查询 lane 按同一选项转发（spec §3），数据归属仍由 RPC target 决定。
      const isolated = createScenarioService({ share: false, spawnFallbackCwd: root });

      const project = projects[0]!;
      const target = { workspacePath: project.workspacePath };
      // 串行读：两个 service 同时冷启同一个全新 SQLite 会触发并发初始化竞态（transport
      // 在 storage startup 中关闭），与本场景要证明的内容归属无关。
      const sharedList = await shared.service.listSavedWorkflows(target);
      const isolatedList = await isolated.service.listSavedWorkflows(target);
      expect(isolatedList.workflows.map((entry) => entry.description)).toEqual(
        sharedList.workflows.map((entry) => entry.description),
      );
      expect(isolatedList.dir).toBe(sharedList.dir);
      // 目录缺失的 workspace：读取成功、按空项目处理（spawnFallbackCwd 语义不改变数据归属）。
      const missing = join(root, "removed-project");
      const missingList = await isolated.service.listSavedWorkflows({ workspacePath: missing });
      expect(missingList.workflows).toHaveLength(0);
    },
  );

  it(
    "A04 scope、分页与错误归属：project 档按本项目，分页钳制在服务端不变",
    { timeout: 120_000 },
    async () => {
      projects = await buildProjectFixture(root, ISOLATION_PROJECTS);
      const { service } = createScenarioService({ share: true });
      const project = projects[0]!;
      const scoped = await service.listSavedWorkflows({
        workspacePath: project.workspacePath,
        scope: "project",
      });
      expect(scoped.workflows.map((entry) => entry.name).sort()).toEqual(
        [...project.workflowNames].sort(),
      );
      const runs = await service.listSavedWorkflowRuns({
        workspacePath: project.workspacePath,
        name: "flow-1",
        limit: 50,
      });
      expect(runs.runs).toHaveLength(0);
      // 全局组（无 workspace）：保持原全局载体选择，不为项目再 spawn；
      // 子进程 HOME 已指向夹具根，全局根为空目录。
      const globalList = await service.listSavedWorkflows({ scope: "global" });
      expect(globalList.workflows).toHaveLength(0);
      expect(globalList.dir).toBe(join(root, ".openzwork", "workflows"));
    },
  );

  it("A05 查询 lane 的 spawn 与 idle 回收不影响活动 chat 进程", { timeout: 120_000 }, async () => {
    projects = await buildProjectFixture(root, 1);
    const { service, recorder } = createScenarioService({
      share: true,
      workflowQueryIdleTimeoutMs: 300,
    });
    // 活动任务侧的代表：chat 主泳道 client（经 workflows/forRun 的只读直通路径拉起）。
    await service
      .findSavedWorkflowForRun({
        workspacePath: projects[0]!.workspacePath,
        runId: "run-under-test",
        candidates: [],
      })
      .catch(() => undefined);
    const chatPid = recorder.spawns.find((event) => !event.lane || event.lane === "chat")?.pid;
    expect(chatPid).toBeDefined();

    await service.listSavedWorkflows({ workspacePath: projects[0]!.workspacePath });
    expect(recorder.laneSpawns("workflow-query")).toBe(1);

    // 查询进程 idle 退出后，chat 进程仍存活（新 lane 不借用/不销毁活动 chat）。
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const deadline = Date.now() + 15_000;
    while (
      recorder.exits.filter((event) => event.lane === "workflow-query").length < 1 &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(recorder.exits.some((event) => event.lane === "workflow-query")).toBe(true);
    expect(await isPidAlive(chatPid!)).toBe(true);
  });

  it(
    "A06 并发启动与跨 idle 边界的读取交错：请求全部成功，disposeAndWait 收口整树",
    { timeout: 120_000 },
    async () => {
      projects = await buildProjectFixture(root, SCENARIO_PROJECTS);
      const { service, recorder } = createScenarioService({
        share: true,
        workflowQueryIdleTimeoutMs: 400,
      });
      // 100 个 RPC 与单 key 启动并发：single-flight 启动期间到达的请求全部复用同一实例。
      const first = await Promise.all(
        projects.flatMap((project) => [
          service.listSavedWorkflows({ workspacePath: project.workspacePath }),
          service.listSavedWorkflowRuns({ workspacePath: project.workspacePath, limit: 50 }),
        ]),
      );
      expect(first).toHaveLength(SCENARIO_PROJECTS * 2);
      expect(recorder.laneSpawns("workflow-query")).toBe(1);

      // 读取跨 idle 边界：持续请求期间到期不回收，请求归零后回收。
      for (let round = 0; round < 4; round += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const again = await service.listSavedWorkflows({
          workspacePath: projects[round % projects.length]!.workspacePath,
        });
        expect(again.workflows.length).toBeGreaterThan(0);
      }
      expect(recorder.laneSpawns("workflow-query")).toBe(1);

      // Host teardown：进程仍在服务请求时先快照整棵树，再等 idle 到期并 disposeAllAndWait。
      const queryPid = recorder.spawns.find((event) => event.lane === "workflow-query")?.pid;
      expect(queryPid).toBeDefined();
      const treeBeforeDispose = await listTreePids([queryPid!]);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await service.disposeAllAndWait();
      const deadline = Date.now() + 15_000;
      while (
        (await Promise.all(treeBeforeDispose.map((pid) => isPidAlive(pid)))).some(Boolean) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      for (const pid of treeBeforeDispose) {
        expect(await isPidAlive(pid)).toBe(false);
      }
    },
  );

  // 证明范围：仅 schema 解析（资源样本兼容），不含进程行为。
  it("A08 新旧 lane 资源样本解析：workflow-query 归 cli_aux，旧样本无 lane 仍可接收", () => {
    const baseSample = {
      platform: "darwin",
      arch: "arm64",
      logicalCpuCount: 10,
      intervalMs: 60_000,
      cpuCores: 1.75,
      cpuPercent: 1.5,
      rssKb: 102_400,
    };
    expect(
      agentLaneResourceSampleSchema.parse({ ...baseSample, lane: "workflow-query" }),
    ).toBeTruthy();
    expect(agentLaneResourceSampleSchema.parse({ ...baseSample, lane: "chat" })).toBeTruthy();
    expect(agentLaneResourceSampleSchema.parse({ ...baseSample, lane: "mcp-status" })).toBeTruthy();
    // 旧远端样本：不带 lane（版本落后），仍可接收。
    expect(agentLaneResourceSampleSchema.parse(baseSample)).toBeTruthy();
    // CLI 自报 lane 仍被拒（lane 只能由 Host 侧打标）。
    expect(() =>
      agentLaneResourceSampleSchema.parse({ ...baseSample, lane: "not-a-lane" }),
    ).toThrow();
  });

  // 证明范围：共享资格策略（Host 装配纯函数），不含进程行为。
  it("共享资格：本地 Desktop + 默认命令链 + Main 固定绝对 DB 才开启", () => {
    const ok = {
      runtimeSurface: "desktop_local_host" as const,
      hasCustomCommandResolver: false,
      agentServerCommandEnv: undefined,
      sessionDbPathEnv: "/Users/demo/Library/Application Support/OpenZWork/cli/db/db.sqlite",
    };
    expect(resolveShareLocalWorkflowQueryRuntime(ok)).toBe(true);
    // 远端 Host / desktop-attached remote：false。
    expect(
      resolveShareLocalWorkflowQueryRuntime({ ...ok, runtimeSurface: "remote_workspace_host" }),
    ).toBe(false);
    // 自定义 command resolver / ZCODE_AGENT_SERVER_COMMAND：false。
    expect(resolveShareLocalWorkflowQueryRuntime({ ...ok, hasCustomCommandResolver: true })).toBe(
      false,
    );
    expect(
      resolveShareLocalWorkflowQueryRuntime({ ...ok, agentServerCommandEnv: "/custom/agent" }),
    ).toBe(false);
    // DB 未固定 / 相对路径 / 旧别名不认：false。
    expect(resolveShareLocalWorkflowQueryRuntime({ ...ok, sessionDbPathEnv: undefined })).toBe(
      false,
    );
    expect(
      resolveShareLocalWorkflowQueryRuntime({ ...ok, sessionDbPathEnv: "cli/db.sqlite" }),
    ).toBe(false);
    // 默认常量与 mcp-status 同源：5 分钟。
    expect(WORKFLOW_QUERY_LANE_IDLE_TIMEOUT_MS).toBe(5 * 60_000);
  });

  // 证明范围：资格默认关闭——服务侧不开启时（等价 Server/远端装配），行为走非共享分支。
  it("默认不共享：不传开关时按项目隔离（与 A02 同语义）", { timeout: 120_000 }, async () => {
    projects = await buildProjectFixture(root, ISOLATION_PROJECTS);
    const { service, recorder } = createScenarioService({ workflowQueryIdleTimeoutMs: 300 });
    await Promise.all(
      projects.map((project) =>
        service.listSavedWorkflows({ workspacePath: project.workspacePath }),
      ),
    );
    expect(recorder.laneSpawns("workflow-query")).toBe(ISOLATION_PROJECTS);
    expect(recorder.chatSpawns()).toBe(0);
  });

  // P2 起生效：默认 5 分钟 idle 的一次性实测证据（CI 不跑）。
  // 运行：ZCODE_WORKFLOW_QUERY_DEFAULT_IDLE=1 mise exec -- pnpm exec vitest run
  //   --config vitest.core.config.ts packages/services/test/workflowQueryRuntime.test.ts
  //   -t "默认 5 分钟 idle"
  it.skipIf(process.env.ZCODE_WORKFLOW_QUERY_DEFAULT_IDLE !== "1")(
    "默认 5 分钟 idle：最后一项读取完成后整树退出（实测证据）",
    { timeout: 8 * 60_000 },
    async () => {
      projects = await buildProjectFixture(root, ISOLATION_PROJECTS);
      const { service, recorder } = createScenarioService({ share: true });
      const readsStartedAt = Date.now();
      await Promise.all(
        projects.map((project) =>
          service.listSavedWorkflows({ workspacePath: project.workspacePath }),
        ),
      );
      const queryPid = recorder.spawns.find((event) => event.lane === "workflow-query")?.pid;
      expect(queryPid).toBeDefined();
      // 等待真实 5 分钟 idle + 关闭屏障；记录实际完成时刻与整树状态。
      const deadline = Date.now() + WORKFLOW_QUERY_LANE_IDLE_TIMEOUT_MS + 120_000;
      while (!((await isPidAlive(queryPid!)) === false) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      const exitedAt = Date.now();
      const exitEvent = recorder.exits.find((event) => event.pid === queryPid);
      const evidence = {
        readsStartedAt,
        idleTimeoutMs: WORKFLOW_QUERY_LANE_IDLE_TIMEOUT_MS,
        exitedAt,
        elapsedMs: exitedAt - readsStartedAt,
        exitCode: exitEvent?.exitCode ?? null,
        terminationReason: exitEvent?.terminationReason ?? null,
        treePidsAtExit: await listTreePids([queryPid!]),
      };
      // evidence JSON 由运行者收集（evidence/p2-idle-default.json），这里只断言事实。
      expect(await isPidAlive(queryPid!)).toBe(false);
      expect(evidence.terminationReason).toBe("idle-timeout");
      process.stdout.write(`\n[workflow-query-default-idle] ${JSON.stringify(evidence)}\n`);
    },
  );

  // A11 性能采样（CI 不跑）：同夹具冷加载多轮，输出原始值与中位数。
  // 运行：ZCODE_WORKFLOW_QUERY_PERF=1 [ZCODE_WORKFLOW_QUERY_PERF_SHARE=0|1]
  //   ZCODE_WORKFLOW_QUERY_PERF_OUT=<json 路径> mise exec -- pnpm exec vitest run
  //   --config vitest.core.config.ts packages/services/test/workflowQueryRuntime.test.ts
  //   -t "冷加载性能采样"
  describe.skipIf(process.env.ZCODE_WORKFLOW_QUERY_PERF !== "1")("冷加载性能采样", () => {
    it(
      "同夹具多轮冷加载：记录项目组/总览时延、spawn 与进程树内存",
      { timeout: 20 * 60_000 },
      async () => {
        const share = process.env.ZCODE_WORKFLOW_QUERY_PERF_SHARE !== "0";
        const projectCount = Number(
          process.env.ZCODE_WORKFLOW_QUERY_PERF_PROJECTS ?? PERF_DEFAULT_PROJECTS,
        );
        const rounds = Number(process.env.ZCODE_WORKFLOW_QUERY_PERF_ROUNDS ?? PERF_DEFAULT_ROUNDS);
        projects = await buildProjectFixture(root, projectCount);

        const roundsData: unknown[] = [];
        for (let round = 1; round <= rounds; round += 1) {
          const { service, recorder } = createScenarioService({ share });
          // 冷加载：项目组全部两项读取完成。
          const projectGroupsStartedAt = Date.now();
          const reads = await Promise.all(
            projects.map(async (project) => {
              const target = { workspacePath: project.workspacePath };
              const [list, runs] = await Promise.all([
                service.listSavedWorkflows(target),
                service.listSavedWorkflowRuns({ ...target, limit: 50 }),
              ]);
              return { list, runs };
            }),
          );
          const projectGroupsCompletedAt = Date.now();
          // 完整总览：项目组 + 全局组（原全局载体路径）。
          const overviewStartedAt = Date.now();
          const globalList = await service.listSavedWorkflows({ scope: "global" });
          const overviewCompletedAt = Date.now();
          const queryPids = recorder.spawns
            .filter((event) => event.lane === "workflow-query")
            .map((event) => event.pid);
          const chatPids = recorder.spawns
            .filter((event) => event.lane === undefined || event.lane === "chat")
            .map((event) => event.pid);
          const sampleAt = Date.now();
          const treeRssKb = await sampleProcessTreeRssKb([...queryPids, ...chatPids]);
          roundsData.push({
            round,
            share,
            projectCount,
            projectGroupsMs: projectGroupsCompletedAt - projectGroupsStartedAt,
            overviewGlobalMs: overviewCompletedAt - overviewStartedAt,
            globalWorkflows: globalList.workflows.length,
            queryLaneSpawns: queryPids.length,
            chatLaneSpawns: chatPids.length,
            treeRssKb,
            sampleAt,
            startups: recorder.readys.map((ready) => ({
              pid: ready.pid,
              lane: ready.lane ?? "chat",
              startupDurationMs: ready.startupDurationMs,
            })),
            errors: reads.length !== projectCount ? ["read-count-mismatch"] : [],
          });
          await service.disposeAllAndWait();
          // 等整树退场再进入下一轮（冷加载口径：无存活进程）。
          const livePids = [...queryPids, ...chatPids];
          const deadline = Date.now() + 30_000;
          while (
            (await Promise.all(livePids.map((pid) => isPidAlive(pid)))).some(Boolean) &&
            Date.now() < deadline
          ) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }

        const projectGroups = roundsData.map(
          (round) => (round as { projectGroupsMs: number }).projectGroupsMs,
        );
        const overview = roundsData.map(
          (round) => (round as { overviewGlobalMs: number }).overviewGlobalMs,
        );
        const median = (values: number[]) =>
          [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
        const summary = {
          share,
          projectCount,
          roundsCount: rounds,
          projectGroupsMs: {
            raw: projectGroups,
            median: median(projectGroups),
            max: Math.max(...projectGroups),
          },
          overviewGlobalMs: { raw: overview, median: median(overview), max: Math.max(...overview) },
          rounds: roundsData,
        };
        process.stdout.write(`\n[workflow-query-perf] ${JSON.stringify(summary)}\n`);
        const out = process.env.ZCODE_WORKFLOW_QUERY_PERF_OUT;
        if (out) {
          const { writeFile: writeFileAsync } = await import("node:fs/promises");
          await writeFileAsync(out, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
        }
        // 工程判据：每轮都完成全部读取（性能值本身记录，不在断言里卡死）。
        for (const round of roundsData) {
          expect((round as { errors: string[] }).errors).toEqual([]);
        }
      },
    );
  });
});
