import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PlayerProfileSchema, type PlayerProfile } from "../../src/domain/players.js";
import type { PlayerRepository, PlayerSearchPage, PlayerSearchQuery } from "../../src/sources/registry.js";
import type { KnowledgeRepository } from "../../src/knowledge/index.js";
import type { KnowledgeSearchRequest } from "../../src/knowledge/schemas.js";
import { createKnowledgeEvidence } from "../../src/knowledge/evidence.js";
import type { EvidenceReranker } from "../../src/knowledge/evidence-models.js";
import type { KnowledgeEvidenceDocumentInput, KnowledgeEvidenceSource } from "../../src/knowledge/evidence-schemas.js";
import type { EvaluatedCandidate, RecruitmentEvaluationBatch } from "../../src/recruitment/recruitment-evidence-evaluator.js";
import type { UnderstatPlayerInsight, UnderstatPlayerSection } from "../../src/sources/understat/research.js";
import {
  executeRecruitmentToolAction,
  type RecruitmentToolExecutionRequest,
} from "../../src/recruitment/recruitment-tool-executor.js";

const player = PlayerProfileSchema.parse({
  playerId: "player-1",
  name: "Alex Vale",
  team: "Example FC",
  age: 22,
  position: "CM",
  competition: "Example League",
  season: "2025/26",
  minutes: 1800,
  source: "test-fixture",
  stats: {},
});

function dependencies(input: {
  searchCandidates?: (query: PlayerSearchQuery) => Promise<PlayerSearchPage>;
  inspectTeam?: (teamName: string) => Promise<PlayerProfile[]>;
  inspectCandidateGroup?: (playerIds: readonly string[], sections: readonly UnderstatPlayerSection[]) => Promise<UnderstatPlayerInsight[]>;
  knowledgeSearch?: (request: KnowledgeSearchRequest) => Promise<[]>;
  evaluate?: (players: PlayerProfile[], playerIds: string[]) => Promise<RecruitmentEvaluationBatch>;
}) {
  const repository: PlayerRepository = {
    mode: "demo",
    sourceName: "test repository",
    ...(input.searchCandidates ? { searchCandidates: input.searchCandidates } : {}),
    ...(input.inspectTeam ? { inspectTeam: input.inspectTeam } : {}),
    ...(input.inspectCandidateGroup ? { inspectCandidateGroup: input.inspectCandidateGroup } : {}),
  };
  const knowledgeBase: KnowledgeRepository = {
    search: input.knowledgeSearch ?? (async () => []),
  };
  return {
    repository,
    knowledgeBase,
    evaluator: {
      availability: "available" as const,
      evaluate: input.evaluate ?? (async () => ({ evaluations: {}, observedPlayers: [] })),
      describe: () => "",
      coverage: (candidate: EvaluatedCandidate) => ({
        expectedMetricCount: candidate.evidence.length,
        hasMissingMetrics: false,
      }),
    },
  };
}

test("methodology search sends only its corpus request and returns typed results", async () => {
  const searches: KnowledgeSearchRequest[] = [];
  const deps = dependencies({ knowledgeSearch: async (request) => { searches.push(request); return []; } });
  const request = {
    action: "search_methodology",
    query: "高位逼抢中场",
    limit: 3,
  } satisfies RecruitmentToolExecutionRequest;

  const result = await executeRecruitmentToolAction(request, deps);

  assert.equal(result.action, "search_methodology");
  assert.deepEqual(searches, [{ corpus: "methodology", query: "高位逼抢中场", playerNames: [], limit: 3 }]);
});

