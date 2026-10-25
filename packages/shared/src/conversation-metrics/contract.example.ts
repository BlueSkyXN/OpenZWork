import { tokensPerSecond } from "./contract.js";
export const exampleSpeed = tokensPerSecond({
  status: "completed",
  durationMs: 3000,
  timeToFirstContentMs: 1000,
  outputTokens: 100,
});
