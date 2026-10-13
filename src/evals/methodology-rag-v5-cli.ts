import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MethodologyRetrievalV5DatasetSchema,
  compareMethodologyRetrievalV5,
} from "./methodology-rag-v5-evaluation.js";
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
  rightsNote: "仅供 issue 190 的隔离评测登记：PLOS 文章声明 CC BY 4.0，官方 TDM 条款允许按 DOI 通过官方 API 程序访问。保留作者、DOI、许可和 API 来源署名；正文筛除图、表、补充材料、参考文献和外链材料。论文使用的比赛数据、球员行及第三方内容不在授权范围内。",
});

async function main() {
  const datasetPath = path.join(projectRoot, "data", "evaluations", "methodology-rag-v5-crosslingual.json");
  const dataset = MethodologyRetrievalV5DatasetSchema.parse(JSON.parse(await readFile(datasetPath, "utf8")) as unknown);
  if (dataset.retrievalPolicyVersion !== methodologyRetrievalPolicy.version) {
    throw new Error("v5 数据集没有固定当前生产方法检索策略。");
  }
  if (dataset.candidateSourceId !== candidateSource.id || !dataset.sourceIds.includes(candidateSource.id)) {
    throw new Error("v5 数据集候选来源与隔离许可登记不一致。");
  }

  const productionRegistryPath = path.resolve(process.env.TACTISCOUT_KNOWLEDGE_SOURCES_FILE
    ?? path.join(projectRoot, "data", "knowledge", "sources.json"));
  const productionSources = KnowledgeSourceSchema.array().parse(JSON.parse(await readFile(productionRegistryPath, "utf8")) as unknown);
  const productionMethodSourceIds = productionSources
    .filter((source) => source.allowedCorpora.includes("methodology") && source.rights.persistentStorage && source.rights.aiProcessing)
    .map((source) => source.id)
    .sort();
  const datasetSourceIdsWithoutCandidate = dataset.sourceIds.filter((sourceId) => sourceId !== candidateSource.id).sort();
  if (productionMethodSourceIds.length !== datasetSourceIdsWithoutCandidate.length
    || productionMethodSourceIds.some((sourceId, index) => sourceId !== datasetSourceIdsWithoutCandidate[index])) {
    throw new Error("v5 数据集来源清单与当前生产方法来源不一致；不请求或写入候选论文。");
  }
  if (productionSources.some((source) => source.id === candidateSource.id)) {
    throw new Error("候选论文已出现在生产来源登记中；v5 只允许临时登记。");
  }

  const evaluationDirectory = path.join(projectRoot, ".data", "evaluations");
  await mkdir(evaluationDirectory, { recursive: true, mode: 0o700 });
  const temporaryDirectory = await mkdtemp(path.join(evaluationDirectory, "methodology-rag-v5-"));
  const temporaryRegistryPath = path.join(temporaryDirectory, "temporary-sources.json");
  const temporarySources = [...productionSources, candidateSource];
  const knowledgeBase = new LocalKnowledgeBase({ registryPath: temporaryRegistryPath });
  let candidateSourcePurged = false;

  try {
    await writeFile(temporaryRegistryPath, JSON.stringify(temporarySources), { encoding: "utf8", mode: 0o600 });
    const initialStatus = await knowledgeBase.status();
    if (initialStatus.embeddingModel !== dataset.embeddingModel) {
      throw new Error(`v5 固定使用 ${dataset.embeddingModel}；当前配置为 ${initialStatus.embeddingModel}。未请求或写入候选文章。`);
    }

    const document = await new PlosDiscoveryProvider().fetchRegisteredArticle(articleDoi, { registryPath: temporaryRegistryPath });
    const ingested = await knowledgeBase.ingest(document);
    const comparison = await compareMethodologyRetrievalV5({ knowledgeBase, dataset });
    const purgedChunks = await knowledgeBase.purgeSourceData(candidateSource.id);
    candidateSourcePurged = true;
    const result = {
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
    };
    const resultPath = path.join(evaluationDirectory, "methodology-rag-v5-2026-10-13.json");
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({
      resultPath,
      adoptionGate: result.adoptionGate,
      heldout: result.heldout,
      interpretation: result.interpretation,
      candidateArticle: result.candidateArticle,
    }, null, 2));
  } finally {
    try {
      if (!candidateSourcePurged) await knowledgeBase.purgeSourceData(candidateSource.id);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "方法 RAG v5 跨语言对照评测失败。";
  console.error(message);
  process.exitCode = 1;
});
