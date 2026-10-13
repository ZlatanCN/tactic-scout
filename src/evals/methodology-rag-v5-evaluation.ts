import { z } from "zod/v4";
import {
  acceptsMethodologySourceSignal,
  methodologyRetrievalPolicy,
  type LocalKnowledgeBase,
  type MethodologySourceRelevanceSignal,
} from "../knowledge/index.js";

const AnswerabilitySchema = z.enum(["answerable", "ambiguous", "out_of_scope"]);

export const MethodologyRetrievalV5QuerySchema = z.object({
  id: z.string().min(1),
  split: z.enum(["calibration", "heldout"]),
  queryFamily: z.string().min(1),
  answerability: AnswerabilitySchema,
  chineseQuery: z.string().trim().min(2).max(2000),
  englishTranslation: z.string().trim().min(2).max(2000),
  relevantSourceIds: z.array(z.string().min(1)),
  rationale: z.string().min(1),
  outOfScopeReason: z.string().min(1).optional(),
}).superRefine((query, context) => {
  if (query.chineseQuery === query.englishTranslation) {
    context.addIssue({ code: "custom", path: ["englishTranslation"], message: "v5 需要与中文原问不同的英文译问。" });
  }
  if (query.answerability === "answerable" && query.relevantSourceIds.length === 0) {
    context.addIssue({ code: "custom", path: ["relevantSourceIds"], message: "可回答 query 必须至少标注一个相关来源。" });
  }
  if (query.answerability === "out_of_scope" && query.relevantSourceIds.length > 0) {
    context.addIssue({ code: "custom", path: ["relevantSourceIds"], message: "范围外 query 不能标注相关来源。" });
  }
  if (query.answerability !== "answerable" && !query.outOfScopeReason) {
    context.addIssue({ code: "custom", path: ["outOfScopeReason"], message: "模糊或范围外 query 必须说明边界。" });
  }
});

export const MethodologyRetrievalV5DatasetSchema = z.object({
  datasetId: z.literal("methodology-rag-v5-crosslingual"),
  corpus: z.literal("methodology"),
  judgmentLevel: z.literal("source"),
  judgmentAuthority: z.literal("author_labeled"),
  translationProvenance: z.string().min(1),
  embeddingModel: z.string().min(1),
  retrievalPolicyVersion: z.literal(methodologyRetrievalPolicy.version),
  candidateSourceId: z.string().min(1),
  controlSourceIds: z.array(z.string().min(1)).min(1),
  sourceIds: z.array(z.string().min(1)).min(2),
  queries: z.array(MethodologyRetrievalV5QuerySchema).length(12),
}).superRefine((dataset, context) => {
  const sourceIds = new Set(dataset.sourceIds);
  if (sourceIds.size !== dataset.sourceIds.length) {
    context.addIssue({ code: "custom", path: ["sourceIds"], message: "来源 ID 必须唯一。" });
  }
  if (!sourceIds.has(dataset.candidateSourceId)) {
    context.addIssue({ code: "custom", path: ["candidateSourceId"], message: "候选论文必须在来源集合中。" });
  }
  for (const controlSourceId of dataset.controlSourceIds) {
    if (!sourceIds.has(controlSourceId) || controlSourceId === dataset.candidateSourceId) {
      context.addIssue({ code: "custom", path: ["controlSourceIds"], message: "控制来源必须是候选来源之外的已登记方法来源。" });
    }
  }
  const queryIds = new Set<string>();
  const families = new Set<string>();
  for (const [index, query] of dataset.queries.entries()) {
    if (queryIds.has(query.id)) {
      context.addIssue({ code: "custom", path: ["queries", index, "id"], message: `重复 query ID：${query.id}` });
    }
    queryIds.add(query.id);
    if (families.has(query.queryFamily)) {
      context.addIssue({ code: "custom", path: ["queries", index, "queryFamily"], message: `v5 每个意图家族只能出现一次：${query.queryFamily}` });
    }
    families.add(query.queryFamily);
    for (const sourceId of query.relevantSourceIds) {
      if (!sourceIds.has(sourceId)) {
        context.addIssue({ code: "custom", path: ["queries", index, "relevantSourceIds"], message: `来源不在评测清单中：${sourceId}` });
      }
    }
  }
  for (const split of ["calibration", "heldout"] as const) {
    const queries = dataset.queries.filter((query) => query.split === split);
    if (queries.length !== 6) {
      context.addIssue({ code: "custom", path: ["queries"], message: `${split} 必须恰好包含 6 个意图家族。` });
    }
    for (const answerability of ["answerable", "ambiguous", "out_of_scope"] as const) {
      if (!queries.some((query) => query.answerability === answerability)) {
        context.addIssue({ code: "custom", path: ["queries"], message: `${split} 缺少 ${answerability} 样例。` });
      }
    }
    const candidateAnswerableFamilies = new Set(queries
      .filter((query) => query.answerability === "answerable" && query.relevantSourceIds.includes(dataset.candidateSourceId))
      .map((query) => query.queryFamily));
    if (candidateAnswerableFamilies.size < 2) {
      context.addIssue({ code: "custom", path: ["queries"], message: `${split} 至少需要两个候选论文可回答意图。` });
    }
    for (const controlSourceId of dataset.controlSourceIds) {
      if (!queries.some((query) => query.answerability === "answerable" && query.relevantSourceIds.includes(controlSourceId))) {
        context.addIssue({ code: "custom", path: ["queries"], message: `${split} 缺少控制来源 ${controlSourceId} 的可回答意图。` });
      }
    }
  }
});

