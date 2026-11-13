import { randomUUID } from "node:crypto";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import { correctComparisonAnswer } from "../comparison-answer.js";
import {
  comparisonAnswerMessages,
  comparisonBatchIsComplete,
  comparisonEvidenceAnswerText,
} from "../comparison-evidence.js";
import {
  contextProcessingSourceMessage,
  latestContextProcessingSourceMessage,
} from "../context-processing-continuation.js";
import {
  contextProcessingHash,
  contextProcessingInputText,
} from "../context-processing-state.js";
import { scoutingEvidenceProjections } from "../lookup-evidence.js";
import { invokeWithModelContext } from "../model-context.js";
import type { ModelContextConfiguration } from "../model-context.js";
import { createModelRequestBudget } from "../model-requests.js";
import type {
  ModelRequestBudgetOptions,
  ModelRuntime,
} from "../model-requests.js";
import { selectedReferenceCandidate } from "../player-data/contracts.js";
import {
  latestHumanMessage,
  messagesInCurrentTurn,
  messageText,
} from "../player-mentions.js";
import { playerRecommendationEvidenceIsComplete } from "../player-recommendation-evidence.js";
import {
  primaryOverflowRecoveryBudgetOptions,
  primaryOverflowRecoveryFor,
  settlePrimaryOverflowRecovery,
} from "../primary-overflow-recovery.js";
import {
  completeRecommendationResultAnswer,
  completeTeamRecommendationResultAnswer,
  correctRecommendationAnswer,
  correctTeamRecommendationAnswer,
} from "../recommendation-answer.js";
import type {
  AgentState,
  AgentStateType,
  EvidenceBatchState,
  RequestConstraint,
  RequestPlayerState,
} from "../state.js";
import { teamRecommendationBatchIsComplete } from "../team-recommendation-evidence.js";
import { comparisonEvidenceMatchesCurrentOutcome } from "./comparison-evidence.js";
import { lookupEvidenceMatchesCurrentOutcome } from "./lookup-evidence.js";
import {
  playerRecommendationEvidenceAnswerText,
  playerRecommendationEvidenceMatchesCurrentOutcome,
} from "./player-recommendation-evidence.js";
import {
  teamRecommendationEvidenceAnswerText,
  teamRecommendationEvidenceMatchesCurrentOutcome,
} from "./team-recommendation-evidence.js";

const lookupPrompt = `你是一个足球资料助手。回答球员查询时先调用 search_player_records 工具。系统已通过身份解析选定了精确的来源记录 ID；必须原样使用工具调用中提供的 sourceRecords，不得按姓名另行搜索、替换或补充 ID。数据源分工必须严格遵守：Understat 提供按赛事和赛季变化的出场次数、分钟、进球、助攻、射门、xG、xA 等表现记录；Football Manager 是固定日期的能力快照，只用于该快照中的 CA、PA、自然位置和属性。不得用 FM 信息替代、推导或描述当前或赛季表现，也不得用它确认当前俱乐部、注册状态、伤病、可用性或转会状态。任何强时效性事实都必须由实际返回且覆盖所问时间范围的来源支持；没有这样的来源时明确说资料不足。Understat 只支持其返回的赛事和赛季记录，不代表实时状态。用户同时询问不同类型的信息时分别依据对应来源回答；其中一个来源没有返回记录时，明确说明缺失。用户明确指定赛季时必须按请求中的 seasonStartYear 查询，不要改成最新赛季；用户未指定赛季时省略 seasonStartYear，工具默认使用快照最新赛季。最终回答只报告返回记录中的 season；除非工具结果明确标出 latest snapshot，否则不要声称这就是数据库最新赛季。如果用户明确写了赛季，但 requestedUnderstatSeasonStartYear 为 null，表示该写法没有转换为查询范围；不要把默认最新赛季说成用户要求的赛季，请用户补充完整赛季范围，不要推断世纪或把单一年份当作赛季。

若返回结果包含 understat，requestedUnderstatSeasonStartYear 表示用户明确指定的 Understat 查询年份；当 understat.status 为 found 或 not_found 且该字段为 null 时，工具使用快照最新赛季；当 understat.status 为 unavailable 时，不能声称查到了任何赛季记录。若结果中没有 understat，则本次没有查询 Understat。球员查询只按 sourceRecords 与可选 seasonStartYear 搜索，不按用户指定赛事过滤。若 Understat 返回 not_found 或 records 为空，只说明所选来源和查询年份没有返回记录，例如“Understat 没有返回这位球员在 2024/25 的记录；返回结果里没有 xG 数值”。不得把空结果解释为球员没有该赛事记录、xG 在现实中不可用，或某个更广泛事实。用户要求具体赛事且 action input 没有 competition 字段时，可以说明本次查询没有传入赛事过滤条件，但答案只描述所选来源、赛季和实际返回结果。

最终回答不要从记忆猜测或复述 source ID；只有用户明确询问且该 ID 出现在本次返回的具体记录中时才可提供。只依据工具结果作答，不要把同名记录当作同一人。保留 Understat 和 Football Manager 各自的数据与来源，不要把不同含义的字段混成一个指标。FM 的 techniqueRaw 表示“技术”，dribblingRaw 表示“盘带”；若缺少 dribblingRaw，必须说明未提供，不得把 techniqueRaw 的值写成“盘带”或“盘带技术”。Understat 的 appearances 字段只表示返回记录中的出场场次；只有该字段为具体数值时才能报告。若 appearances 为 null，明确说记录未提供出场场次；不得用分钟、进球、90 分钟换算或其他统计推算。若用户询问的字段没有返回数值，回答无法确定时，同时简要列出与问题相关、且确实返回的数值，保留原字段含义和标签；例如可报告 goals 或 minutes，但不得把它们换算或称为 appearances。Understat 的 team 字段只表示对应赛事和赛季表现记录中的球队，不代表当前注册球队。用户询问当前俱乐部或注册球队时，只有来源明确提供当前注册信息才能回答；如果只有 Understat 赛季记录，只能标为“该赛事/赛季记录中的球队”，并明确当前注册无法从资料确定。不要使用“当前俱乐部”或“Current club”作为标题或字段名，除非某个来源明确提供了当前注册信息；也不要把 Understat.team 值放在该标题下。无论用户用中文还是英文询问当前俱乐部，都遵守此规则。不要补猜缺失值、合同、身价或转会可行性。说明来源、赛事和赛季；没有证据时明确说未知。`;

