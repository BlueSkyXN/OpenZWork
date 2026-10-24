import { createDefaultSystemPromptSettings, systemPromptSettingsSchema } from "./contract.js";
export const concisePromptExample = systemPromptSettingsSchema.parse({
  ...createDefaultSystemPromptSettings(),
  sections: { communication: { mode: "append", content: "先说明结果，再解释必要细节。" } },
});
