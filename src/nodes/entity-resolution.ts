import type { GraphNode } from "@langchain/langgraph";

import type { ReferenceIdentityLookup } from "../player-data/resolve-reference.js";
import {
  isPlayerReferenceMention,
  latestHumanMessage,
  messageText,
  normalizeMentionText,
} from "../player-mentions.js";
import type {
  AgentState,
  AgentStateType,
  ConversationContext,
  ConversationPlayerReference,
  PlayerResolutionState,
  ReferenceCandidate,
  RequestPlayerState,
  RequestState,
} from "../state.js";
import {
  createInitialConversationContext,
  createInitialRequestState,
} from "../state.js";

const resolutionOrder = [
  "explicit",
  "prior_context",
  "same_turn",
  "ambiguous",
] as const;

const playerIdentityCorrectionPattern =
  /(?:我说的是|我指的是|我刚才说的是|我想说的是|我的意思是|i meant|i was referring to)/iu;

const clarificationPrefixes = [
  "i mean",
  "i meant",
  "i am referring to",
  "我指的是",
  "我说的是",
  "我想说的是",
  "应该是",
];

const trailingAnswerPunctuation = new Set(["。", ".", "!", "?", "？"]);

const cleanReferenceAnswer = (answer: string): string => {
  const trimmed = answer.trim();
  const lowercase = trimmed.toLocaleLowerCase();

  const prefix = clarificationPrefixes.find((candidate) =>
    lowercase.startsWith(candidate.toLocaleLowerCase())
  );

  const withoutPrefix =
    prefix === undefined ? trimmed : trimmed.slice(prefix.length).trimStart();

  let cleaned = withoutPrefix.trim();

  while (
    cleaned.length > 0 &&
    trailingAnswerPunctuation.has(cleaned.at(-1) ?? "")
  ) {
    cleaned = cleaned.slice(0, -1);
  }

  return cleaned.trim();
};

const normalizeName = (value: string): string =>
  value
    .normalize("NFKD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]/gu, "");

const findSelectedCandidate = (
  answer: string,
  resolution: PlayerResolutionState
): ReferenceCandidate | undefined => {
  const trimmed = cleanReferenceAnswer(answer);

  const affirmative = trimmed
    .replaceAll(/[，,。.!?？\s]/gu, "")
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

  if (
    Number.isInteger(number) &&
    number >= 1 &&
    number <= resolution.candidates.length
  ) {
    return resolution.candidates[number - 1];
  }

  return resolution.candidates.find(
    (candidate) =>
      candidate.candidateId === trimmed ||
      normalizeName(candidate.name) === normalizeName(trimmed)
  );
};

const updateRequestPlayer = (
  request: RequestState,
  index: number,
  player: RequestPlayerState
): RequestState => ({
  ...request,
  activePlayerIndex: null,
  clarificationMessage: null,
  players: request.players.map((item, itemIndex) =>
    itemIndex === index ? player : item
  ),
  status: "not_processed",
});

const applyPlayerAnswer = async (
  request: RequestState,
  answer: string,
  lookup: ReferenceIdentityLookup
): Promise<RequestState> => {
  const index = request.activePlayerIndex;

  if (index === null) {
    return request;
  }

  const player = request.players[index];
  const current = player?.resolution;

  if (player === undefined || current === null || current === undefined) {
    return request;
  }

  const selected = findSelectedCandidate(answer, current);

  if (selected !== undefined) {
    return updateRequestPlayer(request, index, {
      ...player,
      resolution: {
        ...current,
        canonicalIdentityId: selected.canonicalIdentityId,
        clarificationMessage: null,
        selectedCandidateId: selected.candidateId,
        selectedName: selected.name,
        status: "resolved",
      },
    });
  }

  if (player.attempts >= 1) {
    return {
      ...request,
      clarificationMessage:
        "我仍无法确认你指的球员。请用完整姓名重新提出请求。",
      status: "clarification_exhausted",
    };
  }

  const cleanedAnswer = cleanReferenceAnswer(answer);

  const result =
    cleanedAnswer.length > 0 && !/^\d+$/u.test(cleanedAnswer)
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
        clarificationMessage:
          "我没能对应这条回答，请回复候选编号或完整球员姓名。",
        status: "needs_confirmation" as const,
      };

  const updated = updateRequestPlayer(request, index, {
    ...player,
    attempts: player.attempts + 1,
    resolution,
  });

  return {
    ...updated,
    activePlayerIndex: index,
    clarificationMessage:
      resolution.clarificationMessage ?? "请回复候选编号或完整球员姓名。",
    status: "needs_confirmation",
  };
};