export type MethodologyRetrievalV5Query = z.infer<typeof MethodologyRetrievalV5QuerySchema>;
export type MethodologyRetrievalV5Dataset = z.infer<typeof MethodologyRetrievalV5DatasetSchema>;

export function createCrossLingualMethodologyQueryArms(unparsedQuery: MethodologyRetrievalV5Query) {
  const query = MethodologyRetrievalV5QuerySchema.parse(unparsedQuery);
  const { chineseQuery, englishTranslation, ...shared } = query;
  return {
    chinese: { ...shared, relevantSourceIds: [...shared.relevantSourceIds], arm: "chinese-baseline" as const, query: chineseQuery },
    english: { ...shared, relevantSourceIds: [...shared.relevantSourceIds], arm: "english-translation" as const, query: englishTranslation },
  };
}

interface EvaluatedQuery {
  queryId: string;
  queryFamily: string;
  split: "calibration" | "heldout";
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
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function summarizeSplit(queries: EvaluatedQuery[]) {
  const answerable = queries.filter((query) => query.answerability === "answerable");
  const ambiguous = queries.filter((query) => query.answerability === "ambiguous");
  const outOfScope = queries.filter((query) => query.answerability === "out_of_scope");
  const covered = answerable.filter((query) => query.retrievedAcceptedSourceIds.some((sourceId) => query.relevantSourceIds.includes(sourceId))).length;
  const relevantPairs = answerable.reduce((sum, query) => sum + query.relevantSourceIds.length, 0);
  const acceptedRelevantPairs = answerable.reduce((sum, query) => sum + query.retrievedAcceptedSourceIds.filter((sourceId) => query.relevantSourceIds.includes(sourceId)).length, 0);
  const acceptedPairs = answerable.reduce((sum, query) => sum + query.retrievedAcceptedSourceIds.length, 0);
  const ambiguousUnsupported = ambiguous.filter((query) => query.retrievedAcceptedSourceIds.some((sourceId) => !query.relevantSourceIds.includes(sourceId))).length;
  const outOfScopeFalseAccepts = outOfScope.filter((query) => query.retrievedAcceptedSourceIds.length > 0).length;
  return {
    queryCount: queries.length,
    answerable: {
      queryCount: answerable.length,
      queriesWithRelevantEvidence: covered,
      evidenceCoverage: answerable.length ? rounded(covered / answerable.length) : null,
      falseAbstentions: answerable.length - covered,
      relevantSourcePairsAccepted: acceptedRelevantPairs,
      relevantSourcePairs: relevantPairs,
      sourcePairRecall: relevantPairs ? rounded(acceptedRelevantPairs / relevantPairs) : null,
      sourcePairPrecision: acceptedPairs ? rounded(acceptedRelevantPairs / acceptedPairs) : null,
      nonRelevantSourcePairsAccepted: acceptedPairs - acceptedRelevantPairs,
    },
    ambiguous: {
      queryCount: ambiguous.length,
      queriesWithAnySourceAccepted: ambiguous.filter((query) => query.retrievedAcceptedSourceIds.length > 0).length,
      unsupportedSourceAcceptances: ambiguousUnsupported,
    },
    outOfScope: {
      queryCount: outOfScope.length,
      falseAcceptedQueries: outOfScopeFalseAccepts,
      falseAcceptanceRate: outOfScope.length ? rounded(outOfScopeFalseAccepts / outOfScope.length) : null,
    },
  };
}

async function evaluateArm(
  knowledgeBase: LocalKnowledgeBase,
  dataset: MethodologyRetrievalV5Dataset,
  arm: "chinese-baseline" | "english-translation",
) {
  const evaluated: EvaluatedQuery[] = [];
  for (const query of dataset.queries) {
    const pair = createCrossLingualMethodologyQueryArms(query);
    const armQuery = arm === "chinese-baseline" ? pair.chinese : pair.english;
    const searchRequest = { corpus: dataset.corpus, query: armQuery.query, playerNames: [] as string[], limit: 12 };
    const [signals, results] = await Promise.all([
      knowledgeBase.inspectMethodologySearch(searchRequest),
      knowledgeBase.search(searchRequest),
    ]);
    const retrievedAcceptedSourceIds = [...new Set(results.map(({ sourceId }) => sourceId))];
    const policyAcceptedSourceIds = signals
      .filter((signal) => acceptsMethodologySourceSignal(signal, dataset.embeddingModel))
      .map(({ sourceId }) => sourceId);
    evaluated.push({
      queryId: armQuery.id,
      queryFamily: armQuery.queryFamily,
      split: armQuery.split,
      answerability: armQuery.answerability,
      query: armQuery.query,
      rationale: armQuery.rationale,
      outOfScopeReason: armQuery.outOfScopeReason ?? null,
      relevantSourceIds: armQuery.relevantSourceIds,
      signals: signals.map((signal) => ({
        ...signal,
        maxCosineSimilarity: rounded(signal.maxCosineSimilarity),
        acceptedByPolicy: acceptsMethodologySourceSignal(signal, dataset.embeddingModel),
      })),
      policyAcceptedSourceIds,
      retrievedAcceptedSourceIds,
      rejectedBecauseNoAcceptedEvidence: retrievedAcceptedSourceIds.length === 0,
      productionPolicyMatchesReturnedEvidence: policyAcceptedSourceIds.length === retrievedAcceptedSourceIds.length
        && policyAcceptedSourceIds.every((sourceId) => retrievedAcceptedSourceIds.includes(sourceId))
        && retrievedAcceptedSourceIds.every((sourceId) => policyAcceptedSourceIds.includes(sourceId)),
    });
  }
  const calibration = summarizeSplit(evaluated.filter((query) => query.split === "calibration"));
  const heldout = summarizeSplit(evaluated.filter((query) => query.split === "heldout"));
  return {
    arm,
    calibration,
    heldout,
    productionPolicyConsistency: evaluated.every((query) => query.productionPolicyMatchesReturnedEvidence),
    queries: evaluated,
  };
}

function candidateCoverage(queries: EvaluatedQuery[], candidateSourceId: string): number | null {
  const eligible = queries.filter((query) => query.split === "heldout" && query.answerability === "answerable"
    && query.relevantSourceIds.includes(candidateSourceId));
  if (!eligible.length) return null;
  const accepted = eligible.filter((query) => query.retrievedAcceptedSourceIds.includes(candidateSourceId)).length;
  return rounded(accepted / eligible.length);
}

function ambiguousUnsupportedCount(queries: EvaluatedQuery[]): number {
  return queries.filter((query) => query.split === "heldout" && query.answerability === "ambiguous"
    && query.retrievedAcceptedSourceIds.some((sourceId) => !query.relevantSourceIds.includes(sourceId))).length;
}

function outOfScopeFalseAcceptanceCount(queries: EvaluatedQuery[]): number {
  return queries.filter((query) => query.split === "heldout" && query.answerability === "out_of_scope"
    && query.retrievedAcceptedSourceIds.length > 0).length;
}

export async function compareMethodologyRetrievalV5(input: {
  knowledgeBase: LocalKnowledgeBase;
  dataset: MethodologyRetrievalV5Dataset;
}) {
  const dataset = MethodologyRetrievalV5DatasetSchema.parse(input.dataset);
  const status = await input.knowledgeBase.status();
  const registeredSourceIds = [...status.methodologySourceIds].sort();
  const judgedSourceIds = [...dataset.sourceIds].sort();
  if (status.embeddingModel !== dataset.embeddingModel) {
    throw new Error(`v5 固定使用 ${dataset.embeddingModel}；当前索引使用 ${status.embeddingModel}。`);
  }
  if (dataset.retrievalPolicyVersion !== methodologyRetrievalPolicy.version) {
    throw new Error("v5 必须使用固定的当前方法检索策略。");
  }
  if (registeredSourceIds.length !== judgedSourceIds.length || registeredSourceIds.some((sourceId, index) => sourceId !== judgedSourceIds[index])) {
    throw new Error("v5 数据集必须覆盖临时评测登记中的全部方法来源，且不得存在未标注来源。");
  }
  if (!status.methodologyChunks) throw new Error("v5 方法索引为空，无法评估。");

  const chineseBaseline = await evaluateArm(input.knowledgeBase, dataset, "chinese-baseline");
  const englishTranslation = await evaluateArm(input.knowledgeBase, dataset, "english-translation");
  const baselineCandidateCoverage = candidateCoverage(chineseBaseline.queries, dataset.candidateSourceId);
  const translatedCandidateCoverage = candidateCoverage(englishTranslation.queries, dataset.candidateSourceId);
  const baselineAmbiguousUnsupported = ambiguousUnsupportedCount(chineseBaseline.queries);
  const translatedAmbiguousUnsupported = ambiguousUnsupportedCount(englishTranslation.queries);
  const baselineOutOfScopeFalseAcceptances = outOfScopeFalseAcceptanceCount(chineseBaseline.queries);
  const translatedOutOfScopeFalseAcceptances = outOfScopeFalseAcceptanceCount(englishTranslation.queries);
  const productionPolicyConsistency = chineseBaseline.productionPolicyConsistency && englishTranslation.productionPolicyConsistency;
  const baselineOverallHeldoutCoverage = chineseBaseline.heldout.answerable.evidenceCoverage;
  const translatedOverallHeldoutCoverage = englishTranslation.heldout.answerable.evidenceCoverage;
  const baselineHeldoutPrecision = chineseBaseline.heldout.answerable.sourcePairPrecision;
  const translatedHeldoutPrecision = englishTranslation.heldout.answerable.sourcePairPrecision;
  const heldout = {
    candidateSourceCoverage: { baseline: baselineCandidateCoverage, translated: translatedCandidateCoverage },
    overallEvidenceCoverage: { baseline: baselineOverallHeldoutCoverage, translated: translatedOverallHeldoutCoverage },
    sourcePairPrecision: { baseline: baselineHeldoutPrecision, translated: translatedHeldoutPrecision },
    ambiguousUnsupportedAcceptances: { baseline: baselineAmbiguousUnsupported, translated: translatedAmbiguousUnsupported },
    outOfScopeFalseAcceptances: { baseline: baselineOutOfScopeFalseAcceptances, translated: translatedOutOfScopeFalseAcceptances },
  };
  const adoptionGate = {
    candidateEvidenceImproved: translatedCandidateCoverage !== null
      && (baselineCandidateCoverage === null || translatedCandidateCoverage > baselineCandidateCoverage),
    noDecreaseInOverallEvidenceCoverage: translatedOverallHeldoutCoverage !== null
      && (baselineOverallHeldoutCoverage === null || translatedOverallHeldoutCoverage >= baselineOverallHeldoutCoverage),
    noDecreaseInSourcePairPrecision: translatedHeldoutPrecision !== null
      && (baselineHeldoutPrecision === null || translatedHeldoutPrecision >= baselineHeldoutPrecision),
    noIncreaseInNonRelevantSourcePairs: englishTranslation.heldout.answerable.nonRelevantSourcePairsAccepted
      <= chineseBaseline.heldout.answerable.nonRelevantSourcePairsAccepted,
    noIncreaseInUnsupportedAmbiguousAcceptances: translatedAmbiguousUnsupported <= baselineAmbiguousUnsupported,
    noIncreaseInOutOfScopeFalseAcceptances: translatedOutOfScopeFalseAcceptances <= baselineOutOfScopeFalseAcceptances,
    productionPolicyConsistency,
  };
  return {
    evaluationType: "paired-cross-lingual-methodology-retrieval",
    datasetId: dataset.datasetId,
    indexPath: status.indexPath,
    embeddingModel: status.embeddingModel,
    retrievalPolicyVersion: methodologyRetrievalPolicy.version,
    policy: methodologyRetrievalPolicy,
    translationProvenance: dataset.translationProvenance,
    corpusStatus: {
      methodologyChunks: status.methodologyChunks,
      registeredSources: status.registeredSources,
      sourceIds: status.methodologySourceIds,
      candidateSourceId: dataset.candidateSourceId,
      controlSourceIds: dataset.controlSourceIds,
    },
    datasetCounts: {
      queryFamilies: dataset.queries.length,
      calibrationFamilies: dataset.queries.filter((query) => query.split === "calibration").length,
      heldoutFamilies: dataset.queries.filter((query) => query.split === "heldout").length,
      eachFamilyHasChineseAndEnglishQuery: true,
      variantsShareFamilyLabelsAndSplit: true,
    },
    chineseBaseline,
    englishTranslation,
    heldout,
    adoptionGate: { ...adoptionGate, passed: Object.values(adoptionGate).every(Boolean) },
    interpretation: "同一知识索引、来源登记、multilingual E5、固定生产弃答策略和同一组作者标注意图；两臂只改变检索 query 的语言。小样本工程诊断，不代表真实用户覆盖、翻译质量或足球推荐质量。",
  };
}
