import type { LanguageModelLike } from "@langchain/core/language_models/base";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { latestHumanMessage, messageText } from "../player-mentions.js";
import type {
  AgentState,
  AgentStateType,
  ConversationPlayerReference,
  RequestPlayerState,
} from "../state.js";

const lookupPrompt = `你是一个足球资料助手。回答球员查询时先调用 search_player_records 工具。系统已通过身份解析选定了精确的来源记录 ID；必须原样使用工具调用中提供的 sourceRecords，不得按姓名另行搜索、替换或补充 ID。只依据工具结果作答，不要把同名记录当作同一人。保留 Understat 和 Football Manager 各自的数据与来源，不要把不同含义的字段混成一个指标。不要补猜缺失值、当前球队、合同、身价或转会可行性。说明来源、赛事和赛季；没有证据时明确说未知。`;

const comparisonPrompt = `你是一个足球资料助手。当前请求是多人球员比较，只能依据下面提供的结构化比较结果作答。优先用表格逐项呈现全部已确认球员。Understat 表现数据只能在相同赛事和赛季内比较；共享范围缺少球员记录时要标明，不得据此给所有球员排名。Football Manager 的能力值和属性单独呈现，不要把它们说成比赛表现，也不要与 Understat 指标合并成综合分。没有共同赛事和赛季时，说明资料覆盖不足。不要补猜缺失值、当前球队、合同、身价、转会可行性或谁整体更强。`;

const recommendationPrompt = `你是一个足球资料助手。当前请求是 FM 球员能力推荐，只能依据下面提供的结构化推荐结果作答，不得自行重排、补算或引入外部资料。当前能力相似名单按目标位置属性 RMSE 排序；高潜名单若出现，则按 PA 降序，当前属性距离只用于并列。两份名单回答不同问题，不要合并成一个综合分。PA 是潜力信号，不是未来 CA 预测或保证。高潜榜描述该位置的高潜球员，不代表他们都像参考球员。说明多参考平均画像代表接近算术平均，不保证同时接近每位参考球员。只展示工具结果中的姓名、数值、位置、快照和特征差；不要补猜当前球队、合同、费用、转会可行性、表现或未来属性。`;

