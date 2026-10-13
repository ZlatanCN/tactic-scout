import { z } from "zod/v4";
import {
  acceptsMethodologySourceSignal,
  methodologyRetrievalPolicy,
  type LocalKnowledgeBase,
  type MethodologySourceRelevanceSignal,
} from "../knowledge/index.js";

export const MethodologyQuerySchema = z.object({
  id: z.string().min(1),
  split: z.enum(["calibration", "heldout"]),
  queryFamily: z.string().min(1),
  answerability: z.enum(["answerable", "ambiguous", "out_of_scope"]),
  query: z.string().trim().min(2).max(2000),
  relevantSourceIds: z.array(z.string().min(1)),
  rationale: z.string().min(1),
  outOfScopeReason: z.string().min(1).optional(),
}).superRefine((query, context) => {
  if (query.answerability === "answerable" && query.relevantSourceIds.length === 0) {
    context.addIssue({ code: "custom", message: "可回答 query 必须至少标注一个相关来源。" });
  }
  if (query.answerability === "out_of_scope" && query.relevantSourceIds.length > 0) {
    context.addIssue({ code: "custom", message: "超出语料范围的 query 不能标注相关来源。" });
  }
  if (query.answerability !== "answerable" && query.relevantSourceIds.length === 0 && !query.outOfScopeReason) {
    context.addIssue({ code: "custom", message: "无可接受来源的 query 必须说明语料边界。" });
  }
});

function validateMethodologyDataset(
  dataset: { sourceIds: string[]; queries: z.infer<typeof MethodologyQuerySchema>[] },
  context: z.RefinementCtx,
): void {
  const queryIds = new Set<string>();
  const familySplits = new Map<string, string>();
  for (const [index, query] of dataset.queries.entries()) {
    if (queryIds.has(query.id)) {
      context.addIssue({ code: "custom", path: ["queries", index, "id"], message: `重复的 query ID：${query.id}` });
    }
    queryIds.add(query.id);
    for (const sourceId of query.relevantSourceIds) {
      if (!dataset.sourceIds.includes(sourceId)) {
        context.addIssue({ code: "custom", path: ["queries", index, "relevantSourceIds"], message: `未登记的来源 ID：${sourceId}` });
      }
    }
    const priorSplit = familySplits.get(query.queryFamily);
    if (priorSplit && priorSplit !== query.split) {
      context.addIssue({
        code: "custom",
        path: ["queries", index, "queryFamily"],
        message: `query family ${query.queryFamily} 同时出现在校准集和留出集。`,
      });
    }
    familySplits.set(query.queryFamily, query.split);
  }
  if (new Set(dataset.sourceIds).size !== dataset.sourceIds.length) {
    context.addIssue({ code: "custom", path: ["sourceIds"], message: "来源 ID 必须唯一。" });
  }
  for (const split of ["calibration", "heldout"] as const) {
    const splitQueries = dataset.queries.filter((query) => query.split === split);
    for (const answerability of ["answerable", "ambiguous", "out_of_scope"] as const) {
      if (!splitQueries.some((query) => query.answerability === answerability)) {
        context.addIssue({ code: "custom", path: ["queries"], message: `${split} split 缺少 ${answerability} 样例。` });
      }
    }
    for (const sourceId of dataset.sourceIds) {
      if (!splitQueries.some((query) => query.relevantSourceIds.includes(sourceId))) {
        context.addIssue({ code: "custom", path: ["queries"], message: `${split} split 没有覆盖来源 ${sourceId} 的相关查询。` });
      }
    }
  }
}

export function createMethodologyRelevanceDatasetSchema<T extends "methodology-rag-v2" | "methodology-rag-v3" | "methodology-rag-v4">(datasetId: T) {
  return z.object({
    datasetId: z.literal(datasetId),
    corpus: z.literal("methodology"),
    judgmentLevel: z.literal("source"),
    judgmentAuthority: z.literal("author_labeled"),
    embeddingModel: z.string().min(1),
    retrievalPolicyVersion: z.string().optional(),
    candidateSourceId: z.string().min(1).optional(),
    sourceIds: z.array(z.string().min(1)).min(1),
    queries: z.array(MethodologyQuerySchema).min(1),
  }).superRefine(validateMethodologyDataset);
}