test("the LangGraph tool executor routes methodology actions through stable knowledge evidence references", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-tool-evidence-"));
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    reranker: {
      async rerank({ candidates }) {
        return { orderedIds: candidates.map(({ id }) => id), inputTokens: null, outputTokens: null };
      },
    } satisfies EvidenceReranker,
    embedder: {
      modelId: "test-e5-revision-1",
      async embedMany(texts) { return texts.map(() => [1, 0]); },
    },
  });
  const source: KnowledgeEvidenceSource = {
    id: "executor-evidence-methods",
    name: "Executor Evidence Methods",
    publisher: "Test Publisher",
    rightsUrl: "https://evidence.executor.test/rights",
    license: "CC BY 4.0",
    allowedCorpora: ["methodology"],
    allowedUrlPrefixes: ["https://evidence.executor.test/papers/"],
    allowedModelDestinations: ["local", "configured_chat_gateway"],
    rights: { automatedFetch: false, persistentStorage: true, aiProcessing: true, display: true },
    rightsVerifiedAt: "2026-10-21",
    rightsNote: "Explicitly approved fixture for the public evidence interface test.",
  };
  const document: KnowledgeEvidenceDocumentInput = {
    sourceId: source.id,
    corpus: "methodology",
    title: "Interpreting football performance",
    url: "https://evidence.executor.test/papers/roles",
    author: "A. Researcher",
    publisher: source.publisher,
    publishedAt: "2026-10-01",
    license: source.license,
    attribution: "A. Researcher, Interpreting football performance, CC BY 4.0.",
    entityIds: [],
    entityNames: [],
    competition: null,
    season: null,
    acquisition: "manual_import",
    content: "Player roles must be interpreted alongside the match sample and the observable evidence that supports the analysis.",
    sections: [{ id: "roles", heading: "Player roles", kind: "paragraph", text: "Player roles must be interpreted alongside the match sample and the observable evidence that supports the analysis.", locator: "roles/p1" }],
  };
  try {
    await system.admin.registerSource(source);
    await system.admin.publishDocument(document);
    const deps = dependencies({});
    const result = await executeRecruitmentToolAction({ action: "search_methodology", query: "如何结合比赛样本理解球员职责？", limit: 2 }, {
      ...deps,
      knowledgeEvidence: system,
      knowledgeEvidenceContext: { turnId: "executor-evidence-turn-01", purpose: "recruitment", modelDestination: "configured_chat_gateway" },
    });
    assert.equal(result.action, "search_methodology");
    if (result.action !== "search_methodology") throw new Error("The methodology action returned another result type.");
    assert.equal(result.outcome.status, "found");
    assert.ok(result.results[0]?.evidenceRef);
    assert.equal(result.results[0]?.documentId, result.results[0]?.evidenceRef?.documentRevisionId);
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("player report search marks names without verified identities as not covered", async () => {
  const searches: KnowledgeSearchRequest[] = [];
  const deps = dependencies({ knowledgeSearch: async (request) => { searches.push(request); return []; } });
  const request = {
    action: "search_player_reports",
    query: "球员跑位观察",
    playerNames: ["Alex Vale"],
    requestedPlayerCount: 2,
    limit: 4,
  } satisfies RecruitmentToolExecutionRequest;

  const result = await executeRecruitmentToolAction(request, deps);

  assert.equal(result.action, "search_player_reports");
  assert.equal(result.request.requestedPlayerCount, 2);
  assert.deepEqual(searches, []);
  assert.equal(result.outcome.status, "not_covered");
  assert.equal(result.outcome.failureCode, null);
});

test("player-identity lookup failures stay unavailable instead of being reported as trial coverage", async () => {
  const deps = dependencies({});
  const evidence = {
    reader: { async retrieve() { throw new Error("should not query without a verified identity"); }, async resolve() { throw new Error("not used"); } },
    admin: {},
    async close() {},
  } as unknown as import("../../src/knowledge/evidence.js").KnowledgeEvidence;
  const result = await executeRecruitmentToolAction({
    action: "search_player_reports",
    query: "player role report",
    playerNames: ["Alex Vale"],
    requestedPlayerCount: 1,
    limit: 2,
  }, {
    ...deps,
    knowledgeEvidence: evidence,
    knowledgeEvidenceContext: { turnId: "identity-failure-turn", purpose: "reporting", modelDestination: "configured_chat_gateway" },
    referenceNameResolver: async (mention) => ({ status: "unavailable", mention, source: "wikidata", retryable: true }),
  });
  assert.equal(result.action, "search_player_reports");
  if (result.action !== "search_player_reports") throw new Error("The report action returned another result type.");
  assert.equal(result.outcome.status, "unavailable");
  assert.equal(result.outcome.failureCode, "identity_unavailable");
});

test("cancelling player-identity resolution propagates cancellation instead of returning not-covered", async () => {
  const deps = dependencies({});
  const controller = new AbortController();
  const evidence = {
    reader: { async retrieve() { throw new Error("should not query after cancellation"); }, async resolve() { throw new Error("not used"); } },
    admin: {},
    async close() {},
  } as unknown as import("../../src/knowledge/evidence.js").KnowledgeEvidence;
  await assert.rejects(executeRecruitmentToolAction({
    action: "search_player_reports",
    query: "player role report",
    playerNames: ["Alex Vale"],
    requestedPlayerCount: 1,
    limit: 2,
  }, {
    ...deps,
    knowledgeEvidence: evidence,
    knowledgeEvidenceContext: { turnId: "identity-cancel-turn", purpose: "reporting", modelDestination: "configured_chat_gateway" },
    signal: controller.signal,
    referenceNameResolver: async (mention) => {
      controller.abort(new DOMException("Cancelled", "AbortError"));
      return { status: "unresolved", mention };
    },
  }));
});

test("team inspection delegates the exact club to the injected repository", async () => {
  const inspectedTeams: string[] = [];
  const deps = dependencies({ inspectTeam: async (teamName) => { inspectedTeams.push(teamName); return [player]; } });
  const result = await executeRecruitmentToolAction({ action: "inspect_team", teamName: "拜仁" }, deps);

  assert.equal(result.action, "inspect_team");
  assert.deepEqual(inspectedTeams, ["拜仁"]);
  if (result.action === "inspect_team") assert.deepEqual(result.players, [player]);
});

test("candidate group inspection delegates one bounded comparison request", async () => {
  const calls: Array<{ playerIds: readonly string[]; sections: readonly UnderstatPlayerSection[] }> = [];
  const insight: UnderstatPlayerInsight = {
    playerId: player.playerId,
    name: player.name,
    team: player.team,
    competition: player.competition,
    season: player.season,
    sourcePlayerId: "1",
    sourceUrl: "https://understat.com/player/1",
    retrievedAt: "2026-10-15T00:00:00.000Z",
    player: { id: "1", name: player.name, favoritePosition: null },
    lastMatch: null,
    requestedSections: ["positions", "history"],
    availableSections: ["positions", "history"],
    positions: [],
    history: [],
    notes: [],
  };
  const deps = dependencies({ inspectCandidateGroup: async (playerIds, sections) => {
    calls.push({ playerIds, sections });
    return [insight];
  } });

  const result = await executeRecruitmentToolAction({
    action: "inspect_candidate_group",
    playerIds: [player.playerId, "player-2"],
    sections: ["positions", "history"],
  }, deps);

  assert.equal(result.action, "inspect_candidate_group");
  assert.deepEqual(calls, [{ playerIds: [player.playerId, "player-2"], sections: ["positions", "history"] }]);
  if (result.action === "inspect_candidate_group") assert.deepEqual(result.research, [insight]);
});

test("candidate search forwards the planner filters and preserves the provider page", async () => {
  const queries: PlayerSearchQuery[] = [];
  const deps = dependencies({
    searchCandidates: async (query) => {
      queries.push(query);
      return {
        players: [player],
        totalRecords: 21,
        offset: 20,
        nextOffset: null,
        appliedFilters: ["position", "maxAge", "minimumMinutes", "competition", "season"],
      };
    },
  });
  const request = {
    action: "search_candidates",
    playerName: null,
    position: "CM",
    maxAge: 23,
    minimumMinutes: 900,
    competition: "Example League",
    season: "2025/26",
    offset: 20,
    limit: 10,
  } satisfies RecruitmentToolExecutionRequest;

  const result = await executeRecruitmentToolAction(request, deps);

  assert.equal(result.action, "search_candidates");
  assert.deepEqual(queries, [{
    playerName: null,
    position: "CM",
    maxAge: 23,
    minimumMinutes: 900,
    competition: "Example League",
    season: "2025/26",
    offset: 20,
    limit: 10,
    positionMatchMode: "family",
  }]);
  if (result.action === "search_candidates") assert.equal(result.page.nextOffset, null);
});

test("candidate search distinguishes a valid empty page from a provider failure", async () => {
  const request = {
    action: "search_candidates",
    playerName: null,
    position: null,
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 10,
  } satisfies RecruitmentToolExecutionRequest;
  const emptyDeps = dependencies({ searchCandidates: async () => ({
    players: [], totalRecords: 0, offset: 0, nextOffset: null, appliedFilters: [],
  }) });
  const failure = new Error("provider unavailable");
  const failedDeps = dependencies({ searchCandidates: async () => { throw failure; } });

  const empty = await executeRecruitmentToolAction(request, emptyDeps);
  assert.equal(empty.action, "search_candidates");
  if (empty.action === "search_candidates") assert.equal(empty.page.totalRecords, 0);
  await assert.rejects(executeRecruitmentToolAction(request, failedDeps), failure);
});

test("candidate evaluation receives only the eligible players and requested IDs", async () => {
  const calls: Array<{ players: PlayerProfile[]; ids: string[] }> = [];
  const batch: RecruitmentEvaluationBatch = { evaluations: {}, observedPlayers: [player] };
  const deps = dependencies({ evaluate: async (players, ids) => {
    calls.push({ players, ids });
    return batch;
  } });
  const request = {
    action: "evaluate_candidates",
    playerIds: ["player-1"],
    eligiblePlayers: [player],
  } satisfies RecruitmentToolExecutionRequest;

  const result = await executeRecruitmentToolAction(request, deps);

  assert.equal(result.action, "evaluate_candidates");
  assert.deepEqual(calls, [{ players: [player], ids: ["player-1"] }]);
  if (result.action === "evaluate_candidates") assert.equal(result.batch, batch);
});