const lookupFollowUpPrompt =
  "你在回答对最近一次球员资料查询的追问。输入可能是从完整已验证查询结果生成的 scouting evidence projection。只依据提供的投影和 coverage 作答；source_null 表示来源明确返回 null，未选择的字段不表示来源缺失，unavailable 和 not_queried 也要分别说明。保留精确记录、canonical / unlinked 身份关系、来源、实际赛季和查询赛季语义。当 understat seasonMode=explicit_unresolved 时，说明用户明确写了赛季，但程序没有把它转换为查询范围；不能把 default_snapshot 的记录当成所请求的赛季，要求用户补充完整范围。不得补猜、改写来源或引入外部事实。";

const lookupProjectionPrompt = `工具结果可能是从已验证完整结果生成的 scouting evidence projection。digest、批次范围、记录引用、来源和 coverage 由程序生成。state=source_null 表示来源明确返回 null；unselectedFields 表示没有选择，不能当作缺失；unavailable、not_found、not_queried 含义不同。当 understat seasonMode=explicit_unresolved 时，说明用户明确写了赛季但程序没有将其转换为查询范围，不要将 default_snapshot 记录当成用户所求范围。如果 batch.remainingRecordRefs 非空，当前消息只覆盖其中列出的批次；不要据此得出整份结果的结论，也不要为了读取剩余记录重复调用搜索工具，应用会逐批解释已保存结果。`;

const recommendationCandidateFields =
  "姓名、FM ID、年龄、位置评分、CA、PA 和 currentDistance";

const recommendationPositionRatingPrompt =
  "位置评分只报告工具返回的数值；除非结构化结果明确提供，否则不要补充评分量表或最大值。";

const potentialCandidateFieldsPrompt = `高潜名单的每一行也必须包括${recommendationCandidateFields}。`;

const recommendationFilterCountsPrompt = `筛选计数只表示各自阶段的结果，不得互换、相减或用候选列表长度反推。eligiblePositionProfiles 是通过位置评分门槛的数量；afterAge 是再应用年龄条件后的数量；afterCurrentAbility 是再应用 CA 条件后的数量；afterPotentialAbility 是再应用 PA 条件后的数量；afterIdentityExclusion 是应用请求中的身份排除规则后剩余的数量，除非工具列出具体对象，否则不要推断具体排除了谁或属于哪类身份；currentAttributeComplete 是身份排除后属性完整、能计算 currentDistance 的数量；excludedMissingAttribute 是身份排除后因距离属性不完整而无法排名的数量；excludedMissingPotentialForPotentialList 是因 PA 缺失而无法进入高潜名单的数量；excludedMissingFmIdCandidates 是来源中缺少 FM ID 的记录数。currentCandidates 和 potentialCandidates 是经过排名并受 resultLimit 限制的返回名单，名单长度不等于任何阶段数量。resultLimit 分别限制 currentCandidates 和 potentialCandidates 各自的名单数，不是两份名单合计的上限。因此，resultLimit 为 1 时，两份名单可以各返回 1 名球员。球员推荐只能从 filters.resultLimit 读取名单上限，球队推荐只能从 recommendation.filters.resultLimit 读取；不得从名单长度或 afterIdentityExclusion 推断上限，字段为 null 时不要声称存在数字上限。只引用与问题相关的实际字段值，不推断未提供的筛选原因。`;

const recommendationPrompt = `你是一个足球资料助手。当前请求是 FM 球员能力推荐，只能依据下面提供的结构化推荐结果作答，不得自行重排、补算或引入外部资料。为每个所选参考画像说明 FM ID、CA 和 PA，并与候选名单分开呈现；候选只来自工具返回的名单，不得把同一身份关联的其他 FM 资料补进候选。年龄只使用工具返回的 age 和 ageAsOfDate，年龄按 ageAsOfDate 标注；不要说成 FM 快照日年龄。CA、PA 和属性来自 FM snapshotDate。

当前能力相似名单必须按工具返回的 rank 顺序逐条列出 currentCandidates 中的每一个候选，不得省略较后排名。每行至少包括${recommendationCandidateFields}。${recommendationPositionRatingPrompt}PA 仅作为资料展示，不参与当前相似度排序；potentialAbility 为 null 时写“未提供”。

若 potentialCandidates 不是 null，须把其中每名候选单独列在高潜名单中，按工具结果的 PA 顺序，不得与当前能力相似名单合并。${potentialCandidateFieldsPrompt}如果 filterCounts.excludedMissingPotentialForPotentialList 大于 0，说明有多少画像因 PA 缺失而没有进入高潜排序；这不表示他们的 PA 低。${recommendationFilterCountsPrompt}currentCandidates 为空时说明对应阶段实际筛选结果；只有 filterCounts.eligiblePositionProfiles 为 0，才能说没有位置合格画像。两份名单回答不同问题，不要合并成一个综合分。PA 是潜力信号，不是未来 CA 预测或保证。高潜榜描述该位置的高潜球员，不代表球员都像参考球员。说明多参考平均画像代表接近算术平均，不保证同时接近每位参考球员。不要补猜当前球队、合同、费用、转会可行性、表现或未来属性。`;

