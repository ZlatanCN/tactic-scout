import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  configuredRecruitmentConversation,
  type RecruitmentAskUserMode,
  type RecruitmentPlanner,
  type RecruitmentPlannerResponseDiagnostics,
  type RecruitmentReviewerMode,
  type RecruitmentTraceEvent,
} from "../agent/conversation.js";
import { createRecruitmentEvidenceEvaluator } from "../agent/recruitment-evidence-evaluator.js";
import { createRecruitmentPlanner } from "../agent/recruitment-planner.js";
import { createRepository, getConfiguredDataMode, type PlayerRepository } from "../data/provider.js";
import { preflightConfiguredHistoricalArchive } from "../data/historical-archive-enrichment.js";
import { PositionSchema, type RecruitmentProgressEventStatus, type RecruitmentProgressStage } from "../domain/schemas.js";
import { createLocalKnowledgeBase, type KnowledgeRepository } from "../knowledge/index.js";
import {
  questionMatchesClarificationIntent,
  evaluateLocalAgentScenario,
  evaluateWithheldAnswerArm,
  localAgentEvaluationScenarios,
  privacySafeTraceEvent,
  summarizeEvaluationRuns,
  type EvaluationProgressEvent,
  type EvaluationOperationLatencySample,
  type EvaluationScenario,
  type ClarificationIntent,
  understatLocalAgentEvaluationScenario,
} from "./harness-evaluation.js";
import { createSinglePassInvestigationPlanner } from "./fixed-investigation-planner.js";
import { createWithheldRecruitmentEvidenceEvaluator } from "./withheld-recruitment-evidence-evaluator.js";
import {
  assertIdentityFreeSummaryPathAvailable,
  createIdentityFreeHarnessSummary,
  writeIdentityFreeHarnessSummary,
} from "./harness-summary-export.js";

const configuredDataMode = getConfiguredDataMode();
const configuredScenarios = configuredDataMode === "understat"
  ? [understatLocalAgentEvaluationScenario]
  : configuredDataMode === "mosaic"
    ? [localAgentEvaluationScenarios.find(({ id }) => id === "bayern-kane-replacement")!]
    : [...localAgentEvaluationScenarios];
const defaultScenario = configuredScenarios[0]!;
let repositoryInstance: PlayerRepository | undefined;

function getDataRepository(): PlayerRepository {
  repositoryInstance ??= createRepository();
  return repositoryInstance;
}
const usage = [
  "用法：",
  "  pnpm eval:local-agent",
  "  pnpm eval:local-agent -- --scenario bayern-kane-replacement",
  "  TACTISCOUT_DATA_MODE=understat pnpm eval:local-agent -- --scenario understat-five-league-xg-creation",
  "  pnpm eval:local-agent -- --scenario barcelona-attacking-one-on-one-forward",
  "  pnpm eval:local-agent -- --scenario all --runs 3",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario bayern-kane-replacement --compare-reviewer --runs 3",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario bayern-kane-replacement --compare-interaction --runs 3",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario bayern-kane-replacement --compare-ask-policy --runs 3",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario bayern-kane-replacement --compare-methodology-rag --runs 3",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario bayern-kane-replacement --compare-investigation-planning --runs 3",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario all --compare-evidence-evaluator --runs 3",
  "  TACTISCOUT_DATA_MODE=understat pnpm eval:local-agent -- --scenario understat-five-league-xg-creation --compare-historical-archive --runs 3",
  "  pnpm eval:local-agent -- --message \"自定义球探需求\" [--answer \"补充回答\"] [--expected-position ST]",
  "",
  "选项：",
  "  --scenario <id|all> 运行当前数据源已登记场景；不传时使用该模式的默认场景",
  "  --runs <1-10>        每个场景独立运行次数，默认 1",
  "  --message <text>     自定义单个场景需求",
  "  --answer <text>      自定义补答；可重复",
  "  --expected-position <position> 检查自定义场景的搜索及推荐位置",
  "  --summary-output <path> 写入不含候选身份、正文、trace 或进度载荷的本地聚合摘要；只支持普通运行",
  "  --compare-reviewer    在单一登记场景上配对运行完整证据复核与旁路消融（仅 curated 数据）",
  "  --compare-interaction 在单一澄清场景上配对运行完整补答与首次追问后不补答控制（仅 curated 数据）",
  "  --compare-ask-policy 在单一登记场景上配对运行正常追问与禁用追问控制（仅 curated 数据）",
  "  --compare-methodology-rag 在同一整链场景配对比较方法语料开启与屏蔽（仅 curated 数据）",
  "  --compare-investigation-planning 在同一整图配对比较动态调查与单页固定调查（仅 curated 数据）",
  "  --compare-evidence-evaluator 在完整 LangGraph 中配对比较正常能力评估与明确屏蔽评估器（仅 curated 数据；至少 3 对）",
  "  --compare-historical-archive 在 Understat 或 mosaic 场景配对开关历史 Wyscout 报告旁注；须预先启用展示与本地保留",
  "  --help               显示本帮助",
].join("\n");

function option(name: string): string | undefined {
  let index = -1;
  for (let candidateIndex = 0; candidateIndex < process.argv.length; candidateIndex += 1) {
    if (process.argv[candidateIndex] !== name) continue;
    if (index >= 0) throw new Error(`${name} 只能指定一次。`);
    index = candidateIndex;
  }
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值。`);
  return value;
}

function options(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值。`);
    values.push(value);
    index += 1;
  }
  return values;
}

function parseRunCount(value: string | undefined): number {
  if (value === undefined) return 1;
  if (!/^\d+$/.test(value)) throw new Error("--runs 必须是 1 到 10 之间的整数。");
  const count = Number(value);
  if (count < 1 || count > 10) throw new Error("--runs 必须是 1 到 10 之间的整数。");
  return count;
}

function selectScenarios(): { scenarios: EvaluationScenario[]; runsPerScenario: number } {
  const scenarioId = option("--scenario");
  const message = option("--message");
  const answers = options("--answer");
  const expectedPositionInput = option("--expected-position");
  const expectedPositionResult = expectedPositionInput ? PositionSchema.safeParse(expectedPositionInput) : undefined;
  if (expectedPositionInput && !expectedPositionResult?.success) {
    throw new Error(`--expected-position 必须是以下值之一：${PositionSchema.options.join(", ")}。`);
  }
  const expectedPosition = expectedPositionResult?.success ? expectedPositionResult.data : undefined;
  const runsPerScenario = parseRunCount(option("--runs"));

  if (scenarioId) {
    if (message || expectedPosition) throw new Error("--scenario 不能与 --message 或 --expected-position 一起使用。");
    if (scenarioId === "all") {
      if (answers.length) throw new Error("--scenario all 使用数据集内登记的补答，不接受 --answer。");
      return { scenarios: configuredScenarios, runsPerScenario };
    }
    const selected = configuredScenarios.find((scenario) => scenario.id === scenarioId);
    if (!selected) throw new Error(`未知场景：${scenarioId}。当前数据源可选：${configuredScenarios.map(({ id }) => id).join(", ")}、all。`);
    return {
      scenarios: [{ ...selected, answers: answers.length ? answers : selected.answers }],
      runsPerScenario,
    };
  }

  if (!message && !answers.length && !expectedPosition) {
    return { scenarios: [defaultScenario], runsPerScenario };
  }
  return {
    scenarios: [{
      id: "custom",
      message: message ?? defaultScenario.message,
      answers,
      kind: "custom",
      requireClarificationResume: answers.length > 0,
      ...(expectedPosition ? {
        expectedPosition,
        requireRecommendationsWhenEvidenceObserved: true,
      } : {}),
    }],
    runsPerScenario,
  };
}

function safeEndpoint(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return "invalid URL";
  }
}

async function curatedDatasetSha256(): Promise<string | null> {
  const dataRepository = getDataRepository();
  if (dataRepository.mode !== "curated") return null;
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const snapshotPath = process.env.TACTISCOUT_DATASET_FILE?.trim()
    ? path.resolve(process.env.TACTISCOUT_DATASET_FILE)
    : path.join(projectRoot, ".data", "tactiscout-datasets", "latest.json");
  const bytes = await readFile(snapshotPath);
  return createHash("sha256").update(bytes).digest("hex");
}

function operationLatencySamplesFromTrace(
  trace: readonly Record<string, unknown>[],
): EvaluationOperationLatencySample[] {
  const samples: EvaluationOperationLatencySample[] = [];
  for (const event of trace) {
    if (typeof event.elapsedMs !== "number" || !Number.isFinite(event.elapsedMs) || event.elapsedMs < 0) continue;
    if (event.phase === "tool" && typeof event.toolName === "string") {
      samples.push({ kind: "tool", operation: event.toolName, elapsedMs: event.elapsedMs });
      continue;
    }
    if (event.phase !== "decision") continue;

    const attemptedPlanner = event.decisionSource === "planner"
      || event.proposedAction !== undefined
      || event.plannerFallback !== undefined;
    if (!attemptedPlanner) continue;

    const operation = event.plannerFallback !== undefined
      ? "unresolved"
      : typeof event.proposedAction === "string"
        ? event.proposedAction
        : event.proposedAction === null
          ? "unresolved"
          : typeof event.action === "string"
            ? event.action
            : "unresolved";
    samples.push({ kind: "planner_action", operation, elapsedMs: event.elapsedMs });
  }
  return samples;
}

