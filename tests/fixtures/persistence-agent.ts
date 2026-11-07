import { createAgent } from "../../src/agent.js";
import { searchPlayerRecords } from "../../src/player-data/search-records.js";
import type { PlayerSearch } from "../../src/player-data/search-records.js";
import type {
  ApiFootballClient,
  ApiFootballRosterPlayer,
  ApiFootballTeam,
} from "../../src/team-data/api-football.js";
import type { RecommendPlayerCandidates } from "../../src/tools/recommend-player-candidates.js";
import { recommendPlayerCandidates } from "../../src/tools/recommend-player-candidates.js";
import type { RecommendTeamPlayerCandidates } from "../../src/tools/recommend-team-player-candidates.js";
import { recommendTeamPlayerCandidates } from "../../src/tools/recommend-team-player-candidates.js";
import { createTools } from "../../src/tools/search-player-records.js";

const team = { country: "England", id: 541, name: "Test Club" };
const outageTeamName = "Outage Club";

const roster: ApiFootballRosterPlayer[] = [
  { id: 10, name: "Harry Kane", position: "Attacker" },
];

const recordTestEvent = async (name: string) => {
  const endpoint = process.env.PERSISTENCE_TEST_EVENTS_URL;

  if (endpoint === undefined) {
    throw new Error("Persistence fixture event endpoint is not configured.");
  }

  const response = await fetch(endpoint, {
    body: JSON.stringify({ name }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Could not record fixture event: ${name}`);
  }
};

const trackedPlayerSearch: PlayerSearch = async (input) => {
  await recordTestEvent("player-search");

  return await searchPlayerRecords(input);
};

const trackedRecommendation: RecommendPlayerCandidates = async (
  input,
  ageAsOfDate
) => {
  await recordTestEvent("player-recommendation");

  return await recommendPlayerCandidates(input, ageAsOfDate);
};

const trackedTeamRecommendation: RecommendTeamPlayerCandidates = async (
  input,
  ageAsOfDate
) => {
  await recordTestEvent("team-recommendation");

  return await recommendTeamPlayerCandidates(input, ageAsOfDate);
};

const searchTeams: ApiFootballClient["searchTeams"] = async (query) => {
  if (query === outageTeamName) {
    await recordTestEvent("team-search-failure");

    return {
      message: "The fixture provider is temporarily unavailable.",
      reason: "provider",
      status: "error",
      statusCode: 503,
    };
  }

  await recordTestEvent("team-search");

  return { data: [team], status: "ok" };
};

const getSquad: ApiFootballClient["getSquad"] = async (teamId) => {
  await recordTestEvent("team-roster");
  const selectedTeam: ApiFootballTeam = { ...team, id: teamId };

  return {
    data: {
      players: roster,
      retrievedAt: "2026-11-07T00:00:00.000Z",
      team: selectedTeam,
    },
    status: "ok",
  };
};

const agent = createAgent({
  teamDirectory: { getSquad, searchTeams },
  tools: createTools(
    trackedPlayerSearch,
    trackedRecommendation,
    trackedTeamRecommendation,
    "2026-11-07"
  ),
});

export { agent };
