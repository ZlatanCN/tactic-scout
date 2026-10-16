import assert from "node:assert/strict";
import test from "node:test";
import { searchPlayerPage, type PlayerRepository } from "../../src/sources/registry.js";
import {
  PremierLeaguePlayerRepository,
  PremierLeagueProviderError,
} from "../../src/sources/premier-league/provider.js";
import { describeDatasetScope } from "../../src/domain/dataset-scope.js";

const retrievedAt = new Date("2026-10-08T09:00:00.000Z");

function statsEntry({
  id,
  name,
  position,
  timePlayed = 900,
  goals = 5,
  goalAssists = 3,
  totalTackles = 20,
  tacklesWon = 15,
  interceptions = 10,
  recoveries = 30,
  successfulDribbles = 18,
  forwardPasses = 100,
  aerialDuelsWon = 8,
  keyPassesAttemptAssists = 12,
}: {
  id: string;
  name: string;
  position: string;
  timePlayed?: number;
  goals?: number;
  goalAssists?: number;
  totalTackles?: number;
  tacklesWon?: number;
  interceptions?: number;
  recoveries?: number;
  successfulDribbles?: number;
  forwardPasses?: number;
  aerialDuelsWon?: number;
  keyPassesAttemptAssists?: number;
}) {
  return {
    playerMetadata: {
      id,
      name,
      firstName: name.split(" ")[0],
      lastName: name.split(" ").slice(1).join(" "),
      country: "England",
      position,
      currentTeam: { id: "43", name: "Arsenal", shortName: "ARS" },
    },
    stats: {
      timePlayed,
      appearances: 12,
      goals,
      goalAssists,
      totalTackles,
      tacklesWon,
      interceptions,
      recoveries,
      successfulDribbles,
      forwardPasses,
      aerialDuelsWon,
      keyPassesAttemptAssists,
    },
  };
}

function playerDirectory(data = [
  directoryEntry("101", "Jules Vale", "Midfielder"),
  directoryEntry("102", "Morgan North", "Forward"),
]) {
  return { pagination: { _limit: 100, _prev: null, _next: null }, data };
}

function directoryEntry(playerId: string, name: string, position: string) {
  const metadata = statsEntry({ id: playerId, name, position }).playerMetadata;
  return {
    ...metadata,
    id: { competitionId: "8", seasonId: "2026", playerId },
    name: { firstName: name.split(" ")[0], lastName: name.split(" ").slice(1).join(" ") },
  };
}