const defaultClarification = (player: RequestPlayerState): string =>
  `我无法确认“${player.mention}”指哪位球员。请提供完整姓名或球队线索。`;

const uniqueConversationPlayers = (
  references: ConversationPlayerReference[]
): ConversationPlayerReference[] => {
  const seen = new Set<string>();

  return references.flatMap((reference) => {
    if (seen.has(reference.referenceId)) {
      return [];
    }

    seen.add(reference.referenceId);

    return [reference];
  });
};

const resolveConversationReference = (
  mention: string,
  references: ConversationPlayerReference[]
): PlayerResolutionState => {
  const uniqueReferences = uniqueConversationPlayers(references);

  if (uniqueReferences.length === 1) {
    const [{ candidate }] = uniqueReferences;

    return {
      candidateCount: 1,
      candidates: [candidate],
      candidatesTruncated: false,
      canonicalIdentityId: candidate.canonicalIdentityId,
      clarificationMessage: null,
      mention,
      selectedCandidateId: candidate.candidateId,
      selectedName: candidate.name,
      status: "resolved",
    };
  }

  const candidates = uniqueReferences.map((reference) => reference.candidate);

  return {
    candidateCount: candidates.length,
    candidates,
    candidatesTruncated: false,
    canonicalIdentityId: null,
    clarificationMessage: candidates.length
      ? `“${mention}”可能指本轮上下文中的多位球员，请选择候选编号。`
      : `当前对话里没有已确认的球员可供“${mention}”引用。请先提供球员姓名。`,
    mention,
    selectedCandidateId: null,
    selectedName: null,
    status: uniqueReferences.length ? "needs_confirmation" : "not_found",
  };
};

const resolveConfirmedPlayerAlias = (
  mention: string,
  context: ConversationContext
): PlayerResolutionState | null => {
  const mentionKey = normalizeMentionText(mention);

  if (!mentionKey) {
    return null;
  }

  const references = context.playerAliases.flatMap((alias) =>
    normalizeMentionText(alias.mention) === mentionKey ? [alias.reference] : []
  );

  return references.length
    ? resolveConversationReference(mention, references)
    : null;
};

const conversationPlayerFromResolution = (
  resolution: PlayerResolutionState
): ConversationPlayerReference | null => {
  const candidate = resolution.candidates.find(
    (item) => item.candidateId === resolution.selectedCandidateId
  );

  if (candidate !== undefined) {
    return {
      candidate,
      referenceId: candidate.canonicalIdentityId ?? candidate.candidateId,
    };
  }

  if (
    resolution.selectedCandidateId === null ||
    resolution.selectedName === null ||
    resolution.selectedName.length === 0
  ) {
    return null;
  }

  const fallbackCandidate: ReferenceCandidate = {
    candidateId: resolution.selectedCandidateId,
    canonicalIdentityId: resolution.canonicalIdentityId,
    exactNameMatch: false,
    identityVerified: resolution.canonicalIdentityId !== null,
    name: resolution.selectedName,
    records: [],
  };

  return {
    candidate: fallbackCandidate,
    referenceId:
      fallbackCandidate.canonicalIdentityId ?? fallbackCandidate.candidateId,
  };
};

