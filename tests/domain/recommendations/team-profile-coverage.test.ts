import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import type { FmRecommendationReadResult } from "../../../src/player-data/football-manager.js";
import { positionFeatureMap } from "../../../src/player-data/position-features.js";
import { recommendTeamPlayers } from "../../../src/player-data/recommend-players.js";
import type { TeamRosterSnapshot } from "../../../src/team-data/contracts.js";
import { recommendTeamPlayerCandidates } from "../../../src/tools/recommend-team-player-candidates.js";
import { playerRecommendationDataTest } from "../../fixtures/player-recommendation-data.js";

describe("team profile and roster coverage", () => {
  afterEach(() => {
    playerRecommendationDataTest.cleanup();
  });

  it("builds the team profile from position-capable squad members and excludes the whole squad", () => {
    const teamA = playerRecommendationDataTest.profileWithAttributes(
      "team-a",
      40
    );

    const teamB = playerRecommendationDataTest.profileWithAttributes(
      "team-b",
      60,
      15
    );

    const teamLowRated = playerRecommendationDataTest.profileWithAttributes(
      "team-low",
      85,
      14
    );

    const outsideNearest = playerRecommendationDataTest.profileWithAttributes(
      "outside-nearest",
      50
    );

    const outsideNext = playerRecommendationDataTest.profileWithAttributes(
      "outside-next",
      51
    );

    const source: FmRecommendationReadResult = {
      excludedMissingFmIdCandidates: 0,
      gameBuild: "test-build",
      manifestSha256: "fixture-manifest-sha",
      position: "stc",
      profiles: [teamA, teamB, teamLowRated, outsideNearest, outsideNext],
      references: [teamA, teamB, teamLowRated],
      snapshotDate: "2025-11-23",
      status: "ready",
    };

    const calculation = recommendTeamPlayers(
      {
        excludeFmIds: ["team-a", "team-b", "team-low"],
        includePotential: false,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referenceFmIds: ["team-a", "team-b", "team-low"],
        resultLimit: 5,
      },
      source
    );

    expect(calculation.status).toBe("calculated");

    if (calculation.status !== "calculated") {
      throw new Error("Expected the team position profile to be calculable.");
    }

    expect(calculation.referenceFmIds).toStrictEqual(["team-a", "team-b"]);
    expect(calculation.recommendation.status).toBe("ready");

    if (calculation.recommendation.status !== "ready") {
      throw new Error("Expected the synthetic candidate profiles to rank.");
    }

    expect({
      candidateIds: calculation.recommendation.currentCandidates.map(
        (candidate) => candidate.fmId
      ),
      referenceMean: calculation.recommendation.referenceMeanAttributes,
    }).toMatchObject({
      candidateIds: ["outside-nearest", "outside-next"],
      referenceMean: Object.fromEntries(
        positionFeatureMap.stc.features.map((feature) => [feature, 50])
      ),
    });
  });

  it("requires at least one team profile with a qualifying rating and complete features", () => {
    const lowRated = playerRecommendationDataTest.profileWithAttributes(
      "team-low",
      45,
      14
    );

    const incomplete = {
      ...playerRecommendationDataTest.profileWithAttributes(
        "team-incomplete",
        55
      ),
      attributes: {
        ...playerRecommendationDataTest.profileWithAttributes(
          "team-incomplete",
          55
        ).attributes,
        pace: null,
      },
    };

    const source: FmRecommendationReadResult = {
      excludedMissingFmIdCandidates: 0,
      gameBuild: "test-build",
      manifestSha256: "fixture-manifest-sha",
      position: "stc",
      profiles: [
        playerRecommendationDataTest.recommendationProfile("candidate", 175),
      ],
      references: [lowRated, incomplete],
      snapshotDate: "2025-11-23",
      status: "ready",
    };

    const calculation = recommendTeamPlayers(
      {
        excludeFmIds: ["team-low", "team-incomplete"],
        includePotential: false,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referenceFmIds: ["team-low", "team-incomplete"],
        resultLimit: 5,
      },
      source
    );

    expect(calculation).toStrictEqual({
      position: "stc",
      snapshotDate: "2025-11-23",
      status: "team_position_unavailable",
    });
  });

  it("accepts one qualifying squad profile as a team reference", () => {
    const reference = playerRecommendationDataTest.profileWithAttributes(
      "only-team-member",
      44,
      15
    );

    const source: FmRecommendationReadResult = {
      excludedMissingFmIdCandidates: 0,
      gameBuild: "test-build",
      manifestSha256: "fixture-manifest-sha",
      position: "stc",
      profiles: [
        reference,
        playerRecommendationDataTest.recommendationProfile(
          "outside-player",
          175
        ),
      ],
      references: [reference],
      snapshotDate: "2025-11-23",
      status: "ready",
    };

    const calculation = recommendTeamPlayers(
      {
        excludeFmIds: ["only-team-member"],
        includePotential: false,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referenceFmIds: ["only-team-member"],
        resultLimit: 5,
      },
      source
    );

    expect(calculation.status).toBe("calculated");

    if (calculation.status !== "calculated") {
      throw new Error("One eligible squad profile should define the target.");
    }

    expect(calculation.referenceFmIds).toStrictEqual(["only-team-member"]);
    expect(calculation.recommendation.status).toBe("ready");
  });

  it("returns team identity, mapping coverage, source dates, filters, and ranked candidates", async () => {
    playerRecommendationDataTest.createFmDatabase([
      { fmId: "team-reference", rating: 20 },
      { fmId: "team-reference-alternate", rating: 20 },
      { fmId: "team-low-rated", rating: 14 },
      { fmId: "outside-candidate", rating: 20 },
    ]);
    playerRecommendationDataTest.createIdentityDatabase([
      { canonicalReepId: "identity-team-reference", fmId: "team-reference" },
      {
        canonicalReepId: "identity-team-reference",
        fmId: "team-reference-alternate",
      },
      { canonicalReepId: "identity-low-rated", fmId: "team-low-rated" },
      { canonicalReepId: "identity-outside", fmId: "outside-candidate" },
    ]);
    vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:1234");

    const roster: TeamRosterSnapshot = {
      members: [
        {
          apiFootballPlayerId: 8101,
          fmCandidates: [],
          fmId: "team-reference",
          mappingMethod: "reep_bridge",
          mappingStatus: "resolved",
          name: "Reference Player",
          position: "Attacker",
        },
        {
          apiFootballPlayerId: 8102,
          fmCandidates: [],
          fmId: "team-low-rated",
          mappingMethod: "user_confirmation",
          mappingStatus: "resolved",
          name: "Low Rated Player",
          position: "Attacker",
        },
      ],
      retrievedAt: "2026-10-26T10:00:00.000Z",
      team: { country: "England", id: 42, name: "Arsenal" },
    };

    const resultJson = await recommendTeamPlayerCandidates({
      includePotential: false,
      maxAge: 30,
      minimumCurrentAbility: 120,
      minimumPotentialAbility: null,
      position: "stc",
      referenceFmIds: [],
      referenceMode: "squad",
      resultLimit: 3,
      roster,
      team: roster.team,
    });

    const result = z
      .object({
        filters: z.object({
          maxAge: z.number().nullable(),
          minimumCurrentAbility: z.number().nullable(),
          minimumPotentialAbility: z.number().nullable(),
          resultLimit: z.number(),
        }),
        fmSnapshotDate: z.string().nullable(),
        position: z.string(),
        rankingBasis: z.string(),
        recommendation: z.object({
          currentCandidates: z.array(z.object({ fmId: z.string() })),
          referenceMeanAttributes: z.record(z.string(), z.number()),
          status: z.string(),
        }),
        referenceFmIds: z.array(z.string()),
        roster: z.object({
          mappedMembers: z.number(),
          noLocalProfileMembers: z.number(),
          pendingMembers: z.number(),
          reepBridgeMappings: z.number(),
          retrievedAt: z.string(),
          source: z.string(),
          totalMembers: z.number(),
          userConfirmedMappings: z.number(),
        }),
        status: z.string(),
        team: z.object({
          country: z.string().nullable(),
          id: z.number(),
          name: z.string(),
        }),
      })
      .parse(JSON.parse(resultJson));

    expect(result).toMatchObject({
      filters: {
        maxAge: 30,
        minimumCurrentAbility: 120,
        minimumPotentialAbility: null,
        resultLimit: 3,
      },
      fmSnapshotDate: "2025-11-23",
      position: "stc",
      rankingBasis: "equal_weight_mean_of_position_capable_squad_profiles",
      recommendation: {
        currentCandidates: [{ fmId: "outside-candidate" }],
        status: "ready",
      },
      referenceFmIds: ["team-reference"],
      roster: {
        mappedMembers: 2,
        noLocalProfileMembers: 0,
        pendingMembers: 0,
        reepBridgeMappings: 1,
        retrievedAt: roster.retrievedAt,
        source: "API-Football",
        totalMembers: 2,
        userConfirmedMappings: 1,
      },
      status: "ready",
      team: roster.team,
    });
    expect(result.recommendation.referenceMeanAttributes).toMatchObject(
      Object.fromEntries(
        positionFeatureMap.stc.features.map((feature, index) => [
          feature,
          40 + index,
        ])
      )
    );
    expect(
      result.recommendation.currentCandidates.map(({ fmId }) => fmId)
    ).toStrictEqual(["outside-candidate"]);
  });
});
