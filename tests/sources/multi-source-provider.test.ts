import assert from "node:assert/strict";
import test from "node:test";
import { type PlayerProfile } from "../../src/domain/players.js";
import type { PlayerRepository, PlayerSearchQuery } from "../../src/sources/registry.js";
import { MultiSourceCurrentPlayerRepository, MultiSourceProviderError } from "../../src/sources/mosaic/provider.js";
import { searchPlayerPage } from "../../src/players/repository.js";

const retrievedAt = "2026-10-09T10:00:00.000Z";

function player(input: {
  id: string;
  name?: string;
  provider: "understat" | "american-soccer-analysis";
  competitionId: string;
  competition: string;
  season: string;
  positionGroup?: string;
  age?: number | null;
}): PlayerProfile {
  return {
    playerId: input.id,
    externalPlayerId: input.id,
    name: input.name ?? "Same Name",
    team: "Example FC",
    age: input.age ?? null,
    position: "ATT",
    competition: input.competition,
    season: input.season,
    minutes: 1200,
    stats: {
      goals: 4,
      assists: 2,
      passesAttempted: 0,
      passesCompleted: 0,
      longPasses: 0,
      carries: 0,
      pressures: 0,
      tackles: 0,
      interceptions: 0,
      shotAssists: 0,
      keyPasses: 5,
    },
    sourceIdentity: {
      provider: input.provider,
      playerId: input.id,
      competitionId: input.competitionId,
      seasonId: input.season,
      positionGroup: input.positionGroup ?? "ATT",
      retrievedAt,
      isCurrentSeason: true,
    },
    sourceUrl: "https://example.com/player",
    availableStats: ["goals", "assists", "keyPasses"],
    source: input.provider,
  };
}

function repositoryFor(players: PlayerProfile[], options: { understatError?: Error } = {}) {
  const understat: PlayerRepository = {
    mode: "understat",
    sourceName: "Understat fixture",
    async loadPlayers() {
      if (options.understatError) throw options.understatError;
      return players.filter((entry) => entry.sourceIdentity?.provider === "understat");
    },
  };
  const asa = {
    mode: "asa" as const,
    sourceName: "ASA fixture",
    async loadMenPlayers() {
      return players.filter((entry) => entry.sourceIdentity?.provider === "american-soccer-analysis");
    },
  };
  return new MultiSourceCurrentPlayerRepository({ understat, asa });
}

const searchQuery = (overrides: Partial<PlayerSearchQuery> = {}): PlayerSearchQuery => ({
  playerName: null,
  position: null,
  maxAge: null,
  minimumMinutes: 0,
  competition: null,
  season: null,
  offset: 0,
  limit: 20,
  ...overrides,
});

test("mosaic preserves provider identities and excludes ASA competitions outside its supported pool", async () => {
  const records = [
    player({ id: "understat:EPL:1", provider: "understat", competitionId: "EPL", competition: "英超", season: "2026/27" }),
    player({ id: "asa:mls:1", provider: "american-soccer-analysis", competitionId: "mls", competition: "美国职业足球大联盟（MLS）", season: "2026" }),
    player({ id: "asa:nwsl:1", provider: "american-soccer-analysis", competitionId: "nwsl", competition: "NWSL", season: "2026" }),
    player({ id: "asa:usls:1", provider: "american-soccer-analysis", competitionId: "usls", competition: "USL Super League", season: "2026" }),
  ];
  const repository = repositoryFor(records);
  const result = await repository.loadPlayers();
  assert.equal(result.length, 2);
  assert.deepEqual(new Set(result.map((entry) => entry.sourceIdentity?.provider)), new Set(["understat", "american-soccer-analysis"]));
  assert.equal(new Set(result.map((entry) => entry.name)).size, 1);
  assert.equal(new Set(result.map((entry) => entry.playerId)).size, 2);
  assert.ok(result.every((entry) => entry.sourceIdentity?.provider !== "american-soccer-analysis" || ["mls", "uslc", "usl1"].includes(entry.sourceIdentity.competitionId ?? "")));
});