const resolveReferenceTargets = (
  referenceScope: Exclude<RequestPlayerState["referenceScope"], "explicit">,
  targetMention: string | null,
  request: RequestState,
  context: ConversationContext
): ConversationPlayerReference[] => {
  const currentRequestReferences = request.players.flatMap((requestPlayer) => {
    const { resolution } = requestPlayer;

    if (
      requestPlayer.referenceScope !== "explicit" ||
      resolution?.status !== "resolved"
    ) {
      return [];
    }

    const reference = conversationPlayerFromResolution(resolution);

    return reference === null ? [] : [reference];
  });

  if (referenceScope === "prior_context") {
    return context.focusPlayers;
  }

  if (referenceScope === "ambiguous") {
    return [...context.focusPlayers, ...currentRequestReferences];
  }

  const targetKey =
    targetMention === null ? null : normalizeMentionText(targetMention);

  if (targetKey === null || targetKey.length === 0) {
    return [];
  }

  return request.players.flatMap((requestPlayer) => {
    const { resolution } = requestPlayer;

    if (
      requestPlayer.referenceScope !== "explicit" ||
      resolution?.status !== "resolved" ||
      normalizeMentionText(requestPlayer.mention) !== targetKey
    ) {
      return [];
    }

    const reference = conversationPlayerFromResolution(resolution);

    return reference === null ? [] : [reference];
  });
};

