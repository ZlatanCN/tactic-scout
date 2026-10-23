import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { RAG_V2_TARGETS } from "./rag-v2-evaluation.js";

const QuestionShape = z.object({
  id: z.string().min(1),
  split: z.enum(["development", "validation"]),
  corpus: z.enum(["methodology", "player_report"]),
  expectedDisposition: z.enum(["answerable", "partial", "abstain", "not_covered"]),
  sourceArticleIds: z.array(z.string().min(1)).min(1),
});

export const RagV2PipelinePreflightSchema = z.object({
  schemaVersion: z.literal("rag-v2-pipeline-preflight-v1"),
  createdAt: z.iso.datetime(),
  label: z.literal("conservative_gateway_attempt_budget"),
  packetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  controlPackSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  priorGatewayAttempts: z.number().int().nonnegative(),
  generationReservedAttempts: z.number().int().nonnegative(),
  generationActualAttempts: z.number().int().nonnegative(),
  maximumGatewayAttempts: z.number().int().positive(),
  developmentQuestionIds: z.array(z.string().min(1)).min(1),
  rankingComparisonQuestionIds: z.array(z.string().min(1)).min(1),
  validationQuestionIds: z.array(z.string().min(1)).min(1),
  oracleQuestionIds: z.array(z.string().min(1)).min(1).max(4),
  candidateApplicationAttemptsPerQuestion: z.number().int().nonnegative().optional(),
  candidateSseParityCount: z.number().int().nonnegative().max(3).optional(),
  comparisonModes: z.array(z.enum(["full_text", "dense_vector", "hybrid", "gateway_reranked", "local_cross_encoder"])).min(2),
  controlCount: z.number().int().min(24),
  phaseGatewayAttemptCaps: z.object({
    comparison: z.number().int().nonnegative(),
    baseline: z.number().int().nonnegative(),
    candidate: z.number().int().nonnegative(),
    oracle: z.number().int().nonnegative(),
  }),
  totalReservedGatewayAttempts: z.number().int().nonnegative(),
  withinCap: z.boolean(),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type RagV2PipelinePreflight = z.infer<typeof RagV2PipelinePreflightSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value as Record<string, unknown>).sort()
      .map((key) => JSON.stringify(key) + ":" + canonicalJson((value as Record<string, unknown>)[key]))
      .join(",") + "}";
  }
  return JSON.stringify(value);
}

function stableDevelopmentSample(
  questions: z.infer<typeof QuestionShape>[],
  count: number,
  priorities: Array<(question: z.infer<typeof QuestionShape>) => boolean>,
): string[] {
  const development = questions.filter(({ split }) => split === "development");
  const selected: typeof development = [];
  const add = (predicate: (question: typeof development[number]) => boolean) => {
    const question = development.find((candidate) => !selected.some(({ id }) => id === candidate.id) && predicate(candidate));
    if (question) selected.push(question);
  };
  for (const predicate of priorities) add(predicate);
  for (const question of development) {
    if (selected.length >= count) break;
    if (!selected.some(({ id }) => id === question.id)) selected.push(question);
  }
  return selected.slice(0, count).map(({ id }) => id);
}

function stableOracleSample(questions: z.infer<typeof QuestionShape>[], count: number): string[] {
  return stableDevelopmentSample(questions, count, [
    (question) => question.sourceArticleIds.length > 1,
    (question) => question.corpus === "player_report",
    (question) => question.expectedDisposition === "partial",
    (question) => question.expectedDisposition === "abstain" || question.expectedDisposition === "not_covered",
  ]);
}

function stableRankingSample(questions: z.infer<typeof QuestionShape>[], count: number): string[] {
  const development = questions.filter(({ split }) => split === "development");
  const articleIds = [...new Set(development.flatMap(({ sourceArticleIds }) => sourceArticleIds))].sort();
  return stableDevelopmentSample(questions, count, [
    (question) => question.sourceArticleIds.length > 1,
    (question) => question.corpus === "player_report",
    (question) => question.expectedDisposition === "partial",
    (question) => question.expectedDisposition === "abstain" || question.expectedDisposition === "not_covered",
    ...articleIds.map((articleId) => (question: z.infer<typeof QuestionShape>) => question.sourceArticleIds.includes(articleId)),
  ]);
}

