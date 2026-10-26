import type {
  FmRecommendationProfile,
  FmRecommendationReferenceMetadata,
  FmRecommendationReadResult,
} from "./football-manager.js";
import {
  getPositionFeatureDefinition,
  isSupportedPosition,
  positionFeatureMapSha256,
  positionFeatureSetVersion,
  recommendationStrategyVersion,
} from "./position-features.js";

type RecommendationRequest = {
  excludeFmIds?: string[];
  includePotential?: boolean;
  maxAge?: number | null;
  minimumCurrentAbility?: number | null;
  minimumPotentialAbility?: number | null;
  position: string;
  referenceFmIds: string[];
  resultLimit?: number;
};

type RecommendationAttributeDifference = {
  attribute: string;
  candidateValue: number;
  difference: number;
  referenceMean: number;
};

type RecommendationCandidate = {
  age: number | null;
  attributes: RecommendationAttributeDifference[];
  currentAbility: number | null;
  currentDistance: number;
  fmId: string;
  name: string;
  positionRating: number;
  potentialAbility: number | null;
  rank: number;
  sourceRecordId: string;
};

type RecommendationReference = {
  currentAbility: number | null;
  fmId: string;
  name: string;
  positionRating: number;
  potentialAbility: number | null;
  sourceRecordId: string;
};

type RecommendationFilterCounts = {
  afterAge: number;
  afterCurrentAbility: number;
  afterIdentityExclusion: number;
  afterPotentialAbility: number;
  currentAttributeComplete: number;
  eligiblePositionProfiles: number;
  excludedMissingAttribute: number;
  excludedMissingFmIdCandidates: number;
  excludedMissingPotentialForPotentialList: number;
};

type RecommendationFailure =
  | {
      missingReferenceFmIds: string[];
      position: string;
      status: "insufficient_reference_data";
    }
  | {
      position: string;
      references: RecommendationReference[];
      status: "reference_not_position_capable";
    }
  | {
      position: string;
      reason: string;
      status: "invalid_constraint";
    }
  | {
      position: string;
      reason: string;
      status: "unsupported_position";
    }
  | {
      reason: string;
      status: "data_unavailable";
    };

type RecommendationResult =
  | {
      currentCandidates: RecommendationCandidate[];
      filterCounts: RecommendationFilterCounts;
      filters: {
        maxAge: number | null;
        minimumCurrentAbility: number | null;
        minimumPotentialAbility: number | null;
        resultLimit: number;
      };
      formula: "rmse";
      gameBuild: string;
      manifestSha256: string;
      position: string;
      positionFeatureMapSha256: string;
      positionFeatureSetVersion: string;
      potentialCandidates: RecommendationCandidate[] | null;
      referenceFmIds: string[];
      referenceMeanAttributes: Record<string, number>;
      references: RecommendationReference[];
      snapshotDate: string;
      status: "ready" | "no_candidates";
      strategyVersion: string;
    }
  | RecommendationFailure;

type RecommendationPositionResolution =
  | { position: string; status: "selected" }
  | {
      commonPositions: string[];
      positionOptions: string[];
      status: "position_required";
    }
  | { position: string; status: "unsupported_position" };

type TeamRecommendationCalculation =
  | {
      recommendation: RecommendationResult;
      referenceFmIds: string[];
      status: "calculated";
    }
  | {
      position: string;
      snapshotDate: string;
      status: "team_position_unavailable";
    };

type NormalizedRequest = {
  excludeFmIds: string[];
  includePotential: boolean;
  maxAge: number | null;
  minimumCurrentAbility: number | null;
  minimumPotentialAbility: number | null;
  position: string;
  referenceFmIds: string[];
  resultLimit: number;
};

type RequestNormalization =
  | { error: RecommendationFailure; request: null }
  | { error: null; request: NormalizedRequest };

type ReferenceResolution =
  | { error: RecommendationFailure; meanAttributes: null; references: null }
  | {
      error: null;
      meanAttributes: Record<string, number>;
      references: FmRecommendationProfile[];
    };

type RankedProfile = {
  age: number | null;
  attributes: RecommendationAttributeDifference[];
  currentAbility: number | null;
  currentDistance: number;
  fmId: string;
  name: string;
  positionRating: number;
  potentialAbility: number | null;
  sourceRecordId: string;
};

type FilteredCandidates = {
  afterAge: FmRecommendationProfile[];
  afterCurrentAbility: FmRecommendationProfile[];
  afterIdentityExclusion: FmRecommendationProfile[];
  afterPotentialAbility: FmRecommendationProfile[];
  positionEligible: FmRecommendationProfile[];
};

