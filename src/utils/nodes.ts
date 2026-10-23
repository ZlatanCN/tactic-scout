import type { LanguageModelLike } from "@langchain/core/language_models/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { interrupt, type GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";
import type {
  AgentStateType,
  ConversationContext,
  ConversationPlayerReference,
  PlayerResolutionState,
  ReferenceCandidate,
  ReferenceLookupResult,
  RequestConstraint,
  RequestKind,
  RequestPlayerState,
  RequestState,
} from "./state.js";
import {
  AgentState,
  createInitialConversationContext,
  createInitialRequestState,
} from "./state.js";
import type { ReferenceIdentityLookup } from "./tools.js";

const assistantPrompt = `你是一个足球资料助手。回答当前支持的球员查询时先调用 search_player_records 工具，根据工具返回的来源记录作答。
当前结构化请求已解析出的球员身份是本轮查询目标。单球员查询只回答这位球员，不要从历史消息引入或补充其他球员。只有工具的 identityGroups 中被同一个 canonical Reep ID 归组的来源记录，才能视为同一球员。保留 Understat 和 Football Manager 各自的数据与来源，不要把不同含义的字段混成一个指标。不要补猜缺失值、当前球队、合同、身价或转会可行性。说明来源、赛事和赛季；没有证据时明确说未知。`;

const requestExtractionSchema = z.object({
  kind: z.enum([
    "player_lookup",
    "player_comparison",
    "player_recommendation",
    "team_recommendation",
    "other",
  ]),
  players: z.array(z.object({
    mention: z.string().describe("照抄用户本轮消息里的球员称呼。"),
    referenceScope: z.enum([
      "explicit",
      "prior_context",
      "same_turn",
      "ambiguous",
    ]).describe(
      "明确姓名为 explicit；代词指向前文焦点为 prior_context；指向本轮某个明确姓名为 same_turn；无法确定时为 ambiguous。",
    ),
    referenceTargetMention: z.string().nullable().describe(
      "same_turn 时照抄本轮中被代词指向的明确姓名；其他情况为 null。",
    ),
    lookupName: z.string().nullable().describe(
      "仅用于本地搜索的可能标准姓名；非 explicit 引用必须为 null，不能据此确认身份。",
    ),
  })),
  teams: z.array(z.string()).describe("照抄用户本轮消息里提到的球队名。"),
  constraints: z.array(z.object({
    name: z.string(),
    value: z.string(),
  })).describe("只记录用户明确提出的筛选条件，不要补猜。"),
});

const requestExtractionPrompt = `把用户本轮消息整理为一个请求类型和实体清单。输入还会包含本线程之前已确认的焦点球员和中文称呼绑定。
player_lookup：查询球员记录或画像；player_comparison：比较球员；player_recommendation：寻找球员或替代者；team_recommendation：为球队推荐球员；other：其他请求。
列出本轮消息里出现的所有球员称呼和球队。mention 必须照抄本轮原文。
用户明确写出球员姓名时 referenceScope=explicit。代词指向本轮之前的焦点球员时 referenceScope=prior_context；指向本轮较早出现的明确姓名时用 same_turn，并填入 referenceTargetMention；无法判断先行对象时用 ambiguous。
prior_context 只表示引用之前的焦点，不要用本轮另一个显式提到的球员替换它。比如“他比凯恩差”中的“他”引用之前的焦点，凯恩是比较对象。
所有非 explicit 引用的 lookupName 必须为 null，绝不能把代词当姓名查询。不要把上下文中的标准姓名伪装成本轮明确提及的姓名。
如果本轮原文中的明确称呼与 confirmedPlayerAliases 里已确认的称呼相同，它们指向同一身份；照抄 mention，lookupName 可以为 null，不要重新翻译或改绑。
像“我说的是基米希”这样的纠正要保留其中明确写出的球员称呼。
lookupName 只可填写本轮中文音译或简称对应的可能标准姓名，不能当作身份确认。只提取用户明确给出的条件。没有相关实体或条件时返回空数组。`;

