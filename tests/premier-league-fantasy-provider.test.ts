import assert from "node:assert/strict";
import test from "node:test";
import { toPer90 } from "../src/agent/performance-metrics.js";
import {
  loadPlayersByIds,
  searchPlayerPage,
  type PlayerRepository,
} from "../src/data/provider.js";
import {
  PremierLeagueFantasyPlayerRepository,
  PremierLeagueFantasyProviderError,
} from "../src/data/premier-league-fantasy-provider.js";
import { describeDatasetScope } from "../src/domain/dataset-scope.js";

const retrievedAt = new Date("2026-10-06T10:00:00.000Z");

function fixturePayload() {
  return {
    teams: [
      { id: 1, name: "Northbridge" },
      { id: 2, name: "Harbour Town" },
    ],
    element_types: [
      { id: 1, singular_name_short: "GKP" },
      { id: 2, singular_name_short: "DEF" },
      { id: 3, singular_name_short: "MID" },
      { id: 4, singular_name_short: "FWD" },
    ],
    events: [
      { id: 5, deadline_time: "2026-09-18T17:30:00Z" },
      { id: 1, deadline_time: "2026-08-21T17:30:00Z" },
      { id: 38, deadline_time: "2027-05-24T15:00:00Z" },
    ],
    elements: [
      {
        id: 101,
        code: 987654,
        opta_code: "p987654",
        team: 1,
        element_type: 4,
        web_name: "Vale",
        first_name: "Jules",
        second_name: "Vale",
        birth_date: "2003-02-02",
        minutes: 900,
        goals_scored: 10,
        assists: 2,
        expected_goals: "4.50",
        expected_assists: "1.80",
        expected_goal_involvements: "6.30",
        tackles: 12,
        recoveries: 20,
        clearances_blocks_interceptions: 30,
      },
      {
        id: 102,
        team: 2,
        element_type: 2,
        web_name: "North",
        birth_date: null,
        minutes: 0,
        goals_scored: 0,
        assists: 0,
        expected_goals: "0.00",
      },
      {
        id: 103,
        team: 99,
        element_type: 3,
        web_name: "Unassigned",
        minutes: 100,
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function repository(fetchImpl: typeof fetch, options: { now?: () => Date; cacheTtlMs?: number } = {}) {
  return new PremierLeagueFantasyPlayerRepository({ fetchImpl, now: options.now ?? (() => retrievedAt), ...options });
}

test("FPL repository maps only known current players, broad positions, source identity, age and observed metrics", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const repo = repository(async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return jsonResponse(fixturePayload());
  });

  const players = await repo.loadPlayers();
  const forward = players.find((player) => player.externalPlayerId === "101");
  const defender = players.find((player) => player.externalPlayerId === "102");

  assert.equal(requestUrl, "https://fantasy.premierleague.com/api/bootstrap-static/");
  assert.equal(requestInit?.redirect, "error");
  assert.equal(requestInit?.signal instanceof AbortSignal, true);
  assert.equal(players.length, 2, "records without a known Premier League team are excluded");
  assert.equal(forward?.position, "ATT", "FPL forward is kept as a broad group, not a centre-forward role");
  assert.equal(forward?.team, "Northbridge");
  assert.equal(forward?.competition, "英超");
  assert.equal(forward?.season, "2026/27", "season comes from the first calendar deadline, not the active event");
  assert.equal(forward?.age, 23);
  assert.equal(forward?.ageVerifiedAt, retrievedAt.toISOString());
  assert.deepEqual(forward?.sourceIdentity, {
    provider: "fantasy-premier-league",
    playerId: "101",
    teamId: "1",
    competitionId: "premier-league",
    seasonId: "2026/27",
    positionGroup: "ATT",
    retrievedAt: retrievedAt.toISOString(),
    isCurrentSeason: true,
    providerIdentifiers: [{
      provider: "opta",
      namespace: "person_numeric",
      externalId: "987654",
      sourceField: "opta_code",
    }],
  });
  assert.equal(forward?.source, "Fantasy Premier League · 2026/27 球员与赛季表现");
  assert.deepEqual(forward?.availableStats, ["goals", "assists"]);
  assert.equal(toPer90(forward!).goals, 1);
  assert.equal(toPer90(forward!).assists, 0.2);
  assert.equal(toPer90(forward!).keyPasses, null);
  assert.deepEqual(forward?.supplementaryMetrics?.map((metric) => [metric.key, metric.sourceField, metric.value]), [
    ["fplExpectedGoalsPer90", "expected_goals", 0.45],
    ["fplExpectedAssistsPer90", "expected_assists", 0.18],
    ["fplExpectedGoalInvolvementsPer90", "expected_goal_involvements", 0.63],
    ["fplTacklesPer90", "tackles", 1.2],
    ["fplRecoveriesPer90", "recoveries", 2],
    ["fplClearancesBlocksInterceptionsPer90", "clearances_blocks_interceptions", 3],
  ]);
  assert.ok(forward?.supplementaryMetrics?.every((metric) => metric.sampleMinutes === 900 && metric.sampleMatches === null));
  assert.equal(defender?.position, "DEF");
  assert.equal(defender?.age, null);
  assert.deepEqual(defender?.availableStats, ["goals", "assists"]);
  assert.equal(defender?.supplementaryMetrics?.find((metric) => metric.key === "fplExpectedGoalsPer90")?.value, null);
  assert.equal(defender?.supplementaryMetrics?.some((metric) => metric.key === "fplExpectedAssistsPer90"), false);
});

test("repository query seam filters, paginates and reloads source players by exact ID", async () => {
  const repo: PlayerRepository = repository(async () => jsonResponse(fixturePayload()));
  const page = await searchPlayerPage(repo, {
    playerName: null,
    position: "ATT",
    maxAge: 24,
    minimumMinutes: 0,
    competition: "英超",
    season: "2026/27",
    offset: 0,
    limit: 1,
  });
  assert.equal(page.totalRecords, 1);
  assert.equal(page.players[0]?.externalPlayerId, "101");
  assert.equal(page.nextOffset, null);
  assert.deepEqual(page.appliedFilters, ["position", "maxAge", "competition", "season"]);
  assert.deepEqual((await loadPlayersByIds(repo, [page.players[0]!.playerId])).map((player) => player.externalPlayerId), ["101"]);
});

test("dataset scope describes the current FPL pool without claiming complete squads", async () => {
  const players = await repository(async () => jsonResponse(fixturePayload())).loadPlayers();
  const scope = describeDatasetScope("fpl", players);

  assert.equal(scope.kind, "current_limited");
  assert.match(scope.title, /Fantasy Premier League 当前赛季/);
  assert.match(scope.summary, /不等于完整注册阵容/);
  assert.equal(scope.observedCoverage?.playerRecordCount, 2);
  assert.deepEqual(scope.observedCoverage?.competitions, ["英超"]);
  assert.deepEqual(scope.observedCoverage?.seasons, ["2026/27"]);
  assert.ok(scope.limitations.some((limitation) => /全球转会市场/.test(limitation)));
  assert.ok(scope.limitations.some((limitation) => /带球推进/.test(limitation)));
});

test("repository coalesces concurrent reads and caches a response for the configured lifetime", async () => {
  let nowMs = retrievedAt.getTime();
  let calls = 0;
  const repo = new PremierLeagueFantasyPlayerRepository({
    now: () => new Date(nowMs),
    cacheTtlMs: 60_000,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(fixturePayload());
    },
  });
  await Promise.all([repo.loadPlayers(), repo.loadPlayers()]);
  await repo.loadPlayers(true);
  assert.equal(calls, 1, "graph refresh hints do not bypass the anti-repeat cache");
  nowMs += 60_001;
  await repo.loadPlayers();
  assert.equal(calls, 2);
});

test("repository sanitizes bad responses and rejects oversized, redirected, throttled and denied requests", async (t) => {
  const cases: Array<{ name: string; fetchImpl: typeof fetch; code: string; messageText?: string }> = [
    {
      name: "non-JSON content type",
      fetchImpl: async () => new Response("private response body", { headers: { "content-type": "text/html" } }),
      code: "invalid_response",
      messageText: "private response body",
    },
    {
      name: "oversized response",
      fetchImpl: async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "10485761" } }),
      code: "response_too_large",
    },
    {
      name: "redirect refusal",
      fetchImpl: async (_input, init) => {
        assert.equal(init?.redirect, "error");
        throw new TypeError("redirect rejected by test transport");
      },
      code: "redirect_rejected",
    },
    {
      name: "rate limit",
      fetchImpl: async () => jsonResponse({ private: "upstream detail" }, 429),
      code: "rate_limit",
      messageText: "upstream detail",
    },
    {
      name: "access denied",
      fetchImpl: async () => jsonResponse({ private: "upstream detail" }, 403),
      code: "blocked",
      messageText: "upstream detail",
    },
    {
      name: "malformed payload",
      fetchImpl: async () => new Response("not json", { headers: { "content-type": "application/json" } }),
      code: "invalid_response",
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const repo = repository(item.fetchImpl);
      await assert.rejects(repo.loadPlayers(), (error: unknown) => {
        assert.ok(error instanceof PremierLeagueFantasyProviderError);
        assert.equal(error.code, item.code);
        if (item.messageText) assert.equal(error.message.includes(item.messageText), false);
        return true;
      });
    });
  }
});

