import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLocalKnowledgeBase } from "../../src/knowledge/index.js";
import { localAgentEvaluationScenarios } from "../../src/evaluation/harness-scenarios.js";
import { runScenarioOnce } from "../../src/evaluation/local-agent-run.js";

const scenario = localAgentEvaluationScenarios.find(({ id }) => id === "barcelona-under-23-midfielder");
if (!scenario) throw new Error("Missing registered context-management scenario.");

const result = await runScenarioOnce(scenario, 1, createLocalKnowledgeBase(), {
  contextManagementMode: "summarized",
  contextStressTurns: 8,
  suppressTraceOutput: true,
  suppressProgressOutput: true,
});

const contextRequests = result.trace.flatMap((event) => {
  if (!event || typeof event !== "object" || !("contextManifest" in event)) return [];
  const manifest = event.contextManifest;
  if (!manifest || typeof manifest !== "object" || !("stage" in manifest)) return [];
  return [manifest as {
    stage: string;
    estimatedInputTokens: number;
    actualTokenUsage?: { inputTokens?: number | null; status?: string };
  }];
});

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

const byStage = Object.fromEntries([...new Set(contextRequests.map(({ stage }) => stage))].sort().map((stage) => {
  const requests = contextRequests.filter((request) => request.stage === stage);
  const ratios = requests.flatMap((request) => {
    const actual = request.actualTokenUsage?.inputTokens;
    return typeof actual === "number" && request.estimatedInputTokens > 0
      ? [actual / request.estimatedInputTokens]
      : [];
  });
  const estimated = requests.reduce((sum, request) => sum + request.estimatedInputTokens, 0);
  const actual = requests.reduce((sum, request) => sum + (request.actualTokenUsage?.inputTokens ?? 0), 0);
  return [stage, {
    requestCount: requests.length,
    requestsWithActualUsage: ratios.length,
    estimatedInputTokens: estimated,
    actualInputTokens: ratios.length === requests.length ? actual : null,
    actualOverEstimateP50: percentile(ratios, 0.5),
    actualOverEstimateP95: percentile(ratios, 0.95),
    maximumActualOverEstimate: ratios.length ? Math.max(...ratios) : null,
  }];
}));

const failedStressTurns = result.contextStressTurnMatrix
  .filter((turn) => !turn.allPassed)
  .map((turn) => ({
    turn: turn.turn,
    failedChecks: Object.entries(turn.checks).filter(([, passed]) => !passed).map(([check]) => check),
  }));
