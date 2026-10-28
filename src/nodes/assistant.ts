import type { LanguageModelLike } from "@langchain/core/language_models/base";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { createModelRequestBudget } from "../model-requests.js";
import type { ModelRuntime } from "../model-requests.js";
import { selectedReferenceCandidate } from "../player-data/contracts.js";
import {
  latestHumanMessage,
  messagesInCurrentTurn,
  messageText,
} from "../player-mentions.js";
import type {
  AgentState,
  AgentStateType,
  RequestPlayerState,
} from "../state.js";

const lookupPrompt = `你是一个足球资料助手。回答球员查询时先调用 search_player_records 工具。系统已通过身份解析选定了精确的来源记录 ID；必须原样使用工具调用中提供的 sourceRecords，不得按姓名另行搜索、替换或补充 ID。只依据工具结果作答，不要把同名记录当作同一人。保留 Understat 和 Football Manager 各自的数据与来源，不要把不同含义的字段混成一个指标。Understat 的 team 字段只表示对应赛事和赛季表现记录中的球队，不代表当前注册球队。用户询问当前俱乐部或注册球队时，只有来源明确提供当前注册信息才能回答；如果只有 Understat 赛季记录，单独说明该赛季记录列出的球队，并明确当前注册无法从资料确定。不要补猜缺失值、合同、身价或转会可行性。说明来源、赛事和赛季；没有证据时明确说未知。`;

const lookupFollowUpPrompt =
  "你在回答对最近一次球员资料查询的追问。只能依据提供的已保存查询结果 JSON 作答；如果结果里没有用户问的字段，要明确说资料未包含。不得补猜、改写来源或引入外部事实。";

const comparisonPrompt = `你是一个足球资料助手。当前请求是多人球员比较，只能依据下面提供的结构化比较结果作答。优先用表格逐项呈现全部已确认球员。Understat 表现数据只能在相同赛事和赛季内比较；共享范围缺少球员记录时要标明，不得据此给所有球员排名。Football Manager 的能力值和属性单独呈现，不要把它们说成比赛表现，也不要与 Understat 指标合并成综合分。没有共同赛事和赛季时，说明资料覆盖不足。不要补猜缺失值、当前球队、合同、身价、转会可行性或谁整体更强。`;

const recommendationPrompt = `你是一个足球资料助手。当前请求是 FM 球员能力推荐，只能依据下面提供的结构化推荐结果作答，不得自行重排、补算或引入外部资料。当前能力相似名单按目标位置属性 RMSE 排序；高潜名单若出现，则按 PA 降序，当前属性距离只用于并列。两份名单回答不同问题，不要合并成一个综合分。PA 是潜力信号，不是未来 CA 预测或保证。高潜榜描述该位置的高潜球员，不代表他们都像参考球员。说明多参考平均画像代表接近算术平均，不保证同时接近每位参考球员。只展示工具结果中的姓名、数值、位置、快照和特征差；不要补猜当前球队、合同、费用、转会可行性、表现或未来属性。`;

const teamRecommendationPrompt = `你是一个足球资料助手。当前请求是指定球队和位置的 FM 能力推荐，只能依据下面提供的结构化结果作答，不得自行重排、补算或引入外部资料。说明球队、目标位置、阵容数据来源与获取日期、FM 快照日期、已映射人数和映射方式。团队参考画像是位置评分至少 15 且特征完整的队内球员属性等权平均；候选按同一位置属性 RMSE 排序，当前阵容所有已映射 FM 球员都已排除。若提供高潜榜，它按 PA 单独排序，不与当前能力相似度混成综合分。不要推断阵容缺口、战术适配、转会可行性、合同、费用、当前球队或未来属性。`;

