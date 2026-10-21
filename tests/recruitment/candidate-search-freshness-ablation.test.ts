import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import type { PlayerSearchQuery } from "../../src/players/search.js";
import { type PlayerProfile } from "../../src/domain/players.js";

function player(playerId: string, competition: string): PlayerProfile {
  return {
    playerId,
    name: playerId,
    age: 22,
    position: "ST",
    team: `${competition} Club`,
    competition,
    season: "2025/26",
    minutes: 1_200,
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
      keyPasses: 4,
    },
    source: "Fixed freshness-ablation fixture",
  };
}

const firstPremierLeagueRecord = player("first-premier-league-record", "英超");
const bundesligaRecord = player("bundesliga-record", "德甲");
const refreshedPremierLeagueRecord = player("refreshed-premier-league-record", "英超");
const allRecords = [firstPremierLeagueRecord, bundesligaRecord, refreshedPremierLeagueRecord];

async function runArm(candidateSearchFreshnessMode?: "enabled" | "bypassed") {
  const candidateQueries: Array<Pick<PlayerSearchQuery,
    "playerName" | "position" | "maxAge" | "minimumMinutes" | "competition" | "season">> = [];
  let returnToPremierLeagueFinishProposal: Record<string, unknown> | null = null;
  let premierLeagueSearches = 0;
  let latestSearchResult: PlayerProfile[] = [];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "Fixed freshness-ablation fixture",
      async searchCandidates(query) {
        candidateQueries.push({
          playerName: query.playerName,
          position: query.position,
          maxAge: query.maxAge,
          minimumMinutes: query.minimumMinutes,
          competition: query.competition,
          season: query.season,
        });
        let players: PlayerProfile[];
        if (query.competition === "德甲") {
          players = [bundesligaRecord];
        } else if (query.competition === "英超") {
          premierLeagueSearches += 1;
          players = premierLeagueSearches === 1
            ? [firstPremierLeagueRecord]
            : [refreshedPremierLeagueRecord];
        } else {
          players = [];
        }
        latestSearchResult = players;
        return {
          players,
          totalRecords: players.length,
          offset: query.offset,
          nextOffset: null,
          appliedFilters: ["position", "maxAge", "competition"],
        };
      },
      async getPlayersByIds(playerIds) {
        const ids = new Set(playerIds);
        return allRecords.filter(({ playerId }) => ids.has(playerId));
      },
      async getComparisonPlayers() { return allRecords; },
    },
    planner: {
      async decide(input) {
        const snapshot = input.decisionSnapshot;
        const progress = input.caseProgress as { hasSearchedMethodology?: boolean; currentTurnCandidatePages?: unknown[] };
        const currentMessage = snapshot.case.latestUserRequest;
        if (!progress.hasSearchedMethodology) {
          return { action: "search_methodology", query: "中锋进球产出的可观察比赛证据" };
        }

        const isReturnToPremierLeague = currentMessage.includes("只看英超");
        if (isReturnToPremierLeague && !progress.currentTurnCandidatePages?.length && candidateSearchFreshnessMode === "bypassed") {
          const action = {
            action: "finish",
            targetTeam: "拜仁",
            needSummary: "寻找符合年龄和赛事要求的中锋候选。",
            capabilityProfile: ["进球产出"],
            recommendations: [{ playerId: firstPremierLeagueRecord.playerId, evidenceKeys: ["goals"] }],
            limitationKeys: ["other"],
          };
          returnToPremierLeagueFinishProposal ??= action;
          return action;
        }

        if (!progress.currentTurnCandidatePages?.length) {
          return {
            action: "search_candidates",
            position: "ST",
            maxAge: 23,
            competition: currentMessage.includes("改看德甲") ? "德甲" : "英超",
            limit: 20,
          };
        }
        const pending = snapshot.candidates.eligiblePlayerIds.filter((playerId) => (
          !snapshot.candidates.evaluatedPlayerIds.includes(playerId)
        ));
        if (pending.length) {
          return { action: "evaluate_candidates", playerIds: pending };
        }
        const currentCandidateId = isReturnToPremierLeague
          ? latestSearchResult[0]?.playerId
          : snapshot.constraints?.evaluatedCandidates[0]?.playerId;
        return {
          action: "finish",
          targetTeam: "拜仁",
          needSummary: "寻找符合年龄和赛事要求的中锋候选。",
          capabilityProfile: ["进球产出"],
          recommendations: currentCandidateId ? [{ playerId: currentCandidateId, evidenceKeys: ["goals"] }] : [],
          limitationKeys: ["other"],
        };
      },
    },
    knowledgeBase: { async search() { return []; } },
    experimentalCandidatePolicyMode: "bypassed",
    ...(candidateSearchFreshnessMode ? { experimentalCandidateSearchFreshnessMode: candidateSearchFreshnessMode } : {}),
  });

  const threadId = randomUUID();
  const first = await conversation.turn({ threadId, message: "为拜仁找 23 岁以下的英超中锋" });
  const second = await conversation.turn({ threadId, message: "保留年龄要求，改看德甲" });
  const third = await conversation.turn({ threadId, message: "保留年龄要求，现在只看英超" });
  return { first, second, third, candidateQueries, returnToPremierLeagueFinishProposal };
}

test("fresh-scope observation requires a new query and evaluates its current result before recommending", async () => {
  const enabled = await runArm();
  const bypassed = await runArm("bypassed");

  assert.equal(enabled.first.status, "completed");
  assert.equal(enabled.second.status, "completed");
  assert.equal(enabled.third.status, "completed");
  assert.equal(bypassed.third.status, "completed");
  assert.deepEqual(enabled.candidateQueries, [
    { playerName: null, position: "ST", maxAge: 23, minimumMinutes: 0, competition: "英超", season: null },
    { playerName: null, position: "ST", maxAge: 23, minimumMinutes: 0, competition: "德甲", season: null },
    { playerName: null, position: "ST", maxAge: 23, minimumMinutes: 0, competition: "英超", season: null },
  ]);
  assert.deepEqual(bypassed.candidateQueries, [
    { playerName: null, position: "ST", maxAge: 23, minimumMinutes: 0, competition: "英超", season: null },
    { playerName: null, position: "ST", maxAge: 23, minimumMinutes: 0, competition: "德甲", season: null },
  ]);
  assert.equal(enabled.returnToPremierLeagueFinishProposal, null, "the enabled arm researches and evaluates the fresh result before final planning");
  assert.deepEqual(bypassed.returnToPremierLeagueFinishProposal?.recommendations, [{
    playerId: firstPremierLeagueRecord.playerId,
    evidenceKeys: ["goals"],
  }]);
  assert.deepEqual(enabled.third.report?.recommendations.map(({ player: candidate }) => candidate.playerId), [
    refreshedPremierLeagueRecord.playerId,
  ]);
  assert.deepEqual(bypassed.third.report?.recommendations, [], "the ablated arm cannot turn its stale proposal into a recommendation");
  assert.ok(bypassed.third.report?.limitations.some((limitation) => limitation.includes("没有沿用旧名单")));
});