export function createRagV2PipelinePreflight(input: {
  packetSha256: string;
  sourceSnapshotHash: string;
  controlPackSha256: string;
  priorGatewayAttempts: number;
  generationReservedAttempts: number;
  generationActualAttempts: number;
  maximumGatewayAttempts?: number;
  questions: unknown[];
  controlCount: number;
  candidateApplicationAttemptsPerQuestion?: number;
  candidateSseParityCount?: number;
  oracleSampleSize?: number;
  comparisonAttemptCap?: number;
  createdAt?: Date;
}): RagV2PipelinePreflight {
  const packetSha256 = z.string().regex(/^[a-f0-9]{64}$/u).parse(input.packetSha256);
  const sourceSnapshotHash = z.string().regex(/^[a-f0-9]{64}$/u).parse(input.sourceSnapshotHash);
  const controlPackSha256 = z.string().regex(/^[a-f0-9]{64}$/u).parse(input.controlPackSha256);
  const questions = z.array(QuestionShape).min(2).parse(input.questions);
  if (new Set(questions.map(({ id }) => id)).size !== questions.length) throw new Error("预检题目 ID 必须唯一。");
  const developmentQuestionIds = questions.filter(({ split }) => split === "development").map(({ id }) => id);
  const validationQuestionIds = questions.filter(({ split }) => split === "validation").map(({ id }) => id);
  if (!developmentQuestionIds.length || !validationQuestionIds.length) throw new Error("冻结题包必须同时包含开发集和验证集题目。");
  const rankingComparisonQuestionIds = stableRankingSample(questions, Math.min(12, developmentQuestionIds.length));
  if (!rankingComparisonQuestionIds.length) throw new Error("开发集没有可供排序对照的题目。");
  const oracleSampleSize = Math.max(1, Math.min(4, Math.floor(input.oracleSampleSize ?? 4)));
  const oracleQuestionIds = stableOracleSample(questions, oracleSampleSize);
  if (!oracleQuestionIds.length) throw new Error("开发集没有可供 Oracle 诊断的题目。");
  const controlCount = z.number().int().min(24).parse(input.controlCount);
  const candidateApplicationAttemptsPerQuestion = Math.max(
    0,
    Math.floor(input.candidateApplicationAttemptsPerQuestion ?? RAG_V2_TARGETS.candidateApplicationAttemptsPerQuestion),
  );
  const candidateSseParityCount = Math.max(0, Math.min(3, Math.floor(input.candidateSseParityCount ?? 1)));
  const comparisonAttemptCap = Math.min(rankingComparisonQuestionIds.length,
    Math.max(0, Math.floor(input.comparisonAttemptCap ?? rankingComparisonQuestionIds.length)));
  const maximumGatewayAttempts = Math.min(
    RAG_V2_TARGETS.maximumFullGatewayCalls,
    Math.max(0, Math.floor(input.maximumGatewayAttempts ?? RAG_V2_TARGETS.maximumFullGatewayCalls)),
  );
  if (maximumGatewayAttempts < 1) throw new Error("全流程网关调用上限必须大于 0。");
  const comparisonModes: RagV2PipelinePreflight["comparisonModes"] = ["full_text", "dense_vector", "hybrid", "gateway_reranked", "local_cross_encoder"];
  const phaseGatewayAttemptCaps = {
    comparison: comparisonAttemptCap,
    baseline: validationQuestionIds.length * (RAG_V2_TARGETS.baselineApplicationAttemptsPerQuestion + 2),
    candidate: validationQuestionIds.length * (candidateApplicationAttemptsPerQuestion + 2)
      + Math.min(candidateSseParityCount, validationQuestionIds.length) * candidateApplicationAttemptsPerQuestion
      + controlCount * 2,
    oracle: oracleQuestionIds.length * 3,
  };
  const totalReservedGatewayAttempts = Math.max(0, Math.floor(input.priorGatewayAttempts))
    + Math.max(0, Math.floor(input.generationReservedAttempts))
    + Object.values(phaseGatewayAttemptCaps).reduce((sum, value) => sum + value, 0);
  const payload = {
    schemaVersion: "rag-v2-pipeline-preflight-v1" as const,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    label: "conservative_gateway_attempt_budget" as const,
    packetSha256,
    sourceSnapshotHash,
    controlPackSha256,
    priorGatewayAttempts: Math.max(0, Math.floor(input.priorGatewayAttempts)),
    generationReservedAttempts: Math.max(0, Math.floor(input.generationReservedAttempts)),
    generationActualAttempts: Math.max(0, Math.floor(input.generationActualAttempts)),
    maximumGatewayAttempts,
    developmentQuestionIds,
    rankingComparisonQuestionIds,
    validationQuestionIds,
    oracleQuestionIds,
    candidateApplicationAttemptsPerQuestion,
    candidateSseParityCount,
    comparisonModes,
    controlCount,
    phaseGatewayAttemptCaps,
    totalReservedGatewayAttempts,
    withinCap: totalReservedGatewayAttempts <= maximumGatewayAttempts,
  };
  return RagV2PipelinePreflightSchema.parse({
    ...payload,
    planSha256: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
  });
}

export function validateRagV2PipelinePreflight(unparsed: unknown): RagV2PipelinePreflight {
  const plan = RagV2PipelinePreflightSchema.parse(unparsed);
  const { planSha256, ...payload } = plan;
  const actual = createHash("sha256").update(canonicalJson(payload)).digest("hex");
  if (actual !== planSha256) throw new Error("全流程预检签名不匹配；计划文件被修改或损坏。");
  return plan;
}