export const MethodologyRelevanceV2DatasetSchema = createMethodologyRelevanceDatasetSchema("methodology-rag-v2");
export const MethodologyRelevanceV3DatasetSchema = createMethodologyRelevanceDatasetSchema("methodology-rag-v3");
export const MethodologyRelevanceV4DatasetSchema = createMethodologyRelevanceDatasetSchema("methodology-rag-v4").superRefine((dataset, context) => {
  if (dataset.retrievalPolicyVersion !== methodologyRetrievalPolicy.version) {
    context.addIssue({ code: "custom", path: ["retrievalPolicyVersion"], message: "v4 必须固定使用当前生产方法检索策略版本。" });
  }
  if (!dataset.candidateSourceId || !dataset.sourceIds.includes(dataset.candidateSourceId)) {
    context.addIssue({ code: "custom", path: ["candidateSourceId"], message: "v4 必须声明并评估新增候选来源。" });
    return;
  }
  for (const split of ["calibration", "heldout"] as const) {
    for (const sourceId of dataset.sourceIds) {
      if (!dataset.queries.some((query) => query.split === split && query.answerability === "answerable" && query.relevantSourceIds.includes(sourceId))) {
        context.addIssue({ code: "custom", path: ["queries"], message: `${split} split 缺少来源 ${sourceId} 的可回答问题。` });
      }
    }
    const candidateFamilies = new Set(dataset.queries
      .filter((query) => query.split === split && query.answerability === "answerable" && query.relevantSourceIds.includes(dataset.candidateSourceId!))
      .map((query) => query.queryFamily));
    if (candidateFamilies.size < 2) {
      context.addIssue({ code: "custom", path: ["queries"], message: `${split} split 至少需要两个新增来源的独立可回答 query family。` });
    }
  }
});

export type MethodologyRelevanceV2Dataset = z.infer<typeof MethodologyRelevanceV2DatasetSchema>;
export type MethodologyRelevanceV3Dataset = z.infer<typeof MethodologyRelevanceV3DatasetSchema>;
export type MethodologyRelevanceV4Dataset = z.infer<typeof MethodologyRelevanceV4DatasetSchema>;

type MethodologyRelevanceDataset = MethodologyRelevanceV2Dataset | MethodologyRelevanceV3Dataset | MethodologyRelevanceV4Dataset;

type EvaluationQueryResult = {
  queryId: string;
  split: "calibration" | "heldout";
  queryFamily: string;
  answerability: "answerable" | "ambiguous" | "out_of_scope";
  query: string;
  rationale: string;
  outOfScopeReason: string | null;
  relevantSourceIds: string[];
  signals: Array<MethodologySourceRelevanceSignal & { acceptedByPolicy: boolean }>;
  policyAcceptedSourceIds: string[];
  retrievedAcceptedSourceIds: string[];
  rejectedBecauseNoAcceptedEvidence: boolean;
  productionPolicyMatchesReturnedEvidence: boolean;
};

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function splitMetrics(results: Array<{
  answerability: "answerable" | "ambiguous" | "out_of_scope";
  relevantSourceIds: string[];
  acceptedSourceIds: string[];
}>) {
  const answerable = results.filter((result) => result.answerability === "answerable");
  const ambiguous = results.filter((result) => result.answerability === "ambiguous");
  const outOfScope = results.filter((result) => result.answerability === "out_of_scope");
  const answerableCovered = answerable.filter((result) => result.acceptedSourceIds.some((sourceId) => result.relevantSourceIds.includes(sourceId))).length;
  const outOfScopeAccepted = outOfScope.filter((result) => result.acceptedSourceIds.length > 0).length;
  const ambiguousAccepted = ambiguous.filter((result) => result.acceptedSourceIds.length > 0).length;
  const ambiguousSupported = ambiguous.filter((result) => result.acceptedSourceIds.some((sourceId) => result.relevantSourceIds.includes(sourceId))).length;
  const ambiguousUnsupported = ambiguous.filter((result) => result.acceptedSourceIds.some((sourceId) => !result.relevantSourceIds.includes(sourceId))).length;
  const ambiguousRelevantAbstentions = ambiguous.filter((result) => result.relevantSourceIds.length > 0
    && !result.acceptedSourceIds.some((sourceId) => result.relevantSourceIds.includes(sourceId))).length;
  const answerableRelevantSourcePairs = answerable.reduce((sum, result) => sum + result.relevantSourceIds.length, 0);
  const retrievedRelevantSourcePairs = answerable.reduce((sum, result) => sum + result.acceptedSourceIds.filter((sourceId) => result.relevantSourceIds.includes(sourceId)).length, 0);
  const answerableAcceptedSourcePairs = answerable.reduce((sum, result) => sum + result.acceptedSourceIds.length, 0);
  return {
    queryCount: results.length,
    answerable: {
      queryCount: answerable.length,
      queriesWithAtLeastOneRelevantSourceAccepted: answerableCovered,
      evidenceCoverage: answerable.length ? rounded(answerableCovered / answerable.length) : null,
      falseAbstentions: answerable.length - answerableCovered,
      relevantSourcePairsAccepted: retrievedRelevantSourcePairs,
      relevantSourcePairs: answerableRelevantSourcePairs,
      sourcePairRecall: answerableRelevantSourcePairs ? rounded(retrievedRelevantSourcePairs / answerableRelevantSourcePairs) : null,
      sourcePairPrecision: answerableAcceptedSourcePairs ? rounded(retrievedRelevantSourcePairs / answerableAcceptedSourcePairs) : null,
      nonRelevantSourcePairsAccepted: answerableAcceptedSourcePairs - retrievedRelevantSourcePairs,
    },
    ambiguous: {
      queryCount: ambiguous.length,
      queriesWithAnySourceAccepted: ambiguousAccepted,
      queriesWithAtLeastOneJudgedRelevantSourceAccepted: ambiguousSupported,
      queriesWithAtLeastOneJudgedNonRelevantSourceAccepted: ambiguousUnsupported,
      queriesWithJudgedRelevantSourceButNoRelevantEvidenceAccepted: ambiguousRelevantAbstentions,
    },
    outOfScope: {
      queryCount: outOfScope.length,
      falseAcceptedQueries: outOfScopeAccepted,
      falseAcceptanceRate: outOfScope.length ? rounded(outOfScopeAccepted / outOfScope.length) : null,
    },
  };
}

