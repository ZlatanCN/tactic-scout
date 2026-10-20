import { createApp } from "../../src/app.js";
import { createRecruitmentConversation, type RecruitmentPlanner, type RecruitmentTraceEvent } from "../../src/recruitment/conversation.js";
import { PlayerProfileSchema } from "../../src/domain/players.js";
import { searchLoadedPlayers, type PlayerSearchQuery } from "../../src/players/search.js";

const players = [
  ["left-back", "LB", 23], ["wing-back", "LWB", 24], ["right-wing", "RW", 22], ["old-back", "LB", 32],
].map(([id, position, age]) => PlayerProfileSchema.parse({
  playerId: id, name: id, team: "Harbor City", age, position,
  competition: "Open League", season: "2026/27", minutes: 1800,
  stats: { tackles: 20, interceptions: 10, passesAttempted: 300, passesCompleted: 240 },
  availableStats: ["tackles", "interceptions", "passesAttempted", "passesCompleted"],
  source: "Demo fixture",
}));

export function positionSelectionFixture() {
  const queries: PlayerSearchQuery[] = [];
  const events: RecruitmentTraceEvent[] = [];
  let plannerCalls = 0;
  const planner: RecruitmentPlanner = { async decide(input) {
    plannerCalls++;
    if (input.decisionSnapshot.constraints) return {
      action: "finish", targetTeam: input.decisionSnapshot.case.targetTeam, needSummary: "按已确认位置调查防守表现", capabilityProfile: ["抢断和拦截"],
      recommendations: input.decisionSnapshot.constraints.evaluatedCandidates.slice(0, 5).map(({ playerId, evidenceKeys }) => ({ playerId, evidenceKeys: evidenceKeys.filter((key) => key === "tacklesInterceptions") })),
      limitationKeys: [],
    };
    if (!input.history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology")) return { action: "search_methodology", query: "防守表现" };
    return { action: "search_candidates", position: null, maxAge: 25, minimumMinutes: 900, limit: 12 };
  } };
  const repository = { mode: "demo" as const, sourceName: "Frozen fixture", async loadPlayers() { return players; }, async searchCandidates(query: PlayerSearchQuery) { queries.push(query); return searchLoadedPlayers(players, query); } };
  const conversation = createRecruitmentConversation({
    repository,
    planner, knowledgeBase: { async search() { return []; } }, observer(event) { events.push(event); },
  });
  return { app: createApp({ repository, recruitmentConversation: conversation }), queries, events, plannerCalls: () => plannerCalls };
}

