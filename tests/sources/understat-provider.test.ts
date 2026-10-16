import assert from "node:assert/strict";
import test from "node:test";
import { searchPlayerPage, type PlayerSearchQuery } from "../../src/sources/registry.js";
import { UnderstatPlayerRepository, UnderstatProviderError } from "../../src/sources/understat/provider.js";

const now = new Date("2026-10-08T12:00:00.000Z");
const leagueSlugs = ["EPL", "La_liga", "Bundesliga", "Serie_A", "Ligue_1"];

function row(overrides: Record<string, string> = {}) {
  return {
    id: "1",
    player_name: "Sample Forward",
    games: "10",
    time: "900",
    goals: "8",
    xG: "10",
    assists: "2",
    xA: "3",
    shots: "50",
    key_passes: "20",
    yellow_cards: "1",
    red_cards: "0",
    position: "F S",
    team_title: "Sample Club",
    npg: "7",
    npxG: "9",
    xGChain: "18",
    xGBuildup: "7",
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200, contentType = "application/json") {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": contentType } });
}

function repositoryFor(options: {
  rowsByLeague?: Record<string, unknown[]>;
  statusByLeague?: Record<string, number>;
  responseFor?: (slug: string) => Response;
  cacheTtlMs?: number;
  clock?: () => Date;
} = {}) {
  const calls: Array<{ slug: string; url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const slug = new URL(url).pathname.split("/").at(-2) ?? "";
    calls.push({ slug, url, init });
    if (options.responseFor) return options.responseFor(slug);
    const status = options.statusByLeague?.[slug] ?? 200;
    const players = options.rowsByLeague?.[slug] ?? [row()];
    return jsonResponse({ players }, status);
  };
  return {
    repository: new UnderstatPlayerRepository({
      fetchImpl,
      now: options.clock ?? (() => now),
      ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
    }),
    calls,
  };
}

const emptyQuery: PlayerSearchQuery = {
  playerName: null,
  position: null,
  maxAge: null,
  minimumMinutes: 0,
  competition: null,
  season: null,
  offset: 0,
  limit: 20,
};

test("loads the current season from all five league pages sequentially with source namespaced IDs", async () => {
  const { repository, calls } = repositoryFor();
  const [players, concurrent] = await Promise.all([repository.loadPlayers(), repository.loadPlayers()]);
  assert.equal(players.length, 5);
  assert.deepEqual(concurrent, players);
  assert.deepEqual(calls.map(({ slug }) => slug), leagueSlugs);
  assert.ok(calls.every(({ url, init }) => {
    const headers = new Headers(init?.headers);
    return url.startsWith("https://understat.com/getLeagueData/")
      && url.endsWith("/2026")
      && init?.redirect === "manual"
      && headers.get("x-requested-with") === "XMLHttpRequest"
      && headers.get("referer") === `https://understat.com/league/${new URL(url).pathname.split("/").at(-2)}/2026`;
  }));
  assert.deepEqual(players.map(({ competition }) => competition), ["英超", "西甲", "德甲", "意甲", "法甲"]);
  assert.equal(new Set(players.map(({ playerId }) => playerId)).size, 5);
  assert.ok(players.every((player) => player.season === "2026/27" && player.sourceIdentity?.isCurrentSeason === true));
  assert.equal(players[0]?.age, null);
  assert.equal(players[0]?.sourceIdentity?.provider, "understat");
  assert.equal(players[0]?.sourceIdentity?.playerId, "EPL:1");
  assert.equal(players[0]?.sourceIdentity?.competitionId, "EPL");
  assert.deepEqual(players[0]?.sourceIdentity?.providerIdentifiers, [{
    provider: "understat",
    namespace: "player",
    externalId: "1",
    sourceField: "id",
  }]);
  assert.equal(players[0]?.sourceUrl, "https://understat.com/league/EPL/2026");
});

test("shared Understat requests stop only after every caller cancels", async () => {
  const requestSignals: AbortSignal[] = [];
  let signalFirstRequestStarted!: () => void;
  let signalFirstRequestAborted!: () => void;
  const firstRequestStarted = new Promise<void>((resolve) => { signalFirstRequestStarted = resolve; });
  const firstRequestAborted = new Promise<void>((resolve) => { signalFirstRequestAborted = resolve; });
  const repository = new UnderstatPlayerRepository({
    now: () => now,
    fetchImpl: async (_input, init) => {
      const signal = init?.signal as AbortSignal;
      requestSignals.push(signal);
      if (requestSignals.length === 1) {
        signalFirstRequestStarted();
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            signalFirstRequestAborted();
            reject(signal.reason);
          }, { once: true });
        });
      }
      return jsonResponse({ players: [row()] });
    },
  });
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = repository.loadPlayers(false, firstController.signal);
  const second = repository.loadPlayers(false, secondController.signal);

  await firstRequestStarted;
  const firstReason = new Error("first caller stopped");
  firstController.abort(firstReason);
  await assert.rejects(first, (error: unknown) => error === firstReason);
  assert.equal(requestSignals[0]?.aborted, false, "one caller stopping must not interrupt a shared source load used by another caller");

  const secondReason = new Error("last caller stopped");
  secondController.abort(secondReason);
  await assert.rejects(second, (error: unknown) => error === secondReason);
  await firstRequestAborted;
  assert.equal(requestSignals[0]?.aborted, true);
  assert.equal(requestSignals.length, 1, "cancelled work must not continue to the next league");
});