test("mosaic cancellation reaches both shared source loads without wrapping it as a source failure", async () => {
  const controller = new AbortController();
  let understatSignal: AbortSignal | undefined;
  let asaSignal: AbortSignal | undefined;
  let signalUnderstatStarted!: () => void;
  let signalAsaStarted!: () => void;
  let signalSourcesAborted!: () => void;
  const understatStarted = new Promise<void>((resolve) => { signalUnderstatStarted = resolve; });
  const asaStarted = new Promise<void>((resolve) => { signalAsaStarted = resolve; });
  const sourcesAborted = new Promise<void>((resolve) => { signalSourcesAborted = resolve; });
  const understat: PlayerRepository = {
    mode: "understat",
    sourceName: "Understat fixture",
    async loadPlayers(_refresh, signal) {
      understatSignal = signal;
      signalUnderstatStarted();
      return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => {
        if (asaSignal?.aborted) signalSourcesAborted();
        reject(signal?.reason);
      }, { once: true }));
    },
  };
  const asa = {
    mode: "asa" as const,
    sourceName: "ASA fixture",
    async loadMenPlayers(_refresh: boolean, signal?: AbortSignal) {
      asaSignal = signal;
      signalAsaStarted();
      return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => {
        if (understatSignal?.aborted) signalSourcesAborted();
        reject(signal?.reason);
      }, { once: true }));
    },
  };
  const repository = new MultiSourceCurrentPlayerRepository({ understat, asa });
  const pending = repository.searchCandidates(searchQuery(), controller.signal);

  await Promise.all([understatStarted, asaStarted]);
  const reason = new Error("mosaic investigation stopped");
  controller.abort(reason);
  await assert.rejects(pending, (error: unknown) => error === reason);
  await sourcesAborted;
  assert.equal(understatSignal?.aborted, true);
  assert.equal(asaSignal?.aborted, true);
});

test("broad candidate pages interleave competitions and keep global offsets stable", async () => {
  const competitions = [
    { provider: "understat" as const, competitionId: "EPL", competition: "英超", season: "2026/27" },
    { provider: "understat" as const, competitionId: "La_liga", competition: "西甲", season: "2026/27" },
    { provider: "american-soccer-analysis" as const, competitionId: "mls", competition: "美国职业足球大联盟（MLS）", season: "2026" },
    { provider: "american-soccer-analysis" as const, competitionId: "uslc", competition: "USL Championship", season: "2026" },
  ];
  const records = competitions.flatMap((scope) => [1, 2].map((suffix) => player({
    ...scope,
    id: `${scope.competitionId}:${suffix}`,
    name: `${scope.competitionId} ${suffix}`,
  })));
  const repository = repositoryFor(records);
  const first = await repository.searchCandidates(searchQuery({ limit: 4 }));
  const second = await repository.searchCandidates(searchQuery({ offset: 4, limit: 4 }));
  assert.equal(first.totalRecords, 8);
  assert.deepEqual(new Set(first.players.map(({ competition }) => competition)).size, 4);
  assert.deepEqual(new Set(second.players.map(({ competition }) => competition)).size, 4);
  assert.deepEqual(first.players.map(({ playerId }) => playerId).filter((id) => second.players.some((player) => player.playerId === id)), []);
  assert.equal(first.nextOffset, 4);
  assert.equal(second.nextOffset, null);
});

test("age filters require an explicitly scoped ASA men's competition", async () => {
  const repository = repositoryFor([
    player({ id: "understat:EPL:1", provider: "understat", competitionId: "EPL", competition: "英超", season: "2026/27" }),
    player({ id: "asa:mls:1", provider: "american-soccer-analysis", competitionId: "mls", competition: "美国职业足球大联盟（MLS）", season: "2026", age: 21 }),
    player({ id: "asa:mls:2", provider: "american-soccer-analysis", competitionId: "mls", competition: "美国职业足球大联盟（MLS）", season: "2026", age: 27 }),
  ]);
  await assert.rejects(
    repository.searchCandidates(searchQuery({ maxAge: 23 })),
    (error: unknown) => error instanceof MultiSourceProviderError && error.code === "unsupported_scope",
  );
  const mlsOnly = await repository.searchCandidates(searchQuery({ competition: "MLS", maxAge: 23 }));
  assert.deepEqual(mlsOnly.players.map(({ playerId }) => playerId), ["asa:mls:1"]);
  assert.ok(mlsOnly.appliedFilters.includes("maxAge"));
  await assert.rejects(
    repository.searchCandidates(searchQuery({ competition: "USL Super League" })),
    (error: unknown) => error instanceof MultiSourceProviderError && error.code === "unsupported_scope",
  );
});

