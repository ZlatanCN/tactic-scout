import assert from "node:assert/strict";
import test from "node:test";
import { compactConclusionHistory } from "../../src/recruitment/planner-context.js";

test("conclusion context stores shared candidate metadata once while preserving metric evidence", () => {
  const evaluatedPlayers = Array.from({ length: 30 }, (_, playerIndex) => ({
    playerId: `player-${playerIndex}`,
    name: `Player ${playerIndex}`,
    position: "ATT",
    competition: "Premier League",
    season: "2026/27",
    minutes: 540,
    source: "Fantasy Premier League",
    metrics: Array.from({ length: 8 }, (_, metricIndex) => ({
      key: metricIndex === 0 ? "goals" : metricIndex === 1 ? "assists" : `metric-${metricIndex}`,
      label: `Metric ${metricIndex}`,
      value: metricIndex / 10,
      unit: "per 90",
      peerPercentile: null,
      peerGroupSize: 4,
      peerPercentileUnavailableReason: "candidate_low_sample",
      minutes: 540,
      competition: "Premier League",
      season: "2026/27",
      source: "Fantasy Premier League",
      definition: "A metric definition that is retained for careful interpretation.",
      sampleMatches: 7,
    })),
  }));
  const originalContent = JSON.stringify({ evaluations: evaluatedPlayers, missingPlayerIds: [], note: "Full metric output." });
  const compacted = compactConclusionHistory([
    {
      role: "tool",
      toolName: "search_candidates",
      content: JSON.stringify({
        matchingRecords: 79,
        candidates: evaluatedPlayers.map(({ playerId, name, position, competition, season, minutes }) => ({
          playerId, name, position, competition, season, minutes,
        })),
      }),
    },
    { role: "tool", toolName: "evaluate_candidates", content: originalContent },
  ], [{ requestedMetricKeys: ["goals", "assists"] }]);
  const evaluationEntry = compacted.find((entry) => entry.toolName === "evaluate_candidates");
  const evaluation = JSON.parse(evaluationEntry?.content ?? "{}") as {
    evaluations?: Array<{
      playerId?: string;
      competition?: string;
      season?: string;
      minutes?: number;
      source?: string;
      metrics?: Array<Record<string, unknown>>;
    }>;
  };
  const firstPlayer = evaluation.evaluations?.[0];
  const firstMetric = firstPlayer?.metrics?.[0];

  assert.ok(evaluationEntry);
  assert.ok(evaluationEntry.content.length < originalContent.length * 0.5,
    `Expected at least a 50% reduction, from ${originalContent.length} to ${evaluationEntry.content.length} characters.`);
  assert.equal(firstPlayer?.competition, "Premier League");
  assert.equal(firstPlayer?.season, "2026/27");
  assert.equal(firstPlayer?.minutes, 540);
  assert.equal(firstPlayer?.source, "Fantasy Premier League");
  assert.equal(firstMetric?.key, "goals");
  assert.equal(firstPlayer?.metrics?.length, 2);
  assert.equal(firstMetric?.value, 0);
  assert.equal(firstMetric?.peerPercentileUnavailableReason, "candidate_low_sample");
  assert.equal(firstMetric?.sampleMatches, 7);
  assert.equal(firstMetric?.definition, "A metric definition that is retained for careful interpretation.");
  assert.equal("competition" in (firstMetric ?? {}), false);
  assert.equal("season" in (firstMetric ?? {}), false);
  assert.equal("minutes" in (firstMetric ?? {}), false);
  assert.equal("source" in (firstMetric ?? {}), false);
});
