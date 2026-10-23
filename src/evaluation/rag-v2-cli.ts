import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../app.js";
import { createRecruitmentPlanner, type RecruitmentPlanner, type RecruitmentPlannerInput } from "../recruitment/recruitment-planner.js";
import { messageForRecruitmentAction } from "../recruitment/recruitment-tools.js";
import { emptyDecision } from "../recruitment/recruitment-actions.js";
import type { RecruitmentEvaluationEvidenceScope } from "../recruitment/conversation/contracts.js";
import { ConversationTurnResponseSchema, type ConversationTurnResponse } from "../domain/conversation.js";
import { createApplicationAttemptBudget } from "./application-attempt-budget.js";
import type { EvidenceRef } from "../domain/evidence.js";
import {
  isModelGatewayAttemptBudgetExhausted,
  ModelGatewayAttemptLimitError,
  modelGatewayAttemptsUsed,
  withModelGatewayAttemptBudget,
} from "../platform/model-gateway-attempt-budget.js";
import { createKnowledgeEvidence } from "../knowledge/evidence.js";
import { isProjectAuthoredEvidenceDocument } from "../knowledge/evidence-catalog.js";
import { sourceAllowsUrl } from "../knowledge/permissions.js";
import { ConfiguredGatewayEvidenceReranker } from "../knowledge/evidence-models.js";
import { LocalCrossEncoderEvidenceReranker } from "../knowledge/local-cross-encoder-reranker.js";
import type { KnowledgeEvidenceItem } from "../knowledge/evidence-schemas.js";
import {
  createConfiguredRagV2Models,
  ragV2EvaluationCaseId,
  RAG_V2_ANSWER_PROMPT_SHA256,
  RAG_V2_JUDGE_PROMPT_SHA256,
  runRagV2Evaluation,
  type RagV2ApplicationResult,
  type RagV2ExecutionDependencies,
  type RagV2JudgeControlCase,
} from "./rag-v2-runner.js";
import { generateRagV2QuestionPack, RAG_V2_QUESTION_PROMPT_SHA256, RAG_V2_VERIFIER_PROMPT_SHA256 } from "./rag-v2-question-generation.js";
import { buildRagV2JudgeControls, judgeControlCasesFromPack, RagV2JudgeControlsPackSchema } from "./rag-v2-judge-controls.js";
import { createRagV2PipelinePreflight, validateRagV2PipelinePreflight, type RagV2PipelinePreflight } from "./rag-v2-pipeline-preflight.js";
import {
  createRagV2AcceptanceRecord,
  RAG_V2_TARGETS,
  RagV2AcceptancePinsSchema,
  RagV2QuestionPackSchema,
  validateRagV2QuestionPack,
  type RagV2Question,
  type RagV2QuestionPack,
  type RagV2RankedEvidence,
  type RagV2JudgeControlResult,
  type RagV2AcceptancePins,
  type RagV2RunCompletion,
  estimateRagV2GatewayCalls,
} from "./rag-v2-evaluation.js";
import type { RagV2EvaluationRun } from "./rag-v2-runner.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
type RagV2RankingMode = "full_text" | "dense_vector" | "hybrid" | "gateway_reranked" | "local_cross_encoder";
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const has = (name: string): boolean => args.includes(name);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const usage = [
  "用法：",
  "  pnpm eval:rag-v2 -- --mode generate [--out data/knowledge/evaluation/rag-v2-question-pack.v5.json]",
  "  pnpm eval:rag-v2 -- --mode validate --packet <packet.json>",
  "  pnpm eval:rag-v2 -- --mode controls --packet <packet.json> [--out <controls.json>]",
  "  pnpm eval:rag-v2 -- --mode preflight --packet <packet.json> --controls <controls.json> [--out <plan.json>]",
  "  pnpm eval:rag-v2 -- --mode retrieval --packet <packet.json> --split development|validation --ranking-mode full_text|dense_vector|hybrid|gateway_reranked|local_cross_encoder",
  "  pnpm eval:rag-v2 -- --mode compare --packet <packet.json> [--split development|validation] [--ranking-modes full_text,dense_vector,hybrid,gateway_reranked,local_cross_encoder]",
  "  pnpm eval:rag-v2 -- --mode oracle|agent|full --packet <packet.json> --controls <controls.json> [--investigation-strategy fixed_single_pass|adaptive_agent]",
  "  pnpm eval:rag-v2 -- --mode accept --candidate <candidate-run.json> --baseline <baseline-run.json> --comparison <ranker-comparison.json> --retrieval-comparison <retrieval-ablation.json>",
  "",
  "--quick 运行完整 development split，外呼预检上限 100；当前验证集完整运行上限 1,300。超过预检时不删题、不缩小冻结集。",
  "--no-gateway-ranking-comparison 在题包全流程预算中排除可选的网关重排开发集实验。",
  "--prior-gateway-attempts <n> 把此前已消耗的调用计入同一全流程预算。",
  "--seed-packet <older-packet.json> 可导入相同来源快照、相同网关模型已独立核验的短来源问题。",
  "--seed-all-packet 将同快照、同网关模型的已核验题包作为题目种子，并只生成缺少的 player_report 题。",
  "--reuse-controls-from <run.json> 复用匹配配置下已完成的控制评审，避免重复调用同一评审模型。",
  "--preflight <plan.json> 按冻结的全流程预算、题目 ID 和各阶段额度运行。",
  "--comparison-preflight <old-plan.json> 在恢复计划中核验已完成的排序对照。",
  "预检可用 --candidate-application-attempts、--candidate-sse-parity-count、--oracle-sample-size 和 --comparison-attempt-cap 调整尚未执行阶段；单阶段 agent 诊断也可用 --candidate-application-attempts 限制每题应用调用。",
].join("\n");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function referenceId(ref: EvidenceRef): string {
  return sha256(JSON.stringify(ref));
}

function textKey(ref: Pick<EvidenceRef, "documentRevisionId" | "sectionId">): string {
  return ref.documentRevisionId + "\n" + ref.sectionId;
}

function articleIdentityFromUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.searchParams.get("id") ?? (url.pathname.replace(/\/+$/u, "") || value);
  } catch {
    return value;
  }
}

async function validatePackSourceIntegrity(input: {
  packet: RagV2QuestionPack;
  evidence: ReturnType<typeof createKnowledgeEvidence>;
}): Promise<string[]> {
  const errors: string[] = [];
  const [documents, status] = await Promise.all([input.evidence.admin.listActiveDocuments(), input.evidence.admin.status()]);
  if (status.evidenceSnapshotHash !== input.packet.sourceSnapshotHash) return ["source_snapshot_mismatch"];
  const sourcePolicies = new Map<string, Awaited<ReturnType<typeof input.evidence.admin.sourceHistory>>[number]>();
  for (const sourceId of new Set(documents.map(({ sourceId }) => sourceId))) {
    const current = (await input.evidence.admin.sourceHistory(sourceId)).at(-1);
    if (current) sourcePolicies.set(sourceId, current);
  }
  const eligibleDocuments = documents.filter((document) => {
    const policy = sourcePolicies.get(document.sourceId);
    return Boolean(policy && policy.status === "active" && policy.source.rights.aiProcessing
      && policy.source.allowedModelDestinations.includes("configured_chat_gateway")
      && policy.source.allowedCorpora.includes(document.corpus) && sourceAllowsUrl(policy.source, document.url));
  });
  const corpusText = eligibleDocuments.flatMap(({ sections }) => sections.map(({ text }) => text)).join("\n");
  const sectionMetadata = new Map(documents.flatMap((document) => document.sections.map((section) => [
    document.revisionId + "\n" + section.id,
    { sourceId: document.sourceId, corpus: document.corpus, url: document.url, projectAuthored: isProjectAuthoredEvidenceDocument(document) },
  ] as const)));
  const independentlyAttributedArticleIds = new Set<string>();
  for (const question of input.packet.questions) {
    const spans = [...question.facts.flatMap((fact) => fact.supportPaths.flat()), ...question.scopeEvidence];
    const unique = spans.filter((span, index, all) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(span)) === index);
    if (!unique.length) {
      errors.push("question_without_source_intervals:" + question.id);
      continue;
    }
    const refs = unique.map(({ sourceId: _sourceId, articleId: _articleId, ...ref }) => ref);
    const resolved = await input.evidence.reader.resolve(refs, {
      turnId: sha256("rag-v2-pack-source-check\n" + question.id).slice(0, 40),
      purpose: "evaluation",
      modelDestination: "configured_chat_gateway",
    });
    if (resolved.status !== "found" || resolved.evidence.length !== refs.length) {
      errors.push("unresolvable_or_forbidden_source_interval:" + question.id);
      continue;
    }
    const resolvedByRef = new Map(resolved.evidence.map((item) => [JSON.stringify(item.ref), item]));
    const actualArticles = new Set<string>();
    for (const span of unique) {
      const { sourceId, articleId: _articleId, ...ref } = span;
      const metadata = sectionMetadata.get(textKey(ref));
      const item = resolvedByRef.get(JSON.stringify(ref));
      const actualArticleId = metadata ? articleIdentityFromUrl(metadata.url) : null;
      if (metadata?.projectAuthored && question.corpus === "methodology") {
        errors.push("project_authored_summary_used_as_independent_source:" + question.id);
        continue;
      }
      if (!metadata || !item || metadata.sourceId !== sourceId || item.source.sourceId !== sourceId || metadata.corpus !== question.corpus
        || actualArticleId !== span.articleId) {
        errors.push("source_id_corpus_or_revision_owner_mismatch:" + question.id);
        continue;
      }
      actualArticles.add(articleIdentityFromUrl(metadata.url));
      if (!metadata.projectAuthored) independentlyAttributedArticleIds.add(articleIdentityFromUrl(metadata.url));
    }
    if (actualArticles.size !== question.sourceArticleIds.length
      || question.sourceArticleIds.some((articleId) => !actualArticles.has(articleId))) {
      errors.push("source_article_ids_not_equal_to_support_sources:" + question.id);
    }
    if (question.expectedDisposition === "partial" || question.expectedDisposition === "abstain") {
      if (!question.corpusWideAbsentDate || !question.query.includes(question.corpusWideAbsentDate)
        || corpusText.includes(question.corpusWideAbsentDate)) {
        errors.push("corpus_wide_absent_date_not_verified:" + question.id);
      }
    }
  }
  if (independentlyAttributedArticleIds.size < RAG_V2_TARGETS.minimumArticles) {
    errors.push("insufficient_independently_attributed_articles:" + independentlyAttributedArticleIds.size + "/" + RAG_V2_TARGETS.minimumArticles);
  }
  return [...new Set(errors)];
}

