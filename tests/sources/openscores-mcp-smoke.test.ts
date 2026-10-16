import assert from "node:assert/strict";
import test from "node:test";
import { OpenScoresSmokeError, runOpenScoresSmoke } from "../../src/sources/openscores/smoke.js";

const requiredTools = [
  "list_leagues", "list_seasons", "list_fixtures", "get_fixture", "get_standings",
  "search_teams", "get_team", "search_players", "get_player",
];

function toolCatalog() {
  return {
    tools: requiredTools.map((name) => ({
      name,
      inputSchema: {
        type: "object",
        properties: name === "search_teams" ? { q: { type: "string" } }
          : name === "get_team" ? { team_id: { type: "integer" } }
            : {},
      },
    })),
  };
}

function jsonRpcResponse(id: number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sseRpcResponse(id: number, result: unknown): Response {
  return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function toolResponse(id: number, value: unknown): Response {
  return jsonRpcResponse(id, { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] });
}

test("OpenScores smoke rejects a missing key before making a request", async () => {
  let calls = 0;
  await assert.rejects(runOpenScoresSmoke({
    apiKey: "  ",
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  }), OpenScoresSmokeError);
  assert.equal(calls, 0);
});

test("OpenScores smoke inspects one globally searched exact team and squad, returning coverage counts only", async () => {
  const replies = [
    jsonRpcResponse(1, toolCatalog()),
    toolResponse(2, { items: [{ id: 121, name: "Arsenal" }] }),
    toolResponse(3, {
      id: 121,
      name: "Arsenal",
      current_season: "2026/2027",
      current_season_squad: [
        { player: { id: "p_private_1", name: "Private Player Name", position: "FW", date_of_birth: "2000-01-01" }, nationality: "ENG" },
        { player: { id: "p_private_2", name: "Another Private Player", position: "DF" }, nationality: null },
      ],
    }),
  ];
  const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const result = await runOpenScoresSmoke({
    apiKey: "private-test-key",
    fetchImpl: async (input, init = {}) => {
      requests.push({ url: String(input), init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      const response = replies.shift();
      assert.ok(response, "smoke exceeded its fixed request budget");
      return response;
    },
    now: () => new Date("2026-10-06T00:00:00.000Z"),
  });

  assert.deepEqual(requests.map(({ body }) => body.method), ["tools/list", "tools/call", "tools/call"]);
  assert.deepEqual(requests.slice(1).map(({ body }) => (body.params as Record<string, unknown>).name), ["search_teams", "get_team"]);
  assert.ok(requests.every(({ url }) => url === "https://api.openscores.ai/mcp/"));
  assert.ok(requests.every(({ init }) => init.redirect === "error"));
  assert.ok(requests.every(({ init }) => new Headers(init.headers).get("Authorization") === "Bearer private-test-key"));
  assert.deepEqual((requests[1]?.body.params as Record<string, unknown>).arguments, { q: "Arsenal" });
  assert.deepEqual((requests[2]?.body.params as Record<string, unknown>).arguments, { team_id: 121 });

  assert.equal(result.squadRows, 2);
  assert.equal(result.requestsMade, 3);
  assert.equal(result.teamFieldCoverage.id, true);
  assert.equal(result.teamFieldCoverage.squad, true);
  assert.equal(result.squadFieldCoverage.id, 2);
  assert.equal(result.squadFieldCoverage.name, 2);
  assert.equal(result.squadFieldCoverage.position, 2);
  assert.equal(result.squadFieldCoverage.dateOfBirth, 1);
  assert.equal(result.squadFieldCoverage.statistics, 0);
  const output = JSON.stringify(result);
  assert.equal(output.includes("private-test-key"), false);
  assert.equal(output.includes("Private Player Name"), false);
  assert.equal(output.includes("p_private_1"), false);
  assert.equal(output.includes("2000-01-01"), false);
});

test("OpenScores smoke accepts the documented streamable HTTP event response", async () => {
  const responses = [
    sseRpcResponse(1, toolCatalog()),
    toolResponse(2, { items: [{ id: 121, name: "Arsenal" }] }),
    toolResponse(3, { id: 121, name: "Arsenal", current_season_squad: [] }),
  ];
  const result = await runOpenScoresSmoke({
    apiKey: "secret",
    fetchImpl: async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  });
  assert.equal(result.requestsMade, 3);
  assert.equal(result.squadRows, 0);
});

test("OpenScores smoke rejects ambiguous team names before reading a profile", async () => {
  const responses = [
    jsonRpcResponse(1, toolCatalog()),
    toolResponse(2, { items: [
      { id: 121, name: "Arsenal" },
      { id: 200, name: "Arsenal" },
    ] }),
  ];
  let calls = 0;
  await assert.rejects(runOpenScoresSmoke({
    apiKey: "secret",
    fetchImpl: async () => {
      calls += 1;
      return responses.shift()!;
    },
  }), /More than one exact team/);
  assert.equal(calls, 2);
});

test("OpenScores smoke rejects an empty exact team search without guessing", async () => {
  const responses = [
    jsonRpcResponse(1, toolCatalog()),
    toolResponse(2, { items: [] }),
  ];
  let calls = 0;
  await assert.rejects(runOpenScoresSmoke({
    apiKey: "secret",
    fetchImpl: async () => {
      calls += 1;
      return responses.shift()!;
    },
  }), /No exact team match/);
  assert.equal(calls, 2);
});

test("OpenScores smoke stops when a documented tool schema changes", async () => {
  const catalog = toolCatalog();
  catalog.tools = catalog.tools.map((tool) => tool.name === "get_team"
    ? { ...tool, inputSchema: { type: "object", properties: { id: { type: "integer" } } } }
    : tool);
  let calls = 0;
  await assert.rejects(runOpenScoresSmoke({
    apiKey: "secret",
    fetchImpl: async () => {
      calls += 1;
      return jsonRpcResponse(1, catalog);
    },
  }), OpenScoresSmokeError);
  assert.equal(calls, 1);
});

test("OpenScores smoke sanitizes authentication and rate-limit failures", async () => {
  const errors = [
    { status: 401, message: "OpenScores rejected the configured API key or access." },
    { status: 429, message: "OpenScores rate limit was reached. The smoke does not retry requests." },
  ];
  for (const expected of errors) {
    const response = new Response(JSON.stringify({ error: "secret upstream details Private Player" }), {
      status: expected.status,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(runOpenScoresSmoke({
      apiKey: "secret",
      fetchImpl: async () => response,
    }), (error: unknown) => {
      assert.ok(error instanceof OpenScoresSmokeError);
      assert.equal(error.message, expected.message);
      assert.equal(error.message.includes("secret"), false);
      assert.equal(error.message.includes("Private Player"), false);
      return true;
    });
  }
});
