import type { ConversationRowsReader } from "./contract.js";
import { copyConversationMarkdown } from "./index.js";

/** readPage 由调用方绑定现有服务与精确目标；示例本身不查询真实会话。 */
export function exampleConversationExport(
  readPage: ConversationRowsReader,
  writeText: (text: string) => Promise<void>,
) {
  return copyConversationMarkdown({
    title: "示例对话",
    labels: { user: "用户", assistant: "助手", attachment: "附件" },
    readPage,
    writeText,
  });
}
