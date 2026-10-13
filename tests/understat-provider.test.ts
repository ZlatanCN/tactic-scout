import assert from "node:assert/strict";
import test from "node:test";
import { searchPlayerPage, type PlayerSearchQuery } from "../src/data/provider.js";
import { UnderstatPlayerRepository, UnderstatProviderError } from "../src/data/understat-provider.js";

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
  assert.equal(player.position, "DEF");
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
  assert.equal(firstPage.totalRecords, 10);
  assert.equal(firstPage.players[0]?.position, "ATT");
  assert.equal(firstPage.nextOffset, 1);
  const fiveLeaguePage = await searchPlayerPage(repository, { ...query, limit: 5 });
  assert.deepEqual(new Set(fiveLeaguePage.players.map(({ competition }) => competition)), new Set(["英超", "西甲", "德甲", "意甲", "法甲"]));
  assert.equal(fiveLeaguePage.nextOffset, 5);
  const secondPage = await searchPlayerPage(repository, { ...query, offset: 1 });
  assert.equal(secondPage.players[0]?.playerId, "understat:La_liga:1:season:2026");
  assert.equal(secondPage.nextOffset, 2);
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
