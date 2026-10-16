import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecruitmentConversation,
  type RecruitmentAction,
  type RecruitmentPlanner,
  type RecruitmentTraceEvent,
} from "../src/agent/conversation.js";
import { createRecruitmentEvidenceEvaluator } from "../src/agent/recruitment-evidence-evaluator.js";
import { createWithheldRecruitmentEvidenceEvaluator } from "../src/evals/withheld-recruitment-evidence-evaluator.js";
import type { PlayerRepository } from "../src/data/provider.js";
import type { PlayerProfile } from "../src/domain/schemas.js";

const requestedMetricKey = "wyscoutGroundAttackingDuelsPer90" as const;

function fixturePlayer(): PlayerProfile {
  return {
    playerId: "fixture-forward",
    name: "Fixture Forward",
    team: "Harbor City",
    age: 22,
    position: "ST",
    competition: "Open League",
    season: "2025/26",
    minutes: 1800,
    stats: {
      goals: 8,
      assists: 2,
      passesAttempted: 200,
      passesCompleted: 140,
      longPasses: 8,
      carries: 30,
      pressures: 80,
      tackles: 3,
      interceptions: 2,
      shotAssists: 5,
    },
    supplementaryMetrics: [{
      key: requestedMetricKey,
      definition: "固定夹具中的地面进攻对抗事件数，按 90 分钟归一。",
      value: 4.5,
      unit: "次/90分钟",
      normalization: "per90",
      sourceField: "fixture.attacking_duels",
      sampleMinutes: 1800,
      sampleMatches: 20,
    }],
    source: "Wyscout Open Data fixture",
  };
}

function fixtureRepository(player: PlayerProfile): PlayerRepository {
  return {
    mode: "demo",
    sourceName: "Fixed evaluator fixture",
    async loadPlayers() { return [player]; },
  };
}

async function runFullGraph(evidenceWithheld: boolean, reviewerMode: "enabled" | "bypassed" = "enabled", misalignedEvidence = false) {
  const player = fixturePlayer();
  const repository = fixtureRepository(player);
  const events: RecruitmentTraceEvent[] = [];
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "进攻一对一对抗的比赛指标" },
    { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 20 },
    { action: "evaluate_candidates", playerIds: [player.playerId] },
  ];
  const planner: RecruitmentPlanner = {
    async decide(input) {
      const completedReportSearch = input.history.some((entry) => entry.role === "tool" && entry.toolName === "search_player_reports");
      if (input.decisionMode === "conclude" || completedReportSearch) {
        const observedCandidate = input.constraints?.evaluatedCandidates.find(({ playerId, evidenceKeys }) => (
          playerId === player.playerId && evidenceKeys.includes(requestedMetricKey)
        ));
        return {
          action: "finish",
          targetTeam: "巴萨",
          needSummary: "评估前锋的进攻一对一对抗表现。",
          capabilityProfile: ["进攻一对一对抗"],
          recommendations: evidenceWithheld
            ? [{ playerId: player.playerId, evidenceKeys: [requestedMetricKey] }]
            : observedCandidate
            ? [{ playerId: player.playerId, evidenceKeys: [misalignedEvidence ? "goals" : requestedMetricKey] }]
            : [],
          limitationKeys: ["other"],
        };
      }

      const action = actions.shift();
      assert.ok(action, `unexpected investigation decision: ${JSON.stringify(input.history.slice(-4))}`);
      return action;
    },
  };
  const baseEvaluator = createRecruitmentEvidenceEvaluator(repository);
  const conversation = createRecruitmentConversation({
    repository,
    planner,
    experimentalReviewerMode: reviewerMode,
    evidenceEvaluator: evidenceWithheld
      ? createWithheldRecruitmentEvidenceEvaluator(baseEvaluator)
      : baseEvaluator,
    knowledgeBase: { async search() { return []; } },
    observer(event) { events.push(event); },
  });

  const response = await conversation.turn({
    threadId: evidenceWithheld ? "evaluator-ablation-withheld" : "evaluator-ablation-enabled",
    message: "为巴萨找一名 23 岁以下前锋，重点考察进攻一对一对抗。",
  });

  assert.equal(response.status, "completed");
  assert.ok(response.report);
  return { report: response.report, events };
}

