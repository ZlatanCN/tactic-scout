import type { LanguageModelLike } from "@langchain/core/language_models/base";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { GraphNode } from "@langchain/langgraph";

import { createInitialRequestState } from "../state.js";
import type { AgentState, AgentStateType, RequestState } from "../state.js";

const assistantPrompt = `你是一个足球资料助手。回答当前支持的球员查询时先调用 search_player_records 工具，根据工具返回的来源记录作答。
当前结构化请求已解析出的球员身份是本轮查询目标。单球员查询只回答这位球员，不要从历史消息引入或补充其他球员。只有工具的 identityGroups 中被同一个 canonical Reep ID 归组的来源记录，才能视为同一球员。保留 Understat 和 Football Manager 各自的数据与来源，不要把不同含义的字段混成一个指标。不要补猜缺失值、当前球队、合同、身价或转会可行性。说明来源、赛事和赛季；没有证据时明确说未知。`;

const formatRequestContext = (request: RequestState): string => {
  const resolvedPlayers = request.players.flatMap((player) => {
    const { resolution } = player;

    if (resolution?.status !== "resolved") {
      return [];
    }

    const identity =
      resolution.canonicalIdentityId === null
        ? "用户确认了来源记录，跨来源身份仍未验证"
        : `已验证 Reep ID ${resolution.canonicalIdentityId}`;

    return [
      `“${player.mention}”对应“${resolution.selectedName ?? resolution.mention}”，${identity}。`,
    ];
  });

  const teamContext = request.teams.length
    ? `球队提及：${request.teams.join("、")}。`
    : "";

  const constraintText = request.constraints
    .map((item) => [item.name, item.value].join("="))
    .join("；");

  const constraintContext =
    constraintText.length > 0 ? `用户条件：${constraintText}。` : "";

  return [
    `结构化请求类型：${request.kind}。`,
    ...resolvedPlayers,
    teamContext,
    constraintContext,
  ]
    .filter(Boolean)
    .join("\n");
};

const messagesForCurrentTurn = (messages: AgentStateType["messages"]) => {
  let latestUserMessageIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index] instanceof HumanMessage) {
      latestUserMessageIndex = index;
      break;
    }
  }

  return latestUserMessageIndex < 0
    ? messages
    : messages.slice(latestUserMessageIndex);
};

const pinResolvedPlayerSearch = (
  response: AIMessage,
  request: RequestState
): AIMessage => {
  if (request.players.length !== 1) {
    return response;
  }

  const resolution = request.players[0]?.resolution;

  const selectedName =
    resolution?.status === "resolved" ? resolution.selectedName : null;

  const toolCalls = response.tool_calls ?? [];

  if (
    selectedName === null ||
    selectedName.length === 0 ||
    toolCalls.length === 0
  ) {
    return response;
  }

  let changed = false;

  const pinnedToolCalls = toolCalls.map((toolCall) => {
    if (toolCall.name !== "search_player_records") {
      return toolCall;
    }

    if (toolCall.args.playerName === selectedName) {
      return toolCall;
    }

    changed = true;

    return {
      ...toolCall,
      args: { ...toolCall.args, playerName: selectedName },
    };
  });

  if (!changed) {
    return response;
  }

  return new AIMessage({
    additional_kwargs: response.additional_kwargs,
    content: response.content,
    id: response.id,
    invalid_tool_calls: response.invalid_tool_calls,
    name: response.name,
    response_metadata: response.response_metadata,
    tool_calls: pinnedToolCalls,
    usage_metadata: response.usage_metadata,
  });
};

const createAssistantNode =
  (model: LanguageModelLike): GraphNode<typeof AgentState> =>
  async (state) => {
    const request = state.request ?? createInitialRequestState();
    const requestContext = formatRequestContext(request);

    const hasOneResolvedPlayer =
      request.players.length === 1 &&
      request.players[0]?.resolution?.status === "resolved";

    const assistantMessages = hasOneResolvedPlayer
      ? messagesForCurrentTurn(state.messages)
      : state.messages;

    const response = await model.invoke([
      new SystemMessage(
        [assistantPrompt, requestContext].filter(Boolean).join("\n\n")
      ),
      ...assistantMessages,
    ]);

    return {
      messages: [
        response instanceof AIMessage
          ? pinResolvedPlayerSearch(response, request)
          : response,
      ],
    };
  };

export { createAssistantNode };
