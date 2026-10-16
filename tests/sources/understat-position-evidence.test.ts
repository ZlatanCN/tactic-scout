import assert from "node:assert/strict";
import test from "node:test";
import { type PlayerProfile } from "../../src/domain/players.js";
import {
  assessUnderstatPositionEvidence,
  understatPositionSourceCodesFor,
  withUnderstatPositionEvidence,
} from "../../src/sources/understat/position-evidence.js";
import type { UnderstatPlayerInsight } from "../../src/sources/understat/research.js";
import { playerPositionMatches } from "../../src/domain/positions.js";

function profile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    playerId: "understat:EPL:201:2026",
    externalPlayerId: "201",
    name: "Sample Player",
    team: "Sample Club",
    age: null,
    position: "MID",
    competition: "英超",
    season: "2026/27",
    minutes: 900,
    stats: { goals: 0, assists: 0, passesAttempted: 0, passesCompleted: 0, longPasses: 0, carries: 0, pressures: 0, tackles: 0, interceptions: 0, shotAssists: 0, keyPasses: 0 },
    sourceIdentity: { provider: "understat", playerId: "EPL:201", competitionId: "EPL", seasonId: "2026", positionGroup: "MID", retrievedAt: "2026-10-16T00:00:00.000Z" },
    source: "Understat",
    ...overrides,
  };
}

function research(rows: Array<{ season: string; code: string; minutes: number | null }>): UnderstatPlayerInsight {
  return {
    playerId: "understat:EPL:201:2026",
    name: "Sample Player",
    team: "Sample Club",
    competition: "英超",
    season: "2026/27",
    sourcePlayerId: "201",
    sourceUrl: "https://understat.com/player/201",
    retrievedAt: "2026-10-16T00:00:00.000Z",
    player: { id: "201", name: "Sample Player", favoritePosition: null },
    lastMatch: null,
    requestedSections: ["positions"],
    availableSections: ["positions"],
    positions: rows.map(({ season, code, minutes }) => ({
      season, code, minutes, games: 10, goals: 0, shots: 0, xG: 0, assists: 0, xA: 0,
      keyPasses: 0, npxG: 0, xGChain: 0, xGBuildup: 0,
    })),
    notes: [],
  };
}

test("Understat detail labels align with all product fine positions while preserving direct and adjacent evidence", () => {
  const cases = [
    ["CB", "DC", "direct"],
    ["FB", "DL", "direct"],
    ["FB", "DR", "direct"],
    ["LB", "DL", "direct"],
    ["RB", "DR", "direct"],
    ["LWB", "DL", "compatible"],
    ["LWB", "DML", "compatible"],
    ["LWB", "ML", "compatible"],
    ["RWB", "DR", "compatible"],
    ["RWB", "DMR", "compatible"],
    ["RWB", "MR", "compatible"],
    ["DM", "DML", "direct"],
    ["DM", "DMC", "direct"],
    ["DM", "DMR", "direct"],
    ["CM", "MC", "direct"],
    ["CM", "ML", "compatible"],
    ["CM", "MR", "compatible"],
    ["AM", "AMC", "direct"],
    ["AM", "AML", "compatible"],
    ["AM", "AMR", "compatible"],
    ["WG", "FWL", "direct"],
    ["WG", "FWR", "direct"],
    ["WG", "AML", "compatible"],
    ["WG", "AMR", "compatible"],
    ["LW", "FWL", "direct"],
    ["LW", "AML", "compatible"],
    ["LW", "ML", "compatible"],
    ["RW", "FWR", "direct"],
    ["RW", "MR", "compatible"],
    ["RW", "AMR", "compatible"],
    ["ST", "FW", "direct"],
    ["ST", "FWL", "compatible"],
    ["ST", "FWR", "compatible"],
  ] as const;

  assert.equal(cases.length, 33, "all Understat fine-position crosswalk entries must be explicit in this contract test");
  for (const [target, code, expectedStatus] of cases) {
    assert.ok(understatPositionSourceCodesFor(target).includes(code), `${target} must declare Understat code ${code}`);
    const result = assessUnderstatPositionEvidence(profile(), research([{ season: "2026", code, minutes: 900 }]), target);
    assert.equal(result.targetPosition, target);
    assert.equal(result.status, expectedStatus, `${target} from ${code}`);
    assert.deepEqual(result.sourceCodes, [code]);
    assert.equal(result.sampleMinutes, 900);
    assert.equal(result.season, "2026");
  }
});

