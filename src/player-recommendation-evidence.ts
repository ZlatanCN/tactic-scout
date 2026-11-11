import { z } from "zod/v4";

import { contextProcessingHash } from "./context-processing-state.js";
import { recommendationResultSchema } from "./player-data/recommend-players.js";
import type { RecommendationCandidate } from "./player-data/recommend-players.js";
import type { EvidenceBatchState } from "./state.js";

type RecommendationList = "current" | "potential";

type PlayerRecommendationEvidenceBatchPlan = {
  list: RecommendationList;
  size: number;
};

type CompletedRecommendation = Extract<
  z.output<typeof recommendationResultSchema>,
  { status: "ready" | "no_candidates" }
>;

const recommendationEvidenceHeaderSchema = z.object({
  batch: z.object({
    candidateRefs: z.array(z.string()),
    index: z.number().int().nonnegative(),
    list: z.enum(["current", "potential"]),
    total: z.number().int().positive(),
  }),
  selectedCandidates: z.array(z.object({ fmId: z.string(), name: z.string() })),
});

const parseCompletedRecommendation = (
  resultJson: string
): CompletedRecommendation | null => {
  let rawResult: unknown;

  try {
    rawResult = JSON.parse(resultJson);
  } catch {
    return null;
  }

  const parsed = recommendationResultSchema.safeParse(rawResult);

  return parsed.success &&
    (parsed.data.status === "ready" || parsed.data.status === "no_candidates")
    ? parsed.data
    : null;
};

const candidateListFor = (
  result: CompletedRecommendation,
  list: RecommendationList
) =>
  list === "current"
    ? result.currentCandidates
    : (result.potentialCandidates ?? []);

const validBatchPlan = (
  result: CompletedRecommendation,
  batchPlan: PlayerRecommendationEvidenceBatchPlan[]
): boolean => {
  if (batchPlan.length === 0) {
    return false;
  }

  let currentBatchCount = 0;
  let potentialBatchCount = 0;
  let reachedPotentialList = false;

  for (const batch of batchPlan) {
    if (!Number.isSafeInteger(batch.size) || batch.size < 1) {
      return false;
    }

    if (batch.list === "potential") {
      reachedPotentialList = true;
      potentialBatchCount += batch.size;
    } else {
      if (reachedPotentialList) {
        return false;
      }

      currentBatchCount += batch.size;
    }
  }

  const allCandidatesAreCounted =
    currentBatchCount === result.currentCandidates.length &&
    potentialBatchCount === (result.potentialCandidates?.length ?? 0);

  const potentialListWasRequested =
    result.potentialCandidates !== null || potentialBatchCount === 0;

  return allCandidatesAreCounted && potentialListWasRequested;
};

const candidateRefsForBatch = (
  list: RecommendationList,
  start: number,
  size: number
): string[] =>
  Array.from({ length: size }, (_unused, offset) => {
    const index = start + offset;

    const listName =
      list === "current" ? "currentCandidates" : "potentialCandidates";

    return `${listName}[${index}]`;
  });

const recommendationProjectionForBatchPlan = (
  result: CompletedRecommendation,
  resultJson: string,
  source: "executed" | "saved",
  batchPlan: PlayerRecommendationEvidenceBatchPlan[]
) => {
  let currentStart = 0;
  let potentialStart = 0;
  const digest = contextProcessingHash(resultJson);

  const candidateCounts = {
    current: result.currentCandidates.length,
    potential: result.potentialCandidates?.length ?? 0,
  };

  return batchPlan.map(({ list, size }, index) => {
    const start = list === "current" ? currentStart : potentialStart;
    const candidateRefs = candidateRefsForBatch(list, start, size);

    const candidates = candidateListFor(result, list).slice(
      start,
      start + size
    );

    const projection = {
      batch: {
        candidateRefs,
        index,
        list,
        total: batchPlan.length,
      },
      candidateCounts,
      digest,
      metadata: {
        ageAsOfDate: result.ageAsOfDate,
        filterCounts: result.filterCounts,
        filters: result.filters,
        formula: result.formula,
        gameBuild: result.gameBuild,
        manifestSha256: result.manifestSha256,
        position: result.position,
        positionFeatureMapSha256: result.positionFeatureMapSha256,
        positionFeatureSetVersion: result.positionFeatureSetVersion,
        referenceFmIds: result.referenceFmIds,
        referenceMeanAttributes: result.referenceMeanAttributes,
        references: result.references,
        snapshotDate: result.snapshotDate,
        status: result.status,
        strategyVersion: result.strategyVersion,
      },
      potentialListStatus:
        result.potentialCandidates === null ? "not_requested" : "requested",
      selectedCandidates: candidates,
      source,
      version: 1,
    };

    if (list === "current") {
      currentStart += size;
    } else {
      potentialStart += size;
    }

    return {
      projectionJson: JSON.stringify(projection),
      recordRefs: candidateRefs,
    };
  });
};

