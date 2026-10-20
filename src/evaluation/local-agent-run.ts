import { randomUUID } from "node:crypto";
import { configuredRecruitmentConversation, type ContextManagementMode, type RecruitmentAskUserMode, type RecruitmentPlanner, type RecruitmentPlannerResponseDiagnostics, type RecruitmentReviewerMode, type RecruitmentTraceEvent, type UnderstatResearchMode } from "../recruitment/conversation.js";
import { createRecruitmentEvidenceEvaluator } from "../recruitment/recruitment-evidence-evaluator.js";
import { createRecruitmentPlanner, type RecruitmentPlannerInput, type RecruitmentPlannerProtocol } from "../recruitment/recruitment-planner.js";
import { type KnowledgeRepository } from "../knowledge/index.js";
import { createSinglePassInvestigationPlanner } from "./fixed-investigation-planner.js";
import { evaluateContextStressTurn, evaluateLocalAgentScenario, evaluateWithheldAnswerArm, type ContextStressTurnEvaluation, type EvaluationOperationLatencySample, type EvaluationProgressEvent, type EvaluationScenario } from "./harness-evaluation.js";
import { questionMatchesClarificationIntent } from "./clarification-intent.js";
import type { ClarificationIntent } from "./harness-scenarios.js";
import { privacySafeTraceEvent } from "./trace-privacy.js";
import { getDataRepository } from "./local-agent-environment.js";
import { createWithheldRecruitmentEvidenceEvaluator } from "./withheld-recruitment-evidence-evaluator.js";

