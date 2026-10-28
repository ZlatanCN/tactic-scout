import type { StructuredToolInterface } from "@langchain/core/tools";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { comparisonContextFromRequest } from "../comparison-context.js";
import { logLocalDataFailure } from "../fault-tolerance.js";
import type { ComparePlayerRecordsInput } from "../player-data/compare-records.js";
import { selectedReferenceCandidate } from "../player-data/contracts.js";
import type { AgentState, RequestPlayerState, RequestState } from "../state.js";

const seasonPattern = /\b(?<start>20\d{2})\s*\/\s*(?<end>\d{2}|20\d{2})\b/u;
const seasonConstraintPattern = /season|赛季/iu;
const competitionConstraintPattern = /^competition$/iu;

const comparisonResultSchema = z.object({
  status: z.string(),
});

const comparisonDataAvailabilitySchema = z.object({
  players: z
    .array(
      z.object({
        fm: z.object({ status: z.string() }).nullable().optional(),
        understat: z.object({ status: z.string() }).nullable().optional(),
      })
    )
    .optional(),
});

const hasUnavailableComparisonData = (resultJson: string): boolean => {
  let parsedResult: unknown;

  try {
    parsedResult = JSON.parse(resultJson);
  } catch {
    return false;
  }

  const parsed = comparisonDataAvailabilitySchema.safeParse(parsedResult);

  return (
    parsed.success &&
    parsed.data.players?.some(
      (player) =>
        player.fm?.status === "unavailable" ||
        player.understat?.status === "unavailable"
    ) === true
  );
};

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
  async (state, runtime) => {
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

    const competitionConstraints = request.constraints.filter(({ name }) =>
      competitionConstraintPattern.test(name.trim())
    );

    const unsupportedConstraints = request.constraints.filter(
      ({ name }) =>
        !seasonConstraintPattern.test(name) &&
        !competitionConstraintPattern.test(name.trim())
    );

    if (
      unsupportedConstraints.length > 0 ||
      competitionConstraints.length > 1
    ) {
      return {
        outcome: {
          kind: "player_comparison",
          resultJson: JSON.stringify({
            constraints: [
              ...unsupportedConstraints,
              ...(competitionConstraints.length > 1
                ? competitionConstraints
                : []),
            ],
          }),
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

    const competition = competitionConstraints[0]?.value;

    const toolInput: ComparePlayerRecordsInput = { players };

    if (competition !== undefined) {
      toolInput.competition = competition;
    }

    if (season.kind === "valid") {
      toolInput.seasonStartYear = season.year;
    }

    const startedAt = Date.now();
    const rawResult: unknown = await compareTool.invoke(toolInput);
    const parsedString = z.string().safeParse(rawResult);

    if (!parsedString.success) {
      throw new Error("比较工具未返回 JSON 文本。");
    }

    const jsonValue: unknown = JSON.parse(parsedString.data);
    const result = comparisonResultSchema.parse(jsonValue);
    const hasUnavailableData = hasUnavailableComparisonData(parsedString.data);

    if (hasUnavailableData) {
      logLocalDataFailure(
        "compare_players",
        runtime,
        Date.now() - startedAt,
        1
      );
    }

    if (result.status !== "ready" && result.status !== "no_comparable_data") {
      return {
        outcome: {
          kind: "player_comparison",
          resultJson: parsedString.data,
          status: result.status,
        },
      };
    }

    if (result.status === "no_comparable_data" && hasUnavailableData) {
      return {
        outcome: {
          kind: "player_comparison",
          resultJson: parsedString.data,
          status: "data_unavailable",
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
  };

export { createComparePlayersNode };