const playerRecommendationEvidenceProjectionsForBatchPlan = (
  resultJson: string,
  source: "executed" | "saved",
  batchPlan: PlayerRecommendationEvidenceBatchPlan[]
) => {
  const result = parseCompletedRecommendation(resultJson);

  if (result === null || !validBatchPlan(result, batchPlan)) {
    return null;
  }

  return recommendationProjectionForBatchPlan(
    result,
    resultJson,
    source,
    batchPlan
  );
};

const playerRecommendationEvidenceProjections = (
  resultJson: string,
  source: "executed" | "saved",
  candidatesPerBatch = 10
) => {
  const result = parseCompletedRecommendation(resultJson);

  if (
    result === null ||
    !Number.isSafeInteger(candidatesPerBatch) ||
    candidatesPerBatch < 1
  ) {
    return null;
  }

  const lists: { list: RecommendationList; length: number }[] = [
    { length: result.currentCandidates.length, list: "current" },
    ...(result.potentialCandidates === null
      ? []
      : [
          {
            length: result.potentialCandidates.length,
            list: "potential" as const,
          },
        ]),
  ];

  const batchPlan = lists.flatMap(({ list, length }) =>
    Array.from(
      { length: Math.ceil(length / candidatesPerBatch) },
      (_unused) => ({ list, size: candidatesPerBatch })
    ).map((batch, index, batches) =>
      index === batches.length - 1
        ? { ...batch, size: length - index * candidatesPerBatch }
        : batch
    )
  );

  return playerRecommendationEvidenceProjectionsForBatchPlan(
    resultJson,
    source,
    batchPlan
  );
};

const playerRecommendationEvidenceQuestionMessage = (
  question: string,
  projectionJson: string
): string =>
  `用户请求：${question}\n\nPlayer recommendation evidence projection JSON:\n${projectionJson}`;

const parseRecommendationBatchHeader = (projectionJson: string) => {
  try {
    return recommendationEvidenceHeaderSchema.safeParse(
      JSON.parse(projectionJson)
    );
  } catch {
    return { success: false as const };
  }
};

const answerStatesFieldValue = (
  answer: string,
  labels: string[],
  value: number | null
): boolean => {
  const expectedValues =
    value === null ? ["未提供", "not provided"] : [String(value)];

  return labels.some((label) =>
    expectedValues.some((expectedValue) =>
      [
        `${label} ${expectedValue}`,
        `${label}: ${expectedValue}`,
        `${label}：${expectedValue}`,
        `${label}=${expectedValue}`,
      ].some((fieldText) => answer.includes(fieldText))
    )
  );
};

const answerStatesCandidateRank = (
  answer: string,
  candidate: RecommendationCandidate
): boolean =>
  [
    `${candidate.rank}. ${candidate.name}`,
    `${candidate.rank}、${candidate.name}`,
    `第 ${candidate.rank} 名`,
    `第${candidate.rank}名`,
    `#${candidate.rank} ${candidate.name}`,
    `rank ${candidate.rank}`,
  ].some((rankMarker) => answer.includes(rankMarker));

