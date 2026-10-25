import type { GraphNode } from "@langchain/langgraph";

import {
  comparisonContextFromRequest,
  hasSuccessfulComparisonInCurrentTurn,
} from "../comparison-context.js";
import type { AgentState } from "../state.js";
import {
  createInitialConversationContext,
  createInitialRequestState,
} from "../state.js";

const createRememberComparisonNode =
  (): GraphNode<typeof AgentState> => (state) => {
    const request = state.request ?? createInitialRequestState();

    const conversationContext =
      state.conversationContext ?? createInitialConversationContext();

    if (
      request.kind !== "player_comparison" ||
      !hasSuccessfulComparisonInCurrentTurn(state.messages)
    ) {
      return {};
    }

    const activeComparison = comparisonContextFromRequest(request);

    if (activeComparison.players.length < 2) {
      return {};
    }

    return {
      conversationContext: {
        ...conversationContext,
        activeComparison,
      },
    };
  };

export { createRememberComparisonNode };
