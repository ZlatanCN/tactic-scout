import { z } from "zod/v4";
import { ShortlistFitGradeSchema } from "../domain/shortlist-review.js";

export { ShortlistFitGradeSchema } from "../domain/shortlist-review.js";

const SnapshotSchema = z.object({
  ref: z.string().trim().min(1),
  provider: z.string().trim().min(1).optional(),
  datasetId: z.string().trim().min(1).optional(),
  asOf: z.string().datetime().optional(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  derivationRuleset: z.string().trim().min(1).optional(),
}).strict();

const CandidateRankingSchema = z.object({
  systemId: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  modelVersion: z.string().trim().min(1).optional(),
  promptVersion: z.string().trim().min(1).optional(),
  configurationFingerprint: z.string().trim().min(1).optional(),
  candidateIds: z.array(z.string().trim().min(1)),
}).strict();

const ReviewerJudgmentSchema = z.object({
  candidateId: z.string().trim().min(1),
  reviewerId: z.string().trim().min(1),
  rating: ShortlistFitGradeSchema,
}).strict();

const AdjudicatedJudgmentSchema = z.object({
  candidateId: z.string().trim().min(1),
  grade: ShortlistFitGradeSchema,
}).strict();

const QuerySchema = z.object({
  queryId: z.string().trim().min(1),
  brief: z.string().trim().min(1),
  snapshotRefs: z.array(z.string().trim().min(1)),
  candidateIds: z.array(z.string().trim().min(1)),
  systemRankings: z.array(CandidateRankingSchema),
  ratings: z.array(ReviewerJudgmentSchema),
  adjudications: z.array(AdjudicatedJudgmentSchema),
}).strict();

export const ShortlistQualityDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  benchmarkId: z.literal("human-shortlist-fit-v1"),
  snapshots: z.array(SnapshotSchema),
  queries: z.array(QuerySchema),
}).strict().superRefine((dataset, context) => {
  const snapshotRefs = new Set<string>();
  for (const [index, snapshot] of dataset.snapshots.entries()) {
    if (snapshotRefs.has(snapshot.ref)) {
      context.addIssue({ code: "custom", path: ["snapshots", index, "ref"], message: `重复快照引用：${snapshot.ref}` });
    }
    snapshotRefs.add(snapshot.ref);
  }

  const queryIds = new Set<string>();
  for (const [queryIndex, query] of dataset.queries.entries()) {
    if (queryIds.has(query.queryId)) {
      context.addIssue({ code: "custom", path: ["queries", queryIndex, "queryId"], message: `重复 query ID：${query.queryId}` });
    }
    queryIds.add(query.queryId);
    const candidateIds = new Set<string>();
    for (const [candidateIndex, candidateId] of query.candidateIds.entries()) {
      if (candidateIds.has(candidateId)) {
        context.addIssue({ code: "custom", path: ["queries", queryIndex, "candidateIds", candidateIndex], message: `候选池包含重复 ID：${candidateId}` });
      }
      candidateIds.add(candidateId);
    }

    const querySnapshotRefs = new Set<string>();
    for (const [snapshotIndex, snapshotRef] of query.snapshotRefs.entries()) {
      if (querySnapshotRefs.has(snapshotRef)) {
        context.addIssue({ code: "custom", path: ["queries", queryIndex, "snapshotRefs", snapshotIndex], message: `query 包含重复快照引用：${snapshotRef}` });
      }
      querySnapshotRefs.add(snapshotRef);
      if (!snapshotRefs.has(snapshotRef)) {
        context.addIssue({ code: "custom", path: ["queries", queryIndex, "snapshotRefs", snapshotIndex], message: `query 引用了未登记的快照：${snapshotRef}` });
      }
    }

    const rankingRefs = new Set<string>();
    for (const [rankingIndex, ranking] of query.systemRankings.entries()) {
      const rankingRef = `${ranking.systemId}\u0000${ranking.runId}`;
      if (rankingRefs.has(rankingRef)) {
        context.addIssue({ code: "custom", path: ["queries", queryIndex, "systemRankings", rankingIndex], message: `重复系统运行：${ranking.systemId}/${ranking.runId}` });
      }
      rankingRefs.add(rankingRef);
      const rankedCandidateIds = new Set<string>();
      for (const [rankIndex, candidateId] of ranking.candidateIds.entries()) {
        if (rankedCandidateIds.has(candidateId)) {
          context.addIssue({ code: "custom", path: ["queries", queryIndex, "systemRankings", rankingIndex, "candidateIds", rankIndex], message: `系统排名包含重复候选：${candidateId}` });
        }
        rankedCandidateIds.add(candidateId);
        if (!candidateIds.has(candidateId)) {
          context.addIssue({ code: "custom", path: ["queries", queryIndex, "systemRankings", rankingIndex, "candidateIds", rankIndex], message: `系统排名引用了候选池之外的候选：${candidateId}` });
        }
      }
    }

    const judgmentRefs = new Set<string>();
    for (const [ratingIndex, rating] of query.ratings.entries()) {
      if (!candidateIds.has(rating.candidateId)) {
        context.addIssue({ code: "custom", path: ["queries", queryIndex, "ratings", ratingIndex, "candidateId"], message: `评审引用了候选池之外的候选：${rating.candidateId}` });
      }
      const judgmentRef = `${rating.candidateId}\u0000${rating.reviewerId}`;
      if (judgmentRefs.has(judgmentRef)) {
        context.addIssue({ code: "custom", path: ["queries", queryIndex, "ratings", ratingIndex], message: `同一评审对候选重复打分：${rating.candidateId}/${rating.reviewerId}` });
      }
      judgmentRefs.add(judgmentRef);
    }

    const adjudicatedCandidateIds = new Set<string>();
    for (const [adjudicationIndex, adjudication] of query.adjudications.entries()) {
      if (!candidateIds.has(adjudication.candidateId)) {
        context.addIssue({ code: "custom", path: ["queries", queryIndex, "adjudications", adjudicationIndex, "candidateId"], message: `裁决引用了候选池之外的候选：${adjudication.candidateId}` });
      }
      if (adjudicatedCandidateIds.has(adjudication.candidateId)) {
        context.addIssue({ code: "custom", path: ["queries", queryIndex, "adjudications", adjudicationIndex], message: `候选存在重复裁决：${adjudication.candidateId}` });
      }
      adjudicatedCandidateIds.add(adjudication.candidateId);
    }
  }
});

