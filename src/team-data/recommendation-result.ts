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
  });

const teamRecommendationResultSchema = z.union([
  z
    .object({
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
    }),
  z.object({
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
