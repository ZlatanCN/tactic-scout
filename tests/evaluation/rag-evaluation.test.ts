import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { KnowledgeEvidence } from "../../src/knowledge/evidence.js";
import type { EvidenceRetrievalRequest, KnowledgeEvidenceBundle, KnowledgeEvidenceItem } from "../../src/knowledge/evidence-schemas.js";
import { ragEvaluationRequest, renderRagEvaluationRunMarkdown, runRagEvaluation, validateRagAnswerOutput, type RagEvaluationQuestion } from "../../src/evaluation/rag-evaluation.js";
import { ragReviewQuestionSetSha256 } from "../../src/evaluation/rag-review-packet.js";

const passage = "The source passage supports the requested definition.";
const evidenceItem: KnowledgeEvidenceItem = {
  ref: {
    documentRevisionId: "a".repeat(64),
    sectionId: "section-1",
    startOffset: 0,
    endOffset: passage.length,
    textHash: createHash("sha256").update(passage).digest("hex"),
  },
  text: passage,
  rank: 1,
  rankMode: "hybrid",
  source: {
    sourceId: "source-one",
    sourceName: "Source One",
    title: "A verified paper",
    url: "https://example.test/paper",
    author: "A. Researcher",
    publisher: "Example Publisher",
    publishedAt: null,
    license: "CC BY 4.0",
    attribution: "A. Researcher, A verified paper",
    corpus: "methodology",
    displayAllowed: true,
    sourceType: "methodology",
    subjects: [],
    competition: null,
    season: null,
    observedFrom: null,
    observedTo: null,
    sampleSummary: null,
    sectionPath: ["A verified paper", "Definition"],
  },
};

function resultFor(request: EvidenceRetrievalRequest, rankingMode: "hybrid" | "gateway_reranked"): KnowledgeEvidenceBundle {
  const matching = request.kind === "methodology" || request.subjects.some(({ subjectId }) => evidenceItem.source.subjects.some((subject) => subject.subjectId === subjectId));
  return {
    status: matching ? "found" : "not_covered",
    evidence: matching ? [{ ...evidenceItem, rankMode: rankingMode }] : [],
    subjectCoverage: request.kind === "methodology" ? [] : request.subjects.map(({ subjectId }) => ({ subjectId, status: matching ? "found" : "not_covered" })),
    generationId: "generation-1",
    traceId: "00000000-0000-4000-8000-000000000001",
    failureCode: null,
    rankingMode,
    rankingDurationMs: rankingMode === "gateway_reranked" ? 12 : null,
    rankingInputTokens: rankingMode === "gateway_reranked" ? 20 : null,
    rankingOutputTokens: rankingMode === "gateway_reranked" ? 5 : null,
    candidateCount: matching ? 1 : 0,
    budgetMsUsed: 30,
    budgetMsRemaining: 14_970,
  };
}

function fakeEvidence(mode: "hybrid" | "gateway_reranked"): KnowledgeEvidence {
  return {
    admin: {
      async prepareRuntime() { return { ready: true, generationId: "generation-1", failureCode: null }; },
      async status() { return { activeSources: 1, activeDocuments: 1, generationId: "generation-1", indexedChunks: 1, runtimeReady: true, evidenceSnapshotHash: "b".repeat(64) }; },
      async registerSource() { throw new Error("not used"); },
      async registerSources() { throw new Error("not used"); },
      async publishDocument() { throw new Error("not used"); },
      async removeDocument() { throw new Error("not used"); },
      async revokeSource() { throw new Error("not used"); },
      async sourceHistory() { throw new Error("not used"); },
    },
    reader: {
      async retrieve(request) { return resultFor(request, mode); },
      async resolve() { throw new Error("not used"); },
    },
    async close() {},
  };
}