type HarnessErrorSummary = {
  name: string;
  category: "network_permission" | "endpoint_unreachable" | "timeout" | "http_error" | "schema_validation" | "tool_call_protocol" | "response_parse" | "structured_output" | "other";
  code?: string;
  status?: number;
  plannerResponseDiagnostics?: RecruitmentPlannerResponseDiagnostics;
};

type LocalAgentRunOptions = {
  reviewerMode?: RecruitmentReviewerMode;
  answerMode?: "scripted" | "withheld";
  askUserMode?: RecruitmentAskUserMode;
  investigationPlanningMode?: "adaptive" | "single_pass";
  historicalArchiveMode?: "enabled" | "disabled";
  evidenceEvaluatorMode?: "enabled" | "withheld";
  suppressTraceOutput?: boolean;
  suppressProgressOutput?: boolean;
};

function suppressMethodologyCorpus(knowledgeBase: KnowledgeRepository): KnowledgeRepository {
  return {
    search(request) {
      if (request.corpus === "methodology") return Promise.resolve([]);
      return knowledgeBase.search(request);
    },
  };
}

type DecisionTrace = Extract<RecruitmentTraceEvent, { phase: "decision" }>;

function isDecisionTrace(event: RecruitmentTraceEvent): event is DecisionTrace {
  return event.phase === "decision";
}

function summarizeError(error: unknown): HarnessErrorSummary[] {
  const summaries: HarnessErrorSummary[] = [];
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const record = typeof current === "object"
      ? current as { name?: unknown; code?: unknown; status?: unknown; response?: { status?: unknown }; message?: unknown; cause?: unknown; diagnostics?: unknown }
      : {};
    const code = typeof record.code === "string" && /^[A-Z0-9_-]{1,40}$/i.test(record.code) ? record.code : undefined;
    const status = typeof record.status === "number" ? record.status
      : typeof record.response?.status === "number" ? record.response.status : undefined;
    const errorText = `${code ?? ""} ${typeof record.message === "string" ? record.message : ""} ${typeof record.name === "string" ? record.name : ""}`.toLowerCase();
    const category: HarnessErrorSummary["category"] = code === "EPERM" || errorText.includes("eperm")
      ? "network_permission"
      : code === "ECONNREFUSED" || code === "ECONNRESET" || /econnrefused|econnreset|ehostunreach|enotfound/.test(errorText)
        ? "endpoint_unreachable"
        : /timeout|timed out|deadline exceeded|aborted/.test(errorText)
          ? "timeout"
          : status !== undefined
            ? "http_error"
            : /zod|validation|invalid schema/.test(errorText)
              ? "schema_validation"
              : /tool[_ ]?calls?|function[_ ]?calls?|arguments/.test(errorText)
                ? "tool_call_protocol"
                : /json|parse|syntax/.test(errorText)
                  ? "response_parse"
                  : /structured/.test(errorText)
                    ? "structured_output"
                    : "other";
    summaries.push({
      name: typeof record.name === "string" ? record.name : "Error",
      category,
      ...(code ? { code } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(depth === 0 && record.diagnostics && typeof record.diagnostics === "object"
        ? { plannerResponseDiagnostics: record.diagnostics as RecruitmentPlannerResponseDiagnostics }
        : {}),
    });
    current = record.cause;
  }
  return summaries;
}

function summarizeReport(response: Awaited<ReturnType<ReturnType<typeof configuredRecruitmentConversation>["turn"]>>) {
  if (!response.report) return null;
  const historicalSamples = [
    ...response.report.recommendations.flatMap((candidate) => candidate.historicalArchiveSamples),
    ...response.report.historicalArchiveCandidates.flatMap((candidate) => candidate.samples),
  ];
  return {
    targetTeam: response.report.targetTeam,
    dataSource: response.report.dataSource,
    datasetMode: response.report.datasetMode,
    datasetScope: response.report.datasetScope ?? null,
    evaluatedCandidateCount: response.report.evidenceCoverage.evaluatedCandidateCount,
    evidenceCoverage: response.report.evidenceCoverage,
    historicalArchiveCoverage: response.report.historicalArchiveCoverage,
    recommendationsWithHistoricalSamples: response.report.recommendations.filter((candidate) => candidate.historicalArchiveSamples.length > 0).length,
    historicalArchiveSampleCount: response.report.recommendations.reduce((count, candidate) => count + candidate.historicalArchiveSamples.length, 0),
    historicalArchiveCandidateCount: response.report.historicalArchiveCandidates.length,
    historicalArchiveCandidateSampleCount: response.report.historicalArchiveCandidates.reduce((count, candidate) => count + candidate.samples.length, 0),
    historicalArchiveReleaseStamps: [...new Set(historicalSamples.map((sample) => sample.identityLink.reepReleaseStamp))],
    historicalArchiveSeasons: [...new Set(historicalSamples.map((sample) => sample.season))].sort(),
    historicalArchiveCandidateExamples: response.report.historicalArchiveCandidates.slice(0, 3).map(({ player, samples }) => ({
      playerId: player.playerId,
      sourceIdentity: player.sourceIdentity,
      sampleCount: samples.length,
      firstSample: samples[0] ? {
        provider: samples[0].provider,
        providerPlayerId: samples[0].providerPlayerId,
        competition: samples[0].competition,
        season: samples[0].season,
        identityLink: samples[0].identityLink,
      } : null,
    })),
    requestedCapabilityCoverage: response.report.requestedCapabilityCoverage,
    methodologyChunksRetrieved: response.report.knowledgeCoverage.methodologyChunksRetrieved,
    methodologySources: response.report.knowledgeCoverage.methodologySources,
    playerReportChunksRetrieved: response.report.knowledgeCoverage.playerReportChunksRetrieved,
    recommendations: response.report.recommendations.map((candidate) => ({
      playerId: candidate.player.playerId,
      position: candidate.player.position,
      evidenceKeys: candidate.focusEvidenceKeys,
    })),
    limitations: response.report.limitations,
  };
}

type ModelUsageMetricName = "inputTokens" | "outputTokens" | "totalTokens";
type ModelUsageMetricSummary = {
  status: "complete" | "partial" | "unavailable";
  total: number | null;
  requestsWithUsage: number;
  requestCount: number;
};
type ModelUsageSummary = {
  requestCount: number;
  responseCount: number;
  failedRequestCount: number;
  inputTokens: ModelUsageMetricSummary;
  outputTokens: ModelUsageMetricSummary;
  totalTokens: ModelUsageMetricSummary;
};

function summarizeModelUsage(events: readonly RecruitmentTraceEvent[]): ModelUsageSummary {
  const requests = events.filter((event): event is Extract<RecruitmentTraceEvent, { phase: "model_usage" }> => (
    event.phase === "model_usage"
  ));
  const metric = (name: ModelUsageMetricName): ModelUsageMetricSummary => {
    const values = requests.flatMap((event) => typeof event[name] === "number" ? [event[name]!] : []);
    const status = requests.length === 0 || values.length === 0
      ? "unavailable"
      : values.length === requests.length ? "complete" : "partial";
    return {
      status,
      total: status === "complete" ? values.reduce((sum, value) => sum + value, 0) : null,
      requestsWithUsage: values.length,
      requestCount: requests.length,
    };
  };

  return {
    requestCount: requests.length,
    responseCount: requests.filter((event) => event.outcome === "response").length,
    failedRequestCount: requests.filter((event) => event.outcome === "failed").length,
    inputTokens: metric("inputTokens"),
    outputTokens: metric("outputTokens"),
    totalTokens: metric("totalTokens"),
  };
}

function summarizeModelUsageAcrossRuns(summaries: readonly ModelUsageSummary[]): ModelUsageSummary {
  const requestCount = summaries.reduce((sum, summary) => sum + summary.requestCount, 0);
  const metric = (name: ModelUsageMetricName): ModelUsageMetricSummary => {
    const requestsWithUsage = summaries.reduce((sum, summary) => sum + summary[name].requestsWithUsage, 0);
    const status = requestCount === 0 || requestsWithUsage === 0
      ? "unavailable"
      : requestsWithUsage === requestCount ? "complete" : "partial";
    const total = status === "complete"
      ? summaries.reduce((sum, summary) => sum + (summary[name].total ?? 0), 0)
      : null;
    return { status, total, requestsWithUsage, requestCount };
  };

  return {
    requestCount,
    responseCount: summaries.reduce((sum, summary) => sum + summary.responseCount, 0),
    failedRequestCount: summaries.reduce((sum, summary) => sum + summary.failedRequestCount, 0),
    inputTokens: metric("inputTokens"),
    outputTokens: metric("outputTokens"),
    totalTokens: metric("totalTokens"),
  };
}

