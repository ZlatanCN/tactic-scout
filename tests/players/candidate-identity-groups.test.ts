import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createRecruitmentConversation, type RecruitmentAction, type RecruitmentPlanner, type RecruitmentTraceEvent } from "../../src/recruitment/conversation.js";
import type { PlayerRepository } from "../../src/sources/registry.js";
import { groupCandidatesByExactIdentity } from "../../src/players/identity/candidate-groups.js";
import { type PlayerProfile } from "../../src/domain/players.js";

const previousModelEndpoint = process.env.OPENAI_BASE_URL;

before(() => {
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
});

after(() => {
  if (previousModelEndpoint === undefined) delete process.env.OPENAI_BASE_URL;
  else process.env.OPENAI_BASE_URL = previousModelEndpoint;
});

function sourceRecord(playerId: string, name: string, source: string, provider: string, sourcePlayerId: string): PlayerProfile {
  return {
    playerId,
    name,
    team: "Harbor City",
    age: 23,
    position: "ST",
    ...(provider === "understat" ? { externalPlayerId: sourcePlayerId } : {}),
    competition: "Open League",
    season: "2025/26",
    minutes: 1200,
    stats: { goals: 8, assists: 3, passesAttempted: 300, passesCompleted: 225, longPasses: 10, carries: 35, pressures: 120, tackles: 8, interceptions: 4, shotAssists: 16 },
    source,
    sourceIdentity: {
      provider,
      playerId: sourcePlayerId,
      competitionId: provider === "understat" ? "open-league-a" : "open-league-b",
      seasonId: "2025/26",
      positionGroup: "ATT",
      retrievedAt: "2026-10-10T00:00:00.000Z",
    },
  };
}

