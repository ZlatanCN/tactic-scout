import assert from "node:assert/strict";
import test from "node:test";
import { summarizeModelUsage } from "../../src/evaluation/local-agent-run.js";

test("whole-agent cost includes name recall and brief understanding without manufacturing missing token counts", () => {
  const usage = summarizeModelUsage([
    { phase: "brief_usage", outcome: "response", elapsedMs: 1, inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    { phase: "identity_usage", outcome: "response", elapsedMs: 1, inputTokens: 20, outputTokens: 3, totalTokens: 23 },
  ]);
  assert.equal(usage.requestCount, 2);
  assert.equal(usage.totalTokens.total, 38);
  const partial = summarizeModelUsage([
    { phase: "identity_usage", outcome: "failed", elapsedMs: 1 },
    { phase: "brief_usage", outcome: "response", elapsedMs: 1, totalTokens: 15 },
  ]);
  assert.equal(partial.failedRequestCount, 1);
  assert.equal(partial.totalTokens.status, "partial");
  assert.equal(partial.totalTokens.total, null);
});