const resolvedRecords = (player: RequestPlayerState) => {
  const candidate = selectedReferenceCandidate(player.resolution);

  return (
    candidate?.records.map(({ provider, sourceId }) => ({
      provider,
      sourceId,
    })) ?? []
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

const teamRequestBoundaryAnswer = (state: AgentStateType): string => {
  const { request } = state;

  if (request.kind !== "team_recommendation") {
    return "当前没有有效的球队推荐请求。";
  }

  if (request.teams.length > 1) {
    return "一次只能为一支球队生成推荐，请告诉我你要选哪一支。";
  }

  if (request.teamRecommendation.teamName === null) {
    return "请告诉我球队名称，例如阿森纳或 Bayern Munich。";
  }

  if (request.teamRecommendation.position === null) {
    return "请指定一个 FM 位置，例如 stc（中锋）、dc（中卫）或 dm（后腰）。";
  }

  return request.teamRecommendation.referenceMode === "named"
    ? unresolvedIdentityAnswer(state)
    : "球队推荐请求暂时无法继续，请重新提供一支球队和一个位置。";
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
    return teamRequestBoundaryAnswer(state);
  }

  return "当前版本支持查询、比较和推荐球员资料。请说明你要完成哪一种任务。";
};

const fixedOutcomeMessages = new Map<string, string>([
  [
    "data_unavailable",
    "本地球员数据源无法读取。本次请求没有执行，之前完成的结果仍然保留。",
  ],
  [
    "identity_data_unavailable",
    "本地球员身份资料无法读取。本次请求没有执行，之前完成的结果仍然保留。",
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
    "lookup_search_limit",
    "本轮球员查询最多执行 3 次搜索。已完成的搜索结果已保留，请基于现有结果继续追问，或发起新一轮查询。",
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
  ["team_required", "请告诉我球队名称和目标位置，再开始球队推荐。"],
  ["one_team_required", "一次只能为一支球队生成推荐，请告诉我你要选哪一支。"],
  [
    "team_not_found",
    "本地球队搜索没有找到匹配结果，请补充球队全名或所在国家。",
  ],
  [
    "team_roster_empty",
    "API-Football 没有返回这支球队的当前阵容，本次无法生成推荐。",
  ],
  [
    "team_roster_member_unmapped",
    "当前阵容中至少有一名球员无法映射到本地 FM 画像。为避免把队内球员推荐回来，本次已暂停。",
  ],
  [
    "team_identity_error",
    "读取本地 Reep 或 FM 身份资料失败，本次没有生成团队推荐。",
  ],
  ["reference_required", "请提供一名已确认身份的 FM 球员作为团队参考。"],
  [
    "team_recommendation_tool_unavailable",
    "当前部署没有启用球队推荐所需的数据工具。",
  ],
]);

const parseProviderFailure = (value: string) => {
  try {
    const parsed = z
      .object({ message: z.string(), status: z.literal("error") })
      .safeParse(JSON.parse(value));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const parseUnmappedRosterMember = (value: string) => {
  try {
    const parsed = z
      .object({
        apiFootballPlayerId: z.number(),
        mappingCoverage: z
          .object({
            mappedMembers: z.number(),
            noLocalProfileMembers: z.number(),
            reepBridgeMappings: z.number(),
            totalMembers: z.number(),
            userConfirmedMappings: z.number(),
          })
          .optional(),
        playerName: z.string(),
      })
      .safeParse(JSON.parse(value));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const teamFailureAnswer = (state: AgentStateType): string | null => {
  const { outcome } = state;

  if (outcome?.kind !== "team_recommendation" || outcome.resultJson === null) {
    return null;
  }

  if (outcome.status === "team_provider_error") {
    const providerFailure = parseProviderFailure(outcome.resultJson);

    if (providerFailure === null) {
      return "API-Football 阵容服务暂时不可用，本次推荐没有覆盖旧结果。";
    }

    return providerFailure.message;
  }

  if (outcome.status === "team_roster_member_unmapped") {
    const rosterMember = parseUnmappedRosterMember(outcome.resultJson);

    if (rosterMember === null) {
      return "当前阵容中有球员无法映射到本地 FM 画像，因此已暂停推荐。";
    }

    const coverage = rosterMember.mappingCoverage;

    const coverageSummary =
      coverage === undefined
        ? ""
        : `当前已映射 ${coverage.mappedMembers}/${coverage.totalMembers} 人（Reep ${coverage.reepBridgeMappings}，人工确认 ${coverage.userConfirmedMappings}），无本地画像 ${coverage.noLocalProfileMembers} 人。`;

    return `阵容成员“${rosterMember.playerName}”（API-Football ID ${rosterMember.apiFootballPlayerId}）没有可确认的本地 FM 画像，因此已暂停推荐。${coverageSummary}`;
  }

  return null;
};

const fixedOutcomeAnswer = (state: AgentStateType): string | null => {
  const status = state.outcome?.status ?? "";
  const teamFailure = teamFailureAnswer(state);

  if (teamFailure !== null) {
    return teamFailure;
  }

  const knownMessage = fixedOutcomeMessages.get(status);

  if (knownMessage !== undefined) {
    return knownMessage;
  }

  return status.endsWith("_tool_unavailable")
    ? "当前部署没有启用这项任务所需的数据工具。"
    : null;
};

const faultFailureAnswer = (state: AgentStateType): string => {
  const { failure } = state.faultTolerance;

  if (failure === null) {
    return "本次请求没有完成，请重新描述你的问题。";
  }

  if (
    failure.node === "understand_request" &&
    failure.category === "invalid_response"
  ) {
    return "我没能可靠理解这条新请求，因此没有执行任何球员或球队操作。请换个说法重试。";
  }

  if (
    failure.category === "authentication" ||
    failure.category === "configuration"
  ) {
    return "模型服务凭据或配置无效，请检查模型网关配置后重试。";
  }

  if (failure.category === "quota") {
    return "模型服务额度已用完。本次请求没有完成，已确认的数据和之前的结果仍保留。";
  }

  if (failure.category === "rate_limit") {
    return "模型服务正在限流。本次请求没有完成，已确认的数据和之前的结果仍保留。";
  }

  if (failure.node === "understand_request") {
    return "请求理解模型暂时不可用，因此没有执行这条新请求。之前已完成的结果仍保留。";
  }

  if (failure.node === "lookup_player") {
    return "球员查询模型暂时不可用，本次没有完成查询或切换已确认的球员身份。请稍后重试。";
  }

  return state.outcome === null
    ? "模型服务暂时不可用，本次请求没有完成。已确认的数据身份和之前的结果仍保留。"
    : "数据查询或计算已经完成，但模型暂时无法生成解释。已完成的结构化结果仍保留，可以继续追问。";
};

const createFaultAnswerNode = (): GraphNode<typeof AgentState> => (state) => ({
  messages: [new AIMessage(faultFailureAnswer(state))],
});

const createLookupPlayerNode =
  (
    modelWithTools: LanguageModelLike,
    hasSearchTool = true
  ): GraphNode<typeof AgentState> =>
  async (state, runtime) => {
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

    const messages = messagesInCurrentTurn(state.messages);

    if (state.faultTolerance.lookupLimitReached) {
      return {
        outcome: {
          kind: "player_lookup",
          resultJson: null,
          status: "lookup_search_limit",
        },
      };
    }

    const budget = createModelRequestBudget(runtime, "lookup_player");

    const response = await budget.invoke(
      async (signal) =>
        await modelWithTools.invoke(
          [new SystemMessage(lookupPrompt), ...messages],
          { signal }
        )
    );

    const modelMessage =
      response instanceof BaseMessage ? response : new AIMessage(response);

    const assistantMessage =
      modelMessage instanceof AIMessage && player !== undefined
        ? pinSearchToResolvedIdentity(modelMessage, player)
        : modelMessage;

    return {
      messages: [assistantMessage],
      outcome:
        assistantMessage instanceof AIMessage &&
        (assistantMessage.tool_calls ?? []).length > 0
          ? state.outcome
          : {
              kind: "player_lookup",
              resultJson: null,
              status: "answer_ready",
            },
    };
  };

const createAnswerNode = (
  model: LanguageModelLike
): GraphNode<typeof AgentState> => {
  const invokeAnswerModel = async (
    messages: BaseMessage[],
    runtime: ModelRuntime
  ) => {
    const budget = createModelRequestBudget(runtime, "answer");

    return await budget.invoke(
      async (signal) => await model.invoke(messages, { signal })
    );
  };

  return async (state, runtime) => {
    const { outcome } = state;

    if (outcome === null) {
      return { messages: [new AIMessage(requestBoundaryAnswer(state))] };
    }

    if (outcome.kind === "player_lookup") {
      if (
        outcome.status === "lookup_follow_up" &&
        outcome.resultJson !== null
      ) {
        const latestUserMessage = latestHumanMessage(state.messages);

        const requestText = latestUserMessage
          ? messageText(latestUserMessage)
          : "";

        const response = await invokeAnswerModel(
          [
            new SystemMessage(lookupFollowUpPrompt),
            new HumanMessage(
              `用户追问：${requestText}\n\n已保存的查询结果 JSON：\n${
                outcome.resultJson
              }`
            ),
          ],
          runtime
        );

        return { messages: [response] };
      }

      if (outcome.status === "answer_ready") {
        return {};
      }

      const message =
        outcome.status === "no_confirmed_source_records"
          ? "身份已确认，但本地数据源中没有与该身份绑定的可读记录。"
          : (fixedOutcomeAnswer(state) ??
            "当前请求无法完成球员资料查询。请检查已确认的身份和数据源记录。");

      return { messages: [new AIMessage(message)] };
    }

    const fixedAnswer = fixedOutcomeAnswer(state);

    if (fixedAnswer !== null) {
      return { messages: [new AIMessage(fixedAnswer)] };
    }

    if (outcome.resultJson === null) {
      return {
        messages: [new AIMessage("本次请求没有生成可供解释的结构化结果。")],
      };
    }

    let prompt = recommendationPrompt;

    if (outcome.kind === "player_comparison") {
      prompt = comparisonPrompt;
    } else if (outcome.kind === "team_recommendation") {
      prompt = teamRecommendationPrompt;
    }

    const latestUserMessage = latestHumanMessage(state.messages);
    const requestText = latestUserMessage ? messageText(latestUserMessage) : "";

    const response = await invokeAnswerModel(
      [
        new SystemMessage(prompt),
        new HumanMessage(
          `用户请求：${requestText}\n\n结构化工具结果：\n${outcome.resultJson}`
        ),
      ],
      runtime
    );

    return { messages: [response] };
  };
};

export { createAnswerNode, createFaultAnswerNode, createLookupPlayerNode };
