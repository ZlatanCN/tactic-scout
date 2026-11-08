import { getStore } from "@langchain/langgraph";
import type { BaseStore, GraphNode } from "@langchain/langgraph";

import { logLocalDataFailure } from "../fault-tolerance.js";
import { isLocalDataError } from "../player-data/shared.js";
import type { findRememberedRosterIdentity } from "../player-memory.js";
import type { AgentState, RequestState } from "../state.js";
import { createInitialPlayerMemoryStatus } from "../state.js";
import type {
  TeamFmProfileCandidate,
  TeamRosterSnapshot,
} from "../team-data/contracts.js";
import { teamRosterCoverage } from "../team-data/roster-coverage.js";
import type {
  TeamRosterIdentityLookup,
  TeamRosterIdentityResolution,
} from "../team-data/roster-identity.js";

type ResolveTeamRosterOptions = {
  findRememberedIdentity: typeof findRememberedRosterIdentity;
  resolvePlayer: TeamRosterIdentityLookup;
};

const mergeRosterCandidates = (
  rememberedCandidates: TeamFmProfileCandidate[],
  current: TeamRosterIdentityResolution
): TeamRosterIdentityResolution => {
  const candidatesByFmId = new Map<string, TeamFmProfileCandidate>();

  for (const candidate of rememberedCandidates) {
    candidatesByFmId.set(candidate.fmId, candidate);
  }

  if (current.status === "resolved") {
    candidatesByFmId.set(current.candidate.fmId, current.candidate);
  }

  if (current.status === "needs_confirmation") {
    for (const candidate of current.candidates) {
      candidatesByFmId.set(candidate.fmId, candidate);
    }
  }

  const candidates = [...candidatesByFmId.values()].toSorted((left, right) =>
    left.fmId.localeCompare(right.fmId)
  );

  if (candidates.length > 0) {
    return { candidates, status: "needs_confirmation" };
  }

  return current.status === "no_profile"
    ? { candidates: [], status: "needs_confirmation" }
    : current;
};

const applyIdentityResolution = (
  member: TeamRosterSnapshot["members"][number],
  resolution: TeamRosterIdentityResolution
): TeamRosterSnapshot["members"][number] => {
  if (resolution.status === "resolved") {
    return {
      ...member,
      fmId: resolution.candidate.fmId,
      mappingMethod: resolution.method,
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

  if (member === undefined) {
    return null;
  }

  if (member.fmCandidates.length === 0) {
    return {
      answer: null,
      candidates: [],
      kind: "team_roster_profile" as const,
      question: `阵容球员“${member.name}”目前没有可用的 FM 画像。请先更新或补齐当前 FM 资料，然后回复“重试”重新查找。`,
      rosterIndex: memberIndex,
    };
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
    question: `阵容球员“${member.name}”目前无法安全对应到唯一的 FM 画像。请确认对应画像：${candidates}`,
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
  (
    options: ResolveTeamRosterOptions,
    configuredStore: BaseStore | null
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

    const store = configuredStore ?? getStore(runtime);

    const previousPlayerMemoryStatus =
      state.playerMemoryStatus ?? createInitialPlayerMemoryStatus();

    let memoryReadFailed = false;

    const currentPlayerMemoryStatus = () => ({
      ...previousPlayerMemoryStatus,
      readFailed: previousPlayerMemoryStatus.readFailed || memoryReadFailed,
    });

    const resolveMember = async (member: (typeof pendingMembers)[number]) => {
      if (store === undefined) {
        memoryReadFailed = true;

        return await options.resolvePlayer(
          member.apiFootballPlayerId,
          member.name
        );
      }

      const remembered = await options.findRememberedIdentity(
        store,
        member.apiFootballPlayerId
      );

      if (remembered.status === "found") {
        return {
          candidate: remembered.candidate,
          method: "user_confirmation" as const,
          status: "resolved" as const,
        };
      }

      if (remembered.status === "unavailable") {
        memoryReadFailed = true;
      }

      if (remembered.status === "conflict") {
        const current = await options.resolvePlayer(
          member.apiFootballPlayerId,
          member.name
        );

        return mergeRosterCandidates(remembered.candidates, current);
      }

      return await options.resolvePlayer(
        member.apiFootballPlayerId,
        member.name
      );
    };

    let resolutions: {
      playerId: number;
      resolution: Awaited<ReturnType<TeamRosterIdentityLookup>>;
    }[];

    const mappingStartedAt = Date.now();

    try {
      resolutions = await Promise.all(
        pendingMembers.map(async (member) => ({
          playerId: member.apiFootballPlayerId,
          resolution: await resolveMember(member),
        }))
      );
    } catch (error) {
      if (!(error instanceof Error) || !isLocalDataError(error)) {
        throw error;
      }

      logLocalDataFailure(
        "resolve_team_roster",
        runtime,
        Date.now() - mappingStartedAt,
        1
      );

      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: null,
          status: "team_identity_error",
        },
        playerMemoryStatus: currentPlayerMemoryStatus(),
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
        playerMemoryStatus: currentPlayerMemoryStatus(),
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
        playerMemoryStatus: currentPlayerMemoryStatus(),
        request: requestWithRoster(request, resolvedRoster),
      };
    }

    return {
      playerMemoryStatus: currentPlayerMemoryStatus(),
      request: requestWithRoster(request, resolvedRoster),
    };
  };

export { createResolveTeamRosterNode };

export type { ResolveTeamRosterOptions };
