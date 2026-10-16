import { z } from "zod/v4";

export const PlayerEloSignalSchema = z.object({
  provider: z.literal("PlayerElo"),
  providerPlayerId: z.string().min(1),
  playerName: z.string().min(1),
  elo: z.number().finite(),
  earLabel: z.string().nullable(),
  currentTeam: z.string().nullable(),
  currentLeague: z.string().nullable(),
  position: z.string().nullable(),
  identityMatch: z.enum(["exact_provider_id", "reep_crosswalk"]),
  identitySourceProvider: z.string().min(1),
  identitySourcePlayerId: z.string().min(1),
  identityCrosswalk: z.object({
    provider: z.literal("Reep"),
    releaseStamp: z.string().min(1),
    canonicalId: z.string().min(1),
    sourceRungs: z.array(z.string()),
    apiFootballRungs: z.array(z.string()),
  }).nullable().optional(),
  retrievedAt: z.string().datetime(),
}).refine(
  (signal) => signal.identityMatch !== "reep_crosswalk" || signal.identityCrosswalk != null,
  { path: ["identityCrosswalk"], message: "Reep crosswalk signals require crosswalk provenance." },
);

export type PlayerEloSignal = z.infer<typeof PlayerEloSignalSchema>;

export const ExternalSignalCoverageSchema = z.object({
  status: z.enum(["disabled", "not_run", "complete", "partial", "failed"]),
  disabledReason: z.enum(["api_key_missing", "report_display_not_allowed", "local_retention_not_allowed"]).nullable(),
  identityUnavailableCandidates: z.number().int().nonnegative(),
  directIdentityCandidates: z.number().int().nonnegative().default(0),
  crosswalkIdentityCandidates: z.number().int().nonnegative().default(0),
  checkedCandidates: z.number().int().nonnegative(),
  matchedCandidates: z.number().int().nonnegative(),
  failedCandidates: z.number().int().nonnegative(),
});

export type ExternalSignalCoverage = z.infer<typeof ExternalSignalCoverageSchema>;

export function createEmptyExternalSignalCoverage(
  status: ExternalSignalCoverage["status"] = "not_run",
  disabledReason: ExternalSignalCoverage["disabledReason"] = null,
): ExternalSignalCoverage {
  return {
    status,
    disabledReason,
    identityUnavailableCandidates: 0,
    directIdentityCandidates: 0,
    crosswalkIdentityCandidates: 0,
    checkedCandidates: 0,
    matchedCandidates: 0,
    failedCandidates: 0,
  };
}

export const HistoricalArchiveMetricSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number().finite(),
  unit: z.string(),
  definition: z.string().min(1),
  sourceField: z.string().min(1),
});

export const HistoricalArchiveSampleSchema = z.object({
  provider: z.literal("Wyscout Open Data"),
  providerPlayerId: z.string().min(1),
  playerName: z.string().min(1),
  team: z.string().min(1),
  competition: z.string().min(1),
  season: z.string().min(1),
  minutes: z.number().nonnegative(),
  metrics: z.array(HistoricalArchiveMetricSchema),
  license: z.literal("CC BY 4.0"),
  licenseUrl: z.literal("https://creativecommons.org/licenses/by/4.0/"),
  attribution: z.string().min(1),
  sourceUrl: z.string().url(),
  identityLink: z.object({
    reepReleaseStamp: z.string().min(1),
    reepId: z.string().min(1),
    sourceProvider: z.string().min(1),
    sourcePlayerId: z.string().min(1),
    sourceBridge: z.object({
      provider: z.string().min(1),
      namespace: z.string().min(1),
      externalId: z.string().min(1),
      sourceField: z.string().min(1).nullable(),
    }).optional(),
    sourceRung: z.string().nullable(),
    archiveRung: z.string().nullable(),
    sourceUpstreamStatus: z.string().nullable(),
    archiveUpstreamStatus: z.string().nullable(),
  }),
});

export type HistoricalArchiveSample = z.infer<typeof HistoricalArchiveSampleSchema>;

export const HistoricalArchiveCoverageSchema = z.object({
  status: z.enum(["disabled", "not_run", "complete", "partial", "failed"]),
  disabledReason: z.enum([
    "report_display_not_allowed",
    "local_retention_not_allowed",
    "reep_index_missing",
    "wyscout_archive_missing",
    "primary_source_is_archive",
  ]).nullable(),
  checkedCandidates: z.number().int().nonnegative(),
  mappedCandidates: z.number().int().nonnegative(),
  matchedCandidates: z.number().int().nonnegative(),
  failedCandidates: z.number().int().nonnegative(),
});

export type HistoricalArchiveCoverage = z.infer<typeof HistoricalArchiveCoverageSchema>;
