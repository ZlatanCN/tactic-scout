import assert from "node:assert/strict";
import test from "node:test";
import { createTheSportsDbRosterEnrichment } from "../../src/sources/thesportsdb/roster.js";

test("TheSportsDB sidecar selects only verified men's soccer teams and players", async (t) => {
  const replies = [
    {
      teams: [
        { idTeam: "women-1", strTeam: "Arsenal", strSport: "Soccer", strGender: "Female" },
        { idTeam: "other-sport-1", strTeam: "Arsenal", strSport: "Basketball", strGender: "Male" },
        { idTeam: "men-1", strTeam: "Arsenal", strSport: "Soccer", strGender: "Male" },
      ],
    },
    {
      player: [
        { idPlayer: "male-soccer-1", strPlayer: "Men's Soccer Player", strPosition: "Forward", strSport: "Soccer", strGender: "Male" },
        { idPlayer: "female-soccer-1", strPlayer: "Women's Soccer Player", strPosition: "Forward", strSport: "Soccer", strGender: "Female" },
        { idPlayer: "male-other-sport-1", strPlayer: "Other Sport Player", strPosition: "Forward", strSport: "Rugby", strGender: "Male" },
        { idPlayer: "unknown-scope-1", strPlayer: "Unverified Player", strPosition: "Forward" },
      ],
    },
  ];
  const requestedUrls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requestedUrls.push(String(input));
    const reply = replies.shift();
    assert.ok(reply, "the adapter exceeded its expected two requests");
    return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } });
  });

  const provider = createTheSportsDbRosterEnrichment({ apiKey: "123", fetchEnabled: true });
  const result = await provider.lookupTeamRosterSample("Arsenal");

  assert.equal(result.status, "partial");
  assert.equal(result.team?.id, "men-1");
  assert.deepEqual(result.matchedTeams.map((team) => team.id), ["men-1"]);
  assert.deepEqual(result.players.map((player) => player.id), ["male-soccer-1"]);
  assert.equal(result.returnedCount, 1);
  assert.deepEqual(requestedUrls.map((url) => new URL(url).searchParams.get("id")), [null, "men-1"]);
  assert.equal(requestedUrls.length, 2);
});

test("TheSportsDB does not fetch a roster when an exact-name team lacks men's soccer metadata", async (t) => {
  const requestedUrls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({
      teams: [{ idTeam: "unverified-1", strTeam: "Arsenal", strSport: "Soccer" }],
    }), { headers: { "content-type": "application/json" } });
  });

  const provider = createTheSportsDbRosterEnrichment({ apiKey: "123", fetchEnabled: true });
  const result = await provider.lookupTeamRosterSample("Arsenal");

  assert.equal(result.status, "not_found");
  assert.equal(result.team, null);
  assert.deepEqual(result.matchedTeams, []);
  assert.match(result.notice, /无法核实为男子足球/);
  assert.equal(requestedUrls.length, 1, "an unverified team must not trigger a roster lookup");
});
