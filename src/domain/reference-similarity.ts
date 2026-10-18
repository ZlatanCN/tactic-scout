import { z } from "zod/v4";

export const ReferenceSimilaritySchema = z.object({
  referenceName: z.string(),
  ability: z.object({ distance: z.number().min(0).max(100), comparedMetrics: z.number().int().positive() }).nullable(),
  performance: z.object({ distance: z.number().min(0).max(100), comparedMetrics: z.number().int().positive() }).nullable(),
});
export type ReferenceSimilarity = z.infer<typeof ReferenceSimilaritySchema>;
