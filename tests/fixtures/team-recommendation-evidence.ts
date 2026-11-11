import { teamRecommendationResultSchema } from "../../src/team-data/recommendation-result.js";
import type { RecommendTeamPlayerCandidatesInput } from "../../src/tools/recommend-team-player-candidates.js";
import {
  recommendationResultData,
  teamRecommendationResult,
} from "./workflow-results.js";

const firstRosterFmId = "roster-fm-1";
const secondRosterFmId = "roster-fm-2";
const rosterFmIds = [firstRosterFmId, secondRosterFmId];
const firstRosterPlayerName = "Roster Player 1";
const secondRosterPlayerName = "Roster Player 2";

const candidate = (list: "current" | "potential", index: number) => ({
  age: list === "current" && index === 5 ? null : 18 + index,
  attributes: [
    {
      attribute: "pace",
      candidateValue: 60 + index,
      difference: index / 10,
      referenceMean: 59 + index,
    },
  ],
  currentAbility: list === "current" && index === 5 ? null : 120 + index,
  currentDistance: Math.round((0.2 + index / 10) * 10) / 10,
  fmId: `fm-${list}-${index}`,
  name: `${list === "current" ? "Current" : "Potential"} Prospect ${index}`,
  positionRating: 18 + index,
  potentialAbility: list === "current" && index === 5 ? null : 150 + index,
  rank: index,
  sourceRecordId: `fm-record-${list}-${index}`,
});

const recommendationInput = (
  includePotential: boolean
): RecommendTeamPlayerCandidatesInput => {
  const team = { country: "England", id: 42, name: "Synthetic FC" };

  return {
    includePotential,
    maxAge: 24,
    minimumCurrentAbility: 125,
    minimumPotentialAbility: includePotential ? 155 : null,
    position: "stc",
    referenceFmIds: rosterFmIds,
    referenceMode: "squad",
    resultLimit: 20,
    roster: {
      members: [
        {
          apiFootballPlayerId: 11,
          fmCandidates: [],
          fmId: firstRosterFmId,
          mappingMethod: "reep_bridge",
          mappingStatus: "resolved",
          name: firstRosterPlayerName,
          position: "STC",
        },
        {
          apiFootballPlayerId: 12,
          fmCandidates: [],
          fmId: secondRosterFmId,
          mappingMethod: "user_confirmation",
          mappingStatus: "resolved",
          name: secondRosterPlayerName,
          position: "STC",
        },
      ],
      retrievedAt: "2026-10-26T10:00:00.000Z",
      team,
    },
    team,
  };
};

const teamResultJson = (
  includePotential: boolean,
  includeExcludedCandidate = false
) => {
  const input = recommendationInput(includePotential);

  const currentCandidates = Array.from({ length: 5 }, (_unused, index) => {
    const currentCandidate = candidate("current", index + 1);

    return includeExcludedCandidate && index === 0
      ? { ...currentCandidate, fmId: firstRosterFmId }
      : currentCandidate;
  });

  const potentialCandidates = includePotential
    ? Array.from({ length: 4 }, (_unused, index) =>
        candidate("potential", index + 1)
      )
    : null;

  const recommendation = recommendationResultData("ready", input.position, {
    currentCandidates,
    filterCounts: {
      afterAge: 19,
      afterCurrentAbility: 17,
      afterIdentityExclusion: 15,
      afterPotentialAbility: 11,
      currentAttributeComplete: 28,
      eligiblePositionProfiles: 30,
      excludedMissingAttribute: 2,
      excludedMissingFmIdCandidates: 1,
      excludedMissingPotentialForPotentialList: 4,
    },
    filters: {
      includePotential,
      maxAge: 24,
      minimumCurrentAbility: 125,
      minimumPotentialAbility: includePotential ? 155 : null,
      resultLimit: 20,
    },
    potentialCandidates,
    referenceFmIds: input.referenceFmIds,
    referenceMeanAttributes: { finishingRaw: 67.5, paceRaw: 71.25 },
    references: [
      {
        currentAbility: 140,
        fmId: firstRosterFmId,
        name: firstRosterPlayerName,
        positionRating: 20,
        potentialAbility: 175,
        sourceRecordId: "roster-record-1",
      },
      {
        currentAbility: 138,
        fmId: secondRosterFmId,
        name: secondRosterPlayerName,
        positionRating: 19,
        potentialAbility: 172,
        sourceRecordId: "roster-record-2",
      },
    ],
  });

  const base = teamRecommendationResultSchema.parse(
    JSON.parse(
      teamRecommendationResult("ready", input, {
        ...recommendation,
        currentCandidates,
        potentialCandidates,
      })
    )
  );

  return JSON.stringify({
    ...base,
    exclusionScope: {
      currentRosterMembers: [
        {
          apiFootballPlayerId: 11,
          fmId: firstRosterFmId,
          mappingMethod: "reep_bridge",
        },
        {
          apiFootballPlayerId: 12,
          fmId: secondRosterFmId,
          mappingMethod: "user_confirmation",
        },
      ],
      effectiveExcludedFmIds: [
        firstRosterFmId,
        secondRosterFmId,
        "linked-roster-fm-1",
        "linked-roster-fm-2",
      ],
    },
  });
};

const emptyTeamResultJson = () => {
  const input = recommendationInput(false);

  const recommendation = recommendationResultData("no_candidates", "stc", {
    currentCandidates: [],
    filters: {
      includePotential: false,
      maxAge: 24,
      minimumCurrentAbility: 125,
      minimumPotentialAbility: null,
      resultLimit: 20,
    },
    potentialCandidates: null,
    referenceFmIds: input.referenceFmIds,
    references: [
      {
        currentAbility: 140,
        fmId: firstRosterFmId,
        name: firstRosterPlayerName,
        positionRating: 20,
        potentialAbility: 175,
        sourceRecordId: "roster-record-1",
      },
      {
        currentAbility: 138,
        fmId: secondRosterFmId,
        name: secondRosterPlayerName,
        positionRating: 19,
        potentialAbility: 172,
        sourceRecordId: "roster-record-2",
      },
    ],
  });

  const base = teamRecommendationResultSchema.parse(
    JSON.parse(teamRecommendationResult("no_candidates", input, recommendation))
  );

  return JSON.stringify({
    ...base,
    exclusionScope: {
      currentRosterMembers: [
        {
          apiFootballPlayerId: 11,
          fmId: firstRosterFmId,
          mappingMethod: "reep_bridge",
        },
        {
          apiFootballPlayerId: 12,
          fmId: secondRosterFmId,
          mappingMethod: "user_confirmation",
        },
      ],
      effectiveExcludedFmIds: rosterFmIds,
    },
  });
};

const teamRecommendationEvidenceFixture = () => ({
  emptyResultJson: emptyTeamResultJson(),
  excludedCandidateResultJson: teamResultJson(true, true),
  resultJson: teamResultJson(true),
});

export { teamRecommendationEvidenceFixture };