test("ragEvaluationRequest keeps verified player identity and explicit sample bounds", () => {
  const question: RagEvaluationQuestion = {
    id: "P11",
    corpus: "player_report",
    family: "scope_mismatch",
    split: "validation",
    query: "2020 年 Ronaldo 的西甲 PlayeRank 表现如何？",
    expectedDisposition: "abstain",
    expectedSourceIds: ["source-one"],
    answerOutline: ["样本不覆盖 2020"],
    subjects: [{ subjectId: "Q11571", displayName: "Cristiano Ronaldo", aliases: ["Ronaldo"] }],
    sampleFrom: "2020-01-01",
    sampleTo: "2020-12-31",
  };

  assert.deepEqual(ragEvaluationRequest(question), {
    kind: "player_report",
    query: question.query,
    subjects: question.subjects,
    sampleFrom: "2020-01-01",
    sampleTo: "2020-12-31",
    limit: 6,
    perSubjectLimit: 2,
  });
});

test("answer validation rejects unknown and duplicate citations", () => {
  assert.deepEqual(validateRagAnswerOutput({ answer: "Supported.", abstained: false, citedEvidenceIds: ["E1"] }, ["E1"]), { valid: true });
  assert.equal(validateRagAnswerOutput({ answer: "Unsupported.", abstained: false, citedEvidenceIds: ["E2"] }, ["E1"]).valid, false);
  assert.equal(validateRagAnswerOutput({ answer: "Repeated.", abstained: false, citedEvidenceIds: ["E1", "E1"] }, ["E1"]).valid, false);
  assert.equal(validateRagAnswerOutput({ answer: "The passage does not state this.", abstained: true, citedEvidenceIds: [] }, ["E1"], true).valid, false);
});

test("runRagEvaluation records both ranking paths against one pinned snapshot without sending the answer outline to the model", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rag-evaluation-run-"));
  const packetPath = path.join(directory, "packet.json");
  const registryPath = path.join(directory, "sources.json");
  const question: RagEvaluationQuestion = {
    id: "M01",
    corpus: "methodology",
    family: "core_definition",
    split: "calibration",
    query: "What does this paper define?",
    expectedDisposition: "answer",
    expectedSourceIds: ["source-one"],
    answerOutline: ["Expected key phrase"],
  };
  const blankReview = { answerSupported: null, citationAccurate: null, abstentionAppropriate: null, reviewerNotes: null, reviewedAt: null, evaluationRunId: null, rankingMode: null };
  await writeFile(packetPath, `${JSON.stringify({ packetId: "test-packet", status: "pending_human_review", questions: [{ ...question, review: blankReview, gatewayRerankedReview: blankReview }] })}\n`);
  await writeFile(registryPath, "[]\n");
  const modelInputs: unknown[] = [];

  try {
    const run = await runRagEvaluation({
      packetPath,
      sourceRegistryPath: registryPath,
      rankingMode: "both",
      dependencies: {
        runId: "test-run-id",
        now: () => new Date("2026-10-22T00:00:00.000Z"),
        createEvidence: (mode) => fakeEvidence(mode),
        answerModelId: "test-answer-model",
        answerGenerator: {
          async generate(input) {
            modelInputs.push(input);
            return { answer: "A supported answer.", abstained: false, citedEvidenceIds: ["E1"], inputTokens: 12, outputTokens: 4, durationMs: 5 };
          },
        },
      },
    });

    assert.equal(run.packet.completeQuestionSet, true);
    assert.equal(run.packet.questionSetSha256, ragReviewQuestionSetSha256(JSON.parse(await (await import("node:fs/promises")).readFile(packetPath, "utf8"))));
    assert.equal(run.modes.length, 2);
    assert.deepEqual(run.modes.map(({ rankingMode }) => rankingMode), ["hybrid", "gateway_reranked"]);
    assert.deepEqual(run.modes.map(({ summary }) => summary.expectedSourceHitRate), [1, 1]);
    assert.equal(run.modes[1]?.questions[0]?.retrieval.rankingMode, "gateway_reranked");
    assert.equal(modelInputs.length, 2);
    assert.equal(JSON.stringify(modelInputs).includes("Expected key phrase"), false);
    assert.equal(run.packet.sha256, createHash("sha256").update(await (await import("node:fs/promises")).readFile(packetPath)).digest("hex"));
    const markdown = renderRagEvaluationRunMarkdown(run);
    assert.match(markdown, /## hybrid/u);
    assert.match(markdown, /## gateway_reranked/u);
    assert.match(markdown, /A supported answer/u);
    assert.match(markdown, /Stable ref/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