const uniqueConversationAliases = (
  aliases: ConversationContext["playerAliases"]
): ConversationContext["playerAliases"] => {
  const seen = new Set<string>();

  return aliases.filter((alias) => {
    const mentionKey = normalizeMentionText(alias.mention);
    const key = `${mentionKey}:${alias.reference.referenceId}`;

    if (!mentionKey || seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
};

const conversationContextFromRequest = (
  request: RequestState,
  previousContext: ConversationContext,
  isCorrection: boolean
): ConversationContext => {
  const resolvedPlayers = request.players.flatMap((player) => {
    const { resolution } = player;

    if (resolution?.status !== "resolved") {
      return [];
    }

    const reference = conversationPlayerFromResolution(resolution);

    return reference ? [{ player, reference }] : [];
  });

  const explicitResolvedPlayers = resolvedPlayers.filter(
    ({ player }) => player.referenceScope === "explicit"
  );

  const correctionKeys = isCorrection
    ? new Set(
        explicitResolvedPlayers.map(({ player }) =>
          normalizeMentionText(player.mention)
        )
      )
    : new Set<string>();

  const aliasesAfterCorrection = previousContext.playerAliases.filter(
    (alias) => !correctionKeys.has(normalizeMentionText(alias.mention))
  );

  const addedAliases = explicitResolvedPlayers.map(({ player, reference }) => ({
    mention: player.mention,
    reference,
  }));

  const correctedFocus =
    isCorrection && explicitResolvedPlayers.length === 1
      ? [explicitResolvedPlayers[0].reference]
      : null;

  const focusPlayers =
    request.kind === "player_lookup"
      ? uniqueConversationPlayers(
          resolvedPlayers.map(({ reference }) => reference)
        )
      : (correctedFocus ?? previousContext.focusPlayers);

  return {
    focusPlayers,
    playerAliases: uniqueConversationAliases([
      ...aliasesAfterCorrection,
      ...addedAliases,
    ]),
  };
};

type EntityResolutionOutcome = {
  activePlayerIndex: number | null;
  request: RequestState;
};

const resolveRequestPlayer = async (
  player: RequestPlayerState,
  request: RequestState,
  context: ConversationContext,
  lookup: ReferenceIdentityLookup
): Promise<PlayerResolutionState> => {
  const referenceScope =
    player.referenceScope ??
    (isPlayerReferenceMention(player.mention) ? "prior_context" : "explicit");

  if (referenceScope !== "explicit") {
    const references = resolveReferenceTargets(
      referenceScope,
      player.referenceTargetMention,
      request,
      context
    );

    return resolveConversationReference(player.mention, references);
  }

  const knownAlias = resolveConfirmedPlayerAlias(player.mention, context);

  if (knownAlias !== null) {
    return knownAlias;
  }

  const lookupName = player.lookupName ?? player.mention;
  const result = await lookup(lookupName);

  const translatedOrExpanded =
    normalizeName(lookupName) !== normalizeName(player.mention);

  if (translatedOrExpanded && result.status === "resolved") {
    return {
      ...result,
      canonicalIdentityId: null,
      clarificationMessage: `你写的是“${player.mention}”。本地资料中找到“${result.selectedName}”，请确认是否指这位球员。`,
      mention: player.mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "needs_confirmation",
    };
  }

  return { ...result, mention: player.mention };
};

const resolvePlayersInOrder = async (
  request: RequestState,
  context: ConversationContext,
  lookup: ReferenceIdentityLookup,
  scopeIndex = 0,
  playerIndex = 0
): Promise<EntityResolutionOutcome> => {
  if (scopeIndex >= resolutionOrder.length) {
    return { activePlayerIndex: null, request };
  }

  if (playerIndex >= request.players.length) {
    return await resolvePlayersInOrder(
      request,
      context,
      lookup,
      scopeIndex + 1,
      0
    );
  }

  const player = request.players[playerIndex];
  const referenceScope = resolutionOrder[scopeIndex];

  if (
    player.referenceScope !== referenceScope ||
    player.resolution?.status === "resolved"
  ) {
    return await resolvePlayersInOrder(
      request,
      context,
      lookup,
      scopeIndex,
      playerIndex + 1
    );
  }

  if (player.resolution !== null) {
    return { activePlayerIndex: playerIndex, request };
  }

  const resolution = await resolveRequestPlayer(
    player,
    request,
    context,
    lookup
  );

  const updatedRequest = {
    ...request,
    players: request.players.map((item, itemIndex) =>
      itemIndex === playerIndex ? { ...item, resolution } : item
    ),
  };

  if (resolution.status !== "resolved") {
    return { activePlayerIndex: playerIndex, request: updatedRequest };
  }

  return await resolvePlayersInOrder(
    updatedRequest,
    context,
    lookup,
    scopeIndex,
    playerIndex + 1
  );
};

const createEntityResolutionNode =
  (lookup: ReferenceIdentityLookup): GraphNode<typeof AgentState> =>
  async (state) => {
    let request = state.request ?? createInitialRequestState();
    request = {
      ...request,
      players: request.players.map((player) => ({
        ...player,
        referenceScope:
          player.referenceScope ??
          (isPlayerReferenceMention(player.mention)
            ? "prior_context"
            : "explicit"),
      })),
    };

    const conversationContext =
      state.conversationContext ?? createInitialConversationContext();

    const latestUserMessage = latestHumanMessage(state.messages);

    const currentMessage = latestUserMessage
      ? messageText(latestUserMessage)
      : "";

    if (state.requestAnswer !== null && request.activePlayerIndex !== null) {
      request = await applyPlayerAnswer(request, state.requestAnswer, lookup);

      if (
        request.status === "clarification_exhausted" ||
        request.status === "needs_confirmation"
      ) {
        return { request, requestAnswer: null };
      }
    }

    const outcome = await resolvePlayersInOrder(
      request,
      conversationContext,
      lookup
    );

    ({ request } = outcome);

    if (outcome.activePlayerIndex !== null) {
      const player = request.players[outcome.activePlayerIndex];

      return {
        request: {
          ...request,
          activePlayerIndex: outcome.activePlayerIndex,
          clarificationMessage:
            player.resolution?.clarificationMessage ??
            defaultClarification(player),
          status: "needs_confirmation",
        },
      };
    }

    const resolvedRequest = {
      ...request,
      activePlayerIndex: null,
      clarificationMessage: null,
      status: "ready" as const,
    };

    const update: Partial<AgentStateType> = {
      request: resolvedRequest,
      requestAnswer: null,
    };

    if (request.players.length > 0) {
      update.conversationContext = conversationContextFromRequest(
        resolvedRequest,
        conversationContext,
        playerIdentityCorrectionPattern.test(currentMessage)
      );
    }

    return update;
  };

export { createEntityResolutionNode };