test("the full LangGraph report distinguishes observed evaluator evidence from an explicit withheld control", async () => {
  const enabled = await runFullGraph(false);
  const withheld = await runFullGraph(true);

  const enabledRecommendation = enabled.report.recommendations.find((candidate) => (
    candidate.focusEvidenceKeys.includes(requestedMetricKey)
  ));
  assert.ok(enabledRecommendation);
  assert.ok(enabledRecommendation.focusEvidenceKeys.every((key) => (
    enabledRecommendation.evidence.some((evidence) => evidence.key === key)
  )));
  assert.equal(enabled.report.evidenceCoverage.evidenceAvailability, "available");
  assert.ok(enabled.report.evidenceCoverage.availableMetricValues > 0);

  assert.equal(withheld.report.evidenceCoverage.evidenceAvailability, "experimentally_withheld");
  assert.deepEqual(withheld.report.requestedCapabilityCoverage, []);
  assert.equal(withheld.report.evidenceCoverage.availableMetricValues, 0);
  assert.equal(withheld.report.evidenceCoverage.expectedMetricValues, 0);
  assert.equal(withheld.report.recommendations.length, 0);
  assert.ok(withheld.report.limitations.some((limitation) => /实验.*有意屏蔽.*表现评估/.test(limitation)));
  assert.ok(!withheld.report.limitations.some((limitation) => /数据没有提供.*进攻一对一/.test(limitation)));
  assert.deepEqual(
    withheld.events.flatMap((event) => event.phase === "review" ? [event.outcome] : []),
    ["retry", "exhausted"],
    "the control arm must reject a Planner's attempted recommendation when it cites intentionally withheld evidence",
  );

  const enabledEvaluation = enabled.events.find((event) => event.phase === "tool" && event.toolName === "evaluate_candidates");
  const withheldEvaluation = withheld.events.find((event) => event.phase === "tool" && event.toolName === "evaluate_candidates");
  assert.equal(enabledEvaluation?.phase === "tool" ? enabledEvaluation.filters.evidenceAvailability : undefined, "available");
  assert.equal(withheldEvaluation?.phase === "tool" ? withheldEvaluation.filters.evidenceAvailability : undefined, "experimentally_withheld");
  assert.equal(withheldEvaluation?.phase === "tool" ? withheldEvaluation.filters.evaluatedMetricKeys?.length : undefined, 0);
  assert.equal(withheldEvaluation?.phase === "tool" ? withheldEvaluation.filters.evaluatedMetricValueCount : undefined, 0);
});


test("Reviewer ablation repairs an unrelated citation without changing candidate discovery or observed metrics", async () => {
  const enabled = await runFullGraph(false, "enabled", true);
  const bypassed = await runFullGraph(false, "bypassed", true);
  assert.deepEqual(enabled.report.recommendations.map(({ player }) => player.playerId), bypassed.report.recommendations.map(({ player }) => player.playerId));
  assert.deepEqual(enabled.report.evidenceCoverage, bypassed.report.evidenceCoverage);
  const tools = (events: RecruitmentTraceEvent[]) => events.flatMap((event) => event.phase === "tool"
    ? [{ toolName: event.toolName, filters: event.filters, resultCount: event.resultCount }]
    : []);
  assert.deepEqual(tools(enabled.events), tools(bypassed.events));
  assert.deepEqual(enabled.report.recommendations[0]?.focusEvidenceKeys, [requestedMetricKey]);
  assert.deepEqual(bypassed.report.recommendations[0]?.focusEvidenceKeys, ["goals"]);
  assert.ok(enabled.events.some((event) => event.phase === "review" && event.outcome === "passed" && (event.repairedEvidenceReferenceCount ?? 0) > 0));
  assert.ok(bypassed.events.some((event) => event.phase === "review" && event.outcome === "bypassed"));
});
