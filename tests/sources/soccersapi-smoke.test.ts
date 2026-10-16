import assert from "node:assert/strict";
import test from "node:test";
import { runSoccersApiSmoke, SoccersApiSmokeError } from "../../src/sources/soccersapi/smoke.js";

const selectedLeague = {
  id: 701,
  name: "Example League",
  country: { cc: "pl" },
};

const leagueInfo = {
  id: 701,
  id_current_season: "2026-season",
  seasons: [{ id: "2026-season", name: "2026/27", is_current: "1" }],
};

const teams = [
  { id: 10, name: "Zulu FC" },
  { id: 20, name: "Alpha FC" },
];

function fixtureResponses(): unknown[] {
  return [
    { data: [selectedLeague], meta: { plan: "Free", requests_left: 99 } },
    { data: leagueInfo, meta: { plan: "Free", requests_left: 98 } },
    { data: teams, meta: { requests_left: 97 } },
    {
      data: {
        squad: Array.from({ length: 7 }, (_, index) => ({
          player: {
            id: 100 + index,
            name: `Private Player ${index + 1}`,
            age: index < 5 ? 20 + index : null,
            country: index === 0 ? { name: "Country" } : null,
          },
          position: index < 4 ? "F" : null,
        })),
      },
      meta: { requests_left: 96 },
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      data: {
        id: 100 + index,
        minutes_played: index === 0 ? 0 : 900 + index,
        matches: { played: { total: index + 1 }, starting: { total: index } },
        goals: { total: index === 0 ? 0 : index, avg: 0 },
        assists: { total: index === 0 ? null : 1 },
        shots: { total: index === 0 ? 0 : 2, on_target: { total: 1 }, off_target: { total: 0 }, blocked: { total: null } },
      },
      meta: { requests_left: 95 - index },
    })),
  ];
}

function fixtureFetch(responses: unknown[]) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    const payload = responses.shift();
    if (payload === undefined) throw new Error("Fixture responses exhausted.");
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, requests };
}

const baseOptions = {
  apiKey: "development-secret",
  leagueName: "Example League",
  countryCode: "PL",
  now: () => new Date("2026-10-09T00:00:00.000Z"),
};

test("SoccersAPI smoke resolves an entitled current season and samples at most five player rows", async () => {
  const { fetchImpl, requests } = fixtureFetch(fixtureResponses());
  const result = await runSoccersApiSmoke({ ...baseOptions, fetchImpl });

  assert.equal(result.source, "SoccersAPI v2.2");
  assert.equal(result.league.name, "Example League");
  assert.equal(result.league.countryCode, "PL");
  assert.deepEqual(result.season, { id: "2026-season", name: "2026/27" });
  assert.equal(result.teamName, "Alpha FC");
  assert.equal(result.squadRows, 7);
  assert.equal(result.playersSampled, 5);
  assert.equal(result.playersWithStats, 5);
  assert.equal(result.plan, "Free");
  assert.equal(result.requestsRemaining, 91);
  assert.equal(result.requestsMade, 9);
  assert.equal(requests.length, 9);
  assert.deepEqual(result.squadFieldCoverage, [
    { field: "age", rowsWithValue: 5, rows: 7 },
    { field: "position", rowsWithValue: 4, rows: 7 },
    { field: "nationality", rowsWithValue: 1, rows: 7 },
  ]);
  const goals = result.metricCoverage.find(({ metric }) => metric === "goals.total");
  const assists = result.metricCoverage.find(({ metric }) => metric === "assists.total");
  const minutes = result.metricCoverage.find(({ metric }) => metric === "minutes_played");
  assert.deepEqual(goals, { metric: "goals.total", label: "goals", rowsWithValue: 5, rows: 5 });
  assert.deepEqual(assists, { metric: "assists.total", label: "assists", rowsWithValue: 4, rows: 5 });
  assert.deepEqual(minutes, { metric: "minutes_played", label: "minutes played", rowsWithValue: 5, rows: 5 });
  assert.ok(requests.every(({ url }) => !url.includes("development-secret") && !url.includes("api_key=")));
  assert.ok(requests.every(({ init }) => new Headers(init?.headers).get("authorization") === "Bearer development-secret"));
  const output = JSON.stringify(result);
  assert.ok(!output.includes("Private Player"));
  assert.ok(!output.includes("100"));
  assert.ok(!output.includes("900"));
});

