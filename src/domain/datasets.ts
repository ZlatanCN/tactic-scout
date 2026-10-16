import { z } from "zod/v4";

export const DatasetModeSchema = z.enum(["demo", "statsbomb", "sportmonks", "skillcorner", "wyscout", "fbref", "fpl", "premier_league", "asa", "understat", "mosaic", "curated"]);

export type DatasetMode = z.infer<typeof DatasetModeSchema>;

export const DatasetScopeSchema = z.object({
  kind: z.enum(["fictional_demo", "historical_sample", "current_limited"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  limitations: z.array(z.string().min(1)),
  datasetId: z.string().min(1).optional(),
  datasetBuiltAt: z.string().datetime().optional(),
  observedCoverage: z.object({
    playerRecordCount: z.number().int().nonnegative(),
    competitions: z.array(z.string().min(1)),
    seasons: z.array(z.string().min(1)),
  }).optional(),
});

export type DatasetScope = z.infer<typeof DatasetScopeSchema>;

export const DatasetSnapshotStatusSchema = z.object({
  datasetId: z.string().min(1),
  builtAt: z.string().datetime(),
  playerSeasonRecords: z.number().int().nonnegative(),
  uniquePlayers: z.number().int().nonnegative(),
  teams: z.number().int().nonnegative(),
  matches: z.number().int().nonnegative(),
  competitions: z.array(z.string()),
  seasons: z.array(z.string()),
  metrics: z.array(z.object({
    key: z.string().min(1),
    availableRecords: z.number().int().nonnegative(),
    totalRecords: z.number().int().nonnegative(),
    coverageRatio: z.number().min(0).max(1),
    unit: z.string(),
  })),
});

export type DatasetSnapshotStatus = z.infer<typeof DatasetSnapshotStatusSchema>;

export const DatasetStatusSchema = z.object({
  mode: DatasetModeSchema,
  source: z.string(),
  snapshot: DatasetSnapshotStatusSchema.nullable().optional(),
});

export type DatasetStatus = z.infer<typeof DatasetStatusSchema>;
