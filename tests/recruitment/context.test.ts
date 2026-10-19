import assert from "node:assert/strict";
import test from "node:test";
import { buildRecruitmentContext, projectRecentRecruitmentDialogue, projectRecruitmentHistory, selectTransmittedHistoryEventIds, withContextModelUsage } from "../../src/recruitment/context.js";
import { validateRecruitmentBrief, type RecruitmentBrief } from "../../src/recruitment/brief.js";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import { roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

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
  assert.equal(context.manifest.version, 3);
  assert.equal(context.manifest.budgetStrategy, "assembled");
  assert.doesNotMatch(JSON.stringify(context.manifest), /巴萨|后卫|brief/);
  assert.match(context.manifest.promptFingerprint, /^[a-f0-9]{16}$/);
  assert.match(context.manifest.schemaFingerprint, /^[a-f0-9]{16}$/);
  assert.match(context.manifest.payloadFingerprint, /^[a-f0-9]{16}$/);
  assert.equal(context.manifest.componentBytes.system + context.manifest.componentBytes.payload + context.manifest.componentBytes.schema + context.manifest.componentBytes.framing, context.manifest.requestBytes);
  assert.deepEqual(context.manifest.evidenceRefs, []);
});

test("context manifest records when the conclusion-specific budget fallback was selected", () => {
  const context = buildRecruitmentContext({
    stage: "conclude",
    systemInstructions: "fixed",
    payload: { history: [{ role: "user", content: "current request" }] },
    responseSchema: {},
    outputBudgetTokens: 32,
    budgetStrategy: "conclusion_history_reduced",
  });

  assert.equal(context.manifest.budgetStrategy, "conclusion_history_reduced");
});

test("buildRecruitmentContext records case revision and evidence references without retaining request text", () => {
  const context = buildRecruitmentContext({
    stage: "conclude",
    systemInstructions: "fixed instructions",
    payload: { request: "private user text", evidence: [{ ref: "ev.0123456789ab.abcdef012345.player_report.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb" }] },
    responseSchema: { type: "object" },
    outputBudgetTokens: 64,
    contextRevision: "case-1:brief-v2",
  });
  assert.match(context.manifest.caseRevisionFingerprint ?? "", /^[a-f0-9]{16}$/);
  assert.deepEqual(context.manifest.evidenceRefs, ["ev.0123456789ab.abcdef012345.player_report.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb"]);
  assert.doesNotMatch(JSON.stringify(context.manifest), /private user text|fixed instructions|case-1/);
});

test("context manifests discover metric evidence refs embedded in candidate rows", () => {
  const ref = "ev.0123456789ab.abcdef012345.player_metrics.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb";
  const context = buildRecruitmentContext({
    stage: "conclude",
    systemInstructions: "fixed",
    payload: { candidateEvidence: { candidates: [{ playerId: "candidate-a", metricEvidenceRef: ref }] } },
    responseSchema: {},
    outputBudgetTokens: 64,
  });
  assert.deepEqual(context.manifest.evidenceRefs, [ref]);
});

test("context manifests count only the verified historical excerpts present in a case summary", () => {
  const excerptEventId = "evt.0123456789abcdef.user.1";
  const omittedEventId = "evt.0123456789abcdef.user.2";
  const context = buildRecruitmentContext({
    stage: "investigate",
    systemInstructions: "rules",
    payload: { history: [{ role: "tool", toolName: "case_summary", content: {
      claimEventIds: [excerptEventId],
      coveredEventIds: [excerptEventId, omittedEventId],
    } }] },
    responseSchema: {},
    outputBudgetTokens: 10,
    omittedHistoryEventIds: [omittedEventId],
  });

  assert.deepEqual(context.manifest.includedHistoryEventIds, [excerptEventId]);
  assert.deepEqual(context.manifest.omittedHistoryEventIds, [omittedEventId]);
});