const currentTurnMessages = (messages: AgentStateType["messages"]) => {
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

const resolvedRecords = (player: RequestPlayerState) => {
  const { resolution } = player;

  if (resolution?.status !== "resolved") {
    return [];
  }

  const candidate = resolution.candidates.find(
    (item) => item.candidateId === resolution.selectedCandidateId
  );

  return (
    candidate?.records.map(({ provider, sourceId }) => ({
      provider,
      sourceId,
    })) ?? []
  );
};

const resolvedReference = (
  player: RequestPlayerState
): ConversationPlayerReference | null => {
  const { resolution } = player;

  if (resolution?.status !== "resolved") {
    return null;
  }

  const candidate = resolution.candidates.find(
    (item) => item.candidateId === resolution.selectedCandidateId
  );

  return candidate === undefined
    ? null
    : {
        candidate,
        referenceId: candidate.canonicalIdentityId ?? candidate.candidateId,
      };
};

const lookupResultSchema = z.object({
  fm: z.object({ status: z.string() }).optional(),
  understat: z.object({ status: z.string() }).optional(),
});

const hasSearchData = (message: ToolMessage): boolean => {
  const content = z.string().safeParse(message.content);

  if (!content.success) {
    return false;
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(content.data);
  } catch {
    return false;
  }

  const result = lookupResultSchema.safeParse(parsedJson);

  return (
    result.success &&
    (result.data.fm?.status === "found" ||
      result.data.understat?.status === "found")
  );
};

const pinSearchToResolvedIdentity = (
  response: AIMessage,
  player: RequestPlayerState
): AIMessage => {
  const sourceRecords = resolvedRecords(player);
  let changed = false;

  const toolCalls = (response.tool_calls ?? []).map((call) => {
    if (call.name !== "search_player_records") {
      return call;
    }

    changed = true;

    const seasonStartYear = z
      .number()
      .safeParse(call.args.seasonStartYear).data;

    return {
      ...call,
      args:
        seasonStartYear === undefined
          ? { sourceRecords }
          : { seasonStartYear, sourceRecords },
    };
  });

  return changed
    ? new AIMessage({
        additional_kwargs: response.additional_kwargs,
        content: response.content,
        id: response.id,
        invalid_tool_calls: response.invalid_tool_calls,
        name: response.name,
        response_metadata: response.response_metadata,
        tool_calls: toolCalls,
        usage_metadata: response.usage_metadata,
      })
    : response;
};

const unresolvedIdentityAnswer = (state: AgentStateType): string => {
  const unresolved = state.request.players.find(
    (player) => player.resolution?.status !== "resolved"
  );

  return unresolved
    ? `我还不能确认“${unresolved.mention}”对应哪位球员。请补充完整姓名或球队线索。`
    : "我还不能确认所有目标球员的身份，请补充完整姓名或球队线索。";
};

const requestBoundaryAnswer = (state: AgentStateType): string => {
  const { request } = state;

  if (request.kind === "player_lookup") {
    return request.players.length === 0
      ? "请告诉我你要查询哪位球员。"
      : unresolvedIdentityAnswer(state);
  }

  if (request.kind === "player_comparison") {
    if (request.players.length < 2) {
      return request.comparisonAction === "add"
        ? "当前线程没有可继续添加的球员比较。请先提供至少两名球员开始比较。"
        : "球员比较至少需要两名球员，请提供完整的比较对象。";
    }

    return unresolvedIdentityAnswer(state);
  }

  if (request.kind === "player_recommendation") {
    const hasReference = request.players.some(
      (player) => player.recommendationRole === "reference"
    );

    if (!hasReference) {
      return "请提供至少一名参考球员；明确不想要的人可以另行标注为排除对象。";
    }

    if (
      request.players.some(
        (player) => player.recommendationRole === "ambiguous"
      )
    ) {
      return "请说明每位球员是能力参考对象，还是需要从候选中排除。";
    }

    return unresolvedIdentityAnswer(state);
  }

  if (request.kind === "team_recommendation") {
    return "我已经识别到这是球队推荐请求；当前版本还没有接通球队推荐流程。";
  }

  return "当前版本支持查询、比较和推荐球员资料。请说明你要完成哪一种任务。";
};

const fixedOutcomeMessages = new Map<string, string>([
  [
    "data_unavailable",
    "本地 FM 快照无法读取。本次请求没有执行，之前完成的推荐仍然保留。",
  ],
  [
    "excluded_profile_missing",
    "要排除的球员没有对应的 FM source ID，无法可靠应用排除条件。",
  ],
  [
    "insufficient_distinct_players",
    "这些称呼最终只对应一名不同球员，请补充其他比较对象。",
  ],
  [
    "insufficient_reference_data",
    "参考球员没有可用的 FM source ID 或画像，无法计算推荐。",
  ],
  [
    "invalid_constraint",
    "推荐条件超出当前 FM 数据的有效范围，没有按修改后的条件生成候选。",
  ],
  [
    "invalid_task_state",
    "请求状态不完整，未执行数据计算。请重新描述这项任务。",
  ],
  [
    "reference_not_position_capable",
    "至少一名参考球员在目标位置的 FM 位置评分低于 15，无法按该位置计算。",
  ],
  [
    "reference_profile_ambiguous",
    "一个已确认身份对应多个 FM 画像，请先明确要使用的 FM source record。",
  ],
  ["reference_profile_missing", "参考球员没有对应的 FM 画像，无法计算推荐。"],
  [
    "reference_required",
    "请提供至少一名身份已确认的参考球员，再进行能力推荐。",
  ],
  [
    "tool_error",
    "本次数据计算失败，之前完成的查询结果仍然保留。请检查本地数据后重试。",
  ],
  [
    "unsupported_constraints",
    "请求包含当前流程无法计算的硬条件，因此没有按删减后的条件生成候选。请删除该条件或改用支持的条件。",
  ],
  [
    "unsupported_position",
    "目标位置当前没有可用的 FM 属性映射或符合门槛的候选，请选择其他位置。",
  ],
]);

const fixedOutcomeAnswer = (status: string): string | null => {
  const knownMessage = fixedOutcomeMessages.get(status);

  if (knownMessage !== undefined) {
    return knownMessage;
  }

  return status.endsWith("_tool_unavailable")
    ? "当前部署没有启用这项任务所需的数据工具。"
    : null;
};

const createLookupPlayerNode =
  (
    modelWithTools: LanguageModelLike,
    hasSearchTool = true
  ): GraphNode<typeof AgentState> =>
  async (state) => {
    if (!hasSearchTool) {
      return {
        outcome: {
          kind: "player_lookup",
          resultJson: null,
          status: "lookup_tool_unavailable",
        },
      };
    }

    const [player] = state.request.players;

    const sourceRecords = player === undefined ? [] : resolvedRecords(player);

    if (sourceRecords.length === 0) {
      return {
        outcome: {
          kind: "player_lookup",
          resultJson: null,
          status: "no_confirmed_source_records",
        },
      };
    }

    const messages = currentTurnMessages(state.messages);

    const response = await modelWithTools.invoke([
      new SystemMessage(lookupPrompt),
      ...messages,
    ]);

    const assistantMessage =
      response instanceof AIMessage && player !== undefined
        ? pinSearchToResolvedIdentity(response, player)
        : response;

    const currentMessages = [...messages, assistantMessage];

    const latestSearchResult = currentMessages.findLast(
      (message): message is ToolMessage =>
        message instanceof ToolMessage &&
        message.name === "search_player_records"
    );

    const { conversationContext } = state;

    const focusPlayers =
      latestSearchResult !== undefined && hasSearchData(latestSearchResult)
        ? state.request.players.flatMap((requestPlayer) => {
            const reference = resolvedReference(requestPlayer);

            return reference === null ? [] : [reference];
          })
        : conversationContext.focusPlayers;

    return {
      conversationContext:
        focusPlayers === conversationContext.focusPlayers
          ? conversationContext
          : { ...conversationContext, focusPlayers },
      messages: [assistantMessage],
      outcome:
        response instanceof AIMessage && (response.tool_calls ?? []).length > 0
          ? state.outcome
          : {
              kind: "player_lookup",
              resultJson: null,
              status: "answer_ready",
            },
    };
  };

const createAnswerNode =
  (model: LanguageModelLike): GraphNode<typeof AgentState> =>
  async (state) => {
    const { outcome } = state;

    if (outcome === null) {
      return { messages: [new AIMessage(requestBoundaryAnswer(state))] };
    }

    if (outcome.kind === "player_lookup") {
      if (outcome.status === "answer_ready") {
        return {};
      }

      const message =
        outcome.status === "no_confirmed_source_records"
          ? "身份已确认，但本地数据源中没有与该身份绑定的可读记录。"
          : (fixedOutcomeAnswer(outcome.status) ??
            "当前请求无法完成球员资料查询。请检查已确认的身份和数据源记录。");

      return { messages: [new AIMessage(message)] };
    }

    const fixedAnswer = fixedOutcomeAnswer(outcome.status);

    if (fixedAnswer !== null) {
      return { messages: [new AIMessage(fixedAnswer)] };
    }

    if (outcome.resultJson === null) {
      return {
        messages: [new AIMessage("本次请求没有生成可供解释的结构化结果。")],
      };
    }

    const prompt =
      outcome.kind === "player_comparison"
        ? comparisonPrompt
        : recommendationPrompt;

    const latestUserMessage = latestHumanMessage(state.messages);
    const requestText = latestUserMessage ? messageText(latestUserMessage) : "";

    const response = await model.invoke([
      new SystemMessage(prompt),
      new HumanMessage(
        `用户请求：${requestText}\n\n结构化工具结果：\n${outcome.resultJson}`
      ),
    ]);

    return { messages: [response] };
  };

export { createAnswerNode, createLookupPlayerNode };
