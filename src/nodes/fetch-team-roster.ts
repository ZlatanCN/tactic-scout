import type { GraphNode } from "@langchain/langgraph";

import { createApiFailureTransition } from "../api-fault-recovery.js";
import type { AgentState } from "../state.js";
import type {
  ApiFootballClient,
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
      return createApiFailureTransition({
        faultTolerance: state.faultTolerance,
        node: "fetch_team_roster",
        operation: "team_roster",
        requestsUsed: result.requestsUsed ?? requestsBefore + attempt,
        result,
        runtime,
      });
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
