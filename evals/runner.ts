import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { z } from "zod/v4";

import { assertModelProcessingAllowed } from "../src/player-data/shared.js";
import {
  estimateModelRequests,
  loadEvaluationCases,
  prepareEvaluationCases,
} from "./benchmark.js";
import type {
  EvaluationMode,
  LoadedEvaluationCase,
  PreparedEvaluationCase,
} from "./benchmark.js";
import {
  makePreflightFailureTrial,
  makeTrialReport,
  makeUnrunTrial,
} from "./checks.js";
import { evaluationReportSchema } from "./contracts.js";
import type {
  EvaluationCase,
  EvaluationReport,
  EvaluationTrialReport,
} from "./contracts.js";
import { createEvaluationGatewayProxy } from "./gateway-proxy.js";
import type { EvaluationGatewayRole } from "./gateway-proxy.js";
import {
  createSemanticJudge,
  judgeInputForTrial,
  runJudgeCalibration,
  validateTrialJudgment,
} from "./judge.js";
import { writeEvaluationReport } from "./report.js";
import { captureRunIdentity } from "./run-identity.js";
import { runIsolatedTrial } from "./trial-process.js";

type RunEvaluationOptions = {
  anchorDirectory?: string;
  caseDirectory?: string;
  caseIds: string[];
  evidenceDirectory?: string;
  freezeId?: string;
  includeSemanticJudge?: boolean;
  maxModelRequests: number;
  mode: EvaluationMode;
  outputDirectory: string;
  signal?: AbortSignal;
  workspaceDirectory: string;
};

type GatewaySettings = {
  apiKey: string;
  baseUrl: string;
  model: string;
  origin: string;
};

type EvaluationJob = {
  prepared: PreparedEvaluationCase;
  runIndex: number;
};

type EvaluationRunContext = {
  gateway: Awaited<ReturnType<typeof createEvaluationGatewayProxy>> | null;
  options: RunEvaluationOptions;
  persistReport: () => void;
  report: EvaluationReport;
  runId: string;
  workspaceDirectory: string;
};

const roleLedgerFromGateway = (
  role: EvaluationGatewayRole,
  gateway: EvaluationRunContext["gateway"]
): EvaluationReport["tokenUsageByRole"]["agent"] => {
  const dispatchedRequests = gateway?.requestsByRole()[role] ?? 0;
  const deniedRequests = gateway?.deniedRequestsByRole()[role] ?? 0;

  const exchanges =
    gateway
      ?.exchanges()
      .filter((exchange) => exchange.forwarded && exchange.role === role) ?? [];

  const modelIds = new Set<string>();
  let responsesWithUsage = 0;
  let promptTokensReported = 0;
  let completionTokensReported = 0;
  let totalTokensReported = 0;

  for (const exchange of exchanges) {
    if (exchange.model !== null) {
      modelIds.add(exchange.model);
    }

    if (exchange.tokenUsage === null) {
      continue;
    }

    responsesWithUsage += 1;
    promptTokensReported += exchange.tokenUsage.promptTokens;
    completionTokensReported += exchange.tokenUsage.completionTokens;
    totalTokensReported += exchange.tokenUsage.totalTokens;
  }

  return {
    completionTokensReported:
      responsesWithUsage > 0 ? completionTokensReported : null,
    deniedRequests,
    dispatchedRequests,
    modelIds: [...modelIds].toSorted(),
    promptTokensReported: responsesWithUsage > 0 ? promptTokensReported : null,
    responsesWithUsage,
    responsesWithoutUsage: Math.max(0, dispatchedRequests - responsesWithUsage),
    totalTokensReported: responsesWithUsage > 0 ? totalTokensReported : null,
  };
};

const updateGatewayLedger = (
  report: EvaluationReport,
  gateway: EvaluationRunContext["gateway"]
): void => {
  report.requestCountsByRole = {
    agent: gateway?.requestsByRole().agent ?? 0,
    calibration: gateway?.requestsByRole().calibration ?? 0,
    judge: gateway?.requestsByRole().judge ?? 0,
  };
  report.deniedRequestsByRole = {
    agent: gateway?.deniedRequestsByRole().agent ?? 0,
    calibration: gateway?.deniedRequestsByRole().calibration ?? 0,
    judge: gateway?.deniedRequestsByRole().judge ?? 0,
  };
  report.tokenUsageByRole = {
    agent: roleLedgerFromGateway("agent", gateway),
    calibration: roleLedgerFromGateway("calibration", gateway),
    judge: roleLedgerFromGateway("judge", gateway),
  };
};

const signalIsAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

const freezeIdForCases = (
  cases: LoadedEvaluationCase[],
  configuredFreezeId: string | undefined
): string | null => {
  const freezeId = configuredFreezeId?.trim() ?? "";

  const includesHeldOut = cases.some(
    ({ caseDefinition }) => caseDefinition.split === "held_out"
  );

  if (includesHeldOut && freezeId.length === 0) {
    throw new Error(
      "Held-out cases require a reviewed freeze ID. Use --freeze-id after fixing the evaluated version and scoring rules."
    );
  }

  return freezeId.length > 0 ? freezeId : null;
};

const gatewaySettings = (): GatewaySettings => {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const model = process.env.OPENAI_MODEL?.trim() ?? "";
  const configuredUrl = process.env.OPENAI_BASE_URL?.trim();

  const baseUrl =
    configuredUrl === undefined || configuredUrl.length === 0
      ? "https://api.openai.com/v1"
      : configuredUrl;

  if (apiKey.length === 0 || model.length === 0) {
    throw new Error("OPENAI_API_KEY and OPENAI_MODEL must be configured.");
  }

  assertModelProcessingAllowed("both");

  try {
    const url = new URL(baseUrl);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      throw new Error("invalid_gateway_url");
    }

    return { apiKey, baseUrl, model, origin: url.origin };
  } catch {
    throw new Error("OPENAI_BASE_URL must be a valid HTTP or HTTPS URL.");
  }
};

const runOneTrial = async (
  job: EvaluationJob,
  context: EvaluationRunContext
): Promise<EvaluationTrialReport> => {
  const { prepared, runIndex } = job;

  if (prepared.preflightError !== null || prepared.databasePaths === null) {
    return makePreflightFailureTrial(
      prepared,
      runIndex,
      prepared.preflightError ?? "The evidence bundle is unavailable."
    );
  }

  if (context.options.signal?.aborted === true) {
    return makeUnrunTrial(prepared, runIndex);
  }

  if (context.gateway === null) {
    return makePreflightFailureTrial(
      prepared,
      runIndex,
      "A configured model gateway is unavailable."
    );
  }

  const trialDirectory = path.join(
    context.workspaceDirectory,
    "trials",
    `${prepared.caseDefinition.caseId}-${runIndex}`
  );

  const requestsBefore = context.gateway.modelRequests();
  const deniedBefore = context.gateway.deniedRequests();
  const failuresBefore = context.gateway.failedRequests();
  const exchangesBefore = context.gateway.exchanges().length;

  const execution = await runIsolatedTrial({
    apiFootball: prepared.apiFootball,
    caseDefinition: prepared.caseDefinition,
    databasePaths: prepared.databasePaths,
    proxyBaseUrl: context.gateway.baseUrlForRole("agent"),
    runId: context.runId,
    runIndex,
    signal: context.options.signal,
    trialDirectory,
  });

  const workerResult =
    execution.runtimeError === null
      ? execution.result
      : { ...execution.result, error: execution.runtimeError };

  return makeTrialReport(
    prepared,
    runIndex,
    workerResult,
    context.gateway.exchanges().slice(exchangesBefore),
    context.gateway.modelRequests() - requestsBefore,
    context.gateway.deniedRequests() - deniedBefore,
    context.gateway.failedRequests() - failuresBefore
  );
};

const trialStatusAfterJudge = (
  trial: EvaluationTrialReport,
  status: EvaluationTrialReport["semanticStatus"]
): EvaluationTrialReport["status"] => {
  if (status === "failed" || trial.codeStatus === "failed") {
    return "failed";
  }

  if (["budget_exhausted", "runtime_error"].includes(trial.status)) {
    return trial.status;
  }

  if (status === "passed") {
    return "passed";
  }

  if (status === "inconclusive") {
    return "inconclusive";
  }

  return "judge_invalid";
};

