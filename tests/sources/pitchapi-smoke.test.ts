import assert from "node:assert/strict";
import test from "node:test";
import { PitchApiSmokeError, runPitchApiSmoke } from "../../src/sources/pitchapi/smoke.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function leagueResponses(matches: unknown[]) {
  return [
    jsonResponse({ data: { leagues: [{ id: "l_4Kd0Wq", name: "Premier League", country_code: "ENG" }] } }),
    jsonResponse({ data: { id: "l_4Kd0Wq", name: "Premier League", country_code: "ENG", season: "2026/2027" } }),
    jsonResponse({ data: { league: { id: "l_4Kd0Wq", name: "Premier League", season: "2026/2027" }, matches } }),
  ];
}

function matchRows(matchId: string) {
  return jsonResponse({ data: [
    {
      player: { id: "p_private-player-id", name: "Private Player Name", position_id: 4 },
      stats: [
        { key: "top_stats", stats: {
          Goals: { key: "goals", stat: { type: "integer", value: 1 } },
          "Expected goals (xG)": { key: "expected_goals", stat: { type: "double", value: 0.71 } },
        } },
        { key: "defense", stats: { Tackles: { key: "tackles", stat: { type: "integer", value: 0 } } } },
      ],
    },
  ] });
}

function advancedRows(matchId: string) {
  return jsonResponse({ data: {
    match_id: matchId,
    players: [
      {
        player: { id: "p_private-player-id", name: "Private Player Name" },
        minutes_played: 90,
        passing: { progressive_passes: 7 },
        carrying: { progressive_carries: null, take_ons: 3, take_ons_won: 2 },
        creation: { xag: 0.34 },
        defending: { tackles: 1, interceptions: 0, aerials_won: 3 },
      },
    ],
  } });
}

function match(id: string, date: string, status = "finished") {
  return { id, date, status, home_team: { id: "t_home", name: "Home" }, away_team: { id: "t_away", name: "Away" } };
}

test("PitchAPI smoke samples at most three recent played matches and emits coverage only", async () => {
  const calls: Array<{ url: string; key: string | null }> = [];
  const replies = [
    ...leagueResponses([
      match("m_old", "2026-08-01"),
      match("m_scheduled", "2026-10-01", "not_started"),
      match("m_1", "2026-09-27"),
      match("m_2", "2026-10-03"),
      match("m_3", "2026-10-04"),
      match("m_4", "2026-10-05"),
    ]),
    matchRows("m_4"), advancedRows("m_4"),
    matchRows("m_3"), advancedRows("m_3"),
    matchRows("m_2"), advancedRows("m_2"),
  ];
  const result = await runPitchApiSmoke({
    apiKey: "not-a-real-secret",
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), key: new Headers(init?.headers).get("X-API-KEY") });
      const response = replies.shift();
      assert.ok(response, "smoke exceeded the fixture request budget");
      return response;
    },
    now: () => new Date("2026-10-06T00:00:00.000Z"),
  });

  assert.equal(calls.length, 9);
  assert.ok(calls.every((call) => call.key === "not-a-real-secret"));
  assert.ok(calls[2]?.url.includes("season=2026%2F2027"));
  assert.deepEqual(calls.slice(3).map(({ url }) => new URL(url).pathname), [
    "/v1/matches/m_4/players", "/v1/matches/m_4/advanced/players",
    "/v1/matches/m_3/players", "/v1/matches/m_3/advanced/players",
    "/v1/matches/m_2/players", "/v1/matches/m_2/advanced/players",
  ]);
  assert.equal(result.outcome, "player_data_found");
  assert.equal(result.league.name, "Premier League");
  assert.equal(result.season, "2026/2027");
  assert.equal(result.matchesAvailable, 5);
  assert.equal(result.matchesSampled, 3);
  assert.equal(result.matchesWithAdvancedPlayerStats, 3);
  assert.equal(result.standardPlayerRows, 3);
  assert.equal(result.advancedPlayerRows, 3);
  assert.equal(result.requestsMade, 9);
  assert.deepEqual(result.fieldCoverage.find((field) => field.field === "standard.top_stats.goals"), {
    field: "standard.top_stats.goals", rowsWithValue: 3, rows: 3,
  });
  assert.deepEqual(result.fieldCoverage.find((field) => field.field === "advanced.carrying.progressive_carries"), {
    field: "advanced.carrying.progressive_carries", rowsWithValue: 0, rows: 3,
  });
  const output = JSON.stringify(result);
  assert.equal(output.includes("Private Player Name"), false);
  assert.equal(output.includes("p_private-player-id"), false);
  assert.equal(output.includes("0.71"), false);
  assert.equal(output.includes("not-a-real-secret"), false);
});

