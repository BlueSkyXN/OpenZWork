// 受管 worktree 任务 WT04（验收矩阵）：同路径不同 identity、冷恢复、手机/远端查看。
// 归属不串（workspace 始终是项目主目录，worktree 只是 cwd）；手机 attachment 不放行
// managed-worktrees 通道（无创建入口）；查看只复用原 Host attachment，不派生新 Host/CLI。
// WT04-2 以 CLI 进程内会话生命周期计数器（generation）做同 runtime 关联证明：手机与
// 桌面 pane 读到同一非零计数 ⇔ 同一 CLI 进程服务两侧（详见用例内补证④注释）。
// 仅本地链路：桌面 Electron + 本机手机页（隔离凭据），不访问真实 SSH 或用户 worktree。
import { execFile } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser } from "playwright-core";
import {
  TID_TASK_ROW_WORKTREE_ICON,
  TID_WORKSPACE_PATH,
  TID_WORKTREE_TOGGLE,
} from "@zcode/shared/test-ids";
import { DEFAULT_WORKSPACE, clearAppData, waitForWorkspaceApp } from "#e2e/helpers/desktop-app";
import { E2E_REPLY_TOKEN } from "#e2e/helpers/conversation-session";
import { startDraftFromProject } from "#e2e/helpers/project-sidebar";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4TimelineContaining,
  waitForV4Pane,
} from "#e2e/helpers/v4-conversation";
import { reloadElectronSessionSafely } from "#e2e/helpers/e2e-electron-reload";
import { listSystemProcesses } from "#e2e/helpers/e2e-process-cleanup";
import { openMobilePairingPage } from "#e2e/helpers/mobile-pairing";
import { obtainUnreadPairingUrl } from "#e2e/helpers/web-remote-unread";
import { WEB_REMOTE_CONTROL_FIXTURE_CREDENTIALS } from "#e2e/helpers/web-remote-control-session-events-fixture";

const execGit = promisify(execFile);
const TEST_TIMEOUT_MS = 240_000;
// 与 git-managed-worktree.test.ts 同规则：受管根从 DEFAULT_WORKSPACE 父目录推导。
const MANAGED_ROOT = join(dirname(DEFAULT_WORKSPACE), ".openzwork", "worktrees");
const BASELINE_FILE = join(".zcode-e2e", "managed-worktree", "baseline.md");
// 回放响应沿用 git 领域 fixture（managed-worktree.json）的 E2E_MANAGED_WORKTREE 请求键；
// 时间戳保证唯一，不与其他 worktree 用例互串。
const CASE = "E2E_MANAGED_WORKTREE_WT04";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execGit("git", args, { cwd });
  return stdout.trim();
}

async function prepareSourceRepository(): Promise<void> {
  await mkdir(dirname(join(DEFAULT_WORKSPACE, BASELINE_FILE)), { recursive: true });
  await execGit("git", ["init", "-q", "-b", "main"], { cwd: DEFAULT_WORKSPACE });
  await git(DEFAULT_WORKSPACE, "config", "user.email", "zcode-e2e@example.invalid");
  await git(DEFAULT_WORKSPACE, "config", "user.name", "ZCode E2E");
  await writeFile(join(DEFAULT_WORKSPACE, BASELINE_FILE), "baseline\n", "utf8");
  await git(DEFAULT_WORKSPACE, "add", BASELINE_FILE);
  await git(DEFAULT_WORKSPACE, "commit", "-qm", "test: wt04 baseline");
}

function isUnderManagedRoot(path: string | null | undefined): path is string {
  if (!path) return false;
  const rel = relative(MANAGED_ROOT, path);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== "..";
}

async function listManagedWorktrees(): Promise<string[]> {
  const buckets = await readdir(MANAGED_ROOT, { withFileTypes: true }).catch(() => []);
  return buckets
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(MANAGED_ROOT, entry.name, basename(DEFAULT_WORKSPACE)));
}

async function waitForNewWorktree(known: readonly string[]): Promise<string> {
  let created: string | undefined;
  await browser.waitUntil(
    async () => {
      for (const path of await listManagedWorktrees()) {
        if (known.includes(path)) continue;
        const dotGit = await stat(join(path, ".git")).catch(() => null);
        if (dotGit?.isFile()) {
          created = path;
          return true;
        }
      }
      return false;
    },
    { timeout: 60_000, interval: 250, timeoutMsg: "受管根目录下没有出现新的 worktree" },
  );
  return created!;
}

