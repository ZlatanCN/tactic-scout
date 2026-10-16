import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  evaluateShortlistQuality,
  ShortlistQualityDatasetSchema,
} from "../../src/evaluation/shortlist-quality-evaluation.js";

const snapshot = {
  ref: "historical-wyscout",
  provider: "wyscout",
  datasetId: "tactiscout-wyscout-v1-example",
  asOf: "2026-10-09T00:00:00.000Z",
  contentSha256: "a".repeat(64),
  derivationRuleset: "tactiscout-wyscout-events-v2",
};

function completeDataset() {
  return {
    schemaVersion: 1,
    benchmarkId: "human-shortlist-fit-v1",
    snapshots: [snapshot],
    queries: [{
      queryId: "query-1",
      brief: "需要一名具备推进能力的中场。",
      snapshotRefs: [snapshot.ref],
      candidateIds: ["candidate-a", "candidate-b", "candidate-c"],
      systemRankings: [
        { systemId: "system-good", runId: "run-1", candidateIds: ["candidate-a", "candidate-b", "candidate-c"] },
        { systemId: "system-reversed", runId: "run-2", candidateIds: ["candidate-c", "candidate-b", "candidate-a"] },
      ],
      ratings: [
        { candidateId: "candidate-a", reviewerId: "reviewer-1", rating: 3 },
        { candidateId: "candidate-a", reviewerId: "reviewer-2", rating: 3 },
        { candidateId: "candidate-b", reviewerId: "reviewer-1", rating: 1 },
        { candidateId: "candidate-b", reviewerId: "reviewer-2", rating: 2 },
        { candidateId: "candidate-c", reviewerId: "reviewer-1", rating: 0 },
        { candidateId: "candidate-c", reviewerId: "reviewer-2", rating: 0 },
      ],
      adjudications: [
        { candidateId: "candidate-a", grade: 3 },
        { candidateId: "candidate-b", grade: 2 },
        { candidateId: "candidate-c", grade: 0 },
      ],
    }],
  };
}

test("shortlist benchmark computes per-system graded nDCG@5 and raw pairwise agreement", () => {
  const result = evaluateShortlistQuality(completeDataset());

  assert.equal(result.status, "evaluable");
  assert.equal(result.queries.length, 1);
  assert.equal(result.queries[0]?.status, "evaluable");
  assert.equal(result.queries[0]?.judgmentCoverage.candidatesWithTwoRatings, 3);
  assert.equal(result.queries[0]?.rawPairwiseAgreement.agreements, 2);
  assert.equal(result.queries[0]?.rawPairwiseAgreement.comparablePairs, 3);
  assert.equal(result.queries[0]?.rawPairwiseAgreement.rate, 0.6667);
  assert.equal(result.queries[0]?.systems[0]?.systemId, "system-good");
  assert.equal(result.queries[0]?.systems[0]?.ndcgAt5, 1);
  assert.equal(result.queries[0]?.systems[1]?.ndcgAt5, 0.6064);
  assert.match(result.interpretation, /不构成/);
});

test("reports reviewer marginals and ordinal pair differences without mixing unknown into numeric grades", () => {
  const dataset = completeDataset();
  dataset.queries[0]!.candidateIds.push("candidate-d");
  dataset.queries[0]!.ratings.push(
    { candidateId: "candidate-d", reviewerId: "reviewer-1", rating: "unknown" },
    { candidateId: "candidate-d", reviewerId: "reviewer-2", rating: "unknown" },
  );
  dataset.queries[0]!.adjudications.push({ candidateId: "candidate-d", grade: "unknown" });
  dataset.queries[0]!.ratings = dataset.queries[0]!.ratings.map((rating) => (
    rating.candidateId === "candidate-c" && rating.reviewerId === "reviewer-2"
      ? { ...rating, rating: "unknown" as const }
      : rating
  ));

  const query = evaluateShortlistQuality(dataset).queries[0]!;

  assert.deepEqual(query.reviewerRatingDistributions, [
    { reviewerId: "reviewer-1", totalRatings: 4, ratings: { grade0: 1, grade1: 1, grade2: 0, grade3: 1, unknown: 1 } },
    { reviewerId: "reviewer-2", totalRatings: 4, ratings: { grade0: 0, grade1: 0, grade2: 1, grade3: 1, unknown: 2 } },
  ]);
  assert.deepEqual(query.reviewerPairComparisons, [{
    reviewerIds: ["reviewer-1", "reviewer-2"],
    sharedCandidateCount: 4,
    numericPairs: 2,
    exactAgreements: 1,
    oneGradeApart: 1,
    twoOrMoreGradesApart: 0,
    unknownOutcomePairs: { bothUnknown: 1, mixedWithNumeric: 1 },
    numericGradeContingency: [
      [0, 0, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1],
    ],
  }]);
  assert.equal(query.numericGradeAgreement.comparablePairs, 2);
  assert.deepEqual(query.unknownOutcomePairs, { bothUnknown: 1, mixedWithNumeric: 1 });
});

