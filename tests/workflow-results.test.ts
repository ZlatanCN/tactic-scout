import { describe, expect, it } from "vitest";

import {
  completedComparisonResultSchema,
  comparisonResultSchema,
} from "../src/player-data/compare-records.js";
import { recommendationResultSchema } from "../src/player-data/recommend-players.js";
import { searchPlayerRecordsResultSchema } from "../src/player-data/search-records.js";
import { TurnOutcomeSchema } from "../src/state.js";
import { teamRecommendationResultSchema } from "../src/team-data/recommendation-result.js";
import { recommendationToolResultSchema } from "../src/tools/recommend-player-candidates.js";
import { decodeResultJson } from "../src/workflow-results.js";
import {
  comparisonResult,
  recommendationResult,
  recommendationResultData,
  teamRecommendationResult,
} from "./fixtures/workflow-results.js";

const teamInput = {
  includePotential: false,
  maxAge: null,
  minimumCurrentAbility: null,
  minimumPotentialAbility: null,
  position: "stc",
  referenceFmIds: ["fm-reference"],
  referenceMode: "squad" as const,
  resultLimit: 5,
  roster: {
    members: [],
    retrievedAt: "2026-10-26T10:00:00.000Z",
    team: { country: "England", id: 42, name: "Arsenal" },
  },
  team: { country: "England", id: 42, name: "Arsenal" },
};

