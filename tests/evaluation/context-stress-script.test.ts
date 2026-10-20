import assert from "node:assert/strict";
import test from "node:test";
import { contextStressFollowUps } from "../../src/evaluation/local-agent-run.js";
import { localAgentEvaluationScenarios } from "../../src/evaluation/harness-scenarios.js";
import { estimateRecruitmentInputTokens } from "../../src/recruitment/context.js";
import { caseSummaryEvents } from "../../src/recruitment/case-summary.js";

test("context stress follow-ups preserve the full original request while varying the follow-up", () => {
  assert.equal(contextStressFollowUps.length, 20);
  assert.equal(new Set(contextStressFollowUps).size, 20);
  assert.ok(contextStressFollowUps.every(message => message.startsWith("保持最初完整需求和全部筛选条件，不增不减。 ")));
});

test("the context stress scenario accumulates enough old dialogue to exercise the summary path", () => {
  const scenario = localAgentEvaluationScenarios.find(({ id }) => id === "barcelona-under-23-midfielder");
  assert.ok(scenario);
  const history = [scenario.message, ...contextStressFollowUps.slice(0, 16)]
    .map(content => ({ role: "user" as const, content }));
  const events = caseSummaryEvents(history, {
    caseId: "context-stress-summary-trigger",
    coveredUserTurnCount: 0,
    throughUserTurnCount: history.length,
  });

  assert.ok(events.length > 0);
  assert.ok(estimateRecruitmentInputTokens(JSON.stringify({ events })) > 2_048,
    "the summarized arm must receive enough aged user dialogue to exercise its summary generator when projection remains over budget");
});