test("maps only observed native fields and records definitions, denominator and sample", async () => {
  const { repository } = repositoryFor({ rowsByLeague: Object.fromEntries(leagueSlugs.map((slug) => [slug, [row({ position: "D M" })]])) });
  const player = (await repository.loadPlayers())[0]!;
  const metrics = new Map(player.supplementaryMetrics?.map((metric) => [metric.key, metric]));
  assert.equal(player.position, "UNKNOWN", "multi-group catalog labels must not be reduced to a single asserted position");
  assert.deepEqual(player.sourceIdentity?.positionGroups, ["DEF", "MID"]);
  assert.deepEqual(player.sourceIdentity?.sourcePositionLabels, ["D", "M"]);
  assert.equal(player.stats.goals, 8);
  assert.equal(player.stats.assists, 2);
  assert.equal(player.stats.keyPasses, 20);
  assert.deepEqual(player.availableStats, ["goals", "assists", "keyPasses"]);
  assert.equal(metrics.get("understatExpectedGoalsPer90")?.value, 1);
  assert.equal(metrics.get("understatNonPenaltyExpectedGoalsPer90")?.value, 0.9);
  assert.equal(metrics.get("understatExpectedAssistsPer90")?.value, 0.3);
  assert.equal(metrics.get("understatExpectedGoalsPerShot")?.value, 0.2);
  assert.equal(metrics.get("understatExpectedGoalsPerShot")?.sourceField, "xG / shots");
  assert.equal(metrics.get("understatExpectedGoalsPerShot")?.sampleAttempts, 50);
  assert.equal(metrics.get("understatExpectedGoalsPerShot")?.sampleAttemptsLabel, "次射门");
  assert.equal(metrics.get("understatXgChainPer90")?.sampleMatches, 10);
  assert.ok(metrics.get("understatExpectedGoalsPer90")?.definition.includes("不是终结能力"));
});

test("accepts Understat's JavaScript MIME response only when the body parses as JSON", async () => {
  const { repository } = repositoryFor({ responseFor: () => jsonResponse({ players: [row()] }, 200, "text/javascript;charset=UTF-8") });
  const players = await repository.loadPlayers();
  assert.equal(players.length, 5);
  const { repository: malformed } = repositoryFor({ responseFor: () => new Response("window.payload = {}", {
    status: 200,
    headers: { "content-type": "text/javascript;charset=UTF-8" },
  }) });
  await assert.rejects(malformed.loadPlayers(), (error: unknown) => error instanceof UnderstatProviderError && error.code === "invalid_response");
});

