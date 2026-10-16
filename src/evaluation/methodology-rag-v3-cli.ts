import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalKnowledgeBase } from "../knowledge/index.js";
import { evaluateMethodologyRetrievalV3, MethodologyRelevanceV3DatasetSchema } from "./methodology-rag-v2-evaluation.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const datasetPath = path.join(projectRoot, "data", "evaluations", "methodology-rag-v3.json");

async function run(): Promise<void> {
  if (process.env.TACTISCOUT_EMBEDDING_PROVIDER?.trim() === "openai_compatible") {
    throw new Error("检索评估已停止：当前启用了远程 embedding；本命令不会把基准查询发送给外部服务。请切换为本地 embedding 后重试。");
  }

  const dataset = MethodologyRelevanceV3DatasetSchema.parse(JSON.parse(await readFile(datasetPath, "utf8")) as unknown);
  const knowledgeBase = new LocalKnowledgeBase();
  const result = await evaluateMethodologyRetrievalV3(knowledgeBase, dataset);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : "方法 RAG v3 检索评估失败。";
  console.error(message);
  process.exitCode = 1;
}
