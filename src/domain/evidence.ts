import { z } from "zod/v4";

/** Stable pointer to an immutable source passage; offsets count UTF-16 code units. */
export const EvidenceRefSchema = z.object({
  documentRevisionId: z.string().regex(/^[a-f0-9]{64}$/),
  sectionId: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  textHash: z.string().regex(/^[a-f0-9]{64}$/),
}).refine((ref) => ref.endOffset > ref.startOffset, {
  message: "证据引用的结束位置必须晚于开始位置。",
  path: ["endOffset"],
});

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
