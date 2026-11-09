import { z } from "zod/v3";

const ContextProcessingAnchorSchema = z.object({
  kind: z.enum([
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
  ]),
  text: z.string().min(1),
});

const ContextProcessingReferenceSchema = z.object({
  anchorIndex: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),
  text: z.string().min(1),
});

const ContextProcessingReservationSchema = z.object({
  maxActiveTimeMs: z.number().int().positive(),
  operation: z.literal("compact_text"),
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

const ContextProcessingCompactionSchema = z.object({
  activeContextHash: z.string().min(1),
  anchors: z.array(ContextProcessingAnchorSchema),
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
  sourceHash: z.string().min(1),
  sourceMessageId: z.string().min(1),
  sourceTokenEstimate: z.number().int().nonnegative().nullable(),
  status: z.enum([
    "reserved",
    "ready",
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
      "no_reduction",
      "provider_failure",
      "reservation_unknown",
      "source_reference_invalid",
    ])
    .nullable(),
});

const ContextProcessingSchema = z.object({
  allowance: ContextProcessingAllowanceSchema.nullable(),
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

type ContextProcessingCompaction = z.infer<
  typeof ContextProcessingCompactionSchema
>;

type ContextProcessing = z.infer<typeof ContextProcessingSchema>;

const createInitialContextProcessing = (): ContextProcessing => ({
  allowance: null,
  compaction: null,
});

export { ContextProcessingSchema, createInitialContextProcessing };

export type {
  ContextProcessing,
  ContextProcessingAllowance,
  ContextProcessingAnchor,
  ContextProcessingCompaction,
  ContextProcessingReference,
  ContextProcessingReservation,
};
