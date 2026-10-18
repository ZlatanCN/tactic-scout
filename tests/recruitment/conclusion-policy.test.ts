import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod/v4";
import { FinishActionSchema, type ParsedRecruitmentAction } from "../../src/recruitment/recruitment-actions.js";
import {
  buildDecisionConstraints,
  alignRecommendationEvidenceToRequestedCapabilities,
  createConstrainedConclusionSchema,
  createConstrainedExpansionSchema,
  createConstrainedReorientationSchema,
  conclusionPlannerOutputFallback,
  expansionEvidenceIsSufficient,
  expansionPlannerFallback,
  requestedCapabilityEvidenceAreas,
  summarizeRequestedCapabilityCoverage,
  validateConclusion,
} from "../../src/recruitment/conclusion-policy.js";
import type { EvaluatedCandidate } from "../../src/recruitment/recruitment-evidence-evaluator.js";
import type { KnowledgeSearchResult } from "../../src/knowledge/schemas.js";

const candidate: EvaluatedCandidate = {
  player: {
    playerId: "candidate-1",
    name: "Jonas Vale",
    team: "Harbor City",
    age: 23,
    position: "ST",
    competition: "Open League",
    season: "2025/26",
    minutes: 1200,
    stats: { goals: 10, assists: 3, passesAttempted: 200, passesCompleted: 150, longPasses: 8, carries: 30, pressures: 90, tackles: 3, interceptions: 2, shotAssists: 11, keyPasses: 7 },
    source: "StatsBomb Open Data",
  },
  evidence: [{
    key: "goals",
    label: "进球",
    value: 0.75,
    unit: "每 90 分钟",
    peerPercentile: null,
    peerGroupSize: 2,
    minutes: 1200,
    competition: "Open League",
    season: "2025/26",
    source: "StatsBomb Open Data",
  }],
};

const playerReport: KnowledgeSearchResult = {
  id: "chunk-1",
  documentId: "report-1",
  corpus: "player_report",
  text: "Qualitative scouting observation.",
  title: "A report",
  url: "https://example.test/report-1",
  sourceId: "source-1",
  sourceName: "Example source",
  publisher: "Example publisher",
  author: "A scout",
  publishedAt: null,
  license: "CC BY 4.0",
  attribution: "A scout, report, CC BY 4.0.",
  entityIds: [],
  entityNames: ["Jonas Vale"],
  competition: null,
  season: null,
  displayAllowed: true,
};

const validFinish = () => FinishActionSchema.parse({
  action: "finish",
  targetTeam: "Barcelona",
  needSummary: "寻找具备终结能力的中锋。",
  capabilityProfile: ["终结"],
  recommendations: [{ playerId: candidate.player.playerId, evidenceKeys: ["goals"] }],
  limitationKeys: [],
  reportObservations: [{
    playerId: candidate.player.playerId,
    documentId: playerReport.documentId,
    summary: "报告提到前插时机",
    linkedMetricKeys: ["goals"],
  }],
});

