import { DatabaseSync } from "node:sqlite";
import { basename, join } from "node:path";
import { writeFile } from "node:fs/promises";
import {
  TID_TASK_ITEM,
  TID_WORKSPACE_MORE_BUTTON,
  TID_WORKSPACE_TITLE,
  testId,
} from "@zcode/shared/test-ids";
import {
  DEFAULT_CONVERSATION_WORKSPACE,
  DEFAULT_WORKSPACE,
  restoreElectronRendererContentSize,
  setCurrentElectronRendererContentSize,
  waitForWorkspaceApp,
} from "../../../helpers/desktop-app.js";
import { resolveE2EStorageRoot } from "../../../helpers/e2e-runtime-paths.js";

declare global {
  interface Window {
    __occCopiedText?: string;
  }
}
const home = process.env.ZCODE_E2E_HOME_DIR!;
const first = "sess_e2e_occ_history";
const second = "sess_e2e_occ_other";
const projects = ["e2e-occ-project-a", "e2e-occ-project-b"];
const item = (id: string) => $('[data-testid="' + testId(TID_TASK_ITEM, id) + '"]');
const preferencesKey = "zcode-project-sidebar-preferences";

/** 注入测试窗口的剪贴板端口，不覆盖用户系统剪贴板；历史查询仍走真实 Host/CLI。 */
async function captureClipboard() {
  await browser.execute(() => {
    window.__occCopiedText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.__occCopiedText = text;
        },
        write: async (items: ClipboardItem[]) => {
          window.__occCopiedText = await (await items[0]!.getType("text/plain")).text();
        },
      },
    });
  });
}
async function copyFromMenu() {
  await $('[data-testid="task-copy-markdown"]').waitForClickable();
  await $('[data-testid="task-copy-markdown"]').click();
  await browser.waitUntil(
    () => browser.execute(() => Boolean(window.__occCopiedText?.startsWith("# "))),
    { timeout: 30_000, timeoutMsg: "对话 Markdown 未写入剪贴板端口" },
  );
  return browser.execute(() => window.__occCopiedText!);
}
async function openFilter() {
  const trigger = $('[data-testid="sidebar-view-menu"]');
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await $('[data-testid="sidebar-view-projects"]').waitForDisplayed();
}
async function closeFilter() {
  const trigger = $('[data-testid="sidebar-view-menu"]');
  if ((await trigger.getAttribute("aria-expanded")) === "true") await browser.keys("Escape");
  await browser.waitUntil(async () => (await trigger.getAttribute("aria-expanded")) === "false");
  await $('[data-testid="sidebar-view-projects"]').waitForDisplayed({ reverse: true });
}
async function projectOrder() {
  return browser.execute(
    (ids) =>
      [...document.querySelectorAll<HTMLElement>("[data-project-id]")]
        .map((node) => node.dataset.projectId!)
        .filter((id) => ids.includes(id)),
    projects,
  );
}

