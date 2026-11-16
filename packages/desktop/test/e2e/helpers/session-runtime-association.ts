import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * WT04 会话 runtime 实例关联（2026-11-16 H1）。
 *
 * 背景：`SessionLifecycleController.activate` 在每个进程内从 0 递增，`initialSnapshot` 恒为
 * generation=0。两个独立 CLI 进程各自 `ensureReady('same-session')` 后都会得到
 * generation=1、state=ready、revision=2 —— 「generation 相等且 ≥1 ⇔ 同一 CLI」不成立
 * （2026-11-15 独立复核已给出反例）。generation 因此只能作为生命周期辅助断言。
 *
 * 这里改用可区分实例的事实：进程 PID + 进程启动时间（`ps lstart`）+ 会话归属。
 * 同一 PID 且启动时间不变 ⇒ 同一进程实例；PID 复用必然伴随启动时间变化。
 */

export interface RuntimeProcessIdentity {
  command: string;
  pid: number;
  ppid: number;
  /** `ps -o lstart=` 原样字符串；同一 pid 换实例时该值必然变化。 */
  startedAt: string;
}

export interface SessionRuntimeFacts {
  /** 面板上的会话 id（不含 draft）。 */
  sessionId: string | null;
  /** 会话生命周期代数；只作辅助断言。 */
  generation: string | null;
  /** 会话生命周期状态；只作辅助断言。 */
  lifecycleState: string | null;
  /** 该面板所连 runtime 的实例标识（当前由进程身份推导，见 runtimeInstanceKey）。 */
  runtimeInstanceKey: string | null;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
}

/** 进程实例标识：pid + 启动时间。pid 被复用时启动时间不同，故两者一起才唯一。 */
export function runtimeInstanceKey(process: Pick<RuntimeProcessIdentity, "pid" | "startedAt">) {
  return `${process.pid}@${process.startedAt.trim()}`;
}

/**
 * 解析 `ps -axo pid=,ppid=,lstart=,command=`。
 * lstart 形如 `Fri Nov 15 14:43:09 2026`，固定 5 段、用空格分隔，command 取剩余部分。
 */
export function parseRuntimeProcessTable(output: string): RuntimeProcessIdentity[] {
  const rows: RuntimeProcessIdentity[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match =
      /^\s*(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/u.exec(
        line,
      );
    if (!match) continue;
    const [, pid = "", ppid = "", startedAt = "", command = ""] = match;
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      startedAt: startedAt.replace(/\s+/gu, " "),
      command: command.trim(),
    });
  }
  return rows;
}

export async function listRuntimeProcessIdentities(
  platform: NodeJS.Platform = process.platform,
): Promise<RuntimeProcessIdentity[]> {
  // lstart 只在 POSIX ps 上可用；Windows 走 tasklist 时没有等价字段，调用方应跳过该平台。
  if (platform === "win32") return [];
  const { stdout } = await exec("ps", ["-axo", "pid=,ppid=,lstart=,command="], {
    maxBuffer: 20 * 1024 * 1024,
  });
  return parseRuntimeProcessTable(stdout);
}

/** 取 Electron 根 pid 的后代集合（含根），用于把「本 run 的 CLI」与其他实例分开。 */
export function collectDescendantPids(
  processes: RuntimeProcessIdentity[],
  rootPid: number,
): Set<number> {
  const byParent = new Map<number, number[]>();
  for (const item of processes) {
    const list = byParent.get(item.ppid) ?? [];
    list.push(item.pid);
    byParent.set(item.ppid, list);
  }
  const result = new Set<number>([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of byParent.get(current) ?? []) {
      if (result.has(child)) continue;
      result.add(child);
      queue.push(child);
    }
  }
  return result;
}

/** 本 run 树内的 CLI 进程实例标识（pid@startedAt），按字符串排序。 */
export function collectTreeCliInstanceKeys(
  processes: RuntimeProcessIdentity[],
  rootPid: number,
): string[] {
  const inTree = collectDescendantPids(processes, rootPid);
  return processes
    .filter((item) => inTree.has(item.pid) && /zcode[-.]cli|zcode-cli/iu.test(item.command))
    .map((item) => runtimeInstanceKey(item))
    .sort();
}

export interface AssociationFailure {
  code: string;
  detail: string;
}

/**
 * 判定「手机面板与桌面面板使用同一 session 的同一 runtime 实例」。
 *
 * 判定顺序：会话相同 → 实例标识非空且相等 → 实例在查看前后未变 → generation/状态同源。
 * 任一项不满足都返回失败原因；`runtimeInstanceKey` 缺失视为空匹配，直接拒绝
 * （旧 F2 规则：null===null 不能当通过）。
 */