test("requested capability mapping respects positive requests and nearby negation", () => {
  const requested = requestedCapabilityEvidenceAreas([
    "为拜仁找一个善于推进的中场；压迫不是重点。",
  ]);

  assert.deepEqual(requested.map(({ name }) => name), ["推进"]);
  assert.ok(requested[0]?.metricKeys.includes("wyscoutProgressivePassesPer90"));
  assert.deepEqual(requestedCapabilityEvidenceAreas(["寻找一名中场，不需要压迫能力。"]), []);
  assert.deepEqual(requestedCapabilityEvidenceAreas(["找一个推进和高位压迫都强的中场。"]).map(({ name }) => name), ["推进", "高位压迫适配"]);
  assert.deepEqual(requestedCapabilityEvidenceAreas(["希望中场能在高位压迫下控球。"]).map(({ name }) => name), ["压力下控球"]);
  assert.deepEqual(requestedCapabilityEvidenceAreas([
    "创造机会和无球跑动要强，也要有防守事件参与、射门机会质量、高强度跑动。",
  ]).map(({ name }) => name), ["创造机会", "无球跑动", "防守事件参与", "射门机会质量", "高强度跑动"]);
  const attackingEvidence = requestedCapabilityEvidenceAreas([
    "优先参与创造机会和进球。",
  ]);
  assert.deepEqual(attackingEvidence.map(({ name, metricKeys }) => ({ name, metricKeys })), [
    {
      name: "进球产出",
      metricKeys: ["goals", "premierLeagueGoalsPer90"],
    },
    {
      name: "创造机会",
      metricKeys: ["assists", "shotAssists", "keyPasses", "asaExpectedAssistsPer90", "fplExpectedAssistsPer90", "premierLeagueAssistsPer90", "premierLeagueKeyPassesPer90", "understatExpectedAssistsPer90", "understatKeyPassesPer90"],
    },
  ]);
  assert.deepEqual(requestedCapabilityEvidenceAreas(["Find a striker with strong goal scoring; xGoals is only a chance-quality proxy."])
    .filter(({ name }) => name === "进球产出").map(({ metricKeys }) => metricKeys), [["goals", "premierLeagueGoalsPer90"]]);
  assert.deepEqual(requestedCapabilityEvidenceAreas(["Compare xGoals per 90."]), []);
  assert.deepEqual(requestedCapabilityEvidenceAreas(["找一个能接应、做球和终结的前锋。"])
    .map(({ name, metricKeys }) => ({ name, metricKeys })), [
    { name: "射门终结", metricKeys: [] },
    { name: "进攻接应", metricKeys: [] },
  ]);
  const unsupported = requestedCapabilityEvidenceAreas(["希望球员能在压力下控球、保护防守空间、争顶、有射门终结能力并且加速快。"]);
  assert.deepEqual(unsupported.map(({ name, metricKeys }) => ({ name, metricKeys })), [
    { name: "射门终结", metricKeys: [] },
    { name: "压力下控球", metricKeys: [] },
    { name: "防守站位", metricKeys: [] },
    { name: "空中对抗", metricKeys: ["premierLeagueAerialDuelsWonPer90"] },
    { name: "速度与加速", metricKeys: [] },
  ]);
});

test("natural link-up and finishing requests do not become output-metric coverage", () => {
  const expectedAssists = {
    ...candidate.evidence[0]!,
    key: "fplExpectedAssistsPer90" as const,
    label: "FPL xA /90",
  };
  const coverage = summarizeRequestedCapabilityCoverage({
    userMessages: ["找一个能接应、做球和终结的前锋。"],
    evaluatedPlayers: [{ ...candidate, evidence: [candidate.evidence[0]!, expectedAssists] }],
  });

  assert.deepEqual(coverage.map(({ name, observedMetricKeys, candidatesWithEvidenceCount, status }) => ({
    name, observedMetricKeys, candidatesWithEvidenceCount, status,
  })), [
    { name: "射门终结", observedMetricKeys: [], candidatesWithEvidenceCount: 0, status: "missing" },
    { name: "进攻接应", observedMetricKeys: [], candidatesWithEvidenceCount: 0, status: "missing" },
  ]);
});

test("planner coverage summary distinguishes missing, partial, and observed requested metrics", () => {
  const secondCandidate: EvaluatedCandidate = {
    ...candidate,
    player: { ...candidate.player, playerId: "candidate-2", name: "Mikael Stone" },
    evidence: [{ ...candidate.evidence[0]!, key: "goals" }],
  };
  const creatorEvidence = {
    ...candidate.evidence[0]!,
    key: "shotAssists" as const,
    label: "射门助攻",
  };
  const creatorCandidate: EvaluatedCandidate = { ...candidate, evidence: [creatorEvidence] };
  const coverage = summarizeRequestedCapabilityCoverage({
    userMessages: ["找一个创造机会、善于推进，并且能在压力下控球的中场。"],
    evaluatedPlayers: [creatorCandidate, secondCandidate],
  });

  assert.deepEqual(coverage.map(({ name, observedMetricKeys, evaluatedCandidateCount, candidatesWithEvidenceCount, status }) => ({
    name, observedMetricKeys, evaluatedCandidateCount, candidatesWithEvidenceCount, status,
  })), [
    {
      name: "推进",
      observedMetricKeys: [],
      evaluatedCandidateCount: 2,
      candidatesWithEvidenceCount: 0,
      status: "missing",
    },
    {
      name: "创造机会",
      observedMetricKeys: ["shotAssists"],
      evaluatedCandidateCount: 2,
      candidatesWithEvidenceCount: 1,
      status: "partial",
    },
    {
      name: "压力下控球",
      observedMetricKeys: [],
      evaluatedCandidateCount: 2,
      candidatesWithEvidenceCount: 0,
      status: "missing",
    },
  ]);
});