export type ShortlistQualityDataset = z.infer<typeof ShortlistQualityDatasetSchema>;
type Query = ShortlistQualityDataset["queries"][number];

type QueryQualityResult = {
  queryId: string;
  status: "evaluable" | "not_evaluable";
  candidateCount: number;
  snapshotRefs: string[];
  judgmentCoverage: {
    candidatesWithAtLeastOneRating: number;
    candidatesWithTwoRatings: number;
    candidatesWithResolvedGrade: number;
    totalCandidates: number;
    doubleRatingRatio: number | null;
    resolvedGradeRatio: number | null;
  };
  rawPairwiseAgreement: {
    agreements: number;
    comparablePairs: number;
    rate: number | null;
  };
  numericGradeAgreement: {
    agreements: number;
    comparablePairs: number;
    rate: number | null;
  };
  unknownOutcomePairs: {
    bothUnknown: number;
    mixedWithNumeric: number;
  };
  reviewerRatingDistributions: Array<{
    reviewerId: string;
    totalRatings: number;
    ratings: { grade0: number; grade1: number; grade2: number; grade3: number; unknown: number };
  }>;
  reviewerPairComparisons: Array<{
    reviewerIds: [string, string];
    sharedCandidateCount: number;
    numericPairs: number;
    exactAgreements: number;
    oneGradeApart: number;
    twoOrMoreGradesApart: number;
    unknownOutcomePairs: { bothUnknown: number; mixedWithNumeric: number };
    numericGradeContingency: number[][];
  }>;
  systems: Array<{
    systemId: string;
    runId: string;
    modelVersion: string | null;
    promptVersion: string | null;
    configurationFingerprint: string | null;
    rankedCandidateCount: number;
    dcgAt5: number | null;
    idealDcgAt5: number | null;
    ndcgAt5: number | null;
  }>;
  notEvaluableReasons: string[];
};

