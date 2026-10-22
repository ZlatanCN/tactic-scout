import "dotenv/config";
import path from "node:path";
import { defaultRagEvaluationOutputPath, ragEvaluationModeSummary, runRagEvaluation, writeRagEvaluationRun, writeRagEvaluationRunMarkdown, type RagRankingModeSelection } from "./rag-evaluation.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const value = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const values = (flag: string): string[] => {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) result.push(args[index + 1]!);
  }
  return result;
};
const knownFlags = new Set(["--packet", "--out", "--ranking-mode", "--only"]);
const usage = `用法：
  pnpm eval:rag-run
  pnpm eval:rag-run -- --ranking-mode both|hybrid|gateway_reranked
  pnpm eval:rag-run -- --only M01 --only P01
  pnpm eval:rag-run -- --packet <packet.json> --out <result.json>

默认对冻结的 24 题分别运行 hybrid 与 gateway_reranked 两种排序模式，并生成独立 JSON 结果文件；--only 用于小范围诊断，不会构成完整验收。`;

try {
  const unknown = args.filter((argument, index) => argument.startsWith("--") && !knownFlags.has(argument));
  if (unknown.length) throw new Error(`未知参数：${unknown.join(", ")}。\n${usage}`);
  const rankingMode = (value("--ranking-mode") ?? "both") as RagRankingModeSelection;
  if (!["both", "hybrid", "gateway_reranked"].includes(rankingMode)) throw new Error(`不支持的 ranking mode：${rankingMode}。\n${usage}`);
  const packetPath = value("--packet");
  const run = await runRagEvaluation({
    ...(packetPath ? { packetPath: path.resolve(packetPath) } : {}),
    rankingMode,
    questionIds: values("--only"),
    dependencies: {
      onProgress(progress) {
        process.stderr.write(`[rag-eval] ${progress.mode} ${progress.index}/${progress.total} ${progress.questionId}: retrieval=${progress.retrievalStatus}, answer=${progress.answerStatus}\n`);
      },
    },
  });
  const outputPath = await writeRagEvaluationRun(value("--out") ? path.resolve(value("--out")!) : defaultRagEvaluationOutputPath(), run);
  const markdownPath = await writeRagEvaluationRunMarkdown(outputPath, run);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    markdownPath,
    runId: run.runId,
    packetId: run.packet.packetId,
    completeQuestionSet: run.packet.completeQuestionSet,
    corpus: run.corpus,
    modes: run.modes.map(ragEvaluationModeSummary),
    humanReviewRequired: true,
  }, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "RAG 评测运行失败。";
  console.error(message);
  process.exitCode = 1;
}
