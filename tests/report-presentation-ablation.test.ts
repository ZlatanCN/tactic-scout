import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerRecommendation } from "../src/domain/schemas.js";
import { createRecommendationPresentation, describeEmptyShortlist } from "../web/src/report-presentation.js";

const recommendation = (playerId: string, evidenceKeys: PlayerRecommendation["focusEvidenceKeys"]): PlayerRecommendation => ({
  player: {
    playerId, name: playerId, age: null, position: "ST", team: "Bayern Munich", competition: "Bundesliga", season: "2026/27", minutes: 900,
    stats: { goals: 0, assists: 0, passesAttempted: 0, passesCompleted: 0, longPasses: 0, carries: 0, pressures: 0, tackles: 0, interceptions: 0, shotAssists: 0 },
    availableStats: [], source: "Fixture",
  },
  rationale: "Fixture",
  comparisonNotes: [],
  referenceComparisonNotes: [],
  strengths: [],
  tradeoffs: [],
  focusEvidenceKeys: evidenceKeys,
  evidence: evidenceKeys.map(key => ({ key, label: key, value: 1, unit: "per90", peerPercentile: null, peerGroupSize: 0, minutes: 900, competition: "Bundesliga", season: "2026/27", source: "Fixture" })),
  sourceEvidenceRecords: [],
  externalSignals: [],
  historicalArchiveSamples: [],
  reportObservations: [],
});

test("candidate-specific evidence ablation blocks unsupported candidates from recommendation comparison", () => {
  const records = [recommendation("evidence-backed", ["goals"]), recommendation("background-only", [])];
  const treatment = createRecommendationPresentation(records);
  const oldGlobalControl = records.map(record => ({
    playerId: record.player.playerId,
    canCompare: records.some(item => item.evidence.some(evidence => item.focusEvidenceKeys.includes(evidence.key))),
  }));

  assert.deepEqual(treatment.recommendations.map(item => [item.playerId, item.hasFocusEvidence, item.canCompare, item.rank]), [
    ["evidence-backed", true, true, 1],
    ["background-only", false, false, null],
  ]);
  assert.deepEqual(oldGlobalControl.map(item => item.canCompare), [true, true]);
  assert.equal(treatment.focusEvidenceCount, 1);
  assert.equal(treatment.backgroundOnlyCount, 1);
});

test("only actual focus evidence earns a candidate rank", () => {
  const presentation = createRecommendationPresentation([
    recommendation("first-background", []),
    recommendation("first-supported", ["goals"]),
    recommendation("second-supported", ["assists"]),
  ]);

  assert.deepEqual(presentation.recommendations.map(item => item.rank), [null, 1, 2]);
});

test("empty shortlist copy distinguishes no recorded query from a completed query with no shortlist", () => {
  const noQuery = describeEmptyShortlist(0);
  const queryWithoutShortlist = describeEmptyShortlist(1);

  assert.match(noQuery.summary, /没有记录到已完成的候选查询/);
  assert.match(noQuery.summary, /两种情况/);
  assert.match(queryWithoutShortlist.summary, /不能代表整个转会市场/);
  assert.notEqual(noQuery.title, queryWithoutShortlist.title);
});
