import { defaultRagReviewPacketPath, readRagReviewPacket, recordRagQuestionReview, summarizeRagReviewPacket } from "./rag-review-packet.js";

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

try {
  if (command === "summary") {
    const packet = await readRagReviewPacket(flagValue("--file") ?? defaultRagReviewPacketPath);
    console.log(JSON.stringify(summarizeRagReviewPacket(packet), null, 2));
  } else if (command === "record" && args[0]) {
    const reviewedAt = flagValue("--reviewed-at") ?? new Date().toISOString().slice(0, 10);
    const packet = await recordRagQuestionReview({
      questionId: args[0]!,
      filePath: flagValue("--file") ?? defaultRagReviewPacketPath,
      review: {
        answerSupported: parseBoolean(flagValue("--answer-supported"), "--answer-supported"),
        citationAccurate: parseBoolean(flagValue("--citation-accurate"), "--citation-accurate"),
        abstentionAppropriate: parseBoolean(flagValue("--abstention-appropriate"), "--abstention-appropriate"),
        reviewerNotes: flagValue("--notes") ?? null,
        reviewedAt,
      },
    });
    console.log(JSON.stringify(summarizeRagReviewPacket(packet), null, 2));
  } else {
    console.error(`用法：
  pnpm eval:rag-review -- summary
  pnpm eval:rag-review -- record <question-id> --answer-supported yes|no --citation-accurate yes|no --abstention-appropriate yes|no [--notes <text>]`);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "RAG review packet operation failed.");
  process.exitCode = 1;
}