test("decision constraints carry requested capability coverage to the Planner", () => {
  const constraints = buildDecisionConstraints({
    targetTeam: "Barcelona",
    userMessages: ["为巴萨找一个创造机会的中场。"],
    evaluatedPlayers: [candidate],
    retrievedKnowledge: [],
  });

  assert.deepEqual(constraints.requestedCapabilityCoverage, [{
    name: "创造机会",
    requestedMetricKeys: ["assists", "shotAssists", "keyPasses", "asaExpectedAssistsPer90", "fplExpectedAssistsPer90", "premierLeagueAssistsPer90", "premierLeagueKeyPassesPer90", "understatExpectedAssistsPer90", "understatKeyPassesPer90"],
    observedMetricKeys: [],
    evaluatedCandidateCount: 1,
    candidatesWithEvidenceCount: 0,
    status: "missing",
  }]);
});

test("conclusion schema permits only evaluated players, measured metrics, and retrieved report observations", () => {
  const schema = createConstrainedConclusionSchema(buildDecisionConstraints({
    targetTeam: "Barcelona",
    evaluatedPlayers: [candidate],
    retrievedKnowledge: [playerReport],
  }));
  assert.doesNotThrow(() => schema.parse(validFinish()));
  assert.throws(() => schema.parse({ ...validFinish(), targetTeam: "Bayern" }));
  assert.throws(() => schema.parse({
    ...validFinish(),
    recommendations: [{ playerId: "unevaluated-player", evidenceKeys: ["goals"] }],
  }));
  assert.throws(() => schema.parse({
    ...validFinish(),
    recommendations: [{ playerId: candidate.player.playerId, evidenceKeys: ["assists"] }],
  }));
  assert.throws(() => schema.parse({
    ...validFinish(),
    reportObservations: [{ playerId: candidate.player.playerId, documentId: "unretrieved-report", summary: "Unsupported", linkedMetricKeys: [] }],
  }));
});

test("conclusion bounds report observation text and count", () => {
  const reports = Array.from({ length: 4 }, (_, index) => ({
    ...playerReport,
    id: `chunk-${index + 1}`,
    documentId: `report-${index + 1}`,
  }));
  const schema = createConstrainedConclusionSchema(buildDecisionConstraints({
    targetTeam: "Barcelona",
    evaluatedPlayers: [candidate],
    retrievedKnowledge: reports,
  }));

  assert.throws(() => schema.parse({
    ...validFinish(),
    reportObservations: [{
      playerId: candidate.player.playerId,
      documentId: "report-1",
      summary: "x".repeat(281),
      linkedMetricKeys: [],
    }],
  }));
  assert.throws(() => schema.parse({
    ...validFinish(),
    reportObservations: reports.map(({ documentId }) => ({
      playerId: candidate.player.playerId,
      documentId,
      summary: "关键观察。",
      linkedMetricKeys: [],
    })),
  }));
});

test("conclusion schema requires an evidence-backed lead when requested metrics were observed", () => {
  const creatorCandidate: EvaluatedCandidate = {
    ...candidate,
    evidence: [
      candidate.evidence[0]!,
      {
        ...candidate.evidence[0]!,
        key: "asaExpectedAssistsPer90",
        label: "ASA xA /90",
        value: 0.24,
        source: "American Soccer Analysis",
      },
    ],
  };
  const constraints = buildDecisionConstraints({
    targetTeam: "Barcelona",
    userMessages: ["为巴萨找一个进球产出和创造机会都好的球员。"],
    evaluatedPlayers: [creatorCandidate],
    retrievedKnowledge: [playerReport],
  });
  const schema = createConstrainedConclusionSchema(constraints);
  const alignedFinish = {
    ...validFinish(),
    recommendations: [{
      playerId: candidate.player.playerId,
      evidenceKeys: ["goals", "asaExpectedAssistsPer90"],
    }],
  };

  assert.doesNotThrow(() => schema.parse(alignedFinish));
  assert.throws(() => schema.parse({ ...alignedFinish, recommendations: [] }));
  assert.throws(() => schema.parse({
    ...alignedFinish,
    recommendations: [{ playerId: candidate.player.playerId, evidenceKeys: ["pressures"] }],
  }));
});

