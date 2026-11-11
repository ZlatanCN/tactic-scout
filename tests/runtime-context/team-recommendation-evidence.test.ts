import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { teamRecommendationResultSchema } from "../../src/team-data/recommendation-result.js";
import {
  teamRecommendationBatchIsComplete,
  teamRecommendationEvidenceProjections,
  teamRecommendationEvidenceQuestionMessage,
} from "../../src/team-recommendation-evidence.js";
import { teamRecommendationEvidenceFixture } from "../fixtures/team-recommendation-evidence.js";

const candidateProjectionSchema = z.object({
  age: z.number().nullable(),
  attributes: z.array(
    z.object({
      attribute: z.string(),
      candidateValue: z.number(),
      difference: z.number(),
      referenceMean: z.number(),
    })
  ),
  candidateRef: z.string(),
  currentAbility: z.number().nullable(),
  currentDistance: z.number(),
  fmId: z.string(),
  name: z.string(),
  positionRating: z.number(),
  potentialAbility: z.number().nullable(),
  rank: z.number().int(),
  sourceRecordId: z.string(),
});

const projectionFrom = (projectionJson: string) =>
  z
    .object({
      batch: z.object({
        candidateRefs: z.array(z.string()),
        completedCandidateRefs: z.array(z.string()),
        index: z.number().int(),
        remainingCandidateRefs: z.array(z.string()),
        total: z.number().int(),
      }),
      candidateCoverage: z.object({
        currentCandidateCount: z.number().int(),
        potentialCandidateCount: z.number().int().nullable(),
      }),
      currentCandidates: z.array(candidateProjectionSchema),
      digest: z.string(),
      exclusionScope: z.object({
        currentRosterMembers: z.array(
          z.object({
            apiFootballPlayerId: z.number(),
            fmId: z.string(),
            mappingMethod: z.string(),
          })
        ),
        effectiveExcludedFmIds: z.array(z.string()),
      }),
      fmSnapshotDate: z.string().nullable(),
      potentialCandidates: z.array(candidateProjectionSchema).nullable(),
      rankingBasis: z.string(),
      rankingContext: z.object({
        ageAsOfDate: z.string(),
        filterCounts: z.record(z.string(), z.number()),
        filters: z.object({
          includePotential: z.boolean(),
          maxAge: z.number().nullable(),
          minimumCurrentAbility: z.number().nullable(),
          minimumPotentialAbility: z.number().nullable(),
          resultLimit: z.number(),
        }),
        referenceFmIds: z.array(z.string()),
        references: z.array(z.object({ fmId: z.string(), name: z.string() })),
        snapshotDate: z.string(),
      }),
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
      source: z.enum(["executed", "saved"]),
      team: z.object({
        country: z.string().nullable(),
        id: z.number(),
        name: z.string(),
      }),
      version: z.number().int(),
    })
    .parse(JSON.parse(projectionJson));

const fieldValue = (value: number | null): string =>
  value === null ? "未提供" : String(value);

const candidateAnswer = (
  candidate: z.output<typeof candidateProjectionSchema>
): string =>
  `${candidate.rank}. ${candidate.name}（FM ID ${candidate.fmId}；年龄 ${fieldValue(candidate.age)}；位置评分 ${candidate.positionRating}；CA ${fieldValue(candidate.currentAbility)}；PA ${fieldValue(candidate.potentialAbility)}；currentDistance ${candidate.currentDistance}）`;

const answerForProjection = (projectionJson: string): string => {
  const projection = projectionFrom(projectionJson);

  const candidates = [
    ...projection.currentCandidates,
    ...(projection.potentialCandidates ?? []),
  ];

  return candidates.map(candidateAnswer).join("\n");
};

