import type { KnowledgeEvidence } from "../knowledge/evidence.js";
import { KnowledgeEvidenceDocumentInputSchema } from "../knowledge/evidence-schemas.js";
import { knowledgeEvidenceDocumentId } from "../knowledge/evidence.js";
import type { KnowledgeDocumentInput } from "../knowledge/schemas.js";
import type { PlayerObservationIndex } from "./library.js";

export function createKnowledgeEvidenceObservationIndex(system: KnowledgeEvidence): PlayerObservationIndex {
  return {
    documentId(input) {
      return knowledgeEvidenceDocumentId({ sourceId: input.sourceId, corpus: input.corpus, url: input.url });
    },
    canIndex(input) {
      return input.entityIds.some((subjectId) => {
        const separator = subjectId.indexOf(":");
        return separator > 0 && separator < subjectId.length - 1
          && subjectId.slice(0, separator).toLocaleLowerCase() !== "local";
      });
    },
    async ingest(input: KnowledgeDocumentInput) {
      const document = KnowledgeEvidenceDocumentInputSchema.parse({
        ...input,
        evidenceType: "first_party_observation",
        sampleSummary: [input.competition, input.season].filter(Boolean).join(" · ") || "观察记录未提供赛事和赛季范围。",
        sections: [{
          id: "observation-body",
          heading: "观察者记录",
          kind: "paragraph",
          text: input.content,
          locator: "observation/body",
        }],
      });
      const published = await system.admin.publishDocument(document);
      return { documentId: published.documentId, chunkCount: published.indexedChunks };
    },
    removeDocument(documentId) {
      return system.admin.removeDocument(documentId);
    },
  };
}