function citationEvidence(
  question: RagV2Question,
  sections: ReadonlyMap<string, string>,
  metadata: ReadonlyMap<string, { sourceId: string; corpus: "methodology" | "player_report"; url: string; title: string; author: string }>,
) {
  const spans = [...question.facts.flatMap((fact) => fact.supportPaths.flat()), ...question.scopeEvidence];
  const unique = spans.filter((span, index, all) => all.findIndex((other) => (
    other.documentRevisionId === span.documentRevisionId && other.sectionId === span.sectionId
    && other.startOffset === span.startOffset && other.endOffset === span.endOffset && other.textHash === span.textHash
  )) === index);
  return unique.flatMap((span) => {
    const text = sections.get(textKey(span));
    if (text === undefined || span.endOffset > text.length) return [];
    const excerpt = text.slice(span.startOffset, span.endOffset);
    if (!excerpt.trim() || sha256(excerpt) !== span.textHash) return [];
    const source = metadata.get(textKey(span));
    if (!source || source.sourceId !== span.sourceId) return [];
    const { sourceId, articleId: _articleId, ...ref } = span;
    return [{
      id: referenceId(ref),
      ref,
      text: excerpt,
      sourceId,
      articleId: articleIdentityFromUrl(source.url),
      sourceTitle: source.title,
      sourceUrl: source.url,
      sourceAuthor: source.author,
    }];
  });
}

function evidenceRequest(question: RagV2Question) {
  const limit = question.corpus === "methodology" ? 6 : 12;
  if (question.corpus === "methodology") return { kind: "methodology" as const, query: question.query, limit: Math.min(limit, 6) };
  if (!question.subjects.length) throw new Error("球员报告评测题缺少已核验主体；题包未包含可安全检索的身份。");
  return {
    kind: "player_report" as const,
    query: question.query,
    subjects: question.subjects,
    ...(question.sampleFrom ? { sampleFrom: question.sampleFrom } : {}),
    ...(question.sampleTo ? { sampleTo: question.sampleTo } : {}),
    ...(question.sampleSeasons.length ? { sampleSeasons: question.sampleSeasons } : {}),
    limit,
    perSubjectLimit: Math.min(2, limit),
  };
}

class EvaluationPlannerBudgetExhaustedError extends Error {}

function createEvaluationAgentPlanner(
  currentScope: () => RecruitmentEvaluationEvidenceScope | null,
  attemptBudget: ReturnType<typeof createApplicationAttemptBudget>,
): RecruitmentPlanner {
  const planner = createRecruitmentPlanner();
  const hasPlayerReportSearch = (input: RecruitmentPlannerInput) => input.history.some((entry) => (
    entry.role === "tool" && entry.toolName === "search_player_reports"
  ));
  return {
    ...(planner.preflightContext ? { preflightContext: (input) => planner.preflightContext!(input) } : {}),
    requiresGatewayDispatch(input) {
      if (currentScope()?.corpus === "player_report"
        && input.decisionSnapshot.caps.stage === "investigate"
        && !hasPlayerReportSearch(input)) return false;
      if (!attemptBudget.hasCapacity()) return false;
      return planner.requiresGatewayDispatch?.(input) ?? true;
    },
    ...(planner.isFinalSynthesis ? { isFinalSynthesis: (input) => planner.isFinalSynthesis!(input) } : {}),
    async decide(input) {
      const scope = currentScope();
      if (scope?.corpus === "player_report"
        && input.decisionSnapshot.caps.stage === "investigate"
        && !hasPlayerReportSearch(input)) {
        return messageForRecruitmentAction({
          action: "search_player_reports",
          targetTeam: input.decisionSnapshot.case.targetTeam,
          query: scope.query,
          additionalQueries: [],
          playerNames: [],
          limit: 4,
        }, "rag-v2-benchmark-player-report-lookup");
      }
      const dispatchRequired = planner.requiresGatewayDispatch?.(input) ?? true;
      if (!dispatchRequired) return planner.decide(input);
      if (!attemptBudget.reserve()) return emptyDecision(input.decisionSnapshot.case.targetTeam);
      try {
        return await planner.decide({
          ...input,
          onModelRetry(notice) {
            if (!attemptBudget.reserve()) throw new EvaluationPlannerBudgetExhaustedError();
            input.onModelRetry?.(notice);
          },
        });
      } catch (error) {
        if (error instanceof EvaluationPlannerBudgetExhaustedError || error instanceof ModelGatewayAttemptLimitError
          || !attemptBudget.hasCapacity() || isModelGatewayAttemptBudgetExhausted()) {
          return emptyDecision(input.decisionSnapshot.case.targetTeam);
        }
        throw error;
      }
    },
  };
}

function createdReranker(mode: RagV2RankingMode) {
  if (mode === "hybrid" || mode === "full_text" || mode === "dense_vector") return null;
  if (mode === "gateway_reranked") {
    const reranker = ConfiguredGatewayEvidenceReranker.fromEnvironment();
    if (!reranker) throw new Error("gateway_reranked 需要配置 OPENAI_API_KEY 和 OPENAI_MODEL。");
    return reranker;
  }
  return new LocalCrossEncoderEvidenceReranker();
}

async function writeJson(pathname: string, value: unknown, exclusive = false): Promise<void> {
  const absolute = path.resolve(pathname);
  await mkdir(path.dirname(absolute), { recursive: true });
  const content = JSON.stringify(value, null, 2) + "\n";
  if (!exclusive) {
    await writeFile(absolute, content);
    return;
  }
  await writeFile(absolute, content, { flag: "wx" }).catch(async (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(absolute, "utf8");
    if (existing !== content) throw new Error("输出路径已有不同冻结题包；拒绝覆盖。");
  });
}

async function workingTreeSha256(): Promise<string> {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src", "package.json", "pnpm-lock.yaml"], {
    cwd: projectRoot,
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean).sort();
  const digest = createHash("sha256");
  digest.update(execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim());
  for (const relativePath of files) {
    digest.update("\n" + relativePath + "\n");
    digest.update(await readFile(path.join(projectRoot, relativePath)));
  }
  return digest.digest("hex");
}

async function createAcceptancePins(input: {
  packet: Awaited<ReturnType<typeof loadRagV2Packet>>;
  evidence: ReturnType<typeof createKnowledgeEvidence>;
  rankingMode: RagV2RankingMode;
  investigationStrategy: "fixed_single_pass" | "adaptive_agent";
  reranker: ReturnType<typeof createdReranker>;
  controlPackSha256: string | null;
  controlEvaluationSha256: string | null;
}): Promise<RagV2AcceptancePins> {
  const validation = validateRagV2QuestionPack(input.packet);
  const status = await input.evidence.admin.status();
  if (!status.generationId) throw new Error("没有活动索引代次，不能为评测结果签名。");
  if (input.packet.sourceSnapshotHash !== status.evidenceSnapshotHash) throw new Error("冻结题包来源快照与当前语料不一致；不能运行或签收。");
  const registryPath = path.resolve(process.env.TACTISCOUT_KNOWLEDGE_SOURCES_FILE ?? path.join(projectRoot, "data", "knowledge", "sources.json"));
  const sourceRegistrySha256 = sha256(await readFile(registryPath, "utf8"));
  const rankerConfig = input.reranker instanceof LocalCrossEncoderEvidenceReranker
    ? { modelId: input.reranker.modelId, revision: input.reranker.revision, dtype: input.reranker.dtype, maximumPairTokens: input.reranker.maximumPairTokens }
    : input.rankingMode === "gateway_reranked"
      ? { modelId: process.env.OPENAI_MODEL ?? "missing", retries: false }
      : { modelId: "none" };
  const questionPrompts = [...new Set(input.packet.questions.map(({ provenance }) => provenance.generatorPromptSha256))].sort();
  const verifierPrompts = [...new Set(input.packet.questions.map(({ provenance }) => provenance.verifierPromptSha256))].sort();
  return RagV2AcceptancePinsSchema.parse({
    packetSha256: validation.packSha256,
    sourceRegistrySha256,
    evidenceSnapshotSha256: status.evidenceSnapshotHash,
    indexGenerationId: status.generationId,
    embeddingModelId: status.embeddingModelId,
    rankingMode: input.rankingMode,
    investigationStrategy: input.investigationStrategy,
    rankerModelId: typeof rankerConfig.modelId === "string" ? rankerConfig.modelId : "unknown",
    rankerRevision: input.reranker instanceof LocalCrossEncoderEvidenceReranker ? input.reranker.revision : null,
    rankerConfigSha256: sha256(JSON.stringify(rankerConfig)),
    answerModelId: process.env.OPENAI_MODEL?.trim() || "not_used",
    controlPackSha256: input.controlPackSha256,
    controlEvaluationSha256: input.controlEvaluationSha256,
    questionPromptSha256: questionPrompts.length === 1 ? questionPrompts[0] : sha256(questionPrompts.join("\n")),
    verifierPromptSha256: verifierPrompts.length === 1 ? verifierPrompts[0] : sha256(verifierPrompts.join("\n")),
    answerPromptSha256: RAG_V2_ANSWER_PROMPT_SHA256,
    judgePromptSha256: RAG_V2_JUDGE_PROMPT_SHA256,
    appRevision: await workingTreeSha256(),
  });
}

async function loadRagV2Packet(packetPath: string) {
  return RagV2QuestionPackSchema.parse(JSON.parse(await readFile(path.resolve(packetPath), "utf8")) as unknown);
}

async function loadPipelinePreflight(input: {
  pathname: string;
  packet: RagV2QuestionPack;
  controlPackSha256?: string;
}): Promise<RagV2PipelinePreflight> {
  const plan = validateRagV2PipelinePreflight(JSON.parse(await readFile(path.resolve(input.pathname), "utf8")) as unknown);
  const packetSha256 = validateRagV2QuestionPack(input.packet).packSha256;
  if (plan.packetSha256 !== packetSha256 || plan.sourceSnapshotHash !== input.packet.sourceSnapshotHash
    || plan.generationActualAttempts !== input.packet.generationManifest.actualGatewayAttempts
    || plan.generationReservedAttempts !== input.packet.generationManifest.actualGatewayAttempts
    || plan.priorGatewayAttempts < input.packet.generationManifest.pipelineCallBudget.priorGatewayAttempts
    || input.controlPackSha256 !== undefined && plan.controlPackSha256 !== input.controlPackSha256) {
    throw new Error("全流程预检计划与冻结题包、来源快照、生成调用清单或控制包不匹配。");
  }
  if (!plan.withinCap) throw new Error("全流程预检需要 " + plan.totalReservedGatewayAttempts + " 次网关调用，超过上限 " + plan.maximumGatewayAttempts + "；没有派发请求。");
  return plan;
}

function completionFromRun(run: RagV2EvaluationRun, artifactSha256: string): RagV2RunCompletion {
  return {
    runId: run.runId,
    artifactSha256,
    packetSha256: run.packetSha256,
    complete: run.complete && run.completeValidationSet && run.workflow === "full" && run.split === "validation",
    timedOut: false,
    cancelled: false,
    gatewayAttempts: run.actualGatewayAttempts,
    pipelinePreflightSha256: run.pipelinePreflightSha256,
    questionResults: run.questions.map(({ decision }) => decision),
    controls: run.judgeControls,
  };
}

function parseSseResponse(body: string): ConversationTurnResponse {
  for (const block of body.split(/\r?\n\r?\n/u)) {
    let eventType = "";
    let dataLine = "";
    for (const line of block.split(/\r?\n/u)) {
      if (line.startsWith("event:")) eventType = line.slice(6).trim();
      if (line.startsWith("data:")) dataLine = line.slice(5).trim();
    }
    if (eventType !== "result" || !dataLine) continue;
    const event = JSON.parse(dataLine) as { response?: unknown };
    if (event.response) return ConversationTurnResponseSchema.parse(event.response);
  }
  throw new Error("SSE 流没有返回可解析的 result 事件。");
}

