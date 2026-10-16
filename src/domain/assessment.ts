import { z } from "zod/v4";
import { DatasetModeSchema } from "./datasets.js";
import { Per90Schema, PlayerProfileSchema } from "./players.js";
import { InPossessionRoleSchema, OutOfPossessionRoleSchema, RequirementsSchema, RolePhaseSchema } from "./requirements.js";

export const RoleAssessmentSchema = z.object({
  phase: RolePhaseSchema,
  role: z.union([InPossessionRoleSchema, OutOfPossessionRoleSchema]),
  fit: z.number().min(0).max(100).nullable(),
  evidence: z.array(z.string()),
  unsupportedAttributes: z.array(z.string()),
});

export type RoleAssessment = z.infer<typeof RoleAssessmentSchema>;

export const RankedCandidateSchema = z.object({
  player: PlayerProfileSchema,
  per90: Per90Schema,
  inPossessionFit: z.number().min(0).max(100).nullable(),
  outOfPossessionFit: z.number().min(0).max(100).nullable(),
  tacticalFit: z.number().min(0).max(100),
  score: z.number().min(0).max(100),
  roleAssessments: z.array(RoleAssessmentSchema),
  reasons: z.array(z.string()),
  risks: z.array(z.string()),
});

export type RankedCandidate = z.infer<typeof RankedCandidateSchema>;

export const ReviewSchema = z.object({
  evidenceCompleteness: z.number().min(0).max(1),
  evidenceCoverage: z.number().min(0).max(1),
  findings: z.array(z.string()),
  retryRecommended: z.boolean(),
});

export type Review = z.infer<typeof ReviewSchema>;

export const ScoutResponseSchema = z.object({
  targetTeam: z.string(),
  requirements: RequirementsSchema,
  dataSource: z.string(),
  datasetMode: DatasetModeSchema,
  candidates: z.array(RankedCandidateSchema),
  review: ReviewSchema,
  caveats: z.array(z.string()),
});

export type ScoutResponse = z.infer<typeof ScoutResponseSchema>;
