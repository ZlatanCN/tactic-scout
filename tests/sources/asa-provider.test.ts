import assert from "node:assert/strict";
import test from "node:test";
import { loadComparisonPlayers, loadPlayersByIds, searchPlayerPage } from "../../src/sources/registry.js";
import {
  AmericanSoccerAnalysisPlayerRepository,
  ASAProviderError,
} from "../../src/sources/asa/provider.js";
import { describeDatasetScope } from "../../src/domain/dataset-scope.js";
import { playerPositionMatches } from "../../src/domain/positions.js";

const retrievedAt = new Date("2026-10-06T10:00:00.000Z");

function statsRows(includeExtraWinger = false) {
  const base = {
    player_id: "101",
    team_id: "1",
    season_name: "2026",
    general_position: "W",
    minutes_played: 1800,
  };
  const second = { ...base, player_id: "102", team_id: "2", general_position: "CB", minutes_played: 1200 };
  const rows = [base, second, ...(includeExtraWinger ? [{ ...base, player_id: "103", minutes_played: 900 }] : [])];
  const actions = [
    ["Dribbling", 0.1, 30], ["Fouling", -0.02, 4], ["Interrupting", 0.03, 42],
    ["Passing", 0.2, 850], ["Receiving", 0.05, 900], ["Shooting", 0.15, 50],
  ] as const;
  return {
    "goals-added": rows.map((row, index) => ({
      ...row,
      data: actions.map(([action_type, goals_added_above_avg, count_actions]) => ({
        action_type,
        goals_added_above_avg: index === 0 ? goals_added_above_avg : goals_added_above_avg * 2,
        count_actions,
      })),
    })),
    xgoals: rows.map((row, index) => ({
      ...row,
      goals: index === 0 ? 8 : 1,
      primary_assists: index === 0 ? 3 : 0,
      key_passes: index === 0 ? 25 : 2,
      shots: index === 0 ? 50 : 8,
      xgoals: index === 0 ? 7 : 0.8,
      xassists: index === 0 ? 5 : 0.3,
      xgoals_plus_xassists: index === 0 ? 12 : 1.1,
    })),
    xpass: rows.map((row, index) => ({
      ...row,
      attempted_passes: index === 0 ? 600 : 300,
      pass_completion_percentage: index === 0 ? 82 : 88,
      xpass_completion_percentage: index === 0 ? 78 : 84,
      passes_completed_over_expected_p100: index === 0 ? 3 : 1,
      avg_vertical_distance_yds: index === 0 ? 14.2 : 9.1,
      count_games: index === 0 ? 20 : 14,
    })),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(options: { seasonOverride?: string; missingPlayer?: boolean; duplicatePlayer?: boolean; extraWinger?: boolean; networkFailureOnceAt?: string; httpFailureAt?: string; httpFailureOnceAt?: string; emptyStatEndpoint?: "goals-added" | "xgoals" | "xpass" } = {}) {
  const urls: URL[] = [];
  const rows = statsRows(options.extraWinger);
  let transientFailureUsed = false;
  let transientHttpFailureUsed = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(init?.redirect, "error");
    const url = new URL(String(input));
    urls.push(url);
    if (options.networkFailureOnceAt === url.pathname && !transientFailureUsed) {
      transientFailureUsed = true;
      throw new TypeError("fetch failed");
    }
    if (options.httpFailureAt === url.pathname) return jsonResponse({ error: "temporary upstream response" }, 503);
    if (options.httpFailureOnceAt === url.pathname && !transientHttpFailureUsed) {
      transientHttpFailureUsed = true;
      return jsonResponse({ error: "temporary upstream response" }, 503);
    }
    if (url.pathname.endsWith("/players/goals-added")) {
      if (options.emptyStatEndpoint === "goals-added") return jsonResponse([]);
      const data = options.seasonOverride ? rows["goals-added"].map((row) => ({ ...row, season_name: options.seasonOverride })) : rows["goals-added"];
      return jsonResponse(data);
    }
    if (url.pathname.endsWith("/players/xgoals")) {
      if (options.emptyStatEndpoint === "xgoals") return jsonResponse([]);
      return jsonResponse(options.duplicatePlayer ? [...rows.xgoals, rows.xgoals[0]] : rows.xgoals);
    }
    if (url.pathname.endsWith("/players/xpass")) return jsonResponse(options.emptyStatEndpoint === "xpass" ? [] : rows.xpass);
    if (url.pathname.endsWith("/players")) {
      return jsonResponse(options.missingPlayer ? [] : [
        { player_id: "101", player_name: "Sample Winger", birth_date: "2001-04-02", primary_general_position: "W", season_name: null },
        { player_id: "102", player_name: "Sample Centre Back", birth_date: "2000-01-02", primary_general_position: "CB", season_name: "2026" },
        ...(options.extraWinger ? [{ player_id: "103", player_name: "Second Sample Winger", birth_date: "2002-01-02", primary_general_position: "W", season_name: "2026" }] : []),
      ]);
    }
    if (url.pathname.endsWith("/teams")) return jsonResponse([
      { team_id: "1", team_name: "Sample City FC" },
      { team_id: "2", team_name: "Sample Borough FC" },
    ]);
    throw new Error(`Unexpected ASA path: ${url.pathname}`);
  };
  return { fetchImpl, urls };
}

function repository(fetchImpl: typeof fetch, now: () => Date = () => retrievedAt) {
  return new AmericanSoccerAnalysisPlayerRepository({ fetchImpl, now });
}

test("ASA cancels all active endpoint requests and does not continue to player or team lookup", async () => {
  const requestSignals: AbortSignal[] = [];
  let signalStatsRequestsStarted!: () => void;
  const statsRequestsStarted = new Promise<void>((resolve) => { signalStatsRequestsStarted = resolve; });
  const repo = repository(async (_input, init) => {
    const signal = init?.signal as AbortSignal;
    requestSignals.push(signal);
    if (requestSignals.length === 3) signalStatsRequestsStarted();
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  const controller = new AbortController();
  const pending = repo.loadPlayers(false, controller.signal);
  await statsRequestsStarted;
  const reason = new Error("turn stopped");
  controller.abort(reason);
  await assert.rejects(pending, (error: unknown) => error === reason);
  assert.equal(requestSignals.length, 3);
  assert.ok(requestSignals.every((signal) => signal.aborted));
});

test("ASA adapter joins current player, team, season and source metrics by competition-scoped exact IDs", async () => {
  const fixture = mockFetch();
  const repo = repository(fixture.fetchImpl);
  const players = await repo.loadPlayers();
  assert.equal(players.length, 6);
  assert.deepEqual(new Set(players.map((player) => player.sourceIdentity?.competitionId)), new Set(["mls", "uslc", "usl1"]));
  const player = players.find(({ playerId }) => playerId === "asa:mls:101:team:1:season:2026")!;
  assert.equal(player.playerId, "asa:mls:101:team:1:season:2026");
  assert.equal(player.externalPlayerId, "101");
  assert.equal(player.name, "Sample Winger");
  assert.equal(player.team, "Sample City FC");
  assert.equal(player.position, "WG");
  assert.equal(player.age, 25);
  assert.equal(player.competition, "美国职业足球大联盟（MLS）");
  assert.equal(player.season, "2026");
  assert.deepEqual(player.availableStats, ["goals", "assists", "keyPasses"]);
  assert.equal(player.stats.passesAttempted, 0, "unsupported basic pass fields stay unavailable, not zero evidence");
  assert.equal(player.sourceIdentity?.isCurrentSeason, true);
  assert.equal(player.sourceIdentity?.teamId, "1");
  assert.equal(player.sourceIdentity?.competitionId, "mls");
  assert.equal(player.sourceIdentity?.provider, "american-soccer-analysis");
  assert.equal(player.sourceIdentity?.retrievedAt, retrievedAt.toISOString());

  const metrics = new Map(player.supplementaryMetrics?.map((metric) => [metric.key, metric]));
  assert.equal(metrics.get("asaExpectedGoalsPer90")?.value, 0.35);
  assert.equal(metrics.get("asaExpectedAssistsPer90")?.value, 0.25);
  assert.equal(metrics.get("asaExpectedGoalsPerShot")?.value, 0.14);
  assert.equal(metrics.get("asaPassCompletionPct")?.value, 82);
  assert.equal(metrics.get("asaPassesCompletedOverExpectedPer100")?.value, 3);
  assert.equal(metrics.get("asaAverageVerticalPassDistanceYards")?.value, 14.2);
  assert.equal(metrics.get("asaGoalsAddedDribblingPer90")?.value, 0.005);
  assert.equal(metrics.get("asaGoalsAddedFoulingPer90")?.value, -0.001);
  assert.equal(metrics.get("asaGoalsAddedTotalAboveAveragePer90")?.value, 0.0255);
  assert.ok(metrics.get("asaGoalsAddedTotalAboveAveragePer90")?.definition.includes("不是 TactiScout"));
  assert.equal(metrics.get("asaExpectedGoalsPer90")?.sampleAttempts, undefined);

  const statRequests = fixture.urls.filter((url) => /\/players\/(goals-added|xgoals|xpass)$/.test(url.pathname));
  assert.equal(statRequests.length, 9);
  assert.ok(statRequests.every((url) => url.searchParams.get("season_name") === "2026"));
  assert.ok(statRequests.every((url) => url.searchParams.get("split_by_seasons") === "true"));
  assert.ok(statRequests.every((url) => url.searchParams.get("split_by_teams") === "true"));
  assert.ok(statRequests.every((url) => url.searchParams.get("minimum_minutes") === "0"));

  const scope = describeDatasetScope("asa", players);
  assert.equal(scope.kind, "current_limited");
  assert.equal(scope.observedCoverage?.playerRecordCount, 6);
  assert.equal(scope.observedCoverage?.competitions.length, 3);
  assert.deepEqual(scope.observedCoverage?.seasons, ["2026"]);
});

test("ASA repository filters and paginates exact competition-scoped current-season profiles", async () => {
  const fixture = mockFetch();
  const repo = repository(fixture.fetchImpl);
  const page = await searchPlayerPage(repo, {
    playerName: null,
    position: "WG",
    maxAge: 26,
    minimumMinutes: 1200,
    competition: "MLS",
    season: "2026",
    offset: 0,
    limit: 10,
  });
  assert.equal(page.totalRecords, 1);
  assert.equal(page.nextOffset, null);
  assert.deepEqual(page.appliedFilters, ["positionFamily", "maxAge", "minimumMinutes", "competition", "season"]);
  assert.equal(fixture.urls.length, 5, "an explicit league query loads only that league");
  assert.ok(fixture.urls.every((url) => url.pathname.startsWith("/api/v1/mls/")));
  const firstPage = await searchPlayerPage(repo, {
    playerName: null, position: null, maxAge: null, minimumMinutes: 0,
    competition: null, season: null, offset: 0, limit: 1,
  });
  assert.equal(firstPage.totalRecords, 6, "default ASA search only uses supported men's competitions");
  assert.equal(fixture.urls.length, 15, "default search loads only three supported competitions");
  assert.equal(firstPage.nextOffset, 1);
  const secondPage = await searchPlayerPage(repo, {
    playerName: null, position: null, maxAge: null, minimumMinutes: 0,
    competition: null, season: null, offset: 1, limit: 1,
  });
  assert.equal(secondPage.nextOffset, 2);
  assert.notEqual(firstPage.players[0]?.playerId, secondPage.players[0]?.playerId);
  assert.ok([...firstPage.players, ...secondPage.players].every((candidate) => ["mls", "uslc", "usl1"].includes(candidate.sourceIdentity?.competitionId ?? "")));
  const selected = await loadPlayersByIds(repo, [firstPage.players[0]!.playerId]);
  assert.equal(selected.length, 1);
  const readsAfterSelection = fixture.urls.length;
  const peers = await loadComparisonPlayers(repo, selected);
  assert.equal(peers.length, 2, "peer reads are limited to the candidate's exact competition");
  assert.equal(fixture.urls.length, readsAfterSelection, "candidate and peer reads reuse the competition cache");
  const uslPage = await searchPlayerPage(repo, {
    playerName: null, position: null, maxAge: null, minimumMinutes: 0,
    competition: "USL", season: "2026", offset: 0, limit: 20,
  });
  assert.equal(uslPage.totalRecords, 4, "USL shorthand includes only USL Championship and USL League One");
  assert.deepEqual(new Set(uslPage.players.map((candidate) => candidate.sourceIdentity?.competitionId)), new Set(["uslc", "usl1"]));
  const requestsBeforeUnsupportedScopes = fixture.urls.length;
  for (const competition of ["NWSL", "USL Super League"]) {
    await assert.rejects(() => repo.searchCandidates({
      playerName: null, position: null, maxAge: null, minimumMinutes: 0,
      competition, season: "2026", offset: 0, limit: 20,
    }), (error: unknown) => error instanceof ASAProviderError && error.code === "unsupported_scope");
  }
  assert.equal(fixture.urls.length, requestsBeforeUnsupportedScopes, "unsupported competitions are rejected before a source request");
  await assert.rejects(() => repo.searchCandidates({
    playerName: null, position: null, maxAge: null, minimumMinutes: 0,
    competition: "Premier League", season: null, offset: 0, limit: 10,
  }), (error: unknown) => error instanceof ASAProviderError && error.code === "unsupported_scope");
  await assert.rejects(() => repo.searchCandidates({
    playerName: null, position: null, maxAge: null, minimumMinutes: 0,
    competition: null, season: "2025", offset: 0, limit: 10,
  }), (error: unknown) => error instanceof ASAProviderError && error.code === "unsupported_scope");
});

test("ASA family retrieval preserves broad winger leads across pages without qualifying them as a specific wing", async () => {
  const fixture = mockFetch({ extraWinger: true });
  const repo = repository(fixture.fetchImpl);
  const query = {
    playerName: null,
    position: "LW" as const,
    maxAge: null,
    minimumMinutes: 0,
    competition: "MLS",
    season: "2026",
    limit: 1,
  };

  const first = await searchPlayerPage(repo, { ...query, offset: 0 });
  assert.equal(first.totalRecords, 2, "both ASA W records should be recalled for a fine left-wing query");
  assert.deepEqual(first.players.map(({ playerId }) => playerId), ["asa:mls:101:team:1:season:2026"]);
  assert.ok(first.appliedFilters.includes("positionFamily"));
  assert.equal(first.nextOffset, 1);
  assert.equal(playerPositionMatches(first.players[0]!, "LW"), false, "ASA W is broad evidence, not proof of LW eligibility");

  const second = await searchPlayerPage(repo, { ...query, offset: first.nextOffset! });
  assert.deepEqual(second.players.map(({ playerId }) => playerId), ["asa:mls:103:team:1:season:2026"]);
  assert.equal(second.nextOffset, null);
});

test("ASA candidate catalog is limited to its three supported men's competitions", async () => {
  const fixture = mockFetch();
  const players = await repository(fixture.fetchImpl).loadMenPlayers();
  assert.equal(players.length, 6);
  assert.deepEqual(new Set(players.map((player) => player.sourceIdentity?.competitionId)), new Set(["mls", "uslc", "usl1"]));
  assert.deepEqual(new Set(fixture.urls.map((url) => url.pathname.split("/")[3])), new Set(["mls", "uslc", "usl1"]));
  assert.equal(fixture.urls.length, 15);
});

test("ASA retry after a league failure reuses completed competition caches", async () => {
  const fixture = mockFetch({ httpFailureOnceAt: "/api/v1/usl1/players/xpass" });
  let currentTime = new Date(retrievedAt);
  const repo = repository(fixture.fetchImpl, () => currentTime);
  const defaultQuery = {
    playerName: null,
    position: null,
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: "2026",
    offset: 0,
    limit: 20,
  } as const;

  await assert.rejects(() => repo.searchCandidates(defaultQuery), (error: unknown) => error instanceof ASAProviderError && error.code === "request_failed");
  const mlsRequestsBeforeRetry = fixture.urls.filter((url) => url.pathname.startsWith("/api/v1/mls/")).length;
  const uslcRequestsBeforeRetry = fixture.urls.filter((url) => url.pathname.startsWith("/api/v1/uslc/")).length;
  assert.equal(mlsRequestsBeforeRetry, 5);
  assert.equal(uslcRequestsBeforeRetry, 5);

  currentTime = new Date(currentTime.getTime() + 61_000);
  const recovered = await repo.searchCandidates(defaultQuery);

  assert.equal(recovered.totalRecords, 6);
  assert.equal(fixture.urls.filter((url) => url.pathname.startsWith("/api/v1/mls/")).length, mlsRequestsBeforeRetry);
  assert.equal(fixture.urls.filter((url) => url.pathname.startsWith("/api/v1/uslc/")).length, uslcRequestsBeforeRetry);
  assert.ok(fixture.urls.every((url) => !url.pathname.startsWith("/api/v1/usls/")));
});

test("ASA search holds one season and retrieval timestamp across all requested leagues", async () => {
  let currentTime = new Date("2026-12-31T23:59:59.000Z");
  const fixture = mockFetch();
  let advancedSeason = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const response = await fixture.fetchImpl(input, init);
    if (!advancedSeason) {
      currentTime = new Date("2027-01-01T00:00:01.000Z");
      advancedSeason = true;
    }
    return response;
  };
  const repo = new AmericanSoccerAnalysisPlayerRepository({ fetchImpl, now: () => currentTime });

  const page = await repo.searchCandidates({
    playerName: null,
    position: null,
    maxAge: null,
    minimumMinutes: 0,
    competition: "ASA 男足赛事",
    season: "2026",
    offset: 0,
    limit: 20,
  });

  assert.equal(page.totalRecords, 6);
  const statRequests = fixture.urls.filter((url) => /\/players\/(goals-added|xgoals|xpass)$/.test(url.pathname));
  assert.ok(statRequests.every((url) => url.searchParams.get("season_name") === "2026"));
});

test("ASA target-team searches exclude exact current-season team matches", async () => {
  const repo = repository(mockFetch().fetchImpl);

  const page = await repo.searchCandidates({
    targetTeam: "Sample City FC",
    playerName: null,
    position: null,
    maxAge: null,
    minimumMinutes: 0,
    competition: "MLS",
    season: "2026",
    offset: 0,
    limit: 20,
  });

  assert.deepEqual(page.players.map(({ team }) => team), ["Sample Borough FC"]);
  assert.ok(page.appliedFilters.includes("targetTeam"));
});

test("ASA provider requires an exact current-season entity join and source season", async () => {
  const wrongSeason = repository(mockFetch({ seasonOverride: "2025" }).fetchImpl);
  await assert.rejects(() => wrongSeason.loadPlayers(), (error: unknown) => error instanceof ASAProviderError && error.code === "invalid_response");

  const missingEntity = repository(mockFetch({ missingPlayer: true }).fetchImpl);
  await assert.rejects(() => missingEntity.loadPlayers(), (error: unknown) => error instanceof ASAProviderError && error.code === "invalid_response");

  const duplicate = repository(mockFetch({ duplicatePlayer: true }).fetchImpl);
  await assert.rejects(() => duplicate.loadPlayers(), (error: unknown) => error instanceof ASAProviderError && error.code === "invalid_response");
});

test("ASA keeps an unavailable metric family missing instead of fabricating zero-valued evidence", async () => {
  const repo = repository(mockFetch({ emptyStatEndpoint: "xpass" }).fetchImpl);
  const player = (await repo.loadPlayers()).find(({ playerId }) => playerId === "asa:mls:101:team:1:season:2026")!;
  const metricKeys = new Set(player.supplementaryMetrics?.map(({ key }) => key));

  assert.ok(metricKeys.has("asaExpectedGoalsPer90"));
  assert.ok(metricKeys.has("asaExpectedAssistsPer90"));
  assert.ok(metricKeys.has("asaGoalsAddedTotalAboveAveragePer90"));
  assert.equal(metricKeys.has("asaPassCompletionPct"), false);
  assert.equal(metricKeys.has("asaExpectedPassCompletionPct"), false);
  assert.equal(metricKeys.has("asaPassesCompletedOverExpectedPer100"), false);
  assert.equal(metricKeys.has("asaAverageVerticalPassDistanceYards"), false);
});

test("ASA provider recovers once from a transient transport failure without retrying HTTP errors", async () => {
  const fixture = mockFetch({ networkFailureOnceAt: "/api/v1/usl1/players/xpass" });
  const repo = repository(fixture.fetchImpl);

  const players = await repo.loadPlayers();

  assert.equal(players.length, 6);
  assert.equal(fixture.urls.filter((url) => url.pathname === "/api/v1/usl1/players/xpass").length, 2);

  const httpFailure = mockFetch({ httpFailureAt: "/api/v1/uslc/players/xpass" });
  const failingRepository = repository(httpFailure.fetchImpl);
  await assert.rejects(failingRepository.loadPlayers(), (error: unknown) => error instanceof ASAProviderError && error.code === "request_failed");
  assert.equal(httpFailure.urls.filter((url) => url.pathname === "/api/v1/uslc/players/xpass").length, 1);
});

test("ASA explicit refresh bypasses the process cache while ordinary loads reuse it", async () => {
  const fixture = mockFetch();
  const repo = repository(fixture.fetchImpl);
  await repo.loadPlayers();
  assert.equal(fixture.urls.length, 15);
  await repo.loadPlayers();
  assert.equal(fixture.urls.length, 15);
  await repo.loadPlayers(true);
  assert.equal(fixture.urls.length, 30);
});

test("ASA multi-position union shares a page stream without upgrading its broad winger label", async () => {
  const fixture = mockFetch();
  const repo = repository(fixture.fetchImpl);
  const query = { playerName: null, position: null, positions: ["LW", "CB"] as const, maxAge: null, minimumMinutes: 0, competition: "MLS", season: "2026", offset: 0, limit: 1 };
  const first = await searchPlayerPage(repo, query);
  assert.equal(first.totalRecords, 2);
  assert.equal(first.nextOffset, 1);
  assert.ok(first.appliedFilters.includes("positionFamily"));
  const second = await searchPlayerPage(repo, { ...query, offset: first.nextOffset! });
  assert.equal(second.nextOffset, null);
  const players = [...first.players, ...second.players];
  assert.equal(new Set(players.map(({ playerId }) => playerId)).size, 2);
  const winger = players.find(({ position }) => position === "WG")!;
  assert.equal(playerPositionMatches(winger, "LW"), false);
  assert.equal(fixture.urls.length, 5, "both positions share the same competition load");
});
