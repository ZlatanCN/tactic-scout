import type { GraphNode } from "@langchain/langgraph";

import {
  logFaultEvent,
  maxExternalRequests,
  maxRateLimitWaitMs,
} from "../fault-tolerance.js";
import type {
  FaultCategory,
  FaultExecutionContext,
} from "../fault-tolerance.js";
import { isLocalDataError } from "../player-data/shared.js";
import type { AgentState, AgentStateType, RequestState } from "../state.js";
import type {
  ApiFootballClient,
  ApiFootballRosterPlayer,
} from "../team-data/api-football.js";
import type { TeamRosterSnapshot } from "../team-data/contracts.js";
import { teamRosterCoverage } from "../team-data/roster-coverage.js";
import type {
  TeamRosterIdentityLookup,
  TeamRosterIdentityResolution,
} from "../team-data/roster-identity.js";

type ResolveTeamRosterOptions = {
  getSquad: ApiFootballClient["getSquad"];
  resolvePlayer: TeamRosterIdentityLookup;
};

type ApiFootballErrorResult = Extract<
  Awaited<ReturnType<ApiFootballClient["getSquad"]>>,
  { status: "error" }
>;

const rosterFailureCategory = (
  reason: ApiFootballErrorResult["reason"]
): FaultCategory =>
  (
    {
      attempt_limit: "attempt_limit",
      configuration: "configuration",
      provider: "invalid_response",
      quota: "quota",
      rate_limit: "rate_limit",
    } as const
  )[reason];

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

const applyIdentityResolution = (
  member: TeamRosterSnapshot["members"][number],
  resolution: TeamRosterIdentityResolution
): TeamRosterSnapshot["members"][number] => {
  if (resolution.status === "resolved") {
    return {
      ...member,
      fmId: resolution.candidate.fmId,
      mappingMethod: "reep_bridge",
      mappingStatus: "resolved",
    };
  }

  if (resolution.status === "needs_confirmation") {
    return {
      ...member,
      fmCandidates: resolution.candidates,
    };
  }

  return { ...member, mappingStatus: "no_profile" };
};

const pendingRosterProfileClarification = (
  roster: TeamRosterSnapshot,
  memberIndex: number
) => {
  const member = roster.members[memberIndex];

  if (member === undefined || member.fmCandidates.length === 0) {
    return null;
  }

  const candidates = member.fmCandidates
    .map(
      (candidate, index) =>
        `${index + 1}. ${candidate.name}（FM ${candidate.fmId}；出生日期 ${candidate.birthDate ?? "未知"}；自然位置 ${candidate.naturalPositions ?? "未知"}；CA ${candidate.currentAbility ?? "未知"}；PA ${candidate.potentialAbility ?? "未知"}）`
    )
    .join("；");

  return {
    answer: null,
    candidates: member.fmCandidates,
    kind: "team_roster_profile" as const,
    question: `阵容球员“${member.name}”没有唯一的 Reep→FM 映射。请确认对应画像：${candidates}`,
    rosterIndex: memberIndex,
  };
};

const requestWithRoster = (
  request: Extract<RequestState, { kind: "team_recommendation" }>,
  roster: TeamRosterSnapshot
) => ({
  ...request,
  teamRecommendation: { ...request.teamRecommendation, roster },
});

const rosterProviderFailure = (
  result: ApiFootballErrorResult,
  requestsUsed: number,
  runtime: FaultExecutionContext
): Partial<AgentStateType> => {
  logFaultEvent({
    attempt: requestsUsed,
    category: rosterFailureCategory(result.reason),
    event: "exhausted",
    node: "resolve_team_roster",
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
  result: ApiFootballErrorResult,
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
    event: "rate_limit_retry",
    node: "resolve_team_roster",
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

const createResolveTeamRosterNode =
  (options: ResolveTeamRosterOptions): GraphNode<typeof AgentState> =>
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

    const { team } = request.teamRecommendation;

    if (team === null) {
      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: null,
          status: "invalid_task_state",
        },
      };
    }

    let { roster } = request.teamRecommendation;

    if (roster === null) {
      const requestsBefore =
        state.faultTolerance.apiOperation === "team_roster"
          ? state.faultTolerance.apiRequestsUsed
          : 0;

      const attempt = runtime.executionInfo?.nodeAttempt ?? 1;

      const result = await options.getSquad(team.id, {
        attempt,
        node: "resolve_team_roster",
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
            resultJson: JSON.stringify({ team }),
            status: "team_roster_empty",
          },
        };
      }

      roster = {
        members: result.data.players.map(rosterMemberFromProvider),
        retrievedAt: result.data.retrievedAt,
        team: result.data.team,
      };
    }

    const initialRoster = roster;

    const pendingMembers = initialRoster.members.filter(
      (member) =>
        member.mappingStatus === "pending" && member.fmCandidates.length === 0
    );

    let resolutions: {
      playerId: number;
      resolution: Awaited<ReturnType<TeamRosterIdentityLookup>>;
    }[];

    try {
      resolutions = await Promise.all(
        pendingMembers.map(async (member) => ({
          playerId: member.apiFootballPlayerId,
          resolution: await options.resolvePlayer(
            member.apiFootballPlayerId,
            member.name
          ),
        }))
      );
    } catch (error) {
      if (!(error instanceof Error) || !isLocalDataError(error)) {
        throw error;
      }

      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: null,
          status: "team_identity_error",
        },
        request: requestWithRoster(request, initialRoster),
      };
    }

    const resolutionByPlayerId = new Map(
      resolutions.map(({ playerId, resolution }) => [playerId, resolution])
    );

    const resolvedRoster = {
      ...initialRoster,
      members: initialRoster.members.map((member) => {
        const resolution = resolutionByPlayerId.get(member.apiFootballPlayerId);

        return resolution === undefined
          ? member
          : applyIdentityResolution(member, resolution);
      }),
    };

    const noProfileIndex = resolvedRoster.members.findIndex(
      (member) => member.mappingStatus === "no_profile"
    );

    const noProfileMember = resolvedRoster.members[noProfileIndex];

    if (noProfileMember !== undefined) {
      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: JSON.stringify({
            apiFootballPlayerId: noProfileMember.apiFootballPlayerId,
            mappingCoverage: teamRosterCoverage(resolvedRoster),
            playerName: noProfileMember.name,
          }),
          status: "team_roster_member_unmapped",
        },
        request: requestWithRoster(request, resolvedRoster),
      };
    }

    const confirmationIndex = resolvedRoster.members.findIndex(
      (member) => member.mappingStatus === "pending"
    );

    if (confirmationIndex !== -1) {
      return {
        pendingClarification: pendingRosterProfileClarification(
          resolvedRoster,
          confirmationIndex
        ),
        request: requestWithRoster(request, resolvedRoster),
      };
    }

    return { request: requestWithRoster(request, resolvedRoster) };
  };

export { createResolveTeamRosterNode };

export type { ResolveTeamRosterOptions };