function leaderboard(data = [
  statsEntry({ id: "101", name: "Jules Vale", position: "Midfielder" }),
  statsEntry({ id: "102", name: "Morgan North", position: "Forward", timePlayed: 0 }),
]) {
  return { pagination: { _limit: 100, _prev: null, _next: null }, data };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function currentSquad() {
  return {
    id: "43",
    team: { id: "43", name: "Arsenal", shortName: "ARS" },
    players: [
      { id: "101", name: "Jules Vale", dates: { birth: "2003-02-02" }, position: "Midfielder" },
      { id: "102", name: "Morgan North", dates: { birth: "1998-11-10" }, position: "Forward" },
    ],
  };
}

function repository(fetchImpl: typeof fetch, options: { now?: () => Date; cacheTtlMs?: number; seasonId?: string } = {}) {
  return new PremierLeaguePlayerRepository({ fetchImpl, now: options.now ?? (() => retrievedAt), ...options });
}

test("Premier League repository maps the measured season fields and exact-ID squad ages", async () => {
  const requests: string[] = [];
  const repo = repository(async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/api/v1/competitions/8/seasons/2026/players?")) return jsonResponse(playerDirectory());
    if (url.includes("/stats/leaderboard")) {
      return jsonResponse(leaderboard());
    }
    if (url.endsWith("/teams/43/squad")) return jsonResponse(currentSquad());
    throw new Error("Unexpected URL");
  });

  const players = await repo.loadPlayers();
  const midfielder = players.find((player) => player.externalPlayerId === "101");
  const forward = players.find((player) => player.externalPlayerId === "102");

  assert.equal(requests.filter((url) => url.includes("/stats/leaderboard")).length, 9);
  assert.equal(requests.filter((url) => url.endsWith("/teams/43/squad")).length, 1);
  assert.ok(requests.some((url) => url.includes("/api/v1/competitions/8/seasons/2026/players?")));
  assert.ok(requests.some((url) => url.includes("/api/v3/competitions/8/seasons/2026/players/stats/leaderboard") && url.includes("_sort=interceptions%3Adesc")));
  assert.equal(midfielder?.playerId, "premier-league:101:season:2026/27");
  assert.equal(midfielder?.name, "Jules Vale");
  assert.equal(midfielder?.team, "Arsenal");
  assert.equal(midfielder?.position, "MID");
  assert.equal(midfielder?.competition, "英超");
  assert.equal(midfielder?.season, "2026/27");
  assert.equal(midfielder?.age, 23);
  assert.equal(midfielder?.ageSource, "Premier League same-season squad birth date");
  assert.deepEqual(midfielder?.sourceIdentity, {
    provider: "premier-league-pulselive",
    playerId: "101",
    teamId: "43",
    competitionId: "premier-league",
    seasonId: "2026/27",
    positionGroup: "MID",
    retrievedAt: retrievedAt.toISOString(),
    isCurrentSeason: true,
  });
  assert.deepEqual(midfielder?.availableStats, ["goals", "assists", "keyPasses", "tackles", "interceptions"]);
  assert.equal(midfielder?.stats.goals, 5);
  assert.equal(midfielder?.stats.assists, 3);
  assert.equal(midfielder?.stats.keyPasses, 12);
  assert.equal(midfielder?.stats.tackles, 20);
  assert.equal(midfielder?.stats.interceptions, 10);
  assert.equal(midfielder?.supplementaryMetrics?.find((metric) => metric.key === "premierLeagueAssistsPer90")?.value, 0.3);
  assert.equal(midfielder?.supplementaryMetrics?.find((metric) => metric.key === "premierLeagueSuccessfulDribblesPer90")?.value, 1.8);
  assert.equal(midfielder?.supplementaryMetrics?.find((metric) => metric.key === "premierLeagueForwardPassesPer90")?.value, 10);
  assert.equal(midfielder?.supplementaryMetrics?.find((metric) => metric.key === "premierLeagueKeyPassesPer90")?.sourceField, "keyPassesAttemptAssists");
  assert.ok(midfielder?.supplementaryMetrics?.every((metric) => metric.sampleMinutes === 900 && metric.sampleMatches === 12));
  assert.equal(forward?.age, 27);
  assert.equal(forward?.supplementaryMetrics?.find((metric) => metric.key === "premierLeagueGoalsPer90")?.value, null);
});

test("repository follows same-origin bounded leaderboard cursors and joins exact IDs", async () => {
  const requested: string[] = [];
  const repo = repository(async (input) => {
    const url = new URL(String(input));
    requested.push(url.href);
    if (url.pathname.endsWith("/players") && !url.searchParams.has("_next")) {
      return jsonResponse({
        pagination: { _limit: 100, _prev: null, _next: "/eyJjdXJzb3ItdGVzdA" },
        data: [directoryEntry("101", "Jules Vale", "Midfielder")],
      });
    }
    if (url.pathname.endsWith("/players") && url.searchParams.get("_next") === "eyJjdXJzb3ItdGVzdA") {
      return jsonResponse({
        pagination: { _limit: 100, _prev: null, _next: null },
        data: [directoryEntry("102", "Morgan North", "Forward")],
      });
    }
    if (url.pathname.endsWith("/players/stats/leaderboard")) return jsonResponse(leaderboard());
    if (url.pathname.endsWith("/teams/43/squad")) return jsonResponse(currentSquad());
    throw new Error("Unexpected URL");
  });

  assert.equal((await repo.loadPlayers()).length, 2);
  assert.equal(requested.filter((url) => new URL(url).pathname.endsWith("/players")).length, 2);
  assert.equal(requested.filter((url) => new URL(url).pathname.endsWith("/players/stats/leaderboard")).length, 9);
  assert.ok(requested.some((url) => new URL(url).searchParams.get("_next") === "eyJjdXJzb3ItdGVzdA"));
});