/** 头部项目胶囊 `<仓库名> · <bucket>`；工作区路径仍是项目主目录（worktree 只是 cwd）。 */
async function waitForHeaderWorktree(worktreeRoot: string): Promise<void> {
  const bucket = basename(dirname(worktreeRoot));
  await browser.waitUntil(
    async () => {
      const badge = $(`[data-testid="${TID_WORKSPACE_PATH}"]`);
      if (!(await badge.isExisting())) return false;
      const path = await badge.getAttribute("data-workspace-abs-path");
      const label = (await badge.getAttribute("aria-label")) ?? "";
      return path === DEFAULT_WORKSPACE && label.includes(`· ${bucket}`);
    },
    { timeout: 30_000, interval: 250, timeoutMsg: `头部没有显示 worktree ${bucket}` },
  );
}

async function readDesktopWorkspacePaths(): Promise<string[]> {
  return browser.execute(() => {
    const state = (
      window as Window & {
        __zcodeTabStoreE2E?: { getState(): { tabs: Array<{ workspacePath?: string }> } };
      }
    ).__zcodeTabStoreE2E?.getState();
    if (!state) throw new Error("WT04 desktop tab store missing");
    return state.tabs.flatMap((tab) => (tab.workspacePath ? [tab.workspacePath] : []));
  });
}

async function readActiveWorkspaceIdentity(): Promise<string | null | undefined> {
  return browser.execute(() => {
    const state = (
      window as Window & {
        __zcodeTabStoreE2E?: {
          getState(): {
            activeWorkspacePath: string | null;
            activeWorkspaceIdentity?: string | null;
          };
        };
      }
    ).__zcodeTabStoreE2E?.getState();
    return state?.activeWorkspaceIdentity ?? null;
  });
}

/** Electron 主进程后代树里的 agent/Host 进程命令行快照（判断“查看不派生新 Host/CLI”）。 */
async function readAgentTreeSnapshot(): Promise<string[]> {
  const rootPid = await browser.electron.execute((electron) => process.pid);
  const processes = await listSystemProcesses();
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const inTree = new Set<number>([rootPid]);
  // 自底向上收敛后代集合（ppid 链）。
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of processes) {
      if (!inTree.has(p.pid) && inTree.has(p.ppid)) {
        inTree.add(p.pid);
        grew = true;
      }
    }
  }
  return processes
    .filter((p) => inTree.has(p.pid) && p.pid !== rootPid)
    .filter((p) => /zcode-(cli|host)|zcode-cli|zcode-host/u.test(p.command))
    .map((p) => `${p.pid}:${p.command.slice(0, 160)}`)
    .sort();
}

async function sendAndWaitCompleted(marker: string): Promise<void> {
  await sendV4Prompt(`${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`);
  await waitForV4TimelineContaining(marker);
  await waitForV4AssistantMessageContaining(E2E_REPLY_TOKEN, 90_000);
  await waitForV4Pane(
    (snapshot) =>
      !snapshot.canStop && Boolean(snapshot.sessionId) && snapshot.sessionId !== "draft",
    `${marker} 的 v4 会话没有完成`,
    90_000,
  );
}