async function runScenarioOnce(
  scenario: EvaluationScenario,
  runNumber: number,
  knowledgeBase: KnowledgeRepository,
  options: LocalAgentRunOptions = {},
) {
  const dataRepository = getDataRepository();
  const reviewerMode = options.reviewerMode ?? "enabled";
  const answerMode = options.answerMode ?? "scripted";
  const askUserMode = options.askUserMode ?? "enabled";
  const investigationPlanningMode = options.investigationPlanningMode ?? "adaptive";
  let plannerRequestAttempts = 0;
  const events: RecruitmentTraceEvent[] = [];
  const progressEvents: EvaluationProgressEvent[] = [];
  const methodologySearchReturnedSourceUrls = new Set<string>();
  const observingKnowledgeBase: KnowledgeRepository = {
    async search(request) {
      const results = await knowledgeBase.search(request);
      if (request.corpus === "methodology") {
        for (const result of results) {
          if (!result.displayAllowed) continue;
          const url = new URL(result.url);
          url.hash = "";
          url.searchParams.sort();
          methodologySearchReturnedSourceUrls.add(url.toString());
        }
      }
      return results;
    },
  };
  const threadId = `local-eval-${scenario.id}-${randomUUID()}`;
  const startedAt = performance.now();
  const previousArchiveDisplayPermission = process.env.TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED;
  if (options.historicalArchiveMode === "disabled") {
    process.env.TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED = "false";
  }
  let conversation: ReturnType<typeof configuredRecruitmentConversation>;
  try {
    conversation = configuredRecruitmentConversation({
      repository: dataRepository,
      knowledgeBase: observingKnowledgeBase,
      observer: (event) => {
        events.push(event);
        if (!options.suppressTraceOutput) {
          process.stderr.write(`[trace][${scenario.id}][${runNumber}] ${JSON.stringify(privacySafeTraceEvent(event))}\n`);
        }
      },
      experimentalReviewerMode: reviewerMode,
      experimentalAskUserMode: askUserMode,
      plannerFactory: () => {
        const modelPlanner = createRecruitmentPlanner();
        const observedModelPlanner: RecruitmentPlanner = {
          async decide(input) {
            plannerRequestAttempts += 1;
            return modelPlanner.decide(input);
          },
        };
        return investigationPlanningMode === "single_pass"
          ? createSinglePassInvestigationPlanner(observedModelPlanner)
          : observedModelPlanner;
      },
      ...(options.evidenceEvaluatorMode === "withheld"
        ? { evidenceEvaluator: createWithheldRecruitmentEvidenceEvaluator(createRecruitmentEvidenceEvaluator(dataRepository)) }
        : {}),
    });
  } finally {
    if (previousArchiveDisplayPermission === undefined) delete process.env.TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED;
    else process.env.TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED = previousArchiveDisplayPermission;
  }
  let currentTurn = 0;
  const captureProgress = (update: Omit<EvaluationProgressEvent, "sequence" | "turn">) => {
    const event = { sequence: progressEvents.length + 1, turn: currentTurn, ...update };
    progressEvents.push(event);
    if (!options.suppressProgressOutput) {
      process.stderr.write(`[progress][${scenario.id}][${runNumber}] ${JSON.stringify(event)}\n`);
    }
  };
  const decisionMetrics = () => {
    const decisions = events.filter((event): event is Extract<RecruitmentTraceEvent, { phase: "decision" }> => event.phase === "decision");
    return {
      decisionCount: decisions.length,
      plannerDecisionCount: decisions.filter((event) => event.decisionSource === "planner" && event.ok).length,
      policyDecisionCount: decisions.filter((event) => event.decisionSource === "policy").length,
      plannerFallbackCount: decisions.filter((event) => event.plannerFallback !== undefined).length,
      policyOverrideCount: decisions.filter((event) => event.proposedAction !== undefined
        && event.proposedAction !== event.action).length,
    };
  };
  const progressMetrics = () => ({
    progressEventCount: progressEvents.length,
    progressLifecycleCounts: Object.fromEntries(
      [...new Set(progressEvents.map(({ status }) => status))]
        .map((status) => [status, progressEvents.filter((event) => event.status === status).length]),
    ),
    progressStages: [...new Set(progressEvents.map(({ stage }) => stage))],
  });

  try {
    currentTurn = 1;
    const firstTurnResponse = await conversation.turn({ threadId, message: scenario.message, onProgress: captureProgress });
    let response = firstTurnResponse;
    const firstTurnStatus = firstTurnResponse.status;
    const firstTurnEvents = [...events];
    const firstTurnEventCount = events.length;
    let answersUsed = 0;
    const answeredClarificationIntents: ClarificationIntent[] = [];
    const answers = askUserMode === "disabled" ? [] : answerMode === "scripted" ? scenario.answers : [];
    for (const answer of answers) {
      if (response.status !== "needs_input") break;
      if (scenario.kind === "clarification-resume") {
        const intent = scenario.answerIntents[answersUsed];
        if (!intent || !questionMatchesClarificationIntent(intent, response)) break;
        answeredClarificationIntents.push(intent);
      }
      currentTurn += 1;
      response = await conversation.turn({ threadId, message: answer, expectsExistingState: true, onProgress: captureProgress });
      answersUsed += 1;
    }
    const elapsedMs = Math.round(performance.now() - startedAt);
    const continuedEvents = events.slice(firstTurnEventCount);
    const evaluationInput = {
      scenario,
      events,
      firstTurnResponse,
      response,
      firstTurnEvents,
      continuedEvents,
      progressEvents,
      answersUsed,
      threadId,
    };
    const decisionEvents = events.filter(isDecisionTrace);
    const suppressedAskEvents = decisionEvents.filter((event) => event.askPolicyOutcome === "suppressed");
    const askPolicyDisabledChecks = askUserMode === "disabled" && scenario.kind === "clarification-resume"
      ? {
        safelyPausedWithUnresolvedNeed: firstTurnResponse.status === "needs_input"
          && response.status === "needs_input"
          && response.report === null
          && /关键需求仍未解决/.test(firstTurnResponse.message),
        observedWorkBeforePause: firstTurnEvents.some((event) => event.phase === "tool" && event.ok)
          && firstTurnEvents.findIndex((event) => isDecisionTrace(event) && event.askPolicyOutcome === "suppressed")
            > firstTurnEvents.findIndex((event) => event.phase === "tool" && event.ok),
        askActionsSuppressedAtGraphBoundary: suppressedAskEvents.length === 1
          && firstTurnEvents.filter(isDecisionTrace).filter((event) => event.action === "ask_user")
            .every((event) => event.askPolicyOutcome === "suppressed" || event.policyBlocked === true),
        noHiddenAnswerInjected: answersUsed === 0,
        noPostPauseActions: continuedEvents.length === 0,
        noReportGenerated: response.report === null,
      }
      : null;
    const evaluation = askPolicyDisabledChecks
      ? { checks: askPolicyDisabledChecks, allPassed: Object.values(askPolicyDisabledChecks).every(Boolean) }
      : answerMode === "withheld" && scenario.kind === "clarification-resume"
        ? evaluateWithheldAnswerArm(evaluationInput)
        : evaluateLocalAgentScenario(evaluationInput);
    const reportMethodologySources = response.report?.knowledgeCoverage.methodologySources ?? [];
    const methodologyCitationsOnlyUseReturnedSources = reportMethodologySources.every((source) => {
      const url = new URL(source.url);
      url.hash = "";
      url.searchParams.sort();
      return methodologySearchReturnedSourceUrls.has(url.toString());
    });
    const askUserDecisionCount = decisionEvents.filter((event) => (
      event.action === "ask_user" && event.policyBlocked !== true && event.askPolicyOutcome !== "suppressed"
    )).length;
    const interactionChecks: Record<string, boolean> = scenario.kind === "shortlist"
      ? {
        didNotAskForClearRequest: firstTurnResponse.status === "completed"
          && response.status === "completed"
          && askUserDecisionCount === 0
          && answersUsed === 0,
      }
      : {};
    const checks: Record<string, boolean> = {
      ...evaluation.checks,
      ...interactionChecks,
      methodologyCitationsOnlyUseReturnedSources,
    };
    return {
      run: runNumber,
      reviewerMode,
      threadId,
      firstTurnStatus,
      finalStatus: response.status,
      clarificationAnswersUsed: answersUsed,
      answeredClarificationIntents,
      answerMode,
      askUserMode,
      investigationPlanningMode,
      evidenceEvaluatorMode: options.evidenceEvaluatorMode ?? "enabled",
      plannerRequestAttempts,
      modelUsage: summarizeModelUsage(events),
      askUserDecisionCount,
      askUserSuppressedDecisionCount: suppressedAskEvents.length,
      elapsedMs,
      ...decisionMetrics(),
      ...progressMetrics(),
      toolCallCount: events.filter((event) => event.phase === "tool").length,
      checks,
      allPassed: Object.values(checks).every(Boolean),
      methodologySearchReturnedSourceUrls: [...methodologySearchReturnedSourceUrls],
      report: summarizeReport(response),
      trace: events.map(privacySafeTraceEvent),
      progress: progressEvents,
    };
  } catch (error) {
    return {
      run: runNumber,
      reviewerMode,
      threadId,
      firstTurnStatus: null,
      finalStatus: null,
      clarificationAnswersUsed: 0,
      answeredClarificationIntents: [],
      answerMode,
      askUserMode,
      investigationPlanningMode,
      evidenceEvaluatorMode: options.evidenceEvaluatorMode ?? "enabled",
      plannerRequestAttempts,
      modelUsage: summarizeModelUsage(events),
      askUserDecisionCount: events.filter(isDecisionTrace).filter((event) => (
        event.action === "ask_user" && event.policyBlocked !== true && event.askPolicyOutcome !== "suppressed"
      )).length,
      askUserSuppressedDecisionCount: events.filter(isDecisionTrace)
        .filter((event) => event.askPolicyOutcome === "suppressed").length,
      elapsedMs: Math.round(performance.now() - startedAt),
      ...decisionMetrics(),
      ...progressMetrics(),
      toolCallCount: events.filter((event) => event.phase === "tool").length,
      checks: { conversationCompleted: false },
      allPassed: false,
      report: null,
      methodologySearchReturnedSourceUrls: [...methodologySearchReturnedSourceUrls],
      errors: summarizeError(error),
      trace: events.map(privacySafeTraceEvent),
      progress: progressEvents,
    };
  }
}

type LocalAgentRun = Awaited<ReturnType<typeof runScenarioOnce>>;

