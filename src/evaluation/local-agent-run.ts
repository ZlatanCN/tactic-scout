import { randomUUID } from "node:crypto";
import { configuredRecruitmentConversation, type RecruitmentAskUserMode, type RecruitmentPlanner, type RecruitmentPlannerResponseDiagnostics, type RecruitmentReviewerMode, type RecruitmentTraceEvent, type UnderstatResearchMode } from "../recruitment/conversation.js";
import { createRecruitmentEvidenceEvaluator } from "../recruitment/recruitment-evidence-evaluator.js";
import { createRecruitmentPlanner, type RecruitmentPlannerInput } from "../recruitment/recruitment-planner.js";
import { type KnowledgeRepository } from "../knowledge/index.js";
import { createSinglePassInvestigationPlanner } from "./fixed-investigation-planner.js";
import { evaluateLocalAgentScenario, evaluateWithheldAnswerArm, type EvaluationOperationLatencySample, type EvaluationProgressEvent, type EvaluationScenario } from "./harness-evaluation.js";
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

type HarnessErrorSummary = {
  name: string;
  category: HarnessErrorCategory;
  code?: string;
  status?: number;
  stage?: string;
  estimatedInputTokens?: number;
  inputBudgetTokens?: number | null;
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

type LocalAgentRunOptions = {
  reviewerMode?: RecruitmentReviewerMode;
  answerMode?: "scripted" | "withheld";
  askUserMode?: RecruitmentAskUserMode;
  investigationPlanningMode?: "adaptive" | "single_pass";
  historicalArchiveMode?: "enabled" | "disabled";
  evidenceEvaluatorMode?: "enabled" | "withheld";
  expansionSufficiencyMode?: "enabled" | "bypassed";
  understatResearchMode?: UnderstatResearchMode;
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
      ...(typeof record.inputBudgetTokens === "number" || record.inputBudgetTokens === null ? { inputBudgetTokens: record.inputBudgetTokens } : {}),
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
  const requests = events.filter((event): event is Extract<RecruitmentTraceEvent, { phase: "model_usage" | "brief_usage" | "identity_usage" }> => (
    event.phase === "model_usage" || event.phase === "brief_usage" || event.phase === "identity_usage"
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
      plannerFactory: () => {
        const modelPlanner = createRecruitmentPlanner();
        const observedModelPlanner = createObservedPlanner(
          modelPlanner,
          () => { plannerRequestAttempts += 1; },
          (plannerInput, error) => plannerRequestFailures.push({
            decisionMode: plannerInput.decisionSnapshot.caps.stage,
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
    const checks = withConversationCompletionCheck({
      ...evaluation.checks,
      ...interactionChecks,
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
      checks: withConversationCompletionCheck({}, null, false),
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
