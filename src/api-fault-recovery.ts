import {
  logFaultEvent,
  maxExternalRequests,
  maxRateLimitWaitMs,
} from "./fault-tolerance.js";
import type { FaultExecutionContext } from "./fault-tolerance.js";
import type { AgentStateType, FaultToleranceState } from "./state.js";
import { apiFootballFailureCategory } from "./team-data/api-football.js";
import type { ApiFootballFailure } from "./team-data/api-football.js";

type ApiFootballOperation = "team_search" | "team_roster";

type ApiFailureNode = "resolve_team" | "fetch_team_roster";

type ApiFailureTransitionInput = {
  faultTolerance: FaultToleranceState;
  node: ApiFailureNode;
  operation: ApiFootballOperation;
  requestsUsed: number;
  result: ApiFootballFailure;
  runtime: FaultExecutionContext;
};

const terminalApiFailure = (
  input: ApiFailureTransitionInput
): Partial<AgentStateType> => {
  const { node, requestsUsed, result, runtime } = input;

  logFaultEvent({
    attempt: requestsUsed,
    category: apiFootballFailureCategory(result.reason),
    durationMs: result.durationMs ?? 0,
    event: "exhausted",
    node,
    runId: runtime.executionInfo?.runId,
    threadId: runtime.executionInfo?.threadId,
  });

  return {
    outcome: {
      kind: "team_recommendation",
      resultJson: JSON.stringify(result),
      status: "team_provider_error",
    },
  };
};

const createApiFailureTransition = (
  input: ApiFailureTransitionInput
): Partial<AgentStateType> => {
  const { faultTolerance, node, operation, requestsUsed, result, runtime } =
    input;

  const wait = result.retryAfterMs;

  if (result.reason !== "rate_limit") {
    return terminalApiFailure(input);
  }

  if (faultTolerance.apiRateLimitRetried || wait === undefined) {
    return terminalApiFailure(input);
  }

  if (wait > maxRateLimitWaitMs || requestsUsed >= maxExternalRequests) {
    return terminalApiFailure(input);
  }

  logFaultEvent({
    attempt: requestsUsed,
    category: "rate_limit",
    durationMs: result.durationMs ?? 0,
    event: "rate_limit_retry",
    node,
    runId: runtime.executionInfo?.runId,
    threadId: runtime.executionInfo?.threadId,
  });

  return {
    faultTolerance: {
      ...faultTolerance,
      apiOperation: operation,
      apiRateLimitRetried: true,
      apiRequestsUsed: requestsUsed,
      apiRetryAfterMs: wait,
    },
    outcome: null,
  };
};

export { createApiFailureTransition };
