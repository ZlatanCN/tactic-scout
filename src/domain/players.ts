import { z } from "zod/v4";
import { PlayerPositionEvidenceSchema, PlayerPositionSchema, PositionSchema } from "./position-contracts.js";
import { PlayerAbilityProfileSchema } from "./player-abilities.js";

export const RawStatsSchema = z.object({
  goals: z.number().default(0),
  assists: z.number().default(0),
  passesAttempted: z.number().default(0),
  passesCompleted: z.number().default(0),
  longPasses: z.number().default(0),
  carries: z.number().default(0),
  pressures: z.number().default(0),
  tackles: z.number().default(0),
  interceptions: z.number().default(0),
  shotAssists: z.number().default(0),
  keyPasses: z.number().default(0),
});

export const RawStatKeySchema = z.enum([
  "goals",
  "assists",
  "passesAttempted",
  "passesCompleted",
  "longPasses",
  "carries",
  "pressures",
  "tackles",
  "interceptions",
  "shotAssists",
  "keyPasses",
]);

export type RawStatKey = z.infer<typeof RawStatKeySchema>;

export const PlayerDataSourceIdentitySchema = z.object({
  provider: z.string().min(1),
  playerId: z.string().min(1),
  providerIdentifiers: z.array(z.object({
    provider: z.string().min(1),
    namespace: z.string().min(1),
    externalId: z.string().min(1),
    sourceField: z.string().min(1),
  })).optional(),
  teamId: z.string().optional(),
  competitionId: z.string().optional(),
  seasonId: z.string().optional(),
  positionGroup: z.string().optional(),
  positionGroups: z.array(PositionSchema).optional(),
  positionSamples: z.array(z.object({
    position: PositionSchema,
    minutes: z.number().nonnegative(),
  })).optional(),
  sourcePositionLabels: z.array(z.string()).optional(),
  retrievedAt: z.string().datetime(),
  isCurrentSeason: z.boolean().optional(),
});

export type PlayerDataSourceIdentity = z.infer<typeof PlayerDataSourceIdentitySchema>;

export const SupplementaryMetricKeySchema = z.enum([
  "wyscoutGroundAttackingDuelsPer90",
  "wyscoutExplicitlyWonGroundAttackingDuelSharePct",
  "wyscoutGroundDefensiveDuelsPer90",
  "wyscoutClearlyWonGroundDefensiveDuelPct",
  "wyscoutProgressivePassesPer90",
  "wyscoutAccurateProgressivePassesPct",
  "highIntensityDistancePer90",
  "sprintDistancePer90",
  "highIntensityActionsPer90",
  "behindRunsPer30Tip",
  "overlapRunsPer30Tip",
  "lineBreakPassesCompletedPer30Tip",
  "passesToRunsCompletionPct",
  "statsbombNonPenaltyXgPer90",
  "statsbombNonPenaltyXgPerShot",
  "fplExpectedGoalsPer90",
  "fplExpectedAssistsPer90",
  "fplExpectedGoalInvolvementsPer90",
  "fplTacklesPer90",
  "fplRecoveriesPer90",
  "fplClearancesBlocksInterceptionsPer90",
  "premierLeagueGoalsPer90",
  "premierLeagueAssistsPer90",
  "premierLeagueKeyPassesPer90",
  "premierLeagueSuccessfulDribblesPer90",
  "premierLeagueTotalTacklesPer90",
  "premierLeagueTacklesWonPer90",
  "premierLeagueInterceptionsPer90",
  "premierLeagueRecoveriesPer90",
  "premierLeagueForwardPassesPer90",
  "premierLeagueAerialDuelsWonPer90",
  "asaExpectedGoalsPer90",
  "asaExpectedAssistsPer90",
  "asaExpectedGoalContributionsPer90",
  "asaExpectedGoalsPerShot",
  "asaShotsPer90",
  "asaPassCompletionPct",
  "asaExpectedPassCompletionPct",
  "asaPassesCompletedOverExpectedPer100",
  "asaAverageVerticalPassDistanceYards",
  "asaGoalsAddedTotalAboveAveragePer90",
  "asaGoalsAddedDribblingPer90",
  "asaGoalsAddedFoulingPer90",
  "asaGoalsAddedInterruptingPer90",
  "asaGoalsAddedPassingPer90",
  "asaGoalsAddedReceivingPer90",
  "asaGoalsAddedShootingPer90",
  "understatExpectedGoalsPer90",
  "understatNonPenaltyExpectedGoalsPer90",
  "understatExpectedAssistsPer90",
  "understatExpectedGoalsPerShot",
  "understatShotsPer90",
  "understatKeyPassesPer90",
  "understatXgChainPer90",
  "understatXgBuildupPer90",
]);

export type SupplementaryMetricKey = z.infer<typeof SupplementaryMetricKeySchema>;

export const SupplementaryMetricNormalizationSchema = z.enum(["per90", "per30Tip", "percentage", "perShot", "per100", "perAttempt"]);

export type SupplementaryMetricNormalization = z.infer<typeof SupplementaryMetricNormalizationSchema>;

export const SupplementaryPerformanceMetricSchema = z.object({
  key: SupplementaryMetricKeySchema,
  definition: z.string().min(1),
  value: z.number().nullable(),
  unit: z.string(),
  normalization: SupplementaryMetricNormalizationSchema,
  sourceScope: z.enum(["season_position_aggregate"]).optional(),
  sourceField: z.string().min(1),
  sampleMinutes: z.number().nonnegative().nullable(),
  sampleMatches: z.number().int().nonnegative().nullable(),
  sampleAttempts: z.number().int().nonnegative().nullable().optional(),
  sampleAttemptsLabel: z.string().min(1).optional(),
});

export type SupplementaryPerformanceMetric = z.infer<typeof SupplementaryPerformanceMetricSchema>;

export const PlayerProfileSchema = z.object({
  birthDate: z.string().optional(),
  abilityProfile: PlayerAbilityProfileSchema.optional(),
  playerId: z.string(),
  externalPlayerId: z.string().optional(),
  name: z.string(),
  team: z.string(),
  age: z.number().int().nullable(),
  ageSource: z.string().optional(),
  ageVerifiedAt: z.string().optional(),
  position: PlayerPositionSchema,
  positionEvidence: PlayerPositionEvidenceSchema.optional(),
  positionEvidenceByPosition: z.partialRecord(PositionSchema, PlayerPositionEvidenceSchema).optional(),
  competition: z.string(),
  season: z.string(),
  minutes: z.number().nonnegative(),
  appearanceMatchCount: z.number().int().nonnegative().optional(),
  datasetId: z.string().min(1).optional(),
  datasetBuiltAt: z.string().datetime().optional(),
  stats: RawStatsSchema,
  sourceIdentity: PlayerDataSourceIdentitySchema.optional(),
  sourceUrl: z.string().url().optional(),
  availableStats: z.array(RawStatKeySchema).optional(),
  supplementaryMetrics: z.array(SupplementaryPerformanceMetricSchema).optional(),
  eventDataComplete: z.boolean().optional(),
  source: z.string(),
});

export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;

export const Per90Schema = z.object({
  goals: z.number().nullable(),
  assists: z.number().nullable(),
  passesAttempted: z.number().nullable(),
  passCompletionPct: z.number().nullable(),
  longPasses: z.number().nullable(),
  carries: z.number().nullable(),
  pressures: z.number().nullable(),
  tacklesInterceptions: z.number().nullable(),
  shotAssists: z.number().nullable(),
  keyPasses: z.number().nullable(),
});

export type Per90 = z.infer<typeof Per90Schema>;
