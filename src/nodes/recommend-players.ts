import type { StructuredToolInterface } from "@langchain/core/tools";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { selectedReferenceCandidate } from "../player-data/contracts.js";
import { recommendationConstraintIsApplied } from "../recommendation-constraints.js";
import { conversationReferenceFromPlayer } from "../recommendation-references.js";
import type {
  AgentState,
  PendingClarification,
  RequestPlayerState,
} from "../state.js";
import type { RecommendationIdentityGroup } from "../tools/recommend-player-candidates.js";

const recommendationResultSchema = z.object({ status: z.string() });

const recommendationGroups = (
  players: RequestPlayerState[],
  role: "exclude" | "reference"
): RecommendationIdentityGroup[] => {
  const groups = new Map<string, { fmIds: Set<string>; names: Set<string> }>();

  for (const player of players.filter(
    (item) => item.recommendationRole === role
  )) {
    const candidate = selectedReferenceCandidate(player.resolution);

    if (candidate !== null) {
      const identityKey =
        candidate.canonicalIdentityId ?? candidate.candidateId;

      const current = groups.get(identityKey) ?? {
        fmIds: new Set<string>(),
        names: new Set<string>(),
      };

      current.names.add(candidate.name);

      for (const record of candidate.records) {
        if (record.provider === "fm") {
          current.fmIds.add(record.sourceId);
        }
      }

      groups.set(identityKey, current);
    }
  }

  return [...groups.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([identityKey, group]) => ({
      fmIds: [...group.fmIds].toSorted(),
      identityKey,
      name: [...group.names].toSorted()[0] ?? identityKey,
    }));
};

const referenceProfileClarification = (
  players: RequestPlayerState[],
  groups: RecommendationIdentityGroup[]
): PendingClarification | null => {
  const ambiguousGroup = groups.find((group) => group.fmIds.length > 1);

  if (ambiguousGroup === undefined) {
    return null;
  }

  const playerIndex = players.findIndex((player) => {
    if (player.recommendationRole !== "reference") {
      return false;
    }

    const candidate = selectedReferenceCandidate(player.resolution);

    return (
      candidate !== null &&
      (candidate.canonicalIdentityId ?? candidate.candidateId) ===
        ambiguousGroup.identityKey
    );
  });

  if (playerIndex === -1) {
    return null;
  }

  return {
    answer: null,
    kind: "fm_profile",
    options: ambiguousGroup.fmIds,
    playerIndex,
    question: `${
      ambiguousGroup.name
    }对应多个 FM 画像。请选择 source ID，或回复候选编号：${ambiguousGroup.fmIds.join(
      "、"
    )}。`,
  };
};

const createRecommendPlayersNode =
  (recommendationTool: StructuredToolInterface): GraphNode<typeof AgentState> =>
  async (state) => {
    const { request } = state;

    if (request.kind !== "player_recommendation") {
      return {
        outcome: {
          kind: "player_recommendation",
          resultJson: null,
          status: "invalid_task_state",
        },
      };
    }

    const unsupportedConstraints = request.constraints.filter(
      (constraint) =>
        !recommendationConstraintIsApplied(constraint, request.recommendation)
    );

    if (unsupportedConstraints.length > 0) {
      return {
        outcome: {
          kind: "player_recommendation",
          resultJson: JSON.stringify({ constraints: unsupportedConstraints }),
          status: "unsupported_constraints",
        },
      };
    }

    const referenceGroups = recommendationGroups(request.players, "reference");
    const excludeGroups = recommendationGroups(request.players, "exclude");

    if (referenceGroups.length === 0) {
      return {
        outcome: {
          kind: "player_recommendation",
          resultJson: null,
          status: "reference_required",
        },
      };
    }

    const profileClarification = referenceProfileClarification(
      request.players,
      referenceGroups
    );

    if (profileClarification !== null) {
      return { pendingClarification: profileClarification };
    }

    const { recommendation } = request;

    const toolInput = {
      excludeGroups,
      includePotential: recommendation.includePotential,
      maxAge: recommendation.maxAge,
      minimumCurrentAbility: recommendation.minimumCurrentAbility,
      minimumPotentialAbility: recommendation.minimumPotentialAbility,
      position: recommendation.position,
      referenceGroups,
      resultLimit: recommendation.resultLimit,
    };

    const rawResult: unknown = await recommendationTool.invoke(toolInput);
    const parsedString = z.string().safeParse(rawResult);

    if (!parsedString.success) {
      throw new Error("推荐工具未返回 JSON 文本。");
    }

    const resultJson = parsedString.data;
    const parsedResult: unknown = JSON.parse(resultJson);
    const result = recommendationResultSchema.parse(parsedResult);

    if (result.status === "position_required") {
      const positionClarification = z
        .object({
          commonNaturalPositions: z.array(z.string()),
          positionOptions: z.array(z.string()),
        })
        .parse(parsedResult);

      const options =
        positionClarification.commonNaturalPositions.length > 0
          ? positionClarification.commonNaturalPositions
          : positionClarification.positionOptions;

      const question =
        positionClarification.commonNaturalPositions.length > 0
          ? `参考球员共有自然位置：${options.join("、")}。请选择一个位置代码或编号。`
          : `参考球员没有唯一共同自然位置。可选位置：${options.join("、")}。请选择一个位置代码或编号。`;

      return {
        outcome: {
          kind: "player_recommendation",
          resultJson,
          status: "position_required",
        },
        pendingClarification: {
          answer: null,
          kind: "position",
          options,
          question,
        },
      };
    }

    if (result.status !== "ready" && result.status !== "no_candidates") {
      return {
        outcome: {
          kind: "player_recommendation",
          resultJson,
          status: result.status,
        },
      };
    }

    const referencePlayers = request.players.flatMap((player) => {
      if (player.recommendationRole !== "reference") {
        return [];
      }

      const reference = conversationReferenceFromPlayer(player);

      return reference === null ? [] : [reference];
    });

    const excludePlayers = request.players.flatMap((player) => {
      if (player.recommendationRole !== "exclude") {
        return [];
      }

      const reference = conversationReferenceFromPlayer(player);

      return reference === null ? [] : [reference];
    });

    const resultPosition = z
      .object({ position: z.string() })
      .parse(parsedResult).position;

    const resultLimit = recommendation.resultLimit ?? 5;

    return {
      conversationContext: {
        ...state.conversationContext,
        activeRecommendation: {
          excludePlayers,
          includePotential: recommendation.includePotential,
          maxAge: recommendation.maxAge,
          minimumCurrentAbility: recommendation.minimumCurrentAbility,
          minimumPotentialAbility: recommendation.minimumPotentialAbility,
          position: resultPosition,
          referencePlayers,
          resultJson,
          resultLimit,
          status: result.status,
        },
      },
      outcome: {
        kind: "player_recommendation",
        resultJson,
        status: result.status,
      },
    };
  };

export { createRecommendPlayersNode };
