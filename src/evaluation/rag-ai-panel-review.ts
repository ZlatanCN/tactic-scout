import { z } from "zod/v4";
import { ragReviewQuestionSetSha256 } from "./rag-review-packet.js";

const PanelJudgmentSchema = z.enum(["yes", "no", "uncertain"]);
const CriterionVotesSchema = z.object({
  answerSupported: PanelJudgmentSchema,
  citationAccurate: PanelJudgmentSchema,
  abstentionAppropriate: PanelJudgmentSchema,
  rationale: z.string().trim().min(1).max(2_000),
});

const PanelReviewerSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.literal("ai_subagent"),
  isolatedContext: z.literal(true),
  initialRoundBlind: z.literal(true),
  sawExpectedAnswerOutline: z.literal(false),
  sawAnonymizedPeerRationalesInDiscussion: z.literal(true),
});

const PanelQuestionSchema = z.object({
  questionId: z.string().trim().min(1),
  initialReviews: z.array(z.object({ reviewerId: z.string(), ...CriterionVotesSchema.shape })).length(3),
  finalReviews: z.array(z.object({ reviewerId: z.string(), ...CriterionVotesSchema.shape })).length(3),
  consensus: z.object({
    answerSupported: PanelJudgmentSchema,
    citationAccurate: PanelJudgmentSchema,
    abstentionAppropriate: PanelJudgmentSchema,
    outcome: z.enum(["pass", "fail", "unresolved"]),
    rationale: z.string().trim().min(1).max(2_000),
  }),
});

export const RagAiPanelReviewSchema = z.object({
  schemaVersion: z.literal("rag-ai-panel-review-v1"),
  reviewMode: z.literal("blind_ai_panel"),
  createdAt: z.iso.datetime(),
  reviewers: z.array(PanelReviewerSchema).length(3),
  discussionRoundComplete: z.literal(true),
  packet: z.object({
    packetId: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    questionSetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    questionCount: z.number().int().positive(),
    completeQuestionSet: z.literal(true),
  }),
  sourceRegistrySha256: z.string().regex(/^[a-f0-9]{64}$/u),
  evaluation: z.object({
    runId: z.string().min(1),
    runSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    rankingMode: z.literal("hybrid"),
    generationId: z.string().min(1),
    evidenceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
    embeddingModelId: z.string().min(1),
  }),
  questions: z.array(PanelQuestionSchema).length(24),
  panelDecision: z.enum(["accepted", "rejected", "inconclusive"]),
  decisionRationale: z.string().trim().min(1).max(4_000),
}).superRefine((review, context) => {
  const reviewerIds = review.reviewers.map(({ id }) => id);
  if (new Set(reviewerIds).size !== reviewerIds.length) {
    context.addIssue({ code: "custom", path: ["reviewers"], message: "AI panel reviewer IDs must be unique." });
  }
  const questionIds = review.questions.map(({ questionId }) => questionId);
  if (new Set(questionIds).size !== questionIds.length) {
    context.addIssue({ code: "custom", path: ["questions"], message: "AI panel question IDs must be unique." });
  }
  for (const [index, question] of review.questions.entries()) {
    for (const key of ["initialReviews", "finalReviews"] as const) {
      const ids = question[key].map(({ reviewerId }) => reviewerId);
      if (ids.length !== reviewerIds.length || reviewerIds.some((id) => !ids.includes(id)) || new Set(ids).size !== ids.length) {
        context.addIssue({ code: "custom", path: ["questions", index, key], message: "Each panel reviewer must provide exactly one vote in every review round." });
      }
    }
    if (question.consensus.outcome === "pass"
      && (question.consensus.answerSupported !== "yes"
        || question.consensus.citationAccurate !== "yes"
        || question.consensus.abstentionAppropriate !== "yes"
        || question.finalReviews.some((vote) => vote.answerSupported !== "yes"
          || vote.citationAccurate !== "yes"
          || vote.abstentionAppropriate !== "yes"))) {
      context.addIssue({ code: "custom", path: ["questions", index, "consensus"], message: "A passing question needs yes judgments on all three review criteria." });
    }
    if (question.consensus.outcome === "fail"
      && !question.finalReviews.some((vote) => vote.answerSupported === "no"
        || vote.citationAccurate === "no"
        || vote.abstentionAppropriate === "no")) {
      context.addIssue({ code: "custom", path: ["questions", index, "consensus"], message: "A failed question needs at least one final no judgment." });
    }
    if (question.consensus.outcome === "unresolved"
      && !question.finalReviews.some((vote) => vote.answerSupported === "uncertain"
        || vote.citationAccurate === "uncertain"
        || vote.abstentionAppropriate === "uncertain")) {
      context.addIssue({ code: "custom", path: ["questions", index, "consensus"], message: "An unresolved question needs at least one final uncertain judgment." });
    }
  }
  const allPass = review.questions.every(({ consensus }) => consensus.outcome === "pass");
  const hasFailure = review.questions.some(({ consensus }) => consensus.outcome === "fail");
  const hasUnresolved = review.questions.some(({ consensus }) => consensus.outcome === "unresolved");
  if (review.panelDecision === "accepted" && !allPass) {
    context.addIssue({ code: "custom", path: ["panelDecision"], message: "The panel can accept a baseline only when all frozen questions pass." });
  }
  if (review.panelDecision === "rejected" && !hasFailure) {
    context.addIssue({ code: "custom", path: ["panelDecision"], message: "A rejected panel decision needs at least one failed question." });
  }
  if (review.panelDecision === "inconclusive" && (!hasUnresolved || hasFailure)) {
    context.addIssue({ code: "custom", path: ["panelDecision"], message: "An inconclusive panel decision needs at least one unresolved question." });
  }
});