test("keeps contingency tables separate for every pair when a query has more than two reviewers", () => {
  const dataset = completeDataset();
  dataset.queries[0]!.ratings.push(
    { candidateId: "candidate-a", reviewerId: "reviewer-3", rating: 2 },
    { candidateId: "candidate-b", reviewerId: "reviewer-3", rating: 0 },
    { candidateId: "candidate-c", reviewerId: "reviewer-3", rating: 3 },
  );

  const pairs = evaluateShortlistQuality(dataset).queries[0]!.reviewerPairComparisons;

  assert.deepEqual(pairs.map(({ reviewerIds }) => reviewerIds), [
    ["reviewer-1", "reviewer-2"],
    ["reviewer-1", "reviewer-3"],
    ["reviewer-2", "reviewer-3"],
  ]);
  assert.equal(pairs[1]?.numericPairs, 3);
  assert.equal(pairs[1]?.oneGradeApart, 2);
  assert.equal(pairs[1]?.twoOrMoreGradesApart, 1);
  assert.equal(pairs[2]?.numericPairs, 3);
  assert.equal(pairs[2]?.oneGradeApart, 1);
  assert.equal(pairs[2]?.twoOrMoreGradesApart, 2);
});

test("unknown adjudications suppress nDCG without becoming zero", () => {
  const dataset = completeDataset();
  const query = dataset.queries[0]!;
  query.ratings = query.ratings.filter(({ candidateId }) => candidateId !== "candidate-c");
  query.ratings.push(
    { candidateId: "candidate-c", reviewerId: "reviewer-1", rating: "unknown" },
    { candidateId: "candidate-c", reviewerId: "reviewer-2", rating: "unknown" },
  );
  query.adjudications[2]!.grade = "unknown";

  const result = evaluateShortlistQuality(dataset);
  const evaluatedQuery = result.queries[0]!;

  assert.equal(result.status, "not_evaluable");
  assert.equal(evaluatedQuery.status, "not_evaluable");
  assert.equal(evaluatedQuery.judgmentCoverage.candidatesWithTwoRatings, 3);
  assert.equal(evaluatedQuery.judgmentCoverage.candidatesWithResolvedGrade, 2);
  assert.equal(evaluatedQuery.rawPairwiseAgreement.agreements, 2);
  assert.equal(evaluatedQuery.rawPairwiseAgreement.rate, 0.6667);
  assert.deepEqual(evaluatedQuery.numericGradeAgreement, { agreements: 1, comparablePairs: 2, rate: 0.5 });
  assert.deepEqual(evaluatedQuery.unknownOutcomePairs, { bothUnknown: 1, mixedWithNumeric: 0 });
  assert.ok(evaluatedQuery.notEvaluableReasons.includes("unresolved_adjudicated_grades"));
  assert.ok(evaluatedQuery.systems.every(({ ndcgAt5 }) => ndcgAt5 === null));
});

test("reports mixed unknown and numeric judgments separately from exact agreement", () => {
  const dataset = completeDataset();
  const query = dataset.queries[0]!;
  query.ratings = query.ratings.filter(({ candidateId }) => candidateId !== "candidate-c");
  query.ratings.push(
    { candidateId: "candidate-c", reviewerId: "reviewer-1", rating: "unknown" },
    { candidateId: "candidate-c", reviewerId: "reviewer-2", rating: 0 },
  );
  query.adjudications[2]!.grade = "unknown";

  const result = evaluateShortlistQuality(dataset);
  const evaluatedQuery = result.queries[0]!;

  assert.equal(evaluatedQuery.numericGradeAgreement.comparablePairs, 2);
  assert.deepEqual(evaluatedQuery.unknownOutcomePairs, { bothUnknown: 0, mixedWithNumeric: 1 });
  assert.equal(evaluatedQuery.rawPairwiseAgreement.comparablePairs, 3);
  assert.equal(evaluatedQuery.rawPairwiseAgreement.agreements, 1);
});

