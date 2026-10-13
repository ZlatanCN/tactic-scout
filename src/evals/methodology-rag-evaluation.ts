import { z } from "zod/v4";
import type { KnowledgeBase } from "../knowledge/index.js";

const MethodologyRelevanceQuerySchema = z.object({
  id: z.string().min(1),
  query: z.string().trim().min(2).max(2000),
  expectedRelevantSourceIds: z.array(z.string().min(1)),
  rationale: z.string().min(1),
  outOfScopeReason: z.string().min(1).optional(),
}).superRefine((query, context) => {
  if (query.expectedRelevantSourceIds.length === 0 && !query.outOfScopeReason) {
    context.addIssue({ code: "custom", message: "无相关来源的 query 必须说明超出语料范围的原因。" });
  }
  if (query.expectedRelevantSourceIds.length > 0 && query.outOfScopeReason) {
    context.addIssue({ code: "custom", message: "可回答的 query 不能同时标记为超出语料范围。" });
  }
});

export const MethodologyRelevanceDatasetSchema = z.object({
  datasetId: z.string().min(1),
  corpus: z.literal("methodology"),
  judgmentLevel: z.literal("source"),
  judgmentAuthority: z.literal("author_labeled"),
  embeddingModel: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).min(1),
  queries: z.array(MethodologyRelevanceQuerySchema).min(1),
}).superRefine((dataset, context) => {
  const queryIds = new Set<string>();
  for (const [index, query] of dataset.queries.entries()) {
    if (queryIds.has(query.id)) {
      context.addIssue({ code: "custom", path: ["queries", index, "id"], message: `重复的 query ID：${query.id}` });
    }
    queryIds.add(query.id);
    for (const sourceId of query.expectedRelevantSourceIds) {
      if (!dataset.sourceIds.includes(sourceId)) {
        context.addIssue({ code: "custom", path: ["queries", index, "expectedRelevantSourceIds"], message: `未登记的来源 ID：${sourceId}` });
      }
    }
  }
  if (new Set(dataset.sourceIds).size !== dataset.sourceIds.length) {
    context.addIssue({ code: "custom", path: ["sourceIds"], message: "来源 ID 必须唯一。" });
  }
});

export type MethodologyRelevanceDataset = z.infer<typeof MethodologyRelevanceDatasetSchema>;

const evaluationLimit = 6;
const metricCutoff = 3;

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

export async function evaluateMethodologyRetrieval(
  knowledgeBase: KnowledgeBase,
  unparsedDataset: MethodologyRelevanceDataset,
) {
  const dataset = MethodologyRelevanceDatasetSchema.parse(unparsedDataset);
  const corpusStatus = await knowledgeBase.status();
  if (corpusStatus.embeddingModel !== dataset.embeddingModel) {
    throw new Error(`评测固定使用 ${dataset.embeddingModel}，当前知识索引使用 ${corpusStatus.embeddingModel}。`);
  }
  if (corpusStatus.methodologyChunks === 0) {
    throw new Error("获准方法语料索引为空；请先导入已登记的方法资料，再运行检索评估。");
  }

  const availableMetricSources = Math.min(metricCutoff, dataset.sourceIds.length);
  const queryResults = [];
  for (const query of dataset.queries) {
    const chunks = await knowledgeBase.search({ corpus: dataset.corpus, query: query.query, playerNames: [], limit: evaluationLimit });
    const retrievedSourceIds = [...new Set(chunks.map(({ sourceId }) => sourceId))];
    const topSources = retrievedSourceIds.slice(0, metricCutoff);
    const firstRelevantIndex = retrievedSourceIds.findIndex((sourceId) => query.expectedRelevantSourceIds.includes(sourceId));
    const isOutOfScope = query.expectedRelevantSourceIds.length === 0;
    const relevantRetrievedCount = topSources.filter((sourceId) => query.expectedRelevantSourceIds.includes(sourceId)).length;
    const reciprocalRank = firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1);
    const precisionAt3 = isOutOfScope ? null : relevantRetrievedCount / availableMetricSources;
    const recallAt3 = isOutOfScope ? null : relevantRetrievedCount / query.expectedRelevantSourceIds.length;
    const top1FalsePositive = isOutOfScope ? retrievedSourceIds.length > 0 : null;

    queryResults.push({
      queryId: query.id,
      query: query.query,
      rationale: query.rationale,
      outOfScopeReason: query.outOfScopeReason ?? null,
      expectedRelevantSourceIds: query.expectedRelevantSourceIds,
      retrievedChunkCount: chunks.length,
      retrievedSourceIds,
      firstRelevantSourceRank: isOutOfScope || firstRelevantIndex < 0 ? null : firstRelevantIndex + 1,
      reciprocalRank: isOutOfScope ? null : rounded(reciprocalRank),
      precisionAt3: precisionAt3 === null ? null : rounded(precisionAt3),
      recallAt3: recallAt3 === null ? null : rounded(recallAt3),
      outOfScopeTop1FalsePositive: top1FalsePositive,
    });
  }

  const answerableResults = queryResults.filter((result) => result.expectedRelevantSourceIds.length > 0);
  const outOfScopeResults = queryResults.filter((result) => result.expectedRelevantSourceIds.length === 0);
  const mean = (values: number[]) => values.length ? rounded(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const falsePositives = outOfScopeResults.filter((result) => result.outOfScopeTop1FalsePositive).length;

  return {
    evaluationType: "author-labeled-source-level-retrieval-smoke",
    datasetId: dataset.datasetId,
    judgmentAuthority: dataset.judgmentAuthority,
    corpus: dataset.corpus,
    embeddingModel: corpusStatus.embeddingModel,
    corpusStatus: {
      methodologyChunks: corpusStatus.methodologyChunks,
      playerReportChunks: corpusStatus.playerReportChunks,
      registeredSources: corpusStatus.registeredSources,
      judgedMethodologySources: dataset.sourceIds.length,
    },
    retrieval: {
      chunkLimitPerQuery: evaluationLimit,
      sourceRankCutoff: metricCutoff,
      precisionDenominator: availableMetricSources,
      sourceDeduplication: "first occurrence of each source in chunk retrieval order",
    },
    queryCount: queryResults.length,
    answerableQueryCount: answerableResults.length,
    outOfScopeQueryCount: outOfScopeResults.length,
    metrics: {
      macroSourceMrrOnAnswerableQueries: mean(answerableResults.map(({ reciprocalRank }) => reciprocalRank ?? 0)),
      macroSourcePrecisionAt3OnAnswerableQueries: mean(answerableResults.map(({ precisionAt3 }) => precisionAt3 ?? 0)),
      macroSourceRecallAt3OnAnswerableQueries: mean(answerableResults.map(({ recallAt3 }) => recallAt3 ?? 0)),
      outOfScopeTop1FalsePositiveRate: outOfScopeResults.length ? rounded(falsePositives / outOfScopeResults.length) : null,
      outOfScopeTop1FalsePositiveCount: falsePositives,
    },
    interpretation: "两篇方法来源和作者标注只构成固定语料的检索回归 smoke；该结果不代表通用 RAG 质量、答案忠实度或球员推荐准确性。",
    queries: queryResults,
  };
}