const failedChecks = Object.entries(result.checks).filter(([, passed]) => !passed).map(([check]) => check);
const traceByTurn = result.trace.flatMap((event) => {
  if (!event || typeof event !== "object" || !("turn" in event) || typeof event.turn !== "number") return [];
  if (event.phase === "decision") return [{
    turn: event.turn,
    phase: event.phase,
    action: event.action ?? null,
    proposedAction: event.proposedAction ?? null,
    decisionSource: event.decisionSource ?? null,
    decisionMode: event.decisionMode ?? null,
    policyBlocked: event.policyBlocked ?? false,
    policyReasonCodes: event.policyReasonCodes ?? [],
    plannerFallback: event.plannerFallback ?? null,
  }];
  if (event.phase === "tool") {
    const filters = event.filters && typeof event.filters === "object"
      ? event.filters as Record<string, unknown>
      : {};
    const safeFilterKeys = [
      "position", "positions", "maxAge", "minimumMinutes", "competition", "season", "discoveryMetricGroups", "caseSearchObservationCount", "currentTurnObservationStartIndex", "candidateSearchScopeChanged", "priorMatchingSearchFound", "priorMatchingNextOffset", "offset", "nextOffset", "limit",
      "requestedOffset", "effectiveOffset", "playerNameFilterUsed", "requestedPlayerCount", "searchedPlayerCount",
    ];
    return [{
      turn: event.turn,
      phase: event.phase,
      toolName: event.toolName,
      ok: event.ok,
      errorCode: event.errorCode ?? null,
      resultCount: event.resultCount ?? null,
      matchingRecordCount: event.matchingRecordCount ?? null,
      filters: Object.fromEntries(safeFilterKeys.flatMap((key) => Object.hasOwn(filters, key) ? [[key, filters[key]]] : [])),
    }];
  }
  return [];
});
const modelRequestPhases = new Set(["model_usage", "brief_usage", "identity_usage", "summary_usage"]);
const modelRequestOutcomes = result.trace.flatMap((event) => modelRequestPhases.has(String(event.phase)) ? [{
  phase: event.phase,
  turn: typeof event.turn === "number" ? event.turn : null,
  callPhase: event.callPhase ?? null,
  outcome: event.outcome ?? null,
  contextStatus: event.contextStatus ?? null,
  estimatedInputTokens: event.estimatedInputTokens ?? null,
  inputBudgetTokens: event.inputBudgetTokens ?? null,
  inputTokens: event.inputTokens ?? null,
  outputTokens: event.outputTokens ?? null,
  budgetStrategy: event.contextManifest && typeof event.contextManifest === "object"
    ? (event.contextManifest as Record<string, unknown>).budgetStrategy ?? null
    : null,
}] : []);
const briefFailures = result.trace.flatMap((event) => event.phase === "brief_failure" ? [{
  turn: typeof event.turn === "number" ? event.turn : null,
  failureKind: event.failureKind,
  failureCode: event.failureCode ?? null,
  failureStatus: event.failureStatus ?? null,
  validationCode: event.validationCode ?? null,
  outputLimitTokens: event.outputLimitTokens ?? null,
}] : []);
const summary = {
  experiment: "context-management-summary-runtime-probe",
  model: process.env.OPENAI_MODEL ?? null,
  scenario: scenario.id,
  contextMode: result.contextManagementMode,
  firstTurnStatus: result.firstTurnStatus,
  finalStatus: result.finalStatus,
  allPassed: result.allPassed,
  modelRunValidForCalibration: result.modelUsage.requestCount > 0
    && result.modelUsage.failedRequestCount === 0
    && result.modelUsage.responseCount === result.modelUsage.requestCount,
  failedModelRequestCount: result.modelUsage.failedRequestCount,
  failedChecks,
  errors: "errors" in result ? result.errors.map((error) => ({
    name: error.name,
    category: error.category,
    code: error.code,
    status: error.status,
    stage: error.stage,
    estimatedInputTokens: error.estimatedInputTokens,
    inputBudgetTokens: error.inputBudgetTokens,
    validationIssuePaths: error.validationIssuePaths,
    validationIssueCodes: error.validationIssueCodes,
    plannerResponseDiagnostics: error.plannerResponseDiagnostics ? {
      failure: error.plannerResponseDiagnostics.failure,
      toolCallProtocolFailure: error.plannerResponseDiagnostics.toolCallProtocolFailure,
      toolCallIssuePaths: error.plannerResponseDiagnostics.toolCallIssuePaths,
      toolCallIssueCodes: error.plannerResponseDiagnostics.toolCallIssueCodes,
    } : undefined,
  })) : [],
  plannerRequestFailures: result.plannerRequestFailures,
  contextStressTurnsRequested: result.contextStressTurnsRequested,
  contextStressTurnsAttempted: result.contextStressTurnsAttempted,
  contextStressTurnsCompleted: result.contextStressTurnsCompleted,
  failedStressTurns,
  traceByTurn,
  modelRequestOutcomes,
  plannerProtocolRetryRequests: modelRequestOutcomes.filter(({ budgetStrategy }) => budgetStrategy === "planner_protocol_retry").length,
  briefFailures,
  summaryRequests: result.trace.filter((event) => event.phase === "summary_usage").length,
  acceptedSummaries: result.progress.filter((event) => event.stage === "context_compaction" && event.status === "completed").length,
  modelUsage: result.modelUsage,
  elapsedMs: result.elapsedMs,
  byStage,
};

const outputPath = path.resolve(".data/evaluations/context-management-summary-runtime-luna-current-20261020-v22.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ ...summary, artifact: outputPath })}\n`);