test("a candidate with only one reviewer suppresses the whole query ranking score", () => {
  const dataset = completeDataset();
  dataset.queries[0]!.ratings = dataset.queries[0]!.ratings.filter((rating) => (
    rating.candidateId !== "candidate-b" || rating.reviewerId !== "reviewer-2"
  ));

  const result = evaluateShortlistQuality(dataset);
  const query = result.queries[0]!;

  assert.equal(query.status, "not_evaluable");
  assert.equal(query.judgmentCoverage.candidatesWithTwoRatings, 2);
  assert.equal(query.judgmentCoverage.doubleRatingRatio, 0.6667);
  assert.ok(query.notEvaluableReasons.includes("incomplete_double_judgment_coverage"));
  assert.ok(query.systems.every(({ ndcgAt5 }) => ndcgAt5 === null));
});

test("an empty template returns an explicit not_evaluable result", () => {
  const result = evaluateShortlistQuality({
    schemaVersion: 1,
    benchmarkId: "human-shortlist-fit-v1",
    snapshots: [],
    queries: [],
  });

  assert.equal(result.status, "not_evaluable");
  assert.deepEqual(result.notEvaluableReasons, ["no_queries", "no_snapshot_metadata"]);
  assert.deepEqual(result.queries, []);
});

test("dataset validation rejects duplicate judgments and rankings outside the candidate pool", () => {
  const dataset = completeDataset();
  const query = dataset.queries[0]!;
  query.ratings.push({ candidateId: "candidate-a", reviewerId: "reviewer-1", rating: 2 });
  query.systemRankings[0]!.candidateIds.push("unknown-candidate");

  assert.throws(() => ShortlistQualityDatasetSchema.parse(dataset), /重复评审|候选池/);
});

test("a pool with no positive adjudicated grade is not assigned a misleading zero score", () => {
  const dataset = completeDataset();
  dataset.queries[0]!.adjudications.forEach((judgment) => { judgment.grade = 0; });

  const result = evaluateShortlistQuality(dataset);

  assert.equal(result.status, "not_evaluable");
  assert.ok(result.queries[0]?.notEvaluableReasons.includes("no_positive_adjudicated_grade"));
  assert.ok(result.queries[0]?.systems.every(({ ndcgAt5 }) => ndcgAt5 === null));
});

test("a populated query without human labels reports coverage gaps instead of treating candidates as negatives", () => {
  const dataset = completeDataset();
  dataset.queries[0]!.ratings = [];
  dataset.queries[0]!.adjudications = [];

  const result = evaluateShortlistQuality(dataset);
  const query = result.queries[0]!;

  assert.equal(result.status, "not_evaluable");
  assert.equal(query.judgmentCoverage.candidatesWithAtLeastOneRating, 0);
  assert.equal(query.judgmentCoverage.candidatesWithTwoRatings, 0);
  assert.equal(query.judgmentCoverage.candidatesWithResolvedGrade, 0);
  assert.equal(query.judgmentCoverage.doubleRatingRatio, 0);
  assert.ok(query.notEvaluableReasons.includes("incomplete_double_judgment_coverage"));
  assert.ok(query.notEvaluableReasons.includes("unresolved_adjudicated_grades"));
  assert.ok(query.systems.every(({ ndcgAt5 }) => ndcgAt5 === null));
});

test("missing snapshot fingerprints produce explicit not_evaluable reasons", () => {
  const dataset = completeDataset();
  delete dataset.snapshots[0]!.contentSha256;

  const result = evaluateShortlistQuality(dataset);

  assert.equal(result.queries[0]?.status, "not_evaluable");
  assert.ok(result.queries[0]?.notEvaluableReasons.includes("snapshot_missing_content_hash:historical-wyscout"));
  assert.ok(result.queries[0]?.systems.every(({ ndcgAt5 }) => ndcgAt5 === null));
});

test("the local CLI reports an empty template as not_evaluable without a zero score", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/evaluation/shortlist-quality-cli.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15_000,
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as { status: string; notEvaluableReasons: string[]; queries: unknown[] };
  assert.equal(output.status, "not_evaluable");
  assert.deepEqual(output.notEvaluableReasons, ["no_queries", "no_snapshot_metadata"]);
  assert.deepEqual(output.queries, []);
  assert.doesNotMatch(result.stdout, /"ndcgAt5": 0/);
});

test("the local CLI accepts an explicit local evaluation JSON path", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "src/evaluation/shortlist-quality-cli.ts",
    "data/evaluations/human-shortlist-quality-v1.template.json",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15_000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "not_evaluable");
});