type RankedCandidates = {
  completeProfiles: RankedProfile[];
  currentCandidates: RecommendationCandidate[];
  potentialCompleteCount: number | null;
  potentialCandidates: RecommendationCandidate[] | null;
};

const validBoundedInteger = (
  value: number | null | undefined,
  minimum: number,
  maximum: number
): boolean => {
  if (value === null || value === undefined) {
    return true;
  }

  return Number.isInteger(value) && value >= minimum && value <= maximum;
};

const uniqueIds = (values: string[]): string[] => {
  const unique = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();

    if (trimmed.length > 0) {
      unique.add(trimmed);
    }
  }

  return [...unique];
};

const ageParts = (value: string | null): Date | null => {
  if (value === null) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    return null;
  }

  return parsed;
};

const ageOnSnapshot = (
  birthDate: string | null,
  snapshotDate: string
): number | null => {
  const birth = ageParts(birthDate);
  const snapshot = ageParts(snapshotDate);

  if (birth === null || snapshot === null) {
    return null;
  }

  const birthdayHasNotPassed =
    snapshot.getUTCMonth() < birth.getUTCMonth() ||
    (snapshot.getUTCMonth() === birth.getUTCMonth() &&
      snapshot.getUTCDate() < birth.getUTCDate());

  return (
    snapshot.getUTCFullYear() -
    birth.getUTCFullYear() -
    Number(birthdayHasNotPassed)
  );
};

const referenceSummary = (
  reference: FmRecommendationProfile
): RecommendationReference => ({
  currentAbility: reference.currentAbility,
  fmId: reference.fmId,
  name: reference.name,
  positionRating: reference.positionRating ?? 0,
  potentialAbility: reference.potentialAbility,
  sourceRecordId: reference.sourceRecordId,
});

const isValidRawAttribute = (value: number | null | undefined): boolean => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return false;
  }

  return value >= 1 && value <= 100;
};

const missingFeatures = (
  profile: FmRecommendationProfile,
  features: readonly string[]
): string[] =>
  features.filter(
    (feature) => !isValidRawAttribute(profile.attributes[feature])
  );

const resolveReferences = (
  request: NormalizedRequest,
  source: Extract<FmRecommendationReadResult, { status: "ready" }>,
  features: readonly string[]
): ReferenceResolution => {
  const referencesById = new Map(
    source.references.map((reference) => [reference.fmId, reference])
  );

  const missingIds = request.referenceFmIds.filter(
    (fmId) => !referencesById.has(fmId)
  );

  if (missingIds.length > 0) {
    return {
      error: {
        missingReferenceFmIds: missingIds,
        position: request.position,
        status: "insufficient_reference_data",
      },
      meanAttributes: null,
      references: null,
    };
  }

  const references = request.referenceFmIds.flatMap((fmId) => {
    const reference = referencesById.get(fmId);

    return reference === undefined ? [] : [reference];
  });

  const unqualifiedReferences = references.filter(
    (reference) =>
      reference.positionRating === null || reference.positionRating < 15
  );

  if (unqualifiedReferences.length > 0) {
    return {
      error: {
        position: request.position,
        references: unqualifiedReferences.map(referenceSummary),
        status: "reference_not_position_capable",
      },
      meanAttributes: null,
      references: null,
    };
  }

  const invalidReferences = references.filter(
    (reference) => missingFeatures(reference, features).length > 0
  );

  if (invalidReferences.length > 0) {
    return {
      error: {
        missingReferenceFmIds: invalidReferences.map(
          (reference) => reference.fmId
        ),
        position: request.position,
        status: "insufficient_reference_data",
      },
      meanAttributes: null,
      references: null,
    };
  }

  const meanAttributes = Object.fromEntries(
    features.map((feature) => {
      const featureValues = references.map(
        (reference) => reference.attributes[feature]
      );

      const total = featureValues.reduce<number>(
        (sum, value) => sum + (value ?? 0),
        0
      );

      return [feature, total / featureValues.length];
    })
  );

  return { error: null, meanAttributes, references };
};

