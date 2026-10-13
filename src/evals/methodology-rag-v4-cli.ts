import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MethodologyRelevanceV4DatasetSchema,
  compareMethodologyRetrievalV4,
} from "./methodology-rag-v2-evaluation.js";
import { LocalKnowledgeBase, methodologyRetrievalPolicy } from "../knowledge/index.js";
import { KnowledgeSourceSchema } from "../knowledge/schemas.js";
import { PlosDiscoveryProvider } from "../knowledge/plos-discovery.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const articleDoi = "10.1371/journal.pone.0353239";
const articleUrl = `https://journals.plos.org/plosone/article?id=${encodeURIComponent(articleDoi)}`;
const candidateSource = KnowledgeSourceSchema.parse({
  id: "plos-player-profile-2026",
  name: "PLOS ONE: Optimizing football analytics player profiling",
  publisher: "PLOS ONE",
  rightsUrl: articleUrl,
  license: "CC BY 4.0",
  allowedCorpora: ["methodology"],
  allowedUrlPrefixes: [articleUrl],
  rights: { automatedFetch: true, persistentStorage: true, aiProcessing: true, display: true },
  rightsVerifiedAt: "2026-10-13",
  rightsNote: "仅供 issue 189 的隔离评测注册：PLOS 文章页声明 CC BY，PLOS TDM 条款允许按 DOI 通过官方 API 程序访问。保留作者、DOI、许可和 API 来源署名；正文筛除图、表、补充材料、参考文献和外链材料。论文使用的比赛数据、球员行及第三方内容不在授权范围内。",
});

async function main() {
  const datasetPath = path.join(projectRoot, "data", "evaluations", "methodology-rag-v4.json");
  const dataset = MethodologyRelevanceV4DatasetSchema.parse(JSON.parse(await readFile(datasetPath, "utf8")) as unknown);
  if (dataset.retrievalPolicyVersion !== methodologyRetrievalPolicy.version) {
    throw new Error("v4 数据集没有固定当前生产方法检索策略。");
  }
  if (dataset.candidateSourceId !== candidateSource.id || !dataset.sourceIds.includes(candidateSource.id)) {
    throw new Error("v4 数据集的候选来源与隔离许可登记不一致。");
  }

  const productionRegistryPath = path.resolve(process.env.TACTISCOUT_KNOWLEDGE_SOURCES_FILE
    ?? path.join(projectRoot, "data", "knowledge", "sources.json"));
  const productionSources = KnowledgeSourceSchema.array().parse(JSON.parse(await readFile(productionRegistryPath, "utf8")) as unknown);
  const baselineSources = productionSources.filter((source) => source.id !== candidateSource.id);
  const candidateSources = [...baselineSources, candidateSource];
  const evaluationDirectory = path.join(projectRoot, ".data", "evaluations");
  await mkdir(evaluationDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(evaluationDirectory, "methodology-rag-v4-"));
  const baselineRegistryPath = path.join(temporaryDirectory, "baseline-sources.json");
  const candidateRegistryPath = path.join(temporaryDirectory, "candidate-sources.json");
  let candidateKnowledgeBase: LocalKnowledgeBase | undefined;
  let candidateSourcePurged = false;

  try {
    await writeFile(baselineRegistryPath, JSON.stringify(baselineSources), { encoding: "utf8", mode: 0o600 });
    await writeFile(candidateRegistryPath, JSON.stringify(candidateSources), { encoding: "utf8", mode: 0o600 });
    const baselineKnowledgeBase = new LocalKnowledgeBase({ registryPath: baselineRegistryPath });
    candidateKnowledgeBase = new LocalKnowledgeBase({ registryPath: candidateRegistryPath });
    const baselineStatus = await baselineKnowledgeBase.status();
    if (baselineStatus.embeddingModel !== dataset.embeddingModel) {
      throw new Error(`v4 固定使用 ${dataset.embeddingModel}；当前配置为 ${baselineStatus.embeddingModel}。未请求或写入候选文章。`);
    }

    const document = await new PlosDiscoveryProvider().fetchRegisteredArticle(articleDoi, { registryPath: candidateRegistryPath });
    const ingested = await candidateKnowledgeBase.ingest(document);
    const comparison = await compareMethodologyRetrievalV4({ baselineKnowledgeBase, candidateKnowledgeBase, dataset });
    const purgedChunks = await candidateKnowledgeBase.purgeSourceData(candidateSource.id);
    candidateSourcePurged = true;
    console.log(JSON.stringify({
      ...comparison,
      candidateArticle: {
        doi: articleDoi,
        url: articleUrl,
        title: document.title,
        attribution: document.attribution,
        indexedChunks: ingested.chunkCount,
        localStorageOnly: true,
        purgedFromCurrentIndexAfterEvaluation: purgedChunks,
      },
    }, null, 2));
  } finally {
    if (candidateKnowledgeBase && !candidateSourcePurged) {
      await candidateKnowledgeBase.purgeSourceData(candidateSource.id);
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "方法 RAG v4 对照评测失败。";
  console.error(message);
  process.exitCode = 1;
});