function historicalArchiveTrace(run: LocalAgentRun): Array<Record<string, unknown>> {
  const safeFilterKeys = [
    "position", "maxAge", "minimumMinutes", "competition", "season", "requestedOffset", "offset", "limit",
    "nextOffset", "playerNameFilterUsed", "requestedPlayerCount", "searchedPlayerCount", "evaluatedMetricKeys",
  ];
  return run.trace.flatMap<Record<string, unknown>>((event) => {
    if (event.phase === "decision") return [{
      phase: "decision",
      action: event.action ?? null,
      decisionSource: event.decisionSource ?? null,
      proposedAction: event.proposedAction ?? null,
      policyBlocked: event.policyBlocked ?? false,
      policyReasonCodes: event.policyReasonCodes ?? [],
      plannerFallback: event.plannerFallback ?? null,
    }];
    if (event.phase === "review") return [{
      phase: "review",
      outcome: event.outcome,
      problemCount: event.problemCount ?? 0,
      repairedEvidenceReferenceCount: event.repairedEvidenceReferenceCount ?? 0,
    }];
    if (event.phase !== "tool") return [];
    const filters = typeof event.filters === "object" && event.filters !== null
      ? event.filters as Record<string, unknown>
      : {};
    return [{
      phase: "tool",
      toolName: event.toolName,
      ok: event.ok,
      resultCount: event.resultCount,
      matchingRecordCount: event.matchingRecordCount ?? null,
      filters: Object.fromEntries(safeFilterKeys.flatMap((key) => Object.hasOwn(filters, key) ? [[key, filters[key]]] : [])),
    }];
  });
}

function historicalArchivePair(enabled: LocalAgentRun, disabled: LocalAgentRun) {
  const enabledReport = enabled.report;
  const disabledReport = disabled.report;
  const enabledTrace = historicalArchiveTrace(enabled);
  const disabledTrace = historicalArchiveTrace(disabled);
  const enabledRecommendations = enabledReport?.recommendations ?? [];
  const disabledRecommendations = disabledReport?.recommendations ?? [];
  const recommendationIdentityOrderSame = JSON.stringify(enabledRecommendations.map(({ playerId }) => playerId))
    === JSON.stringify(disabledRecommendations.map(({ playerId }) => playerId));
  const recommendationEvidenceSame = JSON.stringify(enabledRecommendations.map(({ position, evidenceKeys }) => ({ position, evidenceKeys })))
    === JSON.stringify(disabledRecommendations.map(({ position, evidenceKeys }) => ({ position, evidenceKeys })));
  const evaluatedCandidateCountSame = enabledReport?.evaluatedCandidateCount === disabledReport?.evaluatedCandidateCount;
  const evidenceCoverageSame = JSON.stringify(enabledReport?.evidenceCoverage) === JSON.stringify(disabledReport?.evidenceCoverage);
  const requestedCapabilityCoverageSame = JSON.stringify(enabledReport?.requestedCapabilityCoverage)
    === JSON.stringify(disabledReport?.requestedCapabilityCoverage);
  const withoutArchiveFields = (report: NonNullable<LocalAgentRun["report"]>) => {
    const comparable: Record<string, unknown> = { ...report };
    for (const key of [
      "historicalArchiveCoverage", "recommendationsWithHistoricalSamples", "historicalArchiveSampleCount",
      "historicalArchiveCandidateCount", "historicalArchiveCandidateSampleCount", "historicalArchiveCandidateExamples",
      "historicalArchiveReleaseStamps", "historicalArchiveSeasons",
    ]) delete comparable[key];
    return comparable;
  };
  const nonArchiveReportSame = enabledReport === null || disabledReport === null
    ? enabledReport === disabledReport
    : JSON.stringify(withoutArchiveFields(enabledReport)) === JSON.stringify(withoutArchiveFields(disabledReport));
  const plannerAndToolTraceSame = JSON.stringify(enabledTrace) === JSON.stringify(disabledTrace);
  const conversationStatusSame = enabled.firstTurnStatus === disabled.firstTurnStatus && enabled.finalStatus === disabled.finalStatus;
  const enabledSampleCount = (enabledReport?.historicalArchiveSampleCount ?? 0)
    + (enabledReport?.historicalArchiveCandidateSampleCount ?? 0);
  const disabledSampleCount = (disabledReport?.historicalArchiveSampleCount ?? 0)
    + (disabledReport?.historicalArchiveCandidateSampleCount ?? 0);
  const differences = [
    ...(plannerAndToolTraceSame ? [] : ["planner_or_tool_trace_changed"]),
    ...(conversationStatusSame ? [] : ["conversation_status_changed"]),
    ...(enabled.allPassed === disabled.allPassed ? [] : ["harness_check_pass_state_changed"]),
    ...(nonArchiveReportSame ? [] : ["non_archive_report_changed"]),
    ...(evaluatedCandidateCountSame ? [] : ["evaluated_candidate_count_changed"]),
    ...(evidenceCoverageSame ? [] : ["current_evidence_coverage_changed"]),
    ...(requestedCapabilityCoverageSame ? [] : ["requested_capability_coverage_changed"]),
    ...(recommendationIdentityOrderSame ? [] : ["recommendation_identity_or_order_changed"]),
    ...(recommendationEvidenceSame ? [] : ["recommendation_evidence_changed"]),
    ...(enabledSampleCount > 0 ? [] : ["no_historical_sample_observed"]),
    ...(disabledSampleCount === 0 ? [] : ["disabled_arm_contains_historical_samples"]),
  ];
  return {
    run: enabled.run,
    enabledModelRunPassed: enabled.allPassed,
    disabledModelRunPassed: disabled.allPassed,
    conversationStatusSame,
    nonArchiveReportSame,
    evaluatedCandidateCountSame,
    evidenceCoverageSame,
    requestedCapabilityCoverageSame,
    recommendationCount: enabledRecommendations.length,
    recommendationIdentityOrderSame,
    recommendationEvidenceSame,
    plannerAndToolTraceSame,
    trace: { enabled: enabledTrace, disabled: disabledTrace },
    historicalSidecar: {
      enabled: {
        status: enabledReport?.historicalArchiveCoverage?.status ?? null,
        checkedCandidates: enabledReport?.historicalArchiveCoverage?.checkedCandidates ?? 0,
        mappedCandidates: enabledReport?.historicalArchiveCoverage?.mappedCandidates ?? 0,
        matchedCandidates: enabledReport?.historicalArchiveCoverage?.matchedCandidates ?? 0,
        sampleCount: enabledSampleCount,
        releaseStamps: enabledReport?.historicalArchiveReleaseStamps ?? [],
        seasons: enabledReport?.historicalArchiveSeasons ?? [],
      },
      disabled: {
        status: disabledReport?.historicalArchiveCoverage?.status ?? null,
        checkedCandidates: disabledReport?.historicalArchiveCoverage?.checkedCandidates ?? 0,
        mappedCandidates: disabledReport?.historicalArchiveCoverage?.mappedCandidates ?? 0,
        matchedCandidates: disabledReport?.historicalArchiveCoverage?.matchedCandidates ?? 0,
        sampleCount: disabledSampleCount,
        releaseStamps: disabledReport?.historicalArchiveReleaseStamps ?? [],
        seasons: disabledReport?.historicalArchiveSeasons ?? [],
      },
    },
    differences,
  };
}

function summarizeAblationRun(run: LocalAgentRun) {
  const recommendations = run.report?.recommendations ?? [];
  return {
    run: run.run,
    allPassed: run.allPassed,
    passedChecks: Object.values(run.checks).filter(Boolean).length,
    checkCount: Object.keys(run.checks).length,
    elapsedMs: run.elapsedMs,
    recommendationCount: recommendations.length,
    focusEvidenceReferenceCount: recommendations.reduce((total, candidate) => total + candidate.evidenceKeys.length, 0),
    reviewOutcomes: run.trace.flatMap((event) => event.phase === "review" ? [event.outcome] : []),
  };
}

function evidenceEvaluatorEvents(run: LocalAgentRun): Array<{
  evidenceAvailability: unknown;
  evaluatedMetricKeys: string[];
  evaluatedMetricValueCount: number;
  requestedPlayerCount: number;
}> {
  return run.trace.flatMap((event) => {
    if (event.phase !== "tool" || event.toolName !== "evaluate_candidates") return [];
    const filters = typeof event.filters === "object" && event.filters !== null
      ? event.filters as Record<string, unknown>
      : {};
    return [{
      evidenceAvailability: filters.evidenceAvailability ?? null,
      evaluatedMetricKeys: Array.isArray(filters.evaluatedMetricKeys)
        ? filters.evaluatedMetricKeys.filter((key): key is string => typeof key === "string")
        : [],
      evaluatedMetricValueCount: typeof filters.evaluatedMetricValueCount === "number"
        ? filters.evaluatedMetricValueCount
        : 0,
      requestedPlayerCount: typeof filters.requestedPlayerCount === "number" ? filters.requestedPlayerCount : 0,
    }];
  });
}

function evidenceEvaluatorDownstreamTrace(run: LocalAgentRun): Array<Record<string, unknown>> {
  const evaluationIndex = run.trace.findIndex((event) => event.phase === "tool" && event.toolName === "evaluate_candidates");
  if (evaluationIndex < 0) return [];
  const summary: Array<Record<string, unknown>> = [];
  for (const event of run.trace.slice(evaluationIndex + 1)) {
    if (event.phase === "decision") {
      summary.push({
        phase: event.phase,
        action: event.action ?? null,
        decisionSource: event.decisionSource ?? null,
        policyBlocked: event.policyBlocked ?? false,
        plannerFallback: event.plannerFallback ?? null,
      });
    } else if (event.phase === "review") {
      summary.push({ phase: event.phase, outcome: event.outcome });
    } else if (event.phase === "tool") {
      summary.push({ phase: event.phase, toolName: event.toolName, ok: event.ok, resultCount: event.resultCount });
    }
  }
  return summary;
}