describe("workflow result contracts", () => {
  it("rejects status-only results for every completed workflow", () => {
    expect(
      searchPlayerRecordsResultSchema.safeParse({ status: "found" }).success
    ).toBeFalsy();
    expect(
      comparisonResultSchema.safeParse({ status: "ready" }).success
    ).toBeFalsy();
    expect(
      recommendationResultSchema.safeParse({ status: "ready" }).success
    ).toBeFalsy();
    expect(
      recommendationToolResultSchema.safeParse({ status: "ready" }).success
    ).toBeFalsy();
    expect(
      teamRecommendationResultSchema.safeParse({ status: "ready" }).success
    ).toBeFalsy();
  });

  it("rejects a lookup result missing one of its queried providers", () => {
    const result = {
      fm: { records: [], status: "not_found" },
      identityGroups: {
        canonicalGroups: [],
        registryStatus: "not_needed",
        unlinkedRecords: [],
      },
      query: [
        { provider: "fm", sourceId: "fm-demo" },
        { provider: "understat", sourceId: "us-demo" },
      ],
      requestedUnderstatSeasonStartYear: null,
    };

    expect(
      searchPlayerRecordsResultSchema.safeParse(result).success
    ).toBeFalsy();
  });

  it("requires season metadata for Understat queries and an empty query for missing source IDs", () => {
    const identityGroups = {
      canonicalGroups: [],
      registryStatus: "not_needed",
      unlinkedRecords: [],
    };

    const missingUnderstatSeason = {
      identityGroups,
      query: [{ provider: "understat", sourceId: "us-demo" }],
      understat: { records: [], status: "not_found" },
    };

    const contradictoryNoIds = {
      query: [{ provider: "fm", sourceId: "fm-demo" }],
      result: "no_confirmed_source_ids",
    };

    expect(
      searchPlayerRecordsResultSchema.safeParse(missingUnderstatSeason).success
    ).toBeFalsy();
    expect(
      searchPlayerRecordsResultSchema.safeParse(contradictoryNoIds).success
    ).toBeFalsy();
  });

  it("rejects mismatched lookup outcome source and status", () => {
    expect(
      TurnOutcomeSchema.safeParse({
        kind: "player_lookup",
        resultJson: "{}",
        source: "saved",
        status: "data_ready",
      }).success
    ).toBeFalsy();
    expect(
      TurnOutcomeSchema.safeParse({
        kind: "player_lookup",
        resultJson: "{}",
        source: "executed",
        status: "lookup_follow_up",
      }).success
    ).toBeFalsy();
  });

  it("normalizes complete results before they enter the state", () => {
    const original = recommendationResult("no_candidates");
    const decoded = decodeResultJson(original, recommendationToolResultSchema);

    expect(decoded.resultJson).toBe(JSON.stringify(decoded.data));
    expect(decoded.data.status).toBe("no_candidates");
  });

  it("rejects recommendation statuses that contradict candidate lists", () => {
    const emptyReady = recommendationResultData("ready", "stc", {
      currentCandidates: [],
      potentialCandidates: null,
    });

    const [candidate] = recommendationResultData("ready").currentCandidates;

    if (candidate === undefined) {
      throw new Error("Expected a candidate fixture.");
    }

    const candidatesButNone = {
      ...recommendationResultData("no_candidates"),
      currentCandidates: [candidate],
    };

    const readyResult = recommendationResultData("ready");

    const mismatchedPotentialFlag = {
      ...readyResult,
      filters: {
        ...readyResult.filters,
        includePotential: true,
      },
    };

    expect(
      recommendationResultSchema.safeParse(emptyReady).success
    ).toBeFalsy();
    expect(
      recommendationResultSchema.safeParse(candidatesButNone).success
    ).toBeFalsy();
    expect(
      recommendationResultSchema.safeParse(mismatchedPotentialFlag).success
    ).toBeFalsy();
  });

  it("accepts completed empty comparison and team recommendation results", () => {
    const comparison = decodeResultJson(
      comparisonResult(["Harry Kane", "Kylian Mbappé"]),
      comparisonResultSchema
    );

    const team = decodeResultJson(
      teamRecommendationResult("no_candidates", teamInput),
      teamRecommendationResultSchema
    );

    expect(comparison.data.status).toBe("no_comparable_data");
    expect(team.data.status).toBe("no_candidates");
  });

  it("rejects unavailable-source comparisons as completed empty results", () => {
    const unavailable = {
      coverage: {
        commonUnderstatScopeCount: 0,
        fmPlayerCount: 0,
        hasFmRecords: false,
        hasUnderstatRecords: false,
        playerCount: 2,
      },
      players: ["First Player", "Second Player"].map((playerName) => ({
        fm: { reason: "FM snapshot unavailable", status: "unavailable" },
        playerName,
        understat: { records: [], status: "not_found" },
      })),
      status: "no_comparable_data",
      understatScopeGroups: [],
    };

    const validEmpty = decodeResultJson(
      comparisonResult(["First Player", "Second Player"]),
      comparisonResultSchema
    ).data;

    if (!("coverage" in validEmpty)) {
      throw new Error("Expected a complete comparison result fixture.");
    }

    const inconsistentCoverage = {
      ...validEmpty,
      coverage: { ...validEmpty.coverage, playerCount: 3 },
    };

    expect(
      comparisonResultSchema.safeParse(inconsistentCoverage).success
    ).toBeFalsy();
    expect(
      completedComparisonResultSchema.safeParse(unavailable).success
    ).toBeFalsy();
  });

  it("rejects inconsistent team roster coverage totals", () => {
    const result = decodeResultJson(
      teamRecommendationResult("no_candidates", teamInput),
      teamRecommendationResultSchema
    ).data;

    if (!("recommendation" in result)) {
      throw new Error("Expected a completed team recommendation fixture.");
    }

    const inconsistent = {
      ...result,
      roster: { ...result.roster, totalMembers: 1 },
    };

    const invalidMappingMethodCount = {
      ...result,
      roster: { ...result.roster, mappedMembers: 1 },
    };

    const inconsistentFilters = {
      ...result,
      filters: { ...result.filters, maxAge: 21 },
    };

    const inconsistentPotentialFlag = {
      ...result,
      filters: { ...result.filters, includePotential: true },
    };

    const inconsistentPosition = { ...result, position: "dc" };

    expect(
      teamRecommendationResultSchema.safeParse(inconsistent).success
    ).toBeFalsy();
    expect(
      teamRecommendationResultSchema.safeParse(invalidMappingMethodCount)
        .success
    ).toBeFalsy();
    expect(
      teamRecommendationResultSchema.safeParse(inconsistentFilters).success
    ).toBeFalsy();
    expect(
      teamRecommendationResultSchema.safeParse(inconsistentPotentialFlag)
        .success
    ).toBeFalsy();
    expect(
      teamRecommendationResultSchema.safeParse(inconsistentPosition).success
    ).toBeFalsy();
  });
});