const applyJudgeToTrial = async (
  trial: EvaluationTrialReport,
  caseDefinition: EvaluationCase,
  judge: ReturnType<typeof createSemanticJudge>,
  gateway: EvaluationRunContext["gateway"]
): Promise<EvaluationTrialReport> => {
  const hasVisibleResponse = trial.observation.turns.some(
    ({ assistantMessages }) => assistantMessages.length > 0
  );

  if (gateway === null || !hasVisibleResponse) {
    return trial;
  }

  const requestsBefore = gateway.modelRequests();
  const deniedBefore = gateway.deniedRequests();
  const exchangeIndex = gateway.exchanges().length;

  try {
    const output = await judge(
      judgeInputForTrial(caseDefinition, trial.observation)
    );

    const validation = validateTrialJudgment(
      caseDefinition,
      trial.observation,
      output
    );

    const judgeRequests = gateway.modelRequests() - requestsBefore;
    const addedExchanges = gateway.exchanges().slice(exchangeIndex);

    return {
      ...trial,
      gatewayExchanges: [...trial.gatewayExchanges, ...addedExchanges],
      modelRequests: trial.modelRequests + judgeRequests,
      modelRequestsByRole: {
        ...trial.modelRequestsByRole,
        judge: judgeRequests,
      },
      semanticFindings: validation.findings,
      semanticRequiredFactCoverage: validation.requiredFactCoverage,
      semanticStatus: validation.status,
      semanticValidationErrors: validation.validationErrors,
      status: trialStatusAfterJudge(trial, validation.status),
    };
  } catch (error) {
    const judgeRequests = gateway.modelRequests() - requestsBefore;
    const deniedRequests = gateway.deniedRequests() - deniedBefore;
    const denied = deniedRequests > 0;
    let status = trialStatusAfterJudge(trial, "invalid");

    if (denied && trial.codeStatus !== "failed") {
      status = "budget_exhausted";
    }

    return {
      ...trial,
      gatewayExchanges: [
        ...trial.gatewayExchanges,
        ...gateway.exchanges().slice(exchangeIndex),
      ],
      modelRequests: trial.modelRequests + judgeRequests,
      modelRequestsByRole: {
        ...trial.modelRequestsByRole,
        judge: judgeRequests,
      },
      semanticFindings: [],
      semanticRequiredFactCoverage: [],
      semanticStatus: "invalid",
      semanticValidationErrors: [
        error instanceof Error
          ? `${error.name}:${error.message}`
          : "judge_error",
      ],
      status,
    };
  }
};

const scoreTrialsInOrder = async (
  report: EvaluationReport,
  cases: LoadedEvaluationCase[],
  judge: ReturnType<typeof createSemanticJudge>,
  gateway: EvaluationRunContext["gateway"],
  persistReport: () => void,
  index = 0
): Promise<void> => {
  const trial = report.trials[index];

  if (trial === undefined || gateway === null) {
    return;
  }

  const loadedCase = cases.find(
    ({ caseDefinition }) => caseDefinition.caseId === trial.caseId
  );

  if (loadedCase === undefined) {
    report.preflightErrors.push(`JudgeCaseNotFound:${trial.caseId}`);
    persistReport();

    await scoreTrialsInOrder(
      report,
      cases,
      judge,
      gateway,
      persistReport,
      index + 1
    );

    return;
  }

  if (gateway.modelRequests() >= report.maxModelRequests) {
    report.status = "partial";
    persistReport();

    return;
  }

  const scoredTrial = await applyJudgeToTrial(
    trial,
    loadedCase.caseDefinition,
    judge,
    gateway
  );

  report.trials[index] = scoredTrial;
  report.modelRequests = gateway.modelRequests();
  report.deniedRequests = gateway.deniedRequests();
  report.networkFailures = gateway.failedRequests();
  updateGatewayLedger(report, gateway);
  persistReport();

  if (scoredTrial.status === "budget_exhausted") {
    report.status = "partial";
    persistReport();

    return;
  }

  await scoreTrialsInOrder(
    report,
    cases,
    judge,
    gateway,
    persistReport,
    index + 1
  );
};