test("PitchAPI smoke rejects a missing key without making a request", async () => {
  let calls = 0;
  await assert.rejects(
    runPitchApiSmoke({ apiKey: "  ", fetchImpl: async () => { calls += 1; return jsonResponse({}); } }),
    PitchApiSmokeError,
  );
  assert.equal(calls, 0);
});

test("PitchAPI smoke stops on an ambiguous exact league selection", async () => {
  let calls = 0;
  await assert.rejects(runPitchApiSmoke({
    apiKey: "secret",
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ data: { leagues: [
        { id: "l_one", name: "Premier League", country_code: "ENG" },
        { id: "l_two", name: "Premier League", country_code: "ENG" },
      ] } });
    },
  }), (error: unknown) => error instanceof Error && error.message.toLowerCase().includes("more than one"));
  assert.equal(calls, 1);
});

test("PitchAPI smoke reports an empty current-season match list without player requests", async () => {
  const replies = leagueResponses([]);
  let calls = 0;
  const result = await runPitchApiSmoke({
    apiKey: "secret",
    fetchImpl: async () => {
      calls += 1;
      const response = replies.shift();
      assert.ok(response);
      return response;
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.outcome, "no_played_matches");
  assert.equal(result.matchesSampled, 0);
  assert.deepEqual(result.fieldCoverage, []);
});

test("PitchAPI smoke rejects a match list labelled with a different season", async () => {
  const replies = [
    jsonResponse({ data: { leagues: [{ id: "l_4Kd0Wq", name: "Premier League", country_code: "ENG" }] } }),
    jsonResponse({ data: { id: "l_4Kd0Wq", name: "Premier League", country_code: "ENG", season: "2026/2027" } }),
    jsonResponse({ data: {
      league: { id: "l_4Kd0Wq", name: "Premier League", season: "2025/2026" },
      matches: [match("m_old", "2026-05-01")],
    } }),
  ];
  let calls = 0;
  await assert.rejects(runPitchApiSmoke({
    apiKey: "secret",
    fetchImpl: async () => {
      calls += 1;
      const response = replies.shift();
      assert.ok(response);
      return response;
    },
  }), /different or unknown season/);
  assert.equal(calls, 3);
});

test("PitchAPI smoke treats unavailable advanced analytics as a gap and continues", async () => {
  const replies = [
    ...leagueResponses([match("m_1", "2026-10-04"), match("m_2", "2026-10-05")]),
    matchRows("m_2"), jsonResponse({ error: { code: "ANALYTICS_UNAVAILABLE", message: "secret upstream detail" } }, 404),
    matchRows("m_1"), advancedRows("m_1"),
  ];
  const urls: string[] = [];
  const result = await runPitchApiSmoke({
    apiKey: "secret",
    fetchImpl: async (input) => {
      urls.push(String(input));
      const response = replies.shift();
      assert.ok(response);
      return response;
    },
  });
  assert.equal(result.outcome, "player_data_found");
  assert.equal(result.matchesSampled, 2);
  assert.equal(result.matchesWithAdvancedPlayerStats, 1);
  assert.equal(result.standardPlayerRows, 2);
  assert.equal(result.advancedPlayerRows, 1);
  assert.equal(urls.length, 7);
  assert.equal(JSON.stringify(result).includes("secret upstream detail"), false);
});

test("PitchAPI smoke sanitizes upstream API and HTTP errors", async () => {
  await assert.rejects(runPitchApiSmoke({
    apiKey: "secret",
    fetchImpl: async () => jsonResponse({ error: { code: "AUTH_DENIED", message: "bad secret echoed from server" } }, 401),
  }), (error: unknown) => {
    assert.ok(error instanceof PitchApiSmokeError);
    assert.equal(error.message.includes("bad secret echoed from server"), false);
    assert.equal(error.message.includes("secret"), false);
    return true;
  });
});
