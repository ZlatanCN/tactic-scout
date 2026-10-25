import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph";
import {
  END,
  InMemoryStore,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import "dotenv/config";

import { createAssistantNode } from "./nodes/assistant.js";
import { createEntityResolutionNode } from "./nodes/entity-resolution.js";
import {
  createIdentityClarificationNode,
  createUnresolvedRequestNode,
} from "./nodes/identity-clarification.js";
import { createRememberComparisonNode } from "./nodes/remember-comparison.js";
import { createRequestBoundaryNode } from "./nodes/request-boundary.js";
import { createRequestUnderstandingNode } from "./nodes/request-understanding.js";
import { resolvePlayerReference } from "./player-data/resolve-reference.js";
import type { ReferenceIdentityLookup } from "./player-data/resolve-reference.js";
import type { RequestUnderstandingExtractor } from "./request-extraction.js";
import { createRequestUnderstandingExtractor } from "./request-extraction.js";
import type { RequestState } from "./state.js";
import { AgentState, createInitialRequestState } from "./state.js";
import { createTools } from "./tools/search-player-records.js";

type CreateAgentOptions = {
  model?: BaseChatModel;
  tools?: StructuredToolInterface[];
  requestUnderstandingExtractor?: RequestUnderstandingExtractor;
  playerIdentityLookup?: ReferenceIdentityLookup;
  checkpointer?: BaseCheckpointSaver;
  store?: BaseStore;
};

const routeRequest = (request: RequestState, hasComparisonTool: boolean) => {
  if (request.status === "needs_confirmation") {
    return "confirm_identity";
  }

  if (request.status === "clarification_exhausted") {
    return "identity_unresolved";
  }

  if (request.kind === "player_lookup" && request.players.length === 0) {
    return "request_boundary";
  }

  if (request.kind === "player_comparison") {
    const allPlayersResolved = request.players.every(
      (player) => player.resolution?.status === "resolved"
    );

    return hasComparisonTool &&
      request.players.length >= 2 &&
      allPlayersResolved
      ? "assistant"
      : "request_boundary";
  }

  if (
    request.kind === "player_recommendation" ||
    request.kind === "team_recommendation"
  ) {
    return "request_boundary";
  }

  return "assistant";
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

const createAgent = (options: CreateAgentOptions = {}) => {
  const tools = options.tools ?? createTools();
  const model = options.model ?? configuredModel();

  const modelVisibleTools = tools.filter(
    (configuredTool) => configuredTool.name !== "compare_player_records"
  );

  const modelWithTools = model.bindTools?.(modelVisibleTools);

  const hasComparisonTool = tools.some(
    (configuredTool) => configuredTool.name === "compare_player_records"
  );

  if (!modelWithTools) {
    throw new Error("配置的聊天模型不支持工具调用。");
  }

  const understandRequest = createRequestUnderstandingNode(
    options.requestUnderstandingExtractor ??
      createRequestUnderstandingExtractor(model)
  );

  const resolveEntities = createEntityResolutionNode(
    options.playerIdentityLookup ?? resolvePlayerReference
  );

  const graph = new StateGraph(AgentState)
    .addNode("understand_request", understandRequest)
    .addNode("resolve_entities", resolveEntities)
    .addNode("confirm_identity", createIdentityClarificationNode())
    .addNode("identity_unresolved", createUnresolvedRequestNode())
    .addNode("request_boundary", createRequestBoundaryNode())
    .addNode("remember_comparison", createRememberComparisonNode())
    .addNode("assistant", createAssistantNode(model, modelWithTools))
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "understand_request")
    .addEdge("understand_request", "resolve_entities")
    .addConditionalEdges(
      "resolve_entities",
      (state) =>
        routeRequest(
          state.request ?? createInitialRequestState(),
          hasComparisonTool
        ),
      [
        "confirm_identity",
        "identity_unresolved",
        "request_boundary",
        "assistant",
      ]
    )
    .addEdge("confirm_identity", "resolve_entities")
    .addEdge("identity_unresolved", END)
    .addEdge("request_boundary", END)
    .addConditionalEdges("assistant", toolsCondition)
    .addEdge("tools", "remember_comparison")
    .addEdge("remember_comparison", "assistant");

  return graph.compile({
    checkpointer: options.checkpointer ?? new MemorySaver(),
    store: options.store ?? new InMemoryStore(),
  });
};

const agent = createAgent();

export { agent, createAgent };

export type { CreateAgentOptions };
