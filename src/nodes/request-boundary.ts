import { AIMessage } from "@langchain/core/messages";
import type { GraphNode } from "@langchain/langgraph";

import { createInitialRequestState } from "../state.js";
import type { AgentState } from "../state.js";

const createRequestBoundaryNode =
  (): GraphNode<typeof AgentState> => (state) => {
    const request = state.request ?? createInitialRequestState();
    let response = "当前版本支持查询球员记录。请告诉我你要查询哪位球员。";

    if (request.kind === "player_lookup" && request.players.length === 0) {
      response = "请告诉我你要查询哪位球员。";
    } else if (request.kind === "player_comparison") {
      response =
        "我已经识别到这是球员比较请求；比较流程还未接通，目前可以查询单个球员记录。";
    } else if (request.kind === "player_recommendation") {
      response =
        "我已经识别到这是球员推荐请求；推荐流程还未接通，目前可以查询球员记录。";
    } else if (request.kind === "team_recommendation") {
      response =
        "我已经识别到这是球队推荐请求；球队推荐流程还未接通，目前可以查询球员记录。";
    }

    return { messages: [new AIMessage(response)] };
  };

export { createRequestBoundaryNode };