const runSemanticEvaluation = async (options: {
  agentModel: string;
  anchorDirectory?: string;
  apiKey: string;
  cases: LoadedEvaluationCase[];
  gateway: EvaluationRunContext["gateway"];
  judgeModel: string;
  maxModelRequests: number;
  persistReport: () => void;
  report: EvaluationReport;
}): Promise<void> => {
  const { gateway } = options;

  if (gateway === null) {
    return;
  }

  const calibrationJudge = createSemanticJudge({
    apiKey: options.apiKey,
    baseUrl: gateway.baseUrlForRole("calibration"),
    model: options.judgeModel,
  });

  const judge = createSemanticJudge({
    apiKey: options.apiKey,
    baseUrl: gateway.baseUrlForRole("judge"),
    model: options.judgeModel,
  });

  options.report.judgeCalibration = await runJudgeCalibration({
    agentModel: options.agentModel,
    anchorDirectory: options.anchorDirectory,
    judge: calibrationJudge,
    judgeModel: options.judgeModel,
  });
  options.report.modelRequests = gateway.modelRequests();
  options.report.deniedRequests = gateway.deniedRequests();
  options.report.networkFailures = gateway.failedRequests();
  updateGatewayLedger(options.report, gateway);
  options.persistReport();

  if (options.report.judgeCalibration.status !== "passed") {
    if (options.report.judgeCalibration.status === "incomplete") {
      options.report.status = "partial";
      options.persistReport();
    }

    return;
  }

  await scoreTrialsInOrder(
    options.report,
    options.cases,
    judge,
    gateway,
    options.persistReport
  );

  if (gateway.modelRequests() > options.maxModelRequests) {
    options.report.status = "partial";
  }

  options.report.modelRequests = gateway.modelRequests();
  options.report.deniedRequests = gateway.deniedRequests();
  options.report.networkFailures = gateway.failedRequests();
  updateGatewayLedger(options.report, gateway);
  options.persistReport();
};

const runRemainingJobs = async (
  jobs: EvaluationJob[],
  index: number,
  context: EvaluationRunContext
): Promise<void> => {
  const job = jobs[index];

  if (job === undefined) {
    return;
  }

  if (context.options.signal?.aborted === true) {
    context.report.trials.push(
      ...jobs
        .slice(index)
        .map(({ prepared, runIndex }) => makeUnrunTrial(prepared, runIndex))
    );
    context.persistReport();

    return;
  }

  const trial = await runOneTrial(job, context);

  context.report.modelRequests += trial.modelRequests;
  context.report.deniedRequests += trial.gatewayExchanges.filter(
    (exchange) => !exchange.forwarded && exchange.responseStatus === 429
  ).length;
  context.report.networkFailures += trial.gatewayExchanges.filter(
    (exchange) => exchange.forwarded && exchange.responseStatus === null
  ).length;
  context.report.trials.push(trial);
  updateGatewayLedger(context.report, context.gateway);
  context.persistReport();

  const mustStop =
    trial.status === "budget_exhausted" ||
    trial.status === "runtime_error" ||
    signalIsAborted(context.options.signal);

  if (mustStop) {
    context.report.trials.push(
      ...jobs
        .slice(index + 1)
        .map(({ prepared, runIndex }) => makeUnrunTrial(prepared, runIndex))
    );
    context.persistReport();

    return;
  }

  await runRemainingJobs(jobs, index + 1, context);
};

const closeProxy = async (
  proxy: Awaited<ReturnType<typeof createEvaluationGatewayProxy>> | null,
  report: EvaluationReport
): Promise<void> => {
  if (proxy === null) {
    return;
  }

  try {
    await proxy.close();
  } catch {
    report.preflightErrors.push("GatewayProxyCloseError");
    report.status = "partial";
  }
};