const playerIdentityCorrectionPattern =
  /(?:我说的是|我指的是|我刚才说的是|我想说的是|我的意思是|i meant|i was referring to)/i;

type ExtractedPlayerMention = {
  mention: string;
  lookupName: string | null;
  referenceScope?: "explicit" | "prior_context" | "same_turn" | "ambiguous";
  referenceTargetMention?: string | null;
};
type ExtractedRequest = {
  kind: RequestKind;
  players: ExtractedPlayerMention[];
  teams: string[];
  constraints: RequestConstraint[];
};
type RequestUnderstandingExtractor = (
  message: string,
  context: ConversationContext,
) => Promise<ExtractedRequest>;

const createRequestUnderstandingExtractor = (
  model: BaseChatModel,
): RequestUnderstandingExtractor => {
  const structuredModel = model.withStructuredOutput(requestExtractionSchema);
  return async (message, context) => {
    const contextInput = {
      currentMessage: message,
      focusPlayers: context.focusPlayers.map(({ referenceId, candidate }) => ({
        referenceId,
        name: candidate.name,
        canonicalIdentityId: candidate.canonicalIdentityId,
        identityVerified: candidate.identityVerified,
      })),
      confirmedPlayerAliases: context.playerAliases.map(({ mention, reference }) => ({
        mention,
        referenceId: reference.referenceId,
        name: reference.candidate.name,
        canonicalIdentityId: reference.candidate.canonicalIdentityId,
      })),
    };
    const result = await structuredModel.invoke([
      new SystemMessage(requestExtractionPrompt),
      new HumanMessage(JSON.stringify(contextInput)),
    ]);
    return {
      kind: result.kind,
      players: result.players.flatMap((player) => {
        const mention = player.mention.trim();
        return mention
          ? [{
              mention,
              lookupName: player.lookupName?.trim() || null,
              referenceScope: player.referenceScope,
              referenceTargetMention: player.referenceTargetMention?.trim() || null,
            }]
          : [];
      }),
      teams: uniqueText(result.teams),
      constraints: result.constraints.flatMap((constraint) => {
        const name = constraint.name.trim();
        const value = constraint.value.trim();
        return name && value ? [{ name, value }] : [];
      }),
    };
  };
};

const createRequestUnderstandingNode = (
  extractRequest: RequestUnderstandingExtractor,
): GraphNode<typeof AgentState> => async (state) => {
  const currentRequest = state.request ?? createInitialRequestState();
  const conversationContext = state.conversationContext
    ?? createInitialConversationContext();
  const latestUserMessage = latestHumanMessage(state.messages);
  if (!latestUserMessage) return {};

  const messageId = latestUserMessage.id ?? null;
  if (messageId && messageId === currentRequest.processedMessageId) return {};

  const text = messageText(latestUserMessage);
  const extracted = await extractRequest(text, conversationContext);
  const confirmedAliases = findConfirmedPlayerAliasesInMessage(text, conversationContext);
  const extractedPlayers = [
    ...extracted.players,
    ...confirmedAliases.map((mention) => ({
      mention,
      lookupName: null,
      referenceScope: "explicit" as const,
    })),
  ];
  const players = normalizeExtractedPlayers(text, extractedPlayers).map((player) => ({
    ...player,
    resolution: null,
    attempts: 0,
  }));
  return {
    request: {
      status: "not_processed",
      kind: extracted.kind,
      players,
      teams: uniqueText(extracted.teams),
      constraints: extracted.constraints,
      processedMessageId: messageId,
      activePlayerIndex: null,
      clarificationMessage: null,
    },
    requestAnswer: null,
  };
};

