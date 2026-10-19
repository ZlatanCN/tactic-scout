import assert from "node:assert/strict";
import test from "node:test";
import { caseSummaryEvents, caseSummaryHistoryEntry, createCaseSummaryGenerator, validateCaseSummaryOutput, type CaseSummaryEvent } from "../../src/recruitment/case-summary.js";
import { createRecruitmentConversation, type RecruitmentAction, type RecruitmentPlanner } from "../../src/recruitment/conversation.js";
import { validateRecruitmentBrief, type RecruitmentBrief } from "../../src/recruitment/brief.js";
import { roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

test("caseSummaryEvents assigns stable case-scoped IDs to old user turns and clarification questions", () => {
  const history = [
    { role: "user" as const, content: "为拜仁找凯恩替代者" },
    { role: "assistant" as const, content: JSON.stringify({ action: "ask_user", question: "年龄上限？" }) },
    { role: "user" as const, content: "25 岁以下" },
    { role: "tool" as const, toolName: "evaluate_candidates", content: "should not summarize evidence" },
    { role: "user" as const, content: "改成 23 岁以下" },
    { role: "user" as const, content: "只看德甲" },
    { role: "user" as const, content: "再年轻一点" },
  ];

  const options = { caseId: "case-42", coveredUserTurnCount: 0, throughUserTurnCount: 3 };
  const events = caseSummaryEvents(history, options);
  assert.deepEqual(events.map(({ kind, text }) => ({ kind, text })), [
    { kind: "user_message", text: "为拜仁找凯恩替代者" },
    { kind: "clarification_question", text: "年龄上限？" },
    { kind: "user_message", text: "25 岁以下" },
    { kind: "user_message", text: "改成 23 岁以下" },
  ]);
  assert.deepEqual(events.map(event => event.id), caseSummaryEvents(history, options).map(event => event.id));
  assert.match(events[0]!.id, /^evt\.[a-f0-9]{16}\.user\.1$/);
  assert.notEqual(events[0]!.id, caseSummaryEvents(history, { ...options, caseId: "another-case" })[0]!.id);
});

test("summary validation accepts only exact source quotes and requires the complete event ledger", () => {
  const events: CaseSummaryEvent[] = [
    { id: "evt.0123456789abcdef.user.1", kind: "user_message", text: "用户提出的完整原话" },
    { id: "evt.0123456789abcdef.question.1.1", kind: "clarification_question", text: "需要补充的预算上限是多少？" },
  ];
  const result = validateCaseSummaryOutput({
    claims: [
      { eventId: events[0]!.id, quote: "完整原话" },
      { eventId: events[1]!.id, quote: "预算上限是多少？" },
    ],
    coveredEventIds: events.map(event => event.id),
  }, events);
  assert.deepEqual(result, {
    claims: [
      { eventId: events[0]!.id, kind: "user_message", quote: "完整原话" },
      { eventId: events[1]!.id, kind: "clarification_question", quote: "预算上限是多少？" },
    ],
    coveredEventIds: events.map(event => event.id),
    text: `用户原话（${events[0]!.id}）：「完整原话」\n曾提出的问题（${events[1]!.id}）：「预算上限是多少？」`,
  });
  assert.throws(() => validateCaseSummaryOutput({
    claims: [{ eventId: events[0]!.id, quote: "用户希望预算低于两千万" }],
    coveredEventIds: events.map(event => event.id),
  }, events), /原文摘录/);
  assert.throws(() => validateCaseSummaryOutput({
    claims: [{ eventId: "evt.ffffffffffffffff.user.1", quote: "完整原话" }],
    coveredEventIds: events.map(event => event.id),
  }, events), /未知事件/);
  assert.throws(() => validateCaseSummaryOutput({
    claims: [{ eventId: events[0]!.id, quote: "完整原话" }],
    coveredEventIds: [events[0]!.id],
  }, events), /全部事件/);
  assert.throws(() => validateCaseSummaryOutput({
    claims: [{ eventId: events[0]!.id, quote: "x".repeat(2_001) }],
    coveredEventIds: events.map(event => event.id),
  }, events), /2000|Too big/);
  assert.throws(() => validateCaseSummaryOutput({
    claims: [
      { eventId: events[1]!.id, quote: "预算上限是多少？" },
      { eventId: events[0]!.id, quote: "完整原话" },
    ],
    coveredEventIds: events.map(event => event.id),
  }, events), /按原文事件顺序/);
});

test("case summary stays within its existing cap and records the matching context budget", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_STRUCTURED_OUTPUT_METHOD", "OPENAI_MAX_OUTPUT_TOKENS", "OPENAI_EXPANSION_MAX_OUTPUT_TOKENS"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const event = { id: "evt.0123456789abcdef.user.1", kind: "user_message" as const, text: "为巴萨找中卫" };
  let requestBody: { max_tokens?: number } | undefined;
  let manifest: { outputBudgetTokens?: number } | undefined;
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "8192";
  process.env.OPENAI_EXPANSION_MAX_OUTPUT_TOKENS = "768";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
    return Response.json({
      id: "fixture", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        claims: [{ eventId: event.id, quote: "为巴萨找中卫" }], coveredEventIds: [event.id],
      }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    });
  }) as typeof fetch;
  try {
    const summary = await createCaseSummaryGenerator().summarize({
      events: [event],
      onUsage: usage => { manifest = usage.contextManifest as unknown as typeof manifest; },
    });
    assert.equal(summary.claims[0]?.quote, event.text);
    assert.equal(requestBody?.max_tokens, 768);
    assert.equal(manifest?.outputBudgetTokens, requestBody?.max_tokens);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("planner-facing case summaries omit the growing audit ledger but retain cited event IDs", () => {
  const claimEventId = "evt.0123456789abcdef.user.1";
  const entry = caseSummaryHistoryEntry({
    version: 2,
    text: `用户原话（${claimEventId}）：「为巴萨找中卫」`,
    claims: [{ eventId: claimEventId, kind: "user_message", quote: "为巴萨找中卫" }],
    coveredUserTurnCount: 4_000,
  });
  const payload = JSON.parse(entry.content);

  assert.deepEqual(payload.claimEventIds, [claimEventId]);
  assert.equal("coveredEventIds" in payload, false);
  assert.ok(entry.content.length < 1_000);
});

test("the legacy context arm keeps full prior user history while unified mode applies the recent-turn window", async () => {
  const candidate = roleConstraintPlayer("context-mode-candidate", "Context Mode Candidate", "CB");
  const brief: RecruitmentBrief = {
    task: "reinforcement", targetTeam: null, referencePlayer: null, referenceClues: [], referenceRecheck: null,
    selectedCandidateId: null, positions: ["CB"], allowsAnyPosition: false,
    filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null },
    priorities: [], constraints: [], unresolved: [],
  };
  const previousMessageCounts: Record<"legacy" | "projection" | "evidence" | "unified", number[]> = {
    legacy: [], projection: [], evidence: [], unified: [],
  };
  for (const mode of ["legacy", "projection", "evidence", "unified"] as const) {
    const conversation = createRecruitmentConversation({
      briefInterpreter: { async interpret(input) {
        previousMessageCounts[mode].push(input.recentMessages.length);
        return validateRecruitmentBrief(brief, input.validationMessages ?? [...input.recentMessages, input.message]);
      } },
      repository: {
        mode: "demo", sourceName: "Fixture",
        async loadPlayers() { return [candidate]; },
        async searchCandidates(query) {
          return { players: [candidate], totalRecords: 1, nextOffset: null, offset: query.offset, appliedFilters: ["position"] };
        },
      },
      planner: { async decide() {
        return { action: "finish", targetTeam: null, needSummary: "按当前需求完成调查", capabilityProfile: [], recommendations: [], limitationKeys: [] };
      } },
      experimentalDeterministicSearchMode: "enabled",
      experimentalContextManagementMode: mode,
      knowledgeBase: { async search() { return []; } },
    });
    for (let turn = 0; turn < 5; turn += 1) {
      const response = await conversation.turn({
        threadId: `context-mode-${mode}`,
        message: turn === 0 ? "为巴萨找一名中卫" : `继续调查第 ${turn + 1} 轮`,
        ...(turn > 0 ? { expectsExistingState: true } : {}),
      });
      assert.equal(response.status, "completed", `${mode}, turn ${turn + 1}: ${response.message}`);
    }
  }
  assert.equal(previousMessageCounts.legacy.at(-1), 4);
  assert.equal(previousMessageCounts.evidence.at(-1), 4);
  assert.equal(previousMessageCounts.projection.at(-1), 3);
  assert.equal(previousMessageCounts.unified.at(-1), 3);
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
      return {
        claims: input.events.map(event => ({ eventId: event.id, quote: event.text.slice(0, 32) })),
        coveredEventIds: input.events.map(event => event.id),
      };
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
  const summaryPlannerCall = plannerCalls.find(call => call.history.some(entry => entry.role === "tool" && entry.toolName === "case_summary"));
  assert.ok(summaryPlannerCall, "the Planner should receive the verified navigation summary");
  const summaryEntry = summaryPlannerCall.history.find(entry => entry.role === "tool" && entry.toolName === "case_summary")!;
  const summaryPayload = JSON.parse(summaryEntry.content) as { claimEventIds: string[] };
  assert.ok(summaryPayload.claimEventIds.length > 0);
  assert.ok(summaryPayload.claimEventIds.every(id => !summaryPlannerCall.omittedHistoryEventIds?.includes(id)),
    "events represented by verified excerpts are not reported as omitted from the request");
  assert.equal(response.brief?.positions[0], "CB");
  assert.ok(response.report?.recommendations.some(item => item.player.playerId === candidate.playerId));
});
