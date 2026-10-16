import { z } from "zod/v4";
import { CapabilityEvidenceSchema } from "./capabilities.js";

export const CandidateIdentityResolutionStatusSchema = z.enum([
  "not_run",
  "resolved",
  "ambiguous",
  "not_found",
  "de_corroborated",
  "withheld",
  "target_not_published",
  "unsupported_provider",
  "registry_unavailable",
  "missing_source_identity",
]);

export type CandidateIdentityResolutionStatus = z.infer<typeof CandidateIdentityResolutionStatusSchema>;

export const CandidateIdentityCoverageSchema = z.object({
  registryAvailable: z.boolean(),
  releaseStamp: z.string().nullable(),
  sourceRecordCount: z.number().int().nonnegative(),
  resolvedIdentityCount: z.number().int().nonnegative(),
  resolvedSourceRecordCount: z.number().int().nonnegative(),
  unresolvedSourceRecordCount: z.number().int().nonnegative(),
  resolutionStatusCounts: z.array(z.object({
    status: CandidateIdentityResolutionStatusSchema,
    count: z.number().int().nonnegative(),
  })),
});

export type CandidateIdentityCoverage = z.infer<typeof CandidateIdentityCoverageSchema>;

export const CandidateIdentitySourceEvidenceSchema = z.object({
  sourceRecordId: z.string().min(1),
  source: z.string().min(1),
  provider: z.string().min(1),
  team: z.string().min(1),
  competition: z.string().min(1),
  season: z.string().min(1),
  retrievedAt: z.string().datetime().nullable(),
  minutes: z.number().nonnegative(),
  evaluated: z.boolean(),
  sourceUrl: z.string().url().optional(),
  evidence: z.array(CapabilityEvidenceSchema),
});

export type CandidateIdentitySourceEvidence = z.infer<typeof CandidateIdentitySourceEvidenceSchema>;
