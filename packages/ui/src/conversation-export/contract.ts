import type {
  ConversationRow,
  V4ConversationRowsRangeResult,
} from "@zcode/shared/zcode-protocol-v4";

export interface ConversationExportLabels {
  user: string;
  assistant: string;
  attachment: string;
}
export interface ConversationExportOptions {
  title: string;
  labels: ConversationExportLabels;
}
/** 调用方捕获精确 workspace/session/service；查询不建立订阅或发送执行命令。 */
export type ConversationRowsReader = (params: {
  beforeRowId?: number;
  limit: number;
}) => Promise<V4ConversationRowsRangeResult>;
export interface ConversationExportRequest extends ConversationExportOptions {
  readPage: ConversationRowsReader;
}
export interface ConversationCopyRequest extends ConversationExportRequest {
  writeText(text: string): Promise<void>;
  /** 支持 Promise ClipboardItem 的浏览器在点击栈内提交，保留移动端用户激活。 */
  writeDeferredText?(text: Promise<string>): Promise<void>;
}
export type ConversationCopyResult = "copied" | "superseded";
export type { ConversationRow };
