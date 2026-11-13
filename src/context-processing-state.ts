import { createHash } from "node:crypto";

import { z } from "zod/v3";

const contextProcessingAnchorKinds = [
  "participant",
  "reference",
  "exclusion",
  "team",
  "condition",
  "date",
  "season",
  "competition",
  "position",
  "number",
  "other",
] as const;

const contextProcessingEvidenceOperation = {
  comparison: "explain_comparison_evidence",
  lookup: "explain_lookup_evidence",
  playerRecommendation: "explain_player_recommendation_evidence",
  teamRecommendation: "explain_team_recommendation_evidence",
} as const;

const contextProcessingEvidenceOperations = [
  contextProcessingEvidenceOperation.lookup,
  contextProcessingEvidenceOperation.comparison,
  contextProcessingEvidenceOperation.playerRecommendation,
  contextProcessingEvidenceOperation.teamRecommendation,
] as const;

const contextProcessingOperationNames = [
  "compact_text",
  "compact_text_chunk",
  ...contextProcessingEvidenceOperations,
  "merge_text_chunks",
] as const;

type ContextProcessingEvidenceOperation =
  (typeof contextProcessingEvidenceOperations)[number];

const ContextProcessingAnchorSchema = z.object({
  kind: z.enum(contextProcessingAnchorKinds),
  text: z.string().min(1),
});

const ContextProcessingReferenceSchema = z.object({
  anchorIndex: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),
  text: z.string().min(1),
});

const ContextProcessingReservationSchema = z.object({
  chunkIndex: z.number().int().nonnegative().nullable().default(null),
  maxActiveTimeMs: z.number().int().positive(),
  maxAdditionalCalls: z.number().int().positive().default(1),
  operation: z.enum(contextProcessingOperationNames),
  operationId: z.string().min(1),
  sourceHash: z.string().min(1),
  sourceMessageId: z.string().min(1),
});

const ContextProcessingAllowanceSchema = z.object({
  consumedActiveTimeMs: z.number().int().nonnegative(),
  consumedAdditionalCalls: z.number().int().nonnegative(),
  maxActiveTimeMs: z.number().int().positive(),
  maxAdditionalCalls: z.number().int().positive(),
  requestId: z.string().min(1),
  reservation: ContextProcessingReservationSchema.nullable(),
  reservedActiveTimeMs: z.number().int().nonnegative().default(0),
});

const ContextProcessingChunkSchema = z.object({
  ambiguities: z.array(z.string()).default([]),
  anchors: z.array(ContextProcessingAnchorSchema),
  end: z.number().int().positive(),
  instruction: z.string().nullable(),
  instructionTokenEstimate: z.number().int().nonnegative().nullable(),
  references: z.array(ContextProcessingReferenceSchema),
  sourceHash: z.string().min(1),
  start: z.number().int().nonnegative(),
  status: z.enum(["pending", "reserved", "ready", "failed"]),
  targetTokenEstimate: z.number().int().positive(),
});

const ContextProcessingMergeGroupSchema = z.object({
  chunks: z.array(ContextProcessingChunkSchema),
  output: ContextProcessingChunkSchema.nullable(),
  status: z.enum(["pending", "reserved", "ready", "failed"]),
});

const ContextProcessingChunkingSchema = z.object({
  chunks: z.array(ContextProcessingChunkSchema),
  mergeGroups: z.array(ContextProcessingMergeGroupSchema).default([]),
  mergeStatus: z.enum(["pending", "reserved", "ready", "failed"]),
  nextStart: z.number().int().nonnegative(),
  sourceHash: z.string().min(1),
  sourceLength: z.number().int().nonnegative(),
  sourceMessageId: z.string().min(1),
});

const ContextProcessingCompactionSchema = z.object({
  activeContextHash: z.string().min(1),
  ambiguities: z.array(z.string()).default([]),
  anchors: z.array(ContextProcessingAnchorSchema),
  chunking: ContextProcessingChunkingSchema.nullable().default(null),
  formatVersion: z.number().int().positive(),
  instruction: z.string().nullable(),
  instructionHash: z.string().nullable(),
  modelConfigurationHash: z.string().min(1),
  outputTokenEstimate: z.number().int().nonnegative().nullable(),
  progress: z.object({
    end: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
  }),
  references: z.array(ContextProcessingReferenceSchema),
  requestId: z.string().min(1),
  sourceClarificationAnswers: z.array(z.string()).default([]),
  sourceHash: z.string().min(1),
  sourceMessageId: z.string().min(1),
  sourceTokenEstimate: z.number().int().nonnegative().nullable(),
  status: z.enum([
    "reserved",
    "ready",
    "chunking",
    "merging",
    "needs_chunking",
    "needs_clarification",
    "failed",
    "unknown",
    "allowance_exhausted",
  ]),
  stopReason: z
    .enum([
      "auxiliary_input_too_large",
      "auxiliary_profile_invalid",
      "allowance_exhausted",
      "ambiguous_conditions",
      "invalid_response",
      "necessary_context_exceeds_limit",
      "no_reduction",
      "provider_failure",
      "provider_overflow",
      "response_truncated",
      "reservation_unknown",
      "source_reference_invalid",
      "token_estimate_failed",
    ])
    .nullable(),
  targetTokenEstimate: z.number().int().nonnegative().nullable().default(null),
});

const ContextProcessingClarificationSchema = z.object({
  answers: z.array(z.string()),
  sourceHash: z.string().min(1),
  sourceMessageId: z.string().min(1),
});

