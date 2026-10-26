import type { StructuredToolInterface } from "@langchain/core/tools";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { comparisonContextFromRequest } from "../comparison-context.js";
import { selectedReferenceCandidate } from "../player-data/contracts.js";
import type { AgentState, RequestPlayerState, RequestState } from "../state.js";

const seasonPattern = /\b(?<start>20\d{2})\s*\/\s*(?<end>\d{2}|20\d{2})\b/u;
const seasonConstraintPattern = /season|赛季/iu;

const comparisonResultSchema = z.object({
  status: z.string(),
});

const comparisonPlayer = (player: RequestPlayerState) => {
  const candidate = selectedReferenceCandidate(player.resolution);

  return candidate === null
    ? null
    : {
        canonicalIdentityId: candidate.canonicalIdentityId,
        identityBasis:
          candidate.identityBasis ??
          (candidate.canonicalIdentityId === null
            ? "source_record"
            : "reep_registry"),
        playerName: candidate.name,
        sourceRecords: candidate.records.map(({ provider, sourceId }) => ({
          provider,
          sourceId,
        })),
      };
};

const seasonStartYearFromRequest = (
  constraints: { name: string; value: string }[]
):
  | { kind: "missing" }
  | { kind: "valid"; year: number }
  | { kind: "invalid" } => {
  const seasons = constraints.filter(({ name }) =>
    seasonConstraintPattern.test(name)
  );

  if (seasons.length === 0) {
    return { kind: "missing" };
  }

  if (seasons.length > 1) {
    return { kind: "invalid" };
  }

  const value = seasons[0]?.value ?? "";
  const match = seasonPattern.exec(value);

  if (match?.groups?.start === undefined || match.groups.end === undefined) {
    return { kind: "invalid" };
  }

  const startYear = Number(match.groups.start);
  const endYear = Number(match.groups.end);

  const normalizedEndYear =
    match.groups.end.length === 2
      ? Math.floor(startYear / 100) * 100 + endYear
      : endYear;

  return normalizedEndYear === startYear + 1
    ? { kind: "valid", year: startYear }
    : { kind: "invalid" };
};

const requestPlayers = (
  request: Extract<RequestState, { kind: "player_comparison" }>
) =>
  request.players.flatMap((player) => {
    const resolved = comparisonPlayer(player);

    return resolved === null ? [] : [resolved];
  });

const createComparePlayersNode =
  (compareTool: StructuredToolInterface): GraphNode<typeof AgentState> =>
  async (state) => {
    const { request } = state;

    if (request.kind !== "player_comparison") {
      return {
        outcome: {
          kind: "player_comparison",
          resultJson: null,
          status: "invalid_task_state",
        },
      };
    }

    const unsupportedConstraints = request.constraints.filter(
      ({ name }) => !seasonConstraintPattern.test(name)
    );

    if (unsupportedConstraints.length > 0) {
      return {
        outcome: {
          kind: "player_comparison",
          resultJson: JSON.stringify({ constraints: unsupportedConstraints }),
          status: "unsupported_constraints",
        },
      };
    }

    const season = seasonStartYearFromRequest(request.constraints);

    if (season.kind === "invalid") {
      return {
        outcome: {
          kind: "player_comparison",
          resultJson: null,
          status: "season_clarification_required",
        },
        pendingClarification: {
          answer: null,
          kind: "season",
          question:
            "我没法从这个赛季条件确定赛季起始年。请用明确格式补充，例如 2024/25。",
        },
      };
    }

    const players = requestPlayers(request);

    if (players.length < 2) {
      return {
        outcome: {
          kind: "player_comparison",
          resultJson: null,
          status: "insufficient_distinct_players",
        },
      };
    }

    try {
      const toolInput =
        season.kind === "valid"
          ? { players, seasonStartYear: season.year }
          : { players };

      const rawResult: unknown = await compareTool.invoke(toolInput);
      const parsedString = z.string().safeParse(rawResult);

      if (!parsedString.success) {
        throw new Error("比较工具未返回 JSON 文本。");
      }

      const jsonValue: unknown = JSON.parse(parsedString.data);
      const result = comparisonResultSchema.parse(jsonValue);

      if (result.status !== "ready" && result.status !== "no_comparable_data") {
        return {
          outcome: {
            kind: "player_comparison",
            resultJson: parsedString.data,
            status: result.status,
          },
        };
      }

      const previousContext = state.conversationContext;
      const activeComparison = comparisonContextFromRequest(request);

      return {
        conversationContext:
          activeComparison.players.length >= 2
            ? { ...previousContext, activeComparison }
            : previousContext,
        outcome: {
          kind: "player_comparison",
          resultJson: parsedString.data,
          status: result.status,
        },
      };
    } catch {
      return {
        outcome: {
          kind: "player_comparison",
          resultJson: null,
          status: "tool_error",
        },
      };
    }
  };

export { createComparePlayersNode };