const runEvaluation = async (
  options: RunEvaluationOptions
): Promise<EvaluationReport> => {
  const maxModelRequests = z
    .number()
    .int()
    .positive()
    .parse(options.maxModelRequests);

  const cases = loadEvaluationCases(
    options.mode,
    options.caseIds,
    options.caseDirectory
  );

  const freezeId = freezeIdForCases(cases, options.freezeId);

  const repetitions = options.mode === "smoke" ? 1 : 3;
  const judgeEnabled = options.includeSemanticJudge === true;
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const outputDirectory = path.resolve(options.outputDirectory, runId);
  const workspaceDirectory = path.resolve(options.workspaceDirectory, runId);
  const runIdentity = captureRunIdentity();

  const report: EvaluationReport = {
    agentModel: null,
    caseCount: cases.length,
    deniedRequests: 0,
    deniedRequestsByRole: { agent: 0, calibration: 0, judge: 0 },
    estimatedModelRequests: estimateModelRequests(
      cases,
      repetitions,
      judgeEnabled
    ),
    finishedAt: null,
    freezeId,
    gatewayOrigin: null,
    judgeCalibration: null,
    judgeEnabled,
    maxModelRequests,
    mode: options.mode,
    modelRequests: 0,
    networkFailures: 0,
    preflightErrors: [],
    requestCountsByRole: { agent: 0, calibration: 0, judge: 0 },
    runId,
    runIdentity,
    startedAt,
    status: "partial",
    tokenUsageByRole: {
      agent: roleLedgerFromGateway("agent", null),
      calibration: roleLedgerFromGateway("calibration", null),
      judge: roleLedgerFromGateway("judge", null),
    },
    trials: [],
  };

  const persistReport = () => {
    writeEvaluationReport(outputDirectory, report);
  };

  mkdirSync(outputDirectory, { recursive: true });
  mkdirSync(workspaceDirectory, { recursive: true });
  persistReport();

  let gateway: Awaited<ReturnType<typeof createEvaluationGatewayProxy>> | null =
    null;

  try {
    const settings = gatewaySettings();

    const preparedCases = prepareEvaluationCases(
      cases,
      workspaceDirectory,
      options.evidenceDirectory
    );

    report.preflightErrors.push(
      ...preparedCases.flatMap((prepared) =>
        prepared.preflightError === null
          ? []
          : [`${prepared.caseDefinition.caseId}:EvidencePreflightError`]
      )
    );

    report.agentModel = settings.model;
    report.gatewayOrigin = settings.origin;

    if (preparedCases.some((prepared) => prepared.databasePaths !== null)) {
      gateway = await createEvaluationGatewayProxy(
        settings.baseUrl,
        maxModelRequests,
        [settings.apiKey, process.env.API_FOOTBALL_KEY ?? ""]
      );
    }

    const jobs = preparedCases.flatMap((prepared) =>
      Array.from({ length: repetitions }, (_, index) => ({
        prepared,
        runIndex: index + 1,
      }))
    );

    const context: EvaluationRunContext = {
      gateway,
      options: { ...options, maxModelRequests },
      persistReport,
      report,
      runId,
      workspaceDirectory,
    };

    await runRemainingJobs(jobs, 0, context);

    if (judgeEnabled && gateway !== null) {
      const configuredJudgeModel =
        process.env.TACTISCOUT_EVAL_JUDGE_MODEL?.trim();

      const judgeModel =
        configuredJudgeModel === undefined || configuredJudgeModel.length === 0
          ? settings.model
          : configuredJudgeModel;

      await runSemanticEvaluation({
        agentModel: settings.model,
        anchorDirectory: options.anchorDirectory,
        apiKey: settings.apiKey,
        cases,
        gateway,
        judgeModel,
        maxModelRequests,
        persistReport,
        report,
      });
    }

    const incompleteTrialStatuses = new Set([
      "budget_exhausted",
      "not_run",
      "preflight_error",
      "runtime_error",
    ]);

    const hasUnfinishedTrials = report.trials.some(({ status }) =>
      incompleteTrialStatuses.has(status)
    );

    const calibrationIncomplete =
      report.judgeCalibration?.status === "incomplete";

    const semanticScoringIncomplete =
      judgeEnabled &&
      (report.judgeCalibration === null ||
        (report.judgeCalibration.status === "passed" &&
          report.trials.some(
            (trial) =>
              trial.semanticStatus === "not_assessed" &&
              trial.status !== "preflight_error" &&
              trial.status !== "not_run"
          )));

    report.status =
      hasUnfinishedTrials || calibrationIncomplete || semanticScoringIncomplete
        ? "partial"
        : "completed";
  } catch (error) {
    report.preflightErrors.push(
      error instanceof Error ? error.name : "UnexpectedFailure"
    );
    report.status = "partial";
  } finally {
    await closeProxy(gateway, report);
    updateGatewayLedger(report, gateway);
  }

  report.finishedAt = new Date().toISOString();
  persistReport();

  return evaluationReportSchema.parse(report);
};

export { runEvaluation };

export type { RunEvaluationOptions };