export type ShortlistQualityEvaluation = {
  evaluationType: "human-labeled-shortlist-quality";
  benchmarkId: "human-shortlist-fit-v1";
  status: "evaluable" | "partially_evaluable" | "not_evaluable";
  snapshots: ShortlistQualityDataset["snapshots"];
  queryCount: number;
  evaluableQueryCount: number;
  notEvaluableQueryCount: number;
  queries: QueryQualityResult[];
  notEvaluableReasons: string[];
  interpretation: string;
};

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function gain(grade: number): number {
  return (2 ** grade) - 1;
}

function discountedGain(grades: number[]): number {
  return grades.slice(0, 5).reduce((total, grade, index) => (
    total + gain(grade) / Math.log2(index + 2)
  ), 0);
}

function snapshotMetadataReasons(query: Query, snapshots: ShortlistQualityDataset["snapshots"]): string[] {
  const reasons: string[] = [];
  if (query.snapshotRefs.length === 0) return ["missing_snapshot_reference"];
  for (const ref of query.snapshotRefs) {
    const snapshot = snapshots.find((item) => item.ref === ref);
    if (!snapshot) continue;
    if (!snapshot.provider) reasons.push(`snapshot_missing_provider:${ref}`);
    if (!snapshot.datasetId) reasons.push(`snapshot_missing_dataset_id:${ref}`);
    if (!snapshot.asOf) reasons.push(`snapshot_missing_as_of:${ref}`);
    if (!snapshot.contentSha256) reasons.push(`snapshot_missing_content_hash:${ref}`);
    if (!snapshot.derivationRuleset) reasons.push(`snapshot_missing_derivation_ruleset:${ref}`);
  }
  return reasons;
}

