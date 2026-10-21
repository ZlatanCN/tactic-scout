import { z } from "zod/v4";
import { EvidenceRefSchema } from "../domain/evidence.js";

export const KnowledgeCorpusSchema = z.enum(["methodology", "player_report"]);
export type KnowledgeCorpus = z.infer<typeof KnowledgeCorpusSchema>;

export const KnowledgeRightsSchema = z.object({
  automatedFetch: z.boolean(),
  persistentStorage: z.boolean(),
  aiProcessing: z.boolean(),
  display: z.boolean(),
});

export const KnowledgeSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  publisher: z.string().min(1),
  rightsUrl: z.string().url(),
  license: z.string().min(1),
  allowedCorpora: z.array(KnowledgeCorpusSchema).min(1),
  allowedUrlPrefixes: z.array(z.string().url()).min(1),
  rights: KnowledgeRightsSchema,
  rightsVerifiedAt: z.string().min(1),
  rightsNote: z.string().min(1),
});
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;

export const KnowledgeDocumentInputSchema = z.object({
  sourceId: z.string().min(1),
  corpus: KnowledgeCorpusSchema,
  title: z.string().min(1),
  url: z.string().url(),
  author: z.string().min(1),
  publisher: z.string().min(1),
  publishedAt: z.string().nullable().default(null),
  license: z.string().min(1),
  attribution: z.string().min(1),
  entityIds: z.array(z.string().min(1)).default([]),
  entityNames: z.array(z.string().min(1)).default([]),
  competition: z.string().nullable().default(null),
  season: z.string().nullable().default(null),
  acquisition: z.enum(["authorized_fetch", "manual_import", "authored"]),
  content: z.string().trim().min(40).max(200_000),
});
export type KnowledgeDocumentInput = z.infer<typeof KnowledgeDocumentInputSchema>;

export const KnowledgePlayerContextSchema = z.object({
  playerName: z.string().trim().min(1),
  team: z.string().trim().min(1),
  competition: z.string().trim().min(1),
  season: z.string().trim().min(1),
  /** Exact identifiers from the evaluated record; never inferred from a name. */
  verifiedSubjectIds: z.array(z.string().trim().min(3)).max(12).optional(),
});
export type KnowledgePlayerContext = z.infer<typeof KnowledgePlayerContextSchema>;

export const KnowledgeSearchRequestSchema = z.object({
  corpus: KnowledgeCorpusSchema,
  query: z.string().trim().min(2).max(2000),
  playerNames: z.array(z.string().min(1)).max(20).default([]),
  capabilityGaps: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  playerContexts: z.array(KnowledgePlayerContextSchema).max(10).optional(),
  limit: z.number().int().min(1).max(12).default(6),
}).refine((request) => request.corpus !== "player_report" || request.playerNames.length > 0, {
  message: "球员报告检索必须提供至少一个球员实体名称。",
  path: ["playerNames"],
});
export type KnowledgeSearchRequest = z.infer<typeof KnowledgeSearchRequestSchema>;

export const KnowledgeSearchResultSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  /** Stable reference into an immutable SQLite document revision. */
  evidenceRef: EvidenceRefSchema.optional(),
  corpus: KnowledgeCorpusSchema,
  text: z.string(),
  title: z.string(),
  url: z.string().url(),
  sourceId: z.string(),
  sourceName: z.string(),
  publisher: z.string(),
  author: z.string(),
  publishedAt: z.string().nullable(),
  license: z.string(),
  attribution: z.string(),
  entityIds: z.array(z.string()),
  entityNames: z.array(z.string()),
  competition: z.string().nullable(),
  season: z.string().nullable(),
  sampleSummary: z.string().nullable().optional(),
  observedFrom: z.iso.date().nullable().optional(),
  observedTo: z.iso.date().nullable().optional(),
  evidenceType: z.enum(["methodology", "external_report", "historical_player_analysis", "first_party_observation"]).optional(),
  rankMode: z.enum(["hybrid", "gateway_reranked", "hybrid_degraded"]).optional(),
  matchedCapabilityGaps: z.array(z.string()).optional(),
  displayAllowed: z.boolean(),
});
export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResultSchema>;

export const KnowledgeStatusSchema = z.object({
  indexedChunks: z.number().int().nonnegative(),
  methodologyChunks: z.number().int().nonnegative(),
  playerReportChunks: z.number().int().nonnegative(),
  registeredSources: z.number().int().nonnegative(),
  methodologySourceIds: z.array(z.string().min(1)).default([]),
  ingestiblePlayerReportSources: z.number().int().nonnegative(),
  embeddingModel: z.string(),
  indexPath: z.string(),
});
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>;

export class KnowledgePermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgePermissionError";
  }
}