export async function evaluateMethodologyRetrievalV2(
  knowledgeBase: LocalKnowledgeBase,
  unparsedDataset: MethodologyRelevanceV2Dataset,
) {
  const dataset = MethodologyRelevanceV2DatasetSchema.parse(unparsedDataset);
  return evaluateMethodologyRetrievalDataset(knowledgeBase, dataset, "这是针对原有两篇作者撰写摘要和固定 query 集的 v2 回归检查。held-out 样本不是线上随机抽样；指标不代表真实用户错误率、答案忠实度、球员排序或引援质量。");
}

export async function evaluateMethodologyRetrievalV3(
  knowledgeBase: LocalKnowledgeBase,
  unparsedDataset: MethodologyRelevanceV3Dataset,
) {
  const dataset = MethodologyRelevanceV3DatasetSchema.parse(unparsedDataset);
  return evaluateMethodologyRetrievalDataset(knowledgeBase, dataset, "这是针对三篇作者标注方法来源与固定中文 query 集的 v3 回归检查。held-out query families 与校准集分离，但不是线上随机抽样；指标不代表答案忠实度、球员排序或引援质量。");
}

export async function compareMethodologyRetrievalV4(input: {
  baselineKnowledgeBase: LocalKnowledgeBase;
  candidateKnowledgeBase: LocalKnowledgeBase;
  dataset: MethodologyRelevanceV4Dataset;
}) {
  const dataset = MethodologyRelevanceV4DatasetSchema.parse(input.dataset);
  const candidateSourceId = dataset.candidateSourceId;
  if (!candidateSourceId) throw new Error("v4 评测集缺少新增来源 ID。");
  const [baselineStatus, candidateStatus] = await Promise.all([
    input.baselineKnowledgeBase.status(),
    input.candidateKnowledgeBase.status(),
  ]);
  if (baselineStatus.indexPath !== candidateStatus.indexPath) {
    throw new Error("source-off 与 source-on 必须读取同一物理知识索引。");
  }
  if (baselineStatus.embeddingModel !== candidateStatus.embeddingModel || baselineStatus.embeddingModel !== dataset.embeddingModel) {
    throw new Error("source-off/source-on 必须使用评测集固定的同一 embedding 模型。");
  }
  if (!baselineStatus.methodologySourceIds.includes(candidateSourceId)
    && candidateStatus.methodologySourceIds.includes(candidateSourceId)) {
    const baselineSourceIds = new Set(baselineStatus.methodologySourceIds);
    const candidateSourceIds = candidateStatus.methodologySourceIds.filter((sourceId) => sourceId !== candidateSourceId);
    if (candidateSourceIds.length !== baselineSourceIds.size
      || candidateSourceIds.some((sourceId) => !baselineSourceIds.has(sourceId))) {
      throw new Error("source-off/source-on 的方法来源登记只能相差新增候选来源这一项。");
    }
  } else {
    throw new Error("source-off 必须排除、source-on 必须登记评测集中的新增候选来源。");
  }

  const baseline = await evaluateMethodologyRetrievalDataset(
    input.baselineKnowledgeBase,
    dataset,
    "同一固定 v4 数据集上的 source-off 基线；作者标注不代表线上分布或球员推荐质量。",
  );
  const candidate = await evaluateMethodologyRetrievalDataset(
    input.candidateKnowledgeBase,
    dataset,
    "同一固定 v4 数据集上的 source-on 对照；作者标注不代表线上分布或球员推荐质量。",
  );
  const heldoutCandidateQueries = dataset.queries.filter((query) => query.split === "heldout"
    && query.answerability === "answerable" && query.relevantSourceIds.includes(candidateSourceId));
  const acceptedCandidateQueryCount = (result: typeof baseline) => heldoutCandidateQueries.filter((query) =>
    result.queries.find((evaluation) => evaluation.queryId === query.id)?.retrievedAcceptedSourceIds.includes(candidateSourceId),
  ).length;
  const baselineCandidateCoverage = heldoutCandidateQueries.length ? rounded(acceptedCandidateQueryCount(baseline) / heldoutCandidateQueries.length) : null;
  const candidateCandidateCoverage = heldoutCandidateQueries.length ? rounded(acceptedCandidateQueryCount(candidate) / heldoutCandidateQueries.length) : null;
  const heldoutAmbiguousUnsupportedCount = (result: typeof baseline) => result.queries.filter((query) => query.split === "heldout"
    && query.answerability === "ambiguous"
    && query.retrievedAcceptedSourceIds.some((sourceId) => !query.relevantSourceIds.includes(sourceId))).length;
  const heldoutOutOfScopeFalseAcceptCount = (result: typeof baseline) => result.queries.filter((query) => query.split === "heldout"
    && query.answerability === "out_of_scope" && query.retrievedAcceptedSourceIds.length > 0).length;
  const baselineAmbiguousUnsupported = heldoutAmbiguousUnsupportedCount(baseline);
  const candidateAmbiguousUnsupported = heldoutAmbiguousUnsupportedCount(candidate);
  const baselineOutOfScopeFalseAccepts = heldoutOutOfScopeFalseAcceptCount(baseline);
  const candidateOutOfScopeFalseAccepts = heldoutOutOfScopeFalseAcceptCount(candidate);
  const candidateEvidenceImproved = candidateCandidateCoverage !== null
    && (baselineCandidateCoverage === null || candidateCandidateCoverage > baselineCandidateCoverage);
  const noIncreaseInUnsupportedAmbiguousAccepts = candidateAmbiguousUnsupported <= baselineAmbiguousUnsupported;
  const noIncreaseInOutOfScopeFalseAccepts = candidateOutOfScopeFalseAccepts <= baselineOutOfScopeFalseAccepts;
  const productionPolicyConsistencyPreserved = baseline.productionPolicyConsistency && candidate.productionPolicyConsistency;

  return {
    evaluationType: "paired-methodology-rag-source-ablation",
    datasetId: dataset.datasetId,
    indexPath: baselineStatus.indexPath,
    embeddingModel: baselineStatus.embeddingModel,
    retrievalPolicyVersion: methodologyRetrievalPolicy.version,
    candidateSourceId,
    baseline,
    candidate,
    heldout: {
      candidateSourceCoverage: { baseline: baselineCandidateCoverage, candidate: candidateCandidateCoverage },
      ambiguousUnsupportedAcceptances: { baseline: baselineAmbiguousUnsupported, candidate: candidateAmbiguousUnsupported },
      outOfScopeFalseAcceptances: { baseline: baselineOutOfScopeFalseAccepts, candidate: candidateOutOfScopeFalseAccepts },
    },
    adoptionGate: {
      candidateEvidenceImproved,
      noIncreaseInUnsupportedAmbiguousAccepts,
      noIncreaseInOutOfScopeFalseAccepts,
      productionPolicyConsistencyPreserved,
      passed: candidateEvidenceImproved && noIncreaseInUnsupportedAmbiguousAccepts
        && noIncreaseInOutOfScopeFalseAccepts && productionPolicyConsistencyPreserved,
    },
    interpretation: "source-off/source-on 共用语料索引、query、embedding 模型及当前生产检索策略；所有结论仅适用于这组作者标注样本，不表示真实用户覆盖或推荐质量。",
  };
}