const createEntityResolutionNode = (
  lookup: ReferenceIdentityLookup,
): GraphNode<typeof AgentState> => async (state) => {
  let request = state.request ?? createInitialRequestState();
  request = {
    ...request,
    players: request.players.map((player) => ({
      ...player,
      referenceScope: player.referenceScope ?? (
        isPlayerReferenceMention(player.mention) ? "prior_context" : "explicit"
      ),
    })),
  };
  const conversationContext = state.conversationContext
    ?? createInitialConversationContext();
  const latestUserMessage = latestHumanMessage(state.messages);
  const currentMessage = latestUserMessage ? messageText(latestUserMessage) : "";
  if (
    typeof state.requestAnswer === "string" &&
    request.activePlayerIndex !== null
  ) {
    request = await applyPlayerAnswer(request, state.requestAnswer, lookup);
    if (request.status === "clarification_exhausted") {
      return { request, requestAnswer: null };
    }
    if (request.status === "needs_confirmation") {
      return { request, requestAnswer: null };
    }
  }

  for (const referenceScope of [
    "explicit",
    "prior_context",
    "same_turn",
    "ambiguous",
  ] as const) {
    for (let index = 0; index < request.players.length; index += 1) {
      const player = request.players[index]!;
      if (player.referenceScope !== referenceScope) continue;
      if (player.resolution?.status === "resolved") continue;
      if (player.resolution) {
        return {
          request: {
            ...request,
            status: "needs_confirmation",
            activePlayerIndex: index,
            clarificationMessage:
              player.resolution.clarificationMessage ?? defaultClarification(player),
          },
        };
      }

      let resolution: PlayerResolutionState;
      if (referenceScope !== "explicit") {
        const references = resolveReferenceTargets(
          referenceScope,
          player.referenceTargetMention,
          request,
          conversationContext,
        );
        resolution = resolveConversationReference(player.mention, references);
      } else {
        const knownAlias = resolveConfirmedPlayerAlias(
          player.mention,
          conversationContext,
        );
        if (knownAlias) {
          resolution = knownAlias;
        } else {
          const lookupName = player.lookupName ?? player.mention;
          const result = await lookup(lookupName);
          const translatedOrExpanded = normalizeName(lookupName) !== normalizeName(player.mention);
          resolution = translatedOrExpanded && result.status === "resolved"
            ? {
                ...result,
                status: "needs_confirmation",
                mention: player.mention,
                selectedCandidateId: null,
                canonicalIdentityId: null,
                selectedName: null,
                clarificationMessage: `你写的是“${player.mention}”。本地资料中找到“${result.selectedName}”，请确认是否指这位球员。`,
              }
            : { ...result, mention: player.mention };
        }
      }

      request = {
        ...request,
        players: request.players.map((item, itemIndex) => itemIndex === index
          ? { ...item, resolution }
          : item),
      };

      if (resolution.status !== "resolved") {
        return {
          request: {
            ...request,
            status: "needs_confirmation",
            activePlayerIndex: index,
            clarificationMessage:
              resolution.clarificationMessage ?? defaultClarification(player),
          },
        };
      }
    }
  }

  const resolvedRequest = {
    ...request,
    status: "ready" as const,
    activePlayerIndex: null,
    clarificationMessage: null,
  };
  return {
    request: resolvedRequest,
    requestAnswer: null,
    ...(request.players.length
      ? {
          conversationContext: conversationContextFromRequest(
            resolvedRequest,
            conversationContext,
            playerIdentityCorrectionPattern.test(currentMessage),
          ),
        }
      : {}),
  };
};

