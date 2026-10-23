import { MessagesZodState } from "@langchain/langgraph";
import { z } from "zod/v3";

const ReferenceSourceRecordSchema = z.object({
  provider: z.enum(["understat", "fm"]),
  sourceId: z.string(),
  name: z.string(),
  team: z.string().nullable(),
  competition: z.string().nullable(),
  season: z.string().nullable(),
});

const ReferenceCandidateSchema = z.object({
  candidateId: z.string(),
  name: z.string(),
  canonicalIdentityId: z.string().nullable(),
  identityVerified: z.boolean(),
  exactNameMatch: z.boolean(),
  records: z.array(ReferenceSourceRecordSchema),
});

const ReferenceResolutionSchema = z.object({
  status: z.enum([
    "not_processed",
    "not_required",
    "resolved",
    "needs_confirmation",
    "not_found",
    "registry_unavailable",
    "clarification_exhausted",
  ]),
  mention: z.string().nullable(),
  selectedCandidateId: z.string().nullable(),
  canonicalIdentityId: z.string().nullable(),
  selectedName: z.string().nullable(),
  candidates: z.array(ReferenceCandidateSchema),
  candidateCount: z.number().int().nonnegative(),
  candidatesTruncated: z.boolean(),
  processedMessageId: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  clarificationMessage: z.string().nullable(),
});

const initialReferenceResolution = {
  status: "not_processed" as const,
  mention: null,
  selectedCandidateId: null,
  canonicalIdentityId: null,
  selectedName: null,
  candidates: [],
  candidateCount: 0,
  candidatesTruncated: false,
  processedMessageId: null,
  attempts: 0,
  clarificationMessage: null,
};

const AgentState = MessagesZodState.extend({
  referenceResolution: ReferenceResolutionSchema.default(
    () => initialReferenceResolution,
  ),
  referenceAnswer: z.string().nullable().default(null),
});

type AgentStateType = z.infer<typeof AgentState>;
type ReferenceCandidate = z.infer<typeof ReferenceCandidateSchema>;
type ReferenceResolutionState = z.infer<typeof ReferenceResolutionSchema>;
type ReferenceLookupResult = Pick<
  ReferenceResolutionState,
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

export { AgentState };
export type {
  AgentStateType,
  ReferenceCandidate,
  ReferenceLookupResult,
  ReferenceResolutionState,
};