test("conclusion schema stays compact as evaluated candidates grow", () => {
  const expectedAssists = {
    ...candidate.evidence[0]!,
    key: "fplExpectedAssistsPer90" as const,
    label: "FPL xA /90",
  };
  const candidates = Array.from({ length: 30 }, (_, index): EvaluatedCandidate => ({
    ...candidate,
    player: {
      ...candidate.player,
      playerId: `candidate-${index}`,
      name: `Candidate ${index}`,
    },
    evidence: [candidate.evidence[0]!, expectedAssists],
  }));
  const schema = createConstrainedConclusionSchema(buildDecisionConstraints({
    targetTeam: "Bayern",
    userMessages: ["找一个有进球产出并能创造机会的前锋。"],
    evaluatedPlayers: candidates,
    retrievedKnowledge: [],
  }));
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));

  assert.ok(jsonSchema.length < 20_000, `Expected a compact schema, received ${jsonSchema.length} characters.`);
  assert.doesNotThrow(() => schema.parse({
    ...validFinish(),
    targetTeam: "Bayern",
    recommendations: [{ playerId: "candidate-29", evidenceKeys: ["goals", "fplExpectedAssistsPer90"] }],
    reportObservations: [],
  }));
  assert.throws(() => schema.parse({
    ...validFinish(),
    targetTeam: "Bayern",
    recommendations: [{ playerId: "not-evaluated", evidenceKeys: ["goals"] }],
    reportObservations: [],
  }));
});

test("deterministic review catches metric references that do not belong to the named candidate", () => {
  const creatorEvidence = {
    ...candidate.evidence[0]!,
    key: "fplExpectedAssistsPer90" as const,
    label: "FPL xA /90",
  };
  const creator: EvaluatedCandidate = {
    ...candidate,
    player: { ...candidate.player, playerId: "creator", name: "Mikael Creator" },
    evidence: [creatorEvidence],
  };
  const action: ParsedRecruitmentAction = {
    ...validFinish(),
    recommendations: [{ playerId: candidate.player.playerId, evidenceKeys: ["fplExpectedAssistsPer90"] }],
    reportObservations: [],
  };

  const problems = validateConclusion({
    action,
    userMessages: ["找一个有进球产出并能创造机会的前锋。"],
    evaluatedPlayers: {
      [candidate.player.playerId]: candidate,
      [creator.player.playerId]: creator,
    },
    retrievedKnowledge: {},
  });

  assert.ok(problems.some((problem) => problem.includes("引用了不存在的证据")));
});

test("unobservable capabilities allow evidence-backed investigation leads instead of forcing an empty list", () => {
  const constraints = buildDecisionConstraints({
    targetTeam: "Barcelona",
    userMessages: ["为巴萨找一个射门终结能力好的中锋。"],
    evaluatedPlayers: [candidate],
    retrievedKnowledge: [playerReport],
  });
  const schema = createConstrainedConclusionSchema(constraints);

  assert.doesNotThrow(() => schema.parse(validFinish()));
  assert.deepEqual(validateConclusion({ action: validFinish(), userMessages: ["找终结和接应好的中锋"], evaluatedPlayers: { [candidate.player.playerId]: candidate }, retrievedKnowledge: { [playerReport.id]: playerReport } }), []);
});

test("review aligns recommendation references only to observed requested metrics", () => {
  const evidenceRichCandidate: EvaluatedCandidate = {
    ...candidate,
    evidence: [
      ...candidate.evidence,
      {
        ...candidate.evidence[0]!,
        key: "asaExpectedAssistsPer90",
        label: "ASA xA /90",
        value: 0.24,
        source: "American Soccer Analysis",
      },
      {
        ...candidate.evidence[0]!,
        key: "pressures",
        label: "压迫次数",
        value: 8,
      },
    ],
  };
  const malformedAction: ParsedRecruitmentAction = {
    ...validFinish(),
    recommendations: [{ playerId: candidate.player.playerId, evidenceKeys: ["pressures"] }],
  };
  const input = {
    action: malformedAction,
    userMessages: ["为巴萨寻找一名进球产出和创造机会能力都强的球员。"],
    evaluatedPlayers: { [candidate.player.playerId]: evidenceRichCandidate },
  };

  const aligned = alignRecommendationEvidenceToRequestedCapabilities(input);
  assert.ok(aligned.repairedReferenceCount > 0);
  assert.deepEqual(aligned.action?.action === "finish" ? aligned.action.recommendations[0]?.evidenceKeys : [], [
    "goals",
    "asaExpectedAssistsPer90",
  ]);
  assert.deepEqual(validateConclusion({
    ...input,
    action: aligned.action,
    retrievedKnowledge: { [playerReport.id]: playerReport },
  }), []);
});