test("context manifests distinguish provider-reported token usage from missing usage", () => {
  const context = buildRecruitmentContext({
    stage: "investigate", systemInstructions: "rules", payload: {}, responseSchema: {}, outputBudgetTokens: 10,
  });
  assert.deepEqual(withContextModelUsage(context.manifest, { inputTokens: 8, outputTokens: 3, totalTokens: 11 }).actualTokenUsage, {
    status: "reported", inputTokens: 8, outputTokens: 3, totalTokens: 11,
  });
  assert.deepEqual(withContextModelUsage(context.manifest, { inputTokens: 8 }).actualTokenUsage, {
    status: "partial", inputTokens: 8, outputTokens: null, totalTokens: null,
  });
  assert.deepEqual(withContextModelUsage(context.manifest, {}).actualTokenUsage, {
    status: "unavailable", inputTokens: null, outputTokens: null, totalTokens: null,
  });
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

test("projected history uses stable case-scoped event IDs and binds protected quotes to their source turn", () => {
  const history = [
    { role: "user" as const, content: "为拜仁找凯恩替代者" },
    { role: "assistant" as const, content: JSON.stringify({ action: "ask_user", question: "年龄上限？" }) },
    { role: "user" as const, content: "25 岁以下" },
    { role: "user" as const, content: "保留凯恩替代者的做球要求" },
    { role: "user" as const, content: "继续调查" },
  ];
  const first = projectRecruitmentHistory(history, { caseId: "case-a", recentUserTurns: 2, protectedQuotes: ["为拜仁找凯恩替代者"] });
  const repeated = projectRecruitmentHistory(history, { caseId: "case-a", recentUserTurns: 2, protectedQuotes: ["为拜仁找凯恩替代者"] });
  const otherCase = projectRecruitmentHistory(history, { caseId: "case-b", recentUserTurns: 2, protectedQuotes: ["为拜仁找凯恩替代者"] });

  assert.deepEqual(first.entries.map(entry => entry.eventId), repeated.entries.map(entry => entry.eventId));
  assert.notDeepEqual(first.entries.map(entry => entry.eventId), otherCase.entries.map(entry => entry.eventId));
  assert.ok(first.manifest.protectedQuoteReferences[0]?.eventId);
  assert.equal(first.manifest.protectedQuoteReferences[0]?.quote, "为拜仁找凯恩替代者");
  assert.ok(first.manifest.omittedEventIds.length > 0);
});

test("recent dialogue excludes old quote-protected turns while keeping questions attached to recent answers", () => {
  const history = projectRecruitmentHistory([
    { role: "user", content: "早期原话" },
    { role: "assistant", content: JSON.stringify({ action: "ask_user", question: "早期问题？" }) },
    { role: "user", content: "早期回答" },
    { role: "user", content: "近期需求" },
    { role: "assistant", content: JSON.stringify({ action: "ask_user", question: "预算是多少？" }) },
    { role: "user", content: "预算 5000 万以内" },
    { role: "user", content: "更看重向前传球" },
  ], { recentUserTurns: 3, protectedQuotes: ["早期原话"] });

  const dialogue = projectRecentRecruitmentDialogue(history.entries, 3);
  assert.deepEqual(dialogue.map(({ role, content }) => ({ role, content })), [
    { role: "user", content: "近期需求" },
    { role: "assistant", content: "预算是多少？" },
    { role: "user", content: "预算 5000 万以内" },
  ]);
});

test("history manifest follows the actual requirement-understanding payload", () => {
  const oldQuoteId = "evt.0123456789abcdef.user.1";
  const oldQuestionId = "evt.0123456789abcdef.question.1.1";
  const recentUserId = "evt.0123456789abcdef.user.4";
  const recentQuestionId = "evt.0123456789abcdef.question.4.1";
  const currentMessageId = "evt.0123456789abcdef.user.5";
  const retainedEventIds = [oldQuoteId, oldQuestionId, recentUserId, recentQuestionId, currentMessageId];

  assert.deepEqual(selectTransmittedHistoryEventIds({
    retainedEventIds,
    projectedDialogueEventIds: [recentUserId, recentQuestionId],
    protectedQuoteEventIds: [oldQuoteId],
    currentMessageEventId: currentMessageId,
  }), [oldQuoteId, recentUserId, recentQuestionId, currentMessageId]);
  assert.deepEqual(selectTransmittedHistoryEventIds({
    retainedEventIds,
    legacyUserEventIds: [oldQuoteId, recentUserId],
    currentMessageEventId: currentMessageId,
    clarificationQuestionEventId: recentQuestionId,
  }), [oldQuoteId, recentUserId, recentQuestionId, currentMessageId]);
});

test("understanding preserves clarification context and reports only the history actually sent in each arm", async () => {
  const candidate = roleConstraintPlayer("clarification-context-player", "Clarification Context Player", "CM");
  const baseBrief: RecruitmentBrief = {
    task: "reinforcement",
    targetTeam: { value: "巴萨", basis: "explicit", quote: "巴萨" },
    referencePlayer: null,
    referenceClues: [],
    referenceRecheck: null,
    selectedCandidateId: null,
    positions: ["MID"],
    allowsAnyPosition: false,
    filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null },
    priorities: [],
    constraints: [],
    unresolved: [],
  };
  const interpretations: Array<{
    message: string;
    recentMessages: readonly string[];
    validationMessages?: readonly string[];
    clarificationQuestion?: string;
    recentDialogue?: readonly { role: "user" | "assistant"; content: string; eventId?: string }[];
    includedHistoryEventIds?: readonly string[];
    omittedHistoryEventIds?: readonly string[];
  }> = [];
  for (const mode of ["legacy", "projection"] as const) {
    const conversation = createRecruitmentConversation({
      experimentalContextManagementMode: mode,
      experimentalDeterministicSearchMode: "enabled",
      experimentalRetrievalMode: "on_demand",
      briefInterpreter: { async interpret(input) {
        interpretations.push({ message: input.message, recentMessages: input.recentMessages, validationMessages: input.validationMessages,
          clarificationQuestion: input.clarificationQuestion, recentDialogue: input.recentDialogue,
          includedHistoryEventIds: input.includedHistoryEventIds, omittedHistoryEventIds: input.omittedHistoryEventIds });
        return validateRecruitmentBrief(input.previous ?? baseBrief, input.validationMessages ?? [...input.recentMessages, input.message]);
      } },
      repository: {
        mode: "demo",
        sourceName: "Fixture",
        async loadPlayers() { return [candidate]; },
        async searchCandidates(query) {
          return { players: [candidate], totalRecords: 1, nextOffset: null, offset: query.offset, appliedFilters: ["position"] };
        },
      },
      knowledgeBase: { async search() { return []; } },
      planner: { async decide(input) {
        const progress = input.caseProgress as { toolUses?: Record<string, number> } | undefined;
        if (!progress?.toolUses?.search_methodology) return { action: "search_methodology", query: "中场推进能力的可观察指标" };
        if (!progress?.toolUses?.search_candidates) return { action: "search_candidates", position: "MID", minimumMinutes: 0, limit: 10 };
        if (!progress?.toolUses?.search_player_reports) return { action: "search_player_reports", query: "中场比赛观察", playerNames: [candidate.name] };
        const answered = input.history.some(entry => entry.role === "user" && entry.content.includes("向前传球"));
        if (!answered) return { action: "ask_user", question: "你更看重向前传球还是持球推进？", reason: "这会改变中场候选人的职责优先级。" };
        return {
          action: "finish",
          targetTeam: "巴萨",
          needSummary: "寻找符合已确认职责的中场候选人。",
          capabilityProfile: ["推进"],
          recommendations: [{ playerId: candidate.playerId, evidenceKeys: ["goals"] }],
          limitationKeys: [],
        };
      } },
    });

    const threadId = `clarification-dialogue-${mode}`;
    const first = await conversation.turn({ threadId, message: "为巴萨找一名中场" });
    assert.equal(first.status, "needs_input", `${mode}: ${first.message}`);
    assert.match(first.message, /向前传球还是持球推进/);

    const second = await conversation.turn({ threadId, message: "更看重向前传球", expectsExistingState: true });
    assert.equal(second.status, "completed", `${mode}: ${second.message}`);
    // Select the latest captured resumed turn, after the first mode has completed.
    const modeInterpretation = interpretations.filter(item => item.message === "更看重向前传球").at(-1);
    assert.ok(modeInterpretation);
    assert.deepEqual(modeInterpretation.validationMessages, ["为巴萨找一名中场", "更看重向前传球"],
      "the immutable user archive remains separate from the model-facing projection for quote validation");
    if (mode === "projection") {
      assert.deepEqual(modeInterpretation.recentDialogue?.map(({ role, content }) => ({ role, content })), [
        { role: "user", content: "为巴萨找一名中场" },
        { role: "assistant", content: "你更看重向前传球还是持球推进？" },
      ]);
      assert.ok(modeInterpretation.includedHistoryEventIds?.some(id => id.includes(".question.")));
    } else {
      assert.equal(modeInterpretation.recentDialogue, undefined);
      assert.equal(modeInterpretation.clarificationQuestion, "你更看重向前传球还是持球推进？");
      assert.ok(modeInterpretation.includedHistoryEventIds?.some(id => id.includes(".question.")),
        "the legacy arm sends the actual Planner question in its dedicated clarification field");
      assert.equal(modeInterpretation.omittedHistoryEventIds?.some(id => id.includes(".question.")), false,
        "the manifest must not call a separately transmitted clarification question omitted");
    }
  }
});
