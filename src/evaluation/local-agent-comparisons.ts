import { type RecruitmentAskUserMode, type RecruitmentReviewerMode } from "../recruitment/conversation.js";
import type { RecruitmentTraceEvent } from "../recruitment/conversation/contracts.js";
import type { RecruitmentPlannerResponseDiagnostics } from "../recruitment/recruitment-planner.js";
import { type KnowledgeRepository } from "../knowledge/index.js";
import type { RecruitmentContextManifest } from "../recruitment/context.js";
import { type EvaluationScenario, summarizeEvaluationRuns } from "./harness-evaluation.js";
import { type LocalAgentRun, operationLatencySamplesFromTrace, summarizeFirstUsefulProgress, summarizeModelUsageAcrossRuns } from "./local-agent-run.js";

export function suppressMethodologyCorpus(knowledgeBase: KnowledgeRepository): KnowledgeRepository {
  return {
    search(request) {
      if (request.corpus === "methodology") return Promise.resolve([]);
      return knowledgeBase.search(request);
    },
  };
}

function historicalArchiveTrace(run: LocalAgentRun): Array<Record<string, unknown>> {
  const safeFilterKeys = [
    "position", "maxAge", "minimumMinutes", "competition", "season", "discoveryMetricGroups", "requestedOffset", "offset", "limit",
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

export function historicalArchivePair(enabled: LocalAgentRun, disabled: LocalAgentRun) {
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

export function summarizeAblationRun(run: LocalAgentRun) {
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

export function summarizeContextManagementArm(id: "legacy" | "projection" | "evidence" | "unified" | "summarized", runs: readonly LocalAgentRun[]) {
  const summary = summarizeEvaluationRuns(runs.map(run => ({
    checks: run.checks,
    elapsedMs: run.elapsedMs,
    operationLatencySamples: operationLatencySamplesFromTrace(run.trace),
  })));
  const modelUsage = summarizeModelUsageAcrossRuns(runs.map(run => run.modelUsage));
  return {
    id,
    summary,
    modelUsage,
    contextRequests: summarizeContextRequests(runs.flatMap(run => run.trace.flatMap(event => {
      const value = event.contextManifest;
      return value && typeof value === "object" ? [value as RecruitmentContextManifest] : [];
    }))),
    contextStressTurnsRequested: runs.map(run => run.contextStressTurnsRequested),
    contextStressTurnsAttempted: runs.map(run => run.contextStressTurnsAttempted),
    contextStressTurnsCompleted: runs.map(run => run.contextStressTurnsCompleted),
    contextStressCorrectnessMatrix: runs.map(run => ({
      run: run.run,
      turns: run.contextStressTurnMatrix,
    })),
    mechanismExercise: runs.map(summarizeContextManagementMechanisms),
    errors: summarizeContextManagementErrors(runs.map(run => "errors" in run ? run.errors : [])),
    plannerRequestFailures: runs.map(({ run, plannerRequestFailures }) => ({ run, failures: plannerRequestFailures })),
    summaryRequests: runs.map(run => run.trace.filter(event => event.phase === "summary_usage").length),
    summaryFailures: runs.map(run => run.trace.filter(event => event.phase === "summary_failure").length),
    compactionProgressEvents: runs.map(run => run.progress.filter(event => event.stage === "context_compaction").length),
    toolCallCounts: runs.map(run => run.toolCallCount),
    plannerRequestAttempts: runs.map(run => run.plannerRequestAttempts),
    firstProgress: runs.map(run => summarizeFirstUsefulProgress(run.progress)),
  };
}

export function summarizeContextManagementMechanisms(run: Pick<LocalAgentRun, "trace" | "progress">) {
  const trace = run.trace as readonly Record<string, unknown>[];
  return {
    projectedPlannerRequests: trace.filter(event => {
      if (event.phase !== "model_usage" || !event.contextManifest || typeof event.contextManifest !== "object") return false;
      const omitted = (event.contextManifest as { omittedHistoryEventIds?: unknown }).omittedHistoryEventIds;
      return Array.isArray(omitted) && omitted.length > 0;
    }).length,
    evidenceReadCalls: trace.filter(event => event.phase === "tool" && event.toolName === "read_case_evidence").length,
    summaryModelRequests: trace.filter(event => event.phase === "summary_usage").length,
    acceptedSummaries: run.progress.filter(event => event.stage === "context_compaction" && event.status === "completed").length,
    summaryFailures: trace.filter(event => event.phase === "summary_failure").length,
  };
}

export function contextSummaryMechanismWasExercised(input: { modelRequests: number; acceptedSummaries: number }): boolean {
  return Number.isSafeInteger(input.modelRequests) && input.modelRequests > 0
    && Number.isSafeInteger(input.acceptedSummaries) && input.acceptedSummaries > 0;
}

type ContextManagementRunError = {
  name: string;
  category: string;
  code?: string;
  status?: number;
  stage?: string;
  estimatedInputTokens?: number;
  inputBudgetTokens?: number;
  validationIssuePaths?: string[];
  validationIssueCodes?: string[];
  plannerResponseDiagnostics?: RecruitmentPlannerResponseDiagnostics;
};

export function summarizeContextManagementErrors(
  errorsByRun: readonly (readonly ContextManagementRunError[] | undefined)[],
) {
  return errorsByRun.map(errors => (errors ?? []).map((error) => {
    const diagnostics = error.plannerResponseDiagnostics;
    return {
      name: error.name,
      category: error.category,
      ...(error.code ? { code: error.code } : {}),
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.stage ? { stage: error.stage } : {}),
      ...(error.estimatedInputTokens !== undefined ? { estimatedInputTokens: error.estimatedInputTokens } : {}),
      ...(error.inputBudgetTokens !== undefined ? { inputBudgetTokens: error.inputBudgetTokens } : {}),
      ...(error.validationIssuePaths?.length ? { validationIssuePaths: error.validationIssuePaths.slice(0, 8) } : {}),
      ...(error.validationIssueCodes?.length ? { validationIssueCodes: error.validationIssueCodes.slice(0, 8) } : {}),
      ...(diagnostics ? {
        plannerResponseDiagnostics: {
          failure: diagnostics.failure,
          ...(diagnostics.toolCallProtocolFailure ? { toolCallProtocolFailure: diagnostics.toolCallProtocolFailure } : {}),
          ...(diagnostics.toolCallIssuePaths?.length ? { toolCallIssuePaths: diagnostics.toolCallIssuePaths.slice(0, 8) } : {}),
          ...(diagnostics.toolCallIssueCodes?.length ? { toolCallIssueCodes: diagnostics.toolCallIssueCodes.slice(0, 8) } : {}),
          contentKind: diagnostics.contentKind,
          ...(diagnostics.contentLength !== undefined ? { contentLength: diagnostics.contentLength } : {}),
          ...(diagnostics.finishReason ? { finishReason: diagnostics.finishReason } : {}),
          hasReasoningContent: diagnostics.hasReasoningContent,
          toolCallCount: diagnostics.toolCallCount,
        },
      } : {}),
    };
  }));
}

export function summarizeContextRequests(requests: readonly RecruitmentContextManifest[]) {
  const metric = (values: readonly unknown[], requestCount = requests.length) => {
    const numbers = values.filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
    const status = requestCount === 0 || numbers.length === 0 ? "unavailable"
      : numbers.length === requestCount ? "complete" : "partial";
    const observedTotal = numbers.reduce((sum, value) => sum + value, 0);
    return {
      status,
      total: status === "complete" ? observedTotal : null,
      observedTotal,
      observed: numbers.length,
      requestCount,
    };
  };
  const actualUsageStatus: Record<string, number> = {};
  const budgetStrategyCounts: Record<string, number> = {};
  for (const request of requests) {
    const budgetStrategy = typeof request.budgetStrategy === "string" ? request.budgetStrategy : "not_observed";
    budgetStrategyCounts[budgetStrategy] = (budgetStrategyCounts[budgetStrategy] ?? 0) + 1;
    const status = request.actualTokenUsage?.status ?? "not_observed";
    actualUsageStatus[status] = (actualUsageStatus[status] ?? 0) + 1;
  }
  const stages = [...new Set(requests.flatMap(request => typeof request.stage === "string" ? [request.stage] : []))].sort();
  const byStage = Object.fromEntries(stages.map(stage => {
    const subset = requests.filter(request => request.stage === stage);
    const estimatedInputTokens = metric(subset.map(request => request.estimatedInputTokens), subset.length);
    const actualInputTokens = metric(subset.map(request => request.actualTokenUsage?.inputTokens), subset.length);
    const actualOutputTokens = metric(subset.map(request => request.actualTokenUsage?.outputTokens), subset.length);
    const actualTotalTokens = metric(subset.map(request => request.actualTokenUsage?.totalTokens), subset.length);
    const inputEstimateErrorTokens = estimatedInputTokens.total === null || actualInputTokens.total === null
      ? null
      : estimatedInputTokens.total - actualInputTokens.total;
    const inputEstimateRelativeError = estimatedInputTokens.total === null || actualInputTokens.total === null || actualInputTokens.total === 0
      ? null
      : inputEstimateErrorTokens! / actualInputTokens.total;
    return [stage, {
      requestCount: subset.length,
      estimatedInputTokens,
      requestBytes: metric(subset.map(request => request.requestBytes), subset.length),
      actualInputTokens,
      actualOutputTokens,
      actualTotalTokens,
      inputEstimateErrorTokens,
      inputEstimateRelativeError,
    }];
  }));
  return {
    requestCount: requests.length,
    estimatedInputTokens: metric(requests.map(manifest => manifest.estimatedInputTokens)),
    requestBytes: metric(requests.map(manifest => manifest.requestBytes)),
    actualTokenUsage: {
      inputTokens: metric(requests.map(manifest => manifest.actualTokenUsage?.inputTokens)),
      outputTokens: metric(requests.map(manifest => manifest.actualTokenUsage?.outputTokens)),
      totalTokens: metric(requests.map(manifest => manifest.actualTokenUsage?.totalTokens)),
    },
    overBudgetRequests: requests.filter(manifest => manifest.status === "over_budget").length,
    includedHistoryEventCount: requests.reduce((sum, manifest) => sum + (Array.isArray(manifest.includedHistoryEventIds) ? manifest.includedHistoryEventIds.length : 0), 0),
    omittedHistoryEventCount: requests.reduce((sum, manifest) => sum + (Array.isArray(manifest.omittedHistoryEventIds) ? manifest.omittedHistoryEventIds.length : 0), 0),
    evidenceReferenceCount: requests.reduce((sum, manifest) => sum + (Array.isArray(manifest.evidenceRefs) ? manifest.evidenceRefs.length : 0), 0),
    budgetStrategyCounts,
    actualUsageStatus,
    byStage,
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

export function summarizeEvidenceEvaluatorArm(scenario: EvaluationScenario, runs: LocalAgentRun[], mode: "enabled" | "withheld") {
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

export function summarizeEvidenceEvaluatorPair(scenario: EvaluationScenario, enabled: LocalAgentRun, withheld: LocalAgentRun) {
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

export function summarizeAblationArm(reviewerMode: RecruitmentReviewerMode, runs: LocalAgentRun[]) {
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

export function summarizeInteractionRun(run: LocalAgentRun) {
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

export function summarizeAskPolicyRun(run: LocalAgentRun) {
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

export function summarizeAskPolicyArm(askUserMode: RecruitmentAskUserMode, runs: LocalAgentRun[]) {
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

export function summarizeMethodologyRagRun(run: LocalAgentRun) {
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

export function summarizeMethodologyRagArm(
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

export function summarizeInteractionArm(answerMode: "scripted" | "withheld", runs: LocalAgentRun[]) {
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

export function summarizeInvestigationPlanningRun(run: LocalAgentRun) {
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
    plannerDecisionCount: run.plannerDecisionCount,
    toolCallCount: run.toolCallCount,
    targetTeamContextPreserved: "targetTeamContextPreserved" in run.checks
      && typeof run.checks.targetTeamContextPreserved === "boolean"
      ? run.checks.targetTeamContextPreserved
      : null,
    evaluatedCandidateCount: run.report?.evaluatedCandidateCount ?? null,
    requestedCapabilityCoverage: run.report?.requestedCapabilityCoverage ?? null,
    recommendationCount: run.report?.recommendations.length ?? null,
    methodologyChunksRetrieved: run.report?.methodologyChunksRetrieved ?? null,
    reportGenerated: Boolean(run.report),
  };
}

export function summarizeExpansionSufficiencyRun(run: LocalAgentRun) {
  const decisions = run.trace.filter((event): event is Extract<RecruitmentTraceEvent, { phase: "decision" }> => (
    event.phase === "decision"
  ));
  const expansionDecisions = decisions.filter((event) => event.decisionMode === "expand");
  const deterministicExpansionDecisions = expansionDecisions.filter((event) => (
    event.policyReasonCodes?.includes("evidence_sufficient_for_expansion")
  ));
  const plannerExpansionAttempts = expansionDecisions.filter((event) => (
    !event.policyReasonCodes?.includes("evidence_sufficient_for_expansion")
  ));
  const recommendations = run.report?.recommendations ?? [];
  return {
    run: run.run,
    mode: run.expansionSufficiencyMode,
    allPassed: run.allPassed,
    failedChecks: Object.entries(run.checks).flatMap(([name, passed]) => passed ? [] : [name]),
    elapsedMs: run.elapsedMs,
    modelUsage: run.modelUsage,
    plannerRequestAttempts: run.plannerRequestAttempts,
    decisionCount: run.decisionCount,
    plannerDecisionCount: run.plannerDecisionCount,
    policyDecisionCount: run.policyDecisionCount,
    expansionDecisionCount: expansionDecisions.length,
    modelExpansionAttemptCount: plannerExpansionAttempts.length,
    modelExpansionResponseCount: plannerExpansionAttempts.filter((event) => (
      event.decisionSource === "planner" && event.plannerFallback === undefined
    )).length,
    modelExpansionFallbackCount: plannerExpansionAttempts.filter((event) => event.plannerFallback !== undefined).length,
    deterministicExpansionDecisionCount: deterministicExpansionDecisions.length,
    recommendationCount: recommendations.length,
    recommendationPositions: recommendations.map(({ position }) => position),
    evidenceReferenceCount: recommendations.reduce((count, candidate) => count + candidate.evidenceKeys.length, 0),
    requestedCapabilityCoverage: run.report?.requestedCapabilityCoverage ?? [],
    reportGenerated: Boolean(run.report),
  };
}

export function summarizeExpansionSufficiencyArm(
  mode: "enabled" | "bypassed",
  runs: LocalAgentRun[],
) {
  const runSummaries = runs.map(summarizeExpansionSufficiencyRun);
  const mean = (values: number[]) => values.length
    ? Math.round(values.reduce((total, value) => total + value, 0) / values.length * 100) / 100
    : null;
  return {
    mode,
    summary: summarizeEvaluationRuns(runs.map((run) => ({
      checks: run.checks,
      elapsedMs: run.elapsedMs,
      operationLatencySamples: operationLatencySamplesFromTrace(run.trace),
    }))),
    meanPlannerRequestAttempts: mean(runSummaries.map(({ plannerRequestAttempts }) => plannerRequestAttempts)),
    meanExpansionDecisionCount: mean(runSummaries.map(({ expansionDecisionCount }) => expansionDecisionCount)),
    meanModelExpansionAttemptCount: mean(runSummaries.map(({ modelExpansionAttemptCount }) => modelExpansionAttemptCount)),
    meanModelExpansionResponseCount: mean(runSummaries.map(({ modelExpansionResponseCount }) => modelExpansionResponseCount)),
    meanModelExpansionFallbackCount: mean(runSummaries.map(({ modelExpansionFallbackCount }) => modelExpansionFallbackCount)),
    meanDeterministicExpansionDecisionCount: mean(runSummaries.map(({ deterministicExpansionDecisionCount }) => deterministicExpansionDecisionCount)),
    meanRecommendationCount: mean(runSummaries.map(({ recommendationCount }) => recommendationCount)),
    modelUsage: summarizeModelUsageAcrossRuns(runs.map((run) => run.modelUsage)),
    runs: runSummaries,
  };
}

export function summarizeInvestigationPlanningArm(
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

export function summarizeToolProtocolArm(protocol: "legacy_action" | "native_tools", runs: LocalAgentRun[]) {
  const runSummaries = runs.map(run => ({
    run: run.run,
    protocol: run.plannerProtocol,
    firstTurnStatus: run.firstTurnStatus,
    finalStatus: run.finalStatus,
    allPassed: run.allPassed,
    failedChecks: Object.entries(run.checks).flatMap(([name, passed]) => passed ? [] : [name]),
    elapsedMs: run.elapsedMs,
    plannerRequestAttempts: run.plannerRequestAttempts,
    modelUsage: run.modelUsage,
    toolCallCount: run.toolCallCount,
    recommendationCount: run.report?.recommendations.length ?? 0,
    evidenceReferenceCount: run.report?.recommendations.reduce((count, candidate) => count + candidate.evidenceKeys.length, 0) ?? 0,
    reportGenerated: run.report !== null,
    errors: "errors" in run ? run.errors.map(({ name, category, code, status, stage, plannerResponseDiagnostics }) => ({
      name,
      category,
      code: code ?? null,
      status: status ?? null,
      stage: stage ?? null,
      ...(plannerResponseDiagnostics ? { plannerResponseDiagnostics } : {}),
    })) : [],
    plannerRequestFailures: run.plannerRequestFailures,
  }));
  const mean = (values: number[]) => values.length
    ? Math.round(values.reduce((total, value) => total + value, 0) / values.length * 100) / 100
    : null;
  return {
    protocol,
    summary: summarizeEvaluationRuns(runs.map(run => ({
      checks: run.checks,
      elapsedMs: run.elapsedMs,
      operationLatencySamples: operationLatencySamplesFromTrace(run.trace),
    }))),
    meanPlannerRequestAttempts: mean(runSummaries.map(run => run.plannerRequestAttempts)),
    meanToolCallCount: mean(runSummaries.map(run => run.toolCallCount)),
    modelUsage: summarizeModelUsageAcrossRuns(runs.map(run => run.modelUsage)),
    runs: runSummaries,
  };
}

export function summarizeToolProtocolPair(legacy: LocalAgentRun, native: LocalAgentRun) {
  return {
    run: legacy.run,
    legacyPassed: legacy.allPassed,
    nativePassed: native.allPassed,
    checksIdentical: JSON.stringify(legacy.checks) === JSON.stringify(native.checks),
    firstTurnStatusSame: legacy.firstTurnStatus === native.firstTurnStatus,
    finalStatusSame: legacy.finalStatus === native.finalStatus,
    recommendationOrderSame: sameRecommendationOrder(legacy, native),
    recommendationEvidenceSame: sameRecommendationEvidenceOrder(legacy, native),
    recommendationCount: {
      legacy: legacy.report?.recommendations.length ?? 0,
      native: native.report?.recommendations.length ?? 0,
    },
    plannerRequests: {
      legacy: legacy.plannerRequestAttempts,
      native: native.plannerRequestAttempts,
    },
    toolCalls: {
      legacy: legacy.toolCallCount,
      native: native.toolCallCount,
    },
    elapsedMs: {
      legacy: legacy.elapsedMs,
      native: native.elapsedMs,
    },
  };
}

export function summarizeUnderstatResearchArm(
  strategy: "catalog_only" | "fixed_profile" | "adaptive",
  runs: LocalAgentRun[],
) {
  const runSummaries = runs.map(summarizeInvestigationPlanningRun);
  const mean = (values: number[]) => values.length
    ? Math.round(values.reduce((total, value) => total + value, 0) / values.length * 100) / 100
    : null;
  const detailToolCalls = { inspect_candidate_group: 0, inspect_player: 0, inspect_match: 0 };
  const requestedSectionReads: Record<string, number> = { positions: 0, history: 0, recent: 0, shotProfile: 0, shots: 0 };
  const availableSectionReads: Record<string, number> = { positions: 0, history: 0, recent: 0, shotProfile: 0, shots: 0 };
  const availableSectionPlayerCounts: Record<string, number> = { positions: 0, history: 0, recent: 0, shotProfile: 0, shots: 0 };
  for (const run of runs) {
    for (const event of run.trace) {
      if (event.phase !== "tool") continue;
      if (event.toolName === "inspect_candidate_group" || event.toolName === "inspect_player" || event.toolName === "inspect_match") {
        detailToolCalls[event.toolName] += 1;
      }
      const filters = typeof event.filters === "object" && event.filters !== null
        ? event.filters as Record<string, unknown>
        : {};
      const requested = filters.sections;
      if (Array.isArray(requested)) {
        for (const section of requested) {
          if (typeof section === "string" && Object.hasOwn(requestedSectionReads, section)) requestedSectionReads[section]! += 1;
        }
      }
      const available = filters.availableSections;
      if (Array.isArray(available)) {
        for (const section of available) {
          if (typeof section === "string" && Object.hasOwn(availableSectionReads, section)) availableSectionReads[section]! += 1;
        }
      }
      const availableCounts = filters.availableSectionCounts;
      if (Array.isArray(availableCounts)) {
        for (const countText of availableCounts) {
          if (typeof countText !== "string") continue;
          const match = /^(positions|history|recent|shotProfile|shots)=(\d+)\/\d+$/.exec(countText);
          if (match) availableSectionPlayerCounts[match[1]]! += Number(match[2]);
        }
      } else if (event.toolName === "inspect_player" && Array.isArray(available)) {
        for (const section of available) {
          if (typeof section === "string" && Object.hasOwn(availableSectionPlayerCounts, section)) availableSectionPlayerCounts[section]! += 1;
        }
      }
    }
  }
  return {
    strategy,
    summary: summarizeEvaluationRuns(runs.map((run) => ({
      checks: run.checks,
      elapsedMs: run.elapsedMs,
      operationLatencySamples: operationLatencySamplesFromTrace(run.trace),
    }))),
    meanPlannerRequestAttempts: mean(runSummaries.map(({ plannerRequestAttempts }) => plannerRequestAttempts)),
    modelUsage: summarizeModelUsageAcrossRuns(runs.map((run) => run.modelUsage)),
    meanToolCallCount: mean(runSummaries.map(({ toolCallCount }) => toolCallCount)),
    detailToolCalls,
    requestedSectionReads,
    availableSectionReads,
    availableSectionPlayerCounts,
    actualDetailActions: runs.map((run) => run.trace.flatMap((event) => {
      if (event.phase !== "tool" || typeof event.toolName !== "string"
        || !["inspect_candidate_group", "inspect_player", "inspect_match"].includes(event.toolName)) return [];
      const filters = typeof event.filters === "object" && event.filters !== null
        ? event.filters as Record<string, unknown>
        : {};
      return [{
        tool: event.toolName,
        succeeded: event.ok === true,
        requestedSections: Array.isArray(filters.sections) ? filters.sections.filter((value): value is string => typeof value === "string") : [],
        availableSections: Array.isArray(filters.availableSections) ? filters.availableSections.filter((value): value is string => typeof value === "string") : [],
        availableSectionCounts: Array.isArray(filters.availableSectionCounts)
          ? filters.availableSectionCounts.filter((value): value is string => typeof value === "string")
          : [],
      }];
    })),
    targetTeamContextPreservedRuns: runSummaries.map(({ run, targetTeamContextPreserved }) => ({ run, preserved: targetTeamContextPreserved })),
    runs: runSummaries,
  };
}

export function sameRecommendationOrder(left: LocalAgentRun, right: LocalAgentRun): boolean | null {
  if (!left.report || !right.report) return null;
  return JSON.stringify(left.report.recommendations.map(({ playerId }) => playerId))
    === JSON.stringify(right.report.recommendations.map(({ playerId }) => playerId));
}

export function sameRecommendationEvidenceOrder(left: LocalAgentRun, right: LocalAgentRun): boolean | null {
  if (!left.report || !right.report) return null;
  return JSON.stringify(left.report.recommendations.map(({ evidenceKeys }) => evidenceKeys))
    === JSON.stringify(right.report.recommendations.map(({ evidenceKeys }) => evidenceKeys));
}