test("does not invent values for absent fields or zero-minute per-90 metrics", async () => {
  const missing = row({ id: "2" });
  delete (missing as Partial<typeof missing>).xA;
  delete (missing as Partial<typeof missing>).key_passes;
  const { repository } = repositoryFor({ rowsByLeague: Object.fromEntries(leagueSlugs.map((slug) => [slug, [
    row({ id: "1", time: "0", shots: "2" }),
    missing,
  ]])) });
  const players = await repository.loadPlayers();
  const zeroMinute = players[0]!;
  const zeroMinuteMetrics = new Map(zeroMinute.supplementaryMetrics?.map((metric) => [metric.key, metric]));
  assert.equal(zeroMinuteMetrics.get("understatExpectedGoalsPer90")?.value, null);
  assert.equal(zeroMinuteMetrics.get("understatExpectedGoalsPerShot")?.value, 5);
  assert.equal(zeroMinute.age, null);
  const missingFieldMetrics = new Map(players[1]?.supplementaryMetrics?.map((metric) => [metric.key, metric]));
  assert.equal(missingFieldMetrics.has("understatExpectedAssistsPer90"), false);
  assert.equal(missingFieldMetrics.has("understatKeyPassesPer90"), false);
  assert.equal(players[1]?.availableStats?.includes("keyPasses"), false);
});

test("supports exact filtering and contiguous local paging without crossing league samples", async () => {
  const rows = [
    row({ id: "1", player_name: "Forward One", position: "F" }),
    row({ id: "2", player_name: "Midfielder Two", position: "M" }),
    row({ id: "3", player_name: "Forward Three", position: "S" }),
  ];
  const { repository } = repositoryFor({ rowsByLeague: Object.fromEntries(leagueSlugs.map((slug) => [slug, rows])) });
  const query = { ...emptyQuery, position: "ATT" as const, limit: 1 };
  const firstPage = await searchPlayerPage(repository, query);
  assert.equal(firstPage.totalRecords, 5, "substitute-only records must not be categorized as forwards");
  assert.equal(firstPage.players[0]?.position, "ATT");
  assert.equal(firstPage.nextOffset, 1);
  const fiveLeaguePage = await searchPlayerPage(repository, { ...query, limit: 5 });
  assert.deepEqual(new Set(fiveLeaguePage.players.map(({ competition }) => competition)), new Set(["英超", "西甲", "德甲", "意甲", "法甲"]));
  assert.equal(fiveLeaguePage.nextOffset, null);
  const secondPage = await searchPlayerPage(repository, { ...query, offset: 1 });
  assert.equal(secondPage.players[0]?.playerId, "understat:La_liga:1:season:2026");
  assert.equal(secondPage.nextOffset, 2);
  const unclassifiedSubstitute = (await repository.loadPlayers()).find((player) => player.sourceIdentity?.playerId === "EPL:3");
  assert.equal(unclassifiedSubstitute?.position, "UNKNOWN");
  assert.deepEqual(unclassifiedSubstitute?.sourceIdentity?.sourcePositionLabels, ["S"]);
});

test("keeps multi-group and unclassified Understat rows available to position-family discovery", async () => {
  const rows = [
    row({ id: "1", player_name: "Forward Midfielder", position: "F M" }),
    row({ id: "2", player_name: "Defensive Midfielder", position: "D M" }),
    row({ id: "3", player_name: "Substitute Position Unknown", position: "S" }),
  ];
  const repository = repositoryFor({ rowsByLeague: Object.fromEntries(leagueSlugs.map((slug) => [slug, rows])) }).repository;

  const broadForward = await searchPlayerPage(repository, { ...emptyQuery, position: "ATT", limit: 20 });
  assert.equal(broadForward.totalRecords, 5, "a multi-group F M record belongs in the broad forward search");
  assert.ok(broadForward.players.every(({ position }) => position === "UNKNOWN"), "multiple catalog groups must not be collapsed into one asserted role");
  assert.deepEqual(broadForward.players[0]?.sourceIdentity?.positionGroups, ["ATT", "MID"]);

  const centralMidfieldDiscovery = await searchPlayerPage(repository, { ...emptyQuery, position: "CM", limit: 20 });
  assert.equal(centralMidfieldDiscovery.totalRecords, 15, "CM role verification must receive both multi-group rows and rows without a catalog position");
  assert.ok(centralMidfieldDiscovery.players.every(({ positionEvidence }) => positionEvidence?.status === "pending"));
  assert.deepEqual(centralMidfieldDiscovery.appliedFilters, ["positionFamily"]);
});

