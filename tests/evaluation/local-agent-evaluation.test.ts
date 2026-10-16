import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateLocalAgentScenario,
  localAgentEvaluationScenarios,
  privacySafeTraceEvent,
  summarizeEvaluationRuns,
  understatLocalAgentEvaluationScenario,
  type EvaluationProgressEvent,
} from "../../src/evaluation/harness-evaluation.js";
import type { RecruitmentTraceEvent } from "../../src/recruitment/conversation.js";
import { conclusionInstructions } from "../../src/recruitment/conversation.js";
import { type ConversationTurnResponse } from "../../src/domain/conversation.js";
import { type HistoricalArchiveSample } from "../../src/domain/external-evidence.js";

function decision(action: string, targetTeam?: string, options: { policyBlocked?: boolean } = {}): RecruitmentTraceEvent {
  return {
    phase: "decision",
    action,
    elapsedMs: 1,
    ok: true,
    ...(targetTeam ? { targetTeam } : {}),
    ...(options.policyBlocked ? { policyBlocked: true } : {}),
  };
}

function tool(
  toolName: Extract<RecruitmentTraceEvent, { phase: "tool" }> ["toolName"],
  filters: Record<string, string | number | boolean | null | string[]>,
  options: { ok?: boolean; resultCount?: number; matchingRecordCount?: number } = {},
): RecruitmentTraceEvent {
  const resultCount = options.resultCount ?? 1;
  const isCandidateSearch = toolName === "search_candidates";
  const traceFilters = isCandidateSearch
    ? {
      position: null,
      maxAge: null,
      minimumMinutes: 0,
      competition: null,
      season: null,
      offset: 0,
      limit: 10,
      nextOffset: null,
      playerNameFilterUsed: false,
      candidateIds: [],
      ...filters,
    }
    : filters;
  return {
    phase: "tool",
    toolName,
    elapsedMs: 1,
    ok: options.ok ?? true,
    filters: traceFilters,
    resultCount,
    ...(isCandidateSearch ? { matchingRecordCount: options.matchingRecordCount ?? resultCount } : {}),
  };
}

function progressForTurns(turns: Array<{
  turn: number;
  toolStages: EvaluationProgressEvent["stage"][];
  waitingForUser?: boolean;
  completed?: boolean;
}>): EvaluationProgressEvent[] {
  const events: EvaluationProgressEvent[] = [];
  let completedSteps = 0;
  for (const turn of turns) {
    for (const stage of turn.toolStages) {
      events.push({ sequence: events.length + 1, turn: turn.turn, stage, status: "started", message: "开始", completedSteps });
      completedSteps += 1;
      events.push({ sequence: events.length + 1, turn: turn.turn, stage, status: "completed", message: "完成", completedSteps });
    }
    if (turn.waitingForUser) {
      events.push({ sequence: events.length + 1, turn: turn.turn, stage: "asking_user", status: "waiting_for_user", message: "等待补充", completedSteps });
    }
    if (turn.completed) {
      events.push({ sequence: events.length + 1, turn: turn.turn, stage: "completed", status: "completed", message: "报告完成", completedSteps });
    }
  }
  return events;
}

function recommendation(position = "CM") {
  return {
    player: {
      playerId: "player-1",
      name: "Demo Player",
      team: "Harbor City",
      age: 22,
      position,
      competition: "Open League",
      season: "2025/26",
      minutes: 1200,
      stats: {
        goals: 2,
        assists: 1,
        passesAttempted: 200,
        passesCompleted: 160,
        longPasses: 12,
        carries: 30,
        pressures: 100,
        tackles: 8,
        interceptions: 4,
        shotAssists: 9,
      },
      source: "Fixture data",
    },
    rationale: "比赛数据支持继续考察。",
    strengths: ["带球"],
    tradeoffs: [],
    focusEvidenceKeys: ["wyscoutProgressivePassesPer90"],
    evidence: [{
      key: "wyscoutProgressivePassesPer90",
      label: "渐进传球（推算）",
      value: 4.2,
      unit: "次/90分钟",
      peerPercentile: null,
      peerGroupSize: 0,
      peerPercentileUnavailableReason: "insufficient_peer_group",
      minutes: 1200,
      competition: "Open League",
      season: "2025/26",
      source: "Fixture data",
      definition: "Derived from pass start and end locations.",
      normalization: "per90",
      sourceField: "fixture pass coordinates",
    }],
    reportObservations: [],
  };
}

function response(input: {
  threadId: string;
  status?: "needs_input" | "completed";
  targetTeam?: string;
  position?: string;
  needSummary?: string;
  recommendations?: ReturnType<typeof recommendation>[];
  limitations?: string[];
  requestedCapabilityCoverage?: NonNullable<ConversationTurnResponse["report"]>["requestedCapabilityCoverage"];
}): ConversationTurnResponse {
  const status = input.status ?? "completed";
  return {
    threadId: input.threadId,
    status,
    message: status === "needs_input" ? "请明确希望找什么类型的中锋？" : "已完成调查。",
    question: status === "needs_input" ? { reason: "不同职责会改变候选范围。" } : null,
    report: status === "needs_input" ? null : {
      targetTeam: input.targetTeam ?? "Barcelona",
      needSummary: input.needSummary ?? "寻找符合需求的球员。",
      capabilityProfile: ["推进"],
      requestedCapabilityCoverage: input.requestedCapabilityCoverage ?? [
        {
          name: "推进",
          requestedMetricKeys: ["wyscoutProgressivePassesPer90", "wyscoutAccurateProgressivePassesPct", "lineBreakPassesCompletedPer30Tip"],
          observedMetricKeys: ["wyscoutProgressivePassesPer90"],
          evaluatedCandidateCount: 1,
          candidatesWithEvidenceCount: 1,
          status: "observed",
        },
        {
          name: "压迫",
          requestedMetricKeys: ["pressures"],
          observedMetricKeys: [],
          evaluatedCandidateCount: 1,
          candidatesWithEvidenceCount: 0,
          status: "missing",
        },
      ],
      evidenceCoverage: {
        evaluatedCandidateCount: 1,
        availableMetricValues: 1,
        expectedMetricValues: 1,
        lowSampleCandidates: 0,
        limitedPeerGroupCandidates: 1,
      },
      historicalArchiveCoverage: {
        status: "not_run",
        disabledReason: null,
        checkedCandidates: 0,
        mappedCandidates: 0,
        matchedCandidates: 0,
        failedCandidates: 0,
      },
      historicalArchiveCandidates: [],
      knowledgeCoverage: {
        methodologyChunksRetrieved: 1,
        methodologySearchFailed: false,
        playerReportSearchPerformed: true,
        playerReportSearchFailed: false,
        playerReportChunksRetrieved: 0,
      },
      searchScopes: [],
      recommendations: (input.recommendations ?? [recommendation(input.position)]),
      limitations: input.limitations ?? [],
      dataSource: "Fixture data",
      datasetMode: "demo",
    },
  };
}

const shortlistScenario = localAgentEvaluationScenarios.find(({ id }) => id === "barcelona-under-23-midfielder")!;
const clarificationScenario = localAgentEvaluationScenarios.find(({ id }) => id === "bayern-kane-replacement")!;
const oneOnOneScenario = localAgentEvaluationScenarios.find(({ id }) => id === "barcelona-attacking-one-on-one-forward")!;

function bayernCapabilityCoverageFixture() {
  const shared = { observedMetricKeys: [], evaluatedCandidateCount: 1, candidatesWithEvidenceCount: 0, status: "missing" as const };
  return [
    { ...shared, name: "进球产出", requestedMetricKeys: ["goals", "premierLeagueGoalsPer90"] as const },
    { ...shared, name: "创造机会", requestedMetricKeys: ["assists", "shotAssists", "keyPasses", "asaExpectedAssistsPer90", "fplExpectedAssistsPer90", "premierLeagueAssistsPer90", "premierLeagueKeyPassesPer90", "understatExpectedAssistsPer90", "understatKeyPassesPer90"] as const },
    { ...shared, name: "射门终结", requestedMetricKeys: [] as const },
    { ...shared, name: "进攻接应", requestedMetricKeys: [] as const },
  ];
}

const bayernCapabilityGapLimitations = [
  "当前数据没有提供与用户要求的“进球产出”相对应的可观测指标，无法评估该能力。",
  "当前数据没有提供与用户要求的“创造机会”相对应的可观测指标，无法评估该能力。",
  "当前数据没有提供与用户要求的“射门终结”相对应的可观测指标，无法评估该能力。",
  "当前数据没有提供与用户要求的“进攻接应”相对应的可观测指标，无法评估该能力。",
];