const resolveReferenceTargets = (
  referenceScope: Exclude<RequestPlayerState["referenceScope"], "explicit">,
  targetMention: string | null,
  request: RequestState,
  context: ConversationContext,
): ConversationPlayerReference[] => {
  const currentRequestReferences = request.players.flatMap((requestPlayer) => {
    if (
      requestPlayer.referenceScope !== "explicit" ||
      requestPlayer.resolution?.status !== "resolved"
    ) return [];
    const reference = conversationPlayerFromResolution(requestPlayer.resolution);
    return reference ? [reference] : [];
  });

  if (referenceScope === "prior_context") return context.focusPlayers;
  if (referenceScope === "ambiguous") {
    return [...context.focusPlayers, ...currentRequestReferences];
  }

  const targetKey = targetMention ? normalizeMentionText(targetMention) : null;
  if (!targetKey) return [];
  return request.players.flatMap((requestPlayer) => {
    if (
      requestPlayer.referenceScope !== "explicit" ||
      requestPlayer.resolution?.status !== "resolved" ||
      normalizeMentionText(requestPlayer.mention) !== targetKey
    ) return [];
    const reference = conversationPlayerFromResolution(requestPlayer.resolution);
    return reference ? [reference] : [];
  });
};

const resolveConversationReference = (
  mention: string,
  references: ConversationPlayerReference[],
): PlayerResolutionState => {
  const uniqueReferences = uniqueConversationPlayers(references);
  if (uniqueReferences.length === 1) {
    const candidate = uniqueReferences[0]!.candidate;
    return {
      status: "resolved",
      mention,
      selectedCandidateId: candidate.candidateId,
      canonicalIdentityId: candidate.canonicalIdentityId,
      selectedName: candidate.name,
      candidates: [candidate],
      candidateCount: 1,
      candidatesTruncated: false,
      clarificationMessage: null,
    };
  }

  const candidates = uniqueReferences.map((reference) => reference.candidate);
  return {
    status: uniqueReferences.length ? "needs_confirmation" : "not_found",
    mention,
    selectedCandidateId: null,
    canonicalIdentityId: null,
    selectedName: null,
    candidates,
    candidateCount: candidates.length,
    candidatesTruncated: false,
    clarificationMessage: candidates.length
      ? `“${mention}”可能指本轮上下文中的多位球员，请选择候选编号。`
      : `当前对话里没有已确认的球员可供“${mention}”引用。请先提供球员姓名。`,
  };
};

const resolveConfirmedPlayerAlias = (
  mention: string,
  context: ConversationContext,
): PlayerResolutionState | null => {
  const mentionKey = normalizeMentionText(mention);
  if (!mentionKey) return null;
  const references = context.playerAliases.flatMap((alias) =>
    normalizeMentionText(alias.mention) === mentionKey ? [alias.reference] : []
  );
  return references.length ? resolveConversationReference(mention, references) : null;
};

const conversationPlayerFromResolution = (
  resolution: PlayerResolutionState,
): ConversationPlayerReference | null => {
  const candidate = resolution.candidates.find((item) =>
    item.candidateId === resolution.selectedCandidateId
  ) ?? (
    resolution.selectedCandidateId && resolution.selectedName
      ? {
          candidateId: resolution.selectedCandidateId,
          name: resolution.selectedName,
          canonicalIdentityId: resolution.canonicalIdentityId,
          identityVerified: resolution.canonicalIdentityId !== null,
          exactNameMatch: false,
          records: [],
        }
      : null
  );
  if (!candidate) return null;
  return {
    referenceId: candidate.canonicalIdentityId ?? candidate.candidateId,
    candidate,
  };
};

const uniqueConversationPlayers = (
  references: ConversationPlayerReference[],
): ConversationPlayerReference[] => {
  const seen = new Set<string>();
  return references.flatMap((reference) => {
    if (seen.has(reference.referenceId)) return [];
    seen.add(reference.referenceId);
    return [reference];
  });
};