function flattenReport(response: ConversationTurnResponse): string {
  if (response.knowledgeAnswer) {
    return [
      ...response.knowledgeAnswer.claims.map(({ text }) => text),
      ...response.knowledgeAnswer.missingFacts,
    ].filter(Boolean).join("\n");
  }
  const report = response.report;
  if (!report) return response.message;
  return [
    report.needSummary,
    ...report.capabilityProfile,
    ...report.methodologyClaims.map(({ summary, limitations }) => [summary, ...limitations].join(" ")),
    ...report.recommendations.flatMap((recommendation) => [
      recommendation.rationale,
      ...recommendation.reportObservations.map(({ summary, limitations }) => [summary, ...limitations].join(" ")),
    ]),
    ...report.limitations,
  ].filter(Boolean).join("\n");
}

function reportRefs(response: ConversationTurnResponse): EvidenceRef[] {
  if (response.knowledgeAnswer) {
    return response.knowledgeAnswer.claims.flatMap(({ citations }) => citations.map(({ evidenceRef }) => evidenceRef));
  }
  return response.report ? [
    ...response.report.methodologyClaims.flatMap((claim) => claim.citations.map(({ evidenceRef }) => evidenceRef)),
    ...response.report.recommendations.flatMap((recommendation) => recommendation.reportObservations.flatMap((observation) => observation.citations.map(({ evidenceRef }) => evidenceRef))),
  ] : [];
}

function percentile(values: number[], fraction: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]!;
}

function retrievalSummary(run: Awaited<ReturnType<typeof runRagV2Evaluation>>) {
  const factCoverage = run.questions.map(({ retrievalMetrics }) => retrievalMetrics.factCoverageAtK["6"])
    .filter((value): value is number => value !== null);
  const recall = run.questions.map(({ retrievalMetrics }) => retrievalMetrics.recallAtK["6"])
    .filter((value): value is number => value !== null);
  const hit = run.questions.map(({ retrievalMetrics }) => retrievalMetrics.hitAtK["6"])
    .filter((value): value is number => value !== null);
  const reciprocalRanks = run.questions.map(({ retrievalMetrics }) => retrievalMetrics.reciprocalRank)
    .filter((value): value is number => value !== null);
  const durations = run.questions.map(({ retrievalDurationMs }) => retrievalDurationMs);
  const rankingDurations = run.questions.map(({ rankingDurationMs }) => rankingDurationMs)
    .filter((value): value is number => value !== null);
  return {
    questionCount: run.questions.length,
    notApplicableQuestionCount: run.questions.filter(({ retrievalMetrics }) => retrievalMetrics.reciprocalRank === null).length,
    referenceEvidenceCoverageAt6: factCoverage.length ? factCoverage.reduce((sum, value) => sum + value, 0) / factCoverage.length : null,
    factLevelRecallAt6: recall.length ? recall.reduce((sum, value) => sum + value, 0) / recall.length : null,
    factLevelHitAt6: hit.length ? hit.reduce((sum, value) => sum + value, 0) / hit.length : null,
    mrr: reciprocalRanks.length ? reciprocalRanks.reduce((sum, value) => sum + value, 0) / reciprocalRanks.length : null,
    retrievalLatencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95) },
    rerankerLatencyMs: { p50: percentile(rankingDurations, 0.5), p95: percentile(rankingDurations, 0.95) },
  };
}

function appResult(input: {
  response: ConversationTurnResponse;
  citedEvidence: RagV2ApplicationResult["citedEvidence"];
  gatewayAttempts: number;
  fullyReportedGatewayAttempts: number;
  durationMs: number;
  reportGeneration?: RagV2ApplicationResult["reportGeneration"];
  reportProjection?: RagV2ApplicationResult["reportProjection"];
  evidenceInvestigation?: RagV2ApplicationResult["evidenceInvestigation"];
  inputTokens: number | null;
  outputTokens: number | null;
}): RagV2ApplicationResult {
  return {
    answer: flattenReport(input.response).slice(0, 6_000) || input.response.message,
    abstained: input.response.status !== "completed"
      || (!input.response.report && (!input.response.knowledgeAnswer || input.response.knowledgeAnswer.status === "abstained")),
    citedEvidenceIds: input.citedEvidence.map(({ id }) => id),
    citedEvidence: input.citedEvidence,
    gatewayAttempts: input.gatewayAttempts,
    fullyReportedGatewayAttempts: input.fullyReportedGatewayAttempts,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    durationMs: input.durationMs,
    ...(input.reportGeneration ? { reportGeneration: input.reportGeneration } : {}),
    ...(input.reportProjection ? { reportProjection: input.reportProjection } : {}),
    ...(input.evidenceInvestigation ? { evidenceInvestigation: input.evidenceInvestigation } : {}),
    hardViolationCount: 0,
    status: input.response.status,
    phaseTrace: input.response.progressEvents?.map(({ stage }) => stage) ?? [],
    responseFingerprint: sha256(JSON.stringify(input.response)),
  };
}

