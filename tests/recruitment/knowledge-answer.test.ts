import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceRef } from "../../src/domain/evidence.js";
import type { KnowledgeSearchResult } from "../../src/knowledge/schemas.js";
import { projectKnowledgeAnswer } from "../../src/recruitment/conversation/knowledge-answer.js";
import { FinishActionSchema } from "../../src/recruitment/recruitment-actions.js";

function evidence(id: string, text = "The study used five folds."): KnowledgeSearchResult {
  const ref: EvidenceRef = {
    documentRevisionId: "a".repeat(64),
    sectionId: "methods",
    startOffset: 0,
    endOffset: text.length,
    textHash: "b".repeat(64),
  };
  return {
    id,
    documentId: "revision-a",
    evidenceRef: ref,
    corpus: "methodology",
    text,
    title: "Study A",
    url: "https://example.test/study-a",
    sourceId: "source-a",
    sourceName: "Study A",
    publisher: "Journal A",
    author: "Author A",
    publishedAt: null,
    license: "CC BY 4.0",
    attribution: "Author A, Study A.",
    entityIds: [],
    entityNames: [],
    competition: null,
    season: null,
    displayAllowed: true,
  };
}

function action(input: { summary: string; evidenceIds: string[]; needSummary?: string }) {
  return FinishActionSchema.parse({
    action: "finish",
    targetTeam: null,
    needSummary: input.needSummary ?? "回答已完成。",
    capabilityProfile: [],
    recommendations: [],
    limitationKeys: [],
    methodologyClaims: [{
      evidenceIds: input.evidenceIds,
      claimType: "source_finding",
      summary: input.summary,
      limitations: [],
    }],
  });
}

test("knowledge answer keeps only resolved displayable evidence and emits claim-level citations", () => {
  const answer = projectKnowledgeAnswer({
    action: action({ summary: "The study used five folds.", evidenceIds: ["citation-a"] }),
    retrievedKnowledge: [evidence("citation-a")],
  });

  assert.equal(answer.status, "answered");
  assert.equal(answer.claims.length, 1);
  assert.deepEqual(answer.claims[0]?.evidenceIds, ["citation-a"]);
  assert.equal(answer.claims[0]?.citations[0]?.excerpt, "The study used five folds.");
});

test("a missing citation suppresses the claim and produces an explicit abstention", () => {
  const answer = projectKnowledgeAnswer({
    action: action({ summary: "The study used five folds.", evidenceIds: ["missing"] }),
    retrievedKnowledge: [evidence("citation-a")],
  });

  assert.equal(answer.status, "abstained");
  assert.equal(answer.claims.length, 0);
  assert.equal(answer.abstentionReason, "evidence_insufficient");
});

test("supported and missing facts produce a partial answer without recruitment report copy", () => {
  const answer = projectKnowledgeAnswer({
    action: action({
      summary: "The study used five folds.",
      evidenceIds: ["citation-a"],
      needSummary: "当前案件的目标画像仍需更多调查。",
    }),
    retrievedKnowledge: [evidence("citation-a")],
  });

  assert.equal(answer.status, "answered");
  assert.equal(answer.claims.length, 1);
  assert.equal(answer.missingFacts.length, 0);
  assert.doesNotMatch(JSON.stringify(answer), /目标画像|候选推荐/iu);
});

test("a partial answer keeps supported claims and reports the requested fact that remains unsupported", () => {
  const answer = projectKnowledgeAnswer({
    action: action({
      summary: "The study used five folds.",
      evidenceIds: ["citation-a"],
      needSummary: "赛季范围在当前资料中没有找到。",
    }),
    retrievedKnowledge: [evidence("citation-a")],
  });

  assert.equal(answer.status, "partial");
  assert.equal(answer.claims.length, 1);
  assert.deepEqual(answer.missingFacts, ["赛季范围在当前资料中没有找到。"]);
  assert.equal(answer.abstentionReason, null);
});