const teamRecommendationPrompt = `你是一个足球资料助手。当前请求是指定球队和位置的 FM 能力推荐，只能依据下面提供的结构化结果作答，不得自行重排、补算或引入外部资料。说明球队、目标位置、阵容数据来源与获取日期、FM 快照日期、已映射人数和映射方式。“已映射”表示阵容成员链接到一个可用的本地 FM 画像，不代表该成员在目标位置达到位置评分门槛；Reep 桥接、用户确认、无本地画像和待确认成员数按工具提供的阵容覆盖统计说明。候选按工具返回的 RMSE 顺序呈现；只说明 recommendation.references 中列出的队内参考对象。必须读取顶层 rankingBasis 并说明对应计算方式：equal_weight_mean_of_position_capable_squad_profiles 表示选取目标位置评分至少 15 且该位置所需属性完整的队内 FM 画像，对该位置所需属性取等权平均；named_fm_reference_profile 表示使用用户指定的 FM 参考画像。不要推断团队参考画像的成员筛选标准或计算方法，除非 recommendation 结果明确提供。rankingBasis 已提供时不得说工具没有提供参考对象的筛选标准或计算方法。当前阵容所有已映射 FM 球员都已排除。年龄只使用工具返回的 age 和 recommendation.ageAsOfDate；年龄按该日期标注，不能说成 FM 快照年龄。CA、PA 和属性使用 FM 快照日期。

逐条列出 recommendation.currentCandidates 中的每一名候选，不得省略较后排名。每行至少包括${recommendationCandidateFields}。${recommendationPositionRatingPrompt}PA 仅作为资料展示，不参与 RMSE 排序；potentialAbility 为 null 时写“未提供”。若 recommendation.potentialCandidates 不是 null，须把其中每名球员另列为高潜候选，按 PA 排序，不与当前能力名单合并；${potentialCandidateFieldsPrompt}如果 recommendation.filterCounts.excludedMissingPotentialForPotentialList 大于 0，说明有多少画像因 PA 缺失而没有进入高潜排序；这不表示他们的 PA 低。

读取 recommendation.filterCounts 时要区分筛选阶段。${recommendationFilterCountsPrompt}recommendation.currentCandidates 为空时说明对应阶段实际筛选结果；只有 recommendation.filterCounts.eligiblePositionProfiles 为 0，才能说没有位置合格画像。必须说明这些结果只反映 FM 属性画像相似，不代表战术适配或转会可行性。

不要推断阵容缺口、战术适配、转会可行性、合同、费用、当前球队或未来属性。`;

const resolvedRecords = (player: RequestPlayerState) => {
  const candidate = selectedReferenceCandidate(player.resolution);

  return (
    candidate?.records.map(({ provider, sourceId }) => ({
      provider,
      sourceId,
    })) ?? []
  );
};

const seasonStartYearFromConstraints = (
  constraints: RequestConstraint[]
): number | undefined => {
  const value = constraints.find(
    ({ name }) => name === "understatSeasonStartYear"
  )?.value;

  const parsedStartYear = z
    .string()
    .regex(/^20\d{2}$/u)
    .safeParse(value);

  if (!parsedStartYear.success) {
    return undefined;
  }

  const year = Number(parsedStartYear.data);

  return year >= 2000 && year <= 2100 ? year : undefined;
};

const lookupToolMessagesForModel = (
  messages: BaseMessage[],
  question: string,
  recordsPerBatch?: number
): BaseMessage[] =>
  messages.map((message) => {
    if (
      !(message instanceof ToolMessage) ||
      message.name !== "search_player_records"
    ) {
      return message;
    }

    const resultJson = z.string().safeParse(message.content);

    if (!resultJson.success) {
      return message;
    }

    const projections = scoutingEvidenceProjections(
      resultJson.data,
      question,
      "executed",
      recordsPerBatch
    );

    const projection = projections?.[0];

    if (projection === undefined) {
      return message;
    }

    return new ToolMessage({
      content: projection,
      id: message.id,
      name: message.name,
      response_metadata: message.response_metadata,
      status: message.status,
      tool_call_id: message.tool_call_id,
    });
  });