async function createApplicationRunner(input: {
  knowledgeEvidence: ReturnType<typeof createKnowledgeEvidence>;
  tempRoot: string;
  investigationStrategy: "fixed_single_pass" | "adaptive_agent";
  expectedEvidenceSnapshotHash: string;
}): Promise<{
  run(question: RagV2Question, runId: string, transport: "json" | "sse", maximumGatewayAttempts: number, fixedBaselineEvidence?: RagV2RankedEvidence[]): Promise<RagV2ApplicationResult>;
  close(): Promise<void>;
}> {
  type ApplicationUsage = { gatewayAttempts: number; fullyReportedGatewayAttempts: number; inputTokens: number; outputTokens: number; hasInputTokens: boolean; hasOutputTokens: boolean };
  const usageByRequestId = new Map<string, ApplicationUsage>();
  const ragSubqueriesByRequestId = new Map<string, { initial: number; followup: number }>();
  const reportGenerationByRequestId = new Map<string, NonNullable<RagV2ApplicationResult["reportGeneration"]>>();
  const reportProjectionByRequestId = new Map<string, NonNullable<RagV2ApplicationResult["reportProjection"]>>();
  let currentRequestId: string | null = null;
  let activeQuestion: RagV2Question | null = null;
  const evaluationEvidenceScope = (): RecruitmentEvaluationEvidenceScope | null => activeQuestion ? {
    corpus: activeQuestion.corpus,
    query: activeQuestion.query,
    subjects: activeQuestion.subjects,
    knowledgeQa: true,
    ...(activeQuestion.sampleFrom ? { sampleFrom: activeQuestion.sampleFrom } : {}),
    ...(activeQuestion.sampleTo ? { sampleTo: activeQuestion.sampleTo } : {}),
    sampleSeasons: activeQuestion.sampleSeasons,
  } : null;
  const fixedBaselineModels = input.investigationStrategy === "fixed_single_pass" ? createConfiguredRagV2Models() : null;
  const ensureUsage = (requestId: string): ApplicationUsage => {
    let usage = usageByRequestId.get(requestId);
    if (!usage) {
      usage = { gatewayAttempts: 0, fullyReportedGatewayAttempts: 0, inputTokens: 0, outputTokens: 0, hasInputTokens: false, hasOutputTokens: false };
      usageByRequestId.set(requestId, usage);
    }
    return usage;
  };
  const plannerAttemptBudget = createApplicationAttemptBudget(() => (
    currentRequestId ? ensureUsage(currentRequestId).gatewayAttempts : 0
  ));
  const recordUsage = (
    requestId: string,
    input: { gatewayAttempts?: number; inputTokens?: number; outputTokens?: number },
    countGatewayAttempts = true,
  ) => {
    const usage = ensureUsage(requestId);
    const gatewayAttempts = Math.max(0, input.gatewayAttempts ?? 0);
    if (countGatewayAttempts) usage.gatewayAttempts += gatewayAttempts;
    if (gatewayAttempts > 0 && typeof input.inputTokens === "number" && Number.isFinite(input.inputTokens)
      && typeof input.outputTokens === "number" && Number.isFinite(input.outputTokens)) {
      usage.fullyReportedGatewayAttempts += gatewayAttempts;
    }
    if (typeof input.inputTokens === "number" && Number.isFinite(input.inputTokens)) {
      usage.inputTokens += input.inputTokens;
      usage.hasInputTokens = true;
    }
    if (typeof input.outputTokens === "number" && Number.isFinite(input.outputTokens)) {
      usage.outputTokens += input.outputTokens;
      usage.hasOutputTokens = true;
    }
  };
  const app = input.investigationStrategy === "adaptive_agent" ? createApp({
    knowledgeEvidence: input.knowledgeEvidence,
    recruitmentPlanner: createEvaluationAgentPlanner(evaluationEvidenceScope, plannerAttemptBudget),
    recruitmentEvaluationEvidenceScope: evaluationEvidenceScope,
    checkpointPath: path.join(input.tempRoot, "checkpoints.sqlite"),
    preferenceStorePath: path.join(input.tempRoot, "preferences.sqlite"),
    playerObservationsPath: path.join(input.tempRoot, "observations.sqlite"),
    recruitmentObserver(event) {
      if (!currentRequestId) return;
      if (event.phase === "decision") {
        recordUsage(currentRequestId, { gatewayAttempts: event.gatewayAttempts });
        plannerAttemptBudget.completePlannerDispatch();
      }
      if (event.phase === "brief_usage" || event.phase === "identity_usage" || event.phase === "model_usage") {
        recordUsage(currentRequestId, {
          gatewayAttempts: event.gatewayAttempts,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
        }, event.phase !== "model_usage");
      }
      if (event.phase === "tool") {
        if (event.toolName === "search_methodology" || event.toolName === "search_player_reports") {
          const counts = ragSubqueriesByRequestId.get(currentRequestId) ?? { initial: 0, followup: 0 };
          if (event.ragRound === 2) counts.followup += event.ragSubqueryCount ?? 1;
          else counts.initial += event.ragSubqueryCount ?? 1;
          ragSubqueriesByRequestId.set(currentRequestId, counts);
        }
        recordUsage(currentRequestId, {
          gatewayAttempts: event.rankingGatewayAttempts,
          inputTokens: event.rankingInputTokens ?? undefined,
          outputTokens: event.rankingOutputTokens ?? undefined,
        });
      }
      if (event.phase === "report_generation") {
        reportGenerationByRequestId.set(currentRequestId, {
          durationMs: event.elapsedMs,
          gatewayAttempts: event.gatewayAttempts,
          plannerFallback: event.plannerFallback ?? null,
        });
      }
      if (event.phase === "report_projection") {
        reportProjectionByRequestId.set(currentRequestId, {
          durationMs: event.elapsedMs,
          citationCount: event.citationCount,
          recommendationCount: event.recommendationCount,
        });
      }
    },
  }) : null;
  if (app) await app.ready();
  return {
    async run(question, evaluationRunId, transport, maximumGatewayAttempts, fixedBaselineEvidence) {
      if (input.investigationStrategy === "fixed_single_pass") {
        if (!fixedBaselineModels || !fixedBaselineEvidence) throw new Error("固定基线没有收到与题目相同的应用内混合检索结果。");
        const beforeSnapshot = await input.knowledgeEvidence.admin.status();
        if (beforeSnapshot.evidenceSnapshotHash !== input.expectedEvidenceSnapshotHash) throw new Error("固定基线开始前来源/索引快照已变化；停止派发模型请求。");
        const refs = fixedBaselineEvidence.map(({ ref }) => ref);
        const resolved = refs.length ? await input.knowledgeEvidence.reader.resolve(refs, {
          turnId: sha256("rag-v2-fixed-baseline-reference-check\n" + question.id).slice(0, 40),
          purpose: "evaluation",
          modelDestination: "configured_chat_gateway",
        }) : null;
        if (refs.length && (resolved?.status !== "found" || resolved.evidence.length !== refs.length)) {
          throw new Error("固定基线检索结果在回答前已失效或来源无权发送到网关。");
        }
        const evidenceByRef = new Map(fixedBaselineEvidence.map((item) => [JSON.stringify(item.ref), item]));
        const citedEvidence = (resolved?.evidence ?? []).map((item) => {
          const retrieved = evidenceByRef.get(JSON.stringify(item.ref));
          if (!retrieved || retrieved.text !== item.text || retrieved.sourceId !== item.source.sourceId
            || retrieved.source?.articleId !== articleIdentityFromUrl(item.source.url)) {
            throw new Error("固定基线证据来源与活动原文不一致；未派发答案生成。");
          }
          return {
            id: referenceId(item.ref),
            ref: item.ref,
            text: item.text,
            sourceId: item.source.sourceId,
            articleId: articleIdentityFromUrl(item.source.url),
            sourceTitle: item.source.title,
            sourceUrl: item.source.url,
            sourceAuthor: item.source.author,
          };
        });
        const answer = await withModelGatewayAttemptBudget(maximumGatewayAttempts, () => (
          fixedBaselineModels.generateAnswer({ question, evidence: citedEvidence, stage: "oracle" })
        ));
        if (answer.gatewayAttempts > maximumGatewayAttempts) throw new Error("固定基线超过本题网关调用预检额度。");
        const afterSnapshot = await input.knowledgeEvidence.admin.status();
        if (afterSnapshot.evidenceSnapshotHash !== input.expectedEvidenceSnapshotHash) throw new Error("固定基线运行期间来源/索引快照发生变化；拒绝生成完整运行记录。");
        return {
          ...answer,
          fullyReportedGatewayAttempts: 0,
          hardViolationCount: 0,
          status: "completed",
          phaseTrace: ["fixed_hybrid_retrieval", "answer_generation"],
          citedEvidence,
          responseFingerprint: sha256(JSON.stringify({ answer, citedEvidence: citedEvidence.map(({ id }) => id) })),
        };
      }
      if (!app) throw new Error("自适应应用运行时没有初始化。");
      const runKey = evaluationRunId + "\n" + question.id + "\n" + transport;
      plannerAttemptBudget.reset(maximumGatewayAttempts);
      const caseId = ragV2EvaluationCaseId(evaluationRunId, question.id, transport);
      const requestId = requestIds.get(runKey) ?? randomUUID();
      requestIds.set(runKey, requestId);
      usageByRequestId.set(requestId, { gatewayAttempts: 0, fullyReportedGatewayAttempts: 0, inputTokens: 0, outputTokens: 0, hasInputTokens: false, hasOutputTokens: false });
      ragSubqueriesByRequestId.set(requestId, { initial: 0, followup: 0 });
      reportGenerationByRequestId.delete(requestId);
      reportProjectionByRequestId.delete(requestId);
      currentRequestId = requestId;
      activeQuestion = question;
      const beforeSnapshot = await input.knowledgeEvidence.admin.status();
      if (beforeSnapshot.evidenceSnapshotHash !== input.expectedEvidenceSnapshotHash) throw new Error("评测应用开始前来源/索引快照已变化；停止派发模型请求。");
      const url = "/api/v1/recruitment/cases/" + caseId + "/turns" + (transport === "sse" ? "/stream" : "");
      const startedAt = performance.now();
      let dispatchedGatewayAttempts = 0;
      const response = await withModelGatewayAttemptBudget(maximumGatewayAttempts, () => app.inject({
        method: "POST",
        url,
        payload: { requestId, message: question.query, expectsExistingState: false },
      }).finally(() => { dispatchedGatewayAttempts = modelGatewayAttemptsUsed(); }));
      currentRequestId = null;
      activeQuestion = null;
      const afterSnapshot = await input.knowledgeEvidence.admin.status();
      if (afterSnapshot.evidenceSnapshotHash !== input.expectedEvidenceSnapshotHash) throw new Error("评测应用运行期间来源/索引快照发生变化；拒绝生成完整运行记录。");
      if (response.statusCode !== 200) {
        const failure = new Error("普通招募应用 " + transport + " 入口返回 HTTP " + response.statusCode + "。");
        Object.assign(failure, { gatewayAttempts: dispatchedGatewayAttempts });
        throw failure;
      }
      const parsed = transport === "json"
        ? ConversationTurnResponseSchema.parse(response.json())
        : parseSseResponse(response.body);
      const refs = [...new Map(reportRefs(parsed).map((ref) => [JSON.stringify(ref), ref])).values()];
      const resolved = refs.length
        ? await input.knowledgeEvidence.reader.resolve(refs, {
          turnId: sha256("rag-v2-app-citation-resolution\n" + question.id).slice(0, 40),
          purpose: "reporting",
          modelDestination: "configured_chat_gateway",
        })
        : null;
      const citedEvidence = (resolved?.evidence ?? []).map((item: KnowledgeEvidenceItem) => ({
        id: referenceId(item.ref),
        ref: item.ref,
        text: item.text,
        sourceId: item.source.sourceId,
        articleId: articleIdentityFromUrl(item.source.url),
        sourceTitle: item.source.title,
        sourceUrl: item.source.url,
        sourceAuthor: item.source.author,
      }));
      const usage = ensureUsage(requestId);
      usage.gatewayAttempts = Math.min(usage.gatewayAttempts, dispatchedGatewayAttempts);
      if (usage.gatewayAttempts > maximumGatewayAttempts) throw new Error("普通招募应用超过本题网关调用预检额度；完整运行失败。");
      const result = appResult({
        response: parsed,
        citedEvidence,
        gatewayAttempts: usage.gatewayAttempts,
        fullyReportedGatewayAttempts: Math.min(usage.gatewayAttempts, usage.fullyReportedGatewayAttempts),
        durationMs: Math.ceil(performance.now() - startedAt),
        ...(reportGenerationByRequestId.has(requestId) ? { reportGeneration: reportGenerationByRequestId.get(requestId) } : {}),
        ...(reportProjectionByRequestId.has(requestId) ? { reportProjection: reportProjectionByRequestId.get(requestId) } : {}),
        inputTokens: usage.hasInputTokens ? usage.inputTokens : null,
        outputTokens: usage.hasOutputTokens ? usage.outputTokens : null,
      });
      result.hardViolationCount += Math.max(0, refs.length - citedEvidence.length);
      const subqueries = ragSubqueriesByRequestId.get(requestId) ?? { initial: 0, followup: 0 };
      result.evidenceInvestigation = {
        initialQueryCount: subqueries.initial,
        followupQueryCount: subqueries.followup,
        finalOutcome: parsed.knowledgeAnswer?.status === "answered"
          ? "found"
          : parsed.knowledgeAnswer?.status === "partial"
            ? "partial"
            : parsed.knowledgeAnswer?.status === "abstained"
              ? "abstained"
              : parsed.report && parsed.report.methodologyClaims.length + parsed.report.recommendations.flatMap(({ reportObservations }) => reportObservations).length > 0
                ? "found"
                : "no_evidence",
      };
      result.hardViolationCount += Math.max(0, subqueries.initial - 3) + Math.max(0, subqueries.followup - 2);
      return result;
    },
    async close() {
      if (app) await app.close();
    },
  };
}

const requestIds = new Map<string, string>();