test("comparison pools never cross provider, competition, season, or position group", async () => {
  const records = [
    player({ id: "understat:epl:forward", provider: "understat", competitionId: "EPL", competition: "英超", season: "2026/27", positionGroup: "ATT" }),
    player({ id: "understat:epl:mid", provider: "understat", competitionId: "EPL", competition: "英超", season: "2026/27", positionGroup: "MID" }),
    player({ id: "understat:laliga:forward", provider: "understat", competitionId: "La_liga", competition: "西甲", season: "2026/27", positionGroup: "ATT" }),
    player({ id: "asa:mls:forward", provider: "american-soccer-analysis", competitionId: "mls", competition: "MLS", season: "2026", positionGroup: "ATT" }),
  ];
  const repository = repositoryFor(records);
  const peers = await repository.getComparisonPlayers([records[0]!, records[3]!]);
  assert.deepEqual(new Set(peers.map(({ playerId }) => playerId)), new Set(["understat:epl:forward", "asa:mls:forward"]));
});

test("mosaic detailed-position retrieval uses family recall and delegates Understat role verification", async () => {
  const understatCandidate = {
    ...player({ id: "understat:EPL:cm", provider: "understat", competitionId: "EPL", competition: "英超", season: "2026/27", positionGroup: "MID" }),
    position: "MID" as const,
    sourceIdentity: {
      ...player({ id: "understat:EPL:cm", provider: "understat", competitionId: "EPL", competition: "英超", season: "2026/27", positionGroup: "MID" }).sourceIdentity!,
      positionGroups: ["MID" as const],
    },
  };
  const asaCandidate = {
    ...player({ id: "asa:mls:cm", provider: "american-soccer-analysis", competitionId: "mls", competition: "MLS", season: "2026", positionGroup: "MID" }),
    position: "MID" as const,
  };
  const inspected: Array<{ playerIds: readonly string[]; sections: readonly string[] }> = [];
  const understat: PlayerRepository = {
    mode: "understat",
    sourceName: "Understat fixture",
    async loadPlayers() { return [understatCandidate]; },
    async inspectCandidateGroup(playerIds, sections) {
      inspected.push({ playerIds, sections });
      return [];
    },
  };
  const repository = new MultiSourceCurrentPlayerRepository({
    understat,
    asa: { mode: "asa", sourceName: "ASA fixture", async loadMenPlayers() { return [asaCandidate]; } },
  });

  const page = await searchPlayerPage(repository, searchQuery({ position: "CM" }));
  assert.deepEqual(page.players.map(({ playerId }) => playerId).sort(), ["asa:mls:cm", "understat:EPL:cm"]);
  assert.ok(page.appliedFilters.includes("positionFamily"));
  assert.equal(page.players.find(({ playerId }) => playerId === "understat:EPL:cm")?.positionEvidence?.status, "pending");
  assert.equal(page.players.find(({ playerId }) => playerId === "understat:EPL:cm")?.positionEvidence?.sourceScope, "season_position_aggregate");

  await repository.inspectCandidateGroup?.(["understat:EPL:cm"], ["positions"]);
  assert.deepEqual(inspected, [{ playerIds: ["understat:EPL:cm"], sections: ["positions"] }]);
});

test("a source failure remains a coded failure instead of returning a partial pool", async () => {
  const blocked = Object.assign(new Error("source refused"), { code: "blocked" });
  const repository = repositoryFor([
    player({ id: "asa:mls:1", provider: "american-soccer-analysis", competitionId: "mls", competition: "MLS", season: "2026" }),
  ], { understatError: blocked });
  await assert.rejects(repository.loadPlayers(), (error: unknown) => (
    error instanceof MultiSourceProviderError && error.code === "blocked" && error.message.includes("候选池不完整")
  ));
});

test("mosaic multi-position union declares family filtering and retains provider-specific position evidence", async () => {
  const understat = { ...player({ id: "union-understat", provider: "understat", competitionId: "EPL", competition: "英超", season: "2026" }), position: "MID" as const };
  const asa = { ...player({ id: "union-asa", provider: "american-soccer-analysis", competitionId: "mls", competition: "MLS", season: "2026" }), position: "CB" as const };
  const repo = repositoryFor([understat, asa]);
  const page = await searchPlayerPage(repo, searchQuery({ positions: ["CM", "CB"] }));
  assert.deepEqual(page.players.map(({ playerId }) => playerId).sort(), ["union-asa", "union-understat"]);
  assert.ok(page.appliedFilters.includes("positionFamily"));
  assert.equal(page.players.find(({ playerId }) => playerId === "union-understat")?.positionEvidence?.status, undefined);
});