export function operationLatencySamplesFromTrace(
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
      ? typeof event.decisionMode === "string" ? event.decisionMode : "unresolved"
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

export function createObservedPlanner(
  planner: RecruitmentPlanner,
  onRequestAttempt: () => void,
  onRequestFailure?: (input: RecruitmentPlannerInput, error: unknown) => void,
): RecruitmentPlanner {
  return {
    ...(planner.preflightContext ? {
      preflightContext: input => planner.preflightContext!(input),
    } : {}),
    async decide(input) {
      onRequestAttempt();
      try {
        return await planner.decide(input);
      } catch (error) {
        onRequestFailure?.(input, error);
        throw error;
      }
    },
  };
}

export type HarnessErrorCategory = "network_permission" | "endpoint_unreachable" | "timeout" | "http_error" | "schema_validation" | "tool_call_protocol" | "response_parse" | "structured_output" | "context_capacity" | "other";

export function withConversationCompletionCheck(
  checks: Record<string, boolean>,
  finalStatus: string | null,
  reportGenerated: boolean,
): Record<string, boolean> {
  return {
    conversationCompleted: finalStatus === "completed" && reportGenerated,
    ...checks,
  };
}

const contextStressScopeReminder = "保持最初完整需求和全部筛选条件，不增不减。";
const contextStressEvidenceReminder = "请保留来源、单位、样本窗口并标明未知项；本轮只追问证据依据，不新增筛选条件。";

export const contextStressFollowUps = [
  `${contextStressScopeReminder} 请分别说明向前传球与持球推进目前有哪些直接指标，不要把它们混成一个分数。`,
  `${contextStressScopeReminder} 报告里的每90分钟数据请同时标出样本分钟数；低于比较门槛就不要给百分位。`,
  `${contextStressScopeReminder} 请核对推进能力覆盖：哪些候选有传球推进证据，哪些有持球推进证据，哪些仍缺数据？`,
  `${contextStressScopeReminder} 压力相关数据如果没有来源支持，请保留为未知；不要用抢断、拦截或对抗数据代替。`,
  `${contextStressScopeReminder} 请简要解释当前排序的主要依据，只引用已经读取且能对应到候选人的统计或报告。`,
  `${contextStressScopeReminder} 同一候选如果有多条来源记录，请沿用已核验的身份关系；不要仅凭姓名合并。`,
  `${contextStressScopeReminder} 请检查推荐理由是否分别覆盖传球推进、持球推进和前场压迫，未覆盖的部分写清楚。`,
  `${contextStressScopeReminder} 更新目前的证据缺口列表，区分完全没有数据、样本不足和已经观察到的表现。`,
  `${contextStressScopeReminder} 请比较当前前几名的指标差异，并保留各自来源样本，不要扩大联赛或位置范围。`,
  `${contextStressScopeReminder} 如果排序与上一轮不同，请指出是哪条新增或更正的证据导致变化；没有变化也直说。`,
  `${contextStressScopeReminder} 把候选推荐理由缩短一些，但保留指标单位、比赛分钟和无法验证的项目。`,
  `${contextStressScopeReminder} 请再次核对年龄和中场位置，没有被我提出的其他条件不要偷偷加入筛选。`,
  `${contextStressScopeReminder} 不要把缺少压迫指标解释成压迫能力差；说明当前数据能支持什么、不能支持什么。`,
  `${contextStressScopeReminder} 请确认每个被推荐的人都已经做过表现评估；未评估记录只能说明为待调查。`,
  `${contextStressScopeReminder} 再总结一遍最适合继续考察的候选，以及选择他们的直接证据和主要风险。`,
  `${contextStressScopeReminder} 如果球员报告没有查到新内容，就以已验证的比赛数据为准，不要补写来源没有说过的特点。`,
  `${contextStressScopeReminder} 说明样本数是否足以做同位置比较；不足时保留绝对观测值即可。`,
  `${contextStressScopeReminder} 请区分来源原始指标和系统换算出来的每90分钟指标，避免把派生值说成来源原文。`,
  `${contextStressScopeReminder} 检查最终结论是否遗漏了持球推进或前场压迫；没有对应数据就明示缺口。`,
  `${contextStressScopeReminder} 最后按原条件给一版紧凑总结：值得继续考察的球员、直接证据、样本风险和仍未知的能力。`,
].map(message => `${message} ${contextStressEvidenceReminder}`);

type HarnessErrorSummary = {
  name: string;
  category: HarnessErrorCategory;
  code?: string;
  status?: number;
  stage?: string;
  estimatedInputTokens?: number;
  inputBudgetTokens?: number;
  validationIssuePaths?: string[];
  validationIssueCodes?: string[];
  plannerResponseDiagnostics?: RecruitmentPlannerResponseDiagnostics;
};

const safeValidationPathKeys = new Set([
  "action", "targetTeam", "needSummary", "capabilityProfile", "recommendations", "playerId", "evidenceKeys",
  "limitationKeys", "reportObservations", "documentId", "summary", "linkedMetricKeys", "question", "reason",
  "positionSelection", "highlight", "current", "position", "positions", "playerName", "maxAge", "minimumMinutes",
  "competition", "season", "offset", "limit", "refs", "fields", "cursor", "teamName", "sections", "playerIds",
  "matchId", "query", "playerNames", "includeGoalkeepers", "requestedCapabilityCoverage", "requestedMetricKeys",
  "observedMetricKeys", "nextOffset", "filters", "toolName", "arguments", "input", "output",
]);

function safeValidationIssueDetails(issues: unknown): Pick<HarnessErrorSummary, "validationIssuePaths" | "validationIssueCodes"> {
  if (!Array.isArray(issues)) return {};
  const paths: string[] = [];
  const codes: string[] = [];
  for (const issue of issues.slice(0, 32)) {
    if (typeof issue !== "object" || issue === null) continue;
    const record = issue as { path?: unknown; code?: unknown };
    const pathSegments = Array.isArray(record.path) ? record.path.slice(0, 12) : [];
    const path = pathSegments.map((segment) => {
      if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) return String(segment);
      return typeof segment === "string" && safeValidationPathKeys.has(segment) ? segment : "field";
    }).join(".");
    if (path && !paths.includes(path)) paths.push(path);
    if (typeof record.code === "string" && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(record.code)) {
      const code = `${path || "root"}:${record.code}`;
      if (!codes.includes(code)) codes.push(code);
    }
    if (paths.length >= 8 && codes.length >= 8) break;
  }
  return {
    ...(paths.length ? { validationIssuePaths: paths.slice(0, 8) } : {}),
    ...(codes.length ? { validationIssueCodes: codes.slice(0, 8) } : {}),
  };
}

export function isComparableContextCapacityPreflight(input: {
  errors: readonly { category: HarnessErrorCategory }[];
  plannerResponseCount: number;
}): boolean {
  return input.errors.length > 0
    && input.errors.every(error => error.category === "context_capacity")
    && input.plannerResponseCount > 0;
}

export function canRunContextManagementComparison(input: {
  allChecksPassed: boolean;
  finalStatus: string | null;
  reportGenerated: boolean;
  errors: readonly { category: HarnessErrorCategory }[];
  plannerResponseCount: number;
}): boolean {
  return input.allChecksPassed
    || (input.finalStatus === "completed" && input.reportGenerated)
    || isComparableContextCapacityPreflight({
      errors: input.errors,
      plannerResponseCount: input.plannerResponseCount,
    });
}

export function summarizeFirstUsefulProgress(progress: readonly EvaluationProgressEvent[]) {
  const firstVisible = progress[0];
  const firstUseful = progress.find(event => event.status !== "started");
  return {
    firstVisibleProgressMs: firstVisible?.elapsedMs ?? null,
    firstUsefulProgressMs: firstUseful?.elapsedMs ?? null,
    firstUsefulProgressStage: firstUseful?.stage ?? null,
    firstUsefulProgressStatus: firstUseful?.status ?? null,
  };
}