test("missing SoccersAPI key fails before making a request", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  };
  await assert.rejects(
    runSoccersApiSmoke({ ...baseOptions, apiKey: "", fetchImpl }),
    (error: unknown) => error instanceof SoccersApiSmokeError && error.message.includes("SOCCERSAPI_API_KEY"),
  );
  assert.equal(calls, 0);
});

test("an exact league outside the configured account is rejected without guessing", async () => {
  const { fetchImpl, requests } = fixtureFetch([{ data: [], meta: { plan: "Free" } }]);
  await assert.rejects(
    runSoccersApiSmoke({ ...baseOptions, fetchImpl }),
    /not present in the configured account/,
  );
  assert.equal(requests.length, 1);
});

test("ambiguous exact league and country matches are rejected", async () => {
  const { fetchImpl, requests } = fixtureFetch([{
    data: [selectedLeague, { ...selectedLeague, id: 702 }],
    meta: {},
  }]);
  await assert.rejects(runSoccersApiSmoke({ ...baseOptions, fetchImpl }), /matched more than one/);
  assert.equal(requests.length, 1);
});

test("a missing or contradictory current-season ID stops before team queries", async () => {
  for (const data of [
    { ...leagueInfo, id_current_season: null },
    { ...leagueInfo, seasons: [{ id: "other-season", name: "2025/26", is_current: "1" }] },
  ]) {
    const { fetchImpl, requests } = fixtureFetch([
      { data: [selectedLeague], meta: {} },
      { data, meta: {} },
    ]);
    await assert.rejects(runSoccersApiSmoke({ ...baseOptions, fetchImpl }));
    assert.equal(requests.length, 2);
  }
});

test("an explicitly selected team must exactly match one team in the current season", async () => {
  const { fetchImpl, requests } = fixtureFetch([
    { data: [selectedLeague], meta: {} },
    { data: leagueInfo, meta: {} },
    { data: teams, meta: {} },
  ]);
  await assert.rejects(runSoccersApiSmoke({ ...baseOptions, teamName: "Alpha", fetchImpl }), /No exact current-season team/);
  assert.equal(requests.length, 3);
});

test("plan and rate-limit errors are sanitized and never retried", async () => {
  for (const [status, message] of [
    [401, "rejected the configured development key"],
    [403, "denied access"],
    [429, "allowance was reached"],
  ] as const) {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("provider-private-error", { status });
    };
    await assert.rejects(
      runSoccersApiSmoke({ ...baseOptions, fetchImpl }),
      (error: unknown) => error instanceof SoccersApiSmokeError
        && error.message.includes(message)
        && !error.message.includes("provider-private-error"),
    );
    assert.equal(calls, 1);
  }
});

test("redirects are rejected without following the destination", async () => {
  let calls = 0;
  let redirectMode: RequestRedirect | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    calls += 1;
    redirectMode = init?.redirect;
    return new Response("private redirect body", {
      status: 302,
      headers: { location: "https://example.invalid/redirected" },
    });
  };
  await assert.rejects(runSoccersApiSmoke({ ...baseOptions, fetchImpl }), /redirects are rejected/);
  assert.equal(calls, 1);
  assert.equal(redirectMode, "error");
});

test("a timed-out request is not retried and does not reveal transport details", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    calls += 1;
    init?.signal?.addEventListener("abort", () => reject(new DOMException("secret transport detail", "AbortError")), { once: true });
  });
  await assert.rejects(
    runSoccersApiSmoke({ ...baseOptions, requestTimeoutMs: 1, fetchImpl }),
    (error: unknown) => error instanceof SoccersApiSmokeError
      && error.message.includes("timed out")
      && !error.message.includes("secret transport detail"),
  );
  assert.equal(calls, 1);
});

test("oversized and malformed responses fail with sanitized messages", async () => {
  const oversizedFetch: typeof fetch = async () => new Response("x".repeat(1_000_001), { status: 200 });
  await assert.rejects(runSoccersApiSmoke({ ...baseOptions, fetchImpl: oversizedFetch }), /one-megabyte/);

  const malformedFetch: typeof fetch = async () => new Response("not-json", { status: 200 });
  await assert.rejects(runSoccersApiSmoke({ ...baseOptions, fetchImpl: malformedFetch }), /invalid JSON/);
});

test("a player-stat response that returns a different source ID is rejected", async () => {
  const responses = fixtureResponses();
  responses[4] = { data: { id: "unrelated-player", minutes_played: 900 }, meta: {} };
  const { fetchImpl, requests } = fixtureFetch(responses);
  await assert.rejects(runSoccersApiSmoke({ ...baseOptions, fetchImpl }), /identity did not match/);
  assert.equal(requests.length, 5);
});
