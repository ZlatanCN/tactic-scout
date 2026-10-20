import assert from "node:assert/strict";
import test from "node:test";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import { createSinglePassInvestigationPlanner } from "../../src/evaluation/fixed-investigation-planner.js";
import type { HistoricalArchiveSetup } from "../../src/sources/reep/historical-archive-enrichment.js";
import { roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("parallel enrichment waits for the surviving branch when optional archive enrichment fails", async () => {
  const player = {
    ...roleConstraintPlayer("parallel-enrichment-failure", "Parallel Failure Candidate", "MID"),
    source: "API-Football",
    sourceIdentity: {
      provider: "apifootball",
      playerId: "elo-parallel-01",
      competitionId: "open-league",
      seasonId: "2025",
      positionGroup: "MID" as const,
      retrievedAt: "2026-10-19T00:00:00.000Z",
    },
  };
  const historicalArchiveSetup: HistoricalArchiveSetup = {
    status: "ready",
    coverage: { status: "not_run", disabledReason: null, checkedCandidates: 0, mappedCandidates: 0, matchedCandidates: 0, failedCandidates: 0 },
    async validate() { return { releaseStamp: "frozen", archivePlayerRecords: 1 }; },
    async enrich() {
      await delay(5);
      throw new Error("optional frozen archive source failed");
    },
  };
  const playerEloClient = {
    async getPlayer(id: string) {
      await delay(100);
      return {
        player_id: id,
        player_name: player.name,
        elo: 1642,
        position: "Midfielder",
        position_group: "Midfielder",
        current_team: player.team,
        current_team_id: "team-01",
        current_league: "Open League",
        current_league_id: "league-01",
        ear_label: "Strong",
        player_type: "senior",
        current_rank: 1,
        games_played: 20,
        total_minutes: 1800,
        ear_career: null,
        ear_label_12m: null,
        ear_12m: null,
        ear_label_180: null,
        ear_180: null,
        retrievedAt: "2026-10-19T00:00:00.000Z",
      };
    },
  };
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Frozen parallel fixture", async loadPlayers() { return [player]; } },
    planner: createSinglePassInvestigationPlanner({
      async decide() {
        return {
          action: "finish",
          targetTeam: "巴萨",
          needSummary: "测试一个可选 enrichment 失败时保留另一个结果。",
          capabilityProfile: ["进球"],
          recommendations: [{ playerId: player.playerId, evidenceKeys: ["goals"] }],
          limitationKeys: ["other"],
        };
      },
    }),
    knowledgeBase: { async search() { return []; } },
    experimentalReviewerMode: "bypassed",
    runtime: {
      playerEloSetup: { status: "enabled", client: playerEloClient as never },
      historicalArchiveSetup,
    },
  });

  const response = await conversation.turn({
    threadId: "parallel-enrichment-failed-archive",
    message: "为巴萨找一名重点看推进能力的中场。",
  });

  assert.equal(response.status, "completed");
  assert.equal(response.report?.recommendations.length, 1);
  assert.equal(response.report?.historicalArchiveCoverage.status, "failed");
  assert.equal(response.report?.externalSignalCoverage.status, "complete");
  assert.equal(response.report?.recommendations[0]?.externalSignals.length, 1);
});
