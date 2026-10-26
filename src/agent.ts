import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import "dotenv/config";

import { createAnswerNode, createLookupPlayerNode } from "./nodes/assistant.js";
import { createComparePlayersNode } from "./nodes/compare-players.js";
import { createEntityResolutionNode } from "./nodes/entity-resolution.js";
import { createClarifyNode } from "./nodes/identity-clarification.js";
import { createRecommendPlayersNode } from "./nodes/recommend-players.js";
import { createRequestUnderstandingNode } from "./nodes/request-understanding.js";
import { resolvePlayerReference } from "./player-data/resolve-reference.js";
import type { ReferenceIdentityLookup } from "./player-data/resolve-reference.js";
import type { RequestUnderstandingExtractor } from "./request-extraction.js";
import { createRequestUnderstandingExtractor } from "./request-extraction.js";
import type { AgentStateType, RequestState } from "./state.js";
import { AgentState } from "./state.js";
import { createTools } from "./tools/search-player-records.js";

type CreateAgentOptions = {
  model?: BaseChatModel;
  tools?: StructuredToolInterface[];
  requestUnderstandingExtractor?: RequestUnderstandingExtractor;
  playerIdentityLookup?: ReferenceIdentityLookup;
  checkpointer?: BaseCheckpointSaver;
};

const configuredModel = (): ChatOpenAI => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const modelName = process.env.OPENAI_MODEL?.trim();

  if (
    apiKey === undefined ||
    apiKey.length === 0 ||
    modelName === undefined ||
    modelName.length === 0
  ) {
    throw new Error("请在 .env 中配置 OPENAI_API_KEY 和 OPENAI_MODEL。");
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim();

  if (baseURL !== undefined && baseURL.length > 0) {
    return new ChatOpenAI({
      apiKey,
      configuration: { baseURL },
      model: modelName,
      temperature: 0,
    });
  }

  return new ChatOpenAI({
    apiKey,
    model: modelName,
    temperature: 0,
  });
};

const playersAreResolved = (request: RequestState): boolean =>
  request.players.length > 0 &&
  request.players.every((player) => player.resolution?.status === "resolved");

const identityResolutionExhausted = (request: RequestState): boolean =>
  request.players.some(
    (player) => player.attempts >= 1 && player.resolution?.status !== "resolved"
  );

const recommendationIsReady = (request: RequestState): boolean => {
  if (request.kind !== "player_recommendation") {
    return false;
  }

  const hasReference = request.players.some(
    (player) => player.recommendationRole === "reference"
  );

  const rolesAreClear = request.players.every(
    (player) => player.recommendationRole !== "ambiguous"
  );

  return (
    hasReference &&
    rolesAreClear &&
    !request.recommendation.needsAgeClarification &&
    playersAreResolved(request)
  );
};

const routeResolvedRequest = (state: AgentStateType): string => {
  const { request } = state;

  if (
    state.outcome?.kind === "player_lookup" &&
    state.outcome.status === "lookup_follow_up"
  ) {
    return "answer";
  }

  if (identityResolutionExhausted(request)) {
    return "answer";
  }

  if (state.pendingClarification !== null) {
    return "clarify";
  }

  if (request.kind === "player_lookup") {
    return request.players.length > 0 && playersAreResolved(request)
      ? "lookup_player"
      : "answer";
  }

  if (request.kind === "player_comparison") {
    return request.players.length >= 2 && playersAreResolved(request)
      ? "compare_players"
      : "answer";
  }

  if (request.kind === "player_recommendation") {
    return recommendationIsReady(request) ? "recommend_players" : "answer";
  }

  return "answer";
};

const routeAfterClarification = (request: RequestState): string => {
  if (identityResolutionExhausted(request)) {
    return "answer";
  }

  if (request.kind === "player_lookup") {
    return playersAreResolved(request) ? "lookup_player" : "resolve_entities";
  }

  if (request.kind === "player_comparison") {
    return playersAreResolved(request) ? "compare_players" : "resolve_entities";
  }

  if (request.kind === "player_recommendation") {
    return recommendationIsReady(request)
      ? "recommend_players"
      : "resolve_entities";
  }

  return "answer";
};

