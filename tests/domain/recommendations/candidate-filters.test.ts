import { afterEach, describe, expect, it } from "vitest";

import type { FmRecommendationReadResult } from "../../../src/player-data/football-manager.js";
import { recommendPlayers } from "../../../src/player-data/recommend-players.js";
import { playerRecommendationDataTest } from "../../fixtures/player-recommendation-data.js";

describe("recommendation candidate filters and counts", () => {
  afterEach(() => {
    playerRecommendationDataTest.cleanup();
  });

  it("counts all complete profiles missing PA before truncating the high-potential list", () => {
    const result = recommendPlayers(
      {
        includePotential: true,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referenceFmIds: ["reference"],
        resultLimit: 1,
      },
      playerRecommendationDataTest.recommendationSource()
    );

    expect(result.status).toBe("ready");

    if (result.status !== "ready") {
      throw new Error("Expected recommendation profiles to be rankable.");
    }

    expect({
      currentTop: result.currentCandidates[0]?.fmId,
      missingPotentialCount:
        result.filterCounts.excludedMissingPotentialForPotentialList,
      potentialCount: result.potentialCandidates?.length,
      potentialTop: result.potentialCandidates?.[0]?.fmId,
    }).toStrictEqual({
      currentTop: "missing-pa-0",
      missingPotentialCount: 4,
      potentialCount: 1,
      potentialTop: "with-pa-4",
    });
  });

  it("filters and reports age as of the request date instead of the FM snapshot", () => {
    const reference = {
      ...playerRecommendationDataTest.profileWithAttributes("reference", 50),
      birthDate: "1980-01-01",
    };

    const turnedTwentyFiveSinceSnapshot = {
      ...playerRecommendationDataTest.profileWithAttributes("turned-25", 50),
      birthDate: "2001-11-22",
    };

    const stillTwentyThree = {
      ...playerRecommendationDataTest.profileWithAttributes("still-23", 50),
      birthDate: "2002-11-24",
    };

    const source: FmRecommendationReadResult = {
      excludedMissingFmIdCandidates: 0,
      gameBuild: "test-build",
      manifestSha256: "fixture-manifest-sha",
      position: "stc",
      profiles: [reference, turnedTwentyFiveSinceSnapshot, stillTwentyThree],
      references: [reference],
      snapshotDate: "2025-11-23",
      status: "ready",
    };

    const result = recommendPlayers(
      {
        maxAge: 24,
        position: "stc",
        referenceFmIds: ["reference"],
      },
      source,
      "2026-11-23"
    );

    expect(result).toMatchObject({
      ageAsOfDate: "2026-11-23",
      currentCandidates: [{ age: 23, fmId: "still-23" }],
      snapshotDate: "2025-11-23",
    });
  });
});
