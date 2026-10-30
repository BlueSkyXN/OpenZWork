import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buildUsageQueryScope, queryUsageSessions } from "./index.js";

describe("scoped usage details", () => {
  it("keeps forks independent, folds side chats into main, and pages without losing totals", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`create table session(id text primary key, parent_id text, task_type text, title text);
        create table model_usage(session_id text, started_at integer, computed_total_tokens integer);
        insert into session values ('a',null,'interactive','A'),('b',null,'interactive','B'),
          ('c','a','subagent_child','Child'),('w','c','workflow_child','Workflow'),
          ('n','w','nested_workflow_child','Nested'),('s','a','selection_side_chat','Side'),
          ('sc','c','selection_side_chat','Child side'),('f','a','fork','Fork'),
          ('fc','f','subagent_child','Fork child'),('o','gone','subagent_child','Orphan');
        insert into model_usage values ('a',100,10),('b',100,50),('c',100,20),('w',100,30),
          ('n',100,40),('s',100,5),('sc',100,6),('f',100,70),('fc',100,7),('o',100,9),
          ('missing',100,11),('a',1,500);`);
      const input = { since: 10, until: 200, tzOffsetMs: 0, offset: 0, limit: 2 };
      const a = queryUsageSessions(db, input, buildUsageQueryScope(["a"]));
      expect(a.rows).toEqual([
        {
          sessionId: "a",
          title: "A",
          mainTokens: 15,
          subagentTokens: 96,
          totalTokens: 111,
          requestCount: 6,
          childSessionCount: 4,
        },
      ]);
      const fork = queryUsageSessions(db, input, buildUsageQueryScope(["f"]));
      expect(fork.totals).toEqual({ mainTokens: 70, subagentTokens: 7, totalTokens: 77 });
      const all = queryUsageSessions(db, input, buildUsageQueryScope());
      expect(all.totalCount).toBe(5);
      expect(all.totals.totalTokens).toBe(258);
      expect(all.rows.map((row) => row.sessionId)).toEqual(["a", "f"]);
      const last = queryUsageSessions(db, { ...input, offset: 4 }, buildUsageQueryScope());
      expect(last.rows).toHaveLength(1);
      expect(last.totals).toEqual(all.totals);
      const past = queryUsageSessions(db, { ...input, offset: 999 }, buildUsageQueryScope());
      expect(past.rows).toEqual([]);
      expect(past.totalCount).toBe(5);
      expect(past.totals).toEqual(all.totals);
      const empty = queryUsageSessions(db, input, buildUsageQueryScope([]));
      expect(empty).toMatchObject({
        rows: [],
        totalCount: 0,
        totals: { mainTokens: 0, subagentTokens: 0, totalTokens: 0 },
      });
      expect(a.totals.totalTokens + fork.totals.totalTokens + 50 + 9 + 11).toBe(
        all.totals.totalTokens,
      );
    } finally {
      db.close();
    }
  });
});
