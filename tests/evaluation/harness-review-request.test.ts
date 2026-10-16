import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createReviewRequestFromHarnessRun } from "../../src/evaluation/harness-review-request.js";

const candidateIds = [
  "wyscout:101:team:7:competition:8:season:2017/18",
  "wyscout:202:team:9:competition:8:season:2017/18",
];

function frozenSnapshot(): string {
  return JSON.stringify({
    schemaVersion: 1,
    datasetId: "tactiscout-wyscout-v1-review-test",
    builtAt: "2026-10-09T00:00:00.000Z",
    attribution: "Wyscout Open Data, CC BY 4.0",
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    upstreamSource: {
      name: "Soccer match event dataset",
      publisher: "Wyscout",
      paperUrl: "https://doi.org/10.1038/s41597-019-0247-7",
      acquiredAt: "2019-10-01",
      scope: "2017/18 league season",
    },
    derivation: { ruleset: "tactiscout-wyscout-events-v2" },
    records: candidateIds.map((playerId, index) => ({
      playerId,
      externalPlayerId: String(101 + index),
      name: `Hidden Player ${index + 1}`,
      team: `Hidden Team ${index + 1}`,
      teamId: String(7 + index),
      competition: "League A",
      competitionId: "8",
      season: "2017/18",
      ageAtSeasonEnd: 22,
      position: "MID",
      minutes: 900,
      appearanceMatches: 10,
      metrics: [],
    })),
  });
}

function evaluationOutput() {
  return {
    datasetVersion: 2,
    model: "qwen3.5:9b",
    repository: { mode: "wyscout", source: "Wyscout Open Data · historical 2017/18" },
    allPassed: true,
    scenarios: [{
      id: "barcelona-under-23-midfielder",
      runs: [{
        threadId: "local-eval-barcelona-run-1",
        allPassed: true,
        checks: {
          recommendationsRespectRequestedPosition: true,
          recommendationsWereEvaluated: true,
          evaluatedOnlyAfterCandidateDiscovery: true,
        },
        report: {
          evaluatedCandidateCount: 2,
          recommendations: [{ playerId: candidateIds[1] }],
        },
        trace: [{
          phase: "tool",
          toolName: "evaluate_candidates",
          ok: true,
          filters: { evaluatedPlayerIds: candidateIds },
        }],
      }],
    }],
  };
}

const reviewContext = {
  queryId: "barcelona-midfield-progression-v1",
  roleBrief: "为巴萨寻找一名具备向前推进能力的中场。",
  metricKeys: ["wyscoutProgressivePassesPer90", "wyscoutAccurateProgressivePassesPct", "pressures"],
  scenarioId: "barcelona-under-23-midfielder",
  runNumber: 1,
};

test("review request uses evaluated candidates and only the real report ranking", () => {
  const snapshotJson = frozenSnapshot();
  const request = createReviewRequestFromHarnessRun({
    evaluationJson: JSON.stringify(evaluationOutput()),
    snapshotJson,
    context: reviewContext,
  });

  assert.equal(request.snapshotSha256, createHash("sha256").update(snapshotJson).digest("hex"));
  assert.deepEqual(request.candidateIds, candidateIds);
  assert.deepEqual(request.systemRankings, [{
    systemId: "tactiscout:wyscout:qwen3.5:9b",
    runId: "local-eval-barcelona-run-1",
    candidateIds: [candidateIds[1]],
  }]);
  assert.deepEqual(request.metricKeys, reviewContext.metricKeys);
  assert.equal(request.roleBrief, reviewContext.roleBrief);
});

test("review request rejects a legacy Harness result that lacks current invariants", () => {
  const evaluation = evaluationOutput();
  evaluation.datasetVersion = 1;

  assert.throws(() => createReviewRequestFromHarnessRun({
    evaluationJson: JSON.stringify(evaluation),
    snapshotJson: frozenSnapshot(),
    context: reviewContext,
  }), /版本|schema/i);
});

test("review request rejects recommendation IDs outside the evaluated pool", () => {
  const evaluation = evaluationOutput();
  evaluation.scenarios[0]!.runs[0]!.report.recommendations = [{ playerId: "unobserved-player" }];

  assert.throws(() => createReviewRequestFromHarnessRun({
    evaluationJson: JSON.stringify(evaluation),
    snapshotJson: frozenSnapshot(),
    context: reviewContext,
  }), /未评估|候选池/);
});

test("review request rejects a run whose report counts differ from its evaluation trace", () => {
  const evaluation = evaluationOutput();
  evaluation.scenarios[0]!.runs[0]!.report.evaluatedCandidateCount = 3;

  assert.throws(() => createReviewRequestFromHarnessRun({
    evaluationJson: JSON.stringify(evaluation),
    snapshotJson: frozenSnapshot(),
    context: reviewContext,
  }), /评估人数.*不一致/);
});