test("expansion schema permits only the next page, a useful question, or a grounded conclusion", () => {
  const decisionConstraints = buildDecisionConstraints({
    targetTeam: "Barcelona",
    confirmedPosition: "ST",
    evaluatedPlayers: [candidate],
    retrievedKnowledge: [playerReport],
  });
  const schema = createConstrainedExpansionSchema(decisionConstraints, {
    targetTeam: "Barcelona",
    nextOffset: 20,
    position: "ST",
    playerName: null,
    maxAge: 25,
    minimumMinutes: 0,
    competition: null,
    season: null,
  });
  const nextPage = {
    action: "search_candidates",
    targetTeam: "Barcelona",
    position: "ST",
    playerName: null,
    maxAge: 25,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 20,
    limit: 20,
  };

  assert.doesNotThrow(() => schema.parse(nextPage));
  assert.throws(() => schema.parse({ ...nextPage, offset: 0 }));
  assert.throws(() => schema.parse({ ...nextPage, position: "ATT" }));
  assert.throws(() => schema.parse({
    action: "search_player_reports",
    targetTeam: "Barcelona",
    query: "重复搜索",
    playerNames: [candidate.player.name],
  }));
  assert.throws(() => schema.parse({
    ...validFinish(),
    recommendations: [{ playerId: "unevaluated-player", evidenceKeys: ["goals"] }],
  }));
  assert.throws(() => schema.parse({
    ...validFinish(),
    needSummary: "过长的总结。".repeat(60),
  }), "the expansion-stage finish keeps the model output bounded");
  const recoverySchema = createConstrainedExpansionSchema(decisionConstraints, {
    targetTeam: "Barcelona",
    nextOffset: 20,
    position: "ST",
    playerName: null,
    maxAge: 25,
    minimumMinutes: 0,
    competition: null,
    season: null,
  }, { allowAskUser: false });
  assert.throws(() => recoverySchema.parse({
    action: "ask_user",
    question: "是否接受跨联赛搜索？",
    reason: "扩大范围也许有帮助。",
  }));
  assert.doesNotThrow(() => recoverySchema.parse(nextPage));
});

test("an explicit replacement focus supersedes earlier attacking capabilities", () => {
  const areas = requestedCapabilityEvidenceAreas([
    "找前锋，重点看终结、接应和做球",
    "改成帮拜仁找后卫，重点看防守和出球，不设年龄上限。",
  ]);
  assert.deepEqual(areas, [
    { name: "整体防守", metricKeys: [] },
    { name: "后场出球", metricKeys: [] },
  ]);
  assert.deepEqual(requestedCapabilityEvidenceAreas([
    "找推进强的中场", "改为23岁以下，优先英超。",
  ]).map(({ name }) => name), ["推进"]);
});

test("expansion fallback follows the exact next page only for measurable coverage gaps", () => {
  const baseConstraints = buildDecisionConstraints({
    targetTeam: "Barcelona",
    confirmedPosition: "ST",
    userMessages: ["为巴萨找前锋，重点看进球产出"],
    evaluatedPlayers: [candidate],
    retrievedKnowledge: [],
  });
  const expansionConstraints = {
    targetTeam: "Barcelona",
    nextOffset: 40,
    position: "ST" as const,
    playerName: null,
    maxAge: 25,
    minimumMinutes: 600,
    competition: "La Liga",
    season: "2025/26",
  };
  const partialConstraints = {
    ...baseConstraints,
    requestedCapabilityCoverage: [{
      name: "进球产出",
      requestedMetricKeys: ["goals" as const],
      observedMetricKeys: ["goals" as const],
      evaluatedCandidateCount: 10,
      candidatesWithEvidenceCount: 5,
      status: "partial" as const,
    }],
  };

  assert.deepEqual(expansionPlannerFallback({
    decisionConstraints: partialConstraints,
    expansionConstraints,
  }), {
    action: "search_candidates",
    targetTeam: "Barcelona",
    position: "ST",
    playerName: null,
    maxAge: 25,
    minimumMinutes: 600,
    competition: "La Liga",
    season: "2025/26",
    offset: 40,
    limit: 20,
  });

  const completeConstraints = {
    ...baseConstraints,
    requestedCapabilityCoverage: [{
      ...partialConstraints.requestedCapabilityCoverage[0]!,
      evaluatedCandidateCount: 1,
      candidatesWithEvidenceCount: 1,
      status: "observed" as const,
    }],
  };
  const finished = expansionPlannerFallback({
    decisionConstraints: completeConstraints,
    expansionConstraints,
  });
  assert.equal(finished.action, "finish");
  assert.match(finished.action === "finish" ? finished.needSummary : "", /Barcelona.*进球产出/);
  assert.deepEqual(finished.action === "finish" ? finished.recommendations : [], [
    { playerId: candidate.player.playerId, evidenceKeys: ["goals"] },
  ]);

  const structurallyUnavailableConstraints = {
    ...baseConstraints,
    requestedCapabilityCoverage: [{
      name: "终结",
      requestedMetricKeys: [],
      observedMetricKeys: [],
      evaluatedCandidateCount: 1,
      candidatesWithEvidenceCount: 0,
      status: "missing" as const,
    }],
  };
  const unavailable = expansionPlannerFallback({
    decisionConstraints: structurallyUnavailableConstraints,
    expansionConstraints,
  });
  assert.equal(unavailable.action, "finish");
  assert.deepEqual(unavailable.action === "finish" ? unavailable.recommendations : [], [{ playerId: candidate.player.playerId, evidenceKeys: ["goals"] }]);

  const outputLimited = conclusionPlannerOutputFallback(completeConstraints);
  assert.equal(outputLimited.action, "finish");
  assert.deepEqual(outputLimited.action === "finish" ? outputLimited.recommendations : [], [
    { playerId: candidate.player.playerId, evidenceKeys: ["goals"] },
  ]);
  assert.match(outputLimited.action === "finish" ? outputLimited.needSummary : "", /输出达到长度上限/);
  assert.match(outputLimited.action === "finish" ? outputLimited.needSummary : "", /Barcelona.*进球产出/);
});