const filterCandidates = (
  profiles: FmRecommendationProfile[],
  request: NormalizedRequest,
  snapshotDate: string
): FilteredCandidates => {
  const positionEligible = profiles.filter(
    (profile) => profile.positionRating !== null && profile.positionRating >= 15
  );

  const afterAge = positionEligible.filter((profile) => {
    if (request.maxAge === null) {
      return true;
    }

    const age = ageOnSnapshot(profile.birthDate, snapshotDate);

    return age !== null && age <= request.maxAge;
  });

  const afterCurrentAbility = afterAge.filter((profile) => {
    if (request.minimumCurrentAbility === null) {
      return true;
    }

    return (
      profile.currentAbility !== null &&
      profile.currentAbility >= request.minimumCurrentAbility
    );
  });

  const afterPotentialAbility = afterCurrentAbility.filter((profile) => {
    if (request.minimumPotentialAbility === null) {
      return true;
    }

    return (
      profile.potentialAbility !== null &&
      profile.potentialAbility >= request.minimumPotentialAbility
    );
  });

  const excludedIds = new Set([
    ...request.referenceFmIds,
    ...request.excludeFmIds,
  ]);

  const afterIdentityExclusion = afterPotentialAbility.filter(
    (profile) => !excludedIds.has(profile.fmId)
  );

  return {
    afterAge,
    afterCurrentAbility,
    afterIdentityExclusion,
    afterPotentialAbility,
    positionEligible,
  };
};

const candidateFromProfile = (
  profile: FmRecommendationProfile,
  snapshotDate: string,
  features: readonly string[],
  referenceMean: Record<string, number>
): RankedProfile | null => {
  if (missingFeatures(profile, features).length > 0) {
    return null;
  }

  const attributes = features.map((attribute) => {
    const referenceValue = referenceMean[attribute];
    const candidateValue = profile.attributes[attribute];

    if (
      referenceValue === undefined ||
      candidateValue === null ||
      candidateValue === undefined
    ) {
      throw new Error(
        "Recommendation feature map produced an incomplete profile."
      );
    }

    return {
      attribute,
      candidateValue,
      difference: candidateValue - referenceValue,
      referenceMean: referenceValue,
    };
  });

  const meanSquareError =
    attributes.reduce((sum, attribute) => sum + attribute.difference ** 2, 0) /
    attributes.length;

  return {
    age: ageOnSnapshot(profile.birthDate, snapshotDate),
    attributes,
    currentAbility: profile.currentAbility,
    currentDistance: Math.sqrt(meanSquareError),
    fmId: profile.fmId,
    name: profile.name,
    positionRating: profile.positionRating ?? 0,
    potentialAbility: profile.potentialAbility,
    sourceRecordId: profile.sourceRecordId,
  };
};

const compareFmIds = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
};

const compareCurrentDistance = (
  left: RankedProfile,
  right: RankedProfile
): number => {
  const distanceDifference = left.currentDistance - right.currentDistance;

  if (distanceDifference !== 0) {
    return distanceDifference;
  }

  return compareFmIds(left.fmId, right.fmId);
};

const comparePotential = (
  left: RankedProfile,
  right: RankedProfile
): number => {
  const potentialDifference =
    (right.potentialAbility ?? 0) - (left.potentialAbility ?? 0);

  if (potentialDifference !== 0) {
    return potentialDifference;
  }

  return compareCurrentDistance(left, right);
};

const withRank = (
  profiles: RankedProfile[],
  resultLimit: number
): RecommendationCandidate[] =>
  profiles.slice(0, resultLimit).map((profile, index) => ({
    ...profile,
    rank: index + 1,
  }));

const invalidConstraintResult = (
  position: string,
  reason: string
): RecommendationFailure => ({
  position,
  reason,
  status: "invalid_constraint",
});

const positionsFromNaturalField = (naturalPositions: string | null): string[] =>
  uniqueIds(
    (naturalPositions ?? "")
      .split(";")
      .map((position) => position.trim().toLocaleLowerCase())
  );

const resolveRecommendationPosition = (
  explicitPosition: string | null,
  referenceProfiles: FmRecommendationReferenceMetadata[]
): RecommendationPositionResolution => {
  if (explicitPosition !== null) {
    if (isSupportedPosition(explicitPosition)) {
      return { position: explicitPosition, status: "selected" };
    }

    return { position: explicitPosition, status: "unsupported_position" };
  }

  if (referenceProfiles.length === 0) {
    return {
      commonPositions: [],
      positionOptions: [],
      status: "position_required",
    };
  }

  const positionSets = referenceProfiles.map(
    (reference) =>
      new Set(positionsFromNaturalField(reference.naturalPositions))
  );

  const firstPositions = [...(positionSets[0] ?? [])];

  const commonPositions = firstPositions.filter((position) =>
    positionSets.every((positions) => positions.has(position))
  );

  if (commonPositions.length === 1) {
    const [position] = commonPositions;

    if (position !== undefined && isSupportedPosition(position)) {
      return { position, status: "selected" };
    }

    return { position: position ?? "", status: "unsupported_position" };
  }

  const possiblePositions =
    commonPositions.length > 0
      ? commonPositions
      : [...new Set(positionSets.flatMap((positions) => [...positions]))];

  const positionOptions = possiblePositions
    .filter(isSupportedPosition)
    .toSorted(compareFmIds);

  return {
    commonPositions: commonPositions.toSorted(compareFmIds),
    positionOptions,
    status: "position_required",
  };
};

