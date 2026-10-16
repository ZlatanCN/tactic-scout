import assert from "node:assert/strict";
import test from "node:test";
import { PlayerProfileSchema, type PlayerProfile } from "../../src/domain/players.js";
import { inspectTeamPlayers, type PlayerRepository } from "../../src/sources/registry.js";

function player(playerId: string, team: string): PlayerProfile {
  return PlayerProfileSchema.parse({
    playerId,
    name: `Player ${playerId}`,
    team,
    age: 22,
    position: "CM",
    competition: "Example League",
    season: "2025/26",
    minutes: 1800,
    source: "test-fixture",
    stats: {},
  });
}

test("team inspection loads the catalog and matches normalized partial team names", async () => {
  const players = [player("bayern-1", "FC Bayern München"), player("barca-1", "FC Barcelona")];
  const loads: Array<{ refresh?: boolean; signal?: AbortSignal }> = [];
  const repository: PlayerRepository = {
    mode: "demo",
    sourceName: "test repository",
    loadPlayers: async (refresh, signal) => {
      loads.push({ refresh, signal });
      return players;
    },
  };
  const controller = new AbortController();

  const result = await inspectTeamPlayers(repository, "Bayern", controller.signal);

  assert.deepEqual(result, [players[0]]);
  assert.deepEqual(loads, [{ refresh: false, signal: controller.signal }]);
});

test("team inspection stops after cancellation during catalog loading", async () => {
  let releaseLoad!: (players: PlayerProfile[]) => void;
  let loadCount = 0;
  const repository: PlayerRepository = {
    mode: "demo",
    sourceName: "test repository",
    loadPlayers: async () => {
      loadCount += 1;
      return new Promise<PlayerProfile[]>((resolve) => { releaseLoad = resolve; });
    },
  };
  const controller = new AbortController();
  const inspection = inspectTeamPlayers(repository, "Bayern", controller.signal);

  controller.abort();
  releaseLoad([player("bayern-1", "FC Bayern München")]);

  await assert.rejects(inspection, { name: "AbortError" });
  assert.equal(loadCount, 1);
});