function summarizeEvidenceEvaluatorRun(scenario: EvaluationScenario, run: LocalAgentRun) {
  const evaluationEvents = evidenceEvaluatorEvents(run);
  const observedMetricKeys = [...new Set(evaluationEvents.flatMap(({ evaluatedMetricKeys }) => evaluatedMetricKeys))].sort();
  const requestedMetricKeys: string[] = "requestedCapabilities" in scenario
    ? [...new Set((scenario.requestedCapabilities ?? []).flatMap(({ metricKeys }) => metricKeys))].sort()
    : [];
  const directlyRelevantMetricKeys = observedMetricKeys.filter((key) => requestedMetricKeys.includes(key));
  const report = run.report;
  const withheldContractPassed = run.evidenceEvaluatorMode !== "withheld" ? null : Boolean(
    evaluationEvents.length > 0
      && evaluationEvents.every((event) => event.evidenceAvailability === "experimentally_withheld"
        && event.evaluatedMetricValueCount === 0
        && event.evaluatedMetricKeys.length === 0)
      && report?.evidenceCoverage.evidenceAvailability === "experimentally_withheld"
      && report.evidenceCoverage.availableMetricValues === 0
      && report.evidenceCoverage.expectedMetricValues === 0
      && report.requestedCapabilityCoverage.length === 0
      && report.recommendations.length === 0
  );
  return {
    run: run.run,
    evaluatorMode: run.evidenceEvaluatorMode,
    harness: {
      allPassed: run.allPassed,
      passedChecks: Object.values(run.checks).filter(Boolean).length,
      checkCount: Object.keys(run.checks).length,
      failedChecks: Object.entries(run.checks).flatMap(([name, passed]) => passed ? [] : [name]),
    },
    withheldContractPassed,
    elapsedMs: run.elapsedMs,
    modelUsage: run.modelUsage,
    plannerRequestAttempts: run.plannerRequestAttempts,
    toolCallCount: run.toolCallCount,
    evidenceEvaluatorCallCount: evaluationEvents.length,
    requestedEvaluationCount: evaluationEvents.reduce((count, event) => count + event.requestedPlayerCount, 0),
    returnedMetricValueCount: evaluationEvents.reduce((count, event) => count + event.evaluatedMetricValueCount, 0),
    requestedMetricKeys,
    observedMetricKeys,
    directlyRelevantMetricKeys,
    report: report ? {
      evidenceAvailability: report.evidenceCoverage.evidenceAvailability,
      evaluatedCandidateCount: report.evidenceCoverage.evaluatedCandidateCount,
      availableMetricValues: report.evidenceCoverage.availableMetricValues,
      expectedMetricValues: report.evidenceCoverage.expectedMetricValues,
      requestedCapabilityCount: report.requestedCapabilityCoverage.length,
      requestedCapabilityCoverage: report.requestedCapabilityCoverage.map(({ requestedMetricKeys: keys, observedMetricKeys: observed, evaluatedCandidateCount, candidatesWithEvidenceCount, status }) => ({
        requestedMetricKeys: keys,
        observedMetricKeys: observed,
        evaluatedCandidateCount,
        candidatesWithEvidenceCount,
        status,
      })),
      recommendationCount: report.recommendations.length,
      evidenceReferenceCount: report.recommendations.reduce((count, candidate) => count + candidate.evidenceKeys.length, 0),
    } : null,
    downstreamTrace: evidenceEvaluatorDownstreamTrace(run),
  };
}

function summarizeEvidenceEvaluatorArm(scenario: EvaluationScenario, runs: LocalAgentRun[], mode: "enabled" | "withheld") {
  const summary = summarizeEvaluationRuns(runs.map((run) => ({
    checks: run.checks,
    elapsedMs: run.elapsedMs,
    operationLatencySamples: operationLatencySamplesFromTrace(run.trace),
  })));
  const runSummaries = runs.map((run) => summarizeEvidenceEvaluatorRun(scenario, run));
  return {
    mode,
    harness: summary,
    withheldContractPassRate: mode === "withheld" && runSummaries.length
      ? runSummaries.filter((run) => run.withheldContractPassed).length / runSummaries.length
      : null,
    informativeEvidenceRunCount: mode === "enabled"
      ? runSummaries.filter((run) => run.directlyRelevantMetricKeys.length > 0).length
      : null,
    runs: runSummaries,
  };
}

function summarizeEvidenceEvaluatorPair(scenario: EvaluationScenario, enabled: LocalAgentRun, withheld: LocalAgentRun) {
  const enabledSummary = summarizeEvidenceEvaluatorRun(scenario, enabled);
  const withheldSummary = summarizeEvidenceEvaluatorRun(scenario, withheld);
  return {
    run: enabled.run,
    enabled: enabledSummary,
    withheld: withheldSummary,
    downstreamTraceSame: JSON.stringify(enabledSummary.downstreamTrace) === JSON.stringify(withheldSummary.downstreamTrace),
    directlyRelevantMetricKeyCount: enabledSummary.directlyRelevantMetricKeys.length,
    withheldContractPassed: withheldSummary.withheldContractPassed === true,
  };
}

function summarizeAblationArm(reviewerMode: RecruitmentReviewerMode, runs: LocalAgentRun[]) {
  return {
    reviewerMode,
    summary: summarizeEvaluationRuns(runs.map((run) => ({
      checks: run.checks,
      elapsedMs: run.elapsedMs,
      operationLatencySamples: operationLatencySamplesFromTrace(run.trace),
    }))),
    runs,
  };
}

function summarizeInteractionRun(run: LocalAgentRun) {
  return {
    run: run.run,
    allPassed: run.allPassed,
    passedChecks: Object.values(run.checks).filter(Boolean).length,
    checkCount: Object.keys(run.checks).length,
    elapsedMs: run.elapsedMs,
    firstTurnStatus: run.firstTurnStatus,
    finalStatus: run.finalStatus,
    askUserDecisionCount: run.askUserDecisionCount,
    clarificationAnswersUsed: run.clarificationAnswersUsed,
    toolCallCount: run.toolCallCount,
  };
}

function summarizeAskPolicyRun(run: LocalAgentRun) {
  return {
    run: run.run,
    allPassed: run.allPassed,
    passedChecks: Object.values(run.checks).filter(Boolean).length,
    checkCount: Object.keys(run.checks).length,
    elapsedMs: run.elapsedMs,
    firstTurnStatus: run.firstTurnStatus,
    finalStatus: run.finalStatus,
    askUserDecisionCount: run.askUserDecisionCount,
    askUserSuppressedDecisionCount: run.askUserSuppressedDecisionCount,
    clarificationAnswersUsed: run.clarificationAnswersUsed,
    toolCallCount: run.toolCallCount,
    reportGenerated: Boolean(run.report),
  };
}

function summarizeAskPolicyArm(askUserMode: RecruitmentAskUserMode, runs: LocalAgentRun[]) {
  return {
    askUserMode,
    summary: summarizeEvaluationRuns(runs.map((run) => ({
      checks: run.checks,
      elapsedMs: run.elapsedMs,
      operationLatencySamples: operationLatencySamplesFromTrace(run.trace),
    }))),
    runs,
  };
}

function summarizeMethodologyRagRun(run: LocalAgentRun) {
  const methodologyTools = run.trace.filter((event) => event.phase === "tool" && event.toolName === "search_methodology");
  const methodologySources = run.report?.methodologySources ?? [];
  return {
    run: run.run,
    allPassed: run.allPassed,
    passedChecks: Object.values(run.checks).filter(Boolean).length,
    checkCount: Object.keys(run.checks).length,
    elapsedMs: run.elapsedMs,
    firstTurnStatus: run.firstTurnStatus,
    finalStatus: run.finalStatus,
    decisionCount: run.decisionCount,
    toolCallCount: run.toolCallCount,
    methodologySearchCallCount: methodologyTools.length,
    methodologyChunksReturnedToPlanner: methodologyTools.reduce((total, event) => (
      total + (typeof event.resultCount === "number" ? event.resultCount : 0)
    ), 0),
    methodologySourceUrlsReturned: run.methodologySearchReturnedSourceUrls,
    reportMethodologyChunkCount: run.report?.methodologyChunksRetrieved ?? 0,
    reportMethodologySources: methodologySources,
    methodologyCitationsOnlyUseReturnedSources: "methodologyCitationsOnlyUseReturnedSources" in run.checks
      && run.checks.methodologyCitationsOnlyUseReturnedSources === true,
  };
}

function summarizeMethodologyRagArm(
  methodologyCorpusMode: "enabled" | "suppressed",
  runs: LocalAgentRun[],
) {
  return {
    methodologyCorpusMode,
    summary: summarizeEvaluationRuns(runs.map((run) => ({
      checks: run.checks,
      elapsedMs: run.elapsedMs,
      operationLatencySamples: operationLatencySamplesFromTrace(run.trace),
    }))),
    runSummaries: runs.map(summarizeMethodologyRagRun),
    runs,
  };
}