const routeLookupResponse = (state: AgentStateType): string => {
  const lastMessage = state.messages.at(-1);

  return lastMessage instanceof AIMessage &&
    (lastMessage.tool_calls ?? []).length > 0
    ? "lookup_tools"
    : "answer";
};

const unavailableTaskNode =
  (kind: "player_comparison" | "player_recommendation") =>
  (state: { request: RequestState }) => ({
    outcome: {
      kind,
      resultJson: null,
      status:
        kind === "player_comparison"
          ? "comparison_tool_unavailable"
          : "recommendation_tool_unavailable",
    },
    request: state.request,
  });

const createAgent = (options: CreateAgentOptions = {}) => {
  const tools = options.tools ?? createTools();
  const model = options.model ?? configuredModel();

  const lookupTool = tools.find(
    (item) => item.name === "search_player_records"
  );

  const comparisonTool = tools.find(
    (item) => item.name === "compare_player_records"
  );

  const recommendationTool = tools.find(
    (item) => item.name === "recommend_player_candidates"
  );

  const modelWithLookupTool = model.bindTools?.(
    lookupTool === undefined ? [] : [lookupTool]
  );

  if (modelWithLookupTool === undefined) {
    throw new Error("配置的聊天模型不支持工具调用。");
  }

  const understandRequest = createRequestUnderstandingNode(
    options.requestUnderstandingExtractor ??
      createRequestUnderstandingExtractor(model)
  );

  const resolveEntities = createEntityResolutionNode(
    options.playerIdentityLookup ?? resolvePlayerReference
  );

  const comparePlayers = comparisonTool
    ? createComparePlayersNode(comparisonTool)
    : unavailableTaskNode("player_comparison");

  const recommendPlayers = recommendationTool
    ? createRecommendPlayersNode(recommendationTool)
    : unavailableTaskNode("player_recommendation");

  const graph = new StateGraph(AgentState)
    .addNode("understand_request", understandRequest)
    .addNode("resolve_entities", resolveEntities)
    .addNode("clarify", createClarifyNode())
    .addNode(
      "lookup_player",
      createLookupPlayerNode(modelWithLookupTool, lookupTool !== undefined)
    )
    .addNode("lookup_tools", new ToolNode(lookupTool ? [lookupTool] : []))
    .addNode("compare_players", comparePlayers)
    .addNode("recommend_players", recommendPlayers)
    .addNode("answer", createAnswerNode(model))
    .addEdge(START, "understand_request")
    .addEdge("understand_request", "resolve_entities")
    .addConditionalEdges(
      "resolve_entities",
      (state) => routeResolvedRequest(state),
      [
        "clarify",
        "lookup_player",
        "compare_players",
        "recommend_players",
        "answer",
      ]
    )
    .addConditionalEdges(
      "clarify",
      (state) => {
        if (state.pendingClarification?.kind === "identity") {
          return state.pendingClarification.answer === null
            ? "clarify"
            : "resolve_entities";
        }

        return state.pendingClarification === null
          ? routeAfterClarification(state.request)
          : "clarify";
      },
      [
        "clarify",
        "resolve_entities",
        "lookup_player",
        "compare_players",
        "recommend_players",
        "answer",
      ]
    )
    .addConditionalEdges("lookup_player", routeLookupResponse, [
      "lookup_tools",
      "answer",
    ])
    .addEdge("lookup_tools", "lookup_player")
    .addConditionalEdges(
      "compare_players",
      (state) =>
        state.pendingClarification?.kind === "season" ? "clarify" : "answer",
      ["clarify", "answer"]
    )
    .addConditionalEdges(
      "recommend_players",
      (state) =>
        state.pendingClarification?.kind === "position" ||
        state.pendingClarification?.kind === "fm_profile"
          ? "clarify"
          : "answer",
      ["clarify", "answer"]
    )
    .addEdge("answer", END);

  return graph.compile({
    checkpointer: options.checkpointer ?? new MemorySaver(),
  });
};

const agent = createAgent();

export { agent, createAgent };

export type { CreateAgentOptions };