const rankCandidates = (
  profiles: FmRecommendationProfile[],
  snapshotDate: string,
  features: readonly string[],
  referenceMean: Record<string, number>,
  request: NormalizedRequest
): RankedCandidates => {
  const completeProfiles = profiles.flatMap((profile) => {
    const candidate = candidateFromProfile(
      profile,
      snapshotDate,
      features,
      referenceMean
    );

    return candidate === null ? [] : [candidate];
  });

  const currentProfiles = completeProfiles.toSorted(compareCurrentDistance);

  const potentialProfiles = request.includePotential
    ? completeProfiles
        .filter((profile) => profile.potentialAbility !== null)
        .toSorted(comparePotential)
    : null;

  return {
    completeProfiles,
    currentCandidates: withRank(currentProfiles, request.resultLimit),
    potentialCandidates:
      potentialProfiles === null
        ? null
        : withRank(potentialProfiles, request.resultLimit),
    potentialCompleteCount: potentialProfiles?.length ?? null,
  };
};

const normalizeRequest = (
  request: RecommendationRequest
): RequestNormalization => {
  const normalized: NormalizedRequest = {
    excludeFmIds: uniqueIds(request.excludeFmIds ?? []),
    includePotential: request.includePotential === true,
    maxAge: request.maxAge ?? null,
    minimumCurrentAbility: request.minimumCurrentAbility ?? null,
    minimumPotentialAbility: request.minimumPotentialAbility ?? null,
    position: request.position,
    referenceFmIds: uniqueIds(request.referenceFmIds),
    resultLimit: request.resultLimit ?? 5,
  };

  if (!validBoundedInteger(normalized.maxAge, 1, 120)) {
    return {
      error: invalidConstraintResult(
        request.position,
        "最大年龄必须是 1 到 120 的整数。"
      ),
      request: null,
    };
  }

  if (!validBoundedInteger(normalized.minimumCurrentAbility, 1, 200)) {
    return {
      error: invalidConstraintResult(
        request.position,
        "CA 下限必须是 1 到 200 的整数。"
      ),
      request: null,
    };
  }

  if (!validBoundedInteger(normalized.minimumPotentialAbility, 1, 200)) {
    return {
      error: invalidConstraintResult(
        request.position,
        "PA 下限必须是 1 到 200 的整数。"
      ),
      request: null,
    };
  }

  if (
    !Number.isInteger(normalized.resultLimit) ||
    normalized.resultLimit < 1 ||
    normalized.resultLimit > 20
  ) {
    return {
      error: invalidConstraintResult(
        request.position,
        "结果数必须是 1 到 20 的整数。"
      ),
      request: null,
    };
  }

  if (normalized.referenceFmIds.length === 0) {
    return {
      error: {
        missingReferenceFmIds: [],
        position: request.position,
        status: "insufficient_reference_data",
      },
      request: null,
    };
  }

  return { error: null, request: normalized };
};

const makeFilterCounts = (
  filtered: FilteredCandidates,
  completeCount: number,
  source: Extract<FmRecommendationReadResult, { status: "ready" }>,
  potentialCount: number | null
): RecommendationFilterCounts => ({
  afterAge: filtered.afterAge.length,
  afterCurrentAbility: filtered.afterCurrentAbility.length,
  afterIdentityExclusion: filtered.afterIdentityExclusion.length,
  afterPotentialAbility: filtered.afterPotentialAbility.length,
  currentAttributeComplete: completeCount,
  eligiblePositionProfiles: filtered.positionEligible.length,
  excludedMissingAttribute:
    filtered.afterIdentityExclusion.length - completeCount,
  excludedMissingFmIdCandidates: source.excludedMissingFmIdCandidates,
  excludedMissingPotentialForPotentialList:
    potentialCount === null ? 0 : completeCount - potentialCount,
});

