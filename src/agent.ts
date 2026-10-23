import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import {
  END,
  InMemoryStore,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  createAssistantNode,
  createEntityResolutionNode,
  createIdentityClarificationNode,
  createRequestBoundaryNode,
  createRequestUnderstandingExtractor,
  createRequestUnderstandingNode,
  createUnresolvedRequestNode,
} from "./utils/nodes.js";
import type { RequestUnderstandingExtractor } from "./utils/nodes.js";
import { AgentState, createInitialRequestState } from "./utils/state.js";
import type { RequestState } from "./utils/state.js";
import { createTools, resolvePlayerReference } from "./utils/tools.js";
import type { ReferenceIdentityLookup } from "./utils/tools.js";

type CreateAgentOptions = {
  model?: BaseChatModel;
  tools?: StructuredToolInterface[];
  requestUnderstandingExtractor?: RequestUnderstandingExtractor;
  playerIdentityLookup?: ReferenceIdentityLookup;
  checkpointer?: BaseCheckpointSaver;
  store?: BaseStore;
};

const routeRequest = (request: RequestState) => {
  if (request.status === "needs_confirmation") return "confirm_identity";
  if (request.status === "clarification_exhausted") return "identity_unresolved";
  if (
    request.kind === "player_lookup" &&
    request.players.length === 0
  ) return "request_boundary";
  if (
    request.kind === "player_comparison" ||
    request.kind === "player_recommendation" ||
    request.kind === "team_recommendation"
  ) return "request_boundary";
  return "assistant";
};

const configuredModel = (): ChatOpenAI => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const modelName = process.env.OPENAI_MODEL?.trim();
  if (!apiKey || !modelName) {
    throw new Error("请在 .env 中配置 OPENAI_API_KEY 和 OPENAI_MODEL。");
  }
  const baseURL = process.env.OPENAI_BASE_URL?.trim();
  return new ChatOpenAI({
    apiKey,
    model: modelName,
    temperature: 0,
    ...(baseURL ? { configuration: { baseURL } } : {}),
  });
};

const createAgent = (options: CreateAgentOptions = {}) => {
  const tools = options.tools ?? createTools();
  const model = options.model ?? configuredModel();
  const modelWithTools = model.bindTools?.(tools);
  if (!modelWithTools) throw new Error("配置的聊天模型不支持工具调用。");
  const understandRequest = createRequestUnderstandingNode(
    options.requestUnderstandingExtractor ?? createRequestUnderstandingExtractor(model),
  );
  const resolveEntities = createEntityResolutionNode(
    options.playerIdentityLookup ?? resolvePlayerReference,
  );

  const graph = new StateGraph(AgentState)
    .addNode("understand_request", understandRequest)
    .addNode("resolve_entities", resolveEntities)
    .addNode("confirm_identity", createIdentityClarificationNode())
    .addNode("identity_unresolved", createUnresolvedRequestNode())
    .addNode("request_boundary", createRequestBoundaryNode())
    .addNode(
      "assistant",
      createAssistantNode(modelWithTools),
    )
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "understand_request")
    .addEdge("understand_request", "resolve_entities")
    .addConditionalEdges(
      "resolve_entities",
      (state) => routeRequest(state.request ?? createInitialRequestState()),
      ["confirm_identity", "identity_unresolved", "request_boundary", "assistant"],
    )
    .addEdge("confirm_identity", "resolve_entities")
    .addEdge("identity_unresolved", END)
    .addEdge("request_boundary", END)
    .addConditionalEdges("assistant", toolsCondition)
    .addEdge("tools", "assistant");

  return graph.compile({
    checkpointer: options.checkpointer ?? new MemorySaver(),
    store: options.store ?? new InMemoryStore(),
  });
};

const agent = createAgent();

export { agent, createAgent };
export type { CreateAgentOptions };
