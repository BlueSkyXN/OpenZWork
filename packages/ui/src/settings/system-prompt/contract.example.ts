import type { SystemPromptEditorProps } from "./contract.js";
export const promptEditorExample: Pick<SystemPromptEditorProps, "settings" | "catalog"> = {
  settings: null,
  catalog: {
    version: 2,
    sections: [
      {
        id: "role",
        content: "Example role",
        generated: false,
        runtime: false,
        scenarios: [],
        injectionTarget: "system",
      },
    ],
  },
};