test("the evaluation dataset fixes known tasks without claiming a correct player ranking", () => {
  assert.deepEqual(localAgentEvaluationScenarios.map(({ id }) => id), [
    "barcelona-under-23-midfielder",
    "bayern-kane-replacement",
    "barcelona-attacking-one-on-one-forward",
  ]);
  assert.equal(shortlistScenario.kind, "shortlist");
  assert.equal(shortlistScenario.expectedMaxAge, 23);
  assert.equal(shortlistScenario.requireBroadPositionSearch, true);
  assert.deepEqual(shortlistScenario.requiredTools, ["search_methodology", "search_candidates"]);
  assert.equal(clarificationScenario.kind, "clarification-resume");
  assert.equal(clarificationScenario.expectedPosition, "ST");
  assert.deepEqual(clarificationScenario.answers, [
    "延续凯恩的中锋角色，暂不增加年龄或预算限制。",
    "可以扩大到其他前锋位置继续找，重点仍是能接应、做球和终结。",
  ]);
  assert.equal(clarificationScenario.message, "为拜仁寻找凯恩的替代者，重点看能接应、做球和终结的前锋。");
  const oneOnOneScenario = localAgentEvaluationScenarios.find(({ id }) => id === "barcelona-attacking-one-on-one-forward");
  assert.ok(oneOnOneScenario);
  assert.equal(oneOnOneScenario.kind, "shortlist");
  assert.equal(oneOnOneScenario.expectedBroadPosition, "ATT");
  assert.equal(oneOnOneScenario.expectedMaxAge, 23);
  assert.ok(oneOnOneScenario.requestedCapabilities?.some(({ name, metricKeys }) => name === "进攻一对一对抗"
    && metricKeys.includes("wyscoutGroundAttackingDuelsPer90")
    && metricKeys.includes("wyscoutExplicitlyWonGroundAttackingDuelSharePct")));
  assert.ok(oneOnOneScenario.expectedCapabilityCoverage?.some(({ name, requestedMetricKeys }) => name === "进攻一对一对抗"
    && requestedMetricKeys.includes("wyscoutGroundAttackingDuelsPer90")
    && requestedMetricKeys.includes("wyscoutExplicitlyWonGroundAttackingDuelSharePct")));
  assert.equal(understatLocalAgentEvaluationScenario.id, "understat-five-league-xg-creation");
  assert.equal(understatLocalAgentEvaluationScenario.kind, "shortlist");
  assert.match(understatLocalAgentEvaluationScenario.message, /按前锋大类/);
  assert.equal(understatLocalAgentEvaluationScenario.expectedBroadPosition, "ATT");
  assert.deepEqual(understatLocalAgentEvaluationScenario.requiredTools, ["search_candidates"]);
  assert.equal(understatLocalAgentEvaluationScenario.requireMethodologySearch, false);
  assert.equal(understatLocalAgentEvaluationScenario.requireReportSearchAfterEvaluation, false);
  assert.equal(understatLocalAgentEvaluationScenario.expectedMaxAge, null);
  assert.ok(understatLocalAgentEvaluationScenario.expectedCapabilityCoverage?.some(({ name, requestedMetricKeys }) => (
    name === "创造机会" && requestedMetricKeys.includes("understatExpectedAssistsPer90")
  )));
  assert.ok(understatLocalAgentEvaluationScenario.expectedCapabilityCoverage?.some(({ name, requestedMetricKeys }) => (
    name === "射门机会质量" && requestedMetricKeys.includes("understatNonPenaltyExpectedGoalsPer90")
  )));
  assert.ok(understatLocalAgentEvaluationScenario.expectedCapabilityCoverage?.some(({ name, requestedMetricKeys }) => (
    name === "射门机会质量" && requestedMetricKeys.includes("asaExpectedGoalsPerShot")
  )));
});

test("the replacement scenario requires a shortlist when requested goal or creation evidence is observed", () => {
  const requestedCapabilityCoverage = bayernCapabilityCoverageFixture().map((coverage) => (
    coverage.name === "进球产出"
      ? { ...coverage, observedMetricKeys: ["goals"], candidatesWithEvidenceCount: 1, status: "observed" as const }
      : coverage
  ));
  const completed = response({
    threadId: "case-bayern-observed-capability",
    targetTeam: "Bayern Munich",
    position: "ATT",
    recommendations: [],
    limitations: bayernCapabilityGapLimitations,
    requestedCapabilityCoverage,
  });
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events: [],
    firstTurnResponse: response({ threadId: completed.threadId, status: "needs_input", targetTeam: "Bayern Munich" }),
    response: completed,
    firstTurnEvents: [],
    continuedEvents: [],
    answersUsed: 2,
    threadId: completed.threadId,
  });

  assert.equal(result.checks.returnsLeadWhenRelevantEvidenceObserved, false);
});

test("the clarification Harness rejects a policy-blocked follow-up question after the user's answer", () => {
  const threadId = "case-blocked-follow-up-question";
  const blockedQuestion = decision("ask_user", "Bayern Munich", { policyBlocked: true });
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events: [blockedQuestion],
    firstTurnResponse: response({ threadId, status: "needs_input", targetTeam: "Bayern Munich" }),
    response: response({ threadId, targetTeam: "Bayern Munich", position: "ATT" }),
    firstTurnEvents: [],
    continuedEvents: [blockedQuestion],
    answersUsed: 2,
    threadId,
  });

  assert.equal(result.checks.noBlockedFollowUpQuestions, false);
  assert.equal(evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events: [],
    firstTurnResponse: response({ threadId, status: "needs_input", targetTeam: "Bayern Munich" }),
    response: response({ threadId, targetTeam: "Bayern Munich", position: "ATT" }),
    firstTurnEvents: [],
    continuedEvents: [],
    answersUsed: 2,
    threadId,
  }).checks.noBlockedFollowUpQuestions, true);
});

test("the Harness rejects an empty shortlist when requested metrics were observed", () => {
  const threadId = "case-observed-evidence-empty-shortlist";
  const observedCoverage = [{
    name: "推进",
    requestedMetricKeys: ["wyscoutProgressivePassesPer90" as const],
    observedMetricKeys: ["wyscoutProgressivePassesPer90" as const],
    evaluatedCandidateCount: 1,
    candidatesWithEvidenceCount: 1,
    status: "observed" as const,
  }];
  const finalResponse = response({
    threadId,
    position: "WG",
    recommendations: [],
    requestedCapabilityCoverage: observedCoverage,
  });
  const evaluation = evaluateLocalAgentScenario({
    scenario: {
      id: "custom",
      message: "Find a winger with strong progression.",
      answers: [],
      kind: "custom",
      requireClarificationResume: false,
      expectedPosition: "WG",
      requireRecommendationsWhenEvidenceObserved: true,
    },
    events: [
      decision("search_candidates"),
      tool("search_candidates", { position: "WG", candidateIds: ["player-1"] }),
      decision("evaluate_candidates"),
      tool("evaluate_candidates", { evaluatedPlayerIds: ["player-1"] }),
    ],
    firstTurnResponse: finalResponse,
    response: finalResponse,
    firstTurnEvents: [],
    continuedEvents: [],
    answersUsed: 0,
    threadId,
  });

  assert.equal(evaluation.checks.returnsLeadWhenRelevantEvidenceObserved, false);
  assert.equal(evaluation.allPassed, false);
});

