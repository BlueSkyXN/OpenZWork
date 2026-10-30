import type { DatabaseSync } from "node:sqlite";
import type {
  AppUsageSessionsQueryInput,
  AppUsageSessionsQueryResult,
  AppUsageSessionRow,
} from "@zcode/contracts";
import type { UsageQueryScope } from "./contract.js";

const SUBTASK_TYPES = "'subagent_child','workflow_child','nested_workflow_child'";
const AUXILIARY_TYPES = `${SUBTASK_TYPES},'selection_side_chat'`;

export function buildUsageQueryScope(sessionIds?: readonly string[]): UsageQueryScope {
  if (sessionIds === undefined) return { cte: "", condition: "", parameters: [] };
  return {
    // parent_id 同时用于 fork；只能沿辅助会话边扩展，防止跨项目重复计算分叉。
    cte: `with recursive selected_sessions(id) as (
      select id from session where id in (select value from json_each(?))
      union
      select child.id from session child join selected_sessions parent on child.parent_id = parent.id
      where child.task_type in (${AUXILIARY_TYPES})
    ) `,
    condition: " and session_id in (select id from selected_sessions)",
    parameters: [JSON.stringify([...new Set(sessionIds)])],
  };
}

export function queryUsageSessions(
  db: DatabaseSync,
  input: AppUsageSessionsQueryInput,
  scope: UsageQueryScope,
): AppUsageSessionsQueryResult {
  const prefix = scope.cte ? scope.cte.trimEnd() + ", " : "with recursive ";
  // 同一 SQL 快照计算合计和本页；越界页仍通过 LEFT JOIN 返回全量计数与合计。
  const rows = db
    .prepare(`${prefix}
    lineage(session_id, root_id, is_subtask) as (
      select id, id, 0 from session where coalesce(task_type,'interactive') not in (${AUXILIARY_TYPES})
        or parent_id is null or parent_id not in (select id from session)
      union
      select child.id, parent.root_id,
        case when parent.is_subtask = 1 or child.task_type in (${SUBTASK_TYPES}) then 1 else 0 end
      from session child join lineage parent on child.parent_id = parent.session_id
      where child.task_type in (${AUXILIARY_TYPES})
    ),
    grouped as (
      select coalesce(lineage.root_id, m.session_id) as sessionId,
        sum(case when coalesce(lineage.is_subtask,0) = 0 then m.computed_total_tokens else 0 end) as mainTokens,
        sum(case when lineage.is_subtask = 1 then m.computed_total_tokens else 0 end) as subagentTokens,
        sum(m.computed_total_tokens) as totalTokens, count(*) as requestCount,
        count(distinct case when lineage.is_subtask = 1 then m.session_id end) as childSessionCount
      from model_usage m left join lineage on lineage.session_id = m.session_id
      where m.started_at >= ? and m.started_at <= ?${scope.condition.replace("session_id", "m.session_id")}
      group by coalesce(lineage.root_id, m.session_id)
    ),
    totals as (
      select count(*) as totalCount, coalesce(sum(mainTokens),0) as allMainTokens,
        coalesce(sum(subagentTokens),0) as allSubagentTokens, coalesce(sum(totalTokens),0) as allTokens,
        coalesce(sum(childSessionCount),0) as allChildSessionCount from grouped
    ),
    page as (select * from grouped order by totalTokens desc, sessionId limit ? offset ?)
    select page.*, session.title, totals.* from totals left join page on 1
    left join session on session.id = page.sessionId order by page.totalTokens desc, page.sessionId
  `)
    .all(
      ...scope.parameters,
      input.since,
      input.until,
      input.limit,
      input.offset,
    ) as unknown as Array<
    AppUsageSessionRow & {
      totalCount: number;
      allMainTokens: number;
      allSubagentTokens: number;
      allTokens: number;
      allChildSessionCount: number;
    }
  >;
  const total = rows[0]!;
  return {
    rows: rows
      .filter((row) => row.sessionId != null)
      .map((row) => ({
        sessionId: row.sessionId,
        title: row.title ?? null,
        mainTokens: row.mainTokens,
        subagentTokens: row.subagentTokens,
        totalTokens: row.totalTokens,
        requestCount: row.requestCount,
        childSessionCount: row.childSessionCount,
      })),
    totalCount: total.totalCount,
    childSessionCount: total.allChildSessionCount,
    totals: {
      mainTokens: total.allMainTokens,
      subagentTokens: total.allSubagentTokens,
      totalTokens: total.allTokens,
    },
  };
}
