import assert from "node:assert/strict";
import test from "node:test";
import { searchPlayerPage } from "../../src/players/repository.js";
import { PlayerProfileSchema } from "../../src/domain/players.js";

test("a dense selected position cannot consume every slot before another selected position is investigated", async () => {
  const makePlayer = (id: string, position: string, extra = {}) => PlayerProfileSchema.parse({ playerId: id, name: id, team: "Fixture", age: 23, position, competition: "Open League", season: "2026/27", minutes: 1800, stats: {}, source: "Frozen demo", ...extra });
  const players = [
    ...Array.from({ length: 100 }, (_, index) => makePlayer(`left-${index}`, "LB")),
    makePlayer("right-wing", "RW"), makePlayer("wrong-side", "RB"), makePlayer("too-old", "RW", { age: 32 }), makePlayer("too-few-minutes", "RW", { minutes: 100 }),
  ];
  const repository = { mode: "demo" as const, sourceName: "Frozen dense fixture", async loadPlayers() { return players; } };
  const query = { position: null, positions: ["LB", "RW"] as const, playerName: null, maxAge: 25, minimumMinutes: 900, competition: "Open League", season: "2026/27", offset: 0, limit: 12 };
  const first = await searchPlayerPage(repository, query);
  assert.equal(first.totalRecords, 101);
  assert.ok(first.players.some(({ playerId }) => playerId === "right-wing"));
  assert.ok(first.players.every(({ playerId }) => !["wrong-side", "too-old", "too-few-minutes"].includes(playerId)));
  const next = await searchPlayerPage(repository, { ...query, offset: first.nextOffset! });
  assert.equal(new Set([...first.players, ...next.players].map(({ playerId }) => playerId)).size, 24);
  const reversed = await searchPlayerPage(repository, { ...query, positions: ["RW", "LB"] });
  assert.deepEqual(reversed.players.map(({ playerId }) => playerId), first.players.map(({ playerId }) => playerId));
});
