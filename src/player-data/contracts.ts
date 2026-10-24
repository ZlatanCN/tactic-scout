import { z } from "zod/v3";

const ReferenceSourceRecordSchema = z.object({
  competition: z.string().nullable(),
  name: z.string(),
  provider: z.enum(["understat", "fm"]),
  season: z.string().nullable(),
  sourceId: z.string(),
  team: z.string().nullable(),
});

const ReferenceCandidateSchema = z.object({
  candidateId: z.string(),
  canonicalIdentityId: z.string().nullable(),
  exactNameMatch: z.boolean(),
  identityVerified: z.boolean(),
  name: z.string(),
  records: z.array(ReferenceSourceRecordSchema),
});

const PlayerResolutionSchema = z.object({
  candidateCount: z.number().int().nonnegative(),
  candidates: z.array(ReferenceCandidateSchema),
  candidatesTruncated: z.boolean(),
  canonicalIdentityId: z.string().nullable(),
  clarificationMessage: z.string().nullable(),
  mention: z.string().nullable(),
  selectedCandidateId: z.string().nullable(),
  selectedName: z.string().nullable(),
  status: z.enum([
    "resolved",
    "needs_confirmation",
    "not_found",
    "registry_unavailable",
  ]),
});

type CandidateSourceRecord = z.infer<typeof ReferenceSourceRecordSchema> & {
  exactNameMatch: boolean;
};

type PlayerResolutionState = z.infer<typeof PlayerResolutionSchema>;

type ReferenceCandidate = z.infer<typeof ReferenceCandidateSchema>;

type ReferenceLookupResult = Pick<
  PlayerResolutionState,
  | "status"
  | "mention"
  | "selectedCandidateId"
  | "canonicalIdentityId"
  | "selectedName"
  | "candidates"
  | "candidateCount"
  | "candidatesTruncated"
  | "clarificationMessage"
>;

type PlayerSearchSource = "understat" | "fm" | "both";

type PlayerSearchQuery = {
  limit: number;
  playerName: string;
  seasonStartYear?: number;
  source: PlayerSearchSource;
};

export {
  PlayerResolutionSchema,
  ReferenceCandidateSchema,
  ReferenceSourceRecordSchema,
};

export type {
  CandidateSourceRecord,
  PlayerResolutionState,
  PlayerSearchQuery,
  PlayerSearchSource,
  ReferenceCandidate,
  ReferenceLookupResult,
};