const uniqueConversationAliases = (
  aliases: ConversationContext["playerAliases"],
): ConversationContext["playerAliases"] => {
  const seen = new Set<string>();
  return aliases.filter((alias) => {
    const mentionKey = normalizeMentionText(alias.mention);
    const key = `${mentionKey}:${alias.reference.referenceId}`;
    if (!mentionKey || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const conversationContextFromRequest = (
  request: RequestState,
  previousContext: ConversationContext,
  isCorrection: boolean,
): ConversationContext => {
  const resolvedPlayers = request.players.flatMap((player) => {
    const resolution = player.resolution;
    if (resolution?.status !== "resolved") return [];
    const reference = conversationPlayerFromResolution(resolution);
    return reference ? [{ player, reference }] : [];
  });
  const explicitResolvedPlayers = resolvedPlayers.filter(({ player }) =>
    player.referenceScope === "explicit"
  );
  const correctionKeys = isCorrection
    ? new Set(explicitResolvedPlayers.map(({ player }) => normalizeMentionText(player.mention)))
    : new Set<string>();
  const aliasesAfterCorrection = previousContext.playerAliases.filter((alias) =>
    !correctionKeys.has(normalizeMentionText(alias.mention))
  );
  const addedAliases = explicitResolvedPlayers.map(({ player, reference }) => ({
    mention: player.mention,
    reference,
  }));
  const correctedFocus = isCorrection && explicitResolvedPlayers.length === 1
    ? [explicitResolvedPlayers[0]!.reference]
    : null;
  const focusPlayers = request.kind === "player_lookup"
    ? uniqueConversationPlayers(resolvedPlayers.map(({ reference }) => reference))
    : correctedFocus ?? previousContext.focusPlayers;

  return {
    focusPlayers,
    playerAliases: uniqueConversationAliases([
      ...aliasesAfterCorrection,
      ...addedAliases,
    ]),
  };
};

const applyPlayerAnswer = async (
  request: RequestState,
  answer: string,
  lookup: ReferenceIdentityLookup,
): Promise<RequestState> => {
  const index = request.activePlayerIndex;
  if (index === null) return request;
  const player = request.players[index];
  const current = player?.resolution;
  if (!player || !current) return request;

  const selected = findSelectedCandidate(answer, current);
  if (selected) {
    return updateRequestPlayer(request, index, {
      ...player,
      resolution: {
        ...current,
        status: "resolved",
        selectedCandidateId: selected.candidateId,
        canonicalIdentityId: selected.canonicalIdentityId,
        selectedName: selected.name,
        clarificationMessage: null,
      },
    });
  }

  if (player.attempts >= 1) {
    return {
      ...request,
      status: "clarification_exhausted",
      clarificationMessage: "我仍无法确认你指的球员。请用完整姓名重新提出请求。",
    };
  }

  const cleanedAnswer = cleanReferenceAnswer(answer);
  const result = cleanedAnswer && !/^\d+$/.test(cleanedAnswer)
    ? await lookup(cleanedAnswer)
    : null;
  if (result?.status === "resolved") {
    return updateRequestPlayer(request, index, {
      ...player,
      attempts: player.attempts + 1,
      resolution: { ...result },
    });
  }

  const resolution = result
    ? { ...result }
    : {
        ...current,
        status: "needs_confirmation" as const,
        clarificationMessage: "我没能对应这条回答，请回复候选编号或完整球员姓名。",
      };
  const updated = updateRequestPlayer(request, index, {
    ...player,
    attempts: player.attempts + 1,
    resolution,
  });
  return {
    ...updated,
    status: "needs_confirmation",
    activePlayerIndex: index,
    clarificationMessage:
      resolution.clarificationMessage ?? "请回复候选编号或完整球员姓名。",
  };
};

const updateRequestPlayer = (
  request: RequestState,
  index: number,
  player: RequestPlayerState,
): RequestState => ({
  ...request,
  players: request.players.map((item, itemIndex) => itemIndex === index ? player : item),
  activePlayerIndex: null,
  clarificationMessage: null,
  status: "not_processed",
});

const createIdentityClarificationNode =
  (): GraphNode<typeof AgentState> => async (state) => {
    const request = state.request ?? createInitialRequestState();
    const index = request.activePlayerIndex;
    const player = index === null ? null : request.players[index] ?? null;
    const resolution = player?.resolution ?? null;
    const candidates = resolution?.candidates.map((candidate, candidateIndex) => ({
      number: candidateIndex + 1,
      name: candidate.name,
      sources: [...new Set(candidate.records.map((record) => record.provider))],
      identityLinked: candidate.identityVerified,
      records: candidate.records.map((record) => ({
        source: record.provider,
        team: record.team,
        competition: record.competition,
        season: record.season,
      })),
    })) ?? [];
    const mention = player?.mention ?? "这位球员";
    const question = request.clarificationMessage
      ?? (candidates.length
        ? `“${mention}”可能对应多个身份。请回复候选编号或完整姓名。`
        : `我无法确认“${mention}”指哪位球员。请提供完整姓名或球队线索。`);
    const resumeValue = interrupt({
      kind: "player_identity_confirmation",
      requestKind: request.kind,
      mention,
      playerIndex: index,
      question,
      candidates,
    });
    return { requestAnswer: resumeValueToText(resumeValue) };
  };

const createUnresolvedRequestNode =
  (): GraphNode<typeof AgentState> => async (state) => ({
    messages: [new AIMessage(
      (state.request ?? createInitialRequestState()).clarificationMessage
        ?? "我仍无法确认目标球员，请提供完整姓名后再继续。",
    )],
  });

const createRequestBoundaryNode =
  (): GraphNode<typeof AgentState> => async (state) => {
    const request = state.request ?? createInitialRequestState();
    const response = request.kind === "player_lookup" && request.players.length === 0
      ? "请告诉我你要查询哪位球员。"
      : request.kind === "player_comparison"
        ? "我已经识别到这是球员比较请求；比较流程还未接通，目前可以查询单个球员记录。"
        : request.kind === "player_recommendation"
          ? "我已经识别到这是球员推荐请求；推荐流程还未接通，目前可以查询球员记录。"
          : request.kind === "team_recommendation"
            ? "我已经识别到这是球队推荐请求；球队推荐流程还未接通，目前可以查询球员记录。"
            : "当前版本支持查询球员记录。请告诉我你要查询哪位球员。";
    return { messages: [new AIMessage(response)] };
  };

const createAssistantNode =
  (model: LanguageModelLike): GraphNode<typeof AgentState> =>
  async (state) => {
    const request = state.request ?? createInitialRequestState();
    const requestContext = formatRequestContext(request);
    const hasOneResolvedPlayer = request.players.length === 1 &&
      request.players[0]?.resolution?.status === "resolved";
    const assistantMessages = hasOneResolvedPlayer
      ? messagesForCurrentTurn(state.messages)
      : state.messages;
    const response = await model.invoke([
      new SystemMessage(
        [assistantPrompt, requestContext].filter(Boolean).join("\n\n"),
      ),
      ...assistantMessages,
    ]);
    return {
      messages: [response instanceof AIMessage
        ? pinResolvedPlayerSearch(response, request)
        : response],
    };
  };

const pinResolvedPlayerSearch = (
  response: AIMessage,
  request: RequestState,
): AIMessage => {
  if (request.players.length !== 1) return response;
  const resolution = request.players[0]?.resolution;
  const selectedName = resolution?.status === "resolved"
    ? resolution.selectedName
    : null;
  if (!selectedName || !response.tool_calls?.length) return response;

  let changed = false;
  const toolCalls = response.tool_calls.map((toolCall) => {
    if (toolCall.name !== "search_player_records") return toolCall;
    if (toolCall.args.playerName === selectedName) return toolCall;
    changed = true;
    return {
      ...toolCall,
      args: { ...toolCall.args, playerName: selectedName },
    };
  });
  if (!changed) return response;

  return new AIMessage({
    content: response.content,
    id: response.id,
    name: response.name,
    tool_calls: toolCalls,
    invalid_tool_calls: response.invalid_tool_calls,
    additional_kwargs: response.additional_kwargs,
    response_metadata: response.response_metadata,
    usage_metadata: response.usage_metadata,
  });
};

const formatRequestContext = (request: RequestState): string => {
  const resolvedPlayers = request.players
    .filter((player) => player.resolution?.status === "resolved")
    .map((player) => {
      const resolution = player.resolution!;
      const identity = resolution.canonicalIdentityId
        ? `已验证 Reep ID ${resolution.canonicalIdentityId}`
        : "用户确认了来源记录，跨来源身份仍未验证";
      return `“${player.mention}”对应“${resolution.selectedName ?? resolution.mention}”，${identity}。`;
    });
  const teamContext = request.teams.length
    ? `球队提及：${request.teams.join("、")}。`
    : "";
  const constraintContext = request.constraints.length
    ? `用户条件：${request.constraints.map((item) => `${item.name}=${item.value}`).join("；")}。`
    : "";
  return [
    `结构化请求类型：${request.kind}。`,
    ...resolvedPlayers,
    teamContext,
    constraintContext,
  ].filter(Boolean).join("\n");
};

const findSelectedCandidate = (
  answer: string,
  resolution: PlayerResolutionState,
): ReferenceCandidate | undefined => {
  const trimmed = cleanReferenceAnswer(answer);
  const affirmative = trimmed
    .replace(/[，,。.!?？\s]/g, "")
    .toLocaleLowerCase();
  if (
    resolution.candidates.length === 1 &&
    [
      "yes",
      "yeah",
      "yep",
      "是",
      "是的",
      "是他",
      "对",
      "对是他",
      "没错",
      "没错是他",
      "就是他",
      "是的就是他",
      "就是这位",
      "确认",
      "可以",
    ].includes(affirmative)
  ) {
    return resolution.candidates[0];
  }
  const number = Number(trimmed);
  if (Number.isInteger(number) && number >= 1 && number <= resolution.candidates.length) {
    return resolution.candidates[number - 1];
  }
  return resolution.candidates.find((candidate) =>
    candidate.candidateId === trimmed || normalizeName(candidate.name) === normalizeName(trimmed),
  );
};

const cleanReferenceAnswer = (answer: string): string => answer
  .trim()
  .replace(/^(?:i mean|i meant|i am referring to|我指的是|我说的是|我想说的是|应该是)\s*/i, "")
  .replace(/[。.!?？]+$/, "")
  .trim();

const latestHumanMessage = (messages: AgentStateType["messages"]) => [...messages]
  .reverse()
  .find((message) => message instanceof HumanMessage);

const messageText = (message: HumanMessage): string =>
  typeof message.content === "string" ? message.content : JSON.stringify(message.content);

const messagesForCurrentTurn = (messages: AgentStateType["messages"]) => {
  let latestUserMessageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index] instanceof HumanMessage) {
      latestUserMessageIndex = index;
      break;
    }
  }
  return latestUserMessageIndex < 0 ? messages : messages.slice(latestUserMessageIndex);
};

const uniquePlayers = <T extends { mention: string }>(players: T[]): T[] => {
  const seen = new Set<string>();
  return players.filter((player) => {
    const key = player.mention.normalize("NFKC").trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const findConfirmedPlayerAliasesInMessage = (
  message: string,
  context: ConversationContext,
): string[] => context.playerAliases
  .map((alias) => alias.mention)
  .filter((mention) => mentionOccursInMessage(message, mention));

const mentionOccursInMessage = (message: string, mention: string): boolean => {
  if (/\p{Script=Han}/u.test(mention)) {
    return normalizeMentionText(message).includes(normalizeMentionText(mention));
  }
  const escapedMention = mention
    .normalize("NFKC")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapedMention}(?=$|[^\\p{L}\\p{N}])`,
    "iu",
  ).test(message.normalize("NFKC"));
};

type NormalizedExtractedPlayerMention = {
  mention: string;
  lookupName: string | null;
  referenceScope: "explicit" | "prior_context" | "same_turn" | "ambiguous";
  referenceTargetMention: string | null;
};

const normalizeExtractedPlayers = (
  message: string,
  players: ExtractedPlayerMention[],
): NormalizedExtractedPlayerMention[] => {
  const messageKey = normalizeMentionText(message);
  const detectedReference = findPlayerReferenceMention(message);
  const normalizedPlayers = players.reduce<NormalizedExtractedPlayerMention[]>(
    (normalized, player) => {
      const mention = player.mention.trim();
      if (!mention) return normalized;

      const mentionKey = normalizeMentionText(mention);
      const appearsInMessage = Boolean(mentionKey && messageKey.includes(mentionKey));
      let referenceScope = player.referenceScope ?? (
        isPlayerReferenceMention(mention) ? "prior_context" : "explicit"
      );
      if (isPlayerReferenceMention(mention) && referenceScope === "explicit") {
        referenceScope = "prior_context";
      }
      if (!appearsInMessage && detectedReference && referenceScope === "explicit") {
        referenceScope = "prior_context";
      }

      if (referenceScope !== "explicit") {
        const referenceMention = isPlayerReferenceMention(mention)
          ? mention
          : detectedReference;
        if (!referenceMention) return normalized;
        normalized.push({
          mention: referenceMention,
          lookupName: null,
          referenceScope,
          referenceTargetMention: referenceScope === "same_turn"
            ? player.referenceTargetMention?.trim() || null
            : null,
        });
        return normalized;
      }

      if (!appearsInMessage) return normalized;
      normalized.push({
        mention,
        lookupName: player.lookupName?.trim() || null,
        referenceScope: "explicit",
        referenceTargetMention: null,
      });
      return normalized;
    },
    [],
  );

  if (
    detectedReference &&
    !normalizedPlayers.some((player) => player.referenceScope !== "explicit")
  ) {
    normalizedPlayers.push({
      mention: detectedReference,
      lookupName: null,
      referenceScope: "prior_context",
      referenceTargetMention: null,
    });
  }

  return uniquePlayers(normalizedPlayers);
};

const isPlayerReferenceMention = (value: string): boolean => {
  const referenceMention = findPlayerReferenceMention(value);
  return Boolean(
    referenceMention &&
    normalizeMentionText(referenceMention) === normalizeMentionText(value),
  ) || /^(?:this player|that player|the player)$/i.test(value.trim());
};

const findPlayerReferenceMention = (value: string): string | null => {
  const chineseMatch = value.match(
    /(?<!其)(?:他的|她的|它的|他自己|她自己|他|她|它)(?!们)|(?:这位|这名|这个|该)球员/u,
  );
  if (chineseMatch) return chineseMatch[0];
  const englishMatch = value.match(
    /\b(?:himself|herself|their|them|they|him|her|his|hers|he|she|this player|that player|the player)\b/i,
  );
  return englishMatch?.[0] ?? null;
};

const normalizeMentionText = (value: string): string => value
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/[\s\p{P}\p{S}]/gu, "");

const uniqueText = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const text = value.trim();
    const key = text.normalize("NFKC").toLocaleLowerCase();
    if (!text || seen.has(key)) return [];
    seen.add(key);
    return [text];
  });
};

const defaultClarification = (player: RequestPlayerState): string =>
  `我无法确认“${player.mention}”指哪位球员。请提供完整姓名或球队线索。`;

const normalizeName = (value: string): string => value
  .normalize("NFKD")
  .replace(/\p{Diacritic}/gu, "")
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]/g, "");

const resumeValueToText = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    const answer = item.answer ?? item.text ?? item.candidateId;
    if (typeof answer === "string") return answer;
  }
  return null;
};

export {
  createAssistantNode,
  createEntityResolutionNode,
  createIdentityClarificationNode,
  createRequestBoundaryNode,
  createRequestUnderstandingExtractor,
  createRequestUnderstandingNode,
  createUnresolvedRequestNode,
};
export type { RequestUnderstandingExtractor };
