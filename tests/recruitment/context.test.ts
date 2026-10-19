import assert from "node:assert/strict";
import test from "node:test";
import { buildRecruitmentContext, projectRecruitmentHistory } from "../../src/recruitment/context.js";

test("buildRecruitmentContext returns the complete staged request and a privacy-safe token manifest", () => {
  const context = buildRecruitmentContext({
    stage: "conclude",
    systemInstructions: "固定规则",
    payload: { brief: { positions: ["CB"] }, history: [{ role: "user", content: "为巴萨找后卫" }] },
    responseSchema: { type: "object", required: ["action"] },
    outputBudgetTokens: 1_024,
    contextWindowTokens: 16_384,
  });

  assert.equal(context.messages[0]?.content, "固定规则");
  assert.match(context.messages[1]?.content ?? "", /\"positions\":\[\"CB\"\]/);
  assert.ok(context.manifest.estimatedInputTokens > 0);
  assert.equal(context.manifest.outputBudgetTokens, 1_024);
  assert.equal(context.manifest.contextWindowTokens, 16_384);
  assert.equal(context.manifest.status, "within_budget");
  assert.doesNotMatch(JSON.stringify(context.manifest), /巴萨|后卫|brief/);
});

test("buildRecruitmentContext reports an over-budget request without silently trimming required facts", () => {
  const payload = { hardRequirement: "中卫".repeat(80) };
  const context = buildRecruitmentContext({
    stage: "investigate",
    systemInstructions: "固定规则",
    payload,
    responseSchema: { type: "object" },
    outputBudgetTokens: 64,
    contextWindowTokens: 128,
    safetyMarginTokens: 16,
  });

  assert.equal(context.manifest.status, "over_budget");
  assert.match(context.messages[1]?.content ?? "", /中卫/);
});

test("projectRecruitmentHistory retains recent dialogue, questions and user quotes outside the recent window", () => {
  const history = [
    { role: "user" as const, content: "为拜仁寻找凯恩的替代者，重点看能做球的前锋" },
    { role: "tool" as const, toolName: "search_candidates", content: "large old result" },
    { role: "assistant" as const, content: JSON.stringify({ action: "ask_user", question: "预算是多少？" }) },
    { role: "user" as const, content: "预算 5000 万以内" },
    { role: "assistant" as const, content: JSON.stringify({ action: "search_candidates" }) },
    { role: "tool" as const, toolName: "search_candidates", content: "new result" },
    { role: "user" as const, content: "只考虑 25 岁以下" },
  ];

  const projection = projectRecruitmentHistory(history, {
    recentUserTurns: 2,
    protectedQuotes: ["为拜仁寻找凯恩的替代者"],
  });

  assert.deepEqual(projection.entries.map((entry) => entry.content), [
    history[0]!.content,
    history[2]!.content,
    history[3]!.content,
    history[4]!.content,
    history[5]!.content,
    history[6]!.content,
  ]);
  assert.equal(projection.manifest.omittedEntryCount, 1);
  assert.equal(projection.manifest.protectedQuoteCount, 1);
});