test("provider does not retry a 429 response during the failure cooldown", async () => {
  let calls = 0;
  const repo = repository(async () => {
    calls += 1;
    return jsonResponse({}, 429);
  });
  await assert.rejects(repo.loadPlayers(), { code: "rate_limit" });
  await assert.rejects(repo.loadPlayers(), { code: "rate_limit" });
  assert.equal(calls, 1);
});

test("provider retries one transient network failure before caching a successful snapshot", async () => {
  let calls = 0;
  const repo = repository(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    return jsonResponse(fixturePayload());
  });

  const players = await repo.loadPlayers();

  assert.equal(players.length, 2);
  assert.equal(calls, 2);
  assert.equal((await repo.loadPlayers()).length, 2);
  assert.equal(calls, 2, "a recovered snapshot is cached for subsequent Agent turns");
});

test("provider retries a timeout once, then caches the bounded transport failure", async () => {
  let calls = 0;
  const repo = repository(async () => {
    calls += 1;
    const timeout = new Error("upstream timed out");
    timeout.name = "TimeoutError";
    throw timeout;
  });

  await assert.rejects(repo.loadPlayers(), { code: "timeout" });
  await assert.rejects(repo.loadPlayers(), { code: "timeout" });
  assert.equal(calls, 2, "the provider attempts at most twice and caches the final failure");
});