test("the Harness accepts a source failure only when the report preserves unknown matching status", () => {
  const threadId = "case-candidate-source-failure";
  const events: RecruitmentTraceEvent[] = [
    decision("search_candidates"),
    tool("search_candidates", { position: "ATT" }, { ok: false, resultCount: 0, matchingRecordCount: undefined }),
    decision("finish"),
  ];
  const evaluate = (limitations: string[], needSummary: string) => evaluateLocalAgentScenario({
    scenario: {
      id: "custom",
      message: "Find a forward with goals and chance creation.",
      answers: [],
      kind: "custom",
      requireClarificationResume: false,
    },
    events,
    firstTurnResponse: response({ threadId }),
    response: response({
      threadId,
      recommendations: [],
      limitations,
      needSummary,
    }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId,
  });

  assert.equal(evaluate(
    ["FPL 最近一次候选查询失败（network）：来源连接失败。该失败不能解释为零匹配，不代表没有符合条件的球员。"],
    "FPL 候选查询未成功，当前无法确认匹配结果。",
  ).checks.candidateSearchOutcomeIsExplicit, true);
  assert.equal(evaluate(
    ["当前数据中没有符合条件的球员。"],
    "没有匹配候选人。",
  ).checks.candidateSearchOutcomeIsExplicit, false);
});

test("conclusion instructions require evidence tied to the abilities requested by the user", () => {
  const instructions = conclusionInstructions("curated");

  assert.match(instructions, /用户明确提出的能力与场上角色/);
  assert.match(instructions, /直接支持/);
  assert.match(instructions, /样本较小/);
  assert.match(instructions, /无关的可用指标代替/);
});

test("the shortlist scenario passes only with ordered investigation, honest scopes, and evidence-backed recommendations", () => {
  const events: RecruitmentTraceEvent[] = [
    decision("search_methodology"),
    tool("search_methodology", { corpus: "methodology" }),
    decision("search_candidates"),
    tool("search_candidates", { position: "MID", maxAge: 23, minimumMinutes: 0, competition: null, season: null, candidateIds: ["player-1"] }),
    decision("evaluate_candidates"),
    tool("evaluate_candidates", { evaluatedPlayerIds: ["player-1"] }),
    decision("search_player_reports"),
    tool("search_player_reports", { corpus: "player_report" }),
    decision("finish"),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events,
    firstTurnResponse: response({ threadId: "case-1", limitations: ["推进指标缺失，压迫指标缺失。"] }),
    response: response({ threadId: "case-1", limitations: ["推进指标缺失，压迫指标缺失。"] }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-1",
  });

  assert.equal(result.allPassed, true);
  assert.ok(Object.values(result.checks).every(Boolean));
});

test("the Harness rejects repeated policy-blocked actions even when LangGraph safely stops", () => {
  const threadId = "case-repeated-policy-action";
  const blockedDecision: RecruitmentTraceEvent = {
    phase: "decision",
    action: "search_candidates",
    decisionSource: "planner",
    proposedAction: "search_candidates",
    elapsedMs: 1,
    ok: true,
    policyBlocked: true,
  };
  const evaluate = (events: RecruitmentTraceEvent[], limitations: string[] = []) => evaluateLocalAgentScenario({
    scenario: {
      id: "custom",
      message: "为拜仁找一名中锋。",
      answers: [],
      kind: "custom",
      requireClarificationResume: false,
    },
    events,
    firstTurnResponse: response({ threadId, limitations }),
    response: response({ threadId, limitations }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId,
  });

  assert.equal(evaluate([blockedDecision]).checks.didNotRepeatPolicyBlockedAction, true);
  const repeated = evaluate([blockedDecision, blockedDecision]);
  assert.equal(repeated.checks.didNotRepeatPolicyBlockedAction, false);
  assert.equal(repeated.allPassed, false);

  const fallback = evaluate([], ["Agent 连续两次重复提出被调查策略拒绝的相同动作；已停止继续调用模型并只报告当前可验证证据。"]);
  assert.equal(fallback.checks.didNotHitDecisionOrPolicyLoopLimit, false);
});

test("the harness rejects progress activity with no matching tool trace", () => {
  const caseId = "case-unobserved-progress";
  const events: RecruitmentTraceEvent[] = [
    tool("search_methodology", { corpus: "methodology" }),
    tool("search_candidates", { position: "MID", maxAge: 23, minimumMinutes: 0, competition: null, season: null }),
  ];
  const lifecycle: Array<Pick<EvaluationProgressEvent, "stage" | "status">> = [
    { stage: "methodology", status: "started" },
    { stage: "methodology", status: "completed" },
    { stage: "candidate_search", status: "started" },
    { stage: "candidate_search", status: "completed" },
    { stage: "player_evaluation", status: "started" },
    { stage: "player_evaluation", status: "completed" },
    { stage: "completed", status: "completed" },
  ];
  const progressEvents: EvaluationProgressEvent[] = lifecycle.map((event, index) => ({
    ...event,
    sequence: index + 1,
    turn: 1,
    message: "synthetic progress",
    completedSteps: 1,
  }));
  const result = evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events,
    firstTurnResponse: response({ threadId: caseId }),
    response: response({ threadId: caseId }),
    firstTurnEvents: events,
    continuedEvents: [],
    progressEvents,
    answersUsed: 0,
    threadId: caseId,
  });

  assert.equal(result.checks.progressMatchesObservedToolsAndTurnState, false);
});

test("the harness requires the exact tool stage, started status, and outcome status", () => {
  const caseId = "case-progress-contract";
  const events: RecruitmentTraceEvent[] = [
    tool("search_methodology", { corpus: "methodology" }),
    tool("search_candidates", { position: "MID", maxAge: 23, minimumMinutes: 0, competition: null, season: null }),
  ];
  type LifecycleEvent = Pick<EvaluationProgressEvent, "stage" | "status"> & { turn?: number };
  const toProgressEvents = (lifecycle: LifecycleEvent[]): EvaluationProgressEvent[] => lifecycle.map((event, index) => ({
    sequence: index + 1,
    turn: event.turn ?? 1,
    stage: event.stage,
    status: event.status,
    message: "observed progress",
    completedSteps: 1,
  }));
  const evaluateProgress = (lifecycle: LifecycleEvent[]) => evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events,
    firstTurnResponse: response({ threadId: caseId }),
    response: response({ threadId: caseId }),
    firstTurnEvents: events,
    continuedEvents: [],
    progressEvents: toProgressEvents(lifecycle),
    answersUsed: 0,
    threadId: caseId,
  }).checks.progressMatchesObservedToolsAndTurnState;
  const valid: LifecycleEvent[] = [
    { stage: "methodology", status: "started" },
    { stage: "methodology", status: "completed" },
    { stage: "candidate_search", status: "started" },
    { stage: "candidate_search", status: "completed" },
    { stage: "completed", status: "completed" },
  ];

  assert.equal(evaluateProgress(valid), true);
  assert.equal(evaluateProgress(valid.slice(0, 3).concat(valid.slice(4))), false);
  assert.equal(evaluateProgress(valid.map((event) => event.stage === "candidate_search" && event.status === "started"
    ? { ...event, stage: "team_sample" }
    : event)), false);
  assert.equal(evaluateProgress(valid.map((event) => event.stage === "candidate_search" && event.status === "completed"
    ? { ...event, status: "notice" }
    : event)), false);
});

test("a tool progress pair cannot span a user interrupt and same-case resume", () => {
  const caseId = "case-progress-turn-pair";
  const firstTurnEvents = [tool("search_methodology", { corpus: "methodology" })];
  const continuedEvents = [tool("search_candidates", { position: "ST" })];
  const progressEvents: EvaluationProgressEvent[] = [
    { sequence: 1, turn: 1, stage: "methodology", status: "started", message: "start", completedSteps: 1 },
    { sequence: 2, turn: 1, stage: "methodology", status: "completed", message: "done", completedSteps: 1 },
    { sequence: 3, turn: 1, stage: "asking_user", status: "waiting_for_user", message: "question", completedSteps: 1 },
    { sequence: 4, turn: 1, stage: "candidate_search", status: "started", message: "start", completedSteps: 2 },
    { sequence: 5, turn: 2, stage: "candidate_search", status: "completed", message: "done", completedSteps: 2 },
    { sequence: 6, turn: 2, stage: "completed", status: "completed", message: "complete", completedSteps: 2 },
  ];
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events: [...firstTurnEvents, ...continuedEvents],
    firstTurnResponse: response({ threadId: caseId, status: "needs_input" }),
    response: response({ threadId: caseId }),
    firstTurnEvents,
    continuedEvents,
    progressEvents,
    answersUsed: 1,
    threadId: caseId,
  });

  assert.equal(result.checks.progressMatchesObservedToolsAndTurnState, false);
});

test("the harness rejects a percentile claim for a low-minute recommendation", () => {
  const lowSample = recommendation();
  lowSample.player.minutes = 16;
  lowSample.evidence[0]!.minutes = 16;
  lowSample.evidence[0]!.peerPercentile = 100;
  const result = evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events: [],
    firstTurnResponse: response({ threadId: "case-low-sample" }),
    response: response({ threadId: "case-low-sample", recommendations: [lowSample] }),
    firstTurnEvents: [],
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-low-sample",
  });

  assert.equal(result.checks.percentilesRespectMetricSamples, false);
});

test("the harness accepts explicit low-sample and comparison-group reasons", () => {
  const lowSample = recommendation();
  lowSample.player.minutes = 16;
  lowSample.evidence[0]!.minutes = 16;
  lowSample.evidence[0]!.peerPercentile = null;
  lowSample.evidence[0]!.peerPercentileUnavailableReason = "candidate_low_sample";
  const unknownMetricSample = recommendation();
  unknownMetricSample.evidence[0]!.minutes = null;
  unknownMetricSample.evidence[0]!.peerPercentile = null;
  unknownMetricSample.evidence[0]!.peerPercentileUnavailableReason = "candidate_sample_unknown";
  const result = evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events: [],
    firstTurnResponse: response({ threadId: "case-low-sample-honest" }),
    response: response({ threadId: "case-low-sample-honest", recommendations: [lowSample, recommendation(), unknownMetricSample] }),
    firstTurnEvents: [],
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-low-sample-honest",
  });

  assert.equal(result.checks.percentilesRespectMetricSamples, true);
});

