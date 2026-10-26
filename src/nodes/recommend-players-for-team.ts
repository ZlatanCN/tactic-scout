import type { StructuredToolInterface } from "@langchain/core/tools";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { selectedReferenceCandidate } from "../player-data/contracts.js";
import { supportedPositionCodes } from "../player-data/position-features.js";
import { recommendationConstraintIsApplied } from "../recommendation-constraints.js";
import { conversationReferenceFromPlayer } from "../recommendation-references.js";
import type {
  AgentState,
  ConversationPlayerReference,
  PendingClarification,
  RequestPlayerState,
} from "../state.js";

const teamRecommendationEnvelopeSchema = z.object({ status: z.string() });

const fmIdsForPlayer = (player: RequestPlayerState): string[] => {
  const candidate = selectedReferenceCandidate(player.resolution);

  return candidate === null
    ? []
    : candidate.records.flatMap((record) =>
        record.provider === "fm" ? [record.sourceId] : []
      );
};

const uniqueSorted = (values: string[]): string[] =>
  [...new Set(values)].toSorted((left, right) => left.localeCompare(right));

const namedReferenceClarification = (
  players: RequestPlayerState[]
): PendingClarification | null => {
  const ambiguousIndex = players.findIndex(
    (player) => fmIdsForPlayer(player).length > 1
  );

  if (ambiguousIndex === -1) {
    return null;
  }

  const player = players[ambiguousIndex];

  if (player === undefined) {
    return null;
  }

  const fmIds = uniqueSorted(fmIdsForPlayer(player));

  return {
    answer: null,
    kind: "fm_profile",
    options: fmIds,
    playerIndex: ambiguousIndex,
    question: `${player.mention} 对应多个 FM 画像，请选择一个 source ID 或候选编号：${fmIds.join("、")}。`,
  };
};

const referencesFromPlayers = (
  players: RequestPlayerState[]
): ConversationPlayerReference[] =>
  players.flatMap((player) => {
    const reference = conversationReferenceFromPlayer(player);

    return reference === null ? [] : [reference];
  });

const createRecommendPlayersForTeamNode =
  (recommendationTool: StructuredToolInterface): GraphNode<typeof AgentState> =>
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

    const recommendation = request.teamRecommendation;
    const { roster, team } = recommendation;

    if (team === null || roster === null || recommendation.position === null) {
      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: null,
          status: "invalid_task_state",
        },
      };
    }

    const unsupportedConstraints = request.constraints.filter(
      (constraint) =>
        !recommendationConstraintIsApplied(constraint, recommendation)
    );

    if (unsupportedConstraints.length > 0) {
      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: JSON.stringify({ constraints: unsupportedConstraints }),
          status: "unsupported_constraints",
        },
      };
    }

    const unresolvedMember = roster.members.find(
      (member) => member.mappingStatus !== "resolved" || member.fmId === null
    );

    if (unresolvedMember !== undefined) {
      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: JSON.stringify({ playerName: unresolvedMember.name }),
          status: "team_roster_member_unmapped",
        },
      };
    }

    if (recommendation.referenceMode === "named") {
      const clarification = namedReferenceClarification(request.players);

      if (clarification !== null) {
        return { pendingClarification: clarification };
      }

      if (request.players.length === 0) {
        return {
          outcome: {
            kind: "team_recommendation",
            resultJson: null,
            status: "reference_required",
          },
        };
      }
    }

    const referenceFmIds =
      recommendation.referenceMode === "named"
        ? uniqueSorted(request.players.flatMap(fmIdsForPlayer))
        : [];

    if (
      recommendation.referenceMode === "named" &&
      referenceFmIds.length === 0
    ) {
      return {
        outcome: {
          kind: "team_recommendation",
          resultJson: null,
          status: "reference_profile_missing",
        },
      };
    }

    const rawResult: unknown = await recommendationTool.invoke({
      includePotential: recommendation.includePotential,
      maxAge: recommendation.maxAge,
      minimumCurrentAbility: recommendation.minimumCurrentAbility,
      minimumPotentialAbility: recommendation.minimumPotentialAbility,
      position: recommendation.position,
      referenceFmIds,
      referenceMode: recommendation.referenceMode,
      resultLimit: recommendation.resultLimit,
      roster,
      team,
    });

    const parsedString = z.string().safeParse(rawResult);

    if (!parsedString.success) {
      throw new Error("球队推荐工具没有返回 JSON 文本。");
    }

    const resultJson = parsedString.data;
    const parsedResult: unknown = JSON.parse(resultJson);
    const result = teamRecommendationEnvelopeSchema.parse(parsedResult);

    if (result.status === "team_position_unavailable") {
      return {
        outcome: null,
        pendingClarification: {
          answer: null,
          kind: "team_position",
          options: supportedPositionCodes,
          question: `${team.name} 在 FM 快照中没有足够的 ${recommendation.position} 画像来形成团队参考。请换一个位置，或输入一名 FM 参考球员姓名。`,
        },
      };
    }

    if (result.status !== "ready" && result.status !== "no_candidates") {
      return {
        outcome: {
          kind: "team_recommendation",
          resultJson,
          status: result.status,
        },
      };
    }

    const referencePlayers =
      recommendation.referenceMode === "named"
        ? referencesFromPlayers(request.players)
        : [];

    return {
      conversationContext: {
        ...state.conversationContext,
        activeTeamRecommendation: {
          includePotential: recommendation.includePotential,
          maxAge: recommendation.maxAge,
          minimumCurrentAbility: recommendation.minimumCurrentAbility,
          minimumPotentialAbility: recommendation.minimumPotentialAbility,
          position: recommendation.position,
          referenceMode: recommendation.referenceMode,
          referencePlayers,
          resultJson,
          resultLimit: recommendation.resultLimit ?? 5,
          roster,
          status: result.status,
          team,
        },
      },
      outcome: {
        kind: "team_recommendation",
        resultJson,
        status: result.status,
      },
    };
  };

export { createRecommendPlayersForTeamNode };
