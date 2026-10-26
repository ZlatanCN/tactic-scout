import type { GraphNode } from "@langchain/langgraph";

import { createApiFailureTransition } from "../api-fault-recovery.js";
import { supportedPositionCodes } from "../player-data/position-features.js";
import type { AgentState, AgentStateType, RequestState } from "../state.js";
import type {
  ApiFootballClient,
  ApiFootballTeam,
} from "../team-data/api-football.js";

const teamPositionClarification = {
  answer: null,
  kind: "team_position" as const,
  options: supportedPositionCodes,
  question: "请指定一个 FM 位置，例如 stc（中锋）、dc（中卫）或 dm（后腰）。",
};

const normalizeTeamName = (value: string): string =>
  value.normalize("NFKC").trim().toLocaleLowerCase();

const teamSelectionPatch = (
  teams: ApiFootballTeam[],
  teamName: string,
  teamSearchName: string,
  request: Extract<RequestState, { kind: "team_recommendation" }>,
  state: AgentStateType
): Partial<AgentStateType> => {
  if (teams.length === 0) {
    return {
      outcome: {
        kind: "team_recommendation",
        resultJson: JSON.stringify({ teamName }),
        status: "team_not_found",
      },
    };
  }

  if (teams.length > 1) {
    const options = teams
      .map(
        (team, index) =>
          `${index + 1}. ${team.name}（${team.country ?? "国家未知"}）`
      )
      .join("；");

    return {
      pendingClarification: {
        answer: null,
        candidates: teams,
        kind: "team",
        question: `“${teamName}”匹配到多个球队，请按国家选择：${options}`,
      },
    };
  }

  const [team] = teams;

  if (team === undefined) {
    return {
      outcome: {
        kind: "team_recommendation",
        resultJson: null,
        status: "team_not_found",
      },
    };
  }

  if (normalizeTeamName(teamSearchName) !== normalizeTeamName(teamName)) {
    return {
      pendingClarification: {
        answer: null,
        candidates: [team],
        kind: "team",
        question: `我按“${teamName}”搜索到了“${team.name}”（${team.country ?? "国家未知"}）。请回复 1 确认；如果不是，请补充球队全名或国家。`,
      },
    };
  }

  return {
    faultTolerance: {
      ...state.faultTolerance,
      apiOperation: "team_roster",
      apiRateLimitRetried: false,
      apiRequestsUsed: 0,
      apiRetryAfterMs: null,
    },
    request: {
      ...request,
      teamRecommendation: {
        ...request.teamRecommendation,
        team,
        teamName: team.name,
      },
    },
  };
};

const createResolveTeamNode =
  (
    searchTeams: ApiFootballClient["searchTeams"]
  ): GraphNode<typeof AgentState> =>
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

    if (request.teamRecommendation.team !== null) {
      return {};
    }

    const teamName = request.teamRecommendation.teamName?.trim() ?? "";

    const configuredSearchName =
      request.teamRecommendation.teamSearchName?.trim() ?? "";

    const teamSearchName =
      configuredSearchName.length > 0 ? configuredSearchName : teamName;

    if (teamName.length === 0) {
      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: null,
          status: "team_required",
        },
      };
    }

    if (request.teamRecommendation.position === null) {
      return { pendingClarification: teamPositionClarification };
    }

    if (request.teams.length > 1) {
      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: JSON.stringify({ teams: request.teams }),
          status: "one_team_required",
        },
      };
    }

    const requestsBefore =
      state.faultTolerance.apiOperation === "team_search"
        ? state.faultTolerance.apiRequestsUsed
        : 0;

    const attempt = runtime.executionInfo?.nodeAttempt ?? 1;

    const result = await searchTeams(teamSearchName, {
      attempt,
      node: "resolve_team",
      requestsBefore,
      runId: runtime.executionInfo?.runId,
      signal: runtime.signal,
      threadId: runtime.executionInfo?.threadId,
    });

    if (result.status === "error") {
      const requestsUsed = result.requestsUsed ?? requestsBefore + attempt;

      return createApiFailureTransition({
        faultTolerance: state.faultTolerance,
        node: "resolve_team",
        operation: "team_search",
        requestsUsed,
        result,
        runtime,
      });
    }

    return teamSelectionPatch(
      result.data,
      teamName,
      teamSearchName,
      request,
      state
    );
  };

export { createResolveTeamNode };