test("a recommendation must cite available evidence for the requested ability instead of unrelated metrics", () => {
  const evaluate = (candidate: ReturnType<typeof recommendation>) => evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events: [],
    firstTurnResponse: response({ threadId: "case-capability-match" }),
    response: response({
      threadId: "case-capability-match",
      recommendations: [candidate],
      limitations: ["前场压迫指标缺失。"],
    }),
    firstTurnEvents: [],
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-capability-match",
  });
  const candidate = recommendation();
  candidate.focusEvidenceKeys = ["carries"];
  candidate.evidence.push({
    key: "wyscoutProgressivePassesPer90",
    label: "渐进传球",
    value: 0.4,
    unit: "次/90",
    peerPercentile: null,
    peerGroupSize: 0,
    peerPercentileUnavailableReason: "candidate_low_sample",
    minutes: 69,
    competition: "Open League",
    season: "2025/26",
    source: "Fixture data",
  });

  assert.equal(evaluate(candidate).checks.requestedCapabilitiesGrounded, false);

  candidate.focusEvidenceKeys = ["wyscoutProgressivePassesPer90"];
  assert.equal(evaluate(candidate).checks.requestedCapabilitiesGrounded, true);
});

test("the attacking one-on-one scenario requires its evidence or an explicit data-gap explanation", () => {
  assert.equal(oneOnOneScenario.kind, "shortlist");
  const candidate = recommendation("ATT");
  candidate.evidence.push(
    {
      key: "wyscoutGroundAttackingDuelsPer90",
      label: "地面进攻对抗 /90",
      value: 1.8,
      unit: "次/90分钟",
      peerPercentile: null,
      peerGroupSize: 0,
      peerPercentileUnavailableReason: "insufficient_peer_group",
      minutes: 150,
      competition: "Spanish first division",
      season: "2017/18",
      source: "Wyscout Open Data",
    },
    {
      key: "wyscoutExplicitlyWonGroundAttackingDuelSharePct",
      label: "进攻对抗明确胜出占比（含中性）",
      value: 33.3333,
      unit: "%",
      peerPercentile: null,
      peerGroupSize: 0,
      peerPercentileUnavailableReason: "insufficient_peer_group",
      minutes: 150,
      sampleAttempts: 3,
      sampleAttemptsLabel: "次已分类进攻对抗",
      competition: "Spanish first division",
      season: "2017/18",
      source: "Wyscout Open Data",
    },
  );
  candidate.focusEvidenceKeys = ["wyscoutGroundAttackingDuelsPer90"];
  const coverage = [{
    name: "进攻一对一对抗",
    requestedMetricKeys: ["wyscoutGroundAttackingDuelsPer90", "wyscoutExplicitlyWonGroundAttackingDuelSharePct"],
    observedMetricKeys: ["wyscoutGroundAttackingDuelsPer90", "wyscoutExplicitlyWonGroundAttackingDuelSharePct"],
    evaluatedCandidateCount: 1,
    candidatesWithEvidenceCount: 1,
    status: "observed",
  }] as const;
  const evaluate = (recommendationValue: ReturnType<typeof recommendation>, limitations: string[] = []) => evaluateLocalAgentScenario({
    scenario: oneOnOneScenario,
    events: [],
    firstTurnResponse: response({ threadId: "case-attacking-one-on-one" }),
    response: response({
      threadId: "case-attacking-one-on-one",
      position: "ATT",
      recommendations: [recommendationValue],
      limitations,
      requestedCapabilityCoverage: [...coverage],
    }),
    firstTurnEvents: [],
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-attacking-one-on-one",
  });

  assert.equal(evaluate(candidate).checks.requestedCapabilitiesGrounded, true);
  assert.equal(evaluate(candidate).checks.requestedCapabilityCoverageMatchesScenario, true);

  const unrelated = recommendation("ATT");
  unrelated.evidence.push(...candidate.evidence.filter(({ key }) => key.startsWith("wyscout")));
  assert.equal(evaluate(unrelated).checks.requestedCapabilitiesGrounded, false);

  const missing = recommendation("ATT");
  assert.equal(evaluate(missing, ["当前数据没有提供进攻一对一对抗的对应指标，无法评估该能力。"]).checks.requestedCapabilitiesGrounded, true);
});

test("the harness fails unsupported requested abilities unless the report names the data gap", () => {
  const scenario = {
    ...shortlistScenario,
    requestedCapabilities: [{
      name: "压力下控球",
      metricKeys: [] as const,
      limitationTerms: ["压力下控球"],
    }],
  };
  const events: RecruitmentTraceEvent[] = [];
  const evaluate = (limitations: string[]) => evaluateLocalAgentScenario({
    scenario,
    events,
    firstTurnResponse: response({ threadId: "case-unsupported-capability" }),
    response: response({ threadId: "case-unsupported-capability", limitations }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-unsupported-capability",
  });

  assert.equal(evaluate([]).checks.requestedCapabilitiesGrounded, false);
  assert.equal(evaluate(["当前数据无法观测压力下控球。"]).checks.requestedCapabilitiesGrounded, true);
});

test("the harness requires coherent coverage counts and the scenario's requested metric mapping", () => {
  const valid = response({ threadId: "case-capability-coverage" });
  const evaluate = (candidate: ConversationTurnResponse) => evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events: [],
    firstTurnResponse: response({ threadId: "case-capability-coverage" }),
    response: candidate,
    firstTurnEvents: [],
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-capability-coverage",
  });

  assert.equal(evaluate(valid).checks.requestedCapabilityCoverageIsConsistent, true);
  assert.equal(evaluate(valid).checks.requestedCapabilityCoverageMatchesScenario, true);

  const missingDimension = response({ threadId: "case-capability-coverage", requestedCapabilityCoverage: [] });
  assert.equal(evaluate(missingDimension).checks.requestedCapabilityCoverageMatchesScenario, false);

  const inconsistentCount = response({
    threadId: "case-capability-coverage",
    requestedCapabilityCoverage: valid.report!.requestedCapabilityCoverage.map((coverage) => coverage.name === "推进"
      ? { ...coverage, candidatesWithEvidenceCount: 2 }
      : coverage),
  });
  assert.equal(evaluate(inconsistentCount).checks.requestedCapabilityCoverageIsConsistent, false);

  const unrequestedMetric = response({
    threadId: "case-capability-coverage",
    requestedCapabilityCoverage: valid.report!.requestedCapabilityCoverage.map((coverage) => coverage.name === "压迫"
      ? { ...coverage, observedMetricKeys: ["goals" as const] }
      : coverage),
  });
  assert.equal(evaluate(unrequestedMetric).checks.requestedCapabilityCoverageIsConsistent, false);

  const wrongMapping = response({
    threadId: "case-capability-coverage",
    requestedCapabilityCoverage: valid.report!.requestedCapabilityCoverage.map((coverage) => coverage.name === "压迫"
      ? { ...coverage, requestedMetricKeys: ["tackles" as const] }
      : coverage),
  });
  assert.equal(evaluate(wrongMapping).checks.requestedCapabilityCoverageMatchesScenario, false);
});

test("the shortlist scenario fails when a club name becomes a league filter or evidence is missing", () => {
  const events: RecruitmentTraceEvent[] = [
    decision("search_methodology"),
    tool("search_methodology", { corpus: "methodology" }),
    decision("search_candidates"),
    tool("search_candidates", { position: null, maxAge: null, minimumMinutes: 0, competition: "La Liga", season: null }),
    decision("evaluate_candidates"),
    tool("evaluate_candidates", { evaluatedPlayerIds: ["player-1"] }),
    decision("search_player_reports"),
    tool("search_player_reports", { corpus: "player_report" }),
    decision("finish"),
  ];
  const unsupported = recommendation();
  unsupported.player.playerId = "unseen-player";
  unsupported.focusEvidenceKeys = ["goals"];
  const result = evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events,
    firstTurnResponse: response({ threadId: "case-2", recommendations: [unsupported] }),
    response: response({ threadId: "case-2", recommendations: [unsupported] }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-2",
  });

  assert.equal(result.allPassed, false);
  assert.equal(result.checks.noInferredCompetitionSeasonOrMinutesFilters, false);
  assert.equal(result.checks.appliedUserAgeLimit, false);
  assert.equal(result.checks.recommendationsAreEvidenceBacked, false);
  assert.equal(result.checks.recommendationsWereEvaluated, false);
});

test("the shortlist evaluator rejects an empty page when the requested offset hides matching candidates", () => {
  const events: RecruitmentTraceEvent[] = [
    decision("search_methodology"),
    tool("search_methodology", { corpus: "methodology" }),
    decision("search_candidates"),
    tool("search_candidates", {
      position: null,
      maxAge: 23,
      minimumMinutes: 0,
      competition: null,
      season: null,
      offset: 999,
      limit: 10,
      nextOffset: null,
    }, { resultCount: 0, matchingRecordCount: 5 }),
    decision("finish"),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events,
    firstTurnResponse: response({ threadId: "case-hidden-matches", recommendations: [] }),
    response: response({ threadId: "case-hidden-matches", recommendations: [] }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-hidden-matches",
  });

  assert.equal(result.checks.candidatePagesFollowCursors, false);
  assert.equal(result.checks.evaluatedDiscoveredCandidates, false);
  assert.equal(result.allPassed, false);
});