export function verifySameSessionRuntime(input: {
  desktop: SessionRuntimeFacts;
  mobile: SessionRuntimeFacts;
  desktopInstanceKeyBeforeView: string | null;
  desktopInstanceKeyAfterView: string | null;
  /** 查看前（S0）与查看后（S1）都以同一 pid@lstart 存活的实例；会话 runtime 必在其中。 */
  stableInstanceKeys: string[];
  /** 用例收尾（S2）仍存活的树内实例集合；稳定成员必须在其中（chat lane 无空闲回收）。 */
  endInstanceKeys: string[];
}): AssociationFailure[] {
  const failures: AssociationFailure[] = [];
  const { desktop, mobile } = input;

  if (!desktop.sessionId || !mobile.sessionId)
    failures.push({ code: "session-missing", detail: "desktop/mobile session id missing" });
  else if (desktop.sessionId !== mobile.sessionId)
    failures.push({
      code: "session-mismatch",
      detail: `desktop=${desktop.sessionId} mobile=${mobile.sessionId}`,
    });

  if (!desktop.runtimeInstanceKey || !mobile.runtimeInstanceKey)
    failures.push({
      code: "instance-key-missing",
      detail: `desktop=${desktop.runtimeInstanceKey} mobile=${mobile.runtimeInstanceKey}`,
    });
  else if (desktop.runtimeInstanceKey !== mobile.runtimeInstanceKey)
    failures.push({
      code: "instance-mismatch",
      detail: `desktop=${desktop.runtimeInstanceKey} mobile=${mobile.runtimeInstanceKey}`,
    });

  // 查看前后必须是同一实例：手机查看不得重启或替换会话 runtime。
  if (!input.desktopInstanceKeyBeforeView || !input.desktopInstanceKeyAfterView)
    failures.push({ code: "instance-key-missing-around-view", detail: "before/after key missing" });
  else if (input.desktopInstanceKeyBeforeView !== input.desktopInstanceKeyAfterView)
    failures.push({
      code: "instance-changed-during-view",
      detail: `before=${input.desktopInstanceKeyBeforeView} after=${input.desktopInstanceKeyAfterView}`,
    });

  // 会话 runtime 必须是跨窗口稳定实例：生命期盖不住查看窗口的短命 worker（实测约
  // 10 个/秒生死更替）不可能服务两端，树内 pid 级零更替反而是不可满足的错误判据。
  if (input.stableInstanceKeys.length === 0)
    failures.push({
      code: "stable-instance-missing",
      detail: "no instance survived the view window",
    });
  // 稳定成员必须活到用例收尾：Host 的 chat/plugin 进程管理器按 workspaceKey 单活
  //（activeClientsByWorkspaceKey，chat lane 无空闲回收），「为手机另起会话 CLI」只能
  // 以替换原实例的方式出现，表现为稳定成员消失或 pid@lstart 变化。窗口内其他 lane
  // （mcp-status 等，带空闲回收）的新增持久 worker 属合法懒启动，由调用方记录为证据。
  const endKeys = new Set(input.endInstanceKeys);
  const lost = input.stableInstanceKeys.filter((key) => !endKeys.has(key));
  if (lost.length > 0)
    failures.push({ code: "stable-instance-lost", detail: `lost=${lost.join(",")}` });

  // generation 只作辅助：必须同源非零，但不作为实例身份。
  if (!/^\d+$/u.test(desktop.generation ?? "") || !/^\d+$/u.test(mobile.generation ?? ""))
    failures.push({
      code: "generation-missing",
      detail: `desktop=${desktop.generation} mobile=${mobile.generation}`,
    });
  else if (desktop.generation !== mobile.generation)
    failures.push({
      code: "generation-mismatch",
      detail: `desktop=${desktop.generation} mobile=${mobile.generation}`,
    });
  if (!desktop.lifecycleState || !mobile.lifecycleState)
    failures.push({
      code: "lifecycle-missing",
      detail: `desktop=${desktop.lifecycleState} mobile=${mobile.lifecycleState}`,
    });
  else if (desktop.lifecycleState !== mobile.lifecycleState)
    failures.push({
      code: "lifecycle-mismatch",
      detail: `desktop=${desktop.lifecycleState} mobile=${mobile.lifecycleState}`,
    });

  // workspace identity 参与关联：本地 workspace 的 identity 合法为空（key 回落为路径，
  // resolveWorkspaceKey 契约），两侧同为空不算缺失；只有单侧缺失或取值不等才拒绝。
  const desktopIdentity = desktop.workspaceIdentity ?? null;
  const mobileIdentity = mobile.workspaceIdentity ?? null;
  if (desktopIdentity !== mobileIdentity)
    failures.push({
      code: "workspace-identity-mismatch",
      detail: `desktop=${desktopIdentity} mobile=${mobileIdentity}`,
    });
  if (
    desktop.remoteSessionId &&
    mobile.remoteSessionId &&
    desktop.remoteSessionId !== mobile.remoteSessionId
  )
    failures.push({
      code: "remote-session-mismatch",
      detail: `desktop=${desktop.remoteSessionId} mobile=${mobile.remoteSessionId}`,
    });

  return failures;
}