test("provider does not retry denied, throttled, redirected or invalid responses", async () => {
  const cases: Array<{ name: string; fetchImpl: typeof fetch; code: string }> = [
    { name: "denied", fetchImpl: async () => jsonResponse({}, 403), code: "blocked" },
    { name: "throttled", fetchImpl: async () => jsonResponse({}, 429), code: "rate_limit" },
    {
      name: "redirected",
      fetchImpl: async () => { throw new TypeError("redirect rejected by test transport"); },
      code: "redirect_rejected",
    },
    { name: "invalid body", fetchImpl: async () => new Response("not json", { headers: { "content-type": "application/json" } }), code: "invalid_response" },
  ];

  for (const item of cases) {
    let calls = 0;
    const repo = repository(async (input, init) => {
      calls += 1;
      return item.fetchImpl(input, init);
    });
    await assert.rejects(repo.loadPlayers(), { code: item.code }, item.name);
    assert.equal(calls, 1, `${item.name} is not treated as a transient transport error`);
  }
});

test("provider rejects an unfamiliar position catalog instead of guessing its meaning", async () => {
  const payload = fixturePayload();
  payload.element_types = payload.element_types.filter(({ singular_name_short }) => singular_name_short !== "FWD");
  const repo = repository(async () => jsonResponse(payload));
  await assert.rejects(repo.loadPlayers(), { code: "invalid_response" });
});
