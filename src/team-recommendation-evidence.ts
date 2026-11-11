import { createHash } from "node:crypto";

import { z } from "zod/v4";

import type { RecommendationResult } from "./player-data/recommend-players.js";
import { teamRecommendationResultSchema } from "./team-data/recommendation-result.js";
import type { TeamRecommendationResult } from "./team-data/recommendation-result.js";

type TeamEvidenceSource = "executed" | "saved";

type TeamEvidenceProjection = {
  projectionJson: string;
  recordRefs: string[];
};

type TeamEvidenceBatch = {
  answer: string | null;
  index: number;
  projectionJson: string;
  recordRefs: string[];
  status?: string;
};

type TeamRecommendationEvidence = {
  batches: TeamEvidenceBatch[];
  source: TeamEvidenceSource;
};

const teamExclusionScopeSchema = z.object({
  currentRosterMembers: z.array(
    z.object({
      apiFootballPlayerId: z.number().int().positive(),
      fmId: z.string().min(1),
      mappingMethod: z.enum(["reep_bridge", "user_confirmation"]),
    })
  ),
  effectiveExcludedFmIds: z.array(z.string().min(1)),
});

type CompletedRecommendationResult = Extract<
  RecommendationResult,
  { status: "ready" | "no_candidates" }
>;

type CompletedTeamRecommendationResult = TeamRecommendationResult & {
  status: "ready" | "no_candidates";
  recommendation: CompletedRecommendationResult;
};

const isCompletedRecommendationResult = (
  result: RecommendationResult
): result is CompletedRecommendationResult =>
  result.status === "ready" || result.status === "no_candidates";

const isCompletedTeamRecommendationResult = (
  result: TeamRecommendationResult
): result is CompletedTeamRecommendationResult =>
  (result.status === "ready" || result.status === "no_candidates") &&
  "recommendation" in result &&
  isCompletedRecommendationResult(result.recommendation);

type ParsedTeamRecommendation = {
  exclusionScope: z.output<typeof teamExclusionScopeSchema>;
  result: CompletedTeamRecommendationResult;
};

const exclusionScopeMatchesResult = (
  exclusionScope: z.output<typeof teamExclusionScopeSchema>,
  result: CompletedTeamRecommendationResult
): boolean => {
  const { currentRosterMembers, effectiveExcludedFmIds } = exclusionScope;
  const effectiveIds = new Set(effectiveExcludedFmIds);

  const apiFootballPlayerIds = new Set(
    currentRosterMembers.map(({ apiFootballPlayerId }) => apiFootballPlayerId)
  );

  const reepBridgeCount = currentRosterMembers.filter(
    ({ mappingMethod }) => mappingMethod === "reep_bridge"
  ).length;

  const userConfirmedCount = currentRosterMembers.filter(
    ({ mappingMethod }) => mappingMethod === "user_confirmation"
  ).length;

  const requiredIds = [
    ...currentRosterMembers.map(({ fmId }) => fmId),
    ...result.recommendation.referenceFmIds,
  ];

  const candidateFmIds = [
    ...result.recommendation.currentCandidates,
    ...(result.recommendation.potentialCandidates ?? []),
  ].map(({ fmId }) => fmId);

  const rosterMappingMatchesCoverage =
    apiFootballPlayerIds.size === currentRosterMembers.length &&
    currentRosterMembers.length === result.roster.mappedMembers &&
    reepBridgeCount === result.roster.reepBridgeMappings &&
    userConfirmedCount === result.roster.userConfirmedMappings;

  const exclusionSetIsValid =
    effectiveIds.size === effectiveExcludedFmIds.length &&
    requiredIds.every((fmId) => effectiveIds.has(fmId));

  const candidateSetRespectsExclusions = candidateFmIds.every(
    (fmId) => !effectiveIds.has(fmId)
  );

  return (
    rosterMappingMatchesCoverage &&
    exclusionSetIsValid &&
    candidateSetRespectsExclusions
  );
};

const parseTeamRecommendationForEvidence = (
  resultJson: string
): ParsedTeamRecommendation | null => {
  let rawResult: unknown;

  try {
    rawResult = JSON.parse(resultJson);
  } catch {
    return null;
  }

  const parsedResult = teamRecommendationResultSchema.safeParse(rawResult);

  const parsedExclusionScope = z
    .looseObject({ exclusionScope: teamExclusionScopeSchema })
    .safeParse(rawResult);

  if (
    !parsedResult.success ||
    !parsedExclusionScope.success ||
    !isCompletedTeamRecommendationResult(parsedResult.data)
  ) {
    return null;
  }

  const result = parsedResult.data;
  const { exclusionScope } = parsedExclusionScope.data;

  if (!exclusionScopeMatchesResult(exclusionScope, result)) {
    return null;
  }

  return { exclusionScope, result };
};

