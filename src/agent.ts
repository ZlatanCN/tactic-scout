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
  createReferenceClarificationNode,
  createReferenceMentionExtractor,
  createReferenceResolutionNode,
  createUnresolvedReferenceNode,
} from "./utils/nodes.js";
import type { ReferenceMentionExtractor } from "./utils/nodes.js";
import { AgentState } from "./utils/state.js";
import { createTools, resolvePlayerReference } from "./utils/tools.js";
import type { ReferenceIdentityLookup } from "./utils/tools.js";

type CreateAgentOptions = {
  model?: BaseChatModel;
  tools?: StructuredToolInterface[];
  referenceMentionExtractor?: ReferenceMentionExtractor;
  referenceIdentityLookup?: ReferenceIdentityLookup;
  checkpointer?: BaseCheckpointSaver;
  store?: BaseStore;
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
  const resolveReference = createReferenceResolutionNode(
    options.referenceMentionExtractor ?? createReferenceMentionExtractor(model),
    options.referenceIdentityLookup ?? resolvePlayerReference,
  );

  const graph = new StateGraph(AgentState)
    .addNode("resolve_reference", resolveReference)
    .addNode("confirm_reference", createReferenceClarificationNode())
    .addNode("identity_unresolved", createUnresolvedReferenceNode())
    .addNode(
      "assistant",
      createAssistantNode(modelWithTools),
    )
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "resolve_reference")
    .addConditionalEdges(
      "resolve_reference",
      (state) => state.referenceResolution.status === "needs_confirmation"
        || state.referenceResolution.status === "not_found"
        || state.referenceResolution.status === "registry_unavailable"
        ? "confirm_reference"
        : state.referenceResolution.status === "clarification_exhausted"
          ? "identity_unresolved"
          : "assistant",
      ["confirm_reference", "identity_unresolved", "assistant"],
    )
    .addEdge("confirm_reference", "resolve_reference")
    .addEdge("identity_unresolved", END)
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
