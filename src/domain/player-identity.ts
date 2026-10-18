import { z } from "zod/v4";

/** Local IDs identify a source record, never an inferred cross-source person. */
export const PlayerIdentityIdSchema = z.string().regex(/^(?:Q\d+|local:[a-f0-9]{64})$/);
export const PlayerIdentitySourceUrlSchema = z.string().regex(/^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/);

export const PlayerIdentityCandidateSchema = z.object({
  entityId: PlayerIdentityIdSchema,
  sourceUrl: PlayerIdentitySourceUrlSchema.optional(),
  names: z.array(z.string().min(1)).min(1).max(100),
  preferredName: z.string().min(1),
  description: z.string().optional(),
  recordIds: z.array(z.string().min(1)).max(30).optional(),
  birthDate: z.string().optional(),
  match: z.enum(["exact_label", "exact_alias", "similar_name", "web_corroborated", "user_confirmed", "local_exact", "model_suggestion", "previous_confirmation"]),
});
export type PlayerIdentityCandidate = z.infer<typeof PlayerIdentityCandidateSchema>;

export interface PlayerIdentityContext {
  scopeId?: string;
  queryHint?: string;
  forceRecheck?: boolean;
  excludedIds?: readonly string[];
  excludedRecordIds?: readonly string[];
  clues?: readonly { kind: "team" | "nationality" | "position" | "era"; value: string; quote: string }[];
}