const candidateEntriesFor = (result: CompletedTeamRecommendationResult) => {
  const currentCandidates = result.recommendation.currentCandidates.map(
    (candidate, index) => ({
      candidate,
      ref: `recommendation.currentCandidates[${index}]`,
      type: "current" as const,
    })
  );

  const potentialCandidates =
    result.recommendation.potentialCandidates?.map((candidate, index) => ({
      candidate,
      ref: `recommendation.potentialCandidates[${index}]`,
      type: "potential" as const,
    })) ?? [];

  return [...currentCandidates, ...potentialCandidates];
};

const batchSizesAreValid = (
  batchSizes: number[],
  candidateCount: number
): boolean => {
  if (
    batchSizes.length === 0 ||
    batchSizes.some((size) => !Number.isSafeInteger(size) || size < 0)
  ) {
    return false;
  }

  if (candidateCount === 0) {
    return batchSizes.length === 1 && batchSizes[0] === 0;
  }

  return (
    batchSizes.every((size) => size > 0) &&
    batchSizes.reduce((total, size) => total + size, 0) === candidateCount
  );
};

const teamEvidenceProjectionForBatchSizes = (
  resultJson: string,
  source: TeamEvidenceSource,
  batchSizes: number[]
): TeamEvidenceProjection[] | null => {
  const parsed = parseTeamRecommendationForEvidence(resultJson);

  if (parsed === null) {
    return null;
  }

  const { exclusionScope, result } = parsed;
  const candidateEntries = candidateEntriesFor(result);

  if (!batchSizesAreValid(batchSizes, candidateEntries.length)) {
    return null;
  }

  const { recommendation } = result;
  const allCandidateRefs = candidateEntries.map(({ ref }) => ref);

  const { references } = recommendation;

  const referenceRefs = references.map(
    (_reference, index) => `recommendation.references[${index}]`
  );

  const digest = createHash("sha256").update(resultJson).digest("hex");

  let start = 0;

  return batchSizes.map((size, index) => {
    const selectedEntries = candidateEntries.slice(start, start + size);
    const end = start + size;

    const currentCandidates = selectedEntries.flatMap((entry) =>
      entry.type === "current"
        ? [{ ...entry.candidate, candidateRef: entry.ref }]
        : []
    );

    const potentialCandidates = selectedEntries.flatMap((entry) =>
      entry.type === "potential"
        ? [{ ...entry.candidate, candidateRef: entry.ref }]
        : []
    );

    const candidateRefs = selectedEntries.map(({ ref }) => ref);
    const recordRefs = [...candidateRefs, ...referenceRefs];

    const projection = {
      batch: {
        candidateRefs,
        completedCandidateRefs: allCandidateRefs.slice(0, start),
        index,
        remainingCandidateRefs: allCandidateRefs.slice(end),
        total: batchSizes.length,
      },
      candidateCoverage: {
        currentCandidateCount: recommendation.currentCandidates.length,
        potentialCandidateCount:
          recommendation.potentialCandidates === null
            ? null
            : recommendation.potentialCandidates.length,
      },
      currentCandidates,
      digest,
      exclusionScope,
      filters: result.filters,
      fmSnapshotDate: result.fmSnapshotDate,
      position: result.position,
      potentialCandidates:
        recommendation.potentialCandidates === null
          ? null
          : potentialCandidates,
      rankingBasis: result.rankingBasis,
      rankingContext: {
        ageAsOfDate: recommendation.ageAsOfDate,
        filterCounts: recommendation.filterCounts,
        filters: recommendation.filters,
        formula: recommendation.formula,
        gameBuild: recommendation.gameBuild,
        manifestSha256: recommendation.manifestSha256,
        position: recommendation.position,
        positionFeatureMapSha256: recommendation.positionFeatureMapSha256,
        positionFeatureSetVersion: recommendation.positionFeatureSetVersion,
        referenceFmIds: recommendation.referenceFmIds,
        referenceMeanAttributes: recommendation.referenceMeanAttributes,
        references,
        snapshotDate: recommendation.snapshotDate,
        status: recommendation.status,
        strategyVersion: recommendation.strategyVersion,
      },
      recordRefs,
      referenceFmIds: result.referenceFmIds,
      references,
      roster: result.roster,
      source,
      team: result.team,
      version: 1,
    };

    start = end;

    return {
      projectionJson: JSON.stringify(projection),
      recordRefs,
    };
  });
};