const recommendationFailureFromSource = (
  source: Exclude<FmRecommendationReadResult, { status: "ready" }>
): RecommendationFailure => {
  if (source.status === "unavailable") {
    return { reason: source.reason, status: "data_unavailable" };
  }

  return {
    position: source.position,
    reason: source.reason,
    status: "unsupported_position",
  };
};

const recommendPlayers = (
  request: RecommendationRequest,
  source: FmRecommendationReadResult
): RecommendationResult => {
  const normalized = normalizeRequest(request);

  if (normalized.error !== null) {
    return normalized.error;
  }

  const normalizedRequest = normalized.request;

  if (!isSupportedPosition(normalizedRequest.position)) {
    return {
      position: normalizedRequest.position,
      reason: "该位置没有可运行的本地属性映射或候选数据。",
      status: "unsupported_position",
    };
  }

  if (source.status !== "ready") {
    return recommendationFailureFromSource(source);
  }

  if (source.position !== normalizedRequest.position) {
    return invalidConstraintResult(
      normalizedRequest.position,
      "读取的候选位置与请求位置不一致。"
    );
  }

  const featureDefinition = getPositionFeatureDefinition(
    normalizedRequest.position
  );

  const referenceResolution = resolveReferences(
    normalizedRequest,
    source,
    featureDefinition.features
  );

  if (referenceResolution.error !== null) {
    return referenceResolution.error;
  }

  const filtered = filterCandidates(
    source.profiles,
    normalizedRequest,
    source.snapshotDate
  );

  const ranked = rankCandidates(
    filtered.afterIdentityExclusion,
    source.snapshotDate,
    featureDefinition.features,
    referenceResolution.meanAttributes,
    normalizedRequest
  );

  const filterCounts = makeFilterCounts(
    filtered,
    ranked.completeProfiles.length,
    source,
    ranked.potentialCompleteCount
  );

  const hasAnyCandidates =
    ranked.currentCandidates.length > 0 ||
    (ranked.potentialCandidates !== null &&
      ranked.potentialCandidates.length > 0);

  return {
    currentCandidates: ranked.currentCandidates,
    filterCounts,
    filters: {
      maxAge: normalizedRequest.maxAge,
      minimumCurrentAbility: normalizedRequest.minimumCurrentAbility,
      minimumPotentialAbility: normalizedRequest.minimumPotentialAbility,
      resultLimit: normalizedRequest.resultLimit,
    },
    formula: "rmse",
    gameBuild: source.gameBuild,
    manifestSha256: source.manifestSha256,
    position: normalizedRequest.position,
    positionFeatureMapSha256,
    positionFeatureSetVersion,
    potentialCandidates: ranked.potentialCandidates,
    referenceFmIds: normalizedRequest.referenceFmIds,
    referenceMeanAttributes: referenceResolution.meanAttributes,
    references: referenceResolution.references.map(referenceSummary),
    snapshotDate: source.snapshotDate,
    status: hasAnyCandidates ? "ready" : "no_candidates",
    strategyVersion: recommendationStrategyVersion,
  };
};

const recommendTeamPlayers = (
  request: RecommendationRequest,
  source: FmRecommendationReadResult
): TeamRecommendationCalculation => {
  if (source.status !== "ready" || !isSupportedPosition(request.position)) {
    return {
      recommendation: recommendPlayers(request, source),
      referenceFmIds: request.referenceFmIds,
      status: "calculated",
    };
  }

  const { features } = getPositionFeatureDefinition(request.position);

  const references = source.references.filter(
    (profile) =>
      profile.positionRating !== null &&
      profile.positionRating >= 15 &&
      features.every((feature) => {
        const value = profile.attributes[feature];

        return value !== null && value !== undefined && Number.isFinite(value);
      })
  );

  const referenceFmIds = references
    .map((profile) => profile.fmId)
    .toSorted(compareFmIds);

  if (referenceFmIds.length === 0) {
    return {
      position: request.position,
      snapshotDate: source.snapshotDate,
      status: "team_position_unavailable",
    };
  }

  const recommendation = recommendPlayers(
    { ...request, referenceFmIds },
    { ...source, references }
  );

  return { recommendation, referenceFmIds, status: "calculated" };
};

export { recommendPlayers, resolveRecommendationPosition };

export { recommendTeamPlayers };

export type {
  RecommendationAttributeDifference,
  RecommendationCandidate,
  RecommendationFailure,
  RecommendationFilterCounts,
  RecommendationReference,
  RecommendationPositionResolution,
  RecommendationRequest,
  RecommendationResult,
  TeamRecommendationCalculation,
};
