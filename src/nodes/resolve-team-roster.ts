import type { GraphNode } from "@langchain/langgraph";

import { isLocalDataError } from "../player-data/shared.js";
import type { AgentState, RequestState } from "../state.js";
import type { TeamRosterSnapshot } from "../team-data/contracts.js";
import { teamRosterCoverage } from "../team-data/roster-coverage.js";
import type {
  TeamRosterIdentityLookup,
  TeamRosterIdentityResolution,
} from "../team-data/roster-identity.js";

type ResolveTeamRosterOptions = {
  resolvePlayer: TeamRosterIdentityLookup;
};

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

const createResolveTeamRosterNode =
  (options: ResolveTeamRosterOptions): GraphNode<typeof AgentState> =>
  async (state) => {
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

    const { roster, team } = request.teamRecommendation;

    if (team === null || roster === null) {
      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: null,
          status: "invalid_task_state",
        },
      };
    }

    const pendingMembers = roster.members.filter(
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
        request: requestWithRoster(request, roster),
      };
    }

    const resolutionByPlayerId = new Map(
      resolutions.map(({ playerId, resolution }) => [playerId, resolution])
    );

    const resolvedRoster = {
      ...roster,
      members: roster.members.map((member) => {
        const resolution = resolutionByPlayerId.get(member.apiFootballPlayerId);

        return resolution === undefined
          ? member
          : applyIdentityResolution(member, resolution);
      }),
    };

    const noProfileMember = resolvedRoster.members.find(
      (member) => member.mappingStatus === "no_profile"
    );

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
