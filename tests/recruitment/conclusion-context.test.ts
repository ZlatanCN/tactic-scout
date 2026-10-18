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

test("ability-profile instructions explicitly distinguish supplied role evidence from match statistics", async () => {
  const { abilityProfileInstructions } = await import("../../src/recruitment/recruitment-planner.js");
  assert.equal(abilityProfileInstructions(false), "");
  const instructions = abilityProfileInstructions(true);
  assert.match(instructions, /basis=ability_profile/);
  assert.match(instructions, /availableStats=\[\]/);
  assert.match(instructions, /不表示零能力/);
  assert.match(instructions, /比赛统计/);
});

test("ability conclusion context retains values and basis without repeating match-only metadata or absent fusion scores", () => {
  const evaluation = { playerId: "profile-1", name: "Fixture player", position: "ST", competition: "", season: "", minutes: 0, source: "fm",
    roleFits: [{ role: "finisher", abilityFit: 82, performanceFit: null, combinedFit: null }, { role: "playmaker", abilityFit: 74, performanceFit: 60, combinedFit: 69 }],
    metrics: [{ key: "abilityFinishing", basis: "ability_profile", value: 82, unit: "/100", definition: "Repeated definition ".repeat(30), minutes: null, peerPercentile: null, peerGroupSize: 0 }],
  };
  const history = [{ role: "tool" as const, toolName: "evaluate_candidates", content: JSON.stringify({ evaluations: [evaluation] }) }];
  const compact = compactConclusionHistory(history, [{ requestedMetricKeys: ["abilityFinishing"] }]);
  const result = JSON.parse(compact[0]!.content);
  const player = result.evaluations[0];
  assert.deepEqual(player.metrics, [{ key: "abilityFinishing", value: 82, unit: "/100", basis: "ability_profile" }]);
  assert.equal(player.playerId, "profile-1");
  assert.equal("minutes" in player, false);
  assert.deepEqual(player.roleFits, []);
  assert.match(result.note, /不.*实战表现/);
  assert.ok(compact[0]!.content.length < history[0]!.content.length / 2);
});
