import type { GraphNode } from "@langchain/langgraph";

import {
  logFaultEvent,
  maxExternalRequests,
  maxRateLimitWaitMs,
} from "../fault-tolerance.js";
import type { FaultExecutionContext } from "../fault-tolerance.js";
import type { AgentState, AgentStateType } from "../state.js";
import { apiFootballFailureCategory } from "../team-data/api-football.js";
import type {
  ApiFootballClient,
  ApiFootballFailure,
  ApiFootballRosterPlayer,
} from "../team-data/api-football.js";
import type { TeamRosterSnapshot } from "../team-data/contracts.js";

const rosterMemberFromProvider = (
  player: ApiFootballRosterPlayer
): TeamRosterSnapshot["members"][number] => ({
  apiFootballPlayerId: player.id,
  fmCandidates: [],
  fmId: null,
  mappingMethod: null,
  mappingStatus: "pending",
  name: player.name,
  position: player.position,
});

const rosterProviderFailure = (
  result: ApiFootballFailure,
  requestsUsed: number,
  runtime: FaultExecutionContext
): Partial<AgentStateType> => {
  logFaultEvent({
    attempt: requestsUsed,
    category: apiFootballFailureCategory(result.reason),
    durationMs: result.durationMs,
    event: "exhausted",
    node: "fetch_team_roster",
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

const handleRosterFetchFailure = (
  state: AgentStateType,
  result: ApiFootballFailure,
  requestsUsed: number,
  runtime: FaultExecutionContext
): Partial<AgentStateType> => {
  const wait = result.retryAfterMs;

  if (result.reason !== "rate_limit") {
    return rosterProviderFailure(result, requestsUsed, runtime);
  }

  if (state.faultTolerance.apiRateLimitRetried || wait === undefined) {
    return rosterProviderFailure(result, requestsUsed, runtime);
  }

  if (wait > maxRateLimitWaitMs || requestsUsed >= maxExternalRequests) {
    return rosterProviderFailure(result, requestsUsed, runtime);
  }

  logFaultEvent({
    attempt: requestsUsed,
    category: "rate_limit",
    durationMs: result.durationMs,
    event: "rate_limit_retry",
    node: "fetch_team_roster",
    runId: runtime.executionInfo?.runId,
    threadId: runtime.executionInfo?.threadId,
  });

  return {
    faultTolerance: {
      ...state.faultTolerance,
      apiOperation: "team_roster",
      apiRateLimitRetried: true,
      apiRequestsUsed: requestsUsed,
      apiRetryAfterMs: wait,
    },
    outcome: null,
  };
};

const createFetchTeamRosterNode =
  (getSquad: ApiFootballClient["getSquad"]): GraphNode<typeof AgentState> =>
  async (state, runtime) => {
    const { request } = state;

    if (request.kind !== "team_recommendation") {
      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: null,
          status: "invalid_task_state",
        },
      };
    }

    const recommendation = request.teamRecommendation;

    if (recommendation.team === null || recommendation.position === null) {
      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: null,
          status: "invalid_task_state",
        },
      };
    }

    if (recommendation.roster !== null) {
      return {};
    }

    const requestsBefore =
      state.faultTolerance.apiOperation === "team_roster"
        ? state.faultTolerance.apiRequestsUsed
        : 0;

    const attempt = runtime.executionInfo?.nodeAttempt ?? 1;

    const result = await getSquad(recommendation.team.id, {
      attempt,
      node: "fetch_team_roster",
      requestsBefore,
      runId: runtime.executionInfo?.runId,
      signal: runtime.signal,
      threadId: runtime.executionInfo?.threadId,
    });

    if (result.status === "error") {
      return handleRosterFetchFailure(
        state,
        result,
        result.requestsUsed ?? requestsBefore + attempt,
        runtime
      );
    }

    if (result.data.players.length === 0) {
      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: JSON.stringify({ team: recommendation.team }),
          status: "team_roster_empty",
        },
      };
    }

    const requestsUsed =
      result.cached === true
        ? requestsBefore + Math.max(0, attempt - 1)
        : requestsBefore + attempt;

    const roster = {
      members: result.data.players.map(rosterMemberFromProvider),
      retrievedAt: result.data.retrievedAt,
      team: result.data.team,
    };

    return {
      faultTolerance: {
        ...state.faultTolerance,
        apiOperation: "team_roster",
        apiRequestsUsed: requestsUsed,
        apiRetryAfterMs: null,
      },
      request: {
        ...request,
        teamRecommendation: { ...recommendation, roster },
      },
    };
  };

export { createFetchTeamRosterNode };
