import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import {
  playerRecommendationEvidenceIsComplete,
  playerRecommendationEvidenceProjections,
} from "../../src/player-recommendation-evidence.js";

const candidate = (
  name: string,
  fmId: string,
  rank: number,
  currentDistance: number,
  potentialAbility: number | null
) => ({
  age: 20 + rank,
  attributes: [
    {
      attribute: "pace",
      candidateValue: 60 + rank,
      difference: rank,
      referenceMean: 60,
    },
  ],
  currentAbility: 120 + rank,
  currentDistance,
  fmId,
  name,
  positionRating: 16 + rank,
  potentialAbility,
  rank,
  sourceRecordId: `source-${fmId}`,
});

const recommendationResultJson = JSON.stringify({
  ageAsOfDate: "2026-11-11",
  currentCandidates: [
    candidate("Current One", "fm-current-1", 1, 1.25, 170),
    candidate("Current Two", "fm-current-2", 2, 2.5, null),
    candidate("Current Three", "fm-current-3", 3, 3.75, 175),
  ],
  filterCounts: {
    afterAge: 5,
    afterCurrentAbility: 4,
    afterIdentityExclusion: 8,
    afterPotentialAbility: 3,
    currentAttributeComplete: 4,
    eligiblePositionProfiles: 10,
    excludedMissingAttribute: 1,
    excludedMissingFmIdCandidates: 0,
    excludedMissingPotentialForPotentialList: 1,
  },
  filters: {
    includePotential: true,
    maxAge: 24,
    minimumCurrentAbility: 100,
    minimumPotentialAbility: 170,
    resultLimit: 20,
  },
  formula: "rmse",
  gameBuild: "2026.1",
  manifestSha256: "manifest-digest",
  position: "stc",
  positionFeatureMapSha256: "feature-map-digest",
  positionFeatureSetVersion: "feature-set-v3",
  potentialCandidates: [
    candidate("Prospect One", "fm-prospect-1", 1, 9.5, 195),
    candidate("Prospect Two", "fm-prospect-2", 2, 12.25, 190),
  ],
  referenceFmIds: ["fm-reference"],
  referenceMeanAttributes: { pace: 60 },
  references: [
    {
      currentAbility: 150,
      fmId: "fm-reference",
      name: "Reference Player",
      positionRating: 20,
      potentialAbility: 180,
      sourceRecordId: "source-reference",
    },
  ],
  snapshotDate: "2025-11-23",
  status: "ready",
  strategyVersion: "recommendation-v4",
});

const projectionSchema = z.object({
  batch: z.object({
    candidateRefs: z.array(z.string()),
    index: z.number(),
    list: z.enum(["current", "potential"]),
    total: z.number(),
  }),
  candidateCounts: z.object({ current: z.number(), potential: z.number() }),
  digest: z.string(),
  metadata: z.object({
    ageAsOfDate: z.string(),
    filterCounts: z.record(z.string(), z.number()),
    filters: z.object({
      includePotential: z.boolean(),
      maxAge: z.number().nullable(),
      minimumCurrentAbility: z.number().nullable(),
      minimumPotentialAbility: z.number().nullable(),
      resultLimit: z.number(),
    }),
    formula: z.literal("rmse"),
    gameBuild: z.string(),
    manifestSha256: z.string(),
    position: z.string(),
    positionFeatureMapSha256: z.string(),
    positionFeatureSetVersion: z.string(),
    referenceFmIds: z.array(z.string()),
    referenceMeanAttributes: z.record(z.string(), z.number()),
    references: z.array(
      z.object({
        currentAbility: z.number().nullable(),
        fmId: z.string(),
        name: z.string(),
        positionRating: z.number(),
        potentialAbility: z.number().nullable(),
        sourceRecordId: z.string(),
      })
    ),
    snapshotDate: z.string(),
    status: z.string(),
    strategyVersion: z.string(),
  }),
  potentialListStatus: z.enum(["not_requested", "requested"]),
  selectedCandidates: z.array(
    z.object({
      age: z.number().nullable(),
      attributes: z.array(
        z.object({
          attribute: z.string(),
          candidateValue: z.number(),
          difference: z.number(),
          referenceMean: z.number(),
        })
      ),
      currentAbility: z.number().nullable(),
      currentDistance: z.number(),
      fmId: z.string(),
      name: z.string(),
      positionRating: z.number(),
      potentialAbility: z.number().nullable(),
      rank: z.number(),
      sourceRecordId: z.string(),
    })
  ),
  source: z.enum(["executed", "saved"]),
  version: z.literal(1),
});

