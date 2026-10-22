import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod/v4";
import { defaultRagReviewPacketPath, ragReviewQuestionSetSha256, readRagReviewPacket, recordRagQuestionReview, summarizeRagReviewPacket } from "./rag-review-packet.js";

const [command, ...args] = process.argv.slice(2).filter((argument) => argument !== "--");
const flagValue = (name: string) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const parseBoolean = (value: string | undefined, flag: string): boolean => {
  if (value === "true" || value === "yes") return true;
  if (value === "false" || value === "no") return false;
  throw new Error(`${flag} 必须是 yes/no 或 true/false。`);
};

const EvaluationRunSchema = z.object({
  schemaVersion: z.literal("rag-evaluation-run-v1"),
  runId: z.string().min(1),
  packet: z.object({
    packetId: z.string(),
    questionCount: z.number().int().positive(),
    questionSetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    questionSetHashAlgorithm: z.literal("canonical-json-v1"),
    completeQuestionSet: z.boolean(),
  }),
  modes: z.array(z.object({
    rankingMode: z.enum(["hybrid", "gateway_reranked"]),
    questions: z.array(z.object({
      questionId: z.string(),
      answer: z.object({ status: z.enum(["generated", "invalid_response", "failed", "skipped"]) }).passthrough(),
    }).passthrough()),
  }).passthrough()),
}).passthrough();

async function validateEvaluationRun(input: {
  runFile: string | undefined;
  packet: Awaited<ReturnType<typeof readRagReviewPacket>>;
  questionId: string;
  rankingMode: "hybrid" | "gateway_reranked";
}): Promise<{ runId: string; runSha256: string }> {
  if (!input.runFile) throw new Error("记录人工复核必须指定 --run-file，并选择要复核的 --mode。");
  const runText = await readFile(input.runFile, "utf8");
  const run = EvaluationRunSchema.parse(JSON.parse(runText) as unknown);
  if (!run.packet.completeQuestionSet || run.packet.questionCount !== input.packet.questions.length) {
    throw new Error("所选评测结果不是完整题包，不能用于正式人工复核。");
  }
  if (run.packet.packetId !== input.packet.packetId || run.packet.questionSetSha256 !== ragReviewQuestionSetSha256(input.packet)) {
    throw new Error("评测结果与当前冻结题目不一致；请对当前题包重新运行评测。");
  }
  const modeRun = run.modes.find(({ rankingMode }) => rankingMode === input.rankingMode);
  if (!modeRun || modeRun.questions.length !== input.packet.questions.length
    || input.packet.questions.some(({ id }) => !modeRun.questions.some((question) => question.questionId === id))) {
    throw new Error(`评测结果中没有完整的 ${input.rankingMode} 结果。`);
  }
  const questionResult = modeRun.questions.find(({ questionId }) => questionId === input.questionId);
  if (!questionResult) {
    throw new Error(`评测结果中没有问题 ${input.questionId}。`);
  }
  if (questionResult.answer.status !== "generated" && questionResult.answer.status !== "invalid_response") {
    throw new Error(`问题 ${input.questionId} 没有可供人工复核的模型答案；运行状态为 ${questionResult.answer.status}。`);
  }
  return { runId: run.runId, runSha256: createHash("sha256").update(runText).digest("hex") };
}

try {
  if (command === "summary") {
    const packet = await readRagReviewPacket(flagValue("--file") ?? defaultRagReviewPacketPath);
    console.log(JSON.stringify({
      packetId: packet.packetId,
      hybrid: summarizeRagReviewPacket(packet, "hybrid"),
      gatewayReranked: summarizeRagReviewPacket(packet, "gateway_reranked"),
    }, null, 2));
  } else if (command === "record" && args[0]) {
    const reviewedAt = flagValue("--reviewed-at") ?? new Date().toISOString().slice(0, 10);
    const filePath = flagValue("--file") ?? defaultRagReviewPacketPath;
    const rankingMode = flagValue("--mode");
    if (rankingMode !== "hybrid" && rankingMode !== "gateway_reranked") throw new Error("--mode 必须是 hybrid 或 gateway_reranked。");
    const packetBeforeWrite = await readRagReviewPacket(filePath);
    const evaluationRun = await validateEvaluationRun({
      runFile: flagValue("--run-file"),
      packet: packetBeforeWrite,
      questionId: args[0]!,
      rankingMode,
    });
    const packet = await recordRagQuestionReview({
      questionId: args[0]!,
      filePath,
      evaluationRunId: evaluationRun.runId,
      evaluationRunSha256: evaluationRun.runSha256,
      rankingMode,
      review: {
        answerSupported: parseBoolean(flagValue("--answer-supported"), "--answer-supported"),
        citationAccurate: parseBoolean(flagValue("--citation-accurate"), "--citation-accurate"),
        abstentionAppropriate: parseBoolean(flagValue("--abstention-appropriate"), "--abstention-appropriate"),
        reviewerNotes: flagValue("--notes") ?? null,
        reviewedAt,
      },
    });
    console.log(JSON.stringify(summarizeRagReviewPacket(packet, rankingMode), null, 2));
  } else {
    console.error(`用法：
  pnpm eval:rag-review -- summary
  pnpm eval:rag-review -- record <question-id> --run-file <run.json> --mode hybrid|gateway_reranked --answer-supported yes|no --citation-accurate yes|no --abstention-appropriate yes|no [--notes <text>]`);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "RAG review packet operation failed.");
  process.exitCode = 1;
}