const teamRecommendationEvidenceProjectionsForBatchSizes = (
  resultJson: string,
  source: TeamEvidenceSource,
  batchSizes: number[]
): TeamEvidenceProjection[] | null =>
  teamEvidenceProjectionForBatchSizes(resultJson, source, batchSizes);

const teamRecommendationEvidenceProjections = (
  resultJson: string,
  source: TeamEvidenceSource,
  candidatesPerBatch = 2
): TeamEvidenceProjection[] | null => {
  const parsed = parseTeamRecommendationForEvidence(resultJson);

  if (
    parsed === null ||
    !Number.isSafeInteger(candidatesPerBatch) ||
    candidatesPerBatch < 1
  ) {
    return null;
  }

  const candidateCount = candidateEntriesFor(parsed.result).length;

  if (candidateCount === 0) {
    return teamEvidenceProjectionForBatchSizes(resultJson, source, [0]);
  }

  const batchSizes = Array.from(
    { length: Math.ceil(candidateCount / candidatesPerBatch) },
    (_unused, index) =>
      Math.min(candidatesPerBatch, candidateCount - index * candidatesPerBatch)
  );

  return teamEvidenceProjectionForBatchSizes(resultJson, source, batchSizes);
};

const teamRecommendationEvidenceQuestionMessage = (
  question: string,
  projectionJson: string
): string =>
  `用户请求：${question}\n\nTeam recommendation evidence projection JSON:\n${projectionJson}`;

const projectionCandidateSchema = z.object({
  age: z.number().int().nullable(),
  currentAbility: z.number().nullable(),
  currentDistance: z.number(),
  fmId: z.string(),
  name: z.string(),
  positionRating: z.number(),
  potentialAbility: z.number().nullable(),
  rank: z.number().int().positive(),
});

const projectionCandidatesSchema = z.object({
  candidateCoverage: z.object({
    currentCandidateCount: z.number().int().nonnegative(),
    potentialCandidateCount: z.number().int().nonnegative().nullable(),
  }),
  currentCandidates: z.array(projectionCandidateSchema),
  potentialCandidates: z.array(projectionCandidateSchema).nullable(),
});

const batchMatchesProjection = (
  batch: TeamEvidenceBatch,
  expected: TeamEvidenceProjection | undefined
): boolean => {
  if (
    expected === undefined ||
    batch.answer === null ||
    batch.answer.trim().length === 0
  ) {
    return false;
  }

  return (
    batch.projectionJson === expected.projectionJson &&
    JSON.stringify(batch.recordRefs) === JSON.stringify(expected.recordRefs)
  );
};

const lineHasValueAfterLabel = (
  line: string,
  labels: string[],
  valueIsMissing: boolean
): boolean => {
  const normalizedLine = line.normalize("NFKC").toLocaleLowerCase();

  return labels.some((label) => {
    const normalizedLabel = label.normalize("NFKC").toLocaleLowerCase();
    let labelIndex = normalizedLine.indexOf(normalizedLabel);

    while (labelIndex !== -1) {
      const labelEnd = labelIndex + normalizedLabel.length;
      const beforeLabel = normalizedLine[labelIndex - 1];
      const afterLabel = normalizedLine[labelEnd];

      const labelIsBounded =
        !/[\p{L}\p{N}_]/u.test(beforeLabel ?? "") &&
        !/[\p{L}\p{N}_]/u.test(afterLabel ?? "");

      if (labelIsBounded) {
        const valueSuffix = normalizedLine.slice(labelEnd);
        const valueText = valueSuffix.replace(/^\s*[:：=]?\s*/u, "");

        if (valueIsMissing) {
          if (
            valueText.startsWith("未提供") ||
            valueText.startsWith("not provided")
          ) {
            return true;
          }
        } else if (/^[+-]?\d+(?:\.\d+)?/u.test(valueText)) {
          return true;
        }
      }

      labelIndex = normalizedLine.indexOf(normalizedLabel, labelEnd);
    }

    return false;
  });
};

const rowIncludesRank = (line: string, rank: number): boolean => {
  const prefix = new RegExp(
    `^\\s*(?:(?:[-*])\\s*)?${rank}(?:[.、)）:：|\\s]|$)`,
    "u"
  );

  const tablePrefix = new RegExp(`^\\s*\\|\\s*${rank}\\s*\\|`, "u");

  return (
    prefix.test(line) ||
    tablePrefix.test(line) ||
    lineHasValueAfterLabel(line, ["rank", "排名"], false)
  );
};

