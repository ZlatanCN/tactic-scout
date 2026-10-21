import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readRagReviewPacket, recordRagQuestionReview, summarizeRagReviewPacket } from "../../src/evaluation/rag-review-packet.js";

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
    assert.deepEqual(summarizeRagReviewPacket(initial), {
      packetId: "review-test",
      questionCount: 1,
      completedCount: 0,
      pendingCount: 1,
      answerSupportedCount: 0,
      citationAccurateCount: 0,
      abstentionAppropriateCount: 0,
      allQuestionsReviewed: false,
    });
    const updated = await recordRagQuestionReview({
      questionId: "P01",
      filePath,
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
      questionCount: 1,
      completedCount: 1,
      pendingCount: 0,
      answerSupportedCount: 1,
      citationAccurateCount: 0,
      abstentionAppropriateCount: 1,
      allQuestionsReviewed: true,
    });
    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), updated);
    await assert.rejects(recordRagQuestionReview({ questionId: "unknown", filePath, review: updated.questions[0]!.review }), /Unknown RAG review question/);
    await assert.rejects(recordRagQuestionReview({
      questionId: "P01",
      filePath,
      review: { answerSupported: true, citationAccurate: true, abstentionAppropriate: true, reviewerNotes: null, reviewedAt: null },
    }), /all three judgments and a review date/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