const messagesForLookupModel = (state: AgentStateType) => {
  const latestMessage = latestHumanMessage(state.messages);

  const sourceMessage =
    latestMessage === undefined
      ? undefined
      : contextProcessingSourceMessage(state, latestMessage);

  const messages =
    sourceMessage === undefined || sourceMessage === latestMessage
      ? messagesInCurrentTurn(state.messages)
      : [sourceMessage];

  const recovery = state.providerOverflowRecovery;

  const recordsPerBatch =
    recovery?.node === "lookup_player" &&
    recovery.recoveryAllowanceOpen &&
    recovery.primaryRequestReserved
      ? 1
      : undefined;

  if (sourceMessage === undefined) {
    return messages;
  }

  const question = messageText(sourceMessage);
  const { compaction } = state.contextProcessing;

  if (
    compaction === null ||
    compaction.status !== "ready" ||
    compaction.instruction === null
  ) {
    return lookupToolMessagesForModel(messages, question, recordsPerBatch);
  }

  const sourceMessageId = sourceMessage.id ?? compaction.sourceMessageId;
  const originalText = messageText(sourceMessage);

  const sourceText = contextProcessingInputText(
    originalText,
    sourceMessageId,
    state.contextProcessing.clarification
  );

  if (
    compaction.sourceMessageId !== sourceMessageId ||
    compaction.sourceHash !== contextProcessingHash(sourceText) ||
    compaction.instructionHash !== contextProcessingHash(compaction.instruction)
  ) {
    return lookupToolMessagesForModel(messages, question, recordsPerBatch);
  }

  const clarificationAnswers =
    sourceText === originalText
      ? []
      : (state.contextProcessing.clarification?.answers.toReversed() ?? []);

  const compactedInstructionWithClarifications = [
    ...clarificationAnswers,
    compaction.instruction,
  ].join("\n\n");

  const workingMessage = new HumanMessage({
    additional_kwargs: sourceMessage.additional_kwargs,
    content: compactedInstructionWithClarifications,
    id: sourceMessage.id,
    name: sourceMessage.name,
    response_metadata: sourceMessage.response_metadata,
  });

  return lookupToolMessagesForModel(
    messages.map((message) =>
      message === sourceMessage ? workingMessage : message
    ),
    sourceText,
    recordsPerBatch
  );
};

