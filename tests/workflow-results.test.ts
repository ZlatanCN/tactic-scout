import { describe, expect, it } from "vitest";

import { comparisonResultSchema } from "../src/player-data/compare-records.js";
import { recommendationResultSchema } from "../src/player-data/recommend-players.js";
import { searchPlayerRecordsResultSchema } from "../src/player-data/search-records.js";
import { teamRecommendationResultSchema } from "../src/team-data/recommendation-result.js";
import { recommendationToolResultSchema } from "../src/tools/recommend-player-candidates.js";
import { decodeResultJson } from "../src/workflow-results.js";
import {
  comparisonResult,
  recommendationResult,
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

  it("normalizes complete results before they enter the state", () => {
    const original = recommendationResult("no_candidates");
    const decoded = decodeResultJson(original, recommendationToolResultSchema);

    expect(decoded.resultJson).toBe(JSON.stringify(decoded.data));
    expect(decoded.data.status).toBe("no_candidates");
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
});
