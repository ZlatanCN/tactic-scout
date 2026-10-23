import { createHash, randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { EvidenceRefSchema, type EvidenceRef } from "../domain/evidence.js";

export const RAG_V2_TARGETS = {
  minimumQuestions: 80,
  minimumFactGroups: 40,
  minimumArticles: 6,
  minimumCrossSourceQuestions: 1,
  supportRate: 0.9,
  requiredFactMacroCoverage: 0.85,
  refusalHandling: 0.9,
  positiveJudgeControlRate: 0.9,
  minimumPositiveJudgeControls: 12,
  minimumNegativeJudgeControls: 12,
  minimumAbstainQuestions: 12,
  maximumQuickGatewayCalls: 100,
  maximumFullGatewayCalls: 1_300,
  candidateApplicationAttemptsPerQuestion: 4,
  baselineApplicationAttemptsPerQuestion: 1,
} as const;

export interface RagV2PipelineCallBudget {
  priorGatewayAttempts: number;
  maximumGatewayAttempts: number;
  generationGatewayAttempts: number;
  developmentQuestionEstimate: number;
  validationQuestionEstimate: number;
  rankingComparisonGatewayAttempts: number;
  fixedBaselineGatewayAttempts: number;
  adaptiveCandidateGatewayAttempts: number;
  oracleDiagnosticGatewayAttempts: number;
  totalEstimatedGatewayAttempts: number;
  withinCap: boolean;
}

export function estimateRagV2PipelineGatewayCalls(input: {
  selectedSectionCount: number;
  maximumGatewayAttempts?: number;
  includeGatewayRankingComparison?: boolean;
  priorGatewayAttempts?: number;
  generationGatewayAttempts?: number;
  developmentQuestionEstimate?: number;
  validationQuestionEstimate?: number;
}): RagV2PipelineCallBudget {
  const sectionCount = Math.max(0, Math.floor(input.selectedSectionCount));
  const groupDevelopmentCount = Math.round(sectionCount * 0.6);
  const groupValidationCount = Math.max(0, sectionCount - groupDevelopmentCount);
  // This is a planning estimate only. The frozen post-generation plan uses exact question IDs and counts.
  const developmentQuestionEstimate = Math.max(0, Math.floor(input.developmentQuestionEstimate ?? groupDevelopmentCount * 2));
  const validationQuestionEstimate = Math.max(0, Math.floor(input.validationQuestionEstimate ?? groupValidationCount * 2));
  const generationGatewayAttempts = Math.max(0, Math.floor(input.generationGatewayAttempts ?? sectionCount * 2));
  const rankingComparisonGatewayAttempts = input.includeGatewayRankingComparison === false ? 0 : Math.min(12, developmentQuestionEstimate);
  const fixedBaselineGatewayAttempts = validationQuestionEstimate
    * (RAG_V2_TARGETS.baselineApplicationAttemptsPerQuestion + 2);
  const adaptiveCandidateGatewayAttempts = validationQuestionEstimate
    * (RAG_V2_TARGETS.candidateApplicationAttemptsPerQuestion + 2)
    + RAG_V2_TARGETS.candidateApplicationAttemptsPerQuestion
    + (RAG_V2_TARGETS.minimumPositiveJudgeControls + RAG_V2_TARGETS.minimumNegativeJudgeControls) * 2;
  const oracleDiagnosticGatewayAttempts = Math.min(4, developmentQuestionEstimate) * 3;
  const priorGatewayAttempts = Math.max(0, Math.floor(input.priorGatewayAttempts ?? 0));
  const totalEstimatedGatewayAttempts = priorGatewayAttempts + generationGatewayAttempts + rankingComparisonGatewayAttempts
    + fixedBaselineGatewayAttempts + adaptiveCandidateGatewayAttempts + oracleDiagnosticGatewayAttempts;
  const maximumGatewayAttempts = Math.min(RAG_V2_TARGETS.maximumFullGatewayCalls, Math.max(0, Math.floor(input.maximumGatewayAttempts ?? RAG_V2_TARGETS.maximumFullGatewayCalls)));
  return {
    priorGatewayAttempts,
    maximumGatewayAttempts,
    generationGatewayAttempts,
    developmentQuestionEstimate,
    validationQuestionEstimate,
    rankingComparisonGatewayAttempts,
    fixedBaselineGatewayAttempts,
    adaptiveCandidateGatewayAttempts,
    oracleDiagnosticGatewayAttempts,
    totalEstimatedGatewayAttempts,
    withinCap: totalEstimatedGatewayAttempts <= maximumGatewayAttempts,
  };
}

export const RagV2EvidenceSpanSchema = EvidenceRefSchema.extend({ sourceId: z.string().min(1), articleId: z.string().min(1) });
export type RagV2EvidenceSpan = z.infer<typeof RagV2EvidenceSpanSchema>;

export const RagV2FactSchema = z.object({
  factId: z.string().min(1),
  statement: z.string().trim().min(1).max(800),
  /** A fact is covered when any path is fully covered; each path requires every span. */
  supportPaths: z.array(z.array(RagV2EvidenceSpanSchema).min(1).max(8)).max(8),
});

export const RagV2QuestionSchema = z.object({
  id: z.string().min(1),
  corpus: z.enum(["methodology", "player_report"]),
  query: z.string().trim().min(2).max(2_000),
  factGroupId: z.string().min(1),
  split: z.enum(["development", "validation"]),
  expectedDisposition: z.enum(["answerable", "partial", "abstain", "not_covered"]),
  corpusWideAbsentDate: z.iso.date().nullable().default(null),
  sourceArticleIds: z.array(z.string().min(1)).min(1),
  facts: z.array(RagV2FactSchema).max(12),
  scopeEvidence: z.array(RagV2EvidenceSpanSchema).max(4).default([]),
  abstentionBasis: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
  subjects: z.array(z.object({ subjectId: z.string().min(3), displayName: z.string().min(2), aliases: z.array(z.string()).default([]) })).max(10).default([]),
  sampleFrom: z.iso.date().optional(),
  sampleTo: z.iso.date().optional(),
  sampleSeasons: z.array(z.string().min(2).max(40)).max(5).default([]),
  provenance: z.object({
    label: z.enum(["synthetic_ai_checked", "programmatic_composition"]),
    generatorModelId: z.string().min(1),
    generatorPromptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    verifierModelId: z.string().min(1),
    verifierPromptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    verifierResult: z.literal("passed"),
    createdAt: z.iso.datetime(),
  }),
  /** Benchmark material must never be admitted as a retrievable source document. */
  indexable: z.literal(false),
}).superRefine((question, context) => {
  if (question.corpus === "player_report" && !question.subjects.length) {
    context.addIssue({ code: "custom", path: ["subjects"], message: "球员报告题必须绑定已核验主体，不能按姓名或开放检索范围生成题目。" });
  }
  if ((question.expectedDisposition === "answerable" || question.expectedDisposition === "partial") && !question.facts.length) {
    context.addIssue({ code: "custom", path: ["facts"], message: "可回答题必须包含至少一个原文支持的必要事实。" });
  }
  if (question.expectedDisposition === "partial" || question.expectedDisposition === "abstain" || question.expectedDisposition === "not_covered") {
    if (!question.abstentionBasis.length) context.addIssue({ code: "custom", path: ["abstentionBasis"], message: "拒答题必须记录范围或缺证依据。" });
  }
  if (question.abstentionBasis.length && question.expectedDisposition !== "answerable" && !question.scopeEvidence.length) {
    context.addIssue({ code: "custom", path: ["scopeEvidence"], message: "部分可答/拒答题必须绑定其声明范围内实际检查过的原文版本。" });
  }
  if (question.expectedDisposition === "not_covered" && question.facts.length) {
    context.addIssue({ code: "custom", path: ["facts"], message: "未覆盖题不能同时包含正向必要事实。" });
  }
  if ((question.expectedDisposition === "partial" || question.expectedDisposition === "abstain") && !question.corpusWideAbsentDate) {
    context.addIssue({ code: "custom", path: ["corpusWideAbsentDate"], message: "部分可答/拒答题必须绑定经过全语料验证的缺失日期。" });
  }
  if (question.expectedDisposition === "answerable" && question.corpusWideAbsentDate !== null) {
    context.addIssue({ code: "custom", path: ["corpusWideAbsentDate"], message: "可回答题不能声明全语料缺失日期。" });
  }
  if (question.facts.some((fact) => !fact.supportPaths.length) && question.expectedDisposition !== "partial") {
    context.addIssue({ code: "custom", path: ["facts"], message: "没有支持路径的必要事实只能用于部分可答题。" });
  }
  const attributedArticleIds = new Set([...question.facts.flatMap((fact) => fact.supportPaths.flat()), ...question.scopeEvidence].map(({ articleId }) => articleId));
  if (attributedArticleIds.size !== question.sourceArticleIds.length
    || question.sourceArticleIds.some((articleId) => !attributedArticleIds.has(articleId))) {
    context.addIssue({ code: "custom", path: ["sourceArticleIds"], message: "sourceArticleIds 必须与原文支持/范围区间的文章归属完全一致。" });
  }
});
export type RagV2Question = z.infer<typeof RagV2QuestionSchema>;

export const RagV2QuestionPackSchema = z.object({
  schemaVersion: z.literal("rag-v2-question-pack-v5"),
  packetId: z.string().min(1),
  createdAt: z.iso.datetime(),
  qrelsMappingVersion: z.literal("reference-evidence-span-v5"),
  sourceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  generationManifest: z.object({
    modelId: z.string().min(1),
    estimatedGatewayAttempts: z.number().int().nonnegative(),
    actualGatewayAttempts: z.number().int().nonnegative(),
    gatewayAttemptCap: z.number().int().positive(),
    selectedSectionCount: z.number().int().nonnegative(),
    verifiedQuestionCount: z.number().int().nonnegative(),
    skippedSectionCount: z.number().int().nonnegative(),
    corpusWideAbsentDateCount: z.number().int().nonnegative(),
    seededQuestionCount: z.number().int().nonnegative(),
    programmaticCrossSourceQuestionCount: z.number().int().nonnegative(),
    programmaticQuestionCount: z.number().int().nonnegative(),
    pipelineCallBudget: z.object({
      priorGatewayAttempts: z.number().int().nonnegative(),
      maximumGatewayAttempts: z.number().int().positive(),
      generationGatewayAttempts: z.number().int().nonnegative(),
      developmentQuestionEstimate: z.number().int().nonnegative(),
      validationQuestionEstimate: z.number().int().nonnegative(),
      rankingComparisonGatewayAttempts: z.number().int().nonnegative(),
      fixedBaselineGatewayAttempts: z.number().int().nonnegative(),
      adaptiveCandidateGatewayAttempts: z.number().int().nonnegative(),
      oracleDiagnosticGatewayAttempts: z.number().int().nonnegative(),
      totalEstimatedGatewayAttempts: z.number().int().nonnegative(),
      withinCap: z.boolean(),
    }),
  }),
  questions: z.array(RagV2QuestionSchema).min(1),
}).strict();
export type RagV2QuestionPack = z.infer<typeof RagV2QuestionPackSchema>;

export const RagV2RankedEvidenceSchema = z.object({
  id: z.string().min(1),
  ref: EvidenceRefSchema,
  rank: z.number().int().positive(),
  text: z.string().min(1),
  sourceId: z.string().min(1),
  source: z.object({
    sourceName: z.string(),
    title: z.string(),
    url: z.string().url(),
    author: z.string(),
    publisher: z.string(),
    publishedAt: z.string().nullable(),
    license: z.string(),
    attribution: z.string(),
    evidenceType: z.enum(["methodology", "external_report", "historical_player_analysis", "first_party_observation"]).optional(),
    articleId: z.string().optional(),
    sectionPath: z.array(z.string()),
  }).optional(),
});
export type RagV2RankedEvidence = z.infer<typeof RagV2RankedEvidenceSchema>;

export interface RagV2SourceText {
  documentRevisionId: string;
  sectionId: string;
  text: string;
}

export interface RagV2QuestionMetrics {
  questionId: string;
  factGroupId: string;
  expectedDisposition: RagV2Question["expectedDisposition"];
  positiveFactCount: number;
  factCoverageAtK: Record<"1" | "3" | "6", number | null>;
  recallAtK: Record<"1" | "3" | "6", number | null>;
  hitAtK: Record<"1" | "3" | "6", number | null>;
  reciprocalRank: number | null;
}

const refIdentity = (reference: EvidenceRef): string => reference.documentRevisionId + "\n" + reference.sectionId;

function spanCovered(span: EvidenceRef, retrieved: readonly EvidenceRef[], sourceText: string): boolean {
  if (span.endOffset > sourceText.length) return false;
  const ranges = retrieved
    .filter((reference) => reference.documentRevisionId === span.documentRevisionId && reference.sectionId === span.sectionId)
    .map((reference) => ({ start: Math.max(span.startOffset, reference.startOffset), end: Math.min(span.endOffset, reference.endOffset) }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  for (let offset = span.startOffset; offset < span.endOffset; offset += 1) {
    if (/\s/u.test(sourceText[offset]!)) continue;
    if (!ranges.some((range) => range.start <= offset && range.end > offset)) return false;
  }
  return true;
}

export function evidenceSpanCoveredByResults(
  span: RagV2EvidenceSpan,
  retrieved: readonly RagV2RankedEvidence[],
  sourceTexts: ReadonlyMap<string, string>,
): boolean {
  const source = sourceTexts.get(refIdentity(span));
  return source !== undefined && spanCovered(span, retrieved.map(({ ref }) => ref), source);
}

export function evaluateRagV2RetrievalQuestion(input: {
  question: RagV2Question;
  rankedEvidence: readonly RagV2RankedEvidence[];
  sourceTexts: ReadonlyMap<string, string>;
}): RagV2QuestionMetrics {
  const facts = input.question.facts;
  const coverageAt = (k: number): number | null => {
    if (!facts.length) return null;
    const evidence = input.rankedEvidence.filter(({ rank }) => rank <= k);
    const covered = facts.filter((fact) => fact.supportPaths.some((path) => path.every((span) => evidenceSpanCoveredByResults(span, evidence, input.sourceTexts))));
    return covered.length / facts.length;
  };
  const ks = [1, 3, 6] as const;
  const coverage = Object.fromEntries(ks.map((k) => [String(k), coverageAt(k)])) as Record<"1" | "3" | "6", number | null>;
  const firstRank = facts.length
    ? Array.from({ length: Math.min(6, Math.max(0, ...input.rankedEvidence.map(({ rank }) => rank))) }, (_value, index) => index + 1)
      .find((rank) => coverageAt(rank) !== null && (coverageAt(rank) ?? 0) > 0) ?? null
    : null;
  // Qrels are fact support paths over immutable source spans, independent of chunk boundaries.
  const recalls = Object.fromEntries(ks.map((k) => [String(k), coverageAt(k)])) as Record<"1" | "3" | "6", number | null>;
  return {
    questionId: input.question.id,
    factGroupId: input.question.factGroupId,
    expectedDisposition: input.question.expectedDisposition,
    positiveFactCount: facts.length,
    factCoverageAtK: coverage,
    recallAtK: recalls,
    hitAtK: Object.fromEntries(ks.map((k) => [String(k), recalls[String(k) as "1" | "3" | "6"] === null ? null : Number((recalls[String(k) as "1" | "3" | "6"] ?? 0) > 0)])) as Record<"1" | "3" | "6", number | null>,
    reciprocalRank: firstRank === null ? null : 1 / firstRank,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson((value as Record<string, unknown>)[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

const queryStopWords = new Set(["what", "does", "do", "the", "a", "an", "this", "that", "these", "those", "passage", "source", "article", "describe", "state", "tell", "show", "which", "who", "how", "and", "it", "for", "about", "is", "are", "in", "on", "before", "after", "also"]);

function queryTokens(query: string): Set<string> {
  return new Set((query.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => (token.length > 1 || /^\d+$/u.test(token)) && !queryStopWords.has(token)));
}

export function areNearDuplicateRagV2Questions(left: string, right: string): boolean {
  const a = queryTokens(left);
  const b = queryTokens(right);
  if (left.normalize("NFKC").toLocaleLowerCase() === right.normalize("NFKC").toLocaleLowerCase()) return true;
  if (a.size < 3 || b.size < 3) return false;
  const overlap = [...a].filter((token) => b.has(token)).length;
  const jaccard = overlap / new Set([...a, ...b]).size;
  return overlap / Math.min(a.size, b.size) >= 0.85 && jaccard >= 0.8;
}

function stableGroupSplits(questions: readonly RagV2Question[]): Map<string, "development" | "validation"> {
  const groups = [...new Set(questions.map(({ factGroupId }) => factGroupId))]
    .sort((left, right) => createHash("sha256").update(left).digest("hex").localeCompare(createHash("sha256").update(right).digest("hex")));
  const developmentCount = Math.round(groups.length * 0.6);
  return new Map(groups.map((group, index) => [group, index < developmentCount ? "development" : "validation"]));
}

function questionSpans(question: Pick<RagV2Question, "facts" | "scopeEvidence">): RagV2EvidenceSpan[] {
  return [...question.facts.flatMap((fact) => fact.supportPaths.flat()), ...question.scopeEvidence];
}

function questionsShareFactOrEvidence(left: RagV2Question, right: RagV2Question): boolean {
  const leftFactIds = new Set(left.facts.map(({ factId }) => factId));
  if (right.facts.some(({ factId }) => leftFactIds.has(factId))) return true;
  const leftSpans = questionSpans(left);
  const rightSpans = questionSpans(right);
  if (leftSpans.some((a) => rightSpans.some((b) => spansOverlap(a, b)))) return true;
  if (left.query.normalize("NFKC").trim().toLocaleLowerCase() === right.query.normalize("NFKC").trim().toLocaleLowerCase()) return true;
  const shareSourceSection = leftSpans.some((leftSpan) => rightSpans.some((rightSpan) => (
    leftSpan.documentRevisionId === rightSpan.documentRevisionId && leftSpan.sectionId === rightSpan.sectionId
  )));
  return shareSourceSection && areNearDuplicateRagV2Questions(left.query, right.query);
}

export interface RagV2QuestionPackValidation {
  ready: boolean;
  errors: string[];
  questionCount: number;
  factGroupCount: number;
  articleCount: number;
  validationQuestionCount: number;
  developmentQuestionCount: number;
  packSha256: string;
}

export function validateRagV2QuestionPack(unparsedPack: RagV2QuestionPack): RagV2QuestionPackValidation {
  const pack = RagV2QuestionPackSchema.parse(unparsedPack);
  const errors: string[] = [];
  const expectedPipelineBudget = estimateRagV2PipelineGatewayCalls({
    selectedSectionCount: pack.generationManifest.selectedSectionCount,
    maximumGatewayAttempts: pack.generationManifest.pipelineCallBudget.maximumGatewayAttempts,
    includeGatewayRankingComparison: pack.generationManifest.pipelineCallBudget.rankingComparisonGatewayAttempts > 0,
    priorGatewayAttempts: pack.generationManifest.pipelineCallBudget.priorGatewayAttempts,
    generationGatewayAttempts: pack.generationManifest.pipelineCallBudget.generationGatewayAttempts,
    developmentQuestionEstimate: pack.generationManifest.pipelineCallBudget.developmentQuestionEstimate,
    validationQuestionEstimate: pack.generationManifest.pipelineCallBudget.validationQuestionEstimate,
  });
  if (canonicalJson(expectedPipelineBudget) !== canonicalJson(pack.generationManifest.pipelineCallBudget)) errors.push("pipeline_call_budget_manifest_mismatch");
  if (!pack.generationManifest.pipelineCallBudget.withinCap) errors.push("pipeline_call_budget_exceeds_cap");
  if (pack.generationManifest.actualGatewayAttempts > pack.generationManifest.pipelineCallBudget.generationGatewayAttempts) errors.push("generation_attempts_exceed_pipeline_manifest");
  const questionIds = new Set<string>();
  const queryHashes = new Map<string, string>();
  const groupSplits = new Map<string, Set<string>>();
  const splitByGroup = stableGroupSplits(pack.questions);
  const articleIds = new Set(pack.questions.flatMap(({ sourceArticleIds }) => sourceArticleIds));
  for (const question of pack.questions) {
    if (questionIds.has(question.id)) errors.push("duplicate_question_id:" + question.id);
    questionIds.add(question.id);
    const queryHash = createHash("sha256").update(question.query.trim().toLocaleLowerCase()).digest("hex");
    const previousGroup = queryHashes.get(queryHash);
    if (previousGroup && previousGroup !== question.factGroupId) errors.push("duplicate_query_crosses_groups:" + question.id);
    queryHashes.set(queryHash, question.factGroupId);
    const splits = groupSplits.get(question.factGroupId) ?? new Set<string>();
    splits.add(question.split);
    groupSplits.set(question.factGroupId, splits);
    if (question.split !== splitByGroup.get(question.factGroupId)) errors.push("unstable_fact_group_split:" + question.factGroupId);
    const sourceSpans = [...question.facts.flatMap((fact) => fact.supportPaths.flat()), ...question.scopeEvidence];
    for (const span of sourceSpans) {
      if (!question.sourceArticleIds.length || !span.sourceId) errors.push("missing_source_attribution:" + question.id);
    }
  }
  for (let left = 0; left < pack.questions.length; left += 1) {
    for (let right = left + 1; right < pack.questions.length; right += 1) {
      if (questionsShareFactOrEvidence(pack.questions[left]!, pack.questions[right]!)
        && pack.questions[left]!.factGroupId !== pack.questions[right]!.factGroupId) {
        errors.push("fact_or_near_duplicate_crosses_groups:" + pack.questions[right]!.id);
      }
    }
  }
  for (const [groupId, splits] of groupSplits) if (splits.size !== 1) errors.push("fact_group_leakage:" + groupId);
  const factGroupCount = new Set(pack.questions.map(({ factGroupId }) => factGroupId)).size;
  const refusalQuestionCount = pack.questions.filter(({ expectedDisposition }) => (
    expectedDisposition === "partial" || expectedDisposition === "abstain" || expectedDisposition === "not_covered"
  )).length;
  const abstainQuestionCount = pack.questions.filter(({ expectedDisposition }) => expectedDisposition === "abstain").length;
  const absentDateCount = new Set(pack.questions.flatMap(({ corpusWideAbsentDate }) => corpusWideAbsentDate ? [corpusWideAbsentDate] : [])).size;
  const crossSourceQuestionCount = pack.questions.filter(({ sourceArticleIds }) => sourceArticleIds.length > 1).length;
  const programmaticQuestionCount = pack.questions.filter(({ provenance }) => provenance.label === "programmatic_composition").length;
  const validationQuestionCount = pack.questions.filter(({ split }) => split === "validation").length;
  const developmentQuestionCount = pack.questions.filter(({ split }) => split === "development").length;
  if (pack.questions.length < RAG_V2_TARGETS.minimumQuestions) errors.push("insufficient_questions:" + pack.questions.length + "/" + RAG_V2_TARGETS.minimumQuestions);
  if (factGroupCount < RAG_V2_TARGETS.minimumFactGroups) errors.push("insufficient_fact_groups:" + factGroupCount + "/" + RAG_V2_TARGETS.minimumFactGroups);
  if (articleIds.size < RAG_V2_TARGETS.minimumArticles) errors.push("insufficient_articles:" + articleIds.size + "/" + RAG_V2_TARGETS.minimumArticles);
  if (refusalQuestionCount < Math.ceil(pack.questions.length * 0.1)) errors.push("insufficient_refusal_questions:" + refusalQuestionCount);
  if (abstainQuestionCount < RAG_V2_TARGETS.minimumAbstainQuestions) errors.push("insufficient_true_abstain_questions:" + abstainQuestionCount);
  if (absentDateCount < RAG_V2_TARGETS.minimumAbstainQuestions) errors.push("insufficient_distinct_corpus_absence_dates:" + absentDateCount);
  if (pack.generationManifest.corpusWideAbsentDateCount !== absentDateCount) errors.push("corpus_absence_manifest_mismatch");
  if (crossSourceQuestionCount < RAG_V2_TARGETS.minimumCrossSourceQuestions) errors.push("insufficient_cross_source_questions:" + crossSourceQuestionCount);
  if (pack.generationManifest.programmaticCrossSourceQuestionCount !== crossSourceQuestionCount) errors.push("cross_source_manifest_mismatch");
  if (pack.generationManifest.programmaticQuestionCount !== programmaticQuestionCount) errors.push("programmatic_question_manifest_mismatch");
  const corpora = new Set(pack.questions.map(({ corpus }) => corpus));
  if (!corpora.has("methodology")) errors.push("missing_methodology_questions");
  if (!corpora.has("player_report")) errors.push("missing_player_report_questions");
  const packSha256 = createHash("sha256").update(canonicalJson(pack)).digest("hex");
  return { ready: errors.length === 0, errors, questionCount: pack.questions.length, factGroupCount, articleCount: articleIds.size, validationQuestionCount, developmentQuestionCount, packSha256 };
}

export type RagV2QuestionDraft = Omit<RagV2Question, "factGroupId" | "split" | "corpusWideAbsentDate"> & { factGroupHint: string; corpusWideAbsentDate?: string | null };

function supportSpans(question: RagV2QuestionDraft): RagV2EvidenceSpan[] {
  return [...question.facts.flatMap((fact) => fact.supportPaths.flat()), ...question.scopeEvidence];
}

function spansOverlap(left: RagV2EvidenceSpan, right: RagV2EvidenceSpan): boolean {
  return left.documentRevisionId === right.documentRevisionId
    && left.sectionId === right.sectionId
    && left.startOffset < right.endOffset
    && right.startOffset < left.endOffset;
}

/** Groups exact duplicate questions, same-section paraphrases, and overlapping evidence before the 60/40 split. */
export function assignRagV2FactGroups(drafts: readonly RagV2QuestionDraft[]): RagV2Question[] {
  const parents = drafts.map((_draft, index) => index);
  const find = (index: number): number => {
    if (parents[index] !== index) parents[index] = find(parents[index]!);
    return parents[index]!;
  };
  const union = (left: number, right: number): void => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parents[Math.max(a, b)] = Math.min(a, b);
  };
  for (let left = 0; left < drafts.length; left += 1) {
    for (let right = left + 1; right < drafts.length; right += 1) {
      const leftSpans = supportSpans(drafts[left]!);
      const rightSpans = supportSpans(drafts[right]!);
      const sameSourceSection = leftSpans.some((a) => rightSpans.some((b) => (
        a.documentRevisionId === b.documentRevisionId && a.sectionId === b.sectionId
      )));
      const exactQuery = drafts[left]!.query.normalize("NFKC").trim().toLocaleLowerCase()
        === drafts[right]!.query.normalize("NFKC").trim().toLocaleLowerCase();
      if (drafts[left]!.factGroupHint === drafts[right]!.factGroupHint
        || drafts[left]!.facts.some((a) => drafts[right]!.facts.some((b) => a.factId === b.factId))
        || exactQuery
        || leftSpans.some((a) => rightSpans.some((b) => spansOverlap(a, b)))
        || sameSourceSection && areNearDuplicateRagV2Questions(drafts[left]!.query, drafts[right]!.query)) union(left, right);
    }
  }
  const groups = new Map<number, number[]>();
  drafts.forEach((_draft, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), index]);
  });
  const groupIds = new Map<number, string>();
  for (const [root, indexes] of groups) {
    const members = indexes.map((index) => drafts[index]!.id).sort();
    groupIds.set(root, "fact-" + createHash("sha256").update(members.join("\n")).digest("hex").slice(0, 20));
  }
  const uniqueGroups = [...groupIds.entries()]
    .sort((left, right) => createHash("sha256").update(left[1]).digest("hex").localeCompare(createHash("sha256").update(right[1]).digest("hex")));
  const developmentCount = Math.round(uniqueGroups.length * 0.6);
  const splitForGroup = new Map(uniqueGroups.map(([root, groupId], index) => [groupId, index < developmentCount ? "development" as const : "validation" as const]));
  return drafts.map((draft, index) => {
    const factGroupId = groupIds.get(find(index))!;
    const { factGroupHint: _factGroupHint, ...question } = draft;
    return RagV2QuestionSchema.parse({ ...question, factGroupId, split: splitForGroup.get(factGroupId) });
  });
}

export interface RagV2GatewayCallEstimate {
  questionCount: number;
  controlCount: number;
  workflow: "retrieval" | "oracle" | "agent" | "full";
  expectedGatewayAttempts: number;
  maximumGatewayAttempts: number;
  withinCap: boolean;
}

export function estimateRagV2GatewayCalls(input: {
  questionCount: number;
  controlCount?: number;
  workflow: RagV2GatewayCallEstimate["workflow"];
  retrievalGatewayAttemptsPerQuestion?: number;
  applicationAttemptsPerQuestion?: number;
  extraGatewayAttempts?: number;
  quick?: boolean;
  requestedCallCap?: number;
}): RagV2GatewayCallEstimate {
  const controlCount = Math.max(0, Math.floor(input.controlCount ?? 24));
  const retrievalAttempts = Math.max(0, Math.floor(input.retrievalGatewayAttemptsPerQuestion ?? 1));
  const appAttempts = Math.max(0, Math.floor(input.applicationAttemptsPerQuestion ?? RAG_V2_TARGETS.candidateApplicationAttemptsPerQuestion));
  const perQuestion = input.workflow === "retrieval" ? retrievalAttempts
    : input.workflow === "oracle" ? retrievalAttempts + 3
      : retrievalAttempts + appAttempts + 2;
  const expectedGatewayAttempts = input.questionCount * perQuestion + controlCount * 2 + Math.max(0, Math.floor(input.extraGatewayAttempts ?? 0));
  const defaultCap = input.quick ? RAG_V2_TARGETS.maximumQuickGatewayCalls : RAG_V2_TARGETS.maximumFullGatewayCalls;
  const maximumGatewayAttempts = Math.min(defaultCap, Math.max(0, Math.floor(input.requestedCallCap ?? defaultCap)));
  return { questionCount: input.questionCount, controlCount, workflow: input.workflow, expectedGatewayAttempts, maximumGatewayAttempts, withinCap: expectedGatewayAttempts <= maximumGatewayAttempts };
}

export const RagV2SemanticVerdictSchema = z.object({
  claimSupport: z.enum(["supported", "unsupported", "uncertain"]),
  requiredFactsCovered: z.enum(["yes", "no", "uncertain"]),
  coveredFactIds: z.array(z.string().min(1)).max(12),
  refusalAppropriate: z.enum(["yes", "no", "uncertain"]),
  rationale: z.string().trim().min(1).max(1_000),
}).superRefine((verdict, context) => {
  if (new Set(verdict.coveredFactIds).size !== verdict.coveredFactIds.length) {
    context.addIssue({ code: "custom", path: ["coveredFactIds"], message: "coveredFactIds 不能重复。" });
  }
});
export type RagV2SemanticVerdict = z.infer<typeof RagV2SemanticVerdictSchema>;
export type RagV2SemanticDecision = "pass" | "fail" | "unresolved";

export function combineRagV2Judgements(input: {
  expectedDisposition: RagV2Question["expectedDisposition"];
  requiredFactCount?: number;
  roleA: RagV2SemanticVerdict;
  roleB: RagV2SemanticVerdict;
}): { decision: RagV2SemanticDecision; supportRate: number | null; factCoverage: number | null; refusalHandling: number | null } {
  const verdicts = [input.roleA, input.roleB];
  const requiredFactCount = Math.max(0, Math.floor(input.requiredFactCount ?? Math.max(input.roleA.coveredFactIds.length, input.roleB.coveredFactIds.length)));
  const coveredByBoth = input.roleA.coveredFactIds.filter((factId) => input.roleB.coveredFactIds.includes(factId)).length;
  const measuredFactCoverage = requiredFactCount ? coveredByBoth / requiredFactCount : null;
  if (requiredFactCount > 0 && verdicts.some((verdict) => (
    verdict.requiredFactsCovered === "yes" && verdict.coveredFactIds.length !== requiredFactCount
    || verdict.requiredFactsCovered === "no" && verdict.coveredFactIds.length === requiredFactCount
  ))) {
    return { decision: "unresolved", supportRate: null, factCoverage: measuredFactCoverage, refusalHandling: null };
  }
  const shouldAnswer = input.expectedDisposition === "answerable" || input.expectedDisposition === "partial";
  const shouldRefuse = input.expectedDisposition === "partial" || input.expectedDisposition === "abstain" || input.expectedDisposition === "not_covered";
  if (verdicts.some((verdict) => verdict.claimSupport === "uncertain" || verdict.requiredFactsCovered === "uncertain" || verdict.refusalAppropriate === "uncertain")) {
    return { decision: "unresolved", supportRate: null, factCoverage: shouldAnswer ? measuredFactCoverage : null, refusalHandling: null };
  }
  if (verdicts[0]!.claimSupport !== verdicts[1]!.claimSupport
    || verdicts[0]!.requiredFactsCovered !== verdicts[1]!.requiredFactsCovered
    || verdicts[0]!.refusalAppropriate !== verdicts[1]!.refusalAppropriate) {
    return { decision: "unresolved", supportRate: null, factCoverage: shouldAnswer ? measuredFactCoverage : null, refusalHandling: null };
  }
  const allSupported = verdicts.every((verdict) => verdict.claimSupport === "supported");
  const allUnsupported = verdicts.every((verdict) => verdict.claimSupport === "unsupported");
  const allRefusal = verdicts.every((verdict) => verdict.refusalAppropriate === "yes");
  const allFacts = verdicts.every((verdict) => verdict.requiredFactsCovered === "yes") && measuredFactCoverage === 1;
  const pass = shouldAnswer
    ? allSupported && allFacts && (input.expectedDisposition !== "partial" || allRefusal)
    : allUnsupported && allRefusal;
  return {
    decision: pass ? "pass" : "fail",
    supportRate: shouldAnswer ? Number(allSupported) : null,
    factCoverage: shouldAnswer ? measuredFactCoverage : null,
    refusalHandling: shouldRefuse ? Number(allRefusal) : null,
  };
}

/**
 * Applies source-bound checks that do not require a model. This catches
 * unsupported numeric and date claims even when both semantic judges are
 * uncertain. It is intentionally narrow: it does not claim to prove support
 * for prose that contains no such token.
 */
export function deterministicRagV2Verdict(input: {
  expectedDisposition: RagV2Question["expectedDisposition"];
  answer: string;
  abstained: boolean;
  citedEvidence: readonly { text: string }[];
  requiredFacts?: readonly string[];
}): { disposition: "answer" | "refuse" | "unknown"; violation: boolean; reason: string | null } {
  const citedText = input.citedEvidence.map(({ text }) => text).join("\n");
  const numberTokens = (value: string) => new Set(
    (value.match(/\b(?:19|20)\d{2}(?:[-/]\d{1,2}){0,2}\b|(?<![\p{L}\d])[-+]?\d+(?:[.,]\d+)?%?(?![\p{L}\d])/gu) ?? [])
      .filter((token) => !/^\d{1,2}$/u.test(token) || !/\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/u.test(value)),
  );
  const answerNumbers = numberTokens(input.answer);
  const unsupportedNumbers = [...answerNumbers].filter((token) => !citedText.includes(token));
  if (!input.abstained && unsupportedNumbers.length) {
    return {
      disposition: "answer",
      violation: true,
      reason: "答案包含引用原文中不存在的数字：" + unsupportedNumbers.slice(0, 3).join("、"),
    };
  }
  const answerDates = new Set(input.answer.match(/\b(?:19|20)\d{2}(?:[-/]\d{1,2}){0,2}\b/gu) ?? []);
  const unsupportedDates = [...answerDates].filter((token) => !citedText.includes(token));
  if (!input.abstained && unsupportedDates.length) {
    return {
      disposition: "answer",
      violation: true,
      reason: "答案包含引用原文中不存在的年份或日期：" + unsupportedDates.slice(0, 3).join("、"),
    };
  }
  if (input.abstained && input.requiredFacts?.length && input.citedEvidence.length) {
    const supportedFacts = input.requiredFacts.filter((fact) => input.citedEvidence.some(({ text }) => (
      text.normalize("NFKC").includes(fact.normalize("NFKC"))
    )));
    if (supportedFacts.length === input.requiredFacts.length) {
      return { disposition: "answer", violation: false, reason: "引用的原文完整包含所需事实，但答案选择了拒答。" };
    }
  }
  return { disposition: "unknown", violation: false, reason: null };
}

export interface RagV2JudgeControlResult {
  controlId: string;
  expected: "positive" | "negative";
  actual: RagV2SemanticDecision;
  controlType?: "grounded_answer" | "unsupported_date" | "unsupported_number" | "wrong_citation" | "omitted_citation";
}

export function evaluateRagV2JudgeControls(controls: readonly RagV2JudgeControlResult[]) {
  const positives = controls.filter(({ expected }) => expected === "positive");
  const negatives = controls.filter(({ expected }) => expected === "negative");
  const positivePasses = positives.filter(({ actual }) => actual === "pass").length;
  const falsePasses = negatives.filter(({ actual }) => actual === "pass").length;
  const positivePassRate = positives.length ? positivePasses / positives.length : null;
  const reliable = positives.length >= RAG_V2_TARGETS.minimumPositiveJudgeControls
    && negatives.length >= RAG_V2_TARGETS.minimumNegativeJudgeControls
    && (positivePassRate ?? 0) >= RAG_V2_TARGETS.positiveJudgeControlRate
    && falsePasses === 0
    && controls.every(({ actual }) => actual !== "unresolved");
  return {
    positiveCount: positives.length,
    negativeCount: negatives.length,
    positivePasses,
    positivePassRate,
    falsePasses,
    unresolvedCount: controls.filter(({ actual }) => actual === "unresolved").length,
    reliable,
  };
}

export interface RagV2QuestionDecision {
  questionId: string;
  split: RagV2Question["split"];
  disposition: RagV2Question["expectedDisposition"];
  semanticDecision: RagV2SemanticDecision;
  deterministicFactCoverage: number | null;
  answerSupportRate: number | null;
  answerFactCoverage: number | null;
  refusalHandling: number | null;
  hardViolationCount: number;
}

export function summarizeRagV2Quality(input: {
  questions: readonly RagV2QuestionDecision[];
  controls: readonly RagV2JudgeControlResult[];
}) {
  const answerable = input.questions.filter(({ disposition }) => disposition === "answerable" || disposition === "partial");
  const refusalExpected = input.questions.filter(({ disposition }) => disposition === "partial" || disposition === "abstain" || disposition === "not_covered");
  const supported = answerable.filter(({ answerSupportRate }) => answerSupportRate === 1).length;
  const refusals = refusalExpected.filter(({ refusalHandling }) => refusalHandling === 1).length;
  const covered = answerable.filter(({ answerFactCoverage }) => answerFactCoverage !== null);
  const factCoverage = answerable.length
    ? answerable.reduce((sum, item) => sum + (item.answerFactCoverage ?? 0), 0) / answerable.length
    : null;
  const retrievalCoverage = input.questions.filter(({ deterministicFactCoverage }) => deterministicFactCoverage !== null);
  const retrievalFactCoverage = retrievalCoverage.length
    ? retrievalCoverage.reduce((sum, item) => sum + (item.deterministicFactCoverage ?? 0), 0) / retrievalCoverage.length
    : null;
  const unresolvedCount = input.questions.filter(({ semanticDecision }) => semanticDecision === "unresolved").length;
  const controls = evaluateRagV2JudgeControls(input.controls);
  const hardViolationCount = input.questions.reduce((sum, item) => sum + item.hardViolationCount, 0);
  const supportRate = answerable.length ? supported / answerable.length : null;
  const refusalHandlingRate = refusalExpected.length ? refusals / refusalExpected.length : null;
  return {
    answerableCount: answerable.length,
    supportedCount: supported,
    supportRate,
    refusalExpectedCount: refusalExpected.length,
    correctRefusalCount: refusals,
    refusalHandlingRate,
    factQuestionCount: covered.length,
    requiredFactMacroCoverage: factCoverage,
    retrievalFactCoverageAt6Macro: retrievalFactCoverage,
    unresolvedCount,
    hardViolationCount,
    judgeControls: controls,
    qualityEligible: unresolvedCount === 0 && hardViolationCount === 0 && controls.reliable
      && (supportRate ?? 0) >= RAG_V2_TARGETS.supportRate
      && (factCoverage ?? 0) >= RAG_V2_TARGETS.requiredFactMacroCoverage
      && (refusalHandlingRate ?? 0) >= RAG_V2_TARGETS.refusalHandling,
    label: "automatic_estimate" as const,
  };
}

export const RagV2AcceptancePinsSchema = z.object({
  packetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceRegistrySha256: z.string().regex(/^[a-f0-9]{64}$/u),
  evidenceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  indexGenerationId: z.string().min(1),
  embeddingModelId: z.string().min(1),
  rankingMode: z.enum(["full_text", "dense_vector", "hybrid", "gateway_reranked", "local_cross_encoder"]),
  investigationStrategy: z.enum(["fixed_single_pass", "adaptive_agent"]),
  rankerModelId: z.string().min(1),
  rankerRevision: z.string().nullable(),
  rankerConfigSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  answerModelId: z.string().min(1),
  controlPackSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  controlEvaluationSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  questionPromptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  verifierPromptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  answerPromptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  judgePromptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  appRevision: z.string().min(1),
});
export type RagV2AcceptancePins = z.infer<typeof RagV2AcceptancePinsSchema>;

export interface RagV2RunCompletion {
  runId: string;
  artifactSha256: string;
  packetSha256: string;
  complete: boolean;
  timedOut: boolean;
  cancelled: boolean;
  gatewayAttempts: number;
  pipelinePreflightSha256?: string | null;
  questionResults: RagV2QuestionDecision[];
  controls: RagV2JudgeControlResult[];
}

export function createRagV2AcceptanceRecord(input: {
  pins: RagV2AcceptancePins;
  baselinePins: RagV2AcceptancePins;
  candidate: RagV2RunCompletion;
  baseline: RagV2RunCompletion;
  candidateSummary: ReturnType<typeof summarizeRagV2Quality>;
  baselineSummary: ReturnType<typeof summarizeRagV2Quality>;
  callEstimate: RagV2GatewayCallEstimate;
  pipelineBudgetAccountedAttempts?: number;
  pipelineBudgetAccounting?: "exact" | "conservative_upper_bound";
  pipelinePreflightSha256?: string | null;
  pipelinePhaseViolations?: string[];
}) {
  const pins = RagV2AcceptancePinsSchema.parse(input.pins);
  const baselinePins = RagV2AcceptancePinsSchema.parse(input.baselinePins);
  const samePacket = pins.packetSha256 === baselinePins.packetSha256
    && input.candidate.packetSha256 === pins.packetSha256
    && input.baseline.packetSha256 === pins.packetSha256;
  const sameEvaluationEnvironment = [
    "sourceRegistrySha256",
    "evidenceSnapshotSha256",
    "indexGenerationId",
    "embeddingModelId",
    "answerModelId",
    "controlPackSha256",
    "controlEvaluationSha256",
    "questionPromptSha256",
    "verifierPromptSha256",
    "answerPromptSha256",
    "judgePromptSha256",
    "appRevision",
  ].every((key) => pins[key as keyof RagV2AcceptancePins] === baselinePins[key as keyof RagV2AcceptancePins]);
  const fixedHybridBaseline = baselinePins.rankingMode === "hybrid" && baselinePins.investigationStrategy === "fixed_single_pass";
  const adaptiveCandidate = pins.investigationStrategy === "adaptive_agent";
  const samePipelinePreflight = input.pipelinePreflightSha256 === undefined
    || input.candidate.pipelinePreflightSha256 === input.pipelinePreflightSha256
      && input.baseline.pipelinePreflightSha256 === input.pipelinePreflightSha256;
  const candidateById = new Map(input.candidate.questionResults.map((result) => [result.questionId, result]));
  const baselineById = new Map(input.baseline.questionResults.map((result) => [result.questionId, result]));
  const comparedIds = [...candidateById.keys()].filter((id) => baselineById.has(id));
  const missingComparisons = candidateById.size !== baselineById.size || comparedIds.length !== candidateById.size;
  const definitionMismatches = comparedIds.flatMap((id) => {
    const candidate = candidateById.get(id)!;
    const baseline = baselineById.get(id)!;
    return candidate.disposition !== baseline.disposition || candidate.split !== baseline.split ? [id] : [];
  });
  const regressions = comparedIds.flatMap((id) => {
    const candidate = candidateById.get(id)!;
    const baseline = baselineById.get(id)!;
    return baseline.semanticDecision === "pass" && candidate.semanticDecision !== "pass" ? [id] : [];
  });
  const retrievalCoverageRegressions = comparedIds.flatMap((id) => {
    const candidate = candidateById.get(id)!.deterministicFactCoverage;
    const baseline = baselineById.get(id)!.deterministicFactCoverage;
    return baseline !== null && (candidate === null || candidate + 1e-9 < baseline) ? [id] : [];
  });
  const categoryNames = ["answerable", "partial", "abstain", "not_covered"] as const;
  const semanticCategoryRegressions = categoryNames.flatMap((category) => {
    const candidateItems = input.candidate.questionResults.filter(({ disposition }) => disposition === category);
    const baselineItems = input.baseline.questionResults.filter(({ disposition }) => disposition === category);
    if (!candidateItems.length || candidateItems.length !== baselineItems.length) return [];
    const candidateRate = candidateItems.filter(({ semanticDecision }) => semanticDecision === "pass").length / candidateItems.length;
    const baselineRate = baselineItems.filter(({ semanticDecision }) => semanticDecision === "pass").length / baselineItems.length;
    return candidateRate + 1e-9 < baselineRate ? [{ category, candidateRate, baselineRate }] : [];
  });
  const noRegression = !missingComparisons && definitionMismatches.length === 0 && regressions.length === 0
    && retrievalCoverageRegressions.length === 0 && semanticCategoryRegressions.length === 0;
  const candidateComplete = input.candidate.complete && !input.candidate.timedOut && !input.candidate.cancelled;
  const baselineComplete = input.baseline.complete && !input.baseline.timedOut && !input.baseline.cancelled;
  const underCallCap = input.callEstimate.withinCap
    && input.candidate.gatewayAttempts <= input.callEstimate.maximumGatewayAttempts
    && input.baseline.gatewayAttempts <= input.callEstimate.maximumGatewayAttempts
    && (input.pipelineBudgetAccountedAttempts === undefined || input.pipelineBudgetAccountedAttempts <= input.callEstimate.maximumGatewayAttempts)
    && !(input.pipelinePhaseViolations?.length);
  const baselineEligible = input.baselineSummary.qualityEligible;
  const eligible = samePacket && sameEvaluationEnvironment && samePipelinePreflight && fixedHybridBaseline && candidateComplete && baselineComplete
    && adaptiveCandidate && underCallCap && noRegression && baselineEligible && input.candidateSummary.qualityEligible;
  const payload = {
    schemaVersion: "rag-v2-acceptance-v1" as const,
    createdAt: new Date().toISOString(),
    status: eligible ? "accepted" as const : "not_accepted" as const,
    label: "automatic_estimate" as const,
    pins,
    baselinePins,
    candidateRunId: input.candidate.runId,
    baselineRunId: input.baseline.runId,
    candidateRunSha256: input.candidate.artifactSha256,
    baselineRunSha256: input.baseline.artifactSha256,
    pipelinePreflightSha256: input.pipelinePreflightSha256 ?? null,
    pipelineBudgetAccountedAttempts: input.pipelineBudgetAccountedAttempts ?? null,
    pipelineBudgetAccounting: input.pipelineBudgetAccounting ?? "exact",
    pipelinePhaseViolations: input.pipelinePhaseViolations ?? [],
    candidateSummary: input.candidateSummary,
    baselineSummary: input.baselineSummary,
    callEstimate: input.callEstimate,
    comparison: { comparedQuestionCount: comparedIds.length, missingComparisons, definitionMismatches, regressions, retrievalCoverageRegressions, semanticCategoryRegressions, fixedHybridBaseline, noRegression },
    blockedReasons: [
      ...(!samePacket ? ["packet_signature_mismatch"] : []),
      ...(!sameEvaluationEnvironment ? ["source_index_model_or_prompt_signature_mismatch"] : []),
      ...(!samePipelinePreflight ? ["pipeline_preflight_mismatch"] : []),
      ...(!fixedHybridBaseline ? ["baseline_is_not_fixed_hybrid"] : []),
      ...(!adaptiveCandidate ? ["candidate_is_not_adaptive_agent"] : []),
      ...(!candidateComplete ? ["candidate_run_incomplete"] : []),
      ...(!baselineComplete ? ["baseline_run_incomplete"] : []),
      ...(!underCallCap ? ["gateway_call_cap_exceeded"] : []),
      ...(!noRegression ? ["candidate_regressed_from_baseline"] : []),
      ...(!baselineEligible ? ["baseline_quality_gate_failed"] : []),
      ...(!input.candidateSummary.qualityEligible ? ["quality_gate_failed"] : []),
    ],
  };
  return { ...payload, recordSha256: createHash("sha256").update(canonicalJson(payload)).digest("hex") };
}

export function createRagV2RunId(): string {
  return randomUUID();
}
