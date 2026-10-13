import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createRecruitmentConversation } from "../src/agent/conversation.js";
import type { PlayerSearchQuery } from "../src/data/player-search.js";
import type { PlayerProfile } from "../src/domain/schemas.js";

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
        const latestUserIndex = input.history.map((entry) => entry.role === "user").lastIndexOf(true);
        const currentTurn = input.history.slice(latestUserIndex + 1);
        const currentMessage = input.history[latestUserIndex]?.content ?? "";
        const tools = new Set(currentTurn.filter((entry) => entry.role === "tool").map((entry) => entry.toolName));
        if (!tools.has("search_methodology")) {
          return { action: "search_methodology", query: "中锋进球产出的可观察比赛证据" };
        }

        const isReturnToPremierLeague = currentMessage.includes("只看英超");
        if (isReturnToPremierLeague && !tools.has("search_candidates")) {
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

        if (!tools.has("search_candidates")) {
          return {
            action: "search_candidates",
            position: "ST",
            maxAge: 23,
            competition: currentMessage.includes("改看德甲") ? "德甲" : "英超",
            limit: 20,
          };
        }
        if (!tools.has("evaluate_candidates")) {
          return { action: "evaluate_candidates", playerIds: latestSearchResult.map(({ playerId }) => playerId) };
        }
        const currentCandidateId = latestSearchResult[0]?.playerId ?? firstPremierLeagueRecord.playerId;
        return {
          action: "finish",
          targetTeam: "拜仁",
          needSummary: "寻找符合年龄和赛事要求的中锋候选。",
          capabilityProfile: ["进球产出"],
          recommendations: [{ playerId: currentCandidateId, evidenceKeys: ["goals"] }],
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

test("fresh-scope observation ablation requires a new query to recommend after returning to a prior scope", async () => {
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
  assert.deepEqual(enabled.returnToPremierLeagueFinishProposal, bypassed.returnToPremierLeagueFinishProposal);
  assert.deepEqual(enabled.third.report?.recommendations.map(({ player: candidate }) => candidate.playerId), [
    refreshedPremierLeagueRecord.playerId,
  ]);
  assert.deepEqual(bypassed.third.report?.recommendations, []);
  assert.ok(bypassed.third.report?.limitations.some((limitation) => limitation.includes("重复提出")));
});