describe("player recommendation evidence projections", () => {
  it("keeps both complete ranked lists in separately identified source batches", () => {
    const projections = playerRecommendationEvidenceProjections(
      recommendationResultJson,
      "saved",
      2
    );

    expect(projections).not.toBeNull();

    const batches = (projections ?? []).map(
      ({ projectionJson, recordRefs }) => {
        const projection = projectionSchema.parse(JSON.parse(projectionJson));

        return {
          batch: projection.batch,
          candidateCounts: projection.candidateCounts,
          digest: projection.digest,
          listNames: projection.selectedCandidates.map(({ name }) => name),
          ranks: projection.selectedCandidates.map(({ rank }) => rank),
          recordRefs,
        };
      }
    );

    const expectedDigest = createHash("sha256")
      .update(recommendationResultJson)
      .digest("hex");

    expect(batches).toStrictEqual([
      {
        batch: {
          candidateRefs: ["currentCandidates[0]", "currentCandidates[1]"],
          index: 0,
          list: "current",
          total: 3,
        },
        candidateCounts: { current: 3, potential: 2 },
        digest: expectedDigest,
        listNames: ["Current One", "Current Two"],
        ranks: [1, 2],
        recordRefs: ["currentCandidates[0]", "currentCandidates[1]"],
      },
      {
        batch: {
          candidateRefs: ["currentCandidates[2]"],
          index: 1,
          list: "current",
          total: 3,
        },
        candidateCounts: { current: 3, potential: 2 },
        digest: expectedDigest,
        listNames: ["Current Three"],
        ranks: [3],
        recordRefs: ["currentCandidates[2]"],
      },
      {
        batch: {
          candidateRefs: ["potentialCandidates[0]", "potentialCandidates[1]"],
          index: 2,
          list: "potential",
          total: 3,
        },
        candidateCounts: { current: 3, potential: 2 },
        digest: expectedDigest,
        listNames: ["Prospect One", "Prospect Two"],
        ranks: [1, 2],
        recordRefs: ["potentialCandidates[0]", "potentialCandidates[1]"],
      },
    ]);

    const firstProjection = projectionSchema.parse(
      JSON.parse(projections?.[0]?.projectionJson ?? "null")
    );

    expect(firstProjection).toMatchObject({
      metadata: {
        ageAsOfDate: "2026-11-11",
        filterCounts: {
          afterAge: 5,
          afterCurrentAbility: 4,
          afterIdentityExclusion: 8,
          afterPotentialAbility: 3,
          currentAttributeComplete: 4,
          eligiblePositionProfiles: 10,
          excludedMissingAttribute: 1,
          excludedMissingFmIdCandidates: 0,
          excludedMissingPotentialForPotentialList: 1,
        },
        filters: {
          includePotential: true,
          maxAge: 24,
          minimumCurrentAbility: 100,
          minimumPotentialAbility: 170,
          resultLimit: 20,
        },
        formula: "rmse",
        gameBuild: "2026.1",
        manifestSha256: "manifest-digest",
        position: "stc",
        positionFeatureMapSha256: "feature-map-digest",
        positionFeatureSetVersion: "feature-set-v3",
        referenceFmIds: ["fm-reference"],
        referenceMeanAttributes: { pace: 60 },
        references: [
          {
            currentAbility: 150,
            fmId: "fm-reference",
            name: "Reference Player",
            positionRating: 20,
            potentialAbility: 180,
            sourceRecordId: "source-reference",
          },
        ],
        snapshotDate: "2025-11-23",
        status: "ready",
        strategyVersion: "recommendation-v4",
      },
      potentialListStatus: "requested",
      source: "saved",
    });
  });

  it("rejects a missing, reordered, or modified candidate batch before completion", () => {
    const projections = playerRecommendationEvidenceProjections(
      recommendationResultJson,
      "executed",
      2
    );

    expect(projections).not.toBeNull();

    if (projections === null) {
      throw new Error("The recommendation fixture needs three batches.");
    }

    const evidence = {
      batches: projections.map(({ projectionJson, recordRefs }, index) => {
        const projection = projectionSchema.parse(JSON.parse(projectionJson));

        return {
          answer: projection.selectedCandidates
            .map(
              ({
                age,
                currentAbility,
                currentDistance,
                fmId,
                name,
                positionRating,
                potentialAbility,
                rank,
              }) =>
                `${rank}. ${name} (FM ID ${fmId}; age ${age ?? "not provided"}; position rating ${positionRating}; CA ${currentAbility ?? "not provided"}; PA ${potentialAbility ?? "not provided"}; currentDistance ${currentDistance})`
            )
            .join("\n"),
          index,
          projectionJson,
          recordRefs,
          status: "ready" as const,
        };
      }),
      failureReason: null,
      questionHash: "question-hash",
      requestId: "request-id",
      resultDigest: createHash("sha256")
        .update(recommendationResultJson)
        .digest("hex"),
      source: "executed" as const,
      sourceHash: "source-hash",
      sourceMessageId: "message-id",
      status: "complete" as const,
    };

    const tamperedBatches = evidence.batches.map((batch, index) =>
      index === 0
        ? {
            ...batch,
            projectionJson: batch.projectionJson.replace(
              '"currentDistance":1.25',
              '"currentDistance":999'
            ),
          }
        : batch
    );

    const incompleteAnswerBatches = evidence.batches.map((batch, index) =>
      index === 0
        ? {
            ...batch,
            answer:
              "Current One (FM ID fm-current-1); Current Two (FM ID fm-current-2)",
          }
        : batch
    );

    const finalBatchProcessingEvidence = {
      ...evidence,
      status: "processing" as const,
    };

    expect([
      playerRecommendationEvidenceIsComplete(
        evidence,
        recommendationResultJson
      ),
      playerRecommendationEvidenceIsComplete(
        finalBatchProcessingEvidence,
        recommendationResultJson
      ),
      playerRecommendationEvidenceIsComplete(
        { ...evidence, batches: evidence.batches.slice(0, 2) },
        recommendationResultJson
      ),
      playerRecommendationEvidenceIsComplete(
        {
          ...evidence,
          batches: [
            evidence.batches[1],
            evidence.batches[0],
            evidence.batches[2],
          ].filter((batch) => batch !== undefined),
        },
        recommendationResultJson
      ),
      playerRecommendationEvidenceIsComplete(
        { ...evidence, batches: tamperedBatches },
        recommendationResultJson
      ),
      playerRecommendationEvidenceIsComplete(
        { ...evidence, batches: incompleteAnswerBatches },
        recommendationResultJson
      ),
    ]).toStrictEqual([true, true, false, false, false, false]);
  });
});
