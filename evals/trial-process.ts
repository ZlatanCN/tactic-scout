import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod/v4";

import type { PreparedEvaluationCase } from "./benchmark.js";
import type { evaluationCaseSchema } from "./contracts.js";
import {
  evaluationWorkerRequestSchema,
  workerTrialResultSchema,
} from "./contracts.js";

type EvaluationCase = z.output<typeof evaluationCaseSchema>;

type WorkerTrialResult = z.output<typeof workerTrialResultSchema>;

type RunIsolatedTrialOptions = {
  apiFootball: PreparedEvaluationCase["apiFootball"];
  databasePaths: NonNullable<PreparedEvaluationCase["databasePaths"]>;
  proxyBaseUrl: string;
  runId: string;
  runIndex: number;
  signal?: AbortSignal;
  trialDirectory: string;
  caseDefinition: EvaluationCase;
};

type IsolatedTrialResult = {
  result: WorkerTrialResult;
  runtimeError: string | null;
};

const workerPath = fileURLToPath(new URL("trial-worker.ts", import.meta.url));
const projectRoot = path.resolve(path.dirname(workerPath), "..");

const emptyWorkerResult = (error: string): WorkerTrialResult => ({
  actionEvents: [],
  activeLookupResult: null,
  activeResults: {
    comparison: null,
    lookup: null,
    playerRecommendation: null,
    teamRecommendation: null,
  },
  conversationContext: [],
  deliveredEvidence: [],
  driverIssue: null,
  error,
  failureCategory: null,
  identityLookupEvents: [],
  outcomeKind: null,
  outcomeStatus: null,
  players: [],
  requestKind: null,
  teamRosterCoverage: null,
  toolMessages: [],
  turns: [],
});

const runIsolatedTrial = async (
  options: RunIsolatedTrialOptions
): Promise<IsolatedTrialResult> => {
  mkdirSync(options.trialDirectory, { recursive: true });

  const resultPath = path.join(options.trialDirectory, "worker-result.json");
  const requestPath = path.join(options.trialDirectory, "worker-request.json");

  const request = evaluationWorkerRequestSchema.parse({
    apiFootball: options.apiFootball,
    caseId: options.caseDefinition.caseId,
    caseOrigin: options.caseDefinition.origin,
    databasePaths: options.databasePaths,
    declaredTurnFaults: options.caseDefinition.declaredTurnFaults,
    maxClarificationsPerTurn: Math.max(
      1,
      ...options.caseDefinition.turns.map(
        ({ clarificationAnswers, clarificationAlternatives }) =>
          Math.max(
            clarificationAnswers.length,
            ...clarificationAlternatives.map((answerPath) => answerPath.length)
          )
      )
    ),
    resultPath,
    runId: options.runId,
    threadId: `${options.runId}-${options.caseDefinition.caseId}-${
      options.runIndex
    }`,
    trialId: `${options.caseDefinition.caseId}-trial-${options.runIndex}-${options.runId}`,
    turnIds: options.caseDefinition.turns.map(({ turnId }) => turnId),
    turns: options.caseDefinition.turns,
  });

  writeFileSync(requestPath, JSON.stringify(request), { mode: 0o600 });

  const child = spawn(process.execPath, ["--import", "tsx", workerPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      OPENAI_BASE_URL: options.proxyBaseUrl,
      TACTISCOUT_EVAL_WORKER_REQUEST: requestPath,
      TACTISCOUT_FM_PROFILES_PATH: options.databasePaths.fm,
      TACTISCOUT_REEP_IDENTITY_DB_PATH: options.databasePaths.identity,
      TACTISCOUT_UNDERSTAT_DB_PATH: options.databasePaths.understat,
    },
    stdio: "ignore",
  });

  const abortChild = () => {
    child.kill("SIGTERM");
  };

  options.signal?.addEventListener("abort", abortChild, { once: true });

  if (options.signal?.aborted === true) {
    abortChild();
  }

  let exitEvent: unknown;

  try {
    exitEvent = await once(child, "exit");
  } catch {
    options.signal?.removeEventListener("abort", abortChild);

    return {
      result: emptyWorkerResult("worker_start_failed"),
      runtimeError: "worker_start_failed",
    };
  }

  options.signal?.removeEventListener("abort", abortChild);

  const parsedExit = z
    .tuple([z.number().nullable(), z.string().nullable()])
    .safeParse(exitEvent);

  if (!parsedExit.success) {
    return {
      result: emptyWorkerResult("worker_exit_event_invalid"),
      runtimeError: "worker_exit_event_invalid",
    };
  }

  const [exitCode, exitSignal] = parsedExit.data;
  let workerData: unknown;

  try {
    workerData = JSON.parse(readFileSync(resultPath, "utf-8"));
  } catch {
    let error = "worker_signaled";

    if (options.signal?.aborted === true) {
      error = "evaluation_cancelled";
    } else if (exitSignal === null) {
      error = "worker_result_missing";
    }

    return { result: emptyWorkerResult(error), runtimeError: error };
  }

  const parsedResult = workerTrialResultSchema.safeParse(workerData);

  if (!parsedResult.success) {
    return {
      result: emptyWorkerResult("worker_result_invalid"),
      runtimeError: "worker_result_invalid",
    };
  }

  if (exitCode !== 0) {
    return {
      result: {
        ...parsedResult.data,
        error: parsedResult.data.error ?? "worker_failed",
      },
      runtimeError: "worker_failed",
    };
  }

  return { result: parsedResult.data, runtimeError: null };
};

export { runIsolatedTrial };

export type { IsolatedTrialResult, RunIsolatedTrialOptions };
