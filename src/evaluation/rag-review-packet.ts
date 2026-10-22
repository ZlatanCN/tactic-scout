import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const defaultRagReviewPacketPath = path.join(projectRoot, "data", "knowledge", "evaluation", "rag-review-packet.v1.json");

const HumanReviewSchema = z.object({
  answerSupported: z.boolean().nullable(),
  citationAccurate: z.boolean().nullable(),
  abstentionAppropriate: z.boolean().nullable(),
  reviewerNotes: z.string().max(2_000).nullable(),
  reviewedAt: z.iso.date().nullable(),
  evaluationRunId: z.string().nullable().default(null),
  evaluationRunSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable().default(null),
  rankingMode: z.enum(["hybrid", "gateway_reranked"]).nullable().default(null),
});

const emptyHumanReview = {
  answerSupported: null,
  citationAccurate: null,
  abstentionAppropriate: null,
  reviewerNotes: null,
  reviewedAt: null,
  evaluationRunId: null,
  evaluationRunSha256: null,
  rankingMode: null,
};

const ReviewPacketSchema = z.object({
  packetId: z.string(),
  status: z.string(),
  questions: z.array(z.object({
    id: z.string(),
    review: HumanReviewSchema,
    gatewayRerankedReview: HumanReviewSchema.default(emptyHumanReview),
  }).passthrough()),
}).passthrough();

export type HumanReview = z.infer<typeof HumanReviewSchema>;
export type RagReviewPacket = z.infer<typeof ReviewPacketSchema>;

export interface RagReviewSummary {
  packetId: string;
  rankingMode: "hybrid" | "gateway_reranked";
  questionCount: number;
  completedCount: number;
  pendingCount: number;
  answerSupportedCount: number;
  citationAccurateCount: number;
  abstentionAppropriateCount: number;
  evaluationRunId: string | null;
  evaluationRunSha256: string | null;
  allQuestionsReviewed: boolean;
}

export async function readRagReviewPacket(filePath = defaultRagReviewPacketPath): Promise<RagReviewPacket> {
  return ReviewPacketSchema.parse(JSON.parse(await readFile(filePath, "utf8")) as unknown);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function reviewFor(question: RagReviewPacket["questions"][number], rankingMode: "hybrid" | "gateway_reranked"): HumanReview {
  return rankingMode === "hybrid" ? question.review : question.gatewayRerankedReview;
}

export function summarizeRagReviewPacket(unparsedPacket: RagReviewPacket, rankingMode: "hybrid" | "gateway_reranked" = "hybrid"): RagReviewSummary {
  const packet = ReviewPacketSchema.parse(unparsedPacket);
  const reviews = packet.questions.map((question) => reviewFor(question, rankingMode));
  const complete = reviews.filter((review) => review.answerSupported !== null
    && review.citationAccurate !== null
    && review.abstentionAppropriate !== null
    && review.reviewedAt !== null
    && review.evaluationRunId !== null
    && review.rankingMode === rankingMode);
  const completeRunIds = new Set(complete.map(({ evaluationRunId }) => evaluationRunId));
  const completeRunHashes = new Set(complete.map(({ evaluationRunSha256 }) => evaluationRunSha256));
  return {
    packetId: packet.packetId,
    rankingMode,
    questionCount: packet.questions.length,
    completedCount: complete.length,
    pendingCount: packet.questions.length - complete.length,
    answerSupportedCount: complete.filter(({ answerSupported }) => answerSupported).length,
    citationAccurateCount: complete.filter(({ citationAccurate }) => citationAccurate).length,
    abstentionAppropriateCount: complete.filter(({ abstentionAppropriate }) => abstentionAppropriate).length,
    evaluationRunId: completeRunIds.size === 1 ? [...completeRunIds][0]! : null,
    evaluationRunSha256: completeRunHashes.size === 1 ? [...completeRunHashes][0]! : null,
    allQuestionsReviewed: complete.length === packet.questions.length && completeRunIds.size === 1 && completeRunHashes.size === 1,
  };
}

/** Hash only the frozen question content, excluding mutable review judgments and packet status. */
export function ragReviewQuestionSetSha256(unparsedPacket: unknown): string {
  const packet = ReviewPacketSchema.parse(unparsedPacket);
  const { status: _status, questions: packetQuestions, ...stablePacket } = packet;
  const frozen = {
    ...stablePacket,
    questions: packetQuestions.map(({ review: _review, gatewayRerankedReview: _gatewayReview, ...question }) => question),
  };
  return createHash("sha256").update(canonicalJson(frozen)).digest("hex");
}

export async function recordRagQuestionReview(input: {
  questionId: string;
  review: Omit<HumanReview, "evaluationRunId" | "evaluationRunSha256" | "rankingMode">;
  evaluationRunId: string;
  evaluationRunSha256: string;
  rankingMode: "hybrid" | "gateway_reranked";
  filePath?: string;
}): Promise<RagReviewPacket> {
  const filePath = path.resolve(input.filePath ?? defaultRagReviewPacketPath);
  const packet = await readRagReviewPacket(filePath);
  const questionIndex = packet.questions.findIndex(({ id }) => id === input.questionId);
  if (questionIndex < 0) throw new Error(`Unknown RAG review question: ${input.questionId}`);
  const review = HumanReviewSchema.parse({
    ...input.review,
    evaluationRunId: input.evaluationRunId,
    evaluationRunSha256: input.evaluationRunSha256,
    rankingMode: input.rankingMode,
  });
  if (review.answerSupported === null || review.citationAccurate === null
    || review.abstentionAppropriate === null || review.reviewedAt === null) {
    throw new Error("A completed human review needs all three judgments and a review date.");
  }
  const questions = [...packet.questions];
  const selectedQuestion = questions[questionIndex]!;
  questions[questionIndex] = input.rankingMode === "hybrid"
    ? { ...selectedQuestion, review }
    : { ...selectedQuestion, gatewayRerankedReview: review };
  const pendingPacket = ReviewPacketSchema.parse({ ...packet, questions, status: "pending_human_review" });
  const nextPacket = ReviewPacketSchema.parse({
    ...pendingPacket,
    status: summarizeRagReviewPacket(pendingPacket, "hybrid").allQuestionsReviewed ? "review_complete" : "pending_human_review",
  });
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(nextPacket, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return nextPacket;
}