test("repository rejects cross-origin and out-of-season pagination cursors", async () => {
  for (const next of [
    "https://example.invalid/eyJjdXJzb3ItdGVzdA",
    "/api/v3/competitions/8/seasons/2025/players/stats/eyJjdXJzb3ItdGVzdA",
  ]) {
    const repo = repository(async () => jsonResponse({
      pagination: { _limit: 100, _prev: null, _next: next },
      data: [directoryEntry("101", "Jules Vale", "Midfielder")],
    }));
    await assert.rejects(repo.loadPlayers(), (error: unknown) => error instanceof PremierLeagueProviderError && error.code === "invalid_response");
  }
});

test("repository query seam filters by exact broad role and age and paginates", async () => {
  const repo: PlayerRepository = repository(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/players/stats/leaderboard")) return jsonResponse(leaderboard());
    if (url.pathname.endsWith("/players")) return jsonResponse(playerDirectory());
    return jsonResponse(currentSquad());
  });
  const result = await searchPlayerPage(repo, {
    playerName: null,
    position: "MID",
    maxAge: 24,
    minimumMinutes: 0,
    competition: "英超",
    season: "2026/27",
    offset: 0,
    limit: 1,
  });
  assert.equal(result.totalRecords, 1);
  assert.equal(result.players[0]?.externalPlayerId, "101");
  assert.equal(result.nextOffset, null);
  assert.deepEqual(result.appliedFilters, ["position", "maxAge", "competition", "season"]);
});

test("directory players without leaderboard rows remain unscored and keep metrics unavailable", async () => {
  const repo = repository(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/players/stats/leaderboard")) {
      return jsonResponse(leaderboard([statsEntry({ id: "101", name: "Jules Vale", position: "Midfielder" })]));
    }
    if (url.pathname.endsWith("/players")) {
      return jsonResponse(playerDirectory([
        directoryEntry("101", "Jules Vale", "Midfielder"),
        directoryEntry("103", "Casey Unknown", "Defender"),
      ]));
    }
    return jsonResponse(currentSquad());
  });
  const player = (await repo.loadPlayers()).find((candidate) => candidate.externalPlayerId === "103");
  assert.equal(player?.minutes, 0);
  assert.equal(player?.age, null);
  assert.deepEqual(player?.availableStats, []);
  assert.deepEqual(player?.supplementaryMetrics, []);
});

test("repository reuses concurrent load and stops after a rate limit without retry", async () => {
  let requests = 0;
  const repo = repository(async () => {
    requests += 1;
    return jsonResponse({ message: "upstream payload must not leak" }, 429);
  });
  const outcomes = await Promise.allSettled([repo.loadPlayers(), repo.loadPlayers()]);
  assert.equal(requests, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 2);
  assert.ok(outcomes.every((outcome) => outcome.status === "rejected" && outcome.reason instanceof PremierLeagueProviderError && outcome.reason.code === "rate_limit"));
  assert.ok(outcomes.every((outcome) => outcome.status === "rejected" && !String(outcome.reason).includes("upstream payload")));
});

test("dataset scope describes the current Premier League performance pool honestly", async () => {
  const players = await repository(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/players/stats/leaderboard")) return jsonResponse(leaderboard());
    if (url.pathname.endsWith("/players")) return jsonResponse(playerDirectory());
    return jsonResponse(currentSquad());
  }).loadPlayers();
  const scope = describeDatasetScope("premier_league", players);
  assert.equal(scope.kind, "current_limited");
  assert.match(scope.title, /Premier League/);
  assert.match(scope.limitations.join(" "), /统计榜|表现/);
  assert.match(scope.limitations.join(" "), /渐进传球/);
  assert.match(scope.limitations.join(" "), /身价/);
});