test("reorientation schema allows a new candidate scope without reopening completed report retrieval", () => {
  const constraints = buildDecisionConstraints({
    targetTeam: "Barcelona",
    evaluatedPlayers: [candidate],
    retrievedKnowledge: [playerReport],
  });
  const schema = createConstrainedReorientationSchema(constraints);

  assert.doesNotThrow(() => schema.parse({
    action: "search_candidates",
    targetTeam: "Barcelona",
    position: "DEF",
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 20,
  }));
  assert.throws(() => schema.parse({
    action: "search_player_reports",
    targetTeam: "Barcelona",
    query: "重复报告搜索",
    playerNames: [candidate.player.name],
  }));
  assert.throws(() => schema.parse({
    ...validFinish(),
    recommendations: [{ playerId: "unevaluated-player", evidenceKeys: ["goals"] }],
  }));
});

test("conclusion constraints only expose displayable player reports that match the evaluated player", () => {
  const constraints = buildDecisionConstraints({
    targetTeam: null,
    evaluatedPlayers: [candidate],
    retrievedKnowledge: [
      playerReport,
      { ...playerReport, id: "chunk-2", documentId: "hidden-report", displayAllowed: false },
      { ...playerReport, id: "chunk-3", documentId: "other-player-report", entityNames: ["Different Player"] },
    ],
  });

  assert.deepEqual(constraints.reportObservations.map(({ documentId }) => documentId), ["report-1"]);
});

test("first-party observations can match a player by provider identity when the observation stores that ID", () => {
  const providerCandidate: EvaluatedCandidate = {
    ...candidate,
    player: {
      ...candidate.player,
      playerId: "sportmonks:123:team:4:season:2025",
      sourceIdentity: {
        provider: "sportmonks",
        playerId: "123",
        teamId: "4",
        seasonId: "2025",
        retrievedAt: "2026-10-04T10:00:00.000Z",
      },
    },
  };
  const providerObservation = {
    ...playerReport,
    documentId: "provider-observation",
    entityIds: ["sportmonks:123"],
    entityNames: ["An older alias"],
  };
  const mismatchedIdObservation = {
    ...playerReport,
    id: "chunk-mismatched-provider-id",
    documentId: "mismatched-provider-id",
    entityIds: ["sportmonks:456"],
    entityNames: ["Jonas Vale"],
  };
  const constraints = buildDecisionConstraints({
    targetTeam: null,
    evaluatedPlayers: [providerCandidate],
    retrievedKnowledge: [providerObservation, mismatchedIdObservation],
  });

  assert.deepEqual(constraints.reportObservations.map(({ documentId }) => documentId), ["provider-observation"]);
});

test("observations without stable IDs use exact names only when the evaluated candidate name is unique", () => {
  const sameNameCandidate: EvaluatedCandidate = {
    ...candidate,
    player: { ...candidate.player, playerId: "candidate-2" },
  };
  const constraints = buildDecisionConstraints({
    targetTeam: null,
    evaluatedPlayers: [candidate, sameNameCandidate],
    retrievedKnowledge: [playerReport],
  });

  assert.deepEqual(constraints.reportObservations, []);
});

