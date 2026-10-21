import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { type PlayerProfile } from "../../src/domain/players.js";
import { createRecruitmentConversation, type RecruitmentTraceEvent } from "../../src/recruitment/conversation.js";

const request = "为拜仁找一名 23 岁以下、英超 2024/25 赛季出场时间至少 900 分钟的中锋，重点看进球产出。";

function player(input: {
  playerId: string;
  name: string;
  position: PlayerProfile["position"];
  age: number;
  competition: string;
  season: string;
  minutes: number;
  goals: number;
}): PlayerProfile {
  return {
    ...input,
    team: "Fixture Club",
    stats: {
      goals: input.goals,
      assists: 2,
      passesAttempted: 200,
      passesCompleted: 140,
      longPasses: 8,
      carries: 30,
      pressures: 80,
      tackles: 3,
      interceptions: 2,
      shotAssists: 5,
      keyPasses: 4,
    },
    source: "Fixed candidate-policy ablation fixture",
  };
}

const eligible = player({
  playerId: "eligible-forward",
  name: "Eligible Forward",
  position: "ST",
  age: 22,
  competition: "英超",
  season: "2024/25",
  minutes: 1200,
  goals: 8,
});
const outsideScope = player({
  playerId: "outside-scope-forward",
  name: "Outside Scope Forward",
  position: "ST",
  age: 22,
  competition: "西甲",
  season: "2025/26",
  minutes: 300,
  goals: 10,
});
const sourcePlayers = [eligible, outsideScope];

async function runArm(policyMode?: "enabled" | "bypassed") {
  const candidateQueries: Array<{
    position: string | null;
    maxAge: number | null;
    minimumMinutes: number;
    competition: string | null;
    season: string | null;
  }> = [];
  const repositoryReads: string[][] = [];
  const reviewEvents: Array<Extract<RecruitmentTraceEvent, { phase: "review" }>> = [];
  const evaluatedIds: string[][] = [];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "Fixed candidate-policy ablation fixture",
      async searchCandidates(query) {
        candidateQueries.push({
          position: query.position,
          maxAge: query.maxAge,
          minimumMinutes: query.minimumMinutes,
          competition: query.competition,
          season: query.season,
        });
        const players = sourcePlayers.filter((candidate) => (
          (!query.position || candidate.position === query.position)
          && (query.maxAge === null || candidate.age <= query.maxAge)
          && candidate.minutes >= query.minimumMinutes
          && (!query.competition || candidate.competition === query.competition)
          && (!query.season || candidate.season === query.season)
        ));
        const appliedFilters: string[] = [];
        if (query.position) appliedFilters.push("position");
        if (query.maxAge !== null) appliedFilters.push("maxAge");
        if (query.minimumMinutes > 0) appliedFilters.push("minimumMinutes");
        if (query.competition) appliedFilters.push("competition");
        if (query.season) appliedFilters.push("season");
        return {
          players,
          totalRecords: players.length,
          offset: query.offset,
          nextOffset: null,
          appliedFilters,
        };
      },
      async getPlayersByIds(playerIds) {
        repositoryReads.push([...playerIds]);
        const wanted = new Set(playerIds);
        return sourcePlayers.filter(({ playerId }) => wanted.has(playerId));
      },
      async getComparisonPlayers() { return sourcePlayers; },
    },
    observer(event) {
      if (event.phase === "review") reviewEvents.push(event);
      if (event.phase === "tool" && event.toolName === "evaluate_candidates") {
        const ids = event.filters.evaluatedPlayerIds;
        if (Array.isArray(ids)) evaluatedIds.push(ids);
      }
    },
    planner: {
      async decide(input) {
        switch (plannerActions.length) {
          case 0:
            plannerActions.push("methodology");
            return { action: "search_methodology", query: "中锋进球产出的可观察证据" };
          case 1:
            plannerActions.push("candidate-search");
            return {
              action: "search_candidates",
              position: "ST",
              maxAge: 45,
              minimumMinutes: 0,
              competition: "西甲",
              season: "2025/26",
              offset: 0,
              limit: 20,
            };
          case 2:
            plannerActions.push("evaluation");
            return { action: "evaluate_candidates", playerIds: [eligible.playerId, outsideScope.playerId] };
          default:
            plannerActions.push("finish");
            const evaluatedPlayerIds = input.decisionSnapshot.constraints?.evaluatedCandidates.map(({ playerId }) => playerId) ?? [];
            return {
              action: "finish",
              targetTeam: "Other Club",
              needSummary: "寻找符合用户明确范围的中锋候选。",
              capabilityProfile: ["进球产出"],
              recommendations: evaluatedPlayerIds.map((playerId) => ({ playerId, evidenceKeys: ["goals" as const] })),
              limitationKeys: ["other"],
            };
        }
      },
    },
    knowledgeBase: { async search() { return []; } },
    ...(policyMode ? { experimentalCandidatePolicyMode: policyMode } : {}),
  });
  const plannerActions: string[] = [];
  const response = await conversation.turn({ threadId: randomUUID(), message: request });
  return { response, candidateQueries, repositoryReads, evaluatedIds, plannerActions, reviewEvents };
}

test("candidate action policy ablation cannot bypass hard search scope", async () => {
  const enabled = await runArm();
  const bypassed = await runArm("bypassed");

  assert.deepEqual(enabled.plannerActions, bypassed.plannerActions);
  assert.deepEqual(enabled.candidateQueries, [{
    position: "ST",
    maxAge: 23,
    minimumMinutes: 900,
    competition: "英超",
    season: "2024/25",
  }]);
  assert.deepEqual(bypassed.candidateQueries, enabled.candidateQueries,
    "the source query layer enforces current user conditions even when an experimental candidate policy is bypassed");

  assert.equal(enabled.response.status, "completed");
  assert.equal(bypassed.response.status, "completed");
  assert.deepEqual(enabled.response.report?.recommendations.map(({ player: candidate }) => candidate.playerId), [eligible.playerId]);
  assert.deepEqual(bypassed.response.report?.recommendations.map(({ player: candidate }) => candidate.playerId), [eligible.playerId]);
  assert.equal(enabled.response.report?.targetTeam, "拜仁");
  assert.equal(bypassed.response.report?.targetTeam, "拜仁", "the target club remains a hard case fact even when the candidate-action policy is bypassed");
  assert.deepEqual(enabled.reviewEvents.map(({ outcome }) => outcome), ["passed"]);
  assert.deepEqual(bypassed.reviewEvents.map(({ outcome }) => outcome), ["passed"]);
  assert.ok(enabled.repositoryReads.every((ids) => ids.every((id) => id === eligible.playerId)));
  assert.ok(bypassed.repositoryReads.every((ids) => !ids.includes(outsideScope.playerId)));
  assert.ok(enabled.evaluatedIds.every((ids) => ids.every((id) => id === eligible.playerId)));
  assert.ok(bypassed.evaluatedIds.every((ids) => !ids.includes(outsideScope.playerId)));
});
