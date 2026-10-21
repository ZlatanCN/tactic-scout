import { randomUUID } from "node:crypto";
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
});

const ReviewPacketSchema = z.object({
  packetId: z.string(),
  status: z.string(),
  questions: z.array(z.object({ id: z.string(), review: HumanReviewSchema }).passthrough()),
}).passthrough();

export type HumanReview = z.infer<typeof HumanReviewSchema>;
export type RagReviewPacket = z.infer<typeof ReviewPacketSchema>;

export interface RagReviewSummary {
  packetId: string;
  questionCount: number;
  completedCount: number;
  pendingCount: number;
  answerSupportedCount: number;
  citationAccurateCount: number;
  abstentionAppropriateCount: number;
  allQuestionsReviewed: boolean;
}

export async function readRagReviewPacket(filePath = defaultRagReviewPacketPath): Promise<RagReviewPacket> {
  return ReviewPacketSchema.parse(JSON.parse(await readFile(filePath, "utf8")) as unknown);
}

export function summarizeRagReviewPacket(unparsedPacket: RagReviewPacket): RagReviewSummary {
  const packet = ReviewPacketSchema.parse(unparsedPacket);
  const complete = packet.questions.filter(({ review }) => review.answerSupported !== null
    && review.citationAccurate !== null
    && review.abstentionAppropriate !== null
    && review.reviewedAt !== null);
  return {
    packetId: packet.packetId,
    questionCount: packet.questions.length,
    completedCount: complete.length,
    pendingCount: packet.questions.length - complete.length,
    answerSupportedCount: complete.filter(({ review }) => review.answerSupported).length,
    citationAccurateCount: complete.filter(({ review }) => review.citationAccurate).length,
    abstentionAppropriateCount: complete.filter(({ review }) => review.abstentionAppropriate).length,
    allQuestionsReviewed: complete.length === packet.questions.length,
  };
}

export async function recordRagQuestionReview(input: {
  questionId: string;
  review: HumanReview;
  filePath?: string;
}): Promise<RagReviewPacket> {
  const filePath = path.resolve(input.filePath ?? defaultRagReviewPacketPath);
  const packet = await readRagReviewPacket(filePath);
  const questionIndex = packet.questions.findIndex(({ id }) => id === input.questionId);
  if (questionIndex < 0) throw new Error(`Unknown RAG review question: ${input.questionId}`);
  const review = HumanReviewSchema.parse(input.review);
  if (review.answerSupported === null || review.citationAccurate === null
    || review.abstentionAppropriate === null || review.reviewedAt === null) {
    throw new Error("A completed human review needs all three judgments and a review date.");
  }
  const questions = [...packet.questions];
  questions[questionIndex] = { ...questions[questionIndex]!, review };
  const pendingPacket = ReviewPacketSchema.parse({ ...packet, questions, status: "pending_human_review" });
  const nextPacket = ReviewPacketSchema.parse({
    ...pendingPacket,
    status: summarizeRagReviewPacket(pendingPacket).allQuestionsReviewed ? "review_complete" : "pending_human_review",
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