async function evaluateMethodologyRetrievalDataset(
  knowledgeBase: LocalKnowledgeBase,
  dataset: MethodologyRelevanceDataset,
  interpretation: string,
) {
  const firstQuery = dataset.queries[0];
  if (firstQuery) await knowledgeBase.search({ corpus: dataset.corpus, query: firstQuery.query, playerNames: [], limit: 1 });
  const corpusStatus = await knowledgeBase.status();
  if (corpusStatus.embeddingModel !== dataset.embeddingModel) {
    throw new Error(`评测固定使用 ${dataset.embeddingModel}，当前知识索引使用 ${corpusStatus.embeddingModel}。`);
  }
  if (corpusStatus.methodologyChunks === 0) {
    throw new Error("获准方法语料索引为空；请先导入已登记的方法资料，再运行检索评估。");
  }

  const queryResults: EvaluationQueryResult[] = [];
  for (const query of dataset.queries) {
    const searchRequest = { corpus: dataset.corpus, query: query.query, playerNames: [] as string[], limit: 12 };
    const [signals, acceptedResults] = await Promise.all([
      knowledgeBase.inspectMethodologySearch(searchRequest),
      knowledgeBase.search(searchRequest),
    ]);
    const acceptedSourceIds = [...new Set(acceptedResults.map(({ sourceId }) => sourceId))];
    const expectedAcceptedSourceIds = signals
      .filter((signal) => acceptsMethodologySourceSignal(signal, corpusStatus.embeddingModel))
      .map(({ sourceId }) => sourceId);
    queryResults.push({
      queryId: query.id,
      split: query.split,
      queryFamily: query.queryFamily,
      answerability: query.answerability,
      query: query.query,
      rationale: query.rationale,
      outOfScopeReason: query.outOfScopeReason ?? null,
      relevantSourceIds: query.relevantSourceIds,
      signals: signals.map((signal) => ({
        ...signal,
        maxCosineSimilarity: rounded(signal.maxCosineSimilarity),
        acceptedByPolicy: acceptsMethodologySourceSignal(signal, corpusStatus.embeddingModel),
      })),
      policyAcceptedSourceIds: expectedAcceptedSourceIds,
      retrievedAcceptedSourceIds: acceptedSourceIds,
      rejectedBecauseNoAcceptedEvidence: acceptedSourceIds.length === 0,
      productionPolicyMatchesReturnedEvidence: expectedAcceptedSourceIds.every((sourceId) => acceptedSourceIds.includes(sourceId))
        && acceptedSourceIds.every((sourceId) => expectedAcceptedSourceIds.includes(sourceId)),
    });
  }

  const splitSummary = (split: "calibration" | "heldout") => splitMetrics(queryResults
    .filter((result) => result.split === split)
    .map((result) => ({
      answerability: result.answerability,
      relevantSourceIds: result.relevantSourceIds,
      acceptedSourceIds: result.retrievedAcceptedSourceIds,
    })));

  return {
    evaluationType: "author-labeled-methodology-retrieval-and-abstention-regression",
    datasetId: dataset.datasetId,
    judgmentAuthority: dataset.judgmentAuthority,
    corpus: dataset.corpus,
    embeddingModel: corpusStatus.embeddingModel,
    policy: {
      ...methodologyRetrievalPolicy,
      calibratedOnSplit: "calibration",
      acceptanceDecision: "source-level; only sources accepted by the policy may be returned to the Agent",
      unsupportedEmbeddingModelBehavior: "abstain from all methodology evidence",
    },
    corpusStatus: {
      methodologyChunks: corpusStatus.methodologyChunks,
      playerReportChunks: corpusStatus.playerReportChunks,
      registeredSources: corpusStatus.registeredSources,
      judgedMethodologySources: dataset.sourceIds.length,
      judgedSourceIds: dataset.sourceIds,
    },
    datasetCounts: {
      totalQueries: queryResults.length,
      calibrationQueries: queryResults.filter((result) => result.split === "calibration").length,
      heldoutQueries: queryResults.filter((result) => result.split === "heldout").length,
      heldoutQueryFamiliesAreDisjointFromCalibration: true,
      answerableQueries: queryResults.filter((result) => result.answerability === "answerable").length,
      ambiguousQueries: queryResults.filter((result) => result.answerability === "ambiguous").length,
      outOfScopeQueries: queryResults.filter((result) => result.answerability === "out_of_scope").length,
    },
    calibration: splitSummary("calibration"),
    heldout: splitSummary("heldout"),
    productionPolicyConsistency: queryResults.every((result) => result.productionPolicyMatchesReturnedEvidence),
    interpretation,
    queries: queryResults,
  };
}
