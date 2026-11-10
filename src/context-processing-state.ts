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
  operation: z.enum([
    "compact_text",
    "compact_text_chunk",
    "merge_text_chunks",
  ]),
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

const ContextProcessingChunkingSchema = z.object({
  chunks: z.array(ContextProcessingChunkSchema),
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

type ContextProcessingCompaction = z.infer<
  typeof ContextProcessingCompactionSchema
>;

type ContextProcessingClarification = z.infer<
  typeof ContextProcessingClarificationSchema
>;

type ContextProcessing = z.infer<typeof ContextProcessingSchema>;

const contextProcessingHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

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
  ContextProcessingChunkSchema,
  ContextProcessingChunkingSchema,
  contextProcessingAnchorKinds,
  contextProcessingHash,
  contextProcessingInputText,
  createInitialContextProcessing,
};

export type {
  ContextProcessing,
  ContextProcessingAllowance,
  ContextProcessingAnchor,
  ContextProcessingChunk,
  ContextProcessingChunking,
  ContextProcessingCompaction,
  ContextProcessingClarification,
  ContextProcessingReference,
  ContextProcessingReservation,
};