async function main(): Promise<number> {
  const mode = option("--mode") ?? "validate";
  const packetPath = option("--packet");
  const outputPath = option("--out");
  const preflightPath = option("--preflight");
  const rankingMode = (option("--ranking-mode") ?? "hybrid") as RagV2RankingMode;
  const investigationStrategy = (option("--investigation-strategy") ?? "adaptive_agent") as "fixed_single_pass" | "adaptive_agent";
  const split = (option("--split") ?? (has("--quick") || mode === "compare" ? "development" : "validation")) as "development" | "validation" | "all";
  const maximumGatewayCalls = option("--max-calls") ? Number(option("--max-calls")) : undefined;
  const explicitQuestionIds = option("--question-ids")?.split(",").map((id) => id.trim()).filter(Boolean);
  const priorGatewayAttempts = option("--prior-gateway-attempts") ? Number(option("--prior-gateway-attempts")) : 0;
  if (!["generate", "validate", "controls", "preflight", "retrieval", "oracle", "agent", "full", "compare", "accept"].includes(mode)) throw new Error("未知 --mode。\n" + usage);
  if (!["full_text", "dense_vector", "hybrid", "gateway_reranked", "local_cross_encoder"].includes(rankingMode)) throw new Error("未知 --ranking-mode。");
  if (!["fixed_single_pass", "adaptive_agent"].includes(investigationStrategy)) throw new Error("未知 --investigation-strategy。");
  if (!["development", "validation", "all"].includes(split)) throw new Error("未知 --split。");
  if (!Number.isSafeInteger(priorGatewayAttempts) || priorGatewayAttempts < 0) throw new Error("--prior-gateway-attempts 必须是非负整数。");
  if (explicitQuestionIds && new Set(explicitQuestionIds).size !== explicitQuestionIds.length) throw new Error("--question-ids 不能包含重复 ID。");
  if (mode === "accept") {
    const candidatePath = option("--candidate");
    const baselinePath = option("--baseline");
    const comparisonPath = option("--comparison");
    const comparisonPreflightPath = option("--comparison-preflight");
    const retrievalComparisonPath = option("--retrieval-comparison");
    const oraclePath = option("--oracle-run");
    if (!candidatePath || !baselinePath || !comparisonPath || !comparisonPreflightPath || !retrievalComparisonPath || !oraclePath || !preflightPath) {
      throw new Error("accept 模式需要 candidate/baseline、ranker 与 retrieval 对照、comparison/pipeline preflight 和 Oracle 产物，以核对完整全流程预算。\n" + usage);
    }
    const candidateText = await readFile(path.resolve(candidatePath), "utf8");
    const baselineText = await readFile(path.resolve(baselinePath), "utf8");
    const comparisonText = await readFile(path.resolve(comparisonPath), "utf8");
    const retrievalComparisonText = await readFile(path.resolve(retrievalComparisonPath), "utf8");
    const oracleText = await readFile(path.resolve(oraclePath), "utf8");
    const candidate = JSON.parse(candidateText) as RagV2EvaluationRun;
    const baseline = JSON.parse(baselineText) as RagV2EvaluationRun;
    const oracle = JSON.parse(oracleText) as RagV2EvaluationRun;
    const comparison = JSON.parse(comparisonText) as {
      packetSha256?: string;
      sourceSnapshotHash?: string;
      pipelinePreflightSha256?: string | null;
      rankingModes?: Array<{ rankingMode: string; gatewayAttempts: number; questionResults: Array<{ questionId: string }> }>;
    };
    const retrievalComparison = JSON.parse(retrievalComparisonText) as {
      packetSha256?: string;
      sourceSnapshotHash?: string;
      label?: string;
      rankingModes?: Array<{ rankingMode: string; gatewayAttempts: number; questionResults: Array<{ questionId: string; split?: string }> }>;
    };
    const pipelinePlan = validateRagV2PipelinePreflight(JSON.parse(await readFile(path.resolve(preflightPath), "utf8")) as unknown);
    const comparisonPlan = comparisonPreflightPath
      ? validateRagV2PipelinePreflight(JSON.parse(await readFile(path.resolve(comparisonPreflightPath), "utf8")) as unknown)
      : pipelinePlan;
    if (!candidate.acceptancePins || !baseline.acceptancePins) throw new Error("candidate/baseline run 缺少冻结的来源、索引、模型和提示签名。");
    const sameIds = (actual: string[], expected: string[]) => JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
    const candidateIds = candidate.questions.map(({ questionId }) => questionId);
    const baselineIds = baseline.questions.map(({ questionId }) => questionId);
    const oracleIds = oracle.questions.map(({ questionId }) => questionId);
    const comparisonModes = comparison.rankingModes ?? [];
    const modeNames = comparisonModes.map(({ rankingMode: value }) => value).sort();
    const expectedModeNames = [...comparisonPlan.comparisonModes].sort();
    const plannedRetrievalModes = pipelinePlan.comparisonModes.filter((value) => ["full_text", "dense_vector", "hybrid"].includes(value));
    const retrievalModes = retrievalComparison.rankingModes ?? [];
    const retrievalModeNames = retrievalModes.map(({ rankingMode: value }) => value).sort();
    const pipelinePhaseViolations: string[] = [];
    if (!pipelinePlan.withinCap) pipelinePhaseViolations.push("preflight_plan_exceeded_global_cap");
    if (candidate.packetSha256 !== pipelinePlan.packetSha256 || baseline.packetSha256 !== pipelinePlan.packetSha256
      || oracle.packetSha256 !== pipelinePlan.packetSha256 || comparison.packetSha256 !== pipelinePlan.packetSha256
      || comparison.sourceSnapshotHash !== pipelinePlan.sourceSnapshotHash) {
      pipelinePhaseViolations.push("packet_signature_mismatch");
    }
    if ([candidate.pipelinePreflightSha256, baseline.pipelinePreflightSha256, oracle.pipelinePreflightSha256]
      .some((value) => value !== pipelinePlan.planSha256)
      || comparison.pipelinePreflightSha256 !== comparisonPlan.planSha256
      || comparisonPlan.packetSha256 !== pipelinePlan.packetSha256
      || comparisonPlan.sourceSnapshotHash !== pipelinePlan.sourceSnapshotHash
      || !sameIds(comparisonPlan.rankingComparisonQuestionIds, pipelinePlan.rankingComparisonQuestionIds)
      || comparisonPlan.comparisonModes.some((mode) => !pipelinePlan.comparisonModes.includes(mode))) {
      pipelinePhaseViolations.push("pipeline_plan_signature_mismatch");
    }
    if (!sameIds(candidateIds, pipelinePlan.validationQuestionIds) || !sameIds(baselineIds, pipelinePlan.validationQuestionIds)) {
      pipelinePhaseViolations.push("validation_question_set_mismatch");
    }
    if (!sameIds(oracleIds, pipelinePlan.oracleQuestionIds)) pipelinePhaseViolations.push("oracle_question_set_mismatch");
    if (!sameIds(modeNames, expectedModeNames) || comparisonModes.some(({ questionResults }) => !sameIds(
      questionResults.map(({ questionId }) => questionId), comparisonPlan.rankingComparisonQuestionIds,
    ))) pipelinePhaseViolations.push("ranking_comparison_question_set_mismatch");
    if (retrievalComparison.packetSha256 !== pipelinePlan.packetSha256
      || retrievalComparison.sourceSnapshotHash !== pipelinePlan.sourceSnapshotHash
      || retrievalComparison.label !== "retrieval_only_comparison"
      || !sameIds(retrievalModeNames, [...plannedRetrievalModes].sort())
      || retrievalModes.some(({ gatewayAttempts, questionResults }) => gatewayAttempts !== 0
        || !sameIds(questionResults.map(({ questionId }) => questionId), pipelinePlan.developmentQuestionIds)
        || questionResults.some(({ split: questionSplit }) => questionSplit !== "development"))) {
      pipelinePhaseViolations.push("retrieval_ablation_signature_mismatch");
    }
    if (candidate.workflow !== "full" || candidate.split !== "validation" || candidate.rankingMode !== "local_cross_encoder"
      || candidate.investigationStrategy !== "adaptive_agent") pipelinePhaseViolations.push("candidate_workflow_mismatch");
    if (baseline.workflow !== "full" || baseline.split !== "validation" || baseline.rankingMode !== "hybrid"
      || baseline.investigationStrategy !== "fixed_single_pass") pipelinePhaseViolations.push("baseline_workflow_mismatch");
    if (oracle.workflow !== "oracle" || oracle.split !== "development") pipelinePhaseViolations.push("oracle_workflow_mismatch");
    if (baseline.controlEvaluationSourceRunId !== candidate.runId || oracle.controlEvaluationSourceRunId !== candidate.runId
      || baseline.controlEvaluationSha256 !== candidate.controlEvaluationSha256 || oracle.controlEvaluationSha256 !== candidate.controlEvaluationSha256) {
      pipelinePhaseViolations.push("control_evaluation_reuse_mismatch");
    }
    const comparisonAttempts = comparisonModes.reduce((sum, { gatewayAttempts }) => sum + Math.max(0, gatewayAttempts), 0);
    if (comparisonAttempts > pipelinePlan.phaseGatewayAttemptCaps.comparison) pipelinePhaseViolations.push("comparison_phase_call_cap_exceeded");
    if (baseline.actualGatewayAttempts > pipelinePlan.phaseGatewayAttemptCaps.baseline) pipelinePhaseViolations.push("baseline_phase_call_cap_exceeded");
    if (candidate.actualGatewayAttempts > pipelinePlan.phaseGatewayAttemptCaps.candidate) pipelinePhaseViolations.push("candidate_phase_call_cap_exceeded");
    if (oracle.actualGatewayAttempts > pipelinePlan.phaseGatewayAttemptCaps.oracle) pipelinePhaseViolations.push("oracle_phase_call_cap_exceeded");
    const pipelineBudgetAccountedAttempts = pipelinePlan.priorGatewayAttempts + pipelinePlan.generationActualAttempts
      + comparisonAttempts + baseline.actualGatewayAttempts + candidate.actualGatewayAttempts + oracle.actualGatewayAttempts;
    const callEstimate = {
      questionCount: pipelinePlan.validationQuestionIds.length,
      controlCount: pipelinePlan.controlCount,
      workflow: "full" as const,
      expectedGatewayAttempts: pipelinePlan.totalReservedGatewayAttempts,
      maximumGatewayAttempts: pipelinePlan.maximumGatewayAttempts,
      withinCap: pipelineBudgetAccountedAttempts <= pipelinePlan.maximumGatewayAttempts && pipelinePlan.withinCap,
    };
    const record = createRagV2AcceptanceRecord({
      pins: candidate.acceptancePins,
      baselinePins: baseline.acceptancePins,
      candidate: completionFromRun(candidate, sha256(candidateText)),
      baseline: completionFromRun(baseline, sha256(baselineText)),
      candidateSummary: candidate.qualitySummary,
      baselineSummary: baseline.qualitySummary,
      callEstimate,
      pipelineBudgetAccountedAttempts,
      pipelineBudgetAccounting: pipelinePlan.priorGatewayAttempts > comparisonPlan.priorGatewayAttempts
        ? "conservative_upper_bound"
        : "exact",
      pipelinePreflightSha256: pipelinePlan.planSha256,
      pipelinePhaseViolations,
    });
    const destination = outputPath ?? path.join(projectRoot, "data/knowledge/evaluation/runs", "rag-v2-acceptance-" + candidate.runId + ".json");
    await writeJson(destination, record, true);
    console.log(JSON.stringify({
      outputPath: destination,
      status: record.status,
      label: record.label,
      blockedReasons: record.blockedReasons,
      recordSha256: record.recordSha256,
    }, null, 2));
    return record.status === "accepted" ? 0 : 1;
  }
  if (mode !== "generate" && !packetPath) throw new Error("该模式需要 --packet。\n" + usage);

  if (mode === "validate") {
    const packet = RagV2QuestionPackSchema.parse(JSON.parse(await readFile(path.resolve(packetPath!), "utf8")) as unknown);
    const evidence = createKnowledgeEvidence({ reranker: null });
    let sourceErrors: string[];
    try {
      sourceErrors = await validatePackSourceIntegrity({ packet, evidence });
    } finally {
      await evidence.close();
    }
    const result = validateRagV2QuestionPack(packet);
    result.errors.push(...sourceErrors);
    result.ready = result.errors.length === 0;
    console.log(JSON.stringify(result, null, 2));
    return result.ready ? 0 : 1;
  }

  if (mode === "preflight") {
    const packet = await loadRagV2Packet(packetPath!);
    const packetValidation = validateRagV2QuestionPack(packet);
    if (!packetValidation.ready) throw new Error("題包未通過完整性驗證，不能建立全流程計畫：" + packetValidation.errors.join(", "));
    const controlsPath = option("--controls");
    if (!controlsPath) throw new Error("preflight 模式需要 --controls。" + usage);
    const rawControls = await readFile(path.resolve(controlsPath), "utf8");
    const controlPack = RagV2JudgeControlsPackSchema.parse(JSON.parse(rawControls) as unknown);
    if (controlPack.packetSha256 !== packetValidation.packSha256 || controlPack.sourceSnapshotHash !== packet.sourceSnapshotHash) {
      throw new Error("評審控制包與題包或來源快照不匹配。");
    }
    const evidence = createKnowledgeEvidence({ reranker: null });
    try {
      const sourceErrors = await validatePackSourceIntegrity({ packet, evidence });
      if (sourceErrors.length) throw new Error("題包來源完整性失敗：" + sourceErrors.join(", "));
      const documents = await evidence.admin.listActiveDocuments();
      const sourceTexts = new Map(documents.flatMap((document) => document.sections.map((section) => [
        document.revisionId + "\n" + section.id,
        section.text,
      ] as const)));
      const rebuilt = buildRagV2JudgeControls({ packet, sourceTexts });
      if (!rebuilt.ready || !rebuilt.pack || JSON.stringify(rebuilt.pack) !== JSON.stringify(controlPack)) {
        throw new Error("評審控制包與原文來源不一致；不能建立預檢計畫。");
      }
      const plan = createRagV2PipelinePreflight({
        packetSha256: packetValidation.packSha256,
        sourceSnapshotHash: packet.sourceSnapshotHash,
        controlPackSha256: sha256(rawControls),
        priorGatewayAttempts: has("--prior-gateway-attempts")
          ? priorGatewayAttempts
          : packet.generationManifest.pipelineCallBudget.priorGatewayAttempts,
        generationReservedAttempts: packet.generationManifest.actualGatewayAttempts,
        generationActualAttempts: packet.generationManifest.actualGatewayAttempts,
        maximumGatewayAttempts: maximumGatewayCalls ?? packet.generationManifest.pipelineCallBudget.maximumGatewayAttempts,
        questions: packet.questions,
        controlCount: controlPack.controls.length,
        ...(option("--candidate-application-attempts") ? { candidateApplicationAttemptsPerQuestion: Number(option("--candidate-application-attempts")) } : {}),
        ...(option("--candidate-sse-parity-count") ? { candidateSseParityCount: Number(option("--candidate-sse-parity-count")) } : {}),
        ...(option("--oracle-sample-size") ? { oracleSampleSize: Number(option("--oracle-sample-size")) } : {}),
        ...(option("--comparison-attempt-cap") ? { comparisonAttemptCap: Number(option("--comparison-attempt-cap")) } : {}),
      });
      const destination = outputPath ?? path.join(projectRoot, "data/knowledge/evaluation/rag-v2-pipeline-preflight.v5.json");
      await writeJson(destination, plan, true);
      console.log(JSON.stringify({
        outputPath: destination,
        planSha256: plan.planSha256,
        priorGatewayAttempts: plan.priorGatewayAttempts,
        generationReservedAttempts: plan.generationReservedAttempts,
        generationActualAttempts: plan.generationActualAttempts,
        phaseGatewayAttemptCaps: plan.phaseGatewayAttemptCaps,
        candidateApplicationAttemptsPerQuestion: plan.candidateApplicationAttemptsPerQuestion,
        candidateSseParityCount: plan.candidateSseParityCount,
        totalReservedGatewayAttempts: plan.totalReservedGatewayAttempts,
        maximumGatewayAttempts: plan.maximumGatewayAttempts,
        withinCap: plan.withinCap,
        questionCounts: { development: plan.developmentQuestionIds.length, rankingComparison: plan.rankingComparisonQuestionIds.length, validation: plan.validationQuestionIds.length, oracle: plan.oracleQuestionIds.length },
      }, null, 2));
      return plan.withinCap ? 0 : 1;
    } finally {
      await evidence.close();
    }
  }

  if (mode === "compare") {
    const packet = RagV2QuestionPackSchema.parse(JSON.parse(await readFile(path.resolve(packetPath!), "utf8")) as unknown);
    const packValidation = validateRagV2QuestionPack(packet);
    const pipelinePlan = preflightPath ? await loadPipelinePreflight({ pathname: preflightPath, packet }) : null;
    if (pipelinePlan && split !== "development") throw new Error("冻结全流程排序对照只能使用预检计划指定的 development 题目。");
    const selectedIds = pipelinePlan?.rankingComparisonQuestionIds;
    const selectedQuestions = packet.questions.filter(({ id, split: questionSplit }) => selectedIds
      ? selectedIds.includes(id)
      : split === "all" || questionSplit === split);
    if (!selectedQuestions.length) throw new Error("所选 split 没有题目。");
    if (pipelinePlan && (selectedQuestions.length !== pipelinePlan.rankingComparisonQuestionIds.length
      || selectedQuestions.some(({ split: questionSplit }) => questionSplit !== "development"))) {
      throw new Error("排序对照题目与预检计划不一致。");
    }
    if ((split === "validation" || split === "all") && !packValidation.ready) throw new Error("冻结验证题包尚未通过完整性门槛。");
    const quick = has("--quick");
    const comparisonModes = (option("--ranking-modes") ?? "full_text,dense_vector,hybrid,gateway_reranked,local_cross_encoder")
      .split(",")
      .map((candidate) => candidate.trim())
      .filter(Boolean) as RagV2RankingMode[];
    if (comparisonModes.length < 2 || new Set(comparisonModes).size !== comparisonModes.length
      || comparisonModes.some((candidate) => !["full_text", "dense_vector", "hybrid", "gateway_reranked", "local_cross_encoder"].includes(candidate))) {
      throw new Error("排序对比至少需要两个不重复的 --ranking-modes，值为 full_text、dense_vector、hybrid、gateway_reranked 或 local_cross_encoder。");
    }
    if (pipelinePlan && JSON.stringify(comparisonModes) !== JSON.stringify(pipelinePlan.comparisonModes)) {
      throw new Error("排序模式与冻结预检计划不一致。");
    }
    if (!pipelinePlan && comparisonModes.includes("gateway_reranked") && packet.generationManifest.pipelineCallBudget.rankingComparisonGatewayAttempts === 0) {
      throw new Error("冻结全流程预算没有包含网关重排对照；本次停止派发。重新生成预算或仅比较 hybrid 与 local_cross_encoder。");
    }
    const comparisonCallCap = pipelinePlan?.phaseGatewayAttemptCaps.comparison ?? maximumGatewayCalls;
    const callEstimate = estimateRagV2GatewayCalls({
      questionCount: selectedQuestions.length,
      controlCount: 0,
      workflow: "retrieval",
      retrievalGatewayAttemptsPerQuestion: comparisonModes.includes("gateway_reranked") ? 1 : 0,
      quick,
      requestedCallCap: comparisonCallCap,
    });
    if (!callEstimate.withinCap) throw new Error("排序模式对比预检需要 " + callEstimate.expectedGatewayAttempts + " 次网关调用，超过上限 " + callEstimate.maximumGatewayAttempts + "；没有加载排序候选或查询题目。");
    const runs = [];
    for (const candidateMode of comparisonModes) {
      const candidateReranker = createdReranker(candidateMode);
      const system = createKnowledgeEvidence({ reranker: candidateReranker, allowUnacceptedHybridEvaluation: true });
      const rssBefore = process.memoryUsage().rss;
      const rankerStartedAt = performance.now();
      try {
        if (candidateReranker instanceof LocalCrossEncoderEvidenceReranker) await candidateReranker.prepare();
        const warmupMs = candidateMode === "local_cross_encoder" ? Math.ceil(performance.now() - rankerStartedAt) : 0;
        const runtime = await system.admin.prepareRuntime();
        if (!runtime.ready) throw new Error("排序对比的 E5 检索运行时未就绪。");
        const systemStatus = await system.admin.status();
        if (systemStatus.evidenceSnapshotHash !== packet.sourceSnapshotHash) throw new Error("当前来源快照与冻结题包不一致；停止排序对比。");
        const sourceErrors = await validatePackSourceIntegrity({ packet, evidence: system });
        if (sourceErrors.length) throw new Error("排序对比题包来源完整性失败：" + sourceErrors.join(", ") + "；未查询题目或发送资料到网关。");
        const documents = await system.admin.listActiveDocuments();
        const sections = new Map(documents.flatMap((document) => document.sections.map((section) => [
          document.revisionId + "\n" + section.id,
          section.text,
        ] as const)));
        const sectionMetadata = new Map(documents.flatMap((document) => document.sections.map((section) => [
          document.revisionId + "\n" + section.id,
          { sourceId: document.sourceId, corpus: document.corpus, url: document.url, title: document.title, author: document.author },
        ] as const)));
        const run = await runRagV2Evaluation({
          packet,
          workflow: "retrieval",
          split,
          rankingMode: candidateMode,
          quick,
          ...(comparisonCallCap !== undefined ? { maximumGatewayCalls: comparisonCallCap } : {}),
          ...(pipelinePlan ? { questionIds: pipelinePlan.rankingComparisonQuestionIds, pipelinePreflightSha256: pipelinePlan.planSha256 } : {}),
          retrievalGatewayAttemptsPerQuestion: candidateMode === "gateway_reranked" ? 1 : 0,
          dependencies: {
            async retrieve(question, runId) {
              const started = performance.now();
              const result = await withModelGatewayAttemptBudget(1, () => system.reader.retrieve(evidenceRequest(question), {
                turnId: sha256("rag-v2-compare\n" + runId + "\n" + candidateMode + "\n" + question.id).slice(0, 40),
                purpose: "evaluation",
                modelDestination: "configured_chat_gateway",
                retrievalMode: candidateMode === "full_text" || candidateMode === "dense_vector" ? candidateMode : "hybrid",
              }));
              return {
                status: result.status,
                evidence: result.evidence.map((item) => ({
                  id: referenceId(item.ref),
                  ref: item.ref,
                  rank: item.rank,
                  text: item.text,
                  sourceId: item.source.sourceId,
                  source: {
                    sourceName: item.source.sourceName,
                    title: item.source.title,
                    articleId: articleIdentityFromUrl(item.source.url),
                    url: item.source.url,
                    author: item.source.author,
                    publisher: item.source.publisher,
                    publishedAt: item.source.publishedAt,
                    license: item.source.license,
                    attribution: item.source.attribution,
                    evidenceType: item.source.sourceType,
                    sectionPath: item.source.sectionPath,
                  },
                })),
                gatewayAttempts: result.rankingGatewayAttempts,
                durationMs: Math.ceil(performance.now() - started),
                rankingDurationMs: result.rankingDurationMs,
                rankingInputTokens: result.rankingInputTokens,
                rankingOutputTokens: result.rankingOutputTokens,
              };
            },
            async sourceTexts() { return sections; },
            async referenceEvidence(question) { return citationEvidence(question, sections, sectionMetadata); },
            async generateAnswer() { throw new Error("Retrieval comparison does not generate answers."); },
            async judge() { throw new Error("Retrieval comparison does not call semantic judges."); },
          },
        });
        const localConfig = candidateReranker instanceof LocalCrossEncoderEvidenceReranker
          ? { modelId: candidateReranker.modelId, revision: candidateReranker.revision, dtype: candidateReranker.dtype, maximumPairTokens: candidateReranker.maximumPairTokens }
          : candidateMode === "gateway_reranked"
            ? { modelId: process.env.OPENAI_MODEL ?? null }
            : null;
        runs.push({
          rankingMode: candidateMode,
          rankerConfig: localConfig,
          warmupMs,
          residentSetBytesBefore: rssBefore,
          residentSetBytesAfter: process.memoryUsage().rss,
          peakResidentSetPlatformUnits: process.resourceUsage().maxRSS,
          generationId: systemStatus.generationId,
          gatewayAttempts: run.actualGatewayAttempts,
          summary: retrievalSummary(run),
          questionResults: run.questions,
        });
      } finally {
        await system.close();
      }
    }
    const report = {
      schemaVersion: "rag-v2-ranking-comparison-v1",
      label: "retrieval_only_comparison",
      packetSha256: packValidation.packSha256,
      sourceSnapshotHash: packet.sourceSnapshotHash,
      pipelinePreflightSha256: pipelinePlan?.planSha256 ?? null,
      rankingModes: runs,
      interpretation: "Recall and coverage are measured against fixed source-span support paths. Model scores are rankings, not calibrated relevance probabilities. This comparison does not select a production default automatically.",
    };
    if (outputPath) {
      await writeJson(outputPath, report);
      console.log(JSON.stringify({ outputPath, packetSha256: report.packetSha256, modes: runs.map(({ rankingMode, summary }) => ({ rankingMode, summary })) }, null, 2));
    } else {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    }
    return 0;
  }

  const reranker = mode === "generate" || mode === "controls" ? null : createdReranker(rankingMode);
  const evidence = createKnowledgeEvidence({
    ...(reranker !== undefined ? { reranker } : {}),
    allowUnacceptedHybridEvaluation: true,
  });
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-rag-v2-"));
  let application: Awaited<ReturnType<typeof createApplicationRunner>> | undefined;
  try {
    if (mode === "generate") {
      const destination = outputPath ?? path.join(projectRoot, "data/knowledge/evaluation/rag-v2-question-pack.v5.json");
      const seedPath = option("--seed-packet");
      let seedPacket: { sourceSnapshotHash: string; questions: unknown[] } | undefined;
      if (seedPath) {
        const rawSeed = JSON.parse(await readFile(path.resolve(seedPath), "utf8")) as { sourceSnapshotHash?: unknown; questions?: unknown };
        if (typeof rawSeed.sourceSnapshotHash !== "string" || !Array.isArray(rawSeed.questions)) throw new Error("seed 题包缺少 sourceSnapshotHash 或 questions 数组。");
        seedPacket = { sourceSnapshotHash: rawSeed.sourceSnapshotHash, questions: rawSeed.questions };
      }
      if (has("--seed-all-packet") && !seedPacket) throw new Error("--seed-all-packet 需要 --seed-packet。" );
      const generated = await generateRagV2QuestionPack({
        evidence,
        outputPath: destination,
        maximumGatewayCalls,
        maximumPipelineGatewayCalls: maximumGatewayCalls ?? RAG_V2_TARGETS.maximumFullGatewayCalls,
        includeGatewayRankingComparison: !has("--no-gateway-ranking-comparison"),
        priorGatewayAttempts,
        ...(seedPacket ? { seedPacket } : {}),
        importAllSeedQuestions: has("--seed-all-packet"),
        onPreflight(preflight) {
          process.stderr.write("[rag-v2-preflight] " + JSON.stringify({
            selectedSectionCount: preflight.selectedSectionCount,
            estimatedGenerationAttempts: preflight.estimatedGenerationAttempts,
            seededQuestionCount: preflight.seededQuestionCount,
            projectedDevelopmentQuestionCount: preflight.projectedDevelopmentQuestionCount,
            projectedValidationQuestionCount: preflight.projectedValidationQuestionCount,
            projectedFullWorkflowGatewayAttempts: preflight.pipelineCallBudget.totalEstimatedGatewayAttempts,
            maximumGatewayAttempts: preflight.pipelineCallBudget.maximumGatewayAttempts,
            withinCap: preflight.pipelineCallBudget.withinCap,
          }) + "\n");
        },
        onProgress(progress) {
          process.stderr.write("[rag-v2-pack] " + progress.completedSections + "/" + progress.totalSections
            + " sections, " + progress.acceptedQuestions + " verified questions (answerable="
            + progress.answerableQuestions + ", partial=" + progress.partialQuestions
            + ", abstain=" + progress.abstainQuestions + ")\n");
        },
      });
      console.log(JSON.stringify({
        status: generated.status,
        questionPackPath: generated.status === "ready" ? destination : null,
        validation: generated.validation,
        candidateSectionCount: generated.candidateSectionCount,
        selectedSectionCount: generated.selectedSectionCount,
        candidateArticleCount: generated.candidateArticleCount,
        candidateArticleIds: generated.candidateArticleIds,
        coveredArticleIds: generated.coveredArticleIds,
        missingArticleIds: generated.missingArticleIds,
        verifiedQuestionCount: generated.verifiedQuestionCount,
        skippedSectionCount: generated.skippedSectionCount,
        gatewayCallEstimate: generated.gatewayCallEstimate,
        actualGatewayAttempts: generated.actualGatewayAttempts,
        pipelineCallBudget: generated.pipelineCallBudget,
        reason: generated.reason,
      }, null, 2));
      return generated.status === "ready" ? 0 : 1;
    }

    const packet = RagV2QuestionPackSchema.parse(JSON.parse(await readFile(path.resolve(packetPath!), "utf8")) as unknown);
    if (mode === "controls") {
      const sourceErrors = await validatePackSourceIntegrity({ packet, evidence });
      if (sourceErrors.length) throw new Error("控制题包来源完整性失败：" + sourceErrors.join(", ") + "；未生成控制题。");
      const sections = new Map((await evidence.admin.listActiveDocuments()).flatMap((document) => document.sections.map((section) => [
        document.revisionId + "\n" + section.id,
        section.text,
      ] as const)));
      const built = buildRagV2JudgeControls({ packet, sourceTexts: sections });
      const destination = outputPath ?? path.join(projectRoot, "data/knowledge/evaluation/rag-v2-judge-controls.v5.json");
      if (built.pack) await writeJson(destination, built.pack, true);
      console.log(JSON.stringify({
        ready: built.ready,
        controlsPath: built.pack ? destination : null,
        positiveCount: built.pack?.controls.filter(({ expected }) => expected === "positive").length ?? 0,
        negativeCount: built.pack?.controls.filter(({ expected }) => expected === "negative").length ?? 0,
        reason: built.reason,
      }, null, 2));
      return built.ready ? 0 : 1;
    }

    let controlPack: ReturnType<typeof RagV2JudgeControlsPackSchema.parse> | null = null;
    let controlPackSha256: string | null = null;
    let pipelinePlan: RagV2PipelinePreflight | null = null;
    let phaseQuestionIds: string[] | undefined;
    let phaseGatewayCallCap = maximumGatewayCalls;
    let precomputedJudgeControls: RagV2JudgeControlResult[] | null = null;
    let controlEvaluationSha256: string | null = null;
    let controlEvaluationSourceRunId: string | null = null;
    if (mode !== "retrieval") {
      const controlsPath = option("--controls");
      if (!controlsPath) throw new Error("语义工作流需要 --controls；先运行 controls 模式生成正/负控制题。");
      const rawControls = await readFile(path.resolve(controlsPath), "utf8");
      controlPack = RagV2JudgeControlsPackSchema.parse(JSON.parse(rawControls) as unknown);
      if (controlPack.packetSha256 !== validateRagV2QuestionPack(packet).packSha256 || controlPack.sourceSnapshotHash !== packet.sourceSnapshotHash) {
        throw new Error("评审控制包的题包或来源快照签名与目标题包不匹配。");
      }
      const sourceErrors = await validatePackSourceIntegrity({ packet, evidence });
      if (sourceErrors.length) throw new Error("控制题包来源完整性失败：" + sourceErrors.join(", ") + "；未生成评测运行。");
      const sourceTexts = new Map((await evidence.admin.listActiveDocuments()).flatMap((document) => document.sections.map((section) => [
        document.revisionId + "\n" + section.id,
        section.text,
      ] as const)));
      const rebuilt = buildRagV2JudgeControls({ packet, sourceTexts });
      if (!rebuilt.ready || !rebuilt.pack || JSON.stringify(rebuilt.pack) !== JSON.stringify(controlPack)) {
        throw new Error("评审控制包与冻结题包的真实来源区间不一致；拒绝使用修改过的控制证据。");
      }
      controlPackSha256 = sha256(rawControls);
      if (preflightPath) {
        pipelinePlan = await loadPipelinePreflight({ pathname: preflightPath, packet, controlPackSha256 });
        if (mode === "full") {
          if (split !== "validation") throw new Error("全流程 baseline/candidate 必须运行预检计划中的完整 validation split。");
          const phase = investigationStrategy === "fixed_single_pass" && rankingMode === "hybrid"
            ? "baseline"
            : investigationStrategy === "adaptive_agent" && rankingMode === "local_cross_encoder"
              ? "candidate"
              : null;
          if (!phase) throw new Error("冻结验收只允许 fixed_single_pass + hybrid 基线或 adaptive_agent + local_cross_encoder 候选。");
          phaseQuestionIds = pipelinePlan.validationQuestionIds;
          phaseGatewayCallCap = pipelinePlan.phaseGatewayAttemptCaps[phase];
        } else if (mode === "oracle") {
          if (split !== "development") throw new Error("Oracle 只能运行预检计划中的 development 诊断样本。");
          phaseQuestionIds = pipelinePlan.oracleQuestionIds;
          phaseGatewayCallCap = pipelinePlan.phaseGatewayAttemptCaps.oracle;
        } else {
          throw new Error("--preflight 只适用于 full、oracle 或 compare 模式。");
        }
        if (explicitQuestionIds && JSON.stringify(explicitQuestionIds) !== JSON.stringify(phaseQuestionIds)) {
          throw new Error("--question-ids 与全流程预检计划的题目列表不一致。");
        }
        phaseGatewayCallCap = maximumGatewayCalls === undefined
          ? phaseGatewayCallCap
          : Math.min(phaseGatewayCallCap, maximumGatewayCalls);
      } else if (mode === "full" && split === "validation") {
        throw new Error("完整 validation Agent 运行必须使用 --preflight 计划，避免绕过全流程网关预算。");
      }
      const reuseControlsPath = option("--reuse-controls-from");
      if (reuseControlsPath) {
        const sourceRun = JSON.parse(await readFile(path.resolve(reuseControlsPath), "utf8")) as RagV2EvaluationRun;
        if (!sourceRun.acceptancePins || !sourceRun.complete || sourceRun.workflow !== "full"
          || sourceRun.split !== "validation" || !sourceRun.completeValidationSet
          || sourceRun.packetSha256 !== validateRagV2QuestionPack(packet).packSha256
          || sourceRun.acceptancePins.controlPackSha256 !== controlPackSha256
          || pipelinePlan !== null && sourceRun.pipelinePreflightSha256 !== pipelinePlan.planSha256
          || !sourceRun.controlEvaluationSha256 || sourceRun.controlEvaluationGatewayAttempts === 0
          || sha256(JSON.stringify(sourceRun.judgeControls)) !== sourceRun.controlEvaluationSha256) {
          throw new Error("复用控制结果必须来自同一冻结题包、控制包和模型评审配置的完整运行；不可靠控制结果会被原样保留并继续阻止资格。");
        }
        precomputedJudgeControls = sourceRun.judgeControls;
        controlEvaluationSha256 = sourceRun.controlEvaluationSha256;
        controlEvaluationSourceRunId = sourceRun.runId;
      }
    }

    if (rankingMode === "local_cross_encoder" && reranker instanceof LocalCrossEncoderEvidenceReranker) await reranker.prepare();
    const runtime = await evidence.admin.prepareRuntime();
    if (!runtime.ready) throw new Error("RAG v2 检索运行时未就绪：" + (runtime.failureCode ?? "unknown") + "。");
    const acceptancePins = await createAcceptancePins({ packet, evidence, rankingMode, investigationStrategy, reranker, controlPackSha256, controlEvaluationSha256 });
    if (precomputedJudgeControls) {
      const sourceRun = JSON.parse(await readFile(path.resolve(option("--reuse-controls-from")!), "utf8")) as RagV2EvaluationRun;
      const environmentKeys = ["sourceRegistrySha256", "evidenceSnapshotSha256", "indexGenerationId", "embeddingModelId", "answerModelId", "controlPackSha256", "questionPromptSha256", "verifierPromptSha256", "answerPromptSha256", "judgePromptSha256", "appRevision"] as const;
      if (environmentKeys.some((key) => sourceRun.acceptancePins?.[key] !== acceptancePins[key])) {
        throw new Error("复用的控制评审运行与当前来源、索引、模型或提示配置不一致。");
      }
    }
    const documents = await evidence.admin.listActiveDocuments();
    const policyBySource = new Map<string, Awaited<ReturnType<typeof evidence.admin.sourceHistory>>[number]>();
    for (const sourceId of new Set(documents.map(({ sourceId }) => sourceId))) {
      const policy = (await evidence.admin.sourceHistory(sourceId)).at(-1);
      if (policy) policyBySource.set(sourceId, policy);
    }
    const gatewayCorpusText = documents.filter((document) => {
      const policy = policyBySource.get(document.sourceId);
      return Boolean(policy && policy.status === "active" && policy.source.rights.aiProcessing
        && policy.source.allowedModelDestinations.includes("configured_chat_gateway")
        && policy.source.allowedCorpora.includes(document.corpus) && sourceAllowsUrl(policy.source, document.url));
    }).flatMap(({ sections: documentSections }) => documentSections.map(({ text }) => text)).join("\n");
    const assertGatewayEvidenceAllowed = async (sourceIds: string[]) => {
      const currentSnapshot = await evidence.admin.status();
      if (currentSnapshot.evidenceSnapshotHash !== packet.sourceSnapshotHash) {
        throw new Error("评测期间来源或索引内容已变化；停止模型评审以保持冻结题包范围。");
      }
      for (const sourceId of sourceIds) {
        const policy = (await evidence.admin.sourceHistory(sourceId)).at(-1);
        if (!policy || policy.status !== "active" || !policy.source.rights.aiProcessing
          || !policy.source.allowedModelDestinations.includes("configured_chat_gateway")) {
          throw new Error("来源权限不允许将评测原文发送到已配置模型网关；拒绝派发。来源: " + sourceId);
        }
      }
    };
    const validateJudgeControl = async (control: RagV2JudgeControlCase) => {
      await assertGatewayEvidenceAllowed(control.citedEvidence.map(({ sourceId }) => sourceId));
      if (!control.citedEvidence.length) return;
      const refs = control.citedEvidence.map(({ ref }) => ref);
      const resolved = await evidence.reader.resolve(refs, {
        turnId: sha256("rag-v2-control-source-check\n" + control.controlId).slice(0, 40),
        purpose: "evaluation",
        modelDestination: "configured_chat_gateway",
      });
      if (resolved.status !== "found" || resolved.evidence.length !== control.citedEvidence.length) {
        throw new Error("控制题引用区间当前不可解析或无权发送到网关；未派发评审。控制题: " + control.controlId);
      }
      const resolvedByReference = new Map(resolved.evidence.map((item) => [JSON.stringify(item.ref), item]));
      for (const citation of control.citedEvidence) {
        const actual = resolvedByReference.get(JSON.stringify(citation.ref));
        if (!actual || citation.id !== referenceId(citation.ref) || citation.text !== actual.text
          || citation.sourceId !== actual.source.sourceId
          || citation.articleId !== articleIdentityFromUrl(actual.source.url)) {
          throw new Error("控制题证据文本、来源或文章归属与活动原文不一致；未派发评审。控制题: " + control.controlId);
        }
        const inQuestionScope = control.sourceArticleIds.includes(citation.articleId);
        if (control.controlType === "wrong_citation" ? inQuestionScope : !inQuestionScope) {
          throw new Error("控制题的引用文章与预期范围不一致；未派发评审。控制题: " + control.controlId);
        }
      }
    };
    const sections = new Map(documents.flatMap((document) => document.sections.map((section) => [
      document.revisionId + "\n" + section.id,
      section.text,
    ] as const)));
    const sectionMetadata = new Map(documents.flatMap((document) => document.sections.map((section) => [
      document.revisionId + "\n" + section.id,
      { sourceId: document.sourceId, corpus: document.corpus, url: document.url, title: document.title, author: document.author },
    ] as const)));
    const configuredModels = mode === "retrieval" ? null : createConfiguredRagV2Models();
    const dependencies: RagV2ExecutionDependencies = {
      async retrieve(question, runId) {
        const started = performance.now();
        const result = await withModelGatewayAttemptBudget(1, () => evidence.reader.retrieve(evidenceRequest(question), {
          turnId: sha256("rag-v2-retrieval\n" + runId + "\n" + question.id + "\n" + rankingMode).slice(0, 40),
          purpose: "evaluation",
          modelDestination: "configured_chat_gateway",
          retrievalMode: rankingMode === "full_text" || rankingMode === "dense_vector" ? rankingMode : "hybrid",
        }));
        return {
          status: result.status,
          failureCode: result.failureCode,
          rankingMode: result.rankingMode,
          rankingGatewayAttempts: result.rankingGatewayAttempts,
          rankingInputTokens: result.rankingInputTokens,
          rankingOutputTokens: result.rankingOutputTokens,
          candidateCount: result.candidateCount,
          evidence: result.evidence.map((item) => ({
            id: referenceId(item.ref),
            ref: item.ref,
            rank: item.rank,
            text: item.text,
            sourceId: item.source.sourceId,
            source: {
              sourceName: item.source.sourceName,
              title: item.source.title,
              articleId: articleIdentityFromUrl(item.source.url),
              url: item.source.url,
              author: item.source.author,
              publisher: item.source.publisher,
              publishedAt: item.source.publishedAt,
              license: item.source.license,
              attribution: item.source.attribution,
              evidenceType: item.source.sourceType,
              sectionPath: item.source.sectionPath,
            },
          })),
          gatewayAttempts: result.rankingGatewayAttempts,
          durationMs: Math.ceil(performance.now() - started),
          rankingDurationMs: result.rankingDurationMs,
        };
      },
      async sourceTexts() { return sections; },
      async validateQuestionSources(question) {
        const spans = [...question.facts.flatMap((fact) => fact.supportPaths.flat()), ...question.scopeEvidence];
        const unique = spans.filter((span, index, all) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(span)) === index);
        if (!unique.length) throw new Error("评测题没有绑定可核验的来源区间；未派发模型请求。");
        const refs = unique.map(({ sourceId: _sourceId, articleId: _articleId, ...ref }) => ref);
        const resolved = await evidence.reader.resolve(refs, {
          turnId: sha256("rag-v2-source-policy-check\n" + question.id).slice(0, 40),
          purpose: "evaluation",
          modelDestination: "configured_chat_gateway",
        });
        if (resolved.status !== "found" || resolved.evidence.length !== refs.length) {
          throw new Error("评测题来源区间当前不可解析或无权发送到配置网关；未派发模型请求。题目: " + question.id);
        }
        const resolvedByRef = new Map(resolved.evidence.map((item) => [JSON.stringify(item.ref), item]));
        for (const span of unique) {
          const { sourceId, articleId: _articleId, ...ref } = span;
          const metadata = sectionMetadata.get(textKey(ref));
          const item = resolvedByRef.get(JSON.stringify(ref));
          if (!metadata || !item || metadata.sourceId !== sourceId || item.source.sourceId !== sourceId
            || metadata.corpus !== question.corpus || articleIdentityFromUrl(metadata.url) !== span.articleId
            || !question.sourceArticleIds.includes(articleIdentityFromUrl(metadata.url))) {
            throw new Error("评测题来源 ID、语料或文章范围与不可变原文所有者不一致；未派发模型请求。题目: " + question.id);
          }
        }
        const actualArticleIds = new Set(unique.map((span) => articleIdentityFromUrl(sectionMetadata.get(textKey(span))!.url)));
        if (actualArticleIds.size !== question.sourceArticleIds.length
          || question.sourceArticleIds.some((articleId) => !actualArticleIds.has(articleId))) {
          throw new Error("sourceArticleIds 与题目原文区间的真实文章来源集合不一致；未派发模型请求。题目: " + question.id);
        }
        if (question.expectedDisposition === "partial" || question.expectedDisposition === "abstain") {
          if (!question.corpusWideAbsentDate || !question.query.includes(question.corpusWideAbsentDate)
            || gatewayCorpusText.includes(question.corpusWideAbsentDate)) {
            throw new Error("拒答题的精确日期不满足全语料缺失条件；未派发模型请求。题目: " + question.id);
          }
        }
      },
      async referenceEvidence(question) { return citationEvidence(question, sections, sectionMetadata); },
      assertGatewayEvidenceAllowed,
      validateJudgeControl,
      async generateAnswer(input) {
        if (!configuredModels) throw new Error("Oracle 生成模型未初始化。");
        return withModelGatewayAttemptBudget(1, () => configuredModels.generateAnswer(input));
      },
      async judge(input, role) {
        if (!configuredModels) throw new Error("语义评审模型未初始化。");
        return withModelGatewayAttemptBudget(1, () => configuredModels.judge(input, role));
      },
    };
    const workflow = mode as "retrieval" | "oracle" | "agent" | "full";
    let controls: RagV2JudgeControlCase[] = [];
    if (workflow !== "retrieval") {
      controls = judgeControlCasesFromPack(controlPack!);
    }
    if (workflow === "agent" || workflow === "full") {
      application = await createApplicationRunner({ knowledgeEvidence: evidence, tempRoot, investigationStrategy, expectedEvidenceSnapshotHash: packet.sourceSnapshotHash });
      dependencies.runApplication = async ({ runId, question, transport, maximumGatewayAttempts, fixedBaselineEvidence }) => application!.run(question, runId, transport, maximumGatewayAttempts, fixedBaselineEvidence);
    }
    const run = await runRagV2Evaluation({
      packet,
      workflow,
      split,
      rankingMode,
      investigationStrategy,
      dependencies,
      judgeControls: controls,
      ...(precomputedJudgeControls ? {
        precomputedJudgeControls,
        controlEvaluationSha256,
        controlEvaluationSourceRunId,
      } : {}),
      ...(phaseQuestionIds ? { questionIds: phaseQuestionIds } : explicitQuestionIds ? { questionIds: explicitQuestionIds } : {}),
      pipelinePreflightSha256: pipelinePlan?.planSha256 ?? null,
      applicationAttemptsPerQuestion: investigationStrategy === "fixed_single_pass"
        ? RAG_V2_TARGETS.baselineApplicationAttemptsPerQuestion
        : pipelinePlan?.candidateApplicationAttemptsPerQuestion
          ?? (option("--candidate-application-attempts") ? Number(option("--candidate-application-attempts")) : RAG_V2_TARGETS.candidateApplicationAttemptsPerQuestion),
      sseParityCount: pipelinePlan?.candidateSseParityCount
        ?? (option("--candidate-sse-parity-count") ? Number(option("--candidate-sse-parity-count")) : 1),
      retrievalGatewayAttemptsPerQuestion: rankingMode === "gateway_reranked" ? 1 : 0,
      ...(phaseGatewayCallCap !== undefined ? { maximumGatewayCalls: phaseGatewayCallCap } : {}),
      quick: has("--quick"),
      acceptancePins,
    });
    if (run.acceptancePins && run.controlEvaluationSha256) {
      run.acceptancePins = { ...run.acceptancePins, controlEvaluationSha256: run.controlEvaluationSha256 };
    }
    if (outputPath) {
      await writeJson(outputPath, run);
      console.log(JSON.stringify({ outputPath, runId: run.runId, questionCount: run.questions.length, actualGatewayAttempts: run.actualGatewayAttempts, completeValidationSet: run.completeValidationSet }, null, 2));
    } else {
      process.stdout.write(JSON.stringify(run, null, 2) + "\n");
    }
    return 0;
  } finally {
    if (application) await application.close();
    else await evidence.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "RAG v2 evaluation failed.");
  console.error(usage);
  process.exitCode = 1;
}