function summarizeInteractionArm(answerMode: "scripted" | "withheld", runs: LocalAgentRun[]) {
  return {
    answerMode,
    summary: summarizeEvaluationRuns(runs.map((run) => ({
      checks: run.checks,
      elapsedMs: run.elapsedMs,
      operationLatencySamples: operationLatencySamplesFromTrace(run.trace),
    }))),
    runs,
  };
}

function summarizeInvestigationPlanningRun(run: LocalAgentRun) {
  return {
    run: run.run,
    allPassed: run.allPassed,
    passedChecks: Object.values(run.checks).filter(Boolean).length,
    checkCount: Object.keys(run.checks).length,
    failedChecks: Object.entries(run.checks).flatMap(([name, passed]) => passed ? [] : [name]),
    firstTurnStatus: run.firstTurnStatus,
    finalStatus: run.finalStatus,
    clarificationAnswersUsed: run.clarificationAnswersUsed,
    plannerRequestAttempts: run.plannerRequestAttempts,
    modelUsage: run.modelUsage,
    elapsedMs: run.elapsedMs,
    decisionCount: run.decisionCount,
    toolCallCount: run.toolCallCount,
    evaluatedCandidateCount: run.report?.evaluatedCandidateCount ?? null,
    requestedCapabilityCoverage: run.report?.requestedCapabilityCoverage ?? null,
    recommendationCount: run.report?.recommendations.length ?? null,
    methodologyChunksRetrieved: run.report?.methodologyChunksRetrieved ?? null,
    reportGenerated: Boolean(run.report),
  };
}

function summarizeInvestigationPlanningArm(
  strategy: "adaptive" | "single_pass",
  runs: LocalAgentRun[],
) {
  const runSummaries = runs.map(summarizeInvestigationPlanningRun);
  const mean = (values: number[]) => values.length
    ? Math.round(values.reduce((total, value) => total + value, 0) / values.length * 100) / 100
    : null;
  return {
    strategy,
    summary: summarizeEvaluationRuns(runs.map((run) => ({ checks: run.checks, elapsedMs: run.elapsedMs }))),
    meanPlannerRequestAttempts: mean(runSummaries.map(({ plannerRequestAttempts }) => plannerRequestAttempts)),
    modelUsage: summarizeModelUsageAcrossRuns(runs.map((run) => run.modelUsage)),
    meanToolCallCount: mean(runSummaries.map(({ toolCallCount }) => toolCallCount)),
    runs: runSummaries,
  };
}

