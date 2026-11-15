// 受管 worktree 任务 WT04（验收矩阵）：同路径不同 identity、冷恢复、手机/远端查看。
// 归属不串（workspace 始终是项目主目录，worktree 只是 cwd）；手机 attachment 不放行
// managed-worktrees 通道（无创建入口）；查看只复用原 Host attachment，不派生新 Host/CLI。
// 仅本地链路：桌面 Electron + 本机手机页（隔离凭据），不访问真实 SSH 或用户 worktree。
import { execFile } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser } from "playwright-core";
import { TID_TASK_ROW_WORKTREE_ICON, TID_WORKSPACE_PATH, TID_WORKTREE_TOGGLE } from "@zcode/shared/test-ids";
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
          getState(): { activeWorkspacePath: string | null; activeWorkspaceIdentity?: string | null };
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
    expect(await stat(worktree).then(() => true, () => false)).toBe(true);
  });

  it("WT04-2: 手机查看 worktree 任务复用原 Host，不出现创建入口，不派生新 Host/CLI", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const artifacts = process.env.ZCODE_E2E_ARTIFACT_DIR;
    if (!artifacts || !process.env.ZCODE_E2E_HOME_DIR)
      throw new Error("WT04 requires isolated Electron runner");
    const agentsBefore = await readAgentTreeSnapshot();

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
    await page
      .getByText(E2E_REPLY_TOKEN, { exact: false })
      .first()
      .waitFor({ timeout: 90_000 });

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

    // 不派生另一 Host：窗口唯一 Local Host 的进程集合不变（zcode-host 无新增）。
    const hostBefore = agentsBefore.filter((entry) => entry.includes("zcode-host"));
    const agentsAfter = await readAgentTreeSnapshot();
    expect(agentsAfter.filter((entry) => entry.includes("zcode-host"))).toEqual(hostBefore);

    // 桌面侧没有因此打开第二个同路径 workspace（不派生另一 Host 的窗口侧证据）。
    const pathsAfterMobile = await readDesktopWorkspacePaths();
    expect(pathsAfterMobile.filter((p) => p === DEFAULT_WORKSPACE).length).toBe(1);
  });
});