function evaluateQuery(query: Query, snapshots: ShortlistQualityDataset["snapshots"]): QueryQualityResult {
  const candidateCount = query.candidateIds.length;
  const ratingsByCandidate = new Map<string, Array<{ reviewerId: string; rating: Query["ratings"][number]["rating"] }>>();
  const ratingsByCandidateAndReviewer = new Map<string, Map<string, Query["ratings"][number]["rating"]>>();
  const ratingCountsByReviewer = new Map<string, { grade0: number; grade1: number; grade2: number; grade3: number; unknown: number }>();
  for (const rating of query.ratings) {
    const candidateRatings = ratingsByCandidate.get(rating.candidateId) ?? [];
    candidateRatings.push({ reviewerId: rating.reviewerId, rating: rating.rating });
    ratingsByCandidate.set(rating.candidateId, candidateRatings);
    const candidateReviewerRatings = ratingsByCandidateAndReviewer.get(rating.candidateId) ?? new Map();
    candidateReviewerRatings.set(rating.reviewerId, rating.rating);
    ratingsByCandidateAndReviewer.set(rating.candidateId, candidateReviewerRatings);

    const counts = ratingCountsByReviewer.get(rating.reviewerId) ?? { grade0: 0, grade1: 0, grade2: 0, grade3: 0, unknown: 0 };
    if (rating.rating === "unknown") counts.unknown += 1;
    else counts[`grade${rating.rating}`] += 1;
    ratingCountsByReviewer.set(rating.reviewerId, counts);
  }
  const reviewerRatingDistributions = [...ratingCountsByReviewer.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reviewerId, ratings]) => ({
      reviewerId,
      totalRatings: Object.values(ratings).reduce((total, count) => total + count, 0),
      ratings,
    }));
  const adjudications = new Map(query.adjudications.map(({ candidateId, grade }) => [candidateId, grade]));
  const candidatesWithAtLeastOneRating = query.candidateIds.filter((id) => (ratingsByCandidate.get(id)?.length ?? 0) >= 1).length;
  const candidatesWithTwoRatings = query.candidateIds.filter((id) => (ratingsByCandidate.get(id)?.length ?? 0) >= 2).length;
  const candidatesWithResolvedGrade = query.candidateIds.filter((id) => {
    const grade = adjudications.get(id);
    return typeof grade === "number";
  }).length;
  const reviewerIds = reviewerRatingDistributions.map(({ reviewerId }) => reviewerId);
  const reviewerPairComparisons: QueryQualityResult["reviewerPairComparisons"] = [];
  for (let leftIndex = 0; leftIndex < reviewerIds.length; leftIndex += 1) {
    const leftReviewerId = reviewerIds[leftIndex];
    if (!leftReviewerId) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < reviewerIds.length; rightIndex += 1) {
      const rightReviewerId = reviewerIds[rightIndex];
      if (!rightReviewerId) continue;
      const numericGradeContingency = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
      let sharedCandidateCount = 0;
      let numericPairs = 0;
      let exactAgreements = 0;
      let oneGradeApart = 0;
      let twoOrMoreGradesApart = 0;
      let pairBothUnknown = 0;
      let pairMixedUnknown = 0;

      for (const candidateId of query.candidateIds) {
        const candidateRatings = ratingsByCandidateAndReviewer.get(candidateId);
        const leftRating = candidateRatings?.get(leftReviewerId);
        const rightRating = candidateRatings?.get(rightReviewerId);
        if (leftRating === undefined || rightRating === undefined) continue;
        sharedCandidateCount += 1;
        const leftIsNumeric = typeof leftRating === "number";
        const rightIsNumeric = typeof rightRating === "number";
        if (leftIsNumeric && rightIsNumeric) {
          numericPairs += 1;
          const contingencyRow = numericGradeContingency[leftRating];
          if (contingencyRow) contingencyRow[rightRating] += 1;
          const gradeGap = Math.abs(leftRating - rightRating);
          if (gradeGap === 0) exactAgreements += 1;
          else if (gradeGap === 1) oneGradeApart += 1;
          else twoOrMoreGradesApart += 1;
        } else if (!leftIsNumeric && !rightIsNumeric) {
          pairBothUnknown += 1;
        } else {
          pairMixedUnknown += 1;
        }
      }

      reviewerPairComparisons.push({
        reviewerIds: [leftReviewerId, rightReviewerId],
        sharedCandidateCount,
        numericPairs,
        exactAgreements,
        oneGradeApart,
        twoOrMoreGradesApart,
        unknownOutcomePairs: { bothUnknown: pairBothUnknown, mixedWithNumeric: pairMixedUnknown },
        numericGradeContingency,
      });
    }
  }
  const pairwiseTotals = reviewerPairComparisons.reduce((totals, comparison) => ({
    agreements: totals.agreements + comparison.exactAgreements + comparison.unknownOutcomePairs.bothUnknown,
    comparablePairs: totals.comparablePairs + comparison.sharedCandidateCount,
    numericGradeAgreements: totals.numericGradeAgreements + comparison.exactAgreements,
    numericGradePairs: totals.numericGradePairs + comparison.numericPairs,
    bothUnknownPairs: totals.bothUnknownPairs + comparison.unknownOutcomePairs.bothUnknown,
    mixedUnknownPairs: totals.mixedUnknownPairs + comparison.unknownOutcomePairs.mixedWithNumeric,
  }), {
    agreements: 0,
    comparablePairs: 0,
    numericGradeAgreements: 0,
    numericGradePairs: 0,
    bothUnknownPairs: 0,
    mixedUnknownPairs: 0,
  });

  const notEvaluableReasons = snapshotMetadataReasons(query, snapshots);
  if (candidateCount === 0) notEvaluableReasons.push("empty_candidate_pool");
  if (query.systemRankings.length === 0) notEvaluableReasons.push("no_system_rankings");
  if (candidatesWithTwoRatings < candidateCount) notEvaluableReasons.push("incomplete_double_judgment_coverage");
  if (candidatesWithResolvedGrade < candidateCount) notEvaluableReasons.push("unresolved_adjudicated_grades");

  const resolvedGrades = query.candidateIds.flatMap((id) => {
    const grade = adjudications.get(id);
    return typeof grade === "number" ? [grade] : [];
  });
  if (candidatesWithResolvedGrade === candidateCount && resolvedGrades.every((grade) => grade === 0)) {
    notEvaluableReasons.push("no_positive_adjudicated_grade");
  }

  const uniqueReasons = [...new Set(notEvaluableReasons)];
  const evaluable = uniqueReasons.length === 0;
  const idealDcgRaw = evaluable
    ? discountedGain([...resolvedGrades].sort((left, right) => right - left))
    : null;
  const idealDcgAt5 = idealDcgRaw === null ? null : rounded(idealDcgRaw);
  const systems = query.systemRankings.map((ranking) => {
    const rankedGrades = ranking.candidateIds.flatMap((candidateId) => {
      const grade = adjudications.get(candidateId);
      return typeof grade === "number" ? [grade] : [];
    });
    const dcgRaw = evaluable ? discountedGain(rankedGrades) : null;
    const dcgAt5 = dcgRaw === null ? null : rounded(dcgRaw);
    return {
      systemId: ranking.systemId,
      runId: ranking.runId,
      modelVersion: ranking.modelVersion ?? null,
      promptVersion: ranking.promptVersion ?? null,
      configurationFingerprint: ranking.configurationFingerprint ?? null,
      rankedCandidateCount: ranking.candidateIds.length,
      dcgAt5,
      idealDcgAt5,
      ndcgAt5: dcgRaw === null || idealDcgRaw === null || idealDcgRaw === 0
        ? null
        : rounded(dcgRaw / idealDcgRaw),
    };
  });

  return {
    queryId: query.queryId,
    status: evaluable ? "evaluable" : "not_evaluable",
    candidateCount,
    snapshotRefs: query.snapshotRefs,
    judgmentCoverage: {
      candidatesWithAtLeastOneRating,
      candidatesWithTwoRatings,
      candidatesWithResolvedGrade,
      totalCandidates: candidateCount,
      doubleRatingRatio: candidateCount ? rounded(candidatesWithTwoRatings / candidateCount) : null,
      resolvedGradeRatio: candidateCount ? rounded(candidatesWithResolvedGrade / candidateCount) : null,
    },
    rawPairwiseAgreement: {
      agreements: pairwiseTotals.agreements,
      comparablePairs: pairwiseTotals.comparablePairs,
      rate: pairwiseTotals.comparablePairs ? rounded(pairwiseTotals.agreements / pairwiseTotals.comparablePairs) : null,
    },
    numericGradeAgreement: {
      agreements: pairwiseTotals.numericGradeAgreements,
      comparablePairs: pairwiseTotals.numericGradePairs,
      rate: pairwiseTotals.numericGradePairs ? rounded(pairwiseTotals.numericGradeAgreements / pairwiseTotals.numericGradePairs) : null,
    },
    unknownOutcomePairs: {
      bothUnknown: pairwiseTotals.bothUnknownPairs,
      mixedWithNumeric: pairwiseTotals.mixedUnknownPairs,
    },
    reviewerRatingDistributions,
    reviewerPairComparisons,
    systems,
    notEvaluableReasons: uniqueReasons,
  };
}