if (process.argv.includes("--help")) {
  process.stdout.write(`${usage}\n`);
} else {
  try {
    const summaryOutputFlags = process.argv.filter((argument) => argument === "--summary-output").length;
    if (summaryOutputFlags > 1) throw new Error("--summary-output 只能指定一次。");
    const summaryOutputArgument = option("--summary-output");
    const summaryOutputPath = summaryOutputArgument ? path.resolve(process.cwd(), summaryOutputArgument) : null;
    const { scenarios, runsPerScenario } = selectScenarios();
    const compareReviewer = process.argv.includes("--compare-reviewer");
    const compareInteraction = process.argv.includes("--compare-interaction");
    const compareAskPolicy = process.argv.includes("--compare-ask-policy");
    const compareMethodologyRag = process.argv.includes("--compare-methodology-rag");
    const compareInvestigationPlanning = process.argv.includes("--compare-investigation-planning");
    const compareHistoricalArchive = process.argv.includes("--compare-historical-archive");
    const compareEvidenceEvaluator = process.argv.includes("--compare-evidence-evaluator");
    if ([compareReviewer, compareInteraction, compareAskPolicy, compareMethodologyRag, compareInvestigationPlanning, compareHistoricalArchive, compareEvidenceEvaluator].filter(Boolean).length > 1) {
      throw new Error("--compare-reviewer、--compare-interaction、--compare-ask-policy、--compare-methodology-rag、--compare-investigation-planning、--compare-historical-archive 和 --compare-evidence-evaluator 一次只能使用一个。");
    }
    if (summaryOutputPath && [compareReviewer, compareInteraction, compareAskPolicy, compareMethodologyRag, compareInvestigationPlanning, compareHistoricalArchive, compareEvidenceEvaluator].some(Boolean)) {
      throw new Error("--summary-output 目前只支持普通 Harness 运行，不能与消融实验选项一起使用。");
    }
    if (summaryOutputPath) await assertIdentityFreeSummaryPathAvailable(summaryOutputPath);
    if (compareEvidenceEvaluator) {
      const scenarioId = option("--scenario");
      if (!scenarioId) {
        throw new Error("--compare-evidence-evaluator 必须与 --scenario <id|all> 一起使用。");
      }
      if (option("--message") || options("--answer").length || option("--expected-position")) {
        throw new Error("--compare-evidence-evaluator 使用登记场景与固定补答，不能与自定义输入一起使用。");
      }
      if (runsPerScenario < 3) {
        throw new Error("--compare-evidence-evaluator 至少需要 --runs 3，才能完成三组交错配对复跑。");
      }
      if (configuredDataMode !== "curated") {
        throw new Error("--compare-evidence-evaluator 需要 TACTISCOUT_DATA_MODE=curated，以固定男性足球数据快照。");
      }
    }
    if (compareReviewer) {
      const scenarioId = option("--scenario");
      if (!scenarioId || scenarioId === "all") {
        throw new Error("--compare-reviewer 必须与单个 --scenario <id> 一起使用。");
      }
      if (option("--message") || options("--answer").length || option("--expected-position")) {
        throw new Error("--compare-reviewer 使用登记场景的固定输入，不能与自定义需求或补答一起使用。");
      }
      if (configuredDataMode !== "curated") {
        throw new Error("--compare-reviewer 需要 TACTISCOUT_DATA_MODE=curated，以固定候选数据来源。");
      }
    }
    if (compareInteraction) {
      const scenarioId = option("--scenario");
      if (!scenarioId || scenarioId === "all") {
        throw new Error("--compare-interaction 必须与单个 --scenario <id> 一起使用。");
      }
      if (option("--message") || options("--answer").length || option("--expected-position")) {
        throw new Error("--compare-interaction 使用登记场景的固定需求和补答，不能与自定义输入一起使用。");
      }
      if (!scenarios[0] || !["barcelona-under-23-midfielder", "bayern-kane-replacement"].includes(scenarios[0].id)) {
        throw new Error("--compare-interaction 只支持巴萨 U23 中场清晰需求和拜仁凯恩接班人澄清场景。");
      }
      if (configuredDataMode !== "curated") {
        throw new Error("--compare-interaction 需要 TACTISCOUT_DATA_MODE=curated，以固定候选数据来源。");
      }
    }
    if (compareAskPolicy) {
      const scenarioId = option("--scenario");
      if (!scenarioId || scenarioId === "all") {
        throw new Error("--compare-ask-policy 必须与单个 --scenario <id> 一起使用。");
      }
      if (option("--message") || options("--answer").length || option("--expected-position")) {
        throw new Error("--compare-ask-policy 使用登记场景和预设补答，不能与自定义需求或补答一起使用。");
      }
      if (!scenarios[0] || !["barcelona-under-23-midfielder", "bayern-kane-replacement"].includes(scenarios[0].id)) {
        throw new Error("--compare-ask-policy 只支持巴萨 U23 中场清晰需求和拜仁凯恩接班人澄清场景。");
      }
      if (configuredDataMode !== "curated") {
        throw new Error("--compare-ask-policy 需要 TACTISCOUT_DATA_MODE=curated，以固定候选数据来源。");
      }
    }
    if (compareMethodologyRag) {
      const scenarioId = option("--scenario");
      if (!scenarioId || scenarioId === "all") {
        throw new Error("--compare-methodology-rag 必须与单个 --scenario bayern-kane-replacement 一起使用。");
      }
      if (option("--message") || options("--answer").length || option("--expected-position")) {
        throw new Error("--compare-methodology-rag 使用登记场景和预设补答，不能与自定义输入一起使用。");
      }
      if (scenarioId !== "bayern-kane-replacement") {
        throw new Error("--compare-methodology-rag 当前只支持已验证方法来源命中的拜仁凯恩接班人场景。");
      }
      if (configuredDataMode !== "curated") {
        throw new Error("--compare-methodology-rag 需要 TACTISCOUT_DATA_MODE=curated，以固定候选数据来源。");
      }
    }
    if (compareInvestigationPlanning) {
      const scenarioId = option("--scenario");
      if (!scenarioId || scenarioId === "all") {
        throw new Error("--compare-investigation-planning 必须与单个 --scenario <id> 一起使用。");
      }
      if (option("--message") || options("--answer").length || option("--expected-position")) {
        throw new Error("--compare-investigation-planning 使用登记场景的固定输入与补答，不能与自定义输入一起使用。");
      }
      if (configuredDataMode !== "curated") {
        throw new Error("--compare-investigation-planning 需要 TACTISCOUT_DATA_MODE=curated，以固定候选数据来源。");
      }
    }
    let historicalArchivePreflight: Awaited<ReturnType<typeof preflightConfiguredHistoricalArchive>> | null = null;
    if (compareHistoricalArchive) {
      const scenarioId = option("--scenario");
      if (!scenarioId || scenarioId === "all") {
        throw new Error("--compare-historical-archive 必须与单个已登记场景一起使用。");
      }
      if (option("--message") || options("--answer").length || option("--expected-position")) {
        throw new Error("--compare-historical-archive 使用已登记场景与固定输入，不能与自定义需求或补答一起使用。");
      }
      if (configuredDataMode !== "understat" && configuredDataMode !== "mosaic") {
        throw new Error("--compare-historical-archive 只支持 TACTISCOUT_DATA_MODE=understat 或 mosaic。");
      }
      if (runsPerScenario < 3) {
        throw new Error("--compare-historical-archive 至少需要 --runs 3，才能做三组交错顺序配对复跑。");
      }
      if (process.env.TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED !== "true"
        || process.env.TACTISCOUT_WYSCOUT_HISTORICAL_LOCAL_RETENTION_ALLOWED !== "true") {
        throw new Error("--compare-historical-archive 需要预先启用历史报告展示和本地保留两个选项；Runner 不会替你开启。");
      }
      historicalArchivePreflight = await preflightConfiguredHistoricalArchive();
      if (historicalArchivePreflight.status !== "ready") {
        throw new Error("--compare-historical-archive 无法读取有效的 Reep 身份索引与本机 Wyscout 档案；未联系模型。");
      }
    }
    const datasetSnapshotSha256 = await curatedDatasetSha256();
    const knowledgeBase = createLocalKnowledgeBase();
    const outputs: Array<Record<string, unknown>> = [];
    const baselinePassRates: number[] = [];
    const ablationPassRates: number[] = [];

    for (const scenario of scenarios) {
      if (compareEvidenceEvaluator) {
        const enabledRuns: LocalAgentRun[] = [];
        const withheldRuns: LocalAgentRun[] = [];
        for (let runNumber = 1; runNumber <= runsPerScenario; runNumber += 1) {
          let enabledRun: LocalAgentRun;
          let withheldRun: LocalAgentRun;
          if (runNumber % 2 === 1) {
            enabledRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, {
              evidenceEvaluatorMode: "enabled",
              suppressTraceOutput: true,
              suppressProgressOutput: true,
            });
            withheldRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, {
              evidenceEvaluatorMode: "withheld",
              suppressTraceOutput: true,
              suppressProgressOutput: true,
            });
          } else {
            withheldRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, {
              evidenceEvaluatorMode: "withheld",
              suppressTraceOutput: true,
              suppressProgressOutput: true,
            });
            enabledRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, {
              evidenceEvaluatorMode: "enabled",
              suppressTraceOutput: true,
              suppressProgressOutput: true,
            });
          }
          enabledRuns.push(enabledRun);
          withheldRuns.push(withheldRun);
        }
        const enabledArm = summarizeEvidenceEvaluatorArm(scenario, enabledRuns, "enabled");
        const withheldArm = summarizeEvidenceEvaluatorArm(scenario, withheldRuns, "withheld");
        const pairedRuns = enabledRuns.map((enabledRun, index) => summarizeEvidenceEvaluatorPair(
          scenario,
          enabledRun,
          withheldRuns[index]!,
        ));
        const withheldContractPassRate = withheldArm.withheldContractPassRate ?? 0;
        baselinePassRates.push(enabledArm.harness.passRate);
        ablationPassRates.push(withheldContractPassRate);
        outputs.push({
          id: scenario.id,
          comparison: {
            controls: ["same complete LangGraph", "same model configuration and registered request/answers", "same curated dataset snapshot", "same knowledge base", "same Planner, Reviewer, policies, tools, and budgets"],
            changedFactor: "The enabled arm returns source-backed capability evidence; the control arm retains candidate identity but explicitly withholds all evaluator metrics and comparisons.",
            order: "Execution order alternates enabled-first and withheld-first across paired repetitions.",
            caveat: "This is an exploratory mechanism check for frozen male-football scenarios. It does not measure shortlist quality, ranking accuracy, current transfer suitability, or general reliability.",
            harnessPassSemantics: "The enabled arm reports the ordinary Harness result. The withheld arm's ordinary Harness checks are descriptive; withheldContractPassRate checks that evidence was explicitly absent and no unsupported recommendation was delivered.",
          },
          arms: [enabledArm, withheldArm],
          pairedRuns,
          experimentInformative: enabledArm.informativeEvidenceRunCount === enabledRuns.length,
        });
        continue;
      }
      if (compareHistoricalArchive) {
        const enabledRuns: LocalAgentRun[] = [];
        const disabledRuns: LocalAgentRun[] = [];
        for (let runNumber = 1; runNumber <= runsPerScenario; runNumber += 1) {
          let enabledRun: LocalAgentRun;
          let disabledRun: LocalAgentRun;
          if (runNumber % 2 === 1) {
            enabledRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { historicalArchiveMode: "enabled", suppressTraceOutput: true });
            disabledRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { historicalArchiveMode: "disabled", suppressTraceOutput: true });
          } else {
            disabledRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { historicalArchiveMode: "disabled", suppressTraceOutput: true });
            enabledRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { historicalArchiveMode: "enabled", suppressTraceOutput: true });
          }
          enabledRuns.push(enabledRun);
          disabledRuns.push(disabledRun);
        }
        const pairs = enabledRuns.map((enabledRun, index) => historicalArchivePair(enabledRun, disabledRuns[index]!));
        const enabledSummary = summarizeEvaluationRuns(enabledRuns.map((run) => ({ checks: run.checks, elapsedMs: run.elapsedMs })));
        const disabledSummary = summarizeEvaluationRuns(disabledRuns.map((run) => ({ checks: run.checks, elapsedMs: run.elapsedMs })));
        const comparablePairs = pairs.filter((pair) => pair.differences.length === 0).length;
        baselinePassRates.push(enabledSummary.passRate);
        ablationPassRates.push(pairs.length ? comparablePairs / pairs.length : 0);
        outputs.push({
          id: scenario.id,
          dataScope: {
            mode: getDataRepository().mode,
            source: getDataRepository().sourceName,
            datasetScope: enabledRuns.find((run) => run.report?.datasetScope)?.report?.datasetScope ?? null,
          },
          archivePreflight: historicalArchivePreflight?.status === "ready" ? {
            reepReleaseStamp: historicalArchivePreflight.releaseStamp,
            archivePlayerSeasonRecords: historicalArchivePreflight.archivePlayerRecords,
          } : null,
          comparison: {
            controls: ["same registered request and answer script", "same model and local endpoint", "same Understat or mosaic repository", "same knowledge base", "same LangGraph and tool budgets"],
            changedFactor: "The enabled arm appends exact Reep-linked Wyscout history after Reviewer and Planner synthesis; the disabled arm suppresses only report display during graph construction.",
            order: "Pair order alternates enabled-first and disabled-first across repetitions.",
            caveat: "Historical samples are report-only context. This experiment does not evaluate current ability, ranking accuracy, transfer suitability, or general reliability.",
          },
          arms: [
            { mode: "enabled", summary: enabledSummary },
            { mode: "disabled", summary: disabledSummary },
          ],
          pairs,
        });
        continue;
      }
      if (compareReviewer) {
        const enabledRuns: LocalAgentRun[] = [];
        const bypassedRuns: LocalAgentRun[] = [];
        for (let runNumber = 1; runNumber <= runsPerScenario; runNumber += 1) {
          enabledRuns.push(await runScenarioOnce(scenario, runNumber, knowledgeBase, { reviewerMode: "enabled" }));
          bypassedRuns.push(await runScenarioOnce(scenario, runNumber, knowledgeBase, { reviewerMode: "bypassed" }));
        }
        const arms = [
          summarizeAblationArm("enabled", enabledRuns),
          summarizeAblationArm("bypassed", bypassedRuns),
        ];
        baselinePassRates.push(arms[0]!.summary.passRate);
        ablationPassRates.push(arms[1]!.summary.passRate);
        outputs.push({
          id: scenario.id,
          comparison: {
            controls: ["model configuration", "registered scenario and answers", "curated repository", "knowledge base", "tool budgets"],
            caveat: "Paired by input and data snapshot; each run uses an independent graph thread and the model endpoint does not guarantee a shared random seed.",
          },
          arms,
          pairedRuns: enabledRuns.map((enabledRun, index) => ({
            enabled: summarizeAblationRun(enabledRun),
            bypassed: summarizeAblationRun(bypassedRuns[index]!),
          })),
        });
        continue;
      }

      if (compareInteraction) {
        const scriptedRuns: LocalAgentRun[] = [];
        const withheldRuns: LocalAgentRun[] = [];
        for (let runNumber = 1; runNumber <= runsPerScenario; runNumber += 1) {
          let scriptedRun: LocalAgentRun;
          let withheldRun: LocalAgentRun;
          if (runNumber % 2 === 1) {
            scriptedRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { answerMode: "scripted" });
            withheldRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { answerMode: "withheld" });
          } else {
            withheldRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { answerMode: "withheld" });
            scriptedRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { answerMode: "scripted" });
          }
          scriptedRuns.push(scriptedRun);
          withheldRuns.push(withheldRun);
        }
        const scriptedArm = summarizeInteractionArm("scripted", scriptedRuns);
        const withheldArm = summarizeInteractionArm("withheld", withheldRuns);
        baselinePassRates.push(scriptedArm.summary.passRate);
        ablationPassRates.push(withheldArm.summary.passRate);
        outputs.push({
          id: scenario.id,
          comparison: {
            controls: ["model configuration", "registered initial request and curated answer script", "curated repository snapshot", "knowledge base", "planner/reviewer policies", "tool budgets"],
            changedFactor: "The withheld arm stops at the first user-visible LangGraph interrupt and does not receive the registered answers.",
            order: "Execution order is counterbalanced across paired repetitions.",
            caveat: "This isolates answer availability and same-case continuation; it is not a -ask_user policy ablation, framework comparison, recommendation-quality evaluation, or reliability estimate.",
          },
          arms: [scriptedArm, withheldArm],
          pairedRuns: scriptedRuns.map((scriptedRun, index) => ({
            scripted: summarizeInteractionRun(scriptedRun),
            withheld: summarizeInteractionRun(withheldRuns[index]!),
          })),
        });
        continue;
      }

      if (compareAskPolicy) {
        const enabledRuns: LocalAgentRun[] = [];
        const disabledRuns: LocalAgentRun[] = [];
        for (let runNumber = 1; runNumber <= runsPerScenario; runNumber += 1) {
          let enabledRun: LocalAgentRun;
          let disabledRun: LocalAgentRun;
          if (runNumber % 2 === 1) {
            enabledRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { askUserMode: "enabled" });
            disabledRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { askUserMode: "disabled" });
          } else {
            disabledRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { askUserMode: "disabled" });
            enabledRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { askUserMode: "enabled" });
          }
          enabledRuns.push(enabledRun);
          disabledRuns.push(disabledRun);
        }
        const enabledArm = summarizeAskPolicyArm("enabled", enabledRuns);
        const disabledArm = summarizeAskPolicyArm("disabled", disabledRuns);
        baselinePassRates.push(enabledArm.summary.passRate);
        ablationPassRates.push(disabledArm.summary.passRate);
        outputs.push({
          id: scenario.id,
          comparison: {
            controls: ["model configuration", "registered request and curated answer script", "curated repository snapshot", "knowledge base", "reviewer policy", "tool budgets"],
            changedFactor: "The disabled arm suppresses user-facing ask_user actions from both deterministic LangGraph policy gates and the Planner; it exposes only a fixed unresolved-needs pause and receives no scripted answers.",
            order: "Execution order is counterbalanced across paired repetitions.",
            caveat: "This estimates behavior in the frozen scenario when clarification is unavailable; it does not isolate answer value, recommendation quality, framework superiority, or general reliability.",
          },
          arms: [enabledArm, disabledArm],
          pairedRuns: enabledRuns.map((enabledRun, index) => ({
            enabled: summarizeAskPolicyRun(enabledRun),
            disabled: summarizeAskPolicyRun(disabledRuns[index]!),
          })),
        });
        continue;
      }

      if (compareMethodologyRag) {
        const enabledRuns: LocalAgentRun[] = [];
        const suppressedRuns: LocalAgentRun[] = [];
        const suppressedKnowledgeBase = suppressMethodologyCorpus(knowledgeBase);
        for (let runNumber = 1; runNumber <= runsPerScenario; runNumber += 1) {
          let enabledRun: LocalAgentRun;
          let suppressedRun: LocalAgentRun;
          if (runNumber % 2 === 1) {
            enabledRun = await runScenarioOnce(scenario, runNumber, knowledgeBase);
            suppressedRun = await runScenarioOnce(scenario, runNumber, suppressedKnowledgeBase);
          } else {
            suppressedRun = await runScenarioOnce(scenario, runNumber, suppressedKnowledgeBase);
            enabledRun = await runScenarioOnce(scenario, runNumber, knowledgeBase);
          }
          enabledRuns.push(enabledRun);
          suppressedRuns.push(suppressedRun);
        }
        const enabledArm = summarizeMethodologyRagArm("enabled", enabledRuns);
        const suppressedArm = summarizeMethodologyRagArm("suppressed", suppressedRuns);
        baselinePassRates.push(enabledArm.summary.passRate);
        ablationPassRates.push(suppressedArm.summary.passRate);
        outputs.push({
          id: scenario.id,
          comparison: {
            controls: ["model configuration", "registered request and curated answer script", "curated repository snapshot", "LangGraph graph and policies", "Reviewer", "tool budgets", "player-report corpus and all non-methodology tools"],
            changedFactor: "The suppressed arm returns no results only for KnowledgeRepository searches whose corpus is methodology; all other corpus searches pass through unchanged.",
            order: "Execution order is counterbalanced across paired repetitions.",
            caveat: "This estimates corpus availability effects in one frozen local-model scenario. It does not establish answer correctness, recommendation quality, framework superiority, or general RAG effectiveness.",
          },
          arms: [enabledArm, suppressedArm],
          pairedRuns: enabledRuns.map((enabledRun, index) => ({
            enabled: summarizeMethodologyRagRun(enabledRun),
            suppressed: summarizeMethodologyRagRun(suppressedRuns[index]!),
          })),
        });
        continue;
      }

      if (compareInvestigationPlanning) {
        const adaptiveRuns: LocalAgentRun[] = [];
        const singlePassRuns: LocalAgentRun[] = [];
        for (let runNumber = 1; runNumber <= runsPerScenario; runNumber += 1) {
          let adaptiveRun: LocalAgentRun;
          let singlePassRun: LocalAgentRun;
          if (runNumber % 2 === 1) {
            adaptiveRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { investigationPlanningMode: "adaptive" });
            singlePassRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { investigationPlanningMode: "single_pass" });
          } else {
            singlePassRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { investigationPlanningMode: "single_pass" });
            adaptiveRun = await runScenarioOnce(scenario, runNumber, knowledgeBase, { investigationPlanningMode: "adaptive" });
          }
          adaptiveRuns.push(adaptiveRun);
          singlePassRuns.push(singlePassRun);
        }
        const adaptiveArm = summarizeInvestigationPlanningArm("adaptive", adaptiveRuns);
        const singlePassArm = summarizeInvestigationPlanningArm("single_pass", singlePassRuns);
        baselinePassRates.push(adaptiveArm.summary.passRate);
        ablationPassRates.push(singlePassArm.summary.passRate);
        outputs.push({
          id: scenario.id,
          comparison: {
            controls: ["same LangGraph and graph policies", "model and conclusion synthesis", "registered request and clarification answers", "curated repository snapshot", "knowledge base", "tool implementations and limits", "Reviewer"],
            changedFactor: "Adaptive Planner investigation choices versus a frozen generic methodology lookup and one candidate page; both arms retain the same model for conclusion synthesis.",
            order: "Execution order is counterbalanced across paired repetitions.",
            caveat: "Exploratory mechanism check for the frozen case only. Token totals are provider-reported Planner usage; any metric with incomplete request coverage is unknown, and token counts are not monetary cost or a guarantee of matched cost. Results do not establish recommendation quality, general planning quality, or framework superiority.",
          },
          arms: [adaptiveArm, singlePassArm],
          pairedRuns: adaptiveRuns.map((adaptiveRun, index) => ({
            adaptive: summarizeInvestigationPlanningRun(adaptiveRun),
            singlePass: summarizeInvestigationPlanningRun(singlePassRuns[index]!),
          })),
        });
        continue;
      }

      const runs = [];
      for (let runNumber = 1; runNumber <= runsPerScenario; runNumber += 1) {
        runs.push(await runScenarioOnce(scenario, runNumber, knowledgeBase, summaryOutputPath
          ? { suppressTraceOutput: true, suppressProgressOutput: true }
          : {}));
      }
      const summary = summarizeEvaluationRuns(runs.map((run) => ({
        checks: run.checks,
        elapsedMs: run.elapsedMs,
        operationLatencySamples: operationLatencySamplesFromTrace(run.trace),
      })));
      baselinePassRates.push(summary.passRate);
      outputs.push({
        id: scenario.id,
        summary,
        runs,
      });
    }

    const output = {
      datasetVersion: compareEvidenceEvaluator ? 10 : compareHistoricalArchive ? 9 : compareInvestigationPlanning ? 8 : compareMethodologyRag ? 7 : compareAskPolicy ? 6 : compareInteraction ? 5 : compareReviewer ? 4 : 3,
      model: process.env.OPENAI_MODEL ?? null,
      endpoint: safeEndpoint(process.env.OPENAI_BASE_URL),
      apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
      repository: { mode: getDataRepository().mode, source: getDataRepository().sourceName },
      datasetSnapshotSha256,
      repeatsPerScenario: runsPerScenario,
      experiment: compareEvidenceEvaluator ? "recruitment-evidence-evaluator-ablation"
        : compareHistoricalArchive ? "historical-archive-report-sidecar-ablation"
        : compareInvestigationPlanning ? "dynamic-investigation-planning-ablation"
        : compareMethodologyRag ? "methodology-rag-agent-ablation"
          : compareAskPolicy ? "ask-user-policy-ablation"
            : compareInteraction ? "user-answer-interaction-ablation"
              : compareReviewer ? "evidence-reviewer-ablation" : null,
      scenarios: outputs,
      claims: {
        recommendationRankingAccuracy: "not evaluated: no trusted scout ranking labels",
        ragRelevance: "separate author-labeled regressions are available: immutable v2 covers 34 fixed queries and two sources; v3 covers 10 fixed queries and three sources including role-aware methodology. Online-query generalization and answer faithfulness are not validated",
      },
      allPassed: baselinePassRates.every((passRate) => passRate === 1),
      ablationAllPassed: compareEvidenceEvaluator || compareReviewer || compareInteraction || compareAskPolicy || compareMethodologyRag || compareInvestigationPlanning || compareHistoricalArchive
        ? ablationPassRates.every((passRate) => passRate === 1)
        : null,
    };
    if (summaryOutputPath) {
      const summary = createIdentityFreeHarnessSummary(output);
      await writeIdentityFreeHarnessSummary(summaryOutputPath, summary);
      process.stdout.write(`已写入不含候选身份的 Harness 聚合摘要：${path.relative(process.cwd(), summaryOutputPath)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    }
    if (!output.allPassed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Invalid evaluation options."}\n${usage}\n`);
    process.exitCode = 2;
  }
}
