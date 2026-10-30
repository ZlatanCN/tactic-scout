import type { RecommendationResult } from "../../src/player-data/recommend-players.js";
import { teamRosterCoverage } from "../../src/team-data/roster-coverage.js";
import type { RecommendTeamPlayerCandidatesInput } from "../../src/tools/recommend-team-player-candidates.js";

type RecommendationSuccess = Extract<
  RecommendationResult,
  { status: "ready" | "no_candidates" }
>;

type RecommendationOverrides = Partial<
  Omit<RecommendationSuccess, "position" | "status">
>;

const fixtureSnapshotDate = "2025-11-23";
const apiFootballSource = "API-Football" as const;

const recommendationResultData = (
  status: "ready" | "no_candidates",
  position = "stc",
  overrides: RecommendationOverrides = {}
): RecommendationSuccess => {
  const filters = {
    includePotential: false,
    maxAge: null,
    minimumCurrentAbility: null,
    minimumPotentialAbility: null,
    resultLimit: 5,
    ...overrides.filters,
  };

  return {
    currentCandidates:
      status === "ready"
        ? [
            {
              age: 24,
              attributes: [],
              currentAbility: 140,
              currentDistance: 0.5,
              fmId: "test-candidate",
              name: "Test Candidate",
              positionRating: 20,
              potentialAbility: 160,
              rank: 1,
              sourceRecordId: "test-candidate-record",
            },
          ]
        : [],
    filterCounts: {
      afterAge: 0,
      afterCurrentAbility: 0,
      afterIdentityExclusion: 0,
      afterPotentialAbility: 0,
      currentAttributeComplete: 0,
      eligiblePositionProfiles: 0,
      excludedMissingAttribute: 0,
      excludedMissingFmIdCandidates: 0,
      excludedMissingPotentialForPotentialList: 0,
    },
    formula: "rmse",
    gameBuild: "test-build",
    manifestSha256: "test-manifest",
    positionFeatureMapSha256: "test-position-map",
    positionFeatureSetVersion: "test-position-features",
    potentialCandidates: filters.includePotential ? [] : null,
    referenceFmIds: ["test-reference"],
    referenceMeanAttributes: {},
    references: [
      {
        currentAbility: 140,
        fmId: "test-reference",
        name: "Test Reference",
        positionRating: 20,
        potentialAbility: 160,
        sourceRecordId: "test-reference-record",
      },
    ],
    snapshotDate: fixtureSnapshotDate,
    strategyVersion: "test-strategy",
    ...overrides,
    filters,
    position,
    status,
  };
};

const recommendationResult = (
  status: "ready" | "no_candidates",
  position = "stc",
  overrides: RecommendationOverrides = {}
) => JSON.stringify(recommendationResultData(status, position, overrides));

const teamRecommendationResult = (
  status: "ready" | "no_candidates",
  input: RecommendTeamPlayerCandidatesInput,
  recommendationOverrides: RecommendationOverrides = {}
) => {
  const nestedRecommendationOverrides: RecommendationOverrides = {
    ...recommendationOverrides,
    filters: recommendationOverrides.filters ?? {
      includePotential: input.includePotential,
      maxAge: input.maxAge,
      minimumCurrentAbility: input.minimumCurrentAbility,
      minimumPotentialAbility: input.minimumPotentialAbility,
      resultLimit: input.resultLimit ?? 5,
    },
    referenceFmIds:
      recommendationOverrides.referenceFmIds ?? input.referenceFmIds,
  };

  return JSON.stringify({
    filters: {
      includePotential: input.includePotential,
      maxAge: input.maxAge,
      minimumCurrentAbility: input.minimumCurrentAbility,
      minimumPotentialAbility: input.minimumPotentialAbility,
      resultLimit: input.resultLimit ?? 5,
    },
    fmSnapshotDate: fixtureSnapshotDate,
    position: input.position,
    rankingBasis:
      input.referenceMode === "squad"
        ? "equal_weight_mean_of_position_capable_squad_profiles"
        : "named_fm_reference_profile",
    recommendation: recommendationResultData(
      status,
      input.position,
      nestedRecommendationOverrides
    ),
    referenceFmIds: input.referenceFmIds,
    roster: {
      ...teamRosterCoverage(input.roster),
      retrievedAt: input.roster.retrievedAt,
      source: apiFootballSource,
    },
    status,
    team: input.team,
  });
};

const teamPositionUnavailableResult = (
  input: RecommendTeamPlayerCandidatesInput
) =>
  JSON.stringify({
    filters: {
      includePotential: input.includePotential,
      maxAge: input.maxAge,
      minimumCurrentAbility: input.minimumCurrentAbility,
      minimumPotentialAbility: input.minimumPotentialAbility,
      resultLimit: input.resultLimit ?? 5,
    },
    fmSnapshotDate: fixtureSnapshotDate,
    position: input.position,
    rankingBasis:
      input.referenceMode === "squad"
        ? "equal_weight_mean_of_position_capable_squad_profiles"
        : "named_fm_reference_profile",
    referenceFmIds: [],
    roster: {
      ...teamRosterCoverage(input.roster),
      retrievedAt: input.roster.retrievedAt,
      source: apiFootballSource,
    },
    status: "team_position_unavailable",
    team: input.team,
  });

const teamRecommendationFailureResult = (
  input: RecommendTeamPlayerCandidatesInput
) => {
  const recommendation = {
    reason: "Test fixture provider data is unavailable.",
    status: "data_unavailable" as const,
  };

  return JSON.stringify({
    filters: {
      includePotential: input.includePotential,
      maxAge: input.maxAge,
      minimumCurrentAbility: input.minimumCurrentAbility,
      minimumPotentialAbility: input.minimumPotentialAbility,
      resultLimit: input.resultLimit ?? 5,
    },
    fmSnapshotDate: null,
    position: input.position,
    rankingBasis:
      input.referenceMode === "squad"
        ? "equal_weight_mean_of_position_capable_squad_profiles"
        : "named_fm_reference_profile",
    recommendation,
    referenceFmIds: input.referenceFmIds,
    roster: {
      ...teamRosterCoverage(input.roster),
      retrievedAt: input.roster.retrievedAt,
      source: apiFootballSource,
    },
    status: "data_unavailable",
    team: input.team,
  });
};

const comparisonResult = (
  playerNames: string[],
  status: "ready" | "no_comparable_data" = "no_comparable_data"
) =>
  JSON.stringify({
    coverage: {
      commonUnderstatScopeCount: 0,
      fmPlayerCount: 0,
      hasFmRecords: false,
      hasUnderstatRecords: false,
      playerCount: playerNames.length,
    },
    players: playerNames.map((playerName) => ({
      fm: null,
      playerName,
      understat: null,
    })),
    status,
    understatScopeGroups: [],
  });

export {
  comparisonResult,
  recommendationResult,
  recommendationResultData,
  teamPositionUnavailableResult,
  teamRecommendationFailureResult,
  teamRecommendationResult,
};
