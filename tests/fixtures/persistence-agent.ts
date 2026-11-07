import { createAgent } from "../../src/agent.js";
import { searchPlayerRecords } from "../../src/player-data/search-records.js";
import type { PlayerSearch } from "../../src/player-data/search-records.js";
import { createApiFootballClient } from "../../src/team-data/api-football.js";
import type { ApiFootballClient } from "../../src/team-data/api-football.js";
import type { RecommendPlayerCandidates } from "../../src/tools/recommend-player-candidates.js";
import { recommendPlayerCandidates } from "../../src/tools/recommend-player-candidates.js";
import type { RecommendTeamPlayerCandidates } from "../../src/tools/recommend-team-player-candidates.js";
import { recommendTeamPlayerCandidates } from "../../src/tools/recommend-team-player-candidates.js";
import { createTools } from "../../src/tools/search-player-records.js";

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

const providerUrl = process.env.PERSISTENCE_TEST_PROVIDER_URL;

if (providerUrl === undefined) {
  throw new Error("Persistence fixture provider URL is not configured.");
}

const teamDirectory: ApiFootballClient = createApiFootballClient({
  apiKey: process.env.API_FOOTBALL_KEY,
  fetcher: async (input, init) => {
    const originalUrl = new URL(input instanceof Request ? input.url : input);

    const localUrl = new URL(
      `/api-football${originalUrl.pathname}${originalUrl.search}`,
      providerUrl
    );

    return await fetch(localUrl, init);
  },
});

const agent = createAgent({
  teamDirectory,
  tools: createTools(
    trackedPlayerSearch,
    trackedRecommendation,
    trackedTeamRecommendation,
    "2026-11-07"
  ),
});

export { agent };
