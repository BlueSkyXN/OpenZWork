export * from "./contract.js";
// builder 消费底层 contract；完整预览由上层入口导出，避免经 contract 反向引入 builder。
export {
  buildSystemPromptPreview,
  SystemPromptObservation,
  SYSTEM_PROMPT_OBSERVED_SOURCES,
} from "./preview.js";
