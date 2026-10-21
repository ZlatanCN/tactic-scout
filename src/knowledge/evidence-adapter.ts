import { createHash } from "node:crypto";
import { KnowledgeSearchResultSchema, type KnowledgeSearchResult } from "./schemas.js";
import type { KnowledgeEvidenceBundle, KnowledgeEvidenceItem } from "./evidence-schemas.js";

export function evidenceReferenceKey(ref: KnowledgeSearchResult["evidenceRef"]): string | null {
  return ref ? JSON.stringify(ref) : null;
}

export function knowledgeSearchResultFromEvidence(item: KnowledgeEvidenceItem): KnowledgeSearchResult {
  return KnowledgeSearchResultSchema.parse({
    id: createHash("sha256").update(JSON.stringify(item.ref)).digest("hex"),
    documentId: item.ref.documentRevisionId,
    evidenceRef: item.ref,
    corpus: item.source.corpus,
    text: item.text,
    title: item.source.title,
    url: item.source.url,
    sourceId: item.source.sourceId,
    sourceName: item.source.sourceName,
    publisher: item.source.publisher,
    author: item.source.author,
    publishedAt: item.source.publishedAt,
    license: item.source.license,
    attribution: item.source.attribution,
    entityIds: item.source.subjects.map(({ subjectId }) => subjectId),
    entityNames: item.source.subjects.map(({ displayName }) => displayName),
    competition: item.source.competition,
    season: item.source.season,
    sampleSummary: item.source.sampleSummary,
    observedFrom: item.source.observedFrom,
    observedTo: item.source.observedTo,
    evidenceType: item.source.sourceType,
    rankMode: item.rankMode,
    displayAllowed: item.source.displayAllowed,
  });
}

export function knowledgeSearchResultsFromEvidence(bundle: KnowledgeEvidenceBundle): KnowledgeSearchResult[] {
  return bundle.evidence.map(knowledgeSearchResultFromEvidence);
}