test("retrieves a detailed-position Understat search from its family and marks role evidence pending", async () => {
  const { repository } = repositoryFor({
    rowsByLeague: Object.fromEntries(leagueSlugs.map((slug) => [slug, [row({
      id: "1",
      position: "M",
      player_name: `${slug} Midfielder`,
    })]])),
  });

  const page = await searchPlayerPage(repository, { ...emptyQuery, position: "CM", limit: 10 });

  assert.equal(page.totalRecords, leagueSlugs.length, "the broad MID retrieval pool must not be misreported as an exact CM count");
  assert.equal(page.players.length, leagueSlugs.length);
  assert.ok(page.players.every((player) => player.position === "MID"), "the provider's broad position remains intact");
  assert.ok(page.players.every((player) => player.positionEvidence?.status === "pending"));
  assert.ok(page.players.every((player) => player.positionEvidence?.targetPosition === "CM"));
  assert.deepEqual(page.appliedFilters, ["positionFamily"], "the search observation must disclose family-level retrieval");
});

test("all 17 product positions retrieve from the matching Understat source family", async () => {
  const cases = [
    ["GK", ["GK"], "position"],
    ["DEF", ["DEF"], "position"],
    ["CB", ["DEF"], "positionFamily"],
    ["FB", ["DEF"], "positionFamily"],
    ["LB", ["DEF"], "positionFamily"],
    ["RB", ["DEF"], "positionFamily"],
    ["LWB", ["DEF", "MID"], "positionFamily"],
    ["RWB", ["DEF", "MID"], "positionFamily"],
    ["MID", ["MID"], "position"],
    ["DM", ["DEF", "MID"], "positionFamily"],
    ["CM", ["DEF", "MID"], "positionFamily"],
    ["AM", ["MID", "ATT"], "positionFamily"],
    ["ATT", ["ATT"], "position"],
    ["WG", ["MID", "ATT"], "positionFamily"],
    ["LW", ["MID", "ATT"], "positionFamily"],
    ["RW", ["MID", "ATT"], "positionFamily"],
    ["ST", ["MID", "ATT"], "positionFamily"],
  ] as const;
  const rows = [
    row({ id: "1", player_name: "Keeper", position: "GK" }),
    row({ id: "2", player_name: "Defender", position: "D" }),
    row({ id: "3", player_name: "Midfielder", position: "M" }),
    row({ id: "4", player_name: "Forward", position: "F" }),
  ];
  const repository = repositoryFor({ rowsByLeague: Object.fromEntries(leagueSlugs.map((slug) => [slug, rows])) }).repository;

  for (const [requested, expectedFamilies, expectedFilter] of cases) {
    const page = await searchPlayerPage(repository, { ...emptyQuery, position: requested, limit: 10 });
    assert.equal(page.totalRecords, leagueSlugs.length * expectedFamilies.length, `${requested} should search ${expectedFamilies.join("/")} source families`);
    assert.equal(page.players.length, Math.min(10, page.totalRecords), requested);
    assert.ok(page.players.every((player) => player.sourceIdentity?.positionGroups?.some((group) => expectedFamilies.includes(group as never))), `${requested} must retain all source groups`);
    assert.deepEqual(page.appliedFilters, [expectedFilter], requested);
  }
});

test("fails an explicit age filter because Understat has no birth dates", async () => {
  const { repository, calls } = repositoryFor();
  await assert.rejects(
    searchPlayerPage(repository, { ...emptyQuery, maxAge: 23 }),
    (error: unknown) => error instanceof UnderstatProviderError
      && error.code === "unsupported_scope"
      && error.message.includes("未提供出生日期或年龄"),
  );
  assert.equal(calls.length, 0);
});