describe("team recommendation evidence projections", () => {
  it("preserves both ranked lists and exact team, roster, reference, and exclusion coverage", () => {
    const { resultJson } = teamRecommendationEvidenceFixture();

    const projections = teamRecommendationEvidenceProjections(
      resultJson,
      "saved",
      3
    );

    expect(projections).not.toBeNull();

    if (projections === null) {
      throw new Error("A complete team recommendation should be projectable.");
    }

    const batches = projections.map(({ projectionJson }) =>
      projectionFrom(projectionJson)
    );

    expect({
      batchRefs: batches.map(({ batch }) => batch.candidateRefs),
      candidateCounts: batches.map(({ candidateCoverage }) =>
        Object.values(candidateCoverage).join("/")
      ),
      digest: batches.map(({ digest }) => digest),
      firstBatchCandidateRows: batches[0]?.currentCandidates.map(
        (candidateRow) => candidateRow
      ),
      firstBatchExclusions: batches[0]?.exclusionScope,
      firstBatchMetadata: {
        fmSnapshotDate: batches[0]?.fmSnapshotDate,
        rankingBasis: batches[0]?.rankingBasis,
        rankingContext: batches[0]?.rankingContext,
        roster: batches[0]?.roster,
        source: batches[0]?.source,
        team: batches[0]?.team,
      },
      lastBatchProgress: batches[2]?.batch,
      modelMessageHasCollectorMarker: teamRecommendationEvidenceQuestionMessage(
        "Explain these recommendations.",
        projections[0]?.projectionJson ?? ""
      ).includes("Team recommendation evidence projection JSON:\n"),
      totalBatches: batches.length,
    }).toStrictEqual({
      batchRefs: [
        [
          "recommendation.currentCandidates[0]",
          "recommendation.currentCandidates[1]",
          "recommendation.currentCandidates[2]",
        ],
        [
          "recommendation.currentCandidates[3]",
          "recommendation.currentCandidates[4]",
          "recommendation.potentialCandidates[0]",
        ],
        [
          "recommendation.potentialCandidates[1]",
          "recommendation.potentialCandidates[2]",
          "recommendation.potentialCandidates[3]",
        ],
      ],
      candidateCounts: ["5/4", "5/4", "5/4"],
      digest: Array.from({ length: 3 }, () =>
        createHash("sha256").update(resultJson).digest("hex")
      ),
      firstBatchCandidateRows: [
        {
          age: 19,
          attributes: [
            {
              attribute: "pace",
              candidateValue: 61,
              difference: 0.1,
              referenceMean: 60,
            },
          ],
          candidateRef: "recommendation.currentCandidates[0]",
          currentAbility: 121,
          currentDistance: 0.3,
          fmId: "fm-current-1",
          name: "Current Prospect 1",
          positionRating: 19,
          potentialAbility: 151,
          rank: 1,
          sourceRecordId: "fm-record-current-1",
        },
        {
          age: 20,
          attributes: [
            {
              attribute: "pace",
              candidateValue: 62,
              difference: 0.2,
              referenceMean: 61,
            },
          ],
          candidateRef: "recommendation.currentCandidates[1]",
          currentAbility: 122,
          currentDistance: 0.4,
          fmId: "fm-current-2",
          name: "Current Prospect 2",
          positionRating: 20,
          potentialAbility: 152,
          rank: 2,
          sourceRecordId: "fm-record-current-2",
        },
        {
          age: 21,
          attributes: [
            {
              attribute: "pace",
              candidateValue: 63,
              difference: 0.3,
              referenceMean: 62,
            },
          ],
          candidateRef: "recommendation.currentCandidates[2]",
          currentAbility: 123,
          currentDistance: 0.5,
          fmId: "fm-current-3",
          name: "Current Prospect 3",
          positionRating: 21,
          potentialAbility: 153,
          rank: 3,
          sourceRecordId: "fm-record-current-3",
        },
      ],
      firstBatchExclusions: {
        currentRosterMembers: [
          {
            apiFootballPlayerId: 11,
            fmId: "roster-fm-1",
            mappingMethod: "reep_bridge",
          },
          {
            apiFootballPlayerId: 12,
            fmId: "roster-fm-2",
            mappingMethod: "user_confirmation",
          },
        ],
        effectiveExcludedFmIds: [
          "roster-fm-1",
          "roster-fm-2",
          "linked-roster-fm-1",
          "linked-roster-fm-2",
        ],
      },
      firstBatchMetadata: {
        fmSnapshotDate: "2025-11-23",
        rankingBasis: "equal_weight_mean_of_position_capable_squad_profiles",
        rankingContext: {
          ageAsOfDate: "2026-11-04",
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
            includePotential: true,
            maxAge: 24,
            minimumCurrentAbility: 125,
            minimumPotentialAbility: 155,
            resultLimit: 20,
          },
          referenceFmIds: ["roster-fm-1", "roster-fm-2"],
          references: [
            { fmId: "roster-fm-1", name: "Roster Player 1" },
            { fmId: "roster-fm-2", name: "Roster Player 2" },
          ],
          snapshotDate: "2025-11-23",
        },
        roster: {
          mappedMembers: 2,
          noLocalProfileMembers: 0,
          pendingMembers: 0,
          reepBridgeMappings: 1,
          retrievedAt: "2026-10-26T10:00:00.000Z",
          source: "API-Football",
          totalMembers: 2,
          userConfirmedMappings: 1,
        },
        source: "saved",
        team: { country: "England", id: 42, name: "Synthetic FC" },
      },
      lastBatchProgress: {
        candidateRefs: [
          "recommendation.potentialCandidates[1]",
          "recommendation.potentialCandidates[2]",
          "recommendation.potentialCandidates[3]",
        ],
        completedCandidateRefs: [
          "recommendation.currentCandidates[0]",
          "recommendation.currentCandidates[1]",
          "recommendation.currentCandidates[2]",
          "recommendation.currentCandidates[3]",
          "recommendation.currentCandidates[4]",
          "recommendation.potentialCandidates[0]",
        ],
        index: 2,
        remainingCandidateRefs: [],
        total: 3,
      },
      modelMessageHasCollectorMarker: true,
      totalBatches: 3,
    });
  });

  it("verifies complete ordered candidate coverage and rejects projection or answer omissions", () => {
    const { resultJson } = teamRecommendationEvidenceFixture();

    const projections = teamRecommendationEvidenceProjections(
      resultJson,
      "executed",
      3
    );

    if (projections === null) {
      throw new Error("A complete team recommendation should be projectable.");
    }

    const batches = projections.map(({ projectionJson, recordRefs }) => {
      const projection = projectionFrom(projectionJson);

      return {
        answer: answerForProjection(projectionJson),
        index: projection.batch.index,
        projectionJson,
        recordRefs,
      };
    });

    const evidence = { batches, source: "executed" as const };

    expect(
      teamRecommendationBatchIsComplete(evidence, resultJson)
    ).toBeTruthy();

    const [firstBatch, secondBatch] = batches;

    if (firstBatch === undefined || secondBatch === undefined) {
      throw new Error("A required evidence batch is missing.");
    }

    const explicitMissingValues = {
      age: secondBatch.answer.includes("年龄 未提供"),
      currentAbility: secondBatch.answer.includes("CA 未提供"),
      potentialAbility: secondBatch.answer.includes("PA 未提供"),
    };

    const omittedFieldEvidence = {
      ...evidence,
      batches: [
        {
          ...firstBatch,
          answer: firstBatch.answer.replace(
            "currentDistance 0.3",
            "currentDistance"
          ),
        },
        ...batches.slice(1),
      ],
    };

    const omittedNullMarkerEvidence = {
      ...evidence,
      batches: [
        firstBatch,
        {
          ...secondBatch,
          answer: secondBatch.answer.replace("CA 未提供", "CA"),
        },
        ...batches.slice(2),
      ],
    };

    const changedProjection = projectionFrom(firstBatch.projectionJson);

    const changedProjectionJson = JSON.stringify({
      ...changedProjection,
      currentCandidates: changedProjection.currentCandidates.map(
        (candidateRow, index) =>
          index === 0 ? { ...candidateRow, currentAbility: 1 } : candidateRow
      ),
    });

    const tamperedEvidence = {
      ...evidence,
      batches: [
        { ...firstBatch, projectionJson: changedProjectionJson },
        ...batches.slice(1),
      ],
    };

    const omittedCandidateEvidence = {
      ...evidence,
      batches: [
        {
          ...firstBatch,
          answer: "Current Prospect 1（FM ID fm-current-1）",
        },
        ...batches.slice(1),
      ],
    };

    expect({
      explicitMissingValues,
      missingCurrentDistance: teamRecommendationBatchIsComplete(
        omittedFieldEvidence,
        resultJson
      ),
      missingNullMarker: teamRecommendationBatchIsComplete(
        omittedNullMarkerEvidence,
        resultJson
      ),
      omittedCandidate: teamRecommendationBatchIsComplete(
        omittedCandidateEvidence,
        resultJson
      ),
      tamperedProjection: teamRecommendationBatchIsComplete(
        tamperedEvidence,
        resultJson
      ),
    }).toStrictEqual({
      explicitMissingValues: {
        age: true,
        currentAbility: true,
        potentialAbility: true,
      },
      missingCurrentDistance: false,
      missingNullMarker: false,
      omittedCandidate: false,
      tamperedProjection: false,
    });
  });

  it("fails closed when effective roster exclusions are missing or incomplete", () => {
    const fixture = teamRecommendationEvidenceFixture();

    const result = teamRecommendationResultSchema.parse(
      JSON.parse(fixture.resultJson)
    );

    const resultWithoutScope = structuredClone(result);

    Reflect.deleteProperty(resultWithoutScope, "exclusionScope");

    expect(
      teamRecommendationEvidenceProjections(
        JSON.stringify(resultWithoutScope),
        "saved"
      )
    ).toBeNull();

    expect(
      teamRecommendationEvidenceProjections(
        JSON.stringify({
          ...result,
          exclusionScope: {
            currentRosterMembers: [
              {
                apiFootballPlayerId: 11,
                fmId: "roster-fm-1",
                mappingMethod: "reep_bridge",
              },
              {
                apiFootballPlayerId: 12,
                fmId: "roster-fm-2",
                mappingMethod: "user_confirmation",
              },
            ],
            effectiveExcludedFmIds: ["roster-fm-1", "linked-roster-fm-1"],
          },
        }),
        "saved"
      )
    ).toBeNull();

    expect(
      teamRecommendationEvidenceProjections(
        fixture.excludedCandidateResultJson,
        "saved"
      )
    ).toBeNull();
  });

  it("returns one metadata batch for a complete empty result and rejects an unready workflow result", () => {
    const emptyJson = teamRecommendationEvidenceFixture().emptyResultJson;

    const emptyProjections = teamRecommendationEvidenceProjections(
      emptyJson,
      "saved"
    );

    expect(
      emptyProjections?.map(({ projectionJson, recordRefs }) => ({
        projection: projectionFrom(projectionJson),
        recordRefs,
      }))
    ).toMatchObject([
      {
        projection: {
          batch: {
            candidateRefs: [],
            completedCandidateRefs: [],
            remainingCandidateRefs: [],
            total: 1,
          },
          candidateCoverage: {
            currentCandidateCount: 0,
            potentialCandidateCount: null,
          },
          currentCandidates: [],
          potentialCandidates: null,
        },
        recordRefs: [
          "recommendation.references[0]",
          "recommendation.references[1]",
        ],
      },
    ]);

    expect(
      teamRecommendationBatchIsComplete(
        {
          batches: [
            {
              answer: "当前能力相似名单没有候选。",
              index: 0,
              projectionJson: emptyProjections?.[0]?.projectionJson ?? "",
              recordRefs: emptyProjections?.[0]?.recordRefs ?? [],
            },
          ],
          source: "saved",
        },
        emptyJson
      )
    ).toBeTruthy();

    const unavailableResult = teamRecommendationResultSchema.parse(
      JSON.parse(emptyJson)
    );

    const unreadyJson = JSON.stringify({
      ...unavailableResult,
      recommendation: {
        reason: "FM data unavailable",
        status: "data_unavailable",
      },
      status: "data_unavailable",
    });

    expect(
      teamRecommendationEvidenceProjections(unreadyJson, "saved")
    ).toBeNull();
  });
});