const pinSearchToResolvedIdentity = (
  response: AIMessage,
  player: RequestPlayerState,
  requestedSeasonStartYear?: number
): AIMessage => {
  const sourceRecords = resolvedRecords(player);
  let changed = false;

  const toolCalls = (response.tool_calls ?? []).map((call) => {
    if (call.name !== "search_player_records") {
      return call;
    }

    changed = true;

    const seasonStartYear = requestedSeasonStartYear;

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

const requiredLookupToolCall = (
  player: RequestPlayerState,
  requestedSeasonStartYear?: number
): AIMessage => {
  const sourceRecords = resolvedRecords(player);

  return new AIMessage({
    content: "",
    tool_calls: [
      {
        args:
          requestedSeasonStartYear === undefined
            ? { sourceRecords }
            : { seasonStartYear: requestedSeasonStartYear, sourceRecords },
        id: `lookup-${randomUUID()}`,
        name: "search_player_records",
        type: "tool_call",
      },
    ],
  });
};

const executedLookupOutcome = (state: AgentStateType) => {
  const { outcome } = state;

  return outcome?.kind === "player_lookup" &&
    "source" in outcome &&
    outcome.source === "executed"
    ? outcome
    : null;
};

const lookupSearchIsRequired = (input: {
  hasExecutedLookup: boolean;
  message: BaseMessage;
  player: RequestPlayerState | undefined;
  searchExecutions: number;
}): boolean => {
  if (!(input.message instanceof AIMessage)) {
    return false;
  }

  if ((input.message.tool_calls ?? []).length > 0) {
    return false;
  }

  if ((input.message.invalid_tool_calls ?? []).length > 0) {
    return false;
  }

  return (
    input.player !== undefined &&
    input.searchExecutions === 0 &&
    !input.hasExecutedLookup
  );
};

const lookupAssistantUpdate = (
  state: AgentStateType,
  assistantMessage: BaseMessage
) => {
  const hasToolCalls =
    assistantMessage instanceof AIMessage &&
    (assistantMessage.tool_calls ?? []).length > 0;

  const executed = executedLookupOutcome(state);

  if (hasToolCalls || executed !== null) {
    return {
      messages: [assistantMessage],
      outcome:
        !hasToolCalls && executed !== null
          ? { ...executed, status: "answer_ready" as const }
          : state.outcome,
    };
  }

  return {
    messages: [assistantMessage],
    outcome: {
      kind: "player_lookup" as const,
      resultJson: null,
      status: "answer_ready" as const,
    },
  };
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
    "目前无法从本地数据中取得完成这次请求所需的信息，因此无法给出结果。",
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
    "saved_result_unavailable",
    "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。",
  ],
  [
    "lookup_search_limit",
    "本轮球员查询触及 3 次搜索上限，本次查询未完成。请缩小查询范围后重试。",
  ],
  ["tool_error", "本次数据计算失败。请检查本地数据后重试。"],
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
            pendingMembers: z.number(),
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

const hasCompletedThreadResult = (state: AgentStateType): boolean => {
  const context = state.conversationContext;

  if (context === undefined) {
    return false;
  }

  return (
    context.activeLookup !== null ||
    context.activeComparison.players.length >= 2 ||
    context.activeRecommendation !== null ||
    context.activeTeamRecommendation !== null
  );
};

const withPreservedResultNotice = (
  state: AgentStateType,
  message: string
): string =>
  hasCompletedThreadResult(state)
    ? `${message}此前已完成的结果仍保留。`
    : message;

const completedResultExplanationFailure =
  "数据查询或计算已经完成，但模型暂时无法生成解释。已完成的结构化结果仍保留，可以继续追问。";

const contextBudgetIssueAnswer = (
  state: AgentStateType,
  issue: NonNullable<
    AgentStateType["faultTolerance"]["failure"]
  >["contextIssue"]
): string | null => {
  if (
    issue === "profile_required" ||
    issue === "invalid_profile" ||
    issue === "output_limit_adapter_required"
  ) {
    return "无法安全准备模型上下文预算，请为当前模型和端点配置有效的输入窗口与输出上限。本次未继续调用模型。";
  }

  if (issue === "base_instructions_exceed_limit") {
    return "系统指令或工具 schema 本身超过模型上下文预算，本次没有调用模型。请检查当前模型和预算配置。";
  }

  if (issue === "user_input_exceeds_limit") {
    return "本轮用户指令超过模型可用上下文预算，尚未执行查询或推荐。请缩短指令或拆成更小的问题。";
  }

  if (issue === "input_exceeds_limit" || issue === "provider_overflow") {
    return withPreservedResultNotice(
      state,
      "本轮模型输入超过可用上下文预算，当前任务未能继续。"
    );
  }

  if (issue === "response_truncated") {
    return withPreservedResultNotice(
      state,
      "模型输出达到长度上限，未将不完整内容作为最终答案。"
    );
  }

  return null;
};

const completedResultAfterContextFailure = (
  state: AgentStateType
): string | null => {
  const { failure } = state.faultTolerance;
  const { outcome } = state;

  if (failure?.node !== "answer" && failure?.node !== "lookup_player") {
    return null;
  }

  if (
    outcome === null ||
    !("source" in outcome) ||
    outcome.resultJson === null
  ) {
    return null;
  }

  return outcome.resultJson;
};

const contextLimitFailureAnswer = (state: AgentStateType): string => {
  const { failure } = state.faultTolerance;
  const completedResult = completedResultAfterContextFailure(state);

  if (completedResult !== null) {
    return `上下文预算不足，模型解释未完成。以下是本次已完成并验证的完整结构化结果与来源：\n\n${completedResult}`;
  }

  return (
    contextBudgetIssueAnswer(state, failure?.contextIssue) ??
    withPreservedResultNotice(
      state,
      "无法安全估算本轮模型输入，当前任务未能继续。"
    )
  );
};

const teamFailureAnswer = (state: AgentStateType): string | null => {
  const { outcome } = state;

  if (outcome?.kind !== "team_recommendation" || outcome.resultJson === null) {
    return null;
  }

  if (outcome.status === "team_provider_error") {
    const providerFailure = parseProviderFailure(outcome.resultJson);

    if (providerFailure === null) {
      return withPreservedResultNotice(
        state,
        "API-Football 阵容服务暂时不可用，本次球队推荐没有完成。"
      );
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
        : `映射到可用本地 FM 画像 ${coverage.mappedMembers}/${coverage.totalMembers} 人（Reep 桥接 ${coverage.reepBridgeMappings}，人工确认 ${coverage.userConfirmedMappings}），无本地画像 ${coverage.noLocalProfileMembers} 人，待确认 ${coverage.pendingMembers} 人。`;

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

  if (status === "identity_data_unavailable") {
    const player = state.request.players.find(
      ({ resolution }) => resolution?.status === "data_unavailable"
    );

    const message =
      player === undefined
        ? "本轮无法确认球员身份，查询已暂停。"
        : `无法确认“${player.mention}”对应的球员身份，本次查询已暂停。`;

    return withPreservedResultNotice(state, message);
  }

  const knownMessage = fixedOutcomeMessages.get(status);

  if (knownMessage !== undefined) {
    if (status === "data_unavailable" || status === "tool_error") {
      return withPreservedResultNotice(state, knownMessage);
    }

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

  if (failure.category === "context_limit") {
    return contextLimitFailureAnswer(state);
  }

  if (failure.node === "answer" && state.outcome !== null) {
    return completedResultExplanationFailure;
  }

  if (
    failure.category === "authentication" ||
    failure.category === "configuration"
  ) {
    return "模型服务凭据或配置无效，请检查模型网关配置后重试。";
  }

  if (failure.category === "quota") {
    return withPreservedResultNotice(
      state,
      "模型服务额度已用完，本次请求没有完成。"
    );
  }

  if (failure.category === "rate_limit") {
    return withPreservedResultNotice(
      state,
      "模型服务正在限流，本次请求没有完成。"
    );
  }

  if (failure.node === "understand_request") {
    return withPreservedResultNotice(
      state,
      "请求理解模型暂时不可用，因此没有执行这条新请求。"
    );
  }

  if (failure.node === "lookup_player") {
    if (
      state.faultTolerance.lookupSearchExecutions > 0 &&
      state.conversationContext.activeLookup !== null
    ) {
      return "球员数据查询已完成，但模型暂时无法生成解释。查询结果已保存，可以继续追问。";
    }

    return withPreservedResultNotice(
      state,
      "球员查询模型暂时不可用，本次查询未能完成。请稍后重试。"
    );
  }

  return state.outcome === null
    ? withPreservedResultNotice(state, "模型服务暂时不可用，本次请求没有完成。")
    : completedResultExplanationFailure;
};

const playerMemoryNotice = (state: AgentStateType): string => {
  const notices: string[] = [];

  const memoryStatus = state.playerMemoryStatus ?? {
    readFailed: false,
    writeFailed: false,
  };

  if (memoryStatus.readFailed) {
    notices.push(
      "这次无法读取跨对话的球员身份记忆，我已改用当前资料继续核对。"
    );
  }

  if (memoryStatus.writeFailed) {
    notices.push(
      "当前对话中的身份确认仍然有效，但未能保存到跨对话记忆；新对话可能需要再次确认。"
    );
  }

  return notices.join("\n\n");
};

const createFaultAnswerNode = (): GraphNode<typeof AgentState> => (state) => {
  const answer = [faultFailureAnswer(state), playerMemoryNotice(state)]
    .filter((part) => part.length > 0)
    .join("\n\n");

  return { messages: [new AIMessage(answer)] };
};

const createLookupPlayerNode =
  (
    model: BaseChatModel,
    lookupTool: StructuredToolInterface | undefined,
    modelContextConfiguration: ModelContextConfiguration = {}
  ): GraphNode<typeof AgentState> =>
  async (state, runtime) => {
    if (lookupTool === undefined) {
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

    const messages = messagesForLookupModel(state);

    if (state.faultTolerance.lookupLimitReached) {
      return {
        outcome: {
          kind: "player_lookup",
          resultJson: null,
          status: "lookup_search_limit",
        },
      };
    }

    const sourceMessage = latestContextProcessingSourceMessage(state);

    const recovery =
      sourceMessage === undefined
        ? null
        : primaryOverflowRecoveryFor(
            state,
            "lookup_player",
            sourceMessage,
            state.messages.length
          );

    const budgetOptions: ModelRequestBudgetOptions =
      primaryOverflowRecoveryBudgetOptions(
        state,
        recovery,
        runtime.executionInfo?.runId
      );

    const budget = createModelRequestBudget(
      runtime,
      "lookup_player",
      undefined,
      budgetOptions
    );

    const requestMessages = [
      new SystemMessage(`${lookupPrompt}\n\n${lookupProjectionPrompt}`),
      ...messages,
    ];

    const response = await invokeWithModelContext(
      model,
      {
        messages: requestMessages,
        purpose: "lookup_player",
        tools: [lookupTool],
      },
      modelContextConfiguration,
      runtime,
      async (limitedModel, signal) => {
        const modelWithTools = limitedModel.bindTools?.([lookupTool]);

        if (modelWithTools === undefined) {
          throw new Error("配置的聊天模型不支持工具调用。");
        }

        return await modelWithTools.invoke(requestMessages, { signal });
      },
      budget
    );

    const modelMessage =
      response instanceof BaseMessage ? response : new AIMessage(response);

    const pinnedMessage =
      modelMessage instanceof AIMessage && player !== undefined
        ? pinSearchToResolvedIdentity(
            modelMessage,
            player,
            seasonStartYearFromConstraints(state.request.constraints)
          )
        : modelMessage;

    const assistantMessage = lookupSearchIsRequired({
      hasExecutedLookup: executedLookupOutcome(state) !== null,
      message: pinnedMessage,
      player,
      searchExecutions: state.faultTolerance.lookupSearchExecutions,
    })
      ? requiredLookupToolCall(
          player,
          seasonStartYearFromConstraints(state.request.constraints)
        )
      : pinnedMessage;

    return settlePrimaryOverflowRecovery(
      state,
      recovery,
      budget,
      lookupAssistantUpdate(state, assistantMessage),
      runtime.executionInfo?.runId
    );
  };

const assistantTextContentSchema = z.array(
  z.looseObject({ text: z.string(), type: z.literal("text") })
);

const assistantTextFromContent = (
  content: BaseMessage["content"]
): string | null => {
  const directText = z.string().safeParse(content);

  if (directText.success) {
    return directText.data;
  }

  const textBlocks = assistantTextContentSchema.safeParse(content);

  return textBlocks.success
    ? textBlocks.data.map(({ text }) => text).join("")
    : null;
};

const answerWithPlayerMemoryNotice = (
  state: AgentStateType,
  answer: BaseMessage
): BaseMessage => {
  const notice = playerMemoryNotice(state);

  if (notice.length === 0) {
    return answer;
  }

  const answerText = assistantTextFromContent(answer.content);

  const content = answerText === null ? notice : `${answerText}\n\n${notice}`;

  return new AIMessage({ content, id: answer.id ?? undefined });
};

const lookupAnswerUpdate = (
  state: AgentStateType
): Partial<AgentStateType> | null => {
  const status = state.outcome?.status;

  if (status !== "answer_ready" && status !== "data_ready") {
    return null;
  }

  const notice = playerMemoryNotice(state);

  if (notice.length === 0) {
    return {};
  }

  return {
    messages: [
      answerWithPlayerMemoryNotice(
        state,
        state.messages.at(-1) ?? new AIMessage("")
      ),
    ],
  };
};

const correctionForOutcomeAnswer = (
  answer: string,
  outcome: AgentStateType["outcome"]
): string | null => {
  if (outcome === null || outcome.resultJson === null) {
    return null;
  }

  if (outcome.kind === "player_comparison") {
    return correctComparisonAnswer(answer, outcome.resultJson);
  }

  if (outcome.kind === "player_recommendation") {
    return correctRecommendationAnswer(answer, outcome.resultJson);
  }

  if (outcome.kind === "team_recommendation") {
    return correctTeamRecommendationAnswer(answer, outcome.resultJson);
  }

  return null;
};

const recommendationAnswerMessage = (
  message: BaseMessage,
  outcome: AgentStateType["outcome"]
): BaseMessage => {
  const answer = assistantTextFromContent(message.content);

  if (answer === null) {
    return message;
  }

  const correction = correctionForOutcomeAnswer(answer, outcome);

  return correction === null ? message : new AIMessage(correction);
};

const completedLookupEvidenceAnswer = (
  state: AgentStateType
): BaseMessage | null => {
  if (!lookupEvidenceMatchesCurrentOutcome(state)) {
    return null;
  }

  const { outcome } = state;
  const lookupEvidence = state.lookupEvidence ?? null;

  if (
    outcome?.kind !== "player_lookup" ||
    outcome.resultJson === null ||
    lookupEvidence === null
  ) {
    return null;
  }

  if (lookupEvidence.status === "complete") {
    const answers = lookupEvidence.batches.map(({ answer }) => answer);

    if (answers.some((answer) => answer === null)) {
      return new AIMessage(
        `查询数据已完整保存，但解释未完成。以下是完整结果与来源：\n\n${outcome.resultJson}`
      );
    }

    const text = answers.join("\n\n");

    const answer =
      lookupEvidence.batches.length > 1
        ? `按来源记录分别说明：\n\n${text}`
        : text;

    return answerWithPlayerMemoryNotice(state, new AIMessage(answer));
  }

  if (
    lookupEvidence.status === "allowance_exhausted" ||
    lookupEvidence.status === "failed"
  ) {
    return new AIMessage(
      `查询数据已完整保存，但模型解释未完成。以下是完整结果与来源：\n\n${outcome.resultJson}`
    );
  }

  return null;
};

const completedComparisonEvidenceAnswer = (
  state: AgentStateType,
  model: BaseChatModel,
  modelContextConfiguration: ModelContextConfiguration
): BaseMessage | null => {
  if (
    !comparisonEvidenceMatchesCurrentOutcome(state, {
      model,
      modelContextConfiguration,
    })
  ) {
    return null;
  }

  const { outcome } = state;
  const evidence = state.comparisonEvidence;

  if (
    outcome?.kind !== "player_comparison" ||
    outcome.resultJson === null ||
    evidence === null
  ) {
    return null;
  }

  if (evidence.status === "complete") {
    if (!comparisonBatchIsComplete(evidence, outcome.resultJson)) {
      return new AIMessage(
        `比较数据已完整验证，但分批解释未完成。以下是完整比较结果与来源：\n\n${outcome.resultJson}`
      );
    }

    const answer = comparisonEvidenceAnswerText(evidence);

    return answer === null
      ? new AIMessage(
          `比较数据已完整验证，但解释未完成。以下是完整比较结果与来源：\n\n${outcome.resultJson}`
        )
      : answerWithPlayerMemoryNotice(state, new AIMessage(answer));
  }

  return new AIMessage(
    `比较数据已完整验证，但分批解释未完成。以下是完整比较结果与来源：\n\n${outcome.resultJson}`
  );
};

const recommendationEvidenceAnswerLanguage = (
  state: AgentStateType
): "en" | "zh" => {
  const message = latestContextProcessingSourceMessage(state);

  const content = message === undefined ? "" : messageText(message);

  return /\p{Script=Han}/u.test(content) ? "zh" : "en";
};

type RecommendationEvidenceFinalization = {
  answerText: (
    evidence: EvidenceBatchState,
    resultJson: string
  ) => string | null;
  complete: (evidence: EvidenceBatchState, resultJson: string) => boolean;
  fallbackText: (resultJson: string, language: "en" | "zh") => string | null;
  incompleteNotice: string;
};

const completedRecommendationEvidenceMessage = (
  state: AgentStateType,
  evidence: EvidenceBatchState,
  resultJson: string,
  finalization: RecommendationEvidenceFinalization
): BaseMessage => {
  if (
    evidence.status === "complete" &&
    finalization.complete(evidence, resultJson)
  ) {
    const answer = finalization.answerText(evidence, resultJson);

    if (answer !== null) {
      return answerWithPlayerMemoryNotice(state, new AIMessage(answer));
    }
  }

  const completeAnswer = finalization.fallbackText(
    resultJson,
    recommendationEvidenceAnswerLanguage(state)
  );

  return new AIMessage(
    `${finalization.incompleteNotice}\n\n${completeAnswer ?? resultJson}`
  );
};

const completedPlayerRecommendationEvidenceAnswer = (
  state: AgentStateType,
  model: BaseChatModel,
  modelContextConfiguration: ModelContextConfiguration
): BaseMessage | null => {
  if (
    !playerRecommendationEvidenceMatchesCurrentOutcome(state, {
      model,
      modelContextConfiguration,
    })
  ) {
    return null;
  }

  const { outcome, playerRecommendationEvidence: evidence } = state;

  if (
    outcome?.kind !== "player_recommendation" ||
    outcome.resultJson === null ||
    evidence === null
  ) {
    return null;
  }

  return completedRecommendationEvidenceMessage(
    state,
    evidence,
    outcome.resultJson,
    {
      answerText: playerRecommendationEvidenceAnswerText,
      complete: playerRecommendationEvidenceIsComplete,
      fallbackText: completeRecommendationResultAnswer,
      incompleteNotice:
        "推荐数据已完整验证，但分批解释未完成。以下是完整名单和来源：",
    }
  );
};

const completedTeamRecommendationEvidenceAnswer = (
  state: AgentStateType,
  model: BaseChatModel,
  modelContextConfiguration: ModelContextConfiguration
): BaseMessage | null => {
  if (
    !teamRecommendationEvidenceMatchesCurrentOutcome(state, {
      model,
      modelContextConfiguration,
    })
  ) {
    return null;
  }

  const { outcome, teamRecommendationEvidence: evidence } = state;

  if (
    outcome?.kind !== "team_recommendation" ||
    outcome.resultJson === null ||
    evidence === null
  ) {
    return null;
  }

  return completedRecommendationEvidenceMessage(
    state,
    evidence,
    outcome.resultJson,
    {
      answerText: teamRecommendationEvidenceAnswerText,
      complete: teamRecommendationBatchIsComplete,
      fallbackText: completeTeamRecommendationResultAnswer,
      incompleteNotice:
        "球队推荐数据已完整验证，但分批解释未完成。以下是完整名单和来源：",
    }
  );
};

const createAnswerNode = (
  model: BaseChatModel,
  modelContextConfiguration: ModelContextConfiguration = {}
): GraphNode<typeof AgentState> => {
  const invokeAnswerModel = async (
    messages: BaseMessage[],
    runtime: ModelRuntime
  ) => {
    const budget = createModelRequestBudget(runtime, "answer");

    return await invokeWithModelContext(
      model,
      { messages, purpose: "answer" },
      modelContextConfiguration,
      runtime,
      async (limitedModel, signal) =>
        await limitedModel.invoke(messages, { signal }),
      budget
    );
  };

  const answerSavedLookupFollowUp = async (
    state: AgentStateType,
    runtime: ModelRuntime
  ) => {
    const latestUserMessage = latestContextProcessingSourceMessage(state);

    const requestText = latestUserMessage ? messageText(latestUserMessage) : "";
    const resultJson = state.outcome?.resultJson ?? "";

    const projections = scoutingEvidenceProjections(
      resultJson,
      requestText,
      "saved"
    );

    const projection = projections?.length === 1 ? projections[0] : null;

    const evidenceLabel =
      projection === null
        ? "已保存的查询结果 JSON："
        : "Scouting evidence projection JSON:";

    const evidenceJson = projection ?? resultJson;

    const response = await invokeAnswerModel(
      [
        new SystemMessage(lookupFollowUpPrompt),
        new HumanMessage(
          `用户追问：${requestText}\n\n${evidenceLabel}\n${evidenceJson}`
        ),
      ],
      runtime
    );

    const answer =
      response instanceof BaseMessage ? response : new AIMessage(response);

    return { messages: [answerWithPlayerMemoryNotice(state, answer)] };
  };

  return async (state, runtime) => {
    const { outcome } = state;

    if (outcome === null) {
      return {
        messages: [
          answerWithPlayerMemoryNotice(
            state,
            new AIMessage(requestBoundaryAnswer(state))
          ),
        ],
      };
    }

    const comparisonEvidenceAnswer = completedComparisonEvidenceAnswer(
      state,
      model,
      modelContextConfiguration
    );

    if (comparisonEvidenceAnswer !== null) {
      return { messages: [comparisonEvidenceAnswer] };
    }

    const playerRecommendationEvidenceAnswer =
      completedPlayerRecommendationEvidenceAnswer(
        state,
        model,
        modelContextConfiguration
      );

    if (playerRecommendationEvidenceAnswer !== null) {
      return { messages: [playerRecommendationEvidenceAnswer] };
    }

    const teamRecommendationEvidenceAnswer =
      completedTeamRecommendationEvidenceAnswer(
        state,
        model,
        modelContextConfiguration
      );

    if (teamRecommendationEvidenceAnswer !== null) {
      return { messages: [teamRecommendationEvidenceAnswer] };
    }

    if (outcome.kind === "player_lookup") {
      const evidenceAnswer = completedLookupEvidenceAnswer(state);

      if (evidenceAnswer !== null) {
        return { messages: [evidenceAnswer] };
      }

      if (
        outcome.status === "lookup_follow_up" &&
        outcome.resultJson !== null
      ) {
        return await answerSavedLookupFollowUp(state, runtime);
      }

      const readyUpdate = lookupAnswerUpdate(state);

      if (readyUpdate !== null) {
        return readyUpdate;
      }

      const message =
        outcome.status === "no_confirmed_source_records"
          ? "身份已确认，但本地数据源中没有与该身份绑定的可读记录。"
          : (fixedOutcomeAnswer(state) ??
            "当前请求无法完成球员资料查询。请检查已确认的身份和数据源记录。");

      return {
        messages: [answerWithPlayerMemoryNotice(state, new AIMessage(message))],
      };
    }

    const fixedAnswer = fixedOutcomeAnswer(state);

    if (fixedAnswer !== null) {
      return {
        messages: [
          answerWithPlayerMemoryNotice(state, new AIMessage(fixedAnswer)),
        ],
      };
    }

    if (outcome.resultJson === null) {
      return {
        messages: [
          answerWithPlayerMemoryNotice(
            state,
            new AIMessage("本次请求没有生成可供解释的结构化结果。")
          ),
        ],
      };
    }

    let prompt = recommendationPrompt;

    if (outcome.kind === "team_recommendation") {
      prompt = teamRecommendationPrompt;
    }

    const latestUserMessage = latestContextProcessingSourceMessage(state);

    const requestText = latestUserMessage ? messageText(latestUserMessage) : "";

    const messages =
      outcome.kind === "player_comparison"
        ? comparisonAnswerMessages(requestText, outcome.resultJson)
        : [
            new SystemMessage(prompt),
            new HumanMessage(
              `用户请求：${requestText}\n\n结构化工具结果：\n${outcome.resultJson}`
            ),
          ];

    const response = await invokeAnswerModel(messages, runtime);

    const answer =
      response instanceof BaseMessage ? response : new AIMessage(response);

    return {
      messages: [
        answerWithPlayerMemoryNotice(
          state,
          recommendationAnswerMessage(answer, outcome)
        ),
      ],
    };
  };
};

export { createAnswerNode, createFaultAnswerNode, createLookupPlayerNode };
