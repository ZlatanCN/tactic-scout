import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceRef } from "../../src/domain/evidence.js";
import type { KnowledgeSearchResult } from "../../src/knowledge/schemas.js";
import { projectMethodologyClaim, projectReportObservation } from "../../src/recruitment/report-observations.js";
import { FinishActionSchema } from "../../src/recruitment/recruitment-actions.js";

function reference(revision: string, section: string, start: number): EvidenceRef {
  return {
    documentRevisionId: revision.repeat(64),
    sectionId: section,
    startOffset: start,
    endOffset: start + 12,
    textHash: "a".repeat(64),
  };
}

function result(id: string, documentId: string, sourceId: string, start: number): KnowledgeSearchResult {
  return {
    id,
    documentId,
    evidenceRef: reference(sourceId === "source-a" ? "1" : "2", `section-${id}`, start),
    corpus: "player_report",
    text: `Original report passage ${id}.`,
    title: `Source ${sourceId}`,
    url: `https://example.test/${id}`,
    sourceId,
    sourceName: sourceId,
    publisher: "Publisher",
    author: "Author",
    publishedAt: null,
    license: "CC BY 4.0",
    attribution: "Attributed source.",
    entityIds: ["wikidata:Q123"],
    entityNames: ["Example Player"],
    competition: null,
    season: null,
    displayAllowed: true,
  };
}

const observation = FinishActionSchema.parse({
  action: "finish",
  targetTeam: null,
  needSummary: "A multi-source report claim.",
  capabilityProfile: [],
  recommendations: [],
  limitationKeys: [],
  reportObservations: [{
    playerId: "candidate-1",
    documentId: "revision-a",
    evidenceIds: ["chunk-a", "chunk-b"],
    claimType: "cross_source_synthesis",
    summary: "Both reports describe a similar observed movement pattern.",
    limitations: ["The reports do not establish a current-season ability."],
    linkedMetricKeys: [],
  }],
}).reportObservations[0]!;

test("one report claim preserves exact citations from multiple sources", () => {
  const projected = projectReportObservation(observation, [
    result("chunk-a", "revision-a", "source-a", 18),
    result("chunk-b", "revision-b", "source-b", 42),
  ]);

  assert.ok(projected);
  assert.equal(projected.claimType, "cross_source_synthesis");
  assert.equal(projected.citations.length, 2);
  assert.deepEqual(projected.citations.map(({ documentId }) => documentId), ["revision-a", "revision-b"]);
  assert.deepEqual(projected.citations.map(({ evidenceRef }) => evidenceRef.startOffset), [18, 42]);
  assert.deepEqual(projected.limitations, ["The reports do not establish a current-season ability."]);
});

test("a claim is suppressed when any required citation is missing, non-displayable, or not cross-source", () => {
  assert.equal(projectReportObservation(observation, [result("chunk-a", "revision-a", "source-a", 18)]), null);
  assert.equal(projectReportObservation(observation, [
    result("chunk-a", "revision-a", "source-a", 18),
    { ...result("chunk-b", "revision-b", "source-b", 42), displayAllowed: false },
  ]), null);
  assert.equal(projectReportObservation(observation, [
    result("chunk-a", "revision-a", "source-a", 18),
    result("chunk-b", "revision-b", "source-a", 42),
  ]), null);
});

test("methodology claims return all exact citations and preserve authored-source attribution", () => {
  const action = FinishActionSchema.parse({
    action: "finish",
    targetTeam: null,
    needSummary: "Methodology references.",
    capabilityProfile: [],
    recommendations: [],
    limitationKeys: [],
    methodologyClaims: [{
      evidenceIds: ["method-a", "method-b"],
      claimType: "cross_source_synthesis",
      summary: "Both method sources emphasize observable match context.",
      limitations: ["These sources do not establish a player-specific current-season fact."],
    }],
  });
  const methodology = [
    { ...result("method-a", "revision-a", "source-a", 11), corpus: "methodology" as const, evidenceType: "methodology" as const },
    { ...result("method-b", "revision-b", "source-b", 27), corpus: "methodology" as const, evidenceType: "methodology" as const, attribution: "Project-authored method summary; not paper text." },
  ];
  const claim = projectMethodologyClaim(action.methodologyClaims[0]!, methodology);
  assert.ok(claim);
  assert.equal(claim.claimType, "cross_source_synthesis");
  assert.equal(claim.citations.length, 2);
  assert.equal(claim.citations[1]?.source.attribution, "Project-authored method summary; not paper text.");
  assert.deepEqual(claim.citations.map(({ evidenceRef }) => evidenceRef.startOffset), [11, 27]);
  assert.equal(projectMethodologyClaim(action.methodologyClaims[0]!, methodology.slice(0, 1)), null);
});

test("a source disagreement keeps both source passages and their separate attribution", () => {
  const action = FinishActionSchema.parse({
    action: "finish",
    targetTeam: null,
    needSummary: "The sources report different results.",
    capabilityProfile: [],
    recommendations: [],
    limitationKeys: [],
    methodologyClaims: [{
      evidenceIds: ["method-a", "method-b"],
      claimType: "source_disagreement",
      summary: "Study A reports a positive association; Study B does not find the same effect in its sample.",
      limitations: ["The studies use different samples and are not directly comparable."],
    }],
  });
  const methodology = [
    { ...result("method-a", "revision-a", "source-a", 11), corpus: "methodology" as const, evidenceType: "methodology" as const, text: "Study A reports a positive association." },
    { ...result("method-b", "revision-b", "source-b", 27), corpus: "methodology" as const, evidenceType: "methodology" as const, text: "Study B reports no association in its sample." },
  ];

  const claim = projectMethodologyClaim(action.methodologyClaims[0]!, methodology);
  assert.ok(claim);
  assert.equal(claim.claimType, "source_disagreement");
  assert.deepEqual(claim.citations.map(({ source, excerpt }) => [source.sourceId, excerpt]), [
    ["source-a", "Study A reports a positive association."],
    ["source-b", "Study B reports no association in its sample."],
  ]);
  assert.deepEqual(claim.limitations, ["The studies use different samples and are not directly comparable."]);
});
