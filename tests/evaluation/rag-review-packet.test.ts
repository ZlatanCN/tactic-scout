import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ragReviewQuestionSetSha256, readRagReviewPacket, recordRagQuestionReview, summarizeRagReviewPacket } from "../../src/evaluation/rag-review-packet.js";

test("human RAG review records update one question and report only fully judged items as complete", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-rag-review-"));
  const filePath = path.join(directory, "packet.json");
  await writeFile(filePath, JSON.stringify({
    packetId: "review-test",
    status: "pending_human_review",
    questions: [{
      id: "P01",
      corpus: "player_report",
      query: "Did the source identify the season?",
      review: { answerSupported: null, citationAccurate: null, abstentionAppropriate: null, reviewerNotes: null, reviewedAt: null },
    }],
  }));

  try {
    const initial = await readRagReviewPacket(filePath);
    const questionSetHash = ragReviewQuestionSetSha256(initial);
    assert.deepEqual(summarizeRagReviewPacket(initial), {
      packetId: "review-test",
      rankingMode: "hybrid",
      questionCount: 1,
      completedCount: 0,
      pendingCount: 1,
      answerSupportedCount: 0,
      citationAccurateCount: 0,
      abstentionAppropriateCount: 0,
      evaluationRunId: null,
      evaluationRunSha256: null,
      allQuestionsReviewed: false,
    });
    const updated = await recordRagQuestionReview({
      questionId: "P01",
      filePath,
      evaluationRunId: "baseline-run-001",
      evaluationRunSha256: "c".repeat(64),
      rankingMode: "hybrid",
      review: {
        answerSupported: true,
        citationAccurate: false,
        abstentionAppropriate: true,
        reviewerNotes: "The source URL was correct but the reference offset was wrong.",
        reviewedAt: "2026-10-21",
      },
    });
    assert.equal(updated.questions[0]?.review.citationAccurate, false);
    assert.equal(updated.status, "review_complete");
    assert.deepEqual(summarizeRagReviewPacket(updated), {
      packetId: "review-test",
      rankingMode: "hybrid",
      questionCount: 1,
      completedCount: 1,
      pendingCount: 0,
      answerSupportedCount: 1,
      citationAccurateCount: 0,
      abstentionAppropriateCount: 1,
      evaluationRunId: "baseline-run-001",
      evaluationRunSha256: "c".repeat(64),
      allQuestionsReviewed: true,
    });
    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), updated);
    await assert.rejects(recordRagQuestionReview({ questionId: "unknown", filePath, evaluationRunId: "baseline-run-001", evaluationRunSha256: "c".repeat(64), rankingMode: "hybrid", review: updated.questions[0]!.review }), /Unknown RAG review question/);
    await assert.rejects(recordRagQuestionReview({
      questionId: "P01",
      filePath,
      evaluationRunId: "baseline-run-001",
      evaluationRunSha256: "c".repeat(64),
      rankingMode: "hybrid",
      review: { answerSupported: true, citationAccurate: true, abstentionAppropriate: true, reviewerNotes: null, reviewedAt: null },
    }), /all three judgments and a review date/);
    assert.equal(updated.questions[0]?.review.evaluationRunId, "baseline-run-001");
    assert.equal(updated.questions[0]?.review.rankingMode, "hybrid");
    assert.equal(ragReviewQuestionSetSha256(updated), questionSetHash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("gateway reranker review is stored separately and cannot complete the hybrid fallback review", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-rag-review-modes-"));
  const filePath = path.join(directory, "packet.json");
  await writeFile(filePath, JSON.stringify({
    packetId: "review-test",
    status: "pending_human_review",
    questions: [{
      id: "P01",
      review: { answerSupported: null, citationAccurate: null, abstentionAppropriate: null, reviewerNotes: null, reviewedAt: null },
    }],
  }));
  try {
    const updated = await recordRagQuestionReview({
      questionId: "P01",
      filePath,
      evaluationRunId: "reranked-run-001",
      evaluationRunSha256: "d".repeat(64),
      rankingMode: "gateway_reranked",
      review: {
        answerSupported: true,
        citationAccurate: true,
        abstentionAppropriate: true,
        reviewerNotes: null,
        reviewedAt: "2026-10-22",
      },
    });
    assert.equal(updated.questions[0]?.review.answerSupported, null);
    assert.equal(updated.questions[0]?.gatewayRerankedReview.rankingMode, "gateway_reranked");
    assert.equal(summarizeRagReviewPacket(updated, "gateway_reranked").allQuestionsReviewed, true);
    assert.equal(summarizeRagReviewPacket(updated, "hybrid").allQuestionsReviewed, false);
    assert.equal(updated.status, "pending_human_review");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