const LookupEvidenceBatchSchema = z.object({
  answer: z.string().nullable(),
  index: z.number().int().nonnegative(),
  projectionJson: z.string(),
  recordRefs: z.array(z.string()),
  status: z.enum(["pending", "reserved", "ready", "failed"]),
});

const EvidenceBatchSchema = z.object({
  batches: z.array(LookupEvidenceBatchSchema),
  failureReason: z
    .enum(["allowance_exhausted", "call_failed", "reservation_unknown"])
    .nullable(),
  questionHash: z.string().min(1),
  requestId: z.string().min(1),
  resultDigest: z.string().min(1),
  source: z.enum(["executed", "saved"]),
  sourceHash: z.string().min(1),
  sourceMessageId: z.string().min(1),
  status: z.enum([
    "pending",
    "processing",
    "complete",
    "allowance_exhausted",
    "failed",
  ]),
});

const LookupEvidenceSchema = EvidenceBatchSchema;

const ComparisonEvidenceSchema = EvidenceBatchSchema;

const PlayerRecommendationEvidenceSchema = EvidenceBatchSchema;

const TeamRecommendationEvidenceSchema = EvidenceBatchSchema;

type EvidenceBatch = z.infer<typeof EvidenceBatchSchema>;

type LookupEvidenceBatch = z.infer<typeof LookupEvidenceBatchSchema>;

const defaultContextProcessingAllowance = {
  maxActiveTimeMs: 120_000,
  maxAdditionalCalls: 6,
} as const;

type ContextProcessingAllowanceConfiguration = {
  maxActiveTimeMs?: number;
  maxAdditionalCalls?: number;
};

const ContextProcessingSchema = z.object({
  allowance: ContextProcessingAllowanceSchema.nullable(),
  clarification: ContextProcessingClarificationSchema.nullable().default(null),
  compaction: ContextProcessingCompactionSchema.nullable(),
});

type ContextProcessingAnchor = z.infer<typeof ContextProcessingAnchorSchema>;

type ContextProcessingReference = z.infer<
  typeof ContextProcessingReferenceSchema
>;

type ContextProcessingReservation = z.infer<
  typeof ContextProcessingReservationSchema
>;

type ContextProcessingAllowance = z.infer<
  typeof ContextProcessingAllowanceSchema
>;

type ContextProcessingChunk = z.infer<typeof ContextProcessingChunkSchema>;

type ContextProcessingChunking = z.infer<
  typeof ContextProcessingChunkingSchema
>;

type ContextProcessingMergeGroup = z.infer<
  typeof ContextProcessingMergeGroupSchema
>;

type ContextProcessingCompaction = z.infer<
  typeof ContextProcessingCompactionSchema
>;

type ContextProcessingClarification = z.infer<
  typeof ContextProcessingClarificationSchema
>;

type ContextProcessing = z.infer<typeof ContextProcessingSchema>;

const contextProcessingHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const contextProcessingRequestId = (
  messageId: string | undefined,
  sourceText: string,
  messageCount: number
): string =>
  messageId !== undefined && messageId.length > 0
    ? `message:${messageId}`
    : `message:${messageCount}:${contextProcessingHash(sourceText)}`;

const contextProcessingRequestMatches = (
  identity: { sourceHash: string; sourceRequestId: string },
  messageId: string | undefined,
  sourceText: string,
  messageCount: number
): boolean =>
  identity.sourceHash === contextProcessingHash(sourceText) &&
  identity.sourceRequestId ===
    contextProcessingRequestId(messageId, sourceText, messageCount);

const createInitialContextProcessing = (): ContextProcessing => ({
  allowance: null,
  clarification: null,
  compaction: null,
});

const contextProcessingInputText = (
  sourceText: string,
  sourceMessageId: string,
  clarification: ContextProcessingClarification | null
): string => {
  if (
    clarification === null ||
    clarification.sourceMessageId !== sourceMessageId ||
    clarification.sourceHash !== contextProcessingHash(sourceText) ||
    clarification.answers.length === 0
  ) {
    return sourceText;
  }

  const answers = clarification.answers.map(
    (answer) => `User clarification: ${answer}`
  );

  return [sourceText, ...answers].join("\n\n");
};

export {
  ContextProcessingSchema,
  defaultContextProcessingAllowance,
  ComparisonEvidenceSchema,
  contextProcessingEvidenceOperation,
  contextProcessingEvidenceOperations,
  contextProcessingOperationNames,
  ContextProcessingChunkSchema,
  ContextProcessingChunkingSchema,
  ContextProcessingMergeGroupSchema,
  LookupEvidenceSchema,
  PlayerRecommendationEvidenceSchema,
  TeamRecommendationEvidenceSchema,
  contextProcessingAnchorKinds,
  contextProcessingHash,
  contextProcessingInputText,
  contextProcessingRequestId,
  contextProcessingRequestMatches,
  createInitialContextProcessing,
};

export type {
  ContextProcessing,
  ContextProcessingAllowanceConfiguration,
  ContextProcessingEvidenceOperation,
  EvidenceBatch,
  ContextProcessingAllowance,
  ContextProcessingAnchor,
  ContextProcessingChunk,
  ContextProcessingChunking,
  ContextProcessingMergeGroup,
  ContextProcessingCompaction,
  ContextProcessingClarification,
  ContextProcessingReference,
  ContextProcessingReservation,
  LookupEvidenceBatch,
};
