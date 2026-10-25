import { randomUUID } from "node:crypto";

import type { LanguageModelLike } from "@langchain/core/language_models/base";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { GraphNode } from "@langchain/langgraph";

import { comparisonSeasonStartYear } from "../comparison-context.js";
import { createInitialRequestState } from "../state.js";
import type { AgentState, AgentStateType, RequestState } from "../state.js";

const lookupPrompt = `你是一个足球资料助手。回答球员查询时先调用 search_player_records 工具，根据工具返回的来源记录作答。
当前结构化请求已解析出的球员身份是本轮查询目标。单球员查询只回答这位球员，不要从历史消息引入或补充其他球员。只有工具的 identityGroups 中被同一个 canonical Reep ID 归组的来源记录，才能视为同一球员。保留 Understat 和 Football Manager 各自的数据与来源，不要把不同含义的字段混成一个指标。不要补猜缺失值、当前球队、合同、身价或转会可行性。说明来源、赛事和赛季；没有证据时明确说未知。`;

const comparisonPrompt = `你是一个足球资料助手。当前请求是多人球员比较，必须只依据本轮 compare_player_records 工具结果作答。
优先用表格逐项呈现全部已确认球员。Understat 表现数据只能在相同赛事和赛季内比较；sharedUnderstatScopes 只包含至少两名球员有记录的范围。某个范围缺少球员记录时，要明确标出，不得据此给所有球员排名。Football Manager 的能力值和属性单独呈现，不要把它们说成比赛表现，也不要与 Understat 指标合并成综合分。
没有共同赛事和赛季时，说明资料覆盖不足。如果 status 是 insufficient_distinct_players，说明这些称呼最终只对应一名不同球员，并请用户补充其他球员；不要要求用户重新指认已确认的身份。当 identityBasis 为 thread_confirmed 时，说明这些来源记录是用户在当前 thread 确认归为同一球员，Reep 注册表尚未关联。不要补猜缺失值、当前球队、合同、身价、转会可行性或谁整体更强。说明来源、赛事和赛季；没有证据时明确说未知。`;

const playerIdentityDescription = (
  canonicalIdentityId: string | null,
  identityBasis: string | undefined
): string => {
  if (canonicalIdentityId !== null) {
    return `已验证 Reep ID ${canonicalIdentityId}`;
  }

  if (identityBasis === "thread_confirmed") {
    return "用户已在当前 thread 确认这些来源记录属于同一球员；Reep 注册表尚未关联";
  }

  if (identityBasis === "source_selection") {
    return "用户明确选择了单一来源记录；当前请求不扩展到其他来源";
  }

  return "用户确认了来源记录，跨来源身份仍未验证";
};

const formatRequestContext = (request: RequestState): string => {
  const resolvedPlayers = request.players.flatMap((player) => {
    const { resolution } = player;

    if (resolution?.status !== "resolved") {
      return [];
    }

    const selectedCandidate = resolution.candidates.find(
      (candidate) => candidate.candidateId === resolution.selectedCandidateId
    );

    const identity = playerIdentityDescription(
      resolution.canonicalIdentityId,
      selectedCandidate?.identityBasis
    );

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

const resolvedComparisonPlayers = (request: RequestState) =>
  request.players.flatMap((player) => {
    const { resolution } = player;

    if (resolution?.status !== "resolved") {
      return [];
    }

    const selectedCandidate = resolution.candidates.find(
      (candidate) => candidate.candidateId === resolution.selectedCandidateId
    );

    return [
      {
        canonicalIdentityId: resolution.canonicalIdentityId,
        identityBasis:
          selectedCandidate?.identityBasis ??
          (resolution.canonicalIdentityId === null
            ? "source_record"
            : "reep_registry"),
        playerName: resolution.selectedName ?? player.mention,
        sourceRecords:
          selectedCandidate?.records.map(({ provider, sourceId }) => ({
            provider,
            sourceId,
          })) ?? [],
      },
    ];
  });

const hasComparisonResult = (messages: AgentStateType["messages"]): boolean =>
  messages.some(
    (message) =>
      message instanceof ToolMessage &&
      message.name === "compare_player_records"
  );

const createComparisonToolCall = (request: RequestState): AIMessage => {
  const seasonStartYear = comparisonSeasonStartYear(request.constraints);

  const args = {
    players: resolvedComparisonPlayers(request),
    seasonStartYear,
    source: "both",
  };

  return new AIMessage({
    content: "",
    tool_calls: [
      {
        args,
        id: randomUUID(),
        name: "compare_player_records",
        type: "tool_call",
      },
    ],
  });
};

const createAssistantNode =
  (
    model: LanguageModelLike,
    modelWithTools: LanguageModelLike
  ): GraphNode<typeof AgentState> =>
  async (state) => {
    const request = state.request ?? createInitialRequestState();
    const requestContext = formatRequestContext(request);

    if (request.kind === "player_comparison") {
      const currentTurnMessages = messagesForCurrentTurn(state.messages);

      if (!hasComparisonResult(currentTurnMessages)) {
        return { messages: [createComparisonToolCall(request)] };
      }

      const response = await model.invoke([
        new SystemMessage(
          [comparisonPrompt, requestContext].filter(Boolean).join("\n\n")
        ),
        ...currentTurnMessages,
      ]);

      return { messages: [response] };
    }

    const hasOneResolvedPlayer =
      request.players.length === 1 &&
      request.players[0]?.resolution?.status === "resolved";

    const assistantMessages = hasOneResolvedPlayer
      ? messagesForCurrentTurn(state.messages)
      : state.messages;

    const response = await modelWithTools.invoke([
      new SystemMessage(
        [lookupPrompt, requestContext].filter(Boolean).join("\n\n")
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