test("an observation alias that matches another candidate name is treated as ambiguous", () => {
  const aliasCandidate: EvaluatedCandidate = {
    ...candidate,
    player: { ...candidate.player, playerId: "candidate-alias", name: "An older alias" },
  };
  const aliasedObservation = {
    ...playerReport,
    documentId: "ambiguous-alias-report",
    entityNames: ["An older alias", "Jonas Vale"],
  };
  const constraints = buildDecisionConstraints({
    targetTeam: null,
    evaluatedPlayers: [candidate, aliasCandidate],
    retrievedKnowledge: [aliasedObservation],
  });

  assert.deepEqual(constraints.reportObservations, []);
});

test("deterministic conclusion review rejects duplicate candidates and mismatched report entities", () => {
  const action = validFinish();
  const duplicateRecommendation: ParsedRecruitmentAction = {
    ...action,
    recommendations: [
      ...action.recommendations,
      { playerId: candidate.player.playerId, evidenceKeys: ["goals"] },
    ],
  };
  const problems = validateConclusion({
    action: duplicateRecommendation,
    evaluatedPlayers: { [candidate.player.playerId]: candidate },
    retrievedKnowledge: { [playerReport.id]: { ...playerReport, entityNames: ["Different Player"] } },
  });

  assert.ok(problems.some((problem) => problem.includes("重复推荐")));
  assert.ok(problems.some((problem) => problem.includes("实体元数据不匹配")));
});

test("evidence review rejects unrelated recommendation metrics when requested progression data is available", () => {
  const progressionCandidate: EvaluatedCandidate = {
    ...candidate,
    player: { ...candidate.player, minutes: 69 },
    evidence: [...candidate.evidence, {
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
      source: "Wyscout Open Data",
    }],
  };
  const input = {
    action: validFinish(),
    userMessages: ["为巴萨找一名推进和前场压迫能力强的中场。"],
    evaluatedPlayers: { [candidate.player.playerId]: progressionCandidate },
    retrievedKnowledge: { [playerReport.id]: playerReport },
  };

  const unrelatedEvidenceProblems = validateConclusion(input);
  assert.ok(unrelatedEvidenceProblems.some((problem) => (
    problem.includes("推进") && problem.includes("wyscoutProgressivePassesPer90")
  )));

  const alignedAction = {
    ...validFinish(),
    recommendations: [{ playerId: candidate.player.playerId, evidenceKeys: ["wyscoutProgressivePassesPer90" as const] }],
  };
  assert.equal(validateConclusion({ ...input, action: alignedAction }).some((problem) => problem.includes("推进")), false);
});

test("expansion recovery preserves three jointly evidenced leads instead of expanding merely because other records lack metrics", () => {
  const decisionConstraints = {
    targetTeam: "Barcelona",
    evaluatedCandidates: [
      ...Array.from({ length: 3 }, (_, index) => ({ playerId: `supported-${index}`, evidenceKeys: ["goals", "assists"] as const })),
      { playerId: "missing", evidenceKeys: [] },
    ].map(item => ({ ...item, evidenceKeys: [...item.evidenceKeys] })),
    reportObservations: [],
    requestedCapabilityCoverage: ["goals", "assists"].map(key => ({ name: key, requestedMetricKeys: [key as "goals" | "assists"], observedMetricKeys: [key as "goals" | "assists"], evaluatedCandidateCount: 4, candidatesWithEvidenceCount: 3, status: "partial" as const })),
  };
  const expansionConstraints = { targetTeam: "Barcelona", nextOffset: 20, position: "ST" as const, playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null };
  const recovered = expansionPlannerFallback({ decisionConstraints, expansionConstraints });
  const continued = expansionPlannerFallback({ decisionConstraints, expansionConstraints, preserveExistingEvidence: false });
  assert.equal(continued.action, "search_candidates");
  const insufficient = expansionPlannerFallback({ decisionConstraints: { ...decisionConstraints, evaluatedCandidates: decisionConstraints.evaluatedCandidates.slice(0, 2) }, expansionConstraints });
  assert.equal(insufficient.action, "search_candidates", "coverage counts cannot substitute for three jointly evidenced records");
  if (continued.action === "search_candidates") assert.equal(continued.offset, 20);
  assert.equal(recovered.action, "finish");
  if (recovered.action === "finish") {
    assert.deepEqual(recovered.recommendations.map(item => item.playerId), ["supported-0", "supported-1", "supported-2"]);
    assert.match(recovered.needSummary, /扩围未能完成/);
  }
});