test("the shortlist evaluator rejects an unrequested player-name filter that hides the pool", () => {
  const events: RecruitmentTraceEvent[] = [
    decision("search_methodology"),
    tool("search_methodology", { corpus: "methodology" }),
    decision("search_candidates"),
    tool("search_candidates", {
      position: null,
      maxAge: 23,
      minimumMinutes: 0,
      competition: null,
      season: null,
      playerNameFilterUsed: true,
      offset: 0,
      limit: 10,
      nextOffset: null,
    }, { resultCount: 0, matchingRecordCount: 0 }),
    decision("finish"),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events,
    firstTurnResponse: response({ threadId: "case-filtered-pool", recommendations: [] }),
    response: response({ threadId: "case-filtered-pool", recommendations: [] }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-filtered-pool",
  });

  assert.equal(result.checks.candidateSearchDoesNotUseAnUnrequestedName, false);
  assert.equal(result.allPassed, false);
});

test("candidate pagination must use each page's returned next offset", () => {
  const events: RecruitmentTraceEvent[] = [
    decision("search_methodology"),
    tool("search_methodology", { corpus: "methodology" }),
    tool("search_candidates", {
      position: null,
      maxAge: 23,
      minimumMinutes: 0,
      competition: null,
      season: null,
      nextOffset: 10,
      candidateIds: Array.from({ length: 10 }, (_, index) => `player-${index}`),
    }, { resultCount: 10, matchingRecordCount: 25 }),
    tool("search_candidates", {
      position: null,
      maxAge: 23,
      minimumMinutes: 0,
      competition: null,
      season: null,
      offset: 20,
      candidateIds: ["player-20", "player-21", "player-22", "player-23", "player-24"],
    }, { resultCount: 5, matchingRecordCount: 25 }),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events,
    firstTurnResponse: response({ threadId: "case-stale-page", recommendations: [] }),
    response: response({ threadId: "case-stale-page", recommendations: [] }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-stale-page",
  });

  assert.equal(result.checks.candidatePagesFollowCursors, false);
  assert.equal(result.allPassed, false);
});

test("an empty-data clarification run passes when it investigates, resumes in the same case, and stays on role", () => {
  const caseId = "case-bayern";
  const singleRoleClarificationScenario = {
    ...clarificationScenario,
    answers: [clarificationScenario.answers[0]!],
  };
  delete singleRoleClarificationScenario.expectedBroadenedPosition;
  const events: RecruitmentTraceEvent[] = [
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", { position: "ST", playerNameFilterUsed: false }, { resultCount: 0, matchingRecordCount: 0 }),
    decision("ask_user", "Bayern Munich"),
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", { position: "ST", playerNameFilterUsed: false }, { resultCount: 0, matchingRecordCount: 0 }),
    decision("ask_user", "Bayern Munich"),
  ];
  const initial = response({ threadId: caseId, status: "needs_input" });
  const resumed = response({ threadId: caseId, status: "needs_input", targetTeam: "Bayern Munich" });
  const result = evaluateLocalAgentScenario({
    scenario: singleRoleClarificationScenario,
    events,
    firstTurnResponse: initial,
    response: resumed,
    firstTurnEvents: events.slice(0, 3),
    continuedEvents: events.slice(3),
    answersUsed: 1,
    threadId: caseId,
  });

  assert.equal(result.allPassed, true);
  assert.ok(Object.values(result.checks).every(Boolean));
});

test("a confirmed position with source matches can reuse its first page without asking to broaden", () => {
  const caseId = "case-bayern-with-strikers";
  const firstPageIds = Array.from({ length: 20 }, (_, index) => `striker-${index + 1}`);
  const firstTurnEvents: RecruitmentTraceEvent[] = [
    decision("search_methodology", "Bayern Munich"),
    tool("search_methodology", { corpus: "methodology" }),
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", {
      position: "ST",
      offset: 0,
      limit: 20,
      nextOffset: 20,
      candidateIds: firstPageIds,
    }, { resultCount: 20, matchingRecordCount: 25 }),
    decision("ask_user", "Bayern Munich"),
  ];
  const continuedEvents: RecruitmentTraceEvent[] = [
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", {
      position: "ST",
      offset: 20,
      limit: 20,
      nextOffset: null,
      candidateIds: ["striker-21", "striker-22", "striker-23", "striker-24", "player-1"],
    }, { resultCount: 5, matchingRecordCount: 25 }),
    decision("evaluate_candidates", "Bayern Munich"),
    tool("evaluate_candidates", { evaluatedPlayerIds: ["player-1"] }),
    decision("search_player_reports", "Bayern Munich"),
    tool("search_player_reports", { corpus: "player_report" }),
    decision("finish", "Bayern Munich"),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events: [...firstTurnEvents, ...continuedEvents],
    firstTurnResponse: response({ threadId: caseId, status: "needs_input", targetTeam: "Bayern Munich" }),
    response: response({
      threadId: caseId,
      targetTeam: "Bayern Munich",
      position: "ST",
      limitations: bayernCapabilityGapLimitations,
      requestedCapabilityCoverage: bayernCapabilityCoverageFixture(),
    }),
    firstTurnEvents,
    continuedEvents,
    progressEvents: progressForTurns([
      { turn: 1, toolStages: ["methodology", "candidate_search"], waitingForUser: true },
      { turn: 2, toolStages: ["candidate_search", "player_evaluation", "report_search"], completed: true },
    ]),
    answersUsed: 1,
    threadId: caseId,
  });

  assert.equal(result.checks.expectedPositionSearchStartedAtFirstPage, true);
  assert.equal(result.checks.positionExpansionMatchesEvidenceAndConsent, true);
  assert.equal(result.allPassed, true);
});

test("an empty confirmed position requires the agreed broader search after the second answer", () => {
  const caseId = "case-bayern-empty-strikers";
  const firstTurnEvents: RecruitmentTraceEvent[] = [
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", { position: null, offset: 0, candidateIds: ["candidate-1"] }, { resultCount: 1, matchingRecordCount: 1 }),
    decision("ask_user", "Bayern Munich"),
  ];
  const continuedEvents: RecruitmentTraceEvent[] = [
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", { position: "ST", offset: 0, candidateIds: [] }, { resultCount: 0, matchingRecordCount: 0 }),
    decision("ask_user", "Bayern Munich"),
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", { position: "ATT", offset: 0, candidateIds: ["player-1"] }, { resultCount: 1, matchingRecordCount: 1 }),
    decision("evaluate_candidates", "Bayern Munich"),
    tool("evaluate_candidates", { evaluatedPlayerIds: ["player-1"] }),
    decision("search_player_reports", "Bayern Munich"),
    tool("search_player_reports", { corpus: "player_report" }),
    decision("finish", "Bayern Munich"),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events: [...firstTurnEvents, ...continuedEvents],
    firstTurnResponse: response({ threadId: caseId, status: "needs_input", targetTeam: "Bayern Munich" }),
    response: response({
      threadId: caseId,
      targetTeam: "Bayern Munich",
      position: "WG",
      limitations: bayernCapabilityGapLimitations,
      requestedCapabilityCoverage: bayernCapabilityCoverageFixture(),
    }),
    firstTurnEvents,
    continuedEvents,
    progressEvents: progressForTurns([
      { turn: 1, toolStages: ["candidate_search"], waitingForUser: true },
      { turn: 2, toolStages: ["candidate_search"], waitingForUser: true },
      { turn: 3, toolStages: ["candidate_search", "player_evaluation", "report_search"], completed: true },
    ]),
    answersUsed: 2,
    threadId: caseId,
  });

  assert.equal(result.checks.positionExpansionMatchesEvidenceAndConsent, true);
  assert.equal(result.allPassed, true);
});

test("an approved clarification can start a fresh first page for the broader position", () => {
  const caseId = "case-bayern-fresh-broader-search";
  const firstTurnEvents: RecruitmentTraceEvent[] = [
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", {
      position: "ATT",
      offset: 0,
      limit: 20,
      nextOffset: 20,
      candidateIds: Array.from({ length: 20 }, (_, index) => `attacker-${index}`),
    }, { resultCount: 20, matchingRecordCount: 601 }),
    decision("ask_user", "Bayern Munich"),
  ];
  const continuedEvents: RecruitmentTraceEvent[] = [
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", { position: "ST", offset: 0, candidateIds: [] }, { resultCount: 0, matchingRecordCount: 0 }),
    decision("ask_user", "Bayern Munich"),
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", {
      position: "ATT",
      offset: 0,
      limit: 20,
      nextOffset: 20,
      candidateIds: ["player-1", ...Array.from({ length: 19 }, (_, index) => `fresh-attacker-${index}`)],
    }, { resultCount: 20, matchingRecordCount: 601 }),
    decision("evaluate_candidates", "Bayern Munich"),
    tool("evaluate_candidates", { evaluatedPlayerIds: ["player-1"] }),
    decision("search_player_reports", "Bayern Munich"),
    tool("search_player_reports", { corpus: "player_report" }),
    decision("finish", "Bayern Munich"),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events: [...firstTurnEvents, ...continuedEvents],
    firstTurnResponse: response({ threadId: caseId, status: "needs_input", targetTeam: "Bayern Munich" }),
    response: response({
      threadId: caseId,
      targetTeam: "Bayern Munich",
      position: "ATT",
      recommendations: [recommendation("ATT")],
      limitations: bayernCapabilityGapLimitations,
      requestedCapabilityCoverage: bayernCapabilityCoverageFixture(),
    }),
    firstTurnEvents,
    continuedEvents,
    progressEvents: progressForTurns([
      { turn: 1, toolStages: ["candidate_search"], waitingForUser: true },
      { turn: 2, toolStages: ["candidate_search"], waitingForUser: true },
      { turn: 3, toolStages: ["candidate_search", "player_evaluation", "report_search"], completed: true },
    ]),
    answersUsed: 2,
    threadId: caseId,
  });

  assert.equal(result.checks.positionExpansionMatchesEvidenceAndConsent, true);
  assert.equal(result.checks.recommendationsMatchExpectedPosition, true);
  assert.equal(result.allPassed, true);
});

