import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildRagV2JudgeControls } from "../../src/evaluation/rag-v2-judge-controls.js";
import { estimateRagV2PipelineGatewayCalls, type RagV2QuestionPack } from "../../src/evaluation/rag-v2-evaluation.js";

function packWithIndependentSources(): { packet: RagV2QuestionPack; sourceTexts: Map<string, string> } {
  const sourceTexts = new Map<string, string>();
  const questions = Array.from({ length: 12 }, (_, index) => {
    const passage = `The study ${index} observes a distinct movement pattern in its bounded match sample.`;
    const documentRevisionId = String(index % 6 + 1).repeat(64);
    const sectionId = "section-" + index;
    sourceTexts.set(documentRevisionId + "\n" + sectionId, passage);
    return {
      id: "control-source-question-" + index,
      corpus: "methodology" as const,
      query: `What does study ${index} observe?`,
      factGroupId: "fact-group-" + index,
      split: "development" as const,
      expectedDisposition: "answerable" as const,
      sourceArticleIds: ["article-" + (index % 6)],
      facts: [{
        factId: "fact-" + index,
        statement: passage,
        supportPaths: [[{
          documentRevisionId,
          sectionId,
          startOffset: 0,
          endOffset: passage.length,
          textHash: createHash("sha256").update(passage).digest("hex"),
          sourceId: "source-" + (index % 6),
          articleId: "article-" + (index % 6),
        }]],
      }],
      scopeEvidence: [],
      abstentionBasis: [],
      subjects: [],
      sampleSeasons: [],
      provenance: {
        label: "synthetic_ai_checked" as const,
        generatorModelId: "gateway/model",
        generatorPromptSha256: "a".repeat(64),
        verifierModelId: "gateway/model",
        verifierPromptSha256: "b".repeat(64),
        verifierResult: "passed" as const,
        createdAt: "2026-10-22T00:00:00.000Z",
      },
      indexable: false as const,
    };
  });
  return {
    packet: {
      schemaVersion: "rag-v2-question-pack-v5",
      packetId: "control-pack",
      createdAt: "2026-10-22T00:00:00.000Z",
      qrelsMappingVersion: "reference-evidence-span-v5",
      sourceSnapshotHash: "c".repeat(64),
      generationManifest: {
        modelId: "gateway/model",
        estimatedGatewayAttempts: 24,
        actualGatewayAttempts: 24,
        gatewayAttemptCap: 1_000,
        selectedSectionCount: 12,
        verifiedQuestionCount: 12,
        skippedSectionCount: 0,
        corpusWideAbsentDateCount: 0,
        seededQuestionCount: 0,
        programmaticCrossSourceQuestionCount: 0,
        programmaticQuestionCount: 0,
        pipelineCallBudget: estimateRagV2PipelineGatewayCalls({ selectedSectionCount: 12 }),
      },
      questions,
    },
    sourceTexts,
  };
}

test("judge controls include independently grounded, wrong-citation, omitted-citation, date, and number cases", () => {
  const fixture = packWithIndependentSources();
  const built = buildRagV2JudgeControls(fixture);
  assert.equal(built.ready, true, built.reason ?? "");
  const controls = built.pack!.controls;
  assert.equal(controls.length, 24);
  assert.equal(controls.filter(({ controlType }) => controlType === "grounded_answer").length, 12);
  assert.equal(controls.filter(({ controlType }) => controlType === "wrong_citation").length, 3);
  assert.equal(controls.filter(({ controlType }) => controlType === "omitted_citation").length, 3);
  assert.equal(controls.filter(({ controlType }) => controlType === "unsupported_date").length, 3);
  assert.equal(controls.filter(({ controlType }) => controlType === "unsupported_number").length, 3);
  assert.ok(controls.filter(({ controlType }) => controlType === "wrong_citation").every(({ citedEvidence }) => citedEvidence.length > 0));
  assert.ok(controls.filter(({ controlType }) => controlType === "omitted_citation").every(({ citedEvidence }) => citedEvidence.length === 0));
  assert.ok(controls.filter(({ controlType }) => controlType === "grounded_answer").every(({ citedEvidence, sourceArticleIds }) => citedEvidence.every(({ articleId }) => sourceArticleIds.includes(articleId))));
  assert.ok(controls.filter(({ controlType }) => controlType === "wrong_citation").every(({ citedEvidence, sourceArticleIds }) => citedEvidence.some(({ articleId }) => !sourceArticleIds.includes(articleId))));
  assert.ok(controls.every(({ citedEvidence }) => citedEvidence.every(({ articleId, sourceId }) => articleId.startsWith("article-") && sourceId.startsWith("source-"))));
  assert.ok(controls.every(({ citedEvidence }) => citedEvidence.every(({ id, ref }) => id === createHash("sha256").update(JSON.stringify(ref)).digest("hex"))));
});
