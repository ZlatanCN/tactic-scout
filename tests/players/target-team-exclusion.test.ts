import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerProfile } from "../../src/domain/players.js";
import { searchLoadedPlayers } from "../../src/players/search.js";

function player(input: {
  playerId: string;
  team: string;
  provider?: string;
  isCurrentSeason?: boolean;
}): PlayerProfile {
  return {
    playerId: input.playerId,
    name: input.playerId,
    team: input.team,
    age: 23,
    position: "CB",
    competition: "La Liga",
    season: "2026/27",
    minutes: 900,
    stats: {
      goals: 0, assists: 0, passesAttempted: 0, passesCompleted: 0, longPasses: 0,
      carries: 0, pressures: 0, tackles: 0, interceptions: 0, shotAssists: 0, keyPasses: 0,
    },
    source: "Target team fixture",
    ...(input.provider ? { sourceIdentity: {
      provider: input.provider,
      playerId: input.playerId,
      retrievedAt: "2026-10-20T00:00:00.000Z",
      ...(input.isCurrentSeason === undefined ? {} : { isCurrentSeason: input.isCurrentSeason }),
    } } : {}),
  };
}

test("only source-confirmed current players at the target club are excluded from recruitment search", () => {
  const currentBarcelona = player({ playerId: "pau", team: "FC Barcelona", provider: "understat", isCurrentSeason: true });
  const currentArsenal = player({ playerId: "saliba", team: "Arsenal", provider: "understat", isCurrentSeason: true });
  const historicalBarcelona = player({ playerId: "historic", team: "Barcelona", provider: "wyscout", isCurrentSeason: false });
  const fmOnly = player({ playerId: "fm-only", team: "", provider: "fm" });

  const page = searchLoadedPlayers([currentBarcelona, currentArsenal, historicalBarcelona, fmOnly], {
    targetTeam: "巴萨",
    playerName: null,
    position: null,
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 20,
  });

  assert.deepEqual(page.players.map(({ playerId }) => playerId), ["saliba", "historic"]);
  assert.equal(page.totalRecords, 2);
  assert.ok(page.appliedFilters.includes("targetTeam"));
});

test("without a target club, the same player records remain discoverable", () => {
  const records = [
    player({ playerId: "pau", team: "Barcelona", provider: "understat", isCurrentSeason: true }),
    player({ playerId: "fm-only", team: "", provider: "fm" }),
  ];
  const page = searchLoadedPlayers(records, {
    targetTeam: null,
    playerName: null,
    position: null,
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 20,
  });

  assert.deepEqual(page.players.map(({ playerId }) => playerId), ["pau", "fm-only"]);
});