const candidateRowContainsRequiredFields = (
  row: string,
  candidate: z.output<typeof projectionCandidateSchema>
): boolean => {
  if (
    !row.includes(candidate.name) ||
    !row.includes(candidate.fmId) ||
    !rowIncludesRank(row, candidate.rank)
  ) {
    return false;
  }

  const fieldCoverage = [
    lineHasValueAfterLabel(row, ["年龄", "age"], candidate.age === null),
    lineHasValueAfterLabel(row, ["位置评分", "position rating"], false),
    lineHasValueAfterLabel(row, ["CA"], candidate.currentAbility === null),
    lineHasValueAfterLabel(row, ["PA"], candidate.potentialAbility === null),
    lineHasValueAfterLabel(row, ["currentDistance"], false),
  ];

  return fieldCoverage.every(Boolean);
};

const nextCandidateRowIndex = (
  rows: string[],
  candidate: z.output<typeof projectionCandidateSchema>,
  previousRowIndex: number
): number =>
  rows.findIndex(
    (row, index) =>
      index > previousRowIndex &&
      row.includes(candidate.name) &&
      row.includes(candidate.fmId)
  );

const answerCoversSelectedCandidates = (
  answer: string,
  candidates: z.output<typeof projectionCandidateSchema>[]
): boolean => {
  const rows = answer.split(/\r?\n/u);
  let previousRowIndex = -1;

  for (const candidate of candidates) {
    const rowIndex = nextCandidateRowIndex(rows, candidate, previousRowIndex);

    const row = rows[rowIndex];

    if (
      rowIndex === -1 ||
      row === undefined ||
      !candidateRowContainsRequiredFields(row, candidate)
    ) {
      return false;
    }

    previousRowIndex = rowIndex;
  }

  return true;
};

const answerNamesEmptyLists = (
  answer: string,
  currentIsEmpty: boolean,
  potentialIsEmpty: boolean
): boolean => {
  const normalized = answer.normalize("NFKC").toLocaleLowerCase();

  const currentListMentioned =
    !currentIsEmpty ||
    [
      "当前能力相似名单",
      "当前能力相似候选",
      "current-ability similarity candidates",
      "current candidates",
    ].some((phrase) =>
      normalized.includes(phrase.normalize("NFKC").toLocaleLowerCase())
    );

  const potentialListMentioned =
    !potentialIsEmpty ||
    [
      "高潜候选",
      "高潜名单",
      "high-potential candidates",
      "potential candidates",
    ].some((phrase) =>
      normalized.includes(phrase.normalize("NFKC").toLocaleLowerCase())
    );

  return currentListMentioned && potentialListMentioned;
};

const teamRecommendationBatchIsComplete = (
  evidence: TeamRecommendationEvidence,
  resultJson: string
): boolean => {
  const batchSizes: number[] = [];

  for (const [index, batch] of evidence.batches.entries()) {
    let projectionJson: unknown;

    try {
      projectionJson = JSON.parse(batch.projectionJson);
    } catch {
      return false;
    }

    const projection = z
      .object({
        batch: z.object({
          candidateRefs: z.array(z.string()),
          index: z.number().int(),
        }),
      })
      .safeParse(projectionJson);

    if (
      !projection.success ||
      projection.data.batch.index !== index ||
      batch.index !== index
    ) {
      return false;
    }

    batchSizes.push(projection.data.batch.candidateRefs.length);
  }

  const expected = teamEvidenceProjectionForBatchSizes(
    resultJson,
    evidence.source,
    batchSizes
  );

  if (expected === null || expected.length !== evidence.batches.length) {
    return false;
  }

  for (const [index, batch] of evidence.batches.entries()) {
    const expectedProjection = expected[index];

    if (
      batch.answer === null ||
      !batchMatchesProjection(batch, expectedProjection)
    ) {
      return false;
    }

    const { answer } = batch;

    let rawProjection: unknown;

    try {
      rawProjection = JSON.parse(batch.projectionJson);
    } catch {
      return false;
    }

    const parsedCandidates =
      projectionCandidatesSchema.safeParse(rawProjection);

    if (!parsedCandidates.success) {
      return false;
    }

    const candidates = [
      ...parsedCandidates.data.currentCandidates,
      ...(parsedCandidates.data.potentialCandidates ?? []),
    ];

    if (
      !answerCoversSelectedCandidates(answer, candidates) ||
      !answerNamesEmptyLists(
        answer,
        parsedCandidates.data.candidateCoverage.currentCandidateCount === 0,
        parsedCandidates.data.candidateCoverage.potentialCandidateCount === 0
      )
    ) {
      return false;
    }
  }

  return true;
};

export {
  teamRecommendationBatchIsComplete,
  teamRecommendationEvidenceProjections,
  teamRecommendationEvidenceProjectionsForBatchSizes,
  teamRecommendationEvidenceQuestionMessage,
};

export type { TeamEvidenceProjection, TeamRecommendationEvidence };