test("an explicitly approved forward expansion is accepted after a nonempty striker search", () => {
  const caseId = "case-bayern-expand-after-nonempty-strikers";
  const firstTurnEvents: RecruitmentTraceEvent[] = [
    tool("search_candidates", {
      position: "ATT",
      limit: 20,
      nextOffset: 20,
      candidateIds: Array.from({ length: 20 }, (_, index) => `attacker-${index}`),
    }, { resultCount: 20, matchingRecordCount: 1387 }),
    decision("ask_user", "Bayern Munich"),
  ];
  const continuedEvents: RecruitmentTraceEvent[] = [
    tool("search_candidates", {
      position: "ST",
      limit: 20,
      nextOffset: 20,
      candidateIds: Array.from({ length: 20 }, (_, index) => `striker-${index}`),
    }, { resultCount: 20, matchingRecordCount: 316 }),
    decision("evaluate_candidates", "Bayern Munich"),
    tool("evaluate_candidates", { evaluatedPlayerIds: ["striker-0"] }),
    decision("search_player_reports", "Bayern Munich"),
    tool("search_player_reports", { corpus: "player_report" }),
    decision("ask_user", "Bayern Munich"),
    tool("search_candidates", {
      position: "ATT",
      offset: 20,
      limit: 20,
      nextOffset: 40,
      candidateIds: Array.from({ length: 20 }, (_, index) => `attacker-${index + 20}`),
    }, { resultCount: 20, matchingRecordCount: 1387 }),
    decision("evaluate_candidates", "Bayern Munich"),
    tool("evaluate_candidates", { evaluatedPlayerIds: ["attacker-20"] }),
    decision("search_player_reports", "Bayern Munich"),
    tool("search_player_reports", { corpus: "player_report" }),
    decision("finish", "Bayern Munich"),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events: [...firstTurnEvents, ...continuedEvents],
    firstTurnResponse: response({ threadId: caseId, status: "needs_input", targetTeam: "Bayern Munich" }),
    response: response({
      threadId: caseId,
      targetTeam: "Bayern Munich",
      position: "ATT",
      recommendations: [recommendation("WG")],
      limitations: bayernCapabilityGapLimitations,
      requestedCapabilityCoverage: bayernCapabilityCoverageFixture(),
    }),
    firstTurnEvents,
    continuedEvents,
    progressEvents: progressForTurns([
      { turn: 1, toolStages: ["candidate_search"], waitingForUser: true },
      { turn: 2, toolStages: ["candidate_search", "player_evaluation", "report_search"], waitingForUser: true },
      { turn: 3, toolStages: ["candidate_search", "player_evaluation", "report_search"], completed: true },
    ]),
    answersUsed: 2,
    threadId: caseId,
  });

  assert.equal(result.checks.positionExpansionMatchesEvidenceAndConsent, true);
  assert.equal(result.checks.recommendationsMatchExpectedPosition, true);
});

test("the Harness accepts an approved broad search that resumes at its recorded next cursor", () => {
  const caseId = "case-bayern-reuse-approved-broad-cursor";
  const firstTurnEvents: RecruitmentTraceEvent[] = [
    decision("search_methodology", "Bayern Munich"),
    tool("search_methodology", { corpus: "methodology" }),
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", {
      position: "ATT",
      offset: 0,
      limit: 20,
      nextOffset: 20,
      candidateIds: Array.from({ length: 20 }, (_, index) => `attacker-${index}`),
    }, { resultCount: 20, matchingRecordCount: 40 }),
    decision("ask_user", "Bayern Munich"),
  ];
  const continuedEvents: RecruitmentTraceEvent[] = [
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", { position: "ST", offset: 0, candidateIds: [] }, { resultCount: 0, matchingRecordCount: 0 }),
    decision("ask_user", "Bayern Munich"),
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", {
      position: "ATT",
      offset: 20,
      limit: 20,
      candidateIds: Array.from({ length: 20 }, (_, index) => `attacker-${index + 20}`),
    }, { resultCount: 20, matchingRecordCount: 40 }),
    decision("evaluate_candidates", "Bayern Munich"),
    tool("evaluate_candidates", { evaluatedPlayerIds: ["attacker-20"] }),
    decision("search_player_reports", "Bayern Munich"),
    tool("search_player_reports", { corpus: "player_report" }),
    decision("finish", "Bayern Munich"),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events: [...firstTurnEvents, ...continuedEvents],
    firstTurnResponse: response({ threadId: caseId, status: "needs_input", targetTeam: "Bayern Munich" }),
    response: response({
      threadId: caseId,
      targetTeam: "Bayern Munich",
      position: "ATT",
      recommendations: [],
      limitations: bayernCapabilityGapLimitations,
      requestedCapabilityCoverage: bayernCapabilityCoverageFixture(),
    }),
    firstTurnEvents,
    continuedEvents,
    progressEvents: progressForTurns([
      { turn: 1, toolStages: ["methodology", "candidate_search"], waitingForUser: true },
      { turn: 2, toolStages: ["candidate_search"], waitingForUser: true },
      { turn: 3, toolStages: ["candidate_search", "player_evaluation", "report_search"], completed: true },
    ]),
    answersUsed: 2,
    threadId: caseId,
  });

  assert.equal(result.checks.positionExpansionMatchesEvidenceAndConsent, true);
  assert.equal(result.checks.emptyExpectedPositionHandledHonestly, true);
  assert.equal(result.allPassed, true);
});

test("the Harness rejects expanding a confirmed empty position before the user answers", () => {
  const caseId = "case-bayern-expanded-too-early";
  const firstTurnEvents: RecruitmentTraceEvent[] = [
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", { position: null, offset: 0, candidateIds: ["player-1"] }, { resultCount: 1, matchingRecordCount: 1 }),
    decision("ask_user", "Bayern Munich"),
  ];
  const continuedEvents: RecruitmentTraceEvent[] = [
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", { position: "ST", offset: 0, candidateIds: [] }, { resultCount: 0, matchingRecordCount: 0 }),
    decision("search_candidates", "Bayern Munich"),
    tool("search_candidates", { position: "ATT", offset: 0, candidateIds: ["player-1"] }, { resultCount: 1, matchingRecordCount: 1 }),
    decision("evaluate_candidates", "Bayern Munich"),
    tool("evaluate_candidates", { evaluatedPlayerIds: ["player-1"] }),
    decision("search_player_reports", "Bayern Munich"),
    tool("search_player_reports", { corpus: "player_report" }),
    decision("ask_user", "Bayern Munich"),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events: [...firstTurnEvents, ...continuedEvents],
    firstTurnResponse: response({ threadId: caseId, status: "needs_input", targetTeam: "Bayern Munich" }),
    response: response({ threadId: caseId, targetTeam: "Bayern Munich", position: "ST" }),
    firstTurnEvents,
    continuedEvents,
    progressEvents: progressForTurns([
      { turn: 1, toolStages: ["candidate_search"], waitingForUser: true },
      { turn: 2, toolStages: ["candidate_search", "candidate_search", "player_evaluation", "report_search"], waitingForUser: true },
      { turn: 3, toolStages: [], completed: true },
    ]),
    answersUsed: 2,
    threadId: caseId,
  });

  assert.equal(result.checks.positionExpansionMatchesEvidenceAndConsent, false);
  assert.equal(result.checks.progressMatchesObservedToolsAndTurnState, true);
});

test("a failed tool attempt does not count as investigation before a clarification", () => {
  const failedSearch: RecruitmentTraceEvent = {
    phase: "tool",
    toolName: "search_candidates",
    elapsedMs: 1,
    ok: false,
    filters: { position: "ST" },
    resultCount: 0,
  };
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events: [failedSearch, decision("ask_user")],
    firstTurnResponse: response({ threadId: "case-bayern", status: "needs_input" }),
    response: response({ threadId: "case-bayern", status: "needs_input" }),
    firstTurnEvents: [failedSearch, decision("ask_user")],
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-bayern",
  });

  assert.equal(result.checks.questionFollowedInvestigation, false);
  assert.equal(result.allPassed, false);
});