export function evaluateShortlistQuality(input: unknown): ShortlistQualityEvaluation {
  const dataset = ShortlistQualityDatasetSchema.parse(input);
  const queries = dataset.queries.map((query) => evaluateQuery(query, dataset.snapshots));
  const evaluableQueryCount = queries.filter((query) => query.status === "evaluable").length;
  const notEvaluableQueryCount = queries.length - evaluableQueryCount;
  const notEvaluableReasons: string[] = [];
  if (queries.length === 0) notEvaluableReasons.push("no_queries");
  if (dataset.snapshots.length === 0) notEvaluableReasons.push("no_snapshot_metadata");
  if (notEvaluableQueryCount > 0) {
    notEvaluableReasons.push(...queries.flatMap((query) => query.notEvaluableReasons.map((reason) => `${query.queryId}:${reason}`)));
  }
  const status = evaluableQueryCount === queries.length && queries.length > 0
    ? "evaluable"
    : evaluableQueryCount > 0 ? "partially_evaluable" : "not_evaluable";
  return {
    evaluationType: "human-labeled-shortlist-quality",
    benchmarkId: dataset.benchmarkId,
    status,
    snapshots: dataset.snapshots,
    queryCount: queries.length,
    evaluableQueryCount,
    notEvaluableQueryCount,
    queries,
    notEvaluableReasons,
    interpretation: "结果仅适用于记录中的固定需求、候选池和数据快照。nDCG@5 使用人工裁决的 0–3 分级标签；unknown 或未裁决候选不按 0 分处理。原始一致率只描述本批评审判断，不证明量表可靠，也不构成普适球探真值或推荐质量结论。",
  };
}
