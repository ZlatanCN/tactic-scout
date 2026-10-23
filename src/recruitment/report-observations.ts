import { createHash } from "node:crypto";
import type { PlayerRecommendation, ReportEvidenceCitation } from "../domain/reports.js";
import type { KnowledgeSearchResult } from "../knowledge/schemas.js";
import type { FinishRecruitmentAction } from "./recruitment-actions.js";

type ObservationInput = FinishRecruitmentAction["reportObservations"][number];
type ProjectedObservation = PlayerRecommendation["reportObservations"][number];

function projectCitation(result: KnowledgeSearchResult): ReportEvidenceCitation | null {
  if (!result.evidenceRef || !result.displayAllowed) return null;
  return {
    documentId: result.documentId,
    evidenceRef: result.evidenceRef,
    excerpt: result.text.slice(0, 1_200),
    ...(result.sampleSummary === undefined ? {} : { sampleSummary: result.sampleSummary }),
    ...(result.competition === undefined ? {} : { competition: result.competition }),
    ...(result.season === undefined ? {} : { season: result.season }),
    ...(result.observedFrom === undefined ? {} : { observedFrom: result.observedFrom }),
    ...(result.observedTo === undefined ? {} : { observedTo: result.observedTo }),
    sectionPath: result.sectionPath ?? [],
    source: {
      sourceId: result.sourceId,
      sourceName: result.sourceName,
      title: result.title,
      url: result.url,
      author: result.author,
      publisher: result.publisher,
      publishedAt: result.publishedAt,
      license: result.license,
      attribution: result.attribution,
      ...(result.evidenceType ? { evidenceType: result.evidenceType } : {}),
    },
  };
}

export function projectMethodologyClaim(
  claim: FinishRecruitmentAction["methodologyClaims"][number],
  retrievedKnowledge: readonly KnowledgeSearchResult[],
): { claimId: string; claimType: "source_finding" | "cross_source_synthesis" | "source_disagreement"; summary: string; limitations: string[]; citations: ReportEvidenceCitation[] } | null {
  if (!claim.evidenceIds.length || new Set(claim.evidenceIds).size !== claim.evidenceIds.length) return null;
  const resultById = new Map(retrievedKnowledge.map((result) => [result.id, result]));
  const results = claim.evidenceIds.map((id) => resultById.get(id));
  if (results.some((result) => !result || result.corpus !== "methodology" || !result.displayAllowed || !result.evidenceRef)) return null;
  const resolved = results as KnowledgeSearchResult[];
  if ((claim.claimType === "cross_source_synthesis" || claim.claimType === "source_disagreement")
    && new Set(resolved.map((result) => result.sourceId)).size < 2) return null;
  const citations = resolved.map(projectCitation);
  if (citations.some((citation) => !citation)) return null;
  const completeCitations = citations as ReportEvidenceCitation[];
  const claimId = createHash("sha256").update(JSON.stringify({
    summary: claim.summary,
    evidenceRefs: completeCitations.map(({ evidenceRef }) => evidenceRef),
  })).digest("hex");
  return {
    claimId,
    claimType: claim.claimType,
    summary: claim.summary,
    limitations: claim.limitations,
    citations: completeCitations,
  };
}

/** Resolve every dependency before producing a claim; partial citation sets never escape. */
export function projectReportObservation(
  observation: ObservationInput,
  retrievedKnowledge: readonly KnowledgeSearchResult[],
): ProjectedObservation | null {
  const resultsById = new Map(retrievedKnowledge.map((result) => [result.id, result]));
  let selected: KnowledgeSearchResult[];
  if (observation.evidenceIds.length) {
    if (new Set(observation.evidenceIds).size !== observation.evidenceIds.length) return null;
    const resolved = observation.evidenceIds.map((id) => resultsById.get(id));
    if (resolved.some((result) => !result)) return null;
    selected = resolved as KnowledgeSearchResult[];
  } else {
    const primary = retrievedKnowledge.find((result) => result.documentId === observation.documentId);
    if (!primary) return null;
    selected = [primary];
  }

  if (!selected.length || selected.some((result) => result.corpus !== "player_report" || !result.displayAllowed || !result.evidenceRef)) return null;
  if (!selected.some((result) => result.documentId === observation.documentId)) return null;
  if ((observation.claimType === "cross_source_synthesis" || observation.claimType === "source_disagreement")
    && new Set(selected.map((result) => result.sourceId)).size < 2) return null;

  const citations = selected.map(projectCitation);
  if (citations.some((citation) => !citation)) return null;
  const completeCitations = citations as ReportEvidenceCitation[];
  const primary = completeCitations.find(({ documentId }) => documentId === observation.documentId)!;
  const claimId = createHash("sha256").update(JSON.stringify({
    playerId: observation.playerId,
    summary: observation.summary,
    evidenceRefs: completeCitations.map(({ evidenceRef }) => evidenceRef),
  })).digest("hex");

  return {
    claimId,
    claimType: observation.claimType,
    summary: observation.summary,
    limitations: observation.limitations,
    verificationStatus: observation.linkedMetricKeys.length ? "linked_to_match_data" : "unverified",
    linkedMetricKeys: observation.linkedMetricKeys,
    documentId: primary.documentId,
    evidenceRef: primary.evidenceRef,
    excerpt: primary.excerpt,
    citations: completeCitations,
    ...(primary.sampleSummary === undefined ? {} : { sampleSummary: primary.sampleSummary }),
    ...(primary.competition === undefined ? {} : { competition: primary.competition }),
    ...(primary.season === undefined ? {} : { season: primary.season }),
    ...(primary.observedFrom === undefined ? {} : { observedFrom: primary.observedFrom }),
    ...(primary.observedTo === undefined ? {} : { observedTo: primary.observedTo }),
    source: primary.source,
  };
}
