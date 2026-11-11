import { z } from "zod/v4";

import { recommendationResultSchema } from "../player-data/recommend-players.js";

const teamIdentitySchema = z.object({
  country: z.string().nullable(),
  id: z.number().int().positive(),
  name: z.string().min(1),
});

const teamRosterCoverageSchema = z.object({
  mappedMembers: z.number().int().nonnegative(),
  noLocalProfileMembers: z.number().int().nonnegative(),
  pendingMembers: z.number().int().nonnegative(),
  reepBridgeMappings: z.number().int().nonnegative(),
  totalMembers: z.number().int().nonnegative(),
  userConfirmedMappings: z.number().int().nonnegative(),
});

const teamRecommendationFiltersSchema = z.object({
  includePotential: z.boolean(),
  maxAge: z.number().int().nullable(),
  minimumCurrentAbility: z.number().int().nullable(),
  minimumPotentialAbility: z.number().int().nullable(),
  resultLimit: z.number().int().positive(),
});

const teamRecommendationRosterSchema = teamRosterCoverageSchema
  .extend({
    retrievedAt: z.string(),
    source: z.literal("API-Football"),
  })
  .superRefine((coverage, context) => {
    const classifiedMembers =
      coverage.mappedMembers +
      coverage.noLocalProfileMembers +
      coverage.pendingMembers;

    if (classifiedMembers !== coverage.totalMembers) {
      context.addIssue({
        code: "custom",
        message: "Roster mapping coverage counts must sum to total members.",
        path: ["totalMembers"],
      });
    }

    const mappedByMethod =
      coverage.reepBridgeMappings + coverage.userConfirmedMappings;

    if (mappedByMethod !== coverage.mappedMembers) {
      context.addIssue({
        code: "custom",
        message: "Resolved roster members must have a recorded mapping method.",
        path: ["mappedMembers"],
      });
    }
  });

const teamRecommendationExclusionScopeSchema = z
  .object({
    currentRosterMembers: z.array(
      z.object({
        apiFootballPlayerId: z.number().int().positive(),
        fmId: z.string().min(1),
        mappingMethod: z.enum(["reep_bridge", "user_confirmation"]),
      })
    ),
    effectiveExcludedFmIds: z.array(z.string().min(1)),
  })
  .superRefine((scope, context) => {
    const excludedFmIds = new Set(scope.effectiveExcludedFmIds);

    if (
      scope.currentRosterMembers.some(({ fmId }) => !excludedFmIds.has(fmId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Every mapped current-roster FM profile must be excluded.",
        path: ["effectiveExcludedFmIds"],
      });
    }
  });

const teamRecommendationResultSchema = z.union([
  z
    .object({
      exclusionScope: teamRecommendationExclusionScopeSchema.optional(),
      filters: teamRecommendationFiltersSchema,
      fmSnapshotDate: z.string().nullable(),
      position: z.string(),
      rankingBasis: z.enum([
        "equal_weight_mean_of_position_capable_squad_profiles",
        "named_fm_reference_profile",
      ]),
      recommendation: recommendationResultSchema,
      referenceFmIds: z.array(z.string()),
      roster: teamRecommendationRosterSchema,
      status: z.enum([
        "ready",
        "no_candidates",
        "data_unavailable",
        "insufficient_reference_data",
        "reference_not_position_capable",
        "invalid_constraint",
        "unsupported_position",
      ]),
      team: teamIdentitySchema,
    })
    .superRefine((result, context) => {
      if (result.status !== result.recommendation.status) {
        context.addIssue({
          code: "custom",
          message: "Outer and nested recommendation statuses must match.",
          path: ["status"],
        });
      }

      const { recommendation } = result;

      if (
        "position" in recommendation &&
        recommendation.position !== result.position
      ) {
        context.addIssue({
          code: "custom",
          message: "Outer and nested recommendation positions must match.",
          path: ["position"],
        });
      }

      if ("filters" in recommendation) {
        const outerFilterValues = [
          result.filters.includePotential,
          result.filters.maxAge,
          result.filters.minimumCurrentAbility,
          result.filters.minimumPotentialAbility,
          result.filters.resultLimit,
        ];

        const nestedFilterValues = [
          recommendation.filters.includePotential,
          recommendation.filters.maxAge,
          recommendation.filters.minimumCurrentAbility,
          recommendation.filters.minimumPotentialAbility,
          recommendation.filters.resultLimit,
        ];

        const filtersMatch =
          outerFilterValues.length === nestedFilterValues.length &&
          outerFilterValues.every(
            (value, index) => value === nestedFilterValues[index]
          );

        if (!filtersMatch) {
          context.addIssue({
            code: "custom",
            message: "Outer and nested recommendation filters must match.",
            path: ["filters"],
          });
        }
      }

      if (
        "referenceFmIds" in recommendation &&
        result.referenceFmIds.join("\u0000") !==
          recommendation.referenceFmIds.join("\u0000")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Outer and nested recommendation reference profiles must match.",
          path: ["referenceFmIds"],
        });
      }

      if (result.exclusionScope !== undefined) {
        const excludedFmIds = new Set(
          result.exclusionScope.effectiveExcludedFmIds
        );

        if (result.referenceFmIds.some((fmId) => !excludedFmIds.has(fmId))) {
          context.addIssue({
            code: "custom",
            message: "Every selected reference FM profile must be excluded.",
            path: ["exclusionScope", "effectiveExcludedFmIds"],
          });
        }
      }

      if (
        "snapshotDate" in recommendation &&
        result.fmSnapshotDate !== recommendation.snapshotDate
      ) {
        context.addIssue({
          code: "custom",
          message: "FM snapshot dates must match.",
          path: ["fmSnapshotDate"],
        });
      }
    }),
  z.object({
    exclusionScope: teamRecommendationExclusionScopeSchema.optional(),
    filters: teamRecommendationFiltersSchema,
    fmSnapshotDate: z.string(),
    position: z.string(),
    rankingBasis: z.enum([
      "equal_weight_mean_of_position_capable_squad_profiles",
      "named_fm_reference_profile",
    ]),
    referenceFmIds: z.array(z.string()),
    roster: teamRecommendationRosterSchema,
    status: z.literal("team_position_unavailable"),
    team: teamIdentitySchema,
  }),
]);

type TeamRecommendationResult = z.output<typeof teamRecommendationResultSchema>;

export { teamRecommendationResultSchema };

export type { TeamRecommendationResult };
