import { describe, expect, it, vi } from "vitest";
import type {
  ConversationRow,
  V4ConversationRowsRangeResult,
} from "@zcode/shared/zcode-protocol-v4";
import {
  copyConversationMarkdown,
  formatConversationMarkdown,
  loadConversationMarkdown,
} from "./index.js";

const labels = { user: "用户", assistant: "助手", attachment: "附件" };
const input = (rowId: number, text = "问题"): ConversationRow => ({
  rowId,
  turnId: "turn",
  createdAt: rowId,
  createdAtSeq: rowId,
  kind: "userInput",
  origin: "realUser",
  text,
});
const answer = (rowId: number, text = "回答"): ConversationRow => ({
  rowId,
  turnId: "turn",
  createdAt: rowId,
  createdAtSeq: rowId,
  kind: "assistantText",
  text,
  state: "complete",
});
const page = (
  rows: ConversationRow[],
  hasMore = false,
  revision = 1,
  epoch = "epoch",
): V4ConversationRowsRangeResult => ({
  rows,
  hasMore,
  atSeq: 10,
  atRevision: revision,
  atLogEpoch: epoch,
});

describe("对话 Markdown 导出", () => {
  it("OCC02：中间页的 seq 回退也要重试，剪贴板拒绝不能报告成功", async () => {
    let reads = 0;
    const readPage = async () => {
      const step = reads++ % 3;
      return {
        ...page([input(3 - step)], step < 2),
        atSeq: [10, 20, 15][step]!,
      };
    };
    await expect(
      loadConversationMarkdown({ title: "历史", labels, readPage }),
    ).rejects.toMatchObject({ code: "changed" });
    expect(reads).toBe(6);
    await expect(
      copyConversationMarkdown({
        title: "历史",
        labels,
        readPage: async () => page([input(1)]),
        writeText: async () => {
          throw new Error("clipboard denied");
        },
      }),
    ).rejects.toThrow("clipboard denied");
  });
  it("OCC02：异步剪贴板端口在读取完成前取得内容 Promise", async () => {
    let release!: (result: V4ConversationRowsRangeResult) => void;
    const held = new Promise<V4ConversationRowsRangeResult>((resolve) => {
      release = resolve;
    });
    const writeDeferredText = vi.fn(async (text: Promise<string>) => {
      expect(await text).toContain("# 移动端");
    });
    const result = copyConversationMarkdown({
      title: "移动端",
      labels,
      readPage: () => held,
      writeText: vi.fn(async () => {}),
      writeDeferredText,
    });
    expect(writeDeferredText).toHaveBeenCalledOnce();
    release(page([input(1), answer(2)]));
    expect(await result).toBe("copied");
  });
  it("OCC01：保留正文格式与附件名，排除系统输入、思考和引擎尾注", () => {
    const user = input(1, "问题\n内部尾注");
    if (user.kind !== "userInput") throw new Error("fixture");
    user.epilogueStart = 2;
    user.attachments = [{ ref: "private-ref", fileName: "示例.csv", mime: "text/csv", bytes: 2 }];
    const internal = { ...input(3, "不应导出"), origin: "backgroundResult" } as ConversationRow;
    const reasoning = {
      ...answer(4, "内部思考"),
      kind: "reasoning",
      state: "complete",
    } as ConversationRow;
    const body = "~~~ts\nconst n = 1;\n~~~\n\n| a | b |\n|---|---|\n|1|2|";
    const text = formatConversationMarkdown([user, answer(2, body), internal, reasoning], {
      title: "标题\n续行",
      labels,
    });
    expect(text).toContain("# 标题 续行");
    expect(text).toContain("## 用户\n\n问题");
    expect(text).toContain("附件：示例.csv");
    expect(text).toContain(body);
    for (const forbidden of ["内部尾注", "内部思考", "不应导出", "private-ref"])
      expect(text).not.toContain(forbidden);
  });
  it("OCC01：200 行以上按游标读取全部历史，正文 delta 不要求 seq 静止", async () => {
    const rows = Array.from({ length: 405 }, (_, i) =>
      i % 2 ? answer(i + 1, "回答 " + (i + 1)) : input(i + 1, "问题 " + (i + 1)),
    );
    const readPage = vi.fn(
      async ({ beforeRowId, limit }: { beforeRowId?: number; limit: number }) => {
        const eligible = rows.filter((row) => beforeRowId === undefined || row.rowId < beforeRowId);
        return {
          ...page(eligible.slice(-limit), eligible.length > limit),
          atSeq: 10 + readPage.mock.calls.length,
        };
      },
    );
    const text = await loadConversationMarkdown({ title: "完整历史", labels, readPage });
    expect(text.indexOf("问题 1\n")).toBeLessThan(text.indexOf("回答 2\n"));
    expect(text).toContain("问题 405");
    expect(readPage.mock.calls.map(([value]) => value.beforeRowId)).toEqual([
      undefined,
      206,
      6,
      undefined,
    ]);
  });
  it("OCC02：结构变化重读一次；持续变化不写部分结果", async () => {
    let calls = 0;
    const readPage = vi.fn(async () => page([input(1), answer(2)], false, ++calls));
    const writeText = vi.fn(async () => {});
    await expect(
      copyConversationMarkdown({ title: "变化中", labels, readPage, writeText }),
    ).rejects.toMatchObject({ code: "changed" });
    expect(readPage).toHaveBeenCalledTimes(4);
    expect(writeText).not.toHaveBeenCalled();
  });
  it("OCC02：跨纪元、重复游标和读取错误均不能返回部分成功", async () => {
    const readPage = vi
      .fn()
      .mockResolvedValueOnce(page([input(2)], true))
      .mockResolvedValueOnce(page([input(1)], false, 1, "new"))
      .mockRejectedValueOnce(new Error("offline"));
    await expect(loadConversationMarkdown({ title: "历史", labels, readPage })).rejects.toThrow(
      "offline",
    );
    await expect(
      loadConversationMarkdown({
        title: "重复",
        labels,
        readPage: async () => page([input(2)], true),
      }),
    ).rejects.toMatchObject({ code: "invalid-page" });
  });
  it("OCC02：较早的迟到结果不覆盖新复制意图", async () => {
    let release!: (result: V4ConversationRowsRangeResult) => void;
    const held = new Promise<V4ConversationRowsRangeResult>((resolve) => {
      release = resolve;
    });
    const writes: string[] = [];
    const writeText = async (text: string) => {
      writes.push(text);
    };
    const old = copyConversationMarkdown({
      title: "旧目标",
      labels,
      readPage: () => held,
      writeText,
    });
    expect(
      await copyConversationMarkdown({
        title: "新目标",
        labels,
        readPage: async () => page([input(1), answer(2)]),
        writeText,
      }),
    ).toBe("copied");
    release(page([input(1), answer(2)]));
    expect(await old).toBe("superseded");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("# 新目标");
  });
  it("OCC01：可见计划正文沿用现有解析，重复计划不输出两次", () => {
    const plan = "# 计划\n\n1. 检查\n2. 修改";
    const tool = {
      rowId: 2,
      turnId: "turn",
      createdAt: 2,
      createdAtSeq: 2,
      kind: "toolCall",
      toolCallId: "plan",
      toolName: "ExitPlanMode",
      status: "success",
      input: { plan },
      inputText: "",
      output: { kind: "text", text: "" },
    } as ConversationRow;
    const text = formatConversationMarkdown([input(1), tool, answer(3, plan)], {
      title: "计划",
      labels,
    });
    expect(text.split(plan)).toHaveLength(2);
  });
});
