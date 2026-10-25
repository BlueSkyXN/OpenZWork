import { expect, it } from "vitest";
import { getSystemPromptCatalog } from "./contract.js";
it("provides unique chapter identities", () => {
  const catalog = getSystemPromptCatalog();
  expect(new Set(catalog.sections.map((entry) => entry.id)).size).toBe(catalog.sections.length);
});
