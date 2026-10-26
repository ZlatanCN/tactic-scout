import type { GraphNode } from "@langchain/langgraph";

import type { AgentState, RequestState } from "../state.js";

type UnavailableTaskKind =
  | "player_comparison"
  | "player_recommendation"
  | "team_recommendation";

const unavailableStatus: Record<UnavailableTaskKind, string> = {
  player_comparison: "comparison_tool_unavailable",
  player_recommendation: "recommendation_tool_unavailable",
  team_recommendation: "team_recommendation_tool_unavailable",
};

const createUnavailableTaskNode =
  (kind: UnavailableTaskKind): GraphNode<typeof AgentState> =>
  (state: { request: RequestState }) => ({
    outcome: {
      kind,
      resultJson: null,
      status: unavailableStatus[kind],
    },
    request: state.request,
  });

export { createUnavailableTaskNode };