type LocalAgentRunOptions = {
  reviewerMode?: RecruitmentReviewerMode;
  answerMode?: "scripted" | "withheld";
  askUserMode?: RecruitmentAskUserMode;
  investigationPlanningMode?: "adaptive" | "single_pass";
  historicalArchiveMode?: "enabled" | "disabled";
  evidenceEvaluatorMode?: "enabled" | "withheld";
  expansionSufficiencyMode?: "enabled" | "bypassed";
  understatResearchMode?: UnderstatResearchMode;
  contextManagementMode?: ContextManagementMode;
  plannerProtocol?: RecruitmentPlannerProtocol;
  contextStressTurns?: number;
  suppressTraceOutput?: boolean;
  suppressProgressOutput?: boolean;
};

type DecisionTrace = Extract<RecruitmentTraceEvent, { phase: "decision" }>;

function isDecisionTrace(event: RecruitmentTraceEvent): event is DecisionTrace {
  return event.phase === "decision";
}

export function summarizeHarnessErrors(error: unknown): HarnessErrorSummary[] {
  const summaries: HarnessErrorSummary[] = [];
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const record = typeof current === "object"
      ? current as { name?: unknown; code?: unknown; status?: unknown; response?: { status?: unknown }; message?: unknown; cause?: unknown; diagnostics?: unknown; stage?: unknown; estimatedInputTokens?: unknown; inputBudgetTokens?: unknown; issues?: unknown }
      : {};
    const responseFailure = typeof record.diagnostics === "object" && record.diagnostics !== null
      && "failure" in record.diagnostics && typeof record.diagnostics.failure === "string"
      ? record.diagnostics.failure
      : undefined;
    const code = typeof record.code === "string" && /^[A-Z0-9_-]{1,40}$/i.test(record.code) ? record.code : undefined;
    const status = typeof record.status === "number" ? record.status
      : typeof record.response?.status === "number" ? record.response.status : undefined;
    const errorText = `${code ?? ""} ${typeof record.message === "string" ? record.message : ""} ${typeof record.name === "string" ? record.name : ""}`.toLowerCase();
    const category: HarnessErrorCategory = record.name === "RecruitmentContextCapacityError" || /context capacity/.test(errorText)
      ? "context_capacity"
      : responseFailure === "tool_call_protocol"
        ? "tool_call_protocol"
        : responseFailure === "schema_mismatch"
          ? "schema_validation"
          : responseFailure === "invalid_json" || responseFailure === "empty_content"
            ? "response_parse"
      : code === "EPERM" || errorText.includes("eperm")
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
      ...(typeof record.stage === "string" ? { stage: record.stage } : {}),
      ...(typeof record.estimatedInputTokens === "number" ? { estimatedInputTokens: record.estimatedInputTokens } : {}),
      ...(typeof record.inputBudgetTokens === "number" ? { inputBudgetTokens: record.inputBudgetTokens } : {}),
      ...(category === "schema_validation" ? safeValidationIssueDetails(record.issues) : {}),
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

export type ModelUsageSummary = {
  requestCount: number;
  responseCount: number;
  failedRequestCount: number;
  inputTokens: ModelUsageMetricSummary;
  outputTokens: ModelUsageMetricSummary;
  totalTokens: ModelUsageMetricSummary;
};

export function summarizeModelUsage(events: readonly RecruitmentTraceEvent[]): ModelUsageSummary {
  const requests = events.filter((event): event is Extract<RecruitmentTraceEvent, { phase: "model_usage" | "brief_usage" | "identity_usage" | "summary_usage" }> => (
    event.phase === "model_usage" || event.phase === "brief_usage" || event.phase === "identity_usage" || event.phase === "summary_usage"
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

export function summarizeModelUsageAcrossRuns(summaries: readonly ModelUsageSummary[]): ModelUsageSummary {
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

export async function runScenarioOnce(
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
  const plannerRequestFailures: Array<{ decisionMode: string | null; errors: HarnessErrorSummary[] }> = [];
  const events: RecruitmentTraceEvent[] = [];
  const eventTurns: number[] = [];
  const progressEvents: EvaluationProgressEvent[] = [];
  let currentTurn = 0;
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
        eventTurns.push(currentTurn);
        if (!options.suppressTraceOutput) {
          process.stderr.write(`[trace][${scenario.id}][${runNumber}] ${JSON.stringify(privacySafeTraceEvent(event))}\n`);
        }
      },
      experimentalReviewerMode: reviewerMode,
      experimentalAskUserMode: askUserMode,
      experimentalExpansionSufficiencyMode: options.expansionSufficiencyMode ?? "enabled",
      ...(options.understatResearchMode ? { experimentalDeterministicSearchMode: "bypassed" as const } : {}),
      experimentalUnderstatResearchMode: options.understatResearchMode,
      experimentalContextManagementMode: options.contextManagementMode ?? "legacy",
      experimentalToolExecutionMode: options.plannerProtocol === "legacy_action" ? "legacy_action_dispatch" : "langgraph_tool_node",
      plannerFactory: () => {
        const modelPlanner = createRecruitmentPlanner({ protocol: options.plannerProtocol ?? "native_tools" });
        const observedModelPlanner = createObservedPlanner(
          modelPlanner,
          () => { plannerRequestAttempts += 1; },
          (plannerInput, error) => plannerRequestFailures.push({
            decisionMode: plannerInput.decisionMode ?? null,
            errors: summarizeHarnessErrors(error),
          }),
        );
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
  let contextStressTurnsCompleted = 0;
  let contextStressTurnsAttempted = 0;
  const contextStressTurnMatrix: ContextStressTurnEvaluation[] = [];
  const captureProgress = (update: Omit<EvaluationProgressEvent, "sequence" | "turn">) => {
    const event = {
      sequence: progressEvents.length + 1,
      turn: currentTurn,
      ...update,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
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
    if (response.status === "completed" && options.contextStressTurns) {
      for (let index = 0; index < options.contextStressTurns; index += 1) {
        const message = contextStressFollowUps[index];
        if (!message) throw new Error("Context management stress run exceeds its 20-turn follow-up script.");
        currentTurn += 1;
        contextStressTurnsAttempted += 1;
        const eventStart = events.length;
        const progressStart = progressEvents.length;
        response = await conversation.turn({
          threadId,
          message,
          expectsExistingState: true,
          onProgress: captureProgress,
        });
        contextStressTurnMatrix.push(evaluateContextStressTurn({
          scenario,
          response,
          events: events.slice(eventStart),
          progressEvents: progressEvents.slice(progressStart),
          previousEvents: events.slice(0, eventStart),
          turn: currentTurn,
        }));
        if (response.status !== "completed") break;
        contextStressTurnsCompleted += 1;
      }
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
      eventTurns,
      contextStressTurnsAttempted,
      contextStressTurnsCompleted,
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
    const contextStressChecks: Record<string, boolean> = {};
    if (options.contextStressTurns) {
      contextStressChecks.contextStressScriptCompleted = contextStressTurnsCompleted === options.contextStressTurns;
      contextStressChecks.contextStressCorrectnessMatrixPassed = contextStressTurnMatrix.length === options.contextStressTurns
        && contextStressTurnMatrix.every((turn) => turn.allPassed);
    }
    const checks = withConversationCompletionCheck({
      ...evaluation.checks,
      ...interactionChecks,
      ...contextStressChecks,
      methodologyCitationsOnlyUseReturnedSources,
    }, response.status, Boolean(response.report));
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
      understatResearchMode: options.understatResearchMode ?? "adaptive",
      contextManagementMode: options.contextManagementMode ?? "legacy",
      plannerProtocol: options.plannerProtocol ?? "native_tools",
      contextStressTurnsRequested: options.contextStressTurns ?? 0,
      contextStressTurnsAttempted,
      contextStressTurnsCompleted,
      contextStressTurnMatrix,
      evidenceEvaluatorMode: options.evidenceEvaluatorMode ?? "enabled",
      expansionSufficiencyMode: options.expansionSufficiencyMode ?? "enabled",
      plannerRequestAttempts,
      plannerRequestFailures,
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
      trace: events.map((event, index): Record<string, unknown> => ({ ...privacySafeTraceEvent(event), turn: eventTurns[index] ?? null })),
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
      understatResearchMode: options.understatResearchMode ?? "adaptive",
      contextManagementMode: options.contextManagementMode ?? "legacy",
      plannerProtocol: options.plannerProtocol ?? "native_tools",
      contextStressTurnsRequested: options.contextStressTurns ?? 0,
      contextStressTurnsAttempted,
      contextStressTurnsCompleted,
      contextStressTurnMatrix,
      evidenceEvaluatorMode: options.evidenceEvaluatorMode ?? "enabled",
      expansionSufficiencyMode: options.expansionSufficiencyMode ?? "enabled",
      plannerRequestAttempts,
      plannerRequestFailures,
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
      checks: withConversationCompletionCheck({
        ...(options.contextStressTurns ? { contextStressScriptCompleted: false } : {}),
      }, null, false),
      allPassed: false,
      report: null,
      methodologySearchReturnedSourceUrls: [...methodologySearchReturnedSourceUrls],
      errors: summarizeHarnessErrors(error),
      trace: events.map((event, index): Record<string, unknown> => ({ ...privacySafeTraceEvent(event), turn: eventTurns[index] ?? null })),
      progress: progressEvents,
    };
  }
}

export type LocalAgentRun = Awaited<ReturnType<typeof runScenarioOnce>>;