test("investigates a bounded candidate group with at most four concurrent player requests", async () => {
  const playerRows = Object.fromEntries(leagueSlugs.map((slug, leagueIndex) => [
    slug,
    [0, 1, 2].map((playerIndex) => row({
      id: String(leagueIndex * 10 + playerIndex + 1),
      player_name: `${slug} Player ${playerIndex + 1}`,
    })),
  ]));
  let active = 0;
  let maxActive = 0;
  let playerRequests = 0;
  const repository = new UnderstatPlayerRepository({
    now: () => now,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/getLeagueData/")) {
        const slug = url.pathname.split("/").at(-2)!;
        return jsonResponse({ players: playerRows[slug] });
      }
      const sourcePlayerId = url.pathname.split("/").at(-1)!;
      playerRequests += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      const seasons = Array.from({ length: 10 }, (_, index) => 2026 - index);
      const rowStats = { time: "900", games: "10", goals: "8", shots: "50", xG: "10", assists: "2", xA: "3", key_passes: "20", npxG: "9", xGChain: "18", xGBuildup: "7" };
      const categoryRows = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`Zone ${index}`, rowStats]));
      return jsonResponse({
        player: { id: sourcePlayerId, name: `Player ${sourcePlayerId}` },
        groups: {
          position: Object.fromEntries(seasons.map((season) => [String(season), { FW: rowStats }])),
          season: seasons.map((season) => ({ season, team: "Sample Club", position: "FW", ...rowStats })),
          situation: { "2026": { OpenPlay: rowStats, SetPiece: rowStats, Penalty: rowStats } },
          shotZones: { "2026": categoryRows },
          shotTypes: { "2026": categoryRows },
        },
        matches: Array.from({ length: 8 }, (_, index) => ({ id: String(10_000 + index), date: `2026-10-${String(15 - index).padStart(2, "0")}`, h_team: "Home", a_team: "Away", time: "90", ...rowStats })),
      });
    },
  });
  const candidates = (await repository.loadPlayers()).slice(0, 12);
  const requestedIds = candidates.map(({ playerId }) => playerId);
  const insights = await repository.inspectCandidateGroup(requestedIds, ["positions", "recent", "history", "shotProfile"]);

  assert.deepEqual(insights.map(({ playerId }) => playerId), requestedIds);
  assert.equal(insights.length, 12);
  assert.equal(playerRequests, 12);
  assert.ok(maxActive > 1 && maxActive <= 4);
  assert.ok(insights.every((insight) => insight.availableSections.includes("shotProfile")));
  assert.deepEqual(insights[0]?.positions?.length, 8, "cohort position rows are capped without discarding the full raw snapshot");
  assert.equal(insights[0]?.history?.length, 6);
  assert.equal(insights[0]?.recent?.length, 5);
  assert.equal(insights[0]?.shotProfile?.length, 15);
  assert.ok(insights[0]?.notes.some((note) => note.includes("仅展示部分")));
});

test("keeps season and position performance distinct and preserves missing values", async () => {
  const detail = {
    player: { id: "1", name: "Sample Forward", favorite_position: "FW" },
    groups: {
      position: {
        "2025": { FW: { time: "700", games: "9", goals: "3", shots: "18", xG: "4.2", assists: "1", xA: "0.8", key_passes: "7", npxG: "3.4", xGChain: "5", xGBuildup: "1" } },
        "2026": { FW: { time: "500", games: "7", goals: "4", shots: "20", xG: "5.1", assists: "0", xA: null, key_passes: "5", npxG: "4.8", xGChain: "6", xGBuildup: "2" } },
      },
      season: [
        { season: 2026, team: "Sample Club", position: "FW", games: "7", time: "500", goals: "4", shots: "20", xG: "5.1", assists: "0", xA: null, key_passes: "5", npxG: "4.8", xGChain: "6", xGBuildup: "2" },
      ],
    },
  };
  const repository = new UnderstatPlayerRepository({
    now: () => now,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/getLeagueData/")) return jsonResponse({ players: [row()] });
      return jsonResponse(detail);
    },
  });
  const player = (await repository.loadPlayers())[0]!;
  const insight = await repository.inspectPlayer(player.playerId, ["positions", "history"]);

  assert.deepEqual(insight.positions?.map(({ season, code }) => [season, code]), [["2026", "FW"], ["2025", "FW"]]);
  assert.equal(insight.positions?.[0]?.xG, 5.1);
  assert.equal(insight.positions?.[0]?.xA, null);
  assert.equal(insight.history?.[0]?.goals, 4);
  assert.equal(insight.history?.[0]?.assists, 0);
  assert.equal(insight.history?.[0]?.xA, null);
});