describe("受管 worktree 任务 WT04：冷恢复归属与手机查看 manual-review E2E", () => {
  let webBrowser: Browser | undefined;

  before(async () => {
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    await prepareSourceRepository();
    await prepareV4ConversationE2E();
  });

  after(async () => {
    await webBrowser?.close().catch(() => {});
    await rm(MANAGED_ROOT, { recursive: true, force: true });
    await clearAppData();
  });

  it("WT04-1: worktree 任务冷恢复后仍归属原项目 workspace，同路径不出现第二个 workspace 状态", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const artifacts = process.env.ZCODE_E2E_ARTIFACT_DIR;
    if (!artifacts || !process.env.ZCODE_E2E_HOME_DIR)
      throw new Error("WT04 requires isolated Electron runner");
    await startDraftFromProject(DEFAULT_WORKSPACE);
    const toggle = $(`[data-testid="${TID_WORKTREE_TOGGLE}"]`);
    await toggle.waitForDisplayed({ timeout: 30_000, timeoutMsg: "worktree 复选框没有出现" });
    await browser.waitUntil(async () => (await toggle.getAttribute("disabled")) === null, {
      timeout: 30_000,
      timeoutMsg: "worktree 复选框一直禁用（CLI 未声明 worktreeCwd）",
    });
    await toggle.click();
    await browser.waitUntil(async () => (await toggle.getAttribute("data-state")) === "checked", {
      timeout: 10_000,
      timeoutMsg: "worktree 复选框没有勾选",
    });
    const marker = `${CASE}_COLD_${Date.now()}`;
    await sendAndWaitCompleted(marker);
    const worktree = await waitForNewWorktree([]);
    if (!isUnderManagedRoot(worktree)) throw new Error(`非受管 worktree 路径: ${worktree}`);

    const pathsBefore = await readDesktopWorkspacePaths();
    const identityBefore = await readActiveWorkspaceIdentity();
    // 本地 workspace 的 identity 为空：key 即路径（resolveWorkspaceKey 契约）。
    expect(identityBefore == null || identityBefore === "").toBe(true);
    expect(pathsBefore.filter((p) => p === DEFAULT_WORKSPACE).length).toBe(1);

    // 冷恢复：保留 profile 重启 Electron，验证持久化后的归属（不重建运行时状态）。
    await reloadElectronSessionSafely(browser);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 60_000);

    await $(`[data-testid="${TID_TASK_ROW_WORKTREE_ICON}"]`).waitForExist({
      timeout: 60_000,
      timeoutMsg: "冷恢复后任务行没有 worktree 图标",
    });
    // 打开该任务（图标所在行）：workspace 仍是项目主目录（归属不串），cwd 是受管 worktree。
    await browser.execute((iconId) => {
      const icon = document.querySelector(`[data-testid="${iconId}"]`);
      const row = icon?.closest('[role="button"], li, [class*="task"]');
      (row ?? icon)?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }),
      );
      (row ?? icon)?.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse" }),
      );
      (row ?? icon)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }, TID_TASK_ROW_WORKTREE_ICON);
    await waitForV4TimelineContaining(marker, 90_000);
    await waitForHeaderWorktree(worktree);

    const pathsAfter = await readDesktopWorkspacePaths();
    const identityAfter = await readActiveWorkspaceIdentity();
    expect(identityAfter == null || identityAfter === "").toBe(true);
    // 同路径只允许一个 workspace 状态（identity 未变）；worktree 任务没有带来第二个 tab。
    expect(pathsAfter.filter((p) => p === DEFAULT_WORKSPACE).length).toBe(1);
    // 受管 worktree 目录仍在（冷恢复不误删）。
    expect(
      await stat(worktree).then(
        () => true,
        () => false,
      ),
    ).toBe(true);
  });

  it("WT04-2: 手机查看 worktree 任务复用原 Host，不出现创建入口，不派生新 Host/CLI", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const artifacts = process.env.ZCODE_E2E_ARTIFACT_DIR;
    if (!artifacts || !process.env.ZCODE_E2E_HOME_DIR)
      throw new Error("WT04 requires isolated Electron runner");
    const agentsBefore = await readAgentTreeSnapshot();
    // WT04 CLI 复用补证（2026-11-15 独立复核缺口）：除 sessionId 与 Host 进程集合外，
    // 记录查看前桌面 pane 的会话运行代（data-session-generation）——手机查看若另起/重启
    // 独立 CLI runtime，该代数会翻新；查看后应保持不变（合法冷恢复场景由 WT04-1 覆盖）。
    // 运行代必须存在且有效：查看前后都为 null 的空匹配不能当通过（独立复核 F2）。
    const desktopGenerationBefore = await browser.execute(() => {
      const pane = document.querySelector(
        '[data-testid="v4-session-pane-workspace-main"][data-session-id]:not([data-session-id="draft"])',
      );
      return pane?.getAttribute("data-session-generation") ?? null;
    });
    expect(desktopGenerationBefore).toMatch(/^\d+$/u);
    // 运行身份基线（2026-11-15 独立复核 F2 重写，按实测 ps 形态）：
    // macOS ps 中 Host/CLI 是改名进程（`zcode-host-<label>`、`zcode-cli`，不带路径），
    // Electron helper 才有完整命令行路径——按路径猜本 run 身份会恒空匹配（旧写法实证）。
    // 因此观察集有效性直接断言树内已存在本次运行的真实运行时：窗口唯一 Local Host 与
    // WT04-1 会话已建立的 CLI 连接都必须在树上；树外扫描改为「查看期间新增」增量判定，
    // 开发机上与本 run 无关的既有 zcode 进程进入基线，不误伤也不空放。
    const hostBefore = agentsBefore.filter((entry) => entry.includes("zcode-host"));
    const cliPidsBefore = agentsBefore
      .filter((entry) => entry.includes("zcode-cli"))
      .map((entry) => Number(entry.split(":", 1)[0]))
      .sort((left, right) => left - right);
    if (hostBefore.length === 0 || cliPidsBefore.length === 0)
      throw new Error(
        `Electron 树内观察集缺少本 run 运行时（host=${hostBefore.length}，cli=${cliPidsBefore.length}）；快照：${agentsBefore.join(" | ")}`,
      );
    // 树外 zcode 进程基线：手机查看开始前已存在的进程（含开发机其他实例）不算本 run 证据。
    const electronRootPidBefore = await browser.electron.execute((electron) => process.pid);
    const systemProcessesBefore = await listSystemProcesses();
    const outOfTreeBefore = systemProcessesBefore
      .filter(
        (proc) =>
          /zcode[-.](cli|host)/iu.test(proc.command) && proc.pid !== electronRootPidBefore,
      )
      .filter((proc) => !agentsBefore.some((entry) => entry.startsWith(`${proc.pid}:`)))
      .map((proc) => proc.pid)
      .sort((left, right) => left - right);

    const pairingUrl = await obtainUnreadPairingUrl();
    webBrowser = await chromium.launch({
      ...(process.env.ZCODE_E2E_MOBILE_BROWSER_EXECUTABLE || process.env.R3_MOBILE_CHROME
        ? {
            executablePath:
              process.env.ZCODE_E2E_MOBILE_BROWSER_EXECUTABLE || process.env.R3_MOBILE_CHROME,
          }
        : { channel: "chrome" }),
      headless: true,
    });
    const context = await webBrowser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "zh-CN",
    });
    await context.addInitScript((credentials) => {
      if (sessionStorage.getItem("wt04-credentials-seeded")) return;
      sessionStorage.setItem("wt04-credentials-seeded", "1");
      for (const [key, value] of Object.entries(credentials)) localStorage.setItem(key, value);
    }, WEB_REMOTE_CONTROL_FIXTURE_CREDENTIALS);
    const page = await context.newPage();
    // 手机首页出现共享项目行即视为配对完成。
    await openMobilePairingPage(page, pairingUrl, {
      artifactDir: artifacts,
      caseMarker: CASE,
      phase: "mobile",
      readySelector: "[data-project-id]",
    });

    // 打开项目主目录对应的共享项目，再打开 WT04-1 的 worktree 任务。
    const projectName = basename(DEFAULT_WORKSPACE);
    const projectRow = page.locator("[data-project-id]", { hasText: projectName }).first();
    await projectRow.waitFor({ timeout: 45_000 });
    await projectRow.click();
    // 回放 fixture 生成的任务标题固定（Upstream E2E Fixture），不能按 marker 文本定位；
    // 本隔离 app 中项目只有 WT04-1 创建的一个 worktree 任务——按共享 TaskList 的
    // worktree 图标定位它的行。
    const worktreeIcon = page.getByTestId(TID_TASK_ROW_WORKTREE_ICON).first();
    await worktreeIcon.waitFor({ timeout: 60_000 });
    await worktreeIcon.click();
    await page.getByText(E2E_REPLY_TOKEN, { exact: false }).first().waitFor({ timeout: 90_000 });

    // 手机页没有 worktree 创建入口：managed-worktrees 通道不放行手机 attachment。
    expect(await page.getByTestId(TID_WORKTREE_TOGGLE).count()).toBe(0);

    // 查看复用的是原任务会话：手机 pane 与桌面 pane 指向同一 session id
    // （不派生另一个并行任务/会话）。CLI 进程按会话懒启动属正常恢复，不作为判据。
    const mobileSessionId = await page
      .locator('[data-session-id]:not([data-session-id="draft"])')
      .first()
      .getAttribute("data-session-id");
    const desktopSessionId = await browser.execute(() => {
      const pane = document.querySelector(
        '[data-testid="v4-session-pane-workspace-main"][data-session-id]:not([data-session-id="draft"])',
      );
      return pane?.getAttribute("data-session-id") ?? null;
    });
    expect(mobileSessionId).toBeTruthy();
    expect(mobileSessionId).toBe(desktopSessionId);

    // CLI 复用归属补证④（独立复核 G2，2026-11-15）——同一 runtime/CLI 连接的直接关联：
    // 会话生命周期计数器只存在于 CLI 进程内存（bootstrap session-lifecycle controller 的
    // entries 不落盘：generation 从 0 起、仅本进程 activate 递增，initialSnapshot 恒
    // generation=0）。桌面 pane 的 generation ≥1 由 WT04-1 真实任务执行产生；手机 pane
    // 读到与桌面完全相同的数值，只可能是同一个 CLI 进程里的同一计数器。若 Host 为手机
    // 另起该会话的独立 CLI，新进程对该会话的内存计数为 0，必然与桌面值不相等——由此把
    // 「树内新增 CLI」与「本会话 runtime」区分开（新增 CLI 属其他用途的合法懒启动）。
    // 生命周期状态同源同理。两处 null===null 的空匹配按 F2 规则显式拒绝。
    const mobilePane = page.locator('[data-session-id]:not([data-session-id="draft"])').first();
    const mobileGeneration = await mobilePane.getAttribute("data-session-generation");
    const mobileLifecycleState = await mobilePane.getAttribute("data-session-lifecycle");
    expect(mobileGeneration).toMatch(/^\d+$/u);
    expect(Number(mobileGeneration)).toBeGreaterThanOrEqual(1);
    const desktopGenerationAtView = await browser.execute(() => {
      const pane = document.querySelector(
        '[data-testid="v4-session-pane-workspace-main"][data-session-id]:not([data-session-id="draft"])',
      );
      return pane?.getAttribute("data-session-generation") ?? null;
    });
    expect(desktopGenerationAtView).toMatch(/^\d+$/u);
    expect(mobileGeneration).toBe(desktopGenerationAtView);
    expect(mobileLifecycleState).toBeTruthy();
    const desktopLifecycleState = await browser.execute(() => {
      const pane = document.querySelector(
        '[data-testid="v4-session-pane-workspace-main"][data-session-id]:not([data-session-id="draft"])',
      );
      return pane?.getAttribute("data-session-lifecycle") ?? null;
    });
    expect(mobileLifecycleState).toBe(desktopLifecycleState);

    // 不派生另一 Host：窗口唯一 Local Host 的进程集合不变（zcode-host 无新增/替换）。
    const agentsAfter = await readAgentTreeSnapshot();
    expect(agentsAfter.filter((entry) => entry.includes("zcode-host"))).toEqual(hostBefore);

    // CLI 复用归属补证①：桌面 pane 会话运行代不变——手机查看走原 Host attachment 的
    // 只读路径，不为查看重启/派生会话 runtime。
    const desktopGenerationAfter = await browser.execute(() => {
      const pane = document.querySelector(
        '[data-testid="v4-session-pane-workspace-main"][data-session-id]:not([data-session-id="draft"])',
      );
      return pane?.getAttribute("data-session-generation") ?? null;
    });
    expect(desktopGenerationAfter).toBe(desktopGenerationBefore);

    // CLI 复用归属补证②（进程级，独立复核 F2）：查看前已存在的会话 CLI 连接在查看后
    // 全部存活——原连接被复用而非重启/替换。Host 在树内按会话懒启动额外 CLI worker 属
    // 合法恢复语义（实测 +8，与 2026-11-15 run4 结论一致）；「另起该会话的独立 runtime」
    // 由 Host 集合不变、树外增量扫描与 session id 一致性排除，树内新 CLI 不算独立证据。
    const cliPidsAfter = agentsAfter
      .filter((entry) => entry.includes("zcode-cli"))
      .map((entry) => Number(entry.split(":", 1)[0]))
      .sort((left, right) => left - right);
    const droppedCliPids = cliPidsBefore.filter((pid) => !cliPidsAfter.includes(pid));
    if (droppedCliPids.length > 0)
      throw new Error(
        `手机查看期间原会话 CLI 连接被重启/替换（前=${cliPidsBefore.join(",")} 后=${cliPidsAfter.join(",")}，消失=${droppedCliPids.join(",")}）`,
      );

    // CLI 复用归属补证③（独立复核 F2）：手机查看期间系统里不得新增任何树外
    // zcode CLI/Host 进程——与查看前基线做增量判定，不按路径猜本 run 身份
    // （改名进程无路径，路径过滤已实证恒空匹配）。
    const electronRootPidAfter = await browser.electron.execute((electron) => process.pid);
    const allProcesses = await listSystemProcesses();
    const rogueAgents = allProcesses
      .filter(
        (proc) =>
          /zcode[-.](cli|host)/iu.test(proc.command) && proc.pid !== electronRootPidAfter,
      )
      .filter((proc) => !agentsAfter.some((entry) => entry.startsWith(`${proc.pid}:`)))
      .filter((proc) => !outOfTreeBefore.includes(proc.pid));
    expect(rogueAgents).toEqual([]);

    // 桌面侧没有因此打开第二个同路径 workspace（不派生另一 Host 的窗口侧证据）。
    const pathsAfterMobile = await readDesktopWorkspacePaths();
    expect(pathsAfterMobile.filter((p) => p === DEFAULT_WORKSPACE).length).toBe(1);
  });
});
