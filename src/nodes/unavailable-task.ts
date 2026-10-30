import type { GraphNode } from "@langchain/langgraph";

import type { AgentState, RequestState, TurnOutcome } from "../state.js";

type UnavailableTaskKind =
  | "player_comparison"
  | "player_recommendation"
  | "team_recommendation";

const unavailableOutcome = (kind: UnavailableTaskKind): TurnOutcome => {
  if (kind === "player_comparison") {
    return {
      kind,
      resultJson: null,
      status: "comparison_tool_unavailable",
    };
  }

  if (kind === "player_recommendation") {
    return {
      kind,
      resultJson: null,
      status: "recommendation_tool_unavailable",
    };
  }

  return {
    kind,
    resultJson: null,
    status: "team_recommendation_tool_unavailable",
  };
};

const createUnavailableTaskNode =
  (kind: UnavailableTaskKind): GraphNode<typeof AgentState> =>
  (state: { request: RequestState }) => ({
    outcome: unavailableOutcome(kind),
    request: state.request,
  });

export { createUnavailableTaskNode };