test("distinguishes requested Understat sections from sections with returned evidence", async () => {
  const repository = new UnderstatPlayerRepository({
    now: () => now,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/getLeagueData/")) return jsonResponse({ players: [row()] });
      return jsonResponse({ player: { id: "1", name: "Sample Forward" } });
    },
  });
  const player = (await repository.loadPlayers())[0]!;
  const insight = await repository.inspectPlayer(player.playerId, ["positions", "history", "recent", "shotProfile"]);

  assert.deepEqual(insight.requestedSections, ["positions", "history", "recent", "shotProfile"]);
  assert.deepEqual(insight.availableSections, [], "an empty source payload must not be presented as evidence");
  assert.equal(insight.positions, undefined);
  assert.equal(insight.history, undefined);
  assert.equal(insight.recent, undefined);
  assert.equal(insight.shotProfile, undefined);
});

test("uses Understat's canonical team slug for detail requests and source links", async () => {
  const paths: string[] = [];
  const repository = new UnderstatPlayerRepository({
    now: () => now,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname.startsWith("/getLeagueData/")) {
        return jsonResponse({ players: [row({ team_title: url.pathname.includes("/Serie_A/") ? "AC Milan" : "Sample Club" })] });
      }
      return jsonResponse({ dates: [], statistics: {}, players: [] });
    },
  });

  const insight = await repository.inspectTeamDetails("AC Milan");

  assert.equal(paths.at(-1), "/getTeamData/AC_Milan/2026");
  assert.equal(insight?.sourceUrl, "https://understat.com/team/AC_Milan/2026");
});

test("stops on a blocked or rate-limited league page without retrying or continuing", async (context) => {
  for (const [status, expectedCode] of [[403, "blocked"], [429, "rate_limit"]] as const) {
    await context.test(`HTTP ${status}`, async () => {
      const { repository, calls } = repositoryFor({ statusByLeague: { EPL: status } });
      await assert.rejects(repository.loadPlayers(), (error: unknown) => error instanceof UnderstatProviderError && error.code === expectedCode);
      assert.equal(calls.length, 1);
    });
  }
});

test("rejects redirects, non-JSON responses, oversized payloads, malformed data, and duplicate source IDs", async (context) => {
  const cases: Array<{ name: string; response: () => Response; code: string }> = [
    { name: "redirect", response: () => new Response(null, { status: 302 }), code: "redirect_rejected" },
    { name: "content type", response: () => jsonResponse({ players: [row()] }, 200, "text/html"), code: "invalid_response" },
    { name: "size", response: () => new Response(" ".repeat(5 * 1024 * 1024 + 1), { status: 200, headers: { "content-type": "application/json" } }), code: "response_too_large" },
    { name: "malformed shape", response: () => jsonResponse({ players: [] }), code: "invalid_response" },
    { name: "duplicate IDs", response: () => jsonResponse({ players: [row(), row({ team_title: "Another Club" })] }), code: "invalid_response" },
  ];
  for (const item of cases) {
    await context.test(item.name, async () => {
      const { repository, calls } = repositoryFor({ responseFor: () => item.response() });
      await assert.rejects(repository.loadPlayers(), (error: unknown) => error instanceof UnderstatProviderError && error.code === item.code);
      assert.equal(calls.length, 1);
    });
  }
});

test("expires the in-memory snapshot and validates cache configuration", async () => {
  let currentTime = now;
  const { repository, calls } = repositoryFor({ cacheTtlMs: 1_000, clock: () => currentTime });
  await repository.loadPlayers();
  await repository.loadPlayers();
  assert.equal(calls.length, 5);
  currentTime = new Date(now.getTime() + 1_001);
  await repository.loadPlayers();
  assert.equal(calls.length, 10);
  assert.throws(() => new UnderstatPlayerRepository({ cacheTtlMs: -1 }), (error: unknown) => (
    error instanceof UnderstatProviderError && error.code === "invalid_configuration"
  ));
});