test("a failed candidate search still fails if it attempted an inferred filter", () => {
  const events: RecruitmentTraceEvent[] = [
    tool("search_methodology", { corpus: "methodology" }),
    tool("search_candidates", { position: null, maxAge: 23, minimumMinutes: 0, competition: "La Liga", season: null }, { ok: false, resultCount: 0 }),
    tool("search_candidates", { position: null, maxAge: 23, minimumMinutes: 0, competition: null, season: null }),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events,
    firstTurnResponse: response({ threadId: "case-bad-failed-filter" }),
    response: response({ threadId: "case-bad-failed-filter" }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-bad-failed-filter",
  });

  assert.equal(result.checks.noInferredCompetitionSeasonOrMinutesFilters, false);
});

test("a clarification run fails if it resumes another case or recommends across positions", () => {
  const caseId = "case-bayern";
  const events: RecruitmentTraceEvent[] = [
    tool("search_candidates", { position: "ST" }),
    decision("ask_user"),
    tool("search_candidates", { position: "ST" }),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events,
    firstTurnResponse: response({ threadId: caseId, status: "needs_input" }),
    response: response({ threadId: "different-case", targetTeam: "Bayern Munich", position: "CM" }),
    firstTurnEvents: events.slice(0, 2),
    continuedEvents: events.slice(2),
    answersUsed: 1,
    threadId: caseId,
  });

  assert.equal(result.allPassed, false);
  assert.equal(result.checks.resumedSameCase, false);
  assert.equal(result.checks.recommendationsMatchExpectedPosition, false);
});

test("a clarification must investigate before asking, not merely have both events", () => {
  const events: RecruitmentTraceEvent[] = [
    decision("ask_user", "Bayern Munich"),
    tool("search_candidates", { position: "ST" }),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events,
    firstTurnResponse: response({ threadId: "case-bayern", status: "needs_input" }),
    response: response({ threadId: "case-bayern", status: "needs_input" }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-bayern",
  });

  assert.equal(result.checks.questionFollowedInvestigation, false);
});

test("a clarification question must address the Kane role ambiguity", () => {
  const unrelated = response({ threadId: "case-unrelated", status: "needs_input", targetTeam: "Bayern Munich" });
  unrelated.message = "你希望候选球员来自哪个联赛？";
  unrelated.question = { reason: "这会影响比赛样本。" };
  const events: RecruitmentTraceEvent[] = [
    tool("search_candidates", { position: null }),
    decision("ask_user", "Bayern Munich"),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events,
    firstTurnResponse: unrelated,
    response: unrelated,
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-unrelated",
  });

  assert.equal(result.checks.questionAddressesRoleAmbiguity, false);
});

test("a role keyword in the rationale cannot make an unrelated clarification pass", () => {
  const unrelated = response({ threadId: "case-unrelated-reason", status: "needs_input", targetTeam: "Bayern Munich" });
  unrelated.message = "你未来希望凯恩的替代者来自哪个联赛？";
  unrelated.question = { reason: "凯恩的中锋职责会影响比赛样本。" };
  const events: RecruitmentTraceEvent[] = [tool("search_candidates", { position: null }), decision("ask_user")];
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events,
    firstTurnResponse: unrelated,
    response: unrelated,
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-unrelated-reason",
  });

  assert.equal(result.checks.questionAddressesRoleAmbiguity, false);
});

test("an interrupted case must retain its target club in the trace before reporting", () => {
  const events: RecruitmentTraceEvent[] = [
    tool("search_candidates", { position: null }),
    decision("ask_user"),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: clarificationScenario,
    events,
    firstTurnResponse: response({ threadId: "case-no-team", status: "needs_input" }),
    response: response({ threadId: "case-no-team", status: "needs_input" }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-no-team",
  });

  assert.equal(result.checks.targetTeamContextPreserved, false);
});

test("a failed or empty evaluation does not satisfy the shortlist evidence stage", () => {
  const events: RecruitmentTraceEvent[] = [
    tool("search_methodology", { corpus: "methodology" }),
    tool("search_candidates", { position: null, maxAge: 23, minimumMinutes: 0, competition: null, season: null }),
    tool("evaluate_candidates", { evaluatedPlayerIds: [] }, { ok: false, resultCount: 0 }),
    tool("search_player_reports", { corpus: "player_report" }),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events,
    firstTurnResponse: response({ threadId: "case-evidence" }),
    response: response({ threadId: "case-evidence", recommendations: [] }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-evidence",
  });

  assert.equal(result.checks.evaluatedDiscoveredCandidates, false);
});

test("player report retrieval must follow a successful match-data evaluation", () => {
  const events: RecruitmentTraceEvent[] = [
    tool("search_methodology", { corpus: "methodology" }),
    tool("search_candidates", { position: null, maxAge: 23, minimumMinutes: 0, competition: null, season: null, candidateIds: ["player-1"] }),
    tool("search_player_reports", { corpus: "player_report" }),
    tool("evaluate_candidates", { evaluatedPlayerIds: ["player-1"] }),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events,
    firstTurnResponse: response({ threadId: "case-order" }),
    response: response({ threadId: "case-order" }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-order",
  });

  assert.equal(result.checks.evaluatedDiscoveredCandidates, true);
  assert.equal(result.checks.searchedReportsAfterEvaluatingEvidence, false);
});

test("Understat investigation ablation does not require unrelated methodology or player-report searches", () => {
  const events: RecruitmentTraceEvent[] = [
    tool("search_candidates", {
      position: "ATT",
      maxAge: null,
      minimumMinutes: 0,
      competition: null,
      season: null,
      candidateIds: ["player-1"],
    }),
    tool("evaluate_candidates", { evaluatedPlayerIds: ["player-1"] }),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: understatLocalAgentEvaluationScenario,
    events,
    firstTurnResponse: response({ threadId: "case-understat-evaluation" }),
    response: response({ threadId: "case-understat-evaluation" }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-understat-evaluation",
  });

  assert.equal(result.checks.searchedMethodologyCorpus, true);
  assert.equal(result.checks.searchedReportsAfterEvaluatingEvidence, true);
});

test("evidence evaluation must happen after discovery and only evaluate discovered ids", () => {
  const events: RecruitmentTraceEvent[] = [
    tool("search_methodology", { corpus: "methodology" }),
    tool("evaluate_candidates", { evaluatedPlayerIds: ["player-1"] }),
    tool("search_candidates", { candidateIds: ["player-1"] }),
    tool("search_player_reports", { corpus: "player_report" }),
  ];
  const result = evaluateLocalAgentScenario({
    scenario: shortlistScenario,
    events,
    firstTurnResponse: response({ threadId: "case-evaluation-order" }),
    response: response({ threadId: "case-evaluation-order" }),
    firstTurnEvents: events,
    continuedEvents: [],
    answersUsed: 0,
    threadId: "case-evaluation-order",
  });

  assert.equal(result.checks.evaluatedOnlyAfterCandidateDiscovery, false);
});

test("public tool traces omit raw query and team names but preserve safe data boundaries", () => {
  const decisionEvent = privacySafeTraceEvent(decision("finish", "FC Bayern München"));
  const teamLookup = privacySafeTraceEvent(tool("inspect_team", { teamName: "FC Bayern München" }));
  const methodologySearch = privacySafeTraceEvent(tool("search_methodology", {
    corpus: "methodology",
    query: "natural language scouting brief for Barcelona",
  }));
  const search = privacySafeTraceEvent(tool("search_candidates", {
    position: "ST",
    candidateIds: ["player-1"],
    playerNameFilterUsed: true,
  }));

  const output = JSON.stringify([decisionEvent, teamLookup, methodologySearch, search]);
  assert.doesNotMatch(output, /FC Bayern München|Barcelona/);
  assert.deepEqual(decisionEvent, {
    phase: "decision",
    action: "finish",
    elapsedMs: 1,
    ok: true,
    targetTeamProvided: true,
  });
  assert.deepEqual((teamLookup as { filters: Record<string, unknown> }).filters, { teamNameProvided: true });
  assert.deepEqual((methodologySearch as { filters: Record<string, unknown> }).filters, {
    corpus: "methodology",
    queryProvided: true,
  });
  assert.deepEqual((search as { filters: Record<string, unknown> }).filters, {
    position: "ST",
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
    candidateIds: ["player-1"],
    playerNameFilterUsed: true,
    offset: 0,
    limit: 10,
    nextOffset: null,
  });
});