test("recovery fallback counts and recommends each verified candidate identity once", () => {
  const decisionConstraints = {
    targetTeam: "Barcelona",
    evaluatedCandidates: Array.from({ length: 4 }, (_, index) => ({
      playerId: `complete-${index}`,
      evidenceKeys: ["goals", "assists"] as const,
    })).map(item => ({ ...item, evidenceKeys: [...item.evidenceKeys] })),
    reportObservations: [],
    requestedCapabilityCoverage: ["goals", "assists"].map(key => ({
      name: key,
      requestedMetricKeys: [key as "goals" | "assists"],
      observedMetricKeys: [key as "goals" | "assists"],
      evaluatedCandidateCount: 4,
      candidatesWithEvidenceCount: 3,
      status: "partial" as const,
    })),
    candidateIdentityGroups: [{
      identityKey: "reep:one-player",
      status: "resolved" as const,
      registryAvailable: true,
      reepId: "one-player",
      releaseStamp: "fixture",
      recordPlayerIds: ["complete-0", "complete-1"],
    }],
  };
  const expansionConstraints = {
    targetTeam: "Barcelona",
    nextOffset: 20,
    position: "ST" as const,
    playerName: null,
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
  };

  const threeRecordLeads = expansionPlannerFallback({
    decisionConstraints: {
      ...decisionConstraints,
      evaluatedCandidates: decisionConstraints.evaluatedCandidates.slice(0, 3),
    },
    expansionConstraints,
  });
  assert.equal(threeRecordLeads.action, "search_candidates", "three records do not establish three independent candidates");

  const recovered = expansionPlannerFallback({ decisionConstraints, expansionConstraints });
  assert.equal(recovered.action, "finish");
  if (recovered.action === "finish") {
    assert.deepEqual(
      recovered.recommendations.map(({ playerId }) => playerId),
      ["complete-0", "complete-2", "complete-3"],
    );
  }
});

test("three records covering every measurable request make expansion evidence sufficient", () => {
  const decisionConstraints = {
    targetTeam: "Barcelona",
    evaluatedCandidates: [
      ...Array.from({ length: 3 }, (_, index) => ({
        playerId: `complete-${index}`,
        evidenceKeys: ["goals", "assists"] as const,
      })),
      { playerId: "incomplete", evidenceKeys: ["goals"] as const },
    ].map(item => ({ ...item, evidenceKeys: [...item.evidenceKeys] })),
    reportObservations: [],
    requestedCapabilityCoverage: ["goals", "assists"].map(key => ({
      name: key,
      requestedMetricKeys: [key as "goals" | "assists"],
      observedMetricKeys: [key as "goals" | "assists"],
      evaluatedCandidateCount: 4,
      candidatesWithEvidenceCount: 3,
      status: "partial" as const,
    })),
  };
  const expansionConstraints = {
    targetTeam: "Barcelona",
    nextOffset: 20,
    position: "DEF" as const,
    playerName: null,
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
  };

  assert.equal(expansionEvidenceIsSufficient(decisionConstraints), true);
  assert.equal(expansionEvidenceIsSufficient({
    ...decisionConstraints,
    evaluatedCandidates: decisionConstraints.evaluatedCandidates.slice(0, 2),
  }), false);
  assert.equal(expansionEvidenceIsSufficient({
    ...decisionConstraints,
    requestedCapabilityCoverage: decisionConstraints.requestedCapabilityCoverage.slice(0, 1),
  }), false, "one measurable area can retain a material planning question");
  assert.equal(expansionEvidenceIsSufficient({
    ...decisionConstraints,
    requestedCapabilityCoverage: decisionConstraints.requestedCapabilityCoverage.map(area => ({
      ...area,
      requestedMetricKeys: [],
    })),
  }), false, "qualitative-only requests remain a Planner judgment");
  assert.equal(expansionEvidenceIsSufficient({
    ...decisionConstraints,
    candidateIdentityGroups: [{
      identityKey: "reep:one-player",
      status: "resolved",
      registryAvailable: true,
      reepId: "one-player",
      releaseStamp: "fixture",
      recordPlayerIds: ["complete-0", "complete-1"],
    }],
  }), false, "two source records cannot become two independent candidates");
});