test("unmapped roles are not silently promoted to direct position evidence", () => {
  for (const [target, unrelatedCode] of [["CM", "AMC"], ["ST", "MC"], ["LW", "DR"]] as const) {
    const result = assessUnderstatPositionEvidence(profile(), research([{ season: "2026", code: unrelatedCode, minutes: 900 }]), target);
    assert.equal(result.status, "not_observed", `${target} must not infer a match from ${unrelatedCode}`);
  }
});

test("direct position rows take precedence over compatible rows and keep their own sample", () => {
  const result = assessUnderstatPositionEvidence(profile(), research([
    { season: "2026", code: "MC", minutes: 900 },
    { season: "2026", code: "ML", minutes: 700 },
    { season: "2026", code: "MR", minutes: 600 },
  ]), "CM");
  assert.equal(result.status, "direct");
  assert.deepEqual(result.sourceCodes, ["MC"]);
  assert.equal(result.sampleMinutes, 900);
});

test("position evidence is current-season only; substitute and zero-minute records do not confirm a role", () => {
  const priorSeasonOnly = assessUnderstatPositionEvidence(profile(), research([
    { season: "2025", code: "MC", minutes: 1800 },
  ]), "CM");
  assert.equal(priorSeasonOnly.status, "unavailable");
  assert.deepEqual(priorSeasonOnly.sourceCodes, []);

  const subOnly = assessUnderstatPositionEvidence(profile(), research([
    { season: "2026", code: "Sub", minutes: 600 },
  ]), "CM");
  assert.equal(subOnly.status, "not_observed");
  assert.deepEqual(subOnly.sourceCodes, ["Sub"]);

  const zeroMinutes = assessUnderstatPositionEvidence(profile(), research([
    { season: "2026", code: "MC", minutes: 0 },
  ]), "CM");
  assert.equal(zeroMinutes.status, "not_observed");
  assert.equal(zeroMinutes.sampleMinutes, 0);
});

test("a missing Understat positions group is unavailable rather than negative evidence", () => {
  const result = assessUnderstatPositionEvidence(profile(), {
    ...research([]),
    availableSections: [],
    positions: undefined,
  }, "CM");
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.sourceCodes, []);
  assert.equal(result.sampleMinutes, null);
});

test("adjacent evidence stays a separate lead and does not rewrite the candidate's requested position", () => {
  const multiPositionProfile = profile({
    position: "UNKNOWN",
    sourceIdentity: {
      provider: "understat",
      playerId: "EPL:201",
      competitionId: "EPL",
      seasonId: "2026",
      positionGroup: "UNKNOWN",
      positionGroups: ["DEF", "MID"],
      sourcePositionLabels: ["D", "M"],
    },
  });
  const adjacentLead = withUnderstatPositionEvidence(
    multiPositionProfile,
    research([{ season: "2026", code: "ML", minutes: 900 }]),
    "CM",
  );
  assert.equal(adjacentLead.position, "UNKNOWN");
  assert.equal(adjacentLead.positionEvidence?.status, "compatible");
  assert.deepEqual(adjacentLead.positionEvidence?.sourceCodes, ["ML"]);

  const exactMatch = withUnderstatPositionEvidence(
    multiPositionProfile,
    research([{ season: "2026", code: "MC", minutes: 900 }]),
    "CM",
  );
  assert.equal(exactMatch.position, "CM");
  assert.equal(exactMatch.positionEvidence?.status, "direct");
});

test("a raw Understat catalog position cannot bypass fine-role detail verification", () => {
  const unverified = profile({ position: "CM" });
  assert.equal(playerPositionMatches(unverified, "CM"), false);
  assert.equal(playerPositionMatches({ ...unverified, positionEvidence: {
    provider: "understat", targetPosition: "CM", status: "direct", season: "2026", sourceCodes: ["MC"], sampleMinutes: 900,
  } }, "CM"), true);
});