describe("OpenZWork 对话管理增强", () => {
  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      await browser.saveScreenshot(
        join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "OCC-failure-" + Date.now() + ".png"),
      );
    }
  });
  before(async function () {
    this.timeout(90_000);
    if (!home || !basename(home).startsWith("occ-e2e-"))
      throw new Error("isolated OCC HOME required");
    await waitForWorkspaceApp(DEFAULT_CONVERSATION_WORKSPACE, 45_000);
    const storage = resolveE2EStorageRoot(home);
    const db = new DatabaseSync(join(storage, "v2/tasks-index.sqlite"));
    const cli = new DatabaseSync(join(storage, "cli/db/db.sqlite"));
    const now = Date.now();
    try {
      for (const [index, id] of projects.entries()) {
        db.prepare(
          "INSERT INTO projects(project_id,host_id,name,position,deleted,created_at,updated_at) VALUES(?,'local',?,?,0,?,?)",
        ).run(
          id,
          index === 0 ? "E2E_OCC 项目甲" : "E2E_OCC 项目乙",
          index,
          now - 10_000,
          now - 10_000,
        );
        db.prepare(
          "INSERT INTO project_roots(project_id,root_path,position,is_primary) VALUES(?,?,0,1)",
        ).run(id, DEFAULT_WORKSPACE);
      }
      for (const [index, id] of [first, second].entries()) {
        const title = index === 0 ? "E2E_OCC_LONG" : "E2E_OCC_OTHER";
        const updated = now - (index === 0 ? 2000 : 1000);
        cli
          .prepare(
            "INSERT INTO session(id,project_id,slug,directory,title,version,time_created,time_updated,title_source,last_outcome) VALUES(?,?,?,?,?,'1',?,?,'custom','completed')",
          )
          .run(id, "e2e-occ", id, DEFAULT_WORKSPACE, title, now - 9000, updated);
        const count = index === 0 ? 110 : 1;
        for (let turn = 0; turn < count; turn++) {
          const userId = id + "_u_" + turn;
          const assistantId = id + "_a_" + turn;
          const created = now - 8000 + turn * 4;
          const userText =
            index === 0 ? "E2E_OCC_USER_" + String(turn).padStart(3, "0") : "E2E_OCC_OTHER_USER";
          const assistantText =
            index === 0
              ? "E2E_OCC_ANSWER_" +
                String(turn).padStart(3, "0") +
                "\n\n~~~ts\nconst example = 1;\n~~~"
              : "E2E_OCC_OTHER_ANSWER";
          const messages = [
            {
              id: userId,
              text: userText,
              time: created,
              data: { role: "user", agent: "build", content: userText, time: { created } },
            },
            {
              id: assistantId,
              text: assistantText,
              time: created + 1,
              data: {
                role: "assistant",
                agent: "build",
                parentID: userId,
                content: assistantText,
                modelID: "fixture-model",
                providerID: "fixture-provider",
                mode: "build",
                finish: "stop",
                cost: 0,
                path: { cwd: DEFAULT_WORKSPACE, root: DEFAULT_WORKSPACE },
                tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
                time: { created: created + 1, completed: created + 2 },
              },
            },
          ];
          for (const [offset, message] of messages.entries()) {
            cli
              .prepare(
                "INSERT INTO message(id,session_id,time_created,time_updated,data,sequence) VALUES(?,?,?,?,?,?)",
              )
              .run(
                message.id,
                id,
                message.time,
                message.time,
                JSON.stringify(message.data),
                turn * 2 + offset,
              );
            cli
              .prepare(
                "INSERT INTO part(id,message_id,session_id,time_created,time_updated,data,sequence) VALUES(?,?,?,?,?,?,0)",
              )
              .run(
                message.id + "_text",
                message.id,
                id,
                message.time,
                message.time,
                JSON.stringify({
                  type: "text",
                  text: message.text,
                  time: { start: message.time, end: message.time + 1 },
                }),
              );
          }
        }
        db.prepare(
          "INSERT INTO tasks(workspace_key,workspace_path,task_id,title,provider,mode,created_at,updated_at,host_id,root_path,project_id,unread_at,pinned,cli_title,cli_title_source,cli_created_at,cli_updated_at,cli_last_outcome,cli_deleted) VALUES(?,?,?,?,'glm','default',?,?,'local',?,?,?,0,?,'custom',?,?,'completed',0)",
        ).run(
          DEFAULT_WORKSPACE,
          DEFAULT_WORKSPACE,
          id,
          title,
          now - 9000,
          updated,
          DEFAULT_WORKSPACE,
          projects[index]!,
          index === 1 ? updated : null,
          title,
          now - 9000,
          updated,
        );
      }
    } finally {
      db.close();
      cli.close();
    }
    await browser.execute(
      (key, ids) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            order: ids.map((id) => JSON.stringify(["local", id])),
            view: "projects",
            projectSort: "manual",
            expanded: Object.fromEntries(ids.map((id) => [JSON.stringify(["local", id]), true])),
          }),
        );
      },
      preferencesKey,
      projects,
    );
    await browser.refresh();
    await waitForWorkspaceApp(DEFAULT_CONVERSATION_WORKSPACE, 45_000);
    await browser.execute(() => {
      const actions = (
        window as typeof window & {
          __testActions: { setLocale(value: string): void; setTheme(value: string): void };
        }
      ).__testActions;
      actions.setLocale("zh-CN");
      actions.setTheme("zai-light");
    });
    await browser.waitUntil(() =>
      browser.execute(() => document.documentElement.classList.contains("theme-zai-light")),
    );
    await captureClipboard();
    await item(first).waitForDisplayed();
    await item(second).waitForDisplayed();
  });

  it("OCC01：右键复制未打开的长历史，覆盖首尾全部消息", async function () {
    this.timeout(60_000);
    await item(first).click({ button: "right" });
    const markdown = await copyFromMenu();
    expect(markdown).toContain("# E2E_OCC_LONG");
    expect(markdown).toContain("E2E_OCC_USER_000");
    expect(markdown).toContain("E2E_OCC_ANSWER_109");
    expect(markdown.match(/E2E_OCC_USER_/g)).toHaveLength(110);
    expect(markdown.match(/E2E_OCC_ANSWER_/g)).toHaveLength(110);
    expect(markdown.indexOf("E2E_OCC_USER_000")).toBeLessThan(
      markdown.indexOf("E2E_OCC_ANSWER_000"),
    );
    await writeFile(join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "OCC01-copy.md"), markdown);
  });

  it("OCC01/06：当前三点和列表右键目标独立，归档项使用 destructive", async function () {
    this.timeout(60_000);
    await item(first).click();
    await $('[data-testid="' + TID_WORKSPACE_MORE_BUTTON + '"]').waitForDisplayed();
    await browser.execute(() => {
      window.__occCopiedText = "";
    });
    await $('[data-testid="' + TID_WORKSPACE_MORE_BUTTON + '"]').click();
    await $('[data-testid="task-copy-markdown"]').waitForDisplayed();
    expect(await $('[role="menuitem"][data-variant="destructive"]').getText()).toContain("归档");
    await browser.saveScreenshot(join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "OCC06-menu-light.png"));
    expect(await copyFromMenu()).toContain("# E2E_OCC_LONG");
    await browser.execute(() => {
      window.__occCopiedText = "";
    });
    await item(second).click({ button: "right" });
    expect(await copyFromMenu()).toContain("# E2E_OCC_OTHER");
    expect(await $('[data-testid="' + TID_WORKSPACE_TITLE + '"]').getText()).toContain(
      "E2E_OCC_LONG",
    );
  });

  it("OCC03：组合筛选、空态和清除沿真实侧栏接线", async () => {
    await openFilter();
    await $('[data-testid="sidebar-filter-unread"]').click();
    await closeFilter();
    await item(first).waitForDisplayed({ reverse: true });
    await item(second).waitForDisplayed();
    for (const view of ["grouped", "timeline", "projects"]) {
      await openFilter();
      await $('[data-testid="sidebar-view-' + view + '"]').click();
      await closeFilter();
      await item(second).waitForDisplayed();
      await item(first).waitForDisplayed({ reverse: true });
      await browser.execute(() => {
        window.__occCopiedText = "";
      });
      await item(second).click({ button: "right" });
      expect(await $('[role="menuitem"][data-variant="destructive"]').getText()).toContain("归档");
      expect(await copyFromMenu()).toContain("# E2E_OCC_OTHER");
    }
    await openFilter();
    await $('[data-testid="sidebar-filter-status"]').click();
    await $('[data-testid="sidebar-filter-status-running"]').waitForDisplayed();
    await $('[data-testid="sidebar-filter-status-running"]').click();
    await browser.saveScreenshot(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "OCC03-filter-menu.png"),
    );
    await closeFilter();
    await $('[data-testid="sidebar-filter-empty"]').waitForDisplayed();
    expect(await $('[data-testid="sidebar-filter-count"]').getText()).toBe("2");
    await browser.saveScreenshot(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "OCC03-filter-empty.png"),
    );
    await $('[data-testid="sidebar-filter-empty"] button').click();
    await item(first).waitForDisplayed();
    await item(second).waitForDisplayed();
  });

  it("OCC04/05：自动排序、重新加载、切回手动保留原顺序", async () => {
    expect(await projectOrder()).toEqual(projects);
    await openFilter();
    await $('[data-testid="sidebar-project-sort"]').click();
    await $('[data-testid="sidebar-project-sort-activity"]').waitForDisplayed();
    await $('[data-testid="sidebar-project-sort-activity"]').click();
    await closeFilter();
    await browser.waitUntil(
      async () => JSON.stringify(await projectOrder()) === JSON.stringify([...projects].reverse()),
    );
    await browser.saveScreenshot(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "OCC04-project-activity.png"),
    );
    await browser.refresh();
    // 重载后的主区由原导航恢复逻辑决定；这里只等侧栏目录读回，不强制切换 cwd。
    await item(first).waitForDisplayed({ timeout: 30_000 });
    expect(await projectOrder()).toEqual([...projects].reverse());
    await openFilter();
    await $('[data-testid="sidebar-project-sort"]').click();
    await $('[data-testid="sidebar-project-sort-manual"]').waitForDisplayed();
    await $('[data-testid="sidebar-project-sort-manual"]').click();
    await closeFilter();
    await browser.waitUntil(
      async () => JSON.stringify(await projectOrder()) === JSON.stringify(projects),
    );
  });

  it("OCC06：深色菜单保持可读与相同归档样式", async () => {
    await browser.execute(() =>
      (
        window as typeof window & { __testActions: { setTheme(value: string): void } }
      ).__testActions.setTheme("zai-dark"),
    );
    await browser.waitUntil(() =>
      browser.execute(() => document.documentElement.classList.contains("theme-zai-dark")),
    );
    await item(first).click({ button: "right" });
    await $('[data-testid="task-copy-markdown"]').waitForDisplayed();
    expect(await $('[role="menuitem"][data-variant="destructive"]').getText()).toContain("归档");
    await browser.saveScreenshot(join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "OCC06-menu-dark.png"));
    await browser.keys("Escape");
  });

  it("OCC06：窄窗口的筛选菜单与条件可以操作", async () => {
    const original = await setCurrentElectronRendererContentSize(800, 700);
    try {
      await openFilter();
      await $('[data-testid="sidebar-filter-unread"]').click();
      await $('[data-testid="sidebar-filter-status"]').click();
      await $('[data-testid="sidebar-filter-status-waiting"]').waitForDisplayed();
      const bounds = await browser.execute(() => {
        const menu = document
          .querySelector('[data-testid="sidebar-filter-status-waiting"]')!
          .getBoundingClientRect();
        return { left: menu.left, right: menu.right, width: innerWidth };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.width);
      await browser.saveScreenshot(
        join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "OCC06-narrow-filter.png"),
      );
      await closeFilter();
      await $('[data-testid="sidebar-filter-chips"] button').click();
      await item(first).waitForDisplayed();
    } finally {
      await restoreElectronRendererContentSize(original);
    }
  });
});