const candidateAnswerIsComplete = (
  answer: string,
  candidate: RecommendationCandidate
): boolean => {
  const candidateRow = answer
    .split(/\r?\n/u)
    .find(
      (line) => line.includes(candidate.name) && line.includes(candidate.fmId)
    );

  if (
    candidateRow === undefined ||
    !answerStatesCandidateRank(candidateRow, candidate)
  ) {
    return false;
  }

  const requiredFieldCoverage = [
    answerStatesFieldValue(candidateRow, ["年龄", "age"], candidate.age),
    answerStatesFieldValue(
      candidateRow,
      ["位置评分", "position rating"],
      candidate.positionRating
    ),
    answerStatesFieldValue(candidateRow, ["CA"], candidate.currentAbility),
    answerStatesFieldValue(candidateRow, ["PA"], candidate.potentialAbility),
    answerStatesFieldValue(
      candidateRow,
      ["currentDistance"],
      candidate.currentDistance
    ),
  ];

  return requiredFieldCoverage.every(Boolean);
};

const playerRecommendationEvidenceIsComplete = (
  evidence: EvidenceBatchState,
  resultJson: string
): boolean => {
  const result = parseCompletedRecommendation(resultJson);

  const evidenceCanBeComplete =
    evidence.status === "complete" || evidence.status === "processing";

  if (
    result === null ||
    !evidenceCanBeComplete ||
    evidence.batches.length === 0 ||
    evidence.resultDigest !== contextProcessingHash(resultJson)
  ) {
    return false;
  }

  const batchPlan: PlayerRecommendationEvidenceBatchPlan[] = [];

  for (const batch of evidence.batches) {
    const parsed = parseRecommendationBatchHeader(batch.projectionJson);

    if (
      !parsed.success ||
      parsed.data.batch.index !== batch.index ||
      parsed.data.batch.total !== evidence.batches.length ||
      parsed.data.batch.candidateRefs.length !==
        parsed.data.selectedCandidates.length
    ) {
      return false;
    }

    batchPlan.push({
      list: parsed.data.batch.list,
      size: parsed.data.batch.candidateRefs.length,
    });
  }

  const expected = playerRecommendationEvidenceProjectionsForBatchPlan(
    resultJson,
    evidence.source,
    batchPlan
  );

  if (expected === null || expected.length !== evidence.batches.length) {
    return false;
  }

  return evidence.batches.every((batch, index) => {
    const expectedProjection = expected[index];
    const parsed = parseRecommendationBatchHeader(batch.projectionJson);

    if (expectedProjection === undefined || !parsed.success) {
      return false;
    }

    if (
      batch.answer === null ||
      batch.projectionJson !== expectedProjection.projectionJson ||
      JSON.stringify(batch.recordRefs) !==
        JSON.stringify(expectedProjection.recordRefs)
    ) {
      return false;
    }

    const candidateList = candidateListFor(result, parsed.data.batch.list);
    const [firstCandidateRef] = parsed.data.batch.candidateRefs;

    if (firstCandidateRef === undefined) {
      return false;
    }

    const openingBracketIndex = firstCandidateRef.indexOf("[");

    const startIndex = Number(
      firstCandidateRef.slice(openingBracketIndex + 1, -1)
    );

    if (openingBracketIndex === -1 || !Number.isSafeInteger(startIndex)) {
      return false;
    }

    const selectedCandidates = candidateList.slice(
      startIndex,
      startIndex + parsed.data.batch.candidateRefs.length
    );

    const { answer } = batch;

    if (answer === null) {
      return false;
    }

    return (
      selectedCandidates.length === parsed.data.batch.candidateRefs.length &&
      selectedCandidates.every((candidate) =>
        candidateAnswerIsComplete(answer, candidate)
      )
    );
  });
};

export {
  playerRecommendationEvidenceIsComplete,
  playerRecommendationEvidenceProjections,
  playerRecommendationEvidenceProjectionsForBatchPlan,
  playerRecommendationEvidenceQuestionMessage,
};

export type { PlayerRecommendationEvidenceBatchPlan };
