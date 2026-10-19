import assert from "node:assert/strict";
import test from "node:test";
import { caseSummaryEvents, validateCaseSummaryOutput, type CaseSummaryEvent } from "../../src/recruitment/case-summary.js";
import { createRecruitmentConversation, type RecruitmentAction, type RecruitmentPlanner } from "../../src/recruitment/conversation.js";
import { validateRecruitmentBrief, type RecruitmentBrief } from "../../src/recruitment/brief.js";
import { roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

test("caseSummaryEvents selects only turns before the recent window and keeps paired clarification questions", () => {
  const history = [
    { role: "user" as const, content: "为拜仁找凯恩替代者" },
    { role: "assistant" as const, content: JSON.stringify({ action: "ask_user", question: "年龄上限？" }) },
    { role: "user" as const, content: "25 岁以下" },
    { role: "tool" as const, toolName: "evaluate_candidates", content: "should not summarize evidence" },
    { role: "user" as const, content: "改成 23 岁以下" },
    { role: "user" as const, content: "只看德甲" },
    { role: "user" as const, content: "再年轻一点" },
  ];

  assert.deepEqual(caseSummaryEvents(history, { coveredUserTurnCount: 0, throughUserTurnCount: 3 }), [
    { id: "user-1", kind: "user_message", text: "为拜仁找凯恩替代者" },
    { id: "assistant-after-user-1-1", kind: "clarification_question", text: "年龄上限？" },
    { id: "user-2", kind: "user_message", text: "25 岁以下" },
    { id: "user-3", kind: "user_message", text: "改成 23 岁以下" },
  ]);
});

test("summary validation requires a complete event-ID ledger and bounds navigation text", () => {
  const events: CaseSummaryEvent[] = [
    { id: "user-1", kind: "user_message", text: "原话" },
    { id: "assistant-after-user-1", kind: "clarification_question", text: "问题" },
  ];
  assert.deepEqual(validateCaseSummaryOutput({ summary: "用户补充过范围；当前条件以结构化需求为准。", coveredEventIds: events.map(event => event.id) }, events), {
    summary: "用户补充过范围；当前条件以结构化需求为准。",
    coveredEventIds: events.map(event => event.id),
  });
  assert.throws(() => validateCaseSummaryOutput({ summary: "遗漏", coveredEventIds: ["user-1"] }, events), /全部事件/);
  assert.throws(() => validateCaseSummaryOutput({ summary: "x".repeat(2_001), coveredEventIds: events.map(event => event.id) }, events), /2000|Too big/);
});

test("the full LangGraph retains the authoritative case while summarized mode resumes from a validated navigation summary", async () => {
  const candidate = roleConstraintPlayer("context-summary-candidate", "Context Summary Candidate", "CB");
  const brief: RecruitmentBrief = {
    task: "reinforcement", targetTeam: null, referencePlayer: null, referenceClues: [], referenceRecheck: null,
    selectedCandidateId: null, positions: ["CB"], allowsAnyPosition: false,
    filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null },
    priorities: [], constraints: [], unresolved: [],
  };
  const fakeSummaryGenerator = {
    calls: [] as CaseSummaryEvent[][],
    async summarize(input: { events: readonly CaseSummaryEvent[] }) {
      this.calls.push([...input.events]);
      return { summary: "用户要求继续原定调查；当前需求仍由结构化条件决定。", coveredEventIds: input.events.map(event => event.id) };
    },
  };
  const plannerCalls: Array<Parameters<RecruitmentPlanner["decide"]>[0]> = [];
  const finish = (): RecruitmentAction => ({
    action: "finish", targetTeam: null, needSummary: "按当前需求完成调查", capabilityProfile: [],
    recommendations: [{ playerId: candidate.playerId, evidenceKeys: ["tacklesInterceptions"] }], limitationKeys: [],
  });
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret(input) {
      return validateRecruitmentBrief(brief, input.validationMessages ?? [...input.recentMessages, input.message]);
    } },
    repository: {
      mode: "demo", sourceName: "Fixture",
      async loadPlayers() { return [candidate]; },
      async searchCandidates(query) {
        return { players: [candidate], totalRecords: 1, nextOffset: null, offset: query.offset, appliedFilters: ["position"] };
      },
    },
    planner: { async decide(input) { plannerCalls.push(input); return finish(); } },
    experimentalDeterministicSearchMode: "enabled",
    experimentalRetrievalMode: "on_demand",
    experimentalContextManagementMode: "summarized",
    caseSummaryGenerator: fakeSummaryGenerator,
    knowledgeBase: { async search() { return []; } },
  });

  let response = await conversation.turn({ threadId: "context-summary-flow", message: "为巴萨找一名中卫" });
  assert.equal(response.status, "completed", response.message);
  const longScopeReminder = "继续当前调查。保留已经确认的球队、位置和能力条件，不增加也不删除任何筛选项；继续沿用目前案件和已查看的候选，结论中说明仍然缺少哪些证据。".repeat(8);
  for (let turn = 0; turn < 11; turn += 1) {
    response = await conversation.turn({ threadId: "context-summary-flow", message: longScopeReminder, expectsExistingState: true });
    assert.equal(response.status, "completed", `turn ${turn + 2}: ${response.message}`);
  }

  assert.ok(fakeSummaryGenerator.calls.length > 0, "the summary gate should run after sufficient old dialogue accumulates");
  assert.ok(plannerCalls.some(call => call.history.some(entry => entry.role === "tool" && entry.toolName === "case_summary")));
  assert.equal(response.brief?.positions[0], "CB");
  assert.ok(response.report?.recommendations.some(item => item.player.playerId === candidate.playerId));
});
