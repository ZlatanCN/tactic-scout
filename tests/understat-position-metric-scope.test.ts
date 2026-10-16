import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerRepository } from "../src/data/player-repository.js";
import { createRecruitmentEvidenceEvaluator } from "../src/agent/recruitment-evidence-evaluator.js";
import { createCandidateComparison } from "../src/agent/recruitment-comparison.js";
import type { UnderstatPlayerInsight } from "../src/data/understat-research.js";
import type { PlayerProfile } from "../src/domain/schemas.js";

function positionScopedPlayer(index: number): PlayerProfile {
  const playerId = `understat:EPL:${index}:2026`;
  return {
    playerId,
    externalPlayerId: String(index),
    name: `Midfielder ${index}`,
    team: `Club ${index}`,
    age: 24,
    position: "CM",
    positionEvidence: {
      provider: "understat",
      targetPosition: "CM",
      status: "direct",
      season: "2026",
      sourceCodes: ["MC"],
      sampleMinutes: 1500,
    },
    competition: "英超",
    season: "2026/27",
    minutes: 1500,
    stats: {
      goals: 0, assists: 0, passesAttempted: 0, passesCompleted: 0, longPasses: 0,
      carries: 0, pressures: 0, tackles: 0, interceptions: 0, shotAssists: 0, keyPasses: 0,
    },
    sourceIdentity: {
      provider: "understat",
      playerId: `EPL:${index}`,
      competitionId: "EPL",
      seasonId: "2026",
      positionGroup: "MID",
      retrievedAt: "2026-10-16T00:00:00.000Z",
    },
    source: "Understat",
  };
}

function positionGroupInsight(player: PlayerProfile, xG: number): UnderstatPlayerInsight {
  return {
    playerId: player.playerId,
    name: player.name,
    team: player.team,
    competition: player.competition,
    season: player.season,
    sourcePlayerId: player.externalPlayerId!,
    sourceUrl: `https://understat.com/player/${player.externalPlayerId}`,
    retrievedAt: "2026-10-16T00:00:00.000Z",
    player: { id: player.externalPlayerId!, name: player.name, favoritePosition: null },
    lastMatch: null,
    requestedSections: ["positions"],
    availableSections: ["positions"],
    positions: [{
      season: "2026", code: "MC", minutes: 1500, games: 18, goals: 0, shots: 0,
      xG, assists: 0, xA: 0, keyPasses: 0, npxG: xG, xGChain: xG, xGBuildup: 0,
    }],
    notes: [],
  };
}

test("Understat season-position metrics stay visible but are not ranked against an unverified competition scope", async () => {
  const players = Array.from({ length: 6 }, (_, index) => positionScopedPlayer(index + 1));
  const insights = Object.fromEntries(players.map((player, index) => [
    player.playerId,
    positionGroupInsight(player, 10 + index * 2),
  ]));
  const repository: PlayerRepository = {
    mode: "understat",
    sourceName: "Understat fixture",
    async loadPlayers() { return players; },
    async getPlayersByIds(playerIds) { return players.filter(({ playerId }) => playerIds.includes(playerId)); },
    async getComparisonPlayers() { return players; },
  };

  const evaluator = createRecruitmentEvidenceEvaluator(repository);
  const result = await evaluator.evaluate(
    players,
    players.map(({ playerId }) => playerId),
    undefined,
    { understatResearch: insights },
  );

  const evaluatedPlayers = players.map(({ playerId }) => result.evaluations[playerId]!);
  const comparisons = createCandidateComparison(evaluatedPlayers, ["understatExpectedGoalsPer90"]);
  assert.ok(comparisons.every(({ comparisons: rows }) => rows.every((row) => (
    row.comparedCandidateCount === 0
      && row.observedMinimum === undefined
      && row.observedMaximum === undefined
  ))), "position-group aggregates must not be summarized as a same-competition candidate range");

  for (const player of players) {
    const evidence = result.evaluations[player.playerId]?.evidence.find(({ key }) => key === "understatExpectedGoalsPer90");
    assert.ok(evidence, `missing position-group metric for ${player.playerId}`);
    assert.ok(evidence.value > 0, "the observed value remains available as individual evidence");
    assert.match(evidence.sourceField ?? "", /^groups\.position\[2026\]\[MC\]\.xG$/);
    assert.equal(evidence.sourceScope, "season_position_aggregate");
    assert.equal(evidence.peerPercentile, null, "competition-specific peer rank cannot be established from season-position rows");
    assert.equal(evidence.peerPercentileUnavailableReason, "competition_scope_unreported", JSON.stringify({
      peerGroupSize: evidence.peerGroupSize,
      peerPercentile: evidence.peerPercentile,
      sourceField: evidence.sourceField,
    }));
    assert.match(evaluator.describe(evidence), /未提供赛事范围/);
  }
});
