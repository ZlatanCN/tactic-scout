import type { PlayerProfile } from "../../../src/domain/players.js";

export { MemorySaver } from "@langchain/langgraph";
export { createApp } from "../../../src/app.js";
export { MultiSourceCurrentPlayerRepository } from "../../../src/sources/mosaic/provider.js";
export {
  createRecruitmentConversation,
  RecruitmentCaseStateExpiredError,
  RecruitmentModelTimeoutError,
  RecruitmentPlannerOutputError,
  unavailableRecruitmentConversation,
} from "../../../src/recruitment/conversation.js";
export type {
  RecruitmentAction,
  RecruitmentConversation,
  RecruitmentPlanner,
  RecruitmentTraceEvent,
} from "../../../src/recruitment/conversation.js";
export { createSinglePassInvestigationPlanner } from "../../../src/evaluation/fixed-investigation-planner.js";
export type { PlayerRepository, PlayerSearchFilter, PlayerSearchQuery } from "../../../src/sources/registry.js";
export type { PlayerProfile } from "../../../src/domain/players.js";
export type { KnowledgeSearchResult } from "../../../src/knowledge/schemas.js";

export function installRecruitmentConversationTestEnvironment(): () => void {
  const previousStatsBombProcessingPermission = process.env.TACTISCOUT_STATSBOMB_AI_PROCESSING_ALLOWED;
  const previousModelEndpoint = process.env.OPENAI_BASE_URL;
  process.env.TACTISCOUT_STATSBOMB_AI_PROCESSING_ALLOWED = "true";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";

  return () => {
    if (previousStatsBombProcessingPermission === undefined) delete process.env.TACTISCOUT_STATSBOMB_AI_PROCESSING_ALLOWED;
    else process.env.TACTISCOUT_STATSBOMB_AI_PROCESSING_ALLOWED = previousStatsBombProcessingPermission;
    if (previousModelEndpoint === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousModelEndpoint;
  };
}

export function roleConstraintPlayer(playerId: string, name: string, position: PlayerProfile["position"]): PlayerProfile {
  return {
    playerId,
    name,
    team: "Harbor City",
    age: 23,
    position,
    competition: "Open League",
    season: "2025/26",
    minutes: 1800,
    stats: { goals: 8, assists: 3, passesAttempted: 300, passesCompleted: 225, longPasses: 10, carries: 35, pressures: 120, tackles: 8, interceptions: 4, shotAssists: 16 },
    source: "StatsBomb Open Data",
  };
}

export function understatRoleCandidate(index: number): PlayerProfile {
  const externalPlayerId = String(300 + index);
  return {
    ...roleConstraintPlayer(`understat-role-${index}`, `Role Candidate ${index}`, "MID"),
    source: "Understat",
    externalPlayerId,
    season: "2026/27",
    sourceIdentity: {
      provider: "understat",
      playerId: `EPL:${externalPlayerId}`,
      competitionId: "EPL",
      seasonId: "2026",
      positionGroup: "MID",
      positionGroups: ["MID"],
      sourcePositionLabels: ["M"],
      retrievedAt: "2026-10-16T00:00:00.000Z",
      isCurrentSeason: true,
    },
    availableStats: ["goals", "assists"],
  };
}

export function understatRoleResearch(player: PlayerProfile, code: string, minutes = 900) {
  return {
    playerId: player.playerId,
    name: player.name,
    team: player.team,
    competition: player.competition,
    season: player.season,
    sourcePlayerId: player.externalPlayerId!,
    sourceUrl: `https://understat.com/player/${player.externalPlayerId}`,
    retrievedAt: "2026-10-16T00:00:00.000Z",
    player: { id: player.externalPlayerId!, name: player.name, favoritePosition: code },
    lastMatch: null,
    requestedSections: ["positions" as const],
    availableSections: ["positions" as const],
    positions: [{ season: "2026", code, minutes, games: 12, goals: 9, shots: 40, xG: 9, assists: 3, xA: 4, keyPasses: 22, npxG: 8, xGChain: 12, xGBuildup: 5 }],
    notes: ["位置标签表示赛季比赛记录，不代表完整战术职责。"],
  };
}