test("an empty expected-position result must be honestly explained before completing", () => {
  const singleRoleClarificationScenario = {
    ...clarificationScenario,
    answers: [clarificationScenario.answers[0]!],
  };
  delete singleRoleClarificationScenario.expectedBroadenedPosition;
  const events: RecruitmentTraceEvent[] = [
    tool("search_candidates", { position: "ST" }, { resultCount: 0, matchingRecordCount: 0 }),
  ];
  const firstTurnResponse = response({ threadId: "case-empty", status: "needs_input" });
  const completedWithoutExplanation = response({ threadId: "case-empty", targetTeam: "Bayern Munich", recommendations: [] });
  const missingExplanation = evaluateLocalAgentScenario({
    scenario: singleRoleClarificationScenario,
    events: [decision("search_candidates", "Bayern Munich"), ...events.slice(1)],
    firstTurnResponse,
    response: completedWithoutExplanation,
    firstTurnEvents: [tool("search_candidates", { position: "ST" }), decision("ask_user", "Bayern Munich")],
    continuedEvents: events,
    answersUsed: 1,
    threadId: "case-empty",
  });
  assert.equal(missingExplanation.checks.emptyExpectedPositionHandledHonestly, false);

  const explainedResponse = response({ threadId: "case-empty", targetTeam: "Bayern Munich", recommendations: [] });
  explainedResponse.report!.limitations.push("当前演示数据没有可用的中锋候选人。");
  const honestStop = evaluateLocalAgentScenario({
    scenario: singleRoleClarificationScenario,
    events,
    firstTurnResponse,
    response: explainedResponse,
    firstTurnEvents: [tool("search_candidates", { position: "ST" }), decision("ask_user", "Bayern Munich")],
    continuedEvents: events,
    answersUsed: 1,
    threadId: "case-empty",
  });
  assert.equal(honestStop.checks.emptyExpectedPositionHandledHonestly, true);
});

test("repeated-run summaries attribute Planner and tool latency without policy decisions", () => {
  const summary = summarizeEvaluationRuns([
    {
      checks: { behavior: true },
      elapsedMs: 200,
      operationLatencySamples: [
        { kind: "planner_action", operation: "finish", elapsedMs: 100 },
        { kind: "planner_action", operation: "search_candidates", elapsedMs: 20 },
        { kind: "planner_action", operation: "unresolved", elapsedMs: 42 },
        { kind: "policy_decision", operation: "search_candidates", elapsedMs: 0 },
        { kind: "tool", operation: "search_candidates", elapsedMs: 3 },
      ],
    },
    {
      checks: { behavior: true },
      elapsedMs: 100,
      operationLatencySamples: [
        { kind: "planner_action", operation: "finish", elapsedMs: 50 },
        { kind: "planner_action", operation: "search_candidates", elapsedMs: 40 },
        { kind: "policy_decision", operation: "search_candidates", elapsedMs: 0 },
        { kind: "tool", operation: "search_candidates", elapsedMs: 1 },
      ],
    },
  ]);

  assert.deepEqual(summary.operationLatencyMs, [
    { kind: "planner_action", operation: "finish", sampleCount: 2, p50: 50, p95: 100 },
    { kind: "planner_action", operation: "search_candidates", sampleCount: 2, p50: 20, p95: 40 },
    { kind: "planner_action", operation: "unresolved", sampleCount: 1, p50: 42, p95: 42 },
    { kind: "tool", operation: "search_candidates", sampleCount: 2, p50: 1, p95: 3 },
  ]);
});

test("repeated-run summaries show critical failures and nearest-rank latency percentiles", () => {
  const summary = summarizeEvaluationRuns([
    { checks: { evidence: true, sameCase: true }, elapsedMs: 100 },
    { checks: { evidence: false, sameCase: true }, elapsedMs: 200 },
    { checks: { evidence: true, sameCase: true }, elapsedMs: 300 },
    { checks: { evidence: true, sameCase: false }, elapsedMs: 400 },
  ]);

  assert.deepEqual(summary, {
    runCount: 4,
    passedRunCount: 2,
    passRate: 0.5,
    failedRunsByCheck: { evidence: 1, sameCase: 1 },
    latencyMs: { p50: 200, p95: 400 },
    operationLatencyMs: [],
  });
});

test("repeated-run summaries reject unknown operation names and invalid durations", () => {
  const run = (operation: string, elapsedMs: number) => [{
    checks: { behavior: true },
    elapsedMs: 10,
    operationLatencySamples: [{ kind: "planner_action" as const, operation, elapsedMs }],
  }];

  assert.throws(() => summarizeEvaluationRuns(run("invented_action", 10)), /operation latency samples/i);
  assert.throws(() => summarizeEvaluationRuns(run("finish", -1)), /operation latency samples/i);
  assert.throws(() => summarizeEvaluationRuns(run("finish", Number.NaN)), /operation latency samples/i);
  assert.throws(() => summarizeEvaluationRuns(run("finish", Number.POSITIVE_INFINITY)), /operation latency samples/i);
  assert.throws(() => summarizeEvaluationRuns([{
    checks: { behavior: true },
    elapsedMs: 10,
    operationLatencySamples: [{ kind: "tool", operation: "finish", elapsedMs: 1 }],
  }]), /operation latency samples/i);
});

test("repeated-run summaries count missing checks as failures and reject unscored runs", () => {
  const summary = summarizeEvaluationRuns([
    { checks: { evidence: true, sameCase: true }, elapsedMs: 10 },
    { checks: { evidence: true }, elapsedMs: 20 },
  ]);

  assert.equal(summary.passedRunCount, 1);
  assert.deepEqual(summary.failedRunsByCheck, { sameCase: 1 });
  assert.throws(() => summarizeEvaluationRuns([{ checks: {}, elapsedMs: 10 }]), /at least one check/);
});

test("the Harness rejects historical archive evidence linked to a different source player", () => {
  const threadId = "archive-identity-mismatch";
  const completed = response({ threadId });
  const report = completed.report!;
  const sourceIdentity = {
    provider: "fantasy-premier-league",
    playerId: "56",
    providerIdentifiers: [{ provider: "opta", namespace: "person_numeric", externalId: "173879", sourceField: "opta_code" }],
    retrievedAt: "2026-10-08T07:38:43.112Z",
    isCurrentSeason: true,
  };
  const candidate = { ...recommendation().player, sourceIdentity };
  const sample: HistoricalArchiveSample = {
    provider: "Wyscout Open Data",
    providerPlayerId: "343951",
    playerName: "Historical Player",
    team: "Historical Club",
    competition: "English first division",
    season: "2017/18",
    minutes: 1200,
    metrics: [],
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Wyscout Open Data",
    sourceUrl: "https://doi.org/10.1038/s41597-019-0247-7",
    identityLink: {
      reepReleaseStamp: "20261005T180536Z",
      reepId: "rp4d96f195ac93ea",
      sourceProvider: "fantasy-premier-league",
      sourcePlayerId: "57",
      sourceBridge: { provider: "opta", namespace: "person_numeric", externalId: "173879", sourceField: "opta_code" },
      sourceRung: "crosswalk",
      archiveRung: "name-dob",
      sourceUpstreamStatus: null,
      archiveUpstreamStatus: null,
    },
  };
  report.historicalArchiveCoverage = {
    status: "complete",
    disabledReason: null,
    checkedCandidates: 1,
    mappedCandidates: 1,
    matchedCandidates: 1,
    failedCandidates: 0,
  };
  report.historicalArchiveCandidates = [{ player: candidate, samples: [sample] }];
  const events = [tool("evaluate_candidates", {
    requestedPlayerCount: 1,
    evaluatedPlayerIds: [candidate.playerId],
    evaluatedMetricKeys: ["goals"],
  })];

  const evaluate = () => evaluateLocalAgentScenario({
    scenario: { id: "custom", message: "", answers: [], kind: "custom", requireClarificationResume: false },
    events,
    firstTurnResponse: response({ threadId, status: "needs_input" }),
    response: completed,
    firstTurnEvents: [],
    continuedEvents: events,
    answersUsed: 0,
    threadId,
  });

  assert.equal(evaluate().checks.historicalArchiveEvidenceIsConsistent, false);

  sample.identityLink.sourcePlayerId = sourceIdentity.playerId;
  assert.equal(evaluate().checks.historicalArchiveEvidenceIsConsistent, true);

  const originalRecommendation = report.recommendations[0]!;
  report.historicalArchiveCandidates = [];
  report.recommendations[0] = {
    ...originalRecommendation,
    player: candidate,
    historicalArchiveSamples: [sample],
  };
  assert.equal(evaluate().checks.historicalArchiveEvidenceIsConsistent, true);
  report.recommendations[0] = originalRecommendation;
  report.historicalArchiveCandidates = [{ player: candidate, samples: [sample] }];

  const evaluationEvent = events[0]!;
  if (evaluationEvent.phase === "tool") {
    evaluationEvent.filters.evaluatedPlayerIds = [];
    assert.equal(evaluate().checks.historicalArchiveEvidenceIsConsistent, false);
    evaluationEvent.filters.evaluatedPlayerIds = [candidate.playerId];
  }

  sample.identityLink.sourceBridge!.externalId = "wrong-opta-id";
  assert.equal(evaluate().checks.historicalArchiveEvidenceIsConsistent, false);
});
