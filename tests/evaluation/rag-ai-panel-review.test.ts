import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { isAcceptedRagAiPanelReview, RagAiPanelReviewSchema } from "../../src/evaluation/rag-ai-panel-review.js";
import { ragReviewQuestionSetSha256 } from "../../src/evaluation/rag-review-packet.js";

const blankReview = {
  answerSupported: null,
  citationAccurate: null,
  abstentionAppropriate: null,
  reviewerNotes: null,
  reviewedAt: null,
  evaluationRunId: null,
  evaluationRunSha256: null,
  rankingMode: null,
};

function panelFixture() {
  const packet = {
    packetId: "dual-rag-review-v1",
    status: "pending_human_review",
    createdAt: "2026-10-21",
    sourceSnapshot: [],
    questions: Array.from({ length: 24 }, (_, index) => ({
      id: `Q${String(index + 1).padStart(2, "0")}`,
      query: `Question ${index + 1}`,
      review: { ...blankReview },
      gatewayRerankedReview: { ...blankReview },
    })),
  };
  const packetText = `${JSON.stringify(packet, null, 2)}\n`;
  const reviewers = ["panel-a", "panel-b", "panel-c"].map((id) => ({
    id,
    kind: "ai_subagent" as const,
    isolatedContext: true as const,
    initialRoundBlind: true as const,
    sawExpectedAnswerOutline: false as const,
    sawAnonymizedPeerRationalesInDiscussion: true as const,
  }));
  const vote = (reviewerId: string) => ({
    reviewerId,
    answerSupported: "yes" as const,
    citationAccurate: "yes" as const,
    abstentionAppropriate: "yes" as const,
    rationale: "The answer and citation match the supplied passage.",
  });
  const review = RagAiPanelReviewSchema.parse({
    schemaVersion: "rag-ai-panel-review-v1",
    reviewMode: "blind_ai_panel",
    createdAt: "2026-10-22T00:00:00.000Z",
    reviewers,
    discussionRoundComplete: true,
    packet: {
      packetId: packet.packetId,
      sha256: createHash("sha256").update(packetText).digest("hex"),
      questionSetSha256: ragReviewQuestionSetSha256(packet),
      questionCount: packet.questions.length,
      completeQuestionSet: true,
    },
    sourceRegistrySha256: "a".repeat(64),
    evaluation: {
      runId: "panel-test-run-001",
      runSha256: "b".repeat(64),
      rankingMode: "hybrid",
      generationId: "generation-001",
      evidenceSnapshotHash: "c".repeat(64),
      embeddingModelId: "test-e5",
    },
    questions: packet.questions.map(({ id }) => ({
      questionId: id,
      initialReviews: reviewers.map(({ id: reviewerId }) => vote(reviewerId)),
      finalReviews: reviewers.map(({ id: reviewerId }) => vote(reviewerId)),
      consensus: {
        answerSupported: "yes",
        citationAccurate: "yes",
        abstentionAppropriate: "yes",
        outcome: "pass",
        rationale: "The discussion reached unanimous agreement.",
      },
    })),
    panelDecision: "accepted",
    decisionRationale: "All frozen questions passed unanimous post-discussion review.",
  });
  return { packet, packetText, review };
}

test("AI panel acceptance requires three isolated reviewers and one matching complete run", () => {
  const { packet, packetText, review } = panelFixture();
  const accepted = isAcceptedRagAiPanelReview({
    unparsedReview: review,
    packet,
    expected: {
      packetId: "dual-rag-review-v1",
      packetSha256: createHash("sha256").update(packetText).digest("hex"),
      sourceRegistrySha256: "a".repeat(64),
      runId: "panel-test-run-001",
      runSha256: "b".repeat(64),
      generationId: "generation-001",
      evidenceSnapshotHash: "c".repeat(64),
      embeddingModelId: "test-e5",
    },
  });
  assert.equal(accepted, true);

  const exposedPanel = structuredClone(review) as unknown as { reviewers: Array<{ sawExpectedAnswerOutline: boolean }> };
  exposedPanel.reviewers[0]!.sawExpectedAnswerOutline = true;
  assert.equal(isAcceptedRagAiPanelReview({
    unparsedReview: exposedPanel,
    packet,
    expected: {
      packetId: "dual-rag-review-v1",
      packetSha256: createHash("sha256").update(packetText).digest("hex"),
      sourceRegistrySha256: "a".repeat(64),
      runId: "panel-test-run-001",
      runSha256: "b".repeat(64),
      generationId: "generation-001",
      evidenceSnapshotHash: "c".repeat(64),
      embeddingModelId: "test-e5",
    },
  }), false);
});