test("only a unique exact Reep identity groups records and every source profile is preserved", () => {
  const records = [
    sourceRecord("understat:league-a:17", "Alex Example", "Understat", "understat", "league-a:17"),
    sourceRecord("asa:player-92", "Different Display Name", "ASA", "american-soccer-analysis", "92"),
  ];

  const groups = groupCandidatesByExactIdentity(records, {
    resolveSourceProvider(provider, externalId) {
      assert.ok((provider === "understat" && externalId === "league-a:17") || (provider === "american-soccer-analysis" && externalId === "92"));
      return { status: "resolved", releaseStamp: "20261005T180536Z", reepId: "reep-person-1" };
    },
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.status, "resolved");
  assert.equal(groups[0]?.identityKey, "reep:reep-person-1");
  assert.deepEqual(groups[0]?.records, records);
});

test("Understat identity resolution uses its exact raw player identifier", () => {
  const profile = sourceRecord("understat:premier-league:17", "Alex Example", "Understat", "understat", "premier-league:17");
  const record: PlayerProfile = {
    ...profile,
    sourceIdentity: {
      ...profile.sourceIdentity!,
      providerIdentifiers: [{ provider: "understat", namespace: "player", externalId: "17", sourceField: "id" }],
    },
  };

  const groups = groupCandidatesByExactIdentity([record], {
    resolveSourceProvider(provider, externalId) {
      assert.equal(provider, "understat");
      assert.equal(externalId, "17");
      return { status: "resolved", releaseStamp: "20261005T180536Z", reepId: "reep-person-17" };
    },
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.status, "resolved");
  assert.equal(groups[0]?.identityKey, "reep:reep-person-17");
});

test("conflicting exact player identifiers remain ambiguous instead of resolving the scoped key", () => {
  const profile = sourceRecord("understat:premier-league:17", "Alex Example", "Understat", "understat", "premier-league:17");
  const record: PlayerProfile = {
    ...profile,
    sourceIdentity: {
      ...profile.sourceIdentity!,
      providerIdentifiers: [
        { provider: "understat", namespace: "player", externalId: "17", sourceField: "id" },
        { provider: "understat", namespace: "player", externalId: "18", sourceField: "alternate_id" },
      ],
    },
  };

  const groups = groupCandidatesByExactIdentity([record], {
    resolveSourceProvider() {
      throw new Error("conflicting primary provider identifiers must not reach the resolver");
    },
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.status, "ambiguous");
  assert.equal(groups[0]?.reepId, null);
  assert.deepEqual(groups[0]?.records, [record]);
});

test("same-name records with missing or ambiguous identity mappings remain separate", () => {
  const records = [
    sourceRecord("understat:17", "Alex Example", "Understat", "understat", "league-a:17"),
    sourceRecord("asa:92", "Alex Example", "ASA", "american-soccer-analysis", "92"),
  ];

  const groups = groupCandidatesByExactIdentity(records, {
    resolveSourceProvider(provider) {
      return provider === "understat"
        ? { status: "not_found", releaseStamp: "20261005T180536Z" }
        : { status: "ambiguous", releaseStamp: "20261005T180536Z" };
    },
  });

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(({ status, records: members }) => [status, members.map(({ playerId }) => playerId)]), [
    ["not_found", ["understat:17"]],
    ["ambiguous", ["asa:92"]],
  ]);
});

test("unresolved source records with delimiter-bearing IDs remain separate", () => {
  const first = sourceRecord("understat:league:17", "Alex Example", "Understat", "understat", "league:17");
  const second = sourceRecord("understat:league:17:team:17", "Alex Example", "Understat", "understat", "league");
  const records = [
    {
      ...first,
      sourceIdentity: {
        ...first.sourceIdentity!,
        playerId: "league:17",
        teamId: "team",
        competitionId: "league",
        seasonId: "2025/26",
      },
    },
    {
      ...second,
      sourceIdentity: {
        ...second.sourceIdentity!,
        playerId: "league",
        teamId: "17:team",
        competitionId: "league",
        seasonId: "2025/26",
      },
    },
  ];

  const groups = groupCandidatesByExactIdentity(records, {
    resolveSourceProvider() {
      return { status: "not_found", releaseStamp: "20261005T180536Z" };
    },
  });

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(({ status, records: members }) => [status, members.map(({ playerId }) => playerId)]), [
    ["not_found", ["understat:league:17"]],
    ["not_found", ["understat:league:17:team:17"]],
  ]);
});

test("the full LangGraph Reviewer blocks duplicate recommendations only when exact identity is available", async () => {
  const understatProfile = sourceRecord("understat:league-a:17", "Alex Example", "Understat", "understat", "league-a:17");
  const understatRecord: PlayerProfile = {
    ...understatProfile,
    externalPlayerId: "17",
    sourceIdentity: {
      ...understatProfile.sourceIdentity!,
      providerIdentifiers: [{ provider: "understat", namespace: "player", externalId: "17", sourceField: "id" }],
    },
  };
  const asaRecord = sourceRecord("asa:player-92", "Different Display Name", "ASA", "american-soccer-analysis", "92");
  const firstUnmappedRecord = {
    ...sourceRecord("understat:league:17", "Sam Example", "Understat", "understat", "league:17"),
    externalPlayerId: "18",
  };
  const secondUnmappedRecord = {
    ...sourceRecord("understat:league:17:team:17", "Taylor Example", "Understat", "understat", "league"),
    externalPlayerId: "19",
  };
  const records = [
    understatRecord,
    asaRecord,
    {
      ...firstUnmappedRecord,
      sourceIdentity: {
        ...firstUnmappedRecord.sourceIdentity!,
        playerId: "league:17",
        teamId: "team",
        competitionId: "league",
        seasonId: "2025/26",
      },
    },
    {
      ...secondUnmappedRecord,
      sourceIdentity: {
        ...secondUnmappedRecord.sourceIdentity!,
        playerId: "league",
        teamId: "17:team",
        competitionId: "league",
        seasonId: "2025/26",
      },
    },
  ];
  const resolver = {
    resolveSourceProvider(provider: string, externalId: string) {
      if ((provider === "understat" && externalId === "17")
        || (provider === "american-soccer-analysis" && externalId === "92")) {
        return { status: "resolved" as const, releaseStamp: "20261005T180536Z", reepId: "reep-person-1" };
      }
      return { status: "not_found" as const, releaseStamp: "20261005T180536Z" };
    },
  };
  const finishAction = (playerIds: string[]): RecruitmentAction => ({
    action: "finish",
    targetTeam: "拜仁",
    needSummary: "按中锋位置和可观察进球产出完成评估。",
    capabilityProfile: ["进球产出"],
    recommendations: playerIds.map((playerId) => ({ playerId, evidenceKeys: ["goals"] })),
    limitationKeys: [],
  });
  const plannerFor = (finishActions: RecruitmentAction[]): RecruitmentPlanner => {
    const remainingActions = [...finishActions];
    return {
      async decide(input) {
        if (input.decisionMode === "investigate") {
          const completedTools = new Set(input.history
            .filter((entry) => entry.role === "tool")
            .map((entry) => entry.toolName));
          if (!completedTools.has("search_methodology")) {
            return { action: "search_methodology", targetTeam: "拜仁", query: "中锋能力评估方法", limit: 4 };
          }
          if (!completedTools.has("search_candidates")) {
            return {
              action: "search_candidates",
              targetTeam: "拜仁",
              position: input.confirmedPosition,
              playerName: null,
              maxAge: null,
              minimumMinutes: 0,
              competition: null,
              season: null,
              offset: 0,
              limit: 20,
            };
          }
          if (!completedTools.has("evaluate_candidates")) {
            return { action: "evaluate_candidates", targetTeam: "拜仁", playerIds: records.map(({ playerId }) => playerId) };
          }
          if (!completedTools.has("search_player_reports")) {
            return {
              action: "search_player_reports",
              targetTeam: "拜仁",
              query: "已评估候选球员的球探报告与比赛观察",
              playerNames: records.map(({ name }) => name),
              limit: 4,
            };
          }
        }
        const action = remainingActions.shift();
        assert.ok(action, "an identity review should produce a Planner finish action");
        return action;
      },
    };
  };
  const repository: PlayerRepository = {
    mode: "mosaic",
    sourceName: "Understat + ASA fixtures",
    async searchCandidates(query) {
      return {
        players: records,
        totalRecords: records.length,
        offset: query.offset,
        nextOffset: null,
        appliedFilters: query.position ? [query.positionMatchMode === "family" ? "positionFamily" : "position"] : [],
      };
    },
    async inspectCandidateGroup(playerIds, sections) {
      assert.deepEqual(sections, ["positions"]);
      return playerIds.map((playerId) => {
        const player = records.find((record) => record.playerId === playerId)!;
        const sourcePlayerId = player.externalPlayerId!;
        return {
          playerId,
          name: player.name,
          team: player.team,
          competition: player.competition,
          season: player.season,
          sourcePlayerId,
          sourceUrl: `https://understat.com/player/${sourcePlayerId}`,
          retrievedAt: "2026-10-10T00:00:00.000Z",
          player: { id: sourcePlayerId, name: player.name, favoritePosition: "FW" },
          lastMatch: null,
          requestedSections: ["positions" as const],
          availableSections: ["positions" as const],
          positions: [{ season: player.sourceIdentity?.seasonId ?? "2025/26", code: "FW", minutes: player.minutes, games: 12, goals: 8, shots: 30, xG: 7, assists: 3, xA: 1.2, keyPasses: 12, npxG: 6.5, xGChain: 10, xGBuildup: 4 }],
          notes: [],
        };
      });
    },
    async getPlayersByIds(playerIds) {
      const selected = new Set(playerIds);
      return records.filter(({ playerId }) => selected.has(playerId));
    },
    async getComparisonPlayers() {
      return records;
    },
  };
  const allCandidateIds = records.map(({ playerId }) => playerId);
  const tracedRun = async (candidateIdentityGrouper?: (players: readonly PlayerProfile[]) => ReturnType<typeof groupCandidatesByExactIdentity>) => {
    const trace: RecruitmentTraceEvent[] = [];
    const conversation = createRecruitmentConversation({
      repository,
      planner: plannerFor(candidateIdentityGrouper
        ? [finishAction(allCandidateIds), finishAction([records[0]!.playerId, records[2]!.playerId, records[3]!.playerId])]
        : [finishAction(allCandidateIds)]),
      ...(candidateIdentityGrouper ? { candidateIdentityGrouper } : {}),
      knowledgeBase: { async search() { return []; } },
      observer(event) { trace.push(event); },
    });
    const response = await conversation.turn({
      threadId: candidateIdentityGrouper ? "candidate-identity-with-bridge" : "candidate-identity-without-bridge",
      message: "为拜仁找一名中锋，重点看进球产出。",
    });
    return { response, trace };
  };
  const { response, trace } = await tracedRun((players) => groupCandidatesByExactIdentity(players, resolver));

  assert.equal(response.status, "completed");
  assert.equal(response.report?.recommendations.length, 3);
  assert.equal(response.report?.evidenceCoverage.evaluatedCandidateCount, 3);
  assert.equal(response.report?.evidenceCoverage.evaluatedSourceRecordCount, 4);
  const goalCoverage = response.report?.requestedCapabilityCoverage.find(({ name }) => name === "进球产出");
  assert.equal(goalCoverage?.evaluatedCandidateCount, 3);
  assert.equal(goalCoverage?.candidatesWithEvidenceCount, 3);
  assert.equal(goalCoverage?.status, "observed");
  assert.equal(response.report?.candidateIdentityCoverage.sourceRecordCount, 4);
  assert.equal(response.report?.candidateIdentityCoverage.resolvedIdentityCount, 1);
  assert.equal(response.report?.candidateIdentityCoverage.resolvedSourceRecordCount, 2);
  assert.equal(response.report?.candidateIdentityCoverage.unresolvedSourceRecordCount, 2);
  assert.deepEqual(response.report?.candidateIdentityCoverage.resolutionStatusCounts, [
    { status: "resolved", count: 1 },
    { status: "not_found", count: 2 },
  ]);
  assert.equal(response.report?.recommendations[0]?.identityResolution?.status, "resolved");
  assert.equal(response.report?.recommendations[0]?.sourceEvidenceRecords[0]?.sourceRecordId, "92");
  assert.ok(response.report?.recommendations[0]?.sourceEvidenceRecords[0]?.evidence.some(({ key }) => key === "goals"));
  for (const playerId of [records[2]!.playerId, records[3]!.playerId]) {
    const recommendation = response.report?.recommendations.find(({ player }) => player.playerId === playerId);
    assert.equal(recommendation?.identityResolution?.status, "not_found");
    assert.deepEqual(recommendation?.sourceEvidenceRecords, []);
    assert.equal(recommendation?.evidence.find(({ key }) => key === "goals")?.peerGroupSize, 2);
  }
  assert.ok(trace.some((event) => event.phase === "review" && event.outcome === "retry"));
  assert.ok(trace.some((event) => event.phase === "review" && event.outcome === "passed"));
  assert.deepEqual(trace.filter((event) => event.phase === "tool" && event.ok).map((event) => event.phase === "tool" ? event.toolName : null), [
    "search_methodology",
    "search_candidates",
    "inspect_candidate_group",
    "evaluate_candidates",
    "search_player_reports",
  ]);

  const control = await tracedRun();
  assert.equal(control.response.status, "completed");
  assert.equal(control.response.report?.recommendations.length, 4);
  assert.equal(control.response.report?.candidateIdentityCoverage.resolvedIdentityCount, 0);
  assert.deepEqual(control.response.report?.candidateIdentityCoverage.resolutionStatusCounts, [
    { status: "registry_unavailable", count: 4 },
  ]);
  assert.ok(control.trace.some((event) => event.phase === "review" && event.outcome === "passed"));
  assert.ok(!control.trace.some((event) => event.phase === "review" && event.outcome === "retry"));
});