export type RagAiPanelReview = z.infer<typeof RagAiPanelReviewSchema>;

/** Validates that an AI panel review is complete, blind, unanimous, and pinned to the active corpus. */
export function isAcceptedRagAiPanelReview(input: {
  unparsedReview: unknown;
  packet: unknown;
  expected: {
    packetId: string;
    packetSha256: string;
    sourceRegistrySha256: string;
    runId: string;
    runSha256: string;
    generationId: string;
    evidenceSnapshotHash: string;
    embeddingModelId: string;
  };
}): boolean {
  try {
    const review = RagAiPanelReviewSchema.parse(input.unparsedReview);
    const packet = input.packet as { packetId?: unknown; questions?: unknown };
    const packetQuestions = Array.isArray(packet.questions) ? packet.questions as Array<{ id?: unknown }> : [];
    const expectedQuestionIds = packetQuestions.map(({ id }) => id).filter((id): id is string => typeof id === "string").sort();
    const reviewedQuestionIds = review.questions.map(({ questionId }) => questionId).sort();
    return review.panelDecision === "accepted"
      && review.packet.completeQuestionSet
      && review.packet.packetId === input.expected.packetId
      && review.packet.packetId === packet.packetId
      && review.packet.sha256 === input.expected.packetSha256
      && review.packet.questionCount === 24
      && review.packet.questionSetSha256 === ragReviewQuestionSetSha256(input.packet)
      && review.sourceRegistrySha256 === input.expected.sourceRegistrySha256
      && review.evaluation.runId === input.expected.runId
      && review.evaluation.runSha256 === input.expected.runSha256
      && review.evaluation.rankingMode === "hybrid"
      && review.evaluation.generationId === input.expected.generationId
      && review.evaluation.evidenceSnapshotHash === input.expected.evidenceSnapshotHash
      && review.evaluation.embeddingModelId === input.expected.embeddingModelId
      && expectedQuestionIds.length === 24
      && reviewedQuestionIds.length === 24
      && expectedQuestionIds.every((id, index) => id === reviewedQuestionIds[index])
      && review.questions.every(({ consensus }) => consensus.outcome === "pass"
        && consensus.answerSupported === "yes"
        && consensus.citationAccurate === "yes"
        && consensus.abstentionAppropriate === "yes");
  } catch {
    return false;
  }
}
