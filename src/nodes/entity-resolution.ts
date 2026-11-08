import { getStore } from "@langchain/langgraph";
import type { GraphNode, BaseStore } from "@langchain/langgraph";
import { z } from "zod/v4";

import { logLocalDataFailure } from "../fault-tolerance.js";
import { selectedReferenceCandidate } from "../player-data/contracts.js";
import type { ReferenceIdentityLookup } from "../player-data/resolve-reference.js";
import { normalizePlayerName } from "../player-data/shared.js";
import type {
  findRememberedPlayerIdentity,
  rememberPlayerIdentity,
  validatePlayerReference,
  PlayerMemoryLookupResult,
} from "../player-memory.js";
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
  TurnOutcome,
} from "../state.js";
import {
  createInitialConversationContext,
  createInitialPlayerMemoryStatus,
  createInitialRequestState,
} from "../state.js";

const resolutionOrder = [
  "explicit",
  "prior_context",
  "same_turn",
  "ambiguous",
] as const;

const maxPriorContextAliasReads = 8;

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

const normalizeName = (value: string): string => normalizePlayerName(value);

type CandidateSelection = {
  candidates: ReferenceCandidate[];
  provider: "fm" | "understat" | null;
  status: "selected" | "ambiguous" | "not_found";
};

type ConfirmedCandidate = {
  candidate: ReferenceCandidate | null;
  clarificationMessage: string | null;
};

const candidateFromToken = (
  token: string,
  resolution: PlayerResolutionState
): ReferenceCandidate | undefined => {
  const trimmed = token.trim();
  const number = Number(trimmed);

  if (Number.isInteger(number) && number >= 1) {
    return resolution.candidates[number - 1];
  }

  return resolution.candidates.find(
    (candidate) => candidate.candidateId === trimmed
  );
};

const sourceProviderFromAnswer = (
  answer: string
): "fm" | "understat" | null => {
  const normalized = answer
    .toLocaleLowerCase()
    .replaceAll(/[\s，,。.!?？]/gu, "");

  if (
    /^(?:只用|仅用|只选|use|only|just)?(?:fm|footballmanager)(?:only|来源)?$/u.test(
      normalized
    )
  ) {
    return "fm";
  }

  if (
    /^(?:只用|仅用|只选|use|only|just)?understat(?:only|来源)?$/u.test(
      normalized
    )
  ) {
    return "understat";
  }

  return null;
};

const candidateSelection = (
  candidates: ReferenceCandidate[],
  provider: CandidateSelection["provider"] = null
): CandidateSelection => ({
  candidates,
  provider,
  status: "selected",
});

const selectionStatus = (count: number): CandidateSelection["status"] => {
  if (count === 1) {
    return "selected";
  }

  if (count > 1) {
    return "ambiguous";
  }

  return "not_found";
};

const isSamePersonConfirmation = (answer: string): boolean => {
  const normalized = answer
    .toLocaleLowerCase()
    .replaceAll(/[\s，,。.!?？]/gu, "");

  return [
    "botharethesameperson",
    "botharethesameplayer",
    "botharesameperson",
    "allsameperson",
    "allsameplayer",
    "sameperson",
    "sameplayer",
    "sameidentity",
    "同一人",
    "同一个人",
    "都属于同一人",
    "两条都是同一人",
  ].some((phrase) => normalized.includes(phrase));
};

const selectionsFromTokens = (
  answer: string,
  resolution: PlayerResolutionState
): CandidateSelection | null => {
  const tokens = answer
    .split(/[，,、]/u)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length < 2) {
    return null;
  }

  const selected = tokens.map((token) => candidateFromToken(token, resolution));

  if (!selected.every((candidate) => candidate !== undefined)) {
    return null;
  }

  return candidateSelection(
    selected.filter(
      (candidate): candidate is ReferenceCandidate => candidate !== undefined
    )
  );
};

const selectionsForSamePerson = (
  answer: string,
  resolution: PlayerResolutionState
): CandidateSelection => {
  const selected: ReferenceCandidate[] = [];

  for (const match of answer.matchAll(/\d+/gu)) {
    const number = Number(match[0]);
    const candidate = resolution.candidates[number - 1];

    if (Number.isInteger(number) && number >= 1 && candidate !== undefined) {
      selected.push(candidate);
    }
  }

  if (selected.length > 0) {
    return candidateSelection(selected);
  }

  if (resolution.candidates.length <= 2) {
    return candidateSelection(resolution.candidates);
  }

  return {
    candidates: [],
    provider: null,
    status: "ambiguous",
  };
};

const selectionsForProvider = (
  provider: "fm" | "understat",
  resolution: PlayerResolutionState
): CandidateSelection => {
  const candidates = resolution.candidates.filter((candidate) =>
    candidate.records.some((record) => record.provider === provider)
  );

  return {
    candidates,
    provider,
    status: selectionStatus(candidates.length),
  };
};

const isAffirmativeAnswer = (answer: string): boolean => {
  const affirmative = answer
    .replaceAll(/[，,。.!?？\s]/gu, "")
    .toLocaleLowerCase();

  return [
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
  ].includes(affirmative);
};

const selectionsByName = (
  answer: string,
  resolution: PlayerResolutionState
): CandidateSelection => {
  const normalizedAnswer = normalizeName(answer);

  const candidates = resolution.candidates.filter(
    (candidate) =>
      normalizeName(candidate.name) === normalizedAnswer ||
      candidate.records.some(
        (record) => normalizeName(record.name) === normalizedAnswer
      )
  );

  return {
    candidates,
    provider: null,
    status: selectionStatus(candidates.length),
  };
};

const findSelectedCandidates = (
  answer: string,
  resolution: PlayerResolutionState
): CandidateSelection => {
  const trimmed = cleanReferenceAnswer(answer);

  const tokenSelection = selectionsFromTokens(trimmed, resolution);

  if (tokenSelection !== null) {
    return tokenSelection;
  }

  if (isSamePersonConfirmation(trimmed)) {
    return selectionsForSamePerson(trimmed, resolution);
  }

  const sourceProvider = sourceProviderFromAnswer(trimmed);

  if (sourceProvider !== null) {
    return selectionsForProvider(sourceProvider, resolution);
  }

  const singleToken = candidateFromToken(trimmed, resolution);

  if (singleToken !== undefined) {
    return {
      candidates: [singleToken],
      provider: null,
      status: "selected",
    };
  }

  if (resolution.candidates.length === 1 && isAffirmativeAnswer(trimmed)) {
    return candidateSelection(resolution.candidates);
  }

  return selectionsByName(trimmed, resolution);
};

const mergeCandidateRecords = (
  candidates: ReferenceCandidate[],
  provider: "fm" | "understat" | null
): ReferenceCandidate["records"] => {
  const records = new Map<string, ReferenceCandidate["records"][number]>();

  for (const candidate of candidates) {
    for (const record of candidate.records) {
      if (provider !== null && record.provider !== provider) {
        continue;
      }

      const canonicalIdentityId =
        record.canonicalIdentityId ?? candidate.canonicalIdentityId;

      const identityVerified =
        record.identityVerified ?? candidate.identityVerified;

      const resolvedRecord = {
        ...record,
        canonicalIdentityId,
        identityVerified,
      };

      const key = JSON.stringify([
        record.provider,
        record.sourceId,
        record.competition,
        record.season,
      ]);

      if (!records.has(key)) {
        records.set(key, resolvedRecord);
      }
    }
  }

  return [...records.values()];
};

type CanonicalRecordIdentity = {
  canonicalIdentityId: string | null;
  conflict: boolean;
  fullyVerified: boolean;
};

const canonicalIdentityFromRecords = (
  records: ReferenceCandidate["records"]
): CanonicalRecordIdentity => {
  const canonicalIds = new Set(
    records.flatMap((record) =>
      record.identityVerified === true && record.canonicalIdentityId !== null
        ? [record.canonicalIdentityId]
        : []
    )
  );

  if (canonicalIds.size > 1) {
    return {
      canonicalIdentityId: null,
      conflict: true,
      fullyVerified: false,
    };
  }

  const [canonicalIdentityId] = canonicalIds;

  const fullyVerified =
    canonicalIdentityId !== undefined &&
    records.every(
      (record) =>
        record.identityVerified === true &&
        record.canonicalIdentityId === canonicalIdentityId
    );

  return {
    canonicalIdentityId: fullyVerified ? canonicalIdentityId : null,
    conflict: false,
    fullyVerified,
  };
};

const candidateNameFromSelection = (
  selection: CandidateSelection,
  records: ReferenceCandidate["records"]
): string | null => {
  const exactCandidate = selection.candidates.find(
    (candidate) => candidate.exactNameMatch
  );

  if (exactCandidate !== undefined) {
    return exactCandidate.name;
  }

  const [firstCandidate] = selection.candidates;

  if (firstCandidate !== undefined) {
    return firstCandidate.name;
  }

  return records[0]?.name ?? null;
};

const sourceOnlyCandidate = (
  selection: CandidateSelection,
  records: ReferenceCandidate["records"],
  name: string
): ReferenceCandidate | null => {
  if (selection.provider === null) {
    return null;
  }

  const providers = new Set(records.map((record) => record.provider));
  const sourceIds = new Set(records.map((record) => record.sourceId));

  if (providers.size !== 1 || sourceIds.size !== 1) {
    return null;
  }

  const sourceId = records[0]?.sourceId;

  if (sourceId === undefined) {
    return null;
  }

  return {
    candidateId: `source:${selection.provider}:${sourceId}`,
    canonicalIdentityId: null,
    exactNameMatch: selection.candidates.some(
      (candidate) => candidate.exactNameMatch
    ),
    identityBasis: "source_selection",
    identityVerified: false,
    name,
    records,
  };
};

const unlinkedConfirmedCandidate = (
  selection: CandidateSelection,
  records: ReferenceCandidate["records"],
  name: string
): ReferenceCandidate => {
  const candidateIds = selection.candidates
    .map((candidate) => candidate.candidateId)
    .toSorted();

  const confirmedGroup =
    selection.candidates.length > 1 ||
    selection.candidates.some(
      (candidate) => candidate.identityBasis === "thread_candidate"
    );

  const uniqueProviders = new Set(records.map((record) => record.provider));
  const uniqueSourceIds = new Set(records.map((record) => record.sourceId));

  let candidateId: string;

  if (uniqueProviders.size === 1 && uniqueSourceIds.size === 1) {
    candidateId = `source:${records[0]?.provider}:${records[0]?.sourceId}`;
  } else {
    const prefix = confirmedGroup ? "thread-confirmed" : "source-group";
    candidateId = `${prefix}:${candidateIds.join("|")}`;
  }

  return {
    candidateId,
    canonicalIdentityId: null,
    exactNameMatch: selection.candidates.some(
      (candidate) => candidate.exactNameMatch
    ),
    identityBasis: confirmedGroup ? "thread_confirmed" : "source_record",
    identityVerified: false,
    name,
    records,
  };
};

const confirmedCandidate = (
  selection: CandidateSelection
): ConfirmedCandidate => {
  const records = mergeCandidateRecords(
    selection.candidates,
    selection.provider
  );

  if (records.length === 0) {
    return {
      candidate: null,
      clarificationMessage: "所选来源没有对应记录，请选择候选编号或来源名称。",
    };
  }

  const identity = canonicalIdentityFromRecords(records);

  if (identity.conflict) {
    return {
      candidate: null,
      clarificationMessage:
        "所选候选分别对应不同的 Reep ID，不能合并为同一球员。请单独选择其中一位。",
    };
  }

  const name = candidateNameFromSelection(selection, records);

  if (name === null) {
    return {
      candidate: null,
      clarificationMessage: "无法确定所选候选的球员名称，请补充完整姓名。",
    };
  }

  if (selection.provider !== null) {
    const sourceCandidate = sourceOnlyCandidate(selection, records, name);

    return sourceCandidate === null
      ? {
          candidate: null,
          clarificationMessage:
            "所选来源对应多条记录，请补充球队、赛事或赛季后再选。",
        }
      : { candidate: sourceCandidate, clarificationMessage: null };
  }

  if (identity.fullyVerified && identity.canonicalIdentityId !== null) {
    return {
      candidate: {
        candidateId: `reep:${identity.canonicalIdentityId}`,
        canonicalIdentityId: identity.canonicalIdentityId,
        exactNameMatch: selection.candidates.some(
          (candidate) => candidate.exactNameMatch
        ),
        identityBasis: "reep_registry",
        identityVerified: true,
        name,
        records,
      },
      clarificationMessage: null,
    };
  }

  return {
    candidate: unlinkedConfirmedCandidate(selection, records, name),
    clarificationMessage: null,
  };
};

const updateRequestPlayer = (
  request: RequestState,
  index: number,
  player: RequestPlayerState
): RequestState => ({
  ...request,
  players: request.players.map((item, itemIndex) =>
    itemIndex === index ? player : item
  ),
});

const keepIdentityClarificationOpen = (
  request: RequestState,
  index: number,
  clarificationMessage: string
): RequestState => ({
  ...request,
  players: request.players.map((player, playerIndex) => {
    const { resolution } = player;

    return playerIndex === index && resolution !== null
      ? {
          ...player,
          resolution: { ...resolution, clarificationMessage },
        }
      : player;
  }),
});

const applyConfirmedCandidateSelection = (
  request: RequestState,
  index: number,
  player: RequestPlayerState,
  current: PlayerResolutionState,
  selection: CandidateSelection
): RequestState => {
  const confirmed = confirmedCandidate(selection);

  if (confirmed.candidate === null) {
    return keepIdentityClarificationOpen(
      request,
      index,
      confirmed.clarificationMessage ??
        "这些候选无法安全合并，请选择其中一位球员。"
    );
  }

  const { candidate } = confirmed;

  return updateRequestPlayer(request, index, {
    ...player,
    resolution: {
      ...current,
      candidateCount: 1,
      candidates: [candidate],
      candidatesTruncated: false,
      canonicalIdentityId: candidate.canonicalIdentityId,
      clarificationMessage: null,
      selectedCandidateId: candidate.candidateId,
      selectedName: candidate.name,
      status: "resolved",
    },
  });
};

const requireCurrentIdentityConfirmation = (
  result: PlayerResolutionState,
  mention: string
): PlayerResolutionState => {
  if (result.status === "resolved") {
    return {
      ...result,
      canonicalIdentityId: null,
      clarificationMessage: `已记住的“${mention}”身份与当前资料不一致，请确认当前候选。`,
      mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "needs_confirmation",
    };
  }

  if (result.status === "needs_confirmation") {
    return {
      ...result,
      clarificationMessage: `已记住的“${mention}”身份需要重新确认。${result.clarificationMessage ?? ""}`,
      mention,
    };
  }

  if (result.status === "not_found") {
    return {
      ...result,
      canonicalIdentityId: null,
      clarificationMessage: `已记住的“${mention}”身份所指来源已不在当前资料中。请补充当前可查询的完整姓名或线索重新确认；原记忆已保留。`,
      mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "needs_confirmation",
    };
  }

  return { ...result, mention };
};

const refreshIdentityIfStale = async (
  player: RequestPlayerState,
  candidate: ReferenceCandidate,
  lookup: ReferenceIdentityLookup,
  validateReference: typeof validatePlayerReference
): Promise<PlayerResolutionState | null> => {
  if (validateReference(candidate).status === "current") {
    return null;
  }

  const refreshed = await lookup(player.lookupName ?? candidate.name);

  return requireCurrentIdentityConfirmation(refreshed, player.mention);
};

const retryIdentityLookup = async (
  request: RequestState,
  index: number,
  player: RequestPlayerState,
  current: PlayerResolutionState,
  answer: string,
  lookup: ReferenceIdentityLookup,
  findMemory: PlayerMemoryLookup
): Promise<RequestState> => {
  if (player.attempts >= 1) {
    return request;
  }

  const cleanedAnswer = cleanReferenceAnswer(answer);

  let result: PlayerResolutionState | null = null;

  if (cleanedAnswer.length > 0 && !/^\d+$/u.test(cleanedAnswer)) {
    const remembered = await findMemory(cleanedAnswer);
    result =
      remembered.status === "found"
        ? remembered.resolution
        : await lookup(cleanedAnswer);

    if (remembered.status === "stale") {
      result = requireCurrentIdentityConfirmation(result, cleanedAnswer);
    }
  }

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
  };
};

const applyPlayerAnswer = (
  request: RequestState,
  index: number,
  answer: string,
  lookup: ReferenceIdentityLookup,
  findMemory: PlayerMemoryLookup
): RequestState | Promise<RequestState> => {
  const player = request.players[index];
  const current = player?.resolution;

  if (player === undefined || current === null || current === undefined) {
    return request;
  }

  const selection = findSelectedCandidates(answer, current);

  if (selection.status === "selected") {
    return applyConfirmedCandidateSelection(
      request,
      index,
      player,
      current,
      selection
    );
  }

  if (selection.status === "ambiguous") {
    return keepIdentityClarificationOpen(
      request,
      index,
      "这个名称仍对应多个候选。请回复候选编号，或补充球队、赛事、赛季；若要把多条来源记录确认成同一人，请回复多个候选编号，例如 1,2。"
    );
  }

  return retryIdentityLookup(
    request,
    index,
    player,
    current,
    answer,
    lookup,
    findMemory
  );
};

const defaultClarification = (player: RequestPlayerState): string =>
  `我无法确认“${player.mention}”指哪位球员。请提供完整姓名或球队线索。`;

const identityClarificationQuestion = (player: RequestPlayerState): string => {
  const candidates = player.resolution?.candidates ?? [];

  const includesTentativeGroup = candidates.some(
    (candidate) =>
      candidate.identityBasis === "thread_candidate" ||
      (candidate.identityBasis === undefined &&
        !candidate.identityVerified &&
        candidate.records.length > 1)
  );

  if (includesTentativeGroup) {
    return `“${player.mention}”有跨来源的待确认候选组。确认后只在当前 thread 将这些来源记录视为同一人；若只选一个来源，请说明 FM only 或 Understat only。`;
  }

  return (
    player.resolution?.clarificationMessage ?? defaultClarification(player)
  );
};

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

const refreshKnownAliasForComparison = async (
  player: RequestPlayerState,
  request: RequestState,
  resolution: PlayerResolutionState,
  lookup: ReferenceIdentityLookup
): Promise<PlayerResolutionState> => {
  const selectedCandidate = selectedReferenceCandidate(resolution);

  const providerCount = new Set(
    selectedCandidate?.records.map((record) => record.provider)
  ).size;

  const isRegistryCandidate =
    selectedCandidate?.identityBasis === undefined ||
    selectedCandidate.identityBasis === "reep_registry";

  const shouldCheckForUnlinkedSources =
    request.kind === "player_comparison" &&
    resolution.canonicalIdentityId !== null &&
    isRegistryCandidate &&
    providerCount === 1;

  if (!shouldCheckForUnlinkedSources) {
    return { ...resolution, mention: player.mention };
  }

  const lookupName =
    player.lookupName ?? resolution.selectedName ?? player.mention;

  const refreshed = await lookup(lookupName);

  if (refreshed.status === "needs_confirmation") {
    return { ...refreshed, mention: player.mention };
  }

  if (
    refreshed.status === "resolved" &&
    refreshed.canonicalIdentityId === resolution.canonicalIdentityId
  ) {
    return { ...refreshed, mention: player.mention };
  }

  if (refreshed.status === "resolved") {
    return {
      ...refreshed,
      canonicalIdentityId: null,
      clarificationMessage: `“${player.mention}”在本线程已确认指向“${resolution.selectedName}”，但本轮资料解析到了另一个身份“${refreshed.selectedName}”。请确认是否要更换目标。`,
      mention: player.mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "needs_confirmation",
    };
  }

  if (refreshed.status === "registry_unavailable") {
    return { ...refreshed, mention: player.mention };
  }

  return { ...resolution, mention: player.mention };
};

const conversationPlayerFromResolution = (
  resolution: PlayerResolutionState
): ConversationPlayerReference | null => {
  const candidate = selectedReferenceCandidate(resolution);

  if (candidate !== null) {
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
  previousContext: ConversationContext
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

  const confirmedMentionKeys = new Set(
    explicitResolvedPlayers.map(({ player }) =>
      normalizeMentionText(player.mention)
    )
  );

  const aliasesAfterConfirmation = previousContext.playerAliases.filter(
    (alias) => !confirmedMentionKeys.has(normalizeMentionText(alias.mention))
  );

  const addedAliases = explicitResolvedPlayers.map(({ player, reference }) => ({
    mention: player.mention,
    reference,
  }));

  return {
    ...previousContext,
    focusPlayers: previousContext.focusPlayers,
    playerAliases: uniqueConversationAliases([
      ...aliasesAfterConfirmation,
      ...addedAliases,
    ]),
  };
};

type EntityResolutionOutcome = {
  unresolvedPlayerIndex: number | null;
  request: RequestState;
};

type PlayerMemoryCapability = {
  findIdentity: typeof findRememberedPlayerIdentity;
  rememberIdentity: typeof rememberPlayerIdentity;
  validateReference: typeof validatePlayerReference;
};

type PlayerMemoryLookup = (
  mention: string
) => Promise<PlayerMemoryLookupResult>;

const identityReresolutionRequested = (state: AgentStateType): boolean => {
  const latestMessage = latestHumanMessage(state.messages);

  if (latestMessage === undefined) {
    return false;
  }

  return /(?:重新(?:解析|确认|核实)(?:一下)?(?:球员)?(?:身份)?|re[- ]?resolve(?: the)? player identity|verify (?:the )?player identity again)/iu.test(
    messageText(latestMessage)
  );
};

const requireReresolutionConfirmation = (
  result: PlayerResolutionState,
  mention: string
): PlayerResolutionState => {
  if (result.status === "resolved") {
    return {
      ...result,
      canonicalIdentityId: null,
      clarificationMessage: `已重新核实“${mention}”的身份，请确认当前候选。`,
      mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "needs_confirmation",
    };
  }

  if (result.status === "needs_confirmation") {
    return {
      ...result,
      clarificationMessage: `已重新核实“${mention}”的身份，请确认当前候选。${result.clarificationMessage ?? ""}`,
      mention,
    };
  }

  return { ...result, mention };
};

const reResolvePriorContextReference = async (
  player: RequestPlayerState,
  references: ConversationPlayerReference[],
  context: ConversationContext,
  lookup: ReferenceIdentityLookup,
  findMemory: PlayerMemoryLookup
): Promise<PlayerResolutionState> => {
  const uniqueReferences = uniqueConversationPlayers(references);
  const [reference] = uniqueReferences;

  if (reference === undefined || uniqueReferences.length > 1) {
    return resolveConversationReference(player.mention, references);
  }

  const aliases = context.playerAliases
    .filter((item) => item.reference.referenceId === reference.referenceId)
    .toReversed()
    .slice(0, maxPriorContextAliasReads);

  const memoryResults = await Promise.all(
    aliases.map(async (alias) => await findMemory(alias.mention))
  );

  const rememberedIndex = memoryResults.findIndex(
    (result) => result.status === "found"
  );

  const remembered = memoryResults[rememberedIndex];

  const newerMemoryUnavailable = memoryResults
    .slice(0, rememberedIndex === -1 ? memoryResults.length : rememberedIndex)
    .some(
      (result) => result.status === "unavailable" || result.status === "stale"
    );

  if (remembered?.status === "found" && !newerMemoryUnavailable) {
    return { ...remembered.resolution, mention: player.mention };
  }

  const refreshed = await lookup(player.lookupName ?? reference.candidate.name);

  return requireReresolutionConfirmation(refreshed, player.mention);
};

const resolveRequestPlayer = async (
  player: RequestPlayerState,
  request: RequestState,
  context: ConversationContext,
  lookup: ReferenceIdentityLookup,
  findMemory: PlayerMemoryLookup,
  validateReference: typeof validatePlayerReference,
  forceReresolution: boolean
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

    if (forceReresolution) {
      return await reResolvePriorContextReference(
        player,
        references,
        context,
        lookup,
        findMemory
      );
    }

    const uniqueReferences = uniqueConversationPlayers(references);
    const [reference] = uniqueReferences;

    if (reference !== undefined && uniqueReferences.length === 1) {
      const refreshed = await refreshIdentityIfStale(
        player,
        reference.candidate,
        lookup,
        validateReference
      );

      if (refreshed !== null) {
        return refreshed;
      }
    }

    return resolveConversationReference(player.mention, references);
  }

  const knownAlias = forceReresolution
    ? null
    : resolveConfirmedPlayerAlias(player.mention, context);

  if (knownAlias !== null) {
    const candidate = selectedReferenceCandidate(knownAlias);

    if (candidate === null) {
      return knownAlias;
    }

    const refreshed = await refreshIdentityIfStale(
      player,
      candidate,
      lookup,
      validateReference
    );

    if (refreshed !== null) {
      return refreshed;
    }

    return await refreshKnownAliasForComparison(
      player,
      request,
      knownAlias,
      lookup
    );
  }

  const remembered = await findMemory(player.mention);

  if (remembered.status === "found") {
    return { ...remembered.resolution, mention: player.mention };
  }

  const lookupName = player.lookupName ?? player.mention;
  const result = await lookup(lookupName);

  if (remembered.status === "stale") {
    return requireCurrentIdentityConfirmation(result, player.mention);
  }

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
  findMemory: PlayerMemoryLookup,
  validateReference: typeof validatePlayerReference,
  forceReresolution: boolean,
  scopeIndex = 0,
  playerIndex = 0
): Promise<EntityResolutionOutcome> => {
  if (scopeIndex >= resolutionOrder.length) {
    return { request, unresolvedPlayerIndex: null };
  }

  if (playerIndex >= request.players.length) {
    return await resolvePlayersInOrder(
      request,
      context,
      lookup,
      findMemory,
      validateReference,
      forceReresolution,
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
      findMemory,
      validateReference,
      forceReresolution,
      scopeIndex,
      playerIndex + 1
    );
  }

  if (player.resolution !== null) {
    return { request, unresolvedPlayerIndex: playerIndex };
  }

  const resolution = await resolveRequestPlayer(
    player,
    request,
    context,
    lookup,
    findMemory,
    validateReference,
    forceReresolution
  );

  const updatedRequest = {
    ...request,
    players: request.players.map((item, itemIndex) =>
      itemIndex === playerIndex ? { ...item, resolution } : item
    ),
  };

  if (resolution.status !== "resolved") {
    return { request: updatedRequest, unresolvedPlayerIndex: playerIndex };
  }

  return await resolvePlayersInOrder(
    updatedRequest,
    context,
    lookup,
    findMemory,
    validateReference,
    forceReresolution,
    scopeIndex,
    playerIndex + 1
  );
};

const revalidateResumedPlayerAnswer = async (
  request: RequestState,
  playerIndex: number,
  lookup: ReferenceIdentityLookup,
  validateReference: typeof validatePlayerReference
): Promise<RequestState> => {
  const player = request.players[playerIndex];

  if (player?.resolution?.status !== "resolved") {
    return request;
  }

  const candidate = selectedReferenceCandidate(player.resolution);

  if (candidate === null) {
    return request;
  }

  const refreshed = await refreshIdentityIfStale(
    player,
    candidate,
    lookup,
    validateReference
  );

  if (refreshed === null) {
    return request;
  }

  return updateRequestPlayer(request, playerIndex, {
    ...player,
    resolution: refreshed,
  });
};

const resumePendingIdentity = async (
  request: RequestState,
  pending: AgentStateType["pendingClarification"],
  lookup: ReferenceIdentityLookup,
  findMemory: PlayerMemoryLookup,
  validateReference: typeof validatePlayerReference
): Promise<{
  pendingClarification: AgentStateType["pendingClarification"];
  request: RequestState;
  shouldStop: boolean;
}> => {
  if (pending?.kind !== "identity" || pending.answer === null) {
    return { pendingClarification: null, request, shouldStop: false };
  }

  let resumedRequest = await applyPlayerAnswer(
    request,
    pending.playerIndex,
    pending.answer,
    lookup,
    findMemory
  );

  resumedRequest = await revalidateResumedPlayerAnswer(
    resumedRequest,
    pending.playerIndex,
    lookup,
    validateReference
  );

  const resumedPlayer = resumedRequest.players[pending.playerIndex];

  if (resumedPlayer?.resolution?.status === "resolved") {
    return {
      pendingClarification: null,
      request: resumedRequest,
      shouldStop: false,
    };
  }

  if (resumedPlayer === undefined || resumedPlayer.attempts >= 1) {
    return {
      pendingClarification: null,
      request: resumedRequest,
      shouldStop: true,
    };
  }

  return {
    pendingClarification: {
      answer: null,
      kind: "identity",
      playerIndex: pending.playerIndex,
      question: identityClarificationQuestion(resumedPlayer),
    },
    request: resumedRequest,
    shouldStop: true,
  };
};

const recommendationClarificationForRequest = (
  request: RequestState
): AgentStateType["pendingClarification"] => {
  if (request.kind !== "player_recommendation") {
    return null;
  }

  const ambiguousIndex = request.players.findIndex(
    (player) => player.recommendationRole === "ambiguous"
  );

  if (ambiguousIndex !== -1) {
    const mention = request.players[ambiguousIndex]?.mention ?? "这位球员";

    return {
      answer: null,
      kind: "recommendation_role",
      playerIndex: ambiguousIndex,
      question: `“${mention}”要作为能力参考球员，还是从候选中排除？请回复“参考”或“排除”。`,
    };
  }

  if (
    request.recommendation.needsAgeClarification &&
    request.recommendation.maxAge === null
  ) {
    return {
      answer: null,
      kind: "age",
      question: "请给出高潜候选的具体年龄上限，例如 23 岁以下。",
    };
  }

  return null;
};

type ScoutingOutcomeKind = Exclude<
  NonNullable<AgentStateType["outcome"]>["kind"],
  "player_memory_management" | "state_compatibility"
>;

const outcomeKindForRequest = (request: RequestState): ScoutingOutcomeKind => {
  if (request.kind === "player_comparison") {
    return "player_comparison";
  }

  if (request.kind === "player_recommendation") {
    return "player_recommendation";
  }

  if (request.kind === "team_recommendation") {
    return "team_recommendation";
  }

  return "player_lookup";
};

const dataUnavailableOutcome = (request: RequestState): TurnOutcome => ({
  kind: outcomeKindForRequest(request),
  resultJson: null,
  status: "identity_data_unavailable",
});

const identityDataUnavailable = (request: RequestState): boolean =>
  request.players.some(
    (player) => player.resolution?.status === "data_unavailable"
  );

const rememberConfirmedIdentity = async (
  state: AgentStateType,
  request: RequestState,
  runtime: Parameters<GraphNode<typeof AgentState>>[1],
  store: ReturnType<typeof getStore>,
  memory: PlayerMemoryCapability
): Promise<boolean> => {
  const pending = state.pendingClarification;

  if (
    state.playerMemoryManagementRequest?.action === "correct" ||
    pending?.kind !== "identity" ||
    pending.answer === null
  ) {
    return false;
  }

  const player = request.players[pending.playerIndex];

  if (
    player === undefined ||
    player.referenceScope !== "explicit" ||
    isPlayerReferenceMention(player.mention) ||
    player.resolution?.status !== "resolved"
  ) {
    return false;
  }

  const candidate = selectedReferenceCandidate(player.resolution);

  if (candidate === null || candidate.records.length === 0) {
    return false;
  }

  const threadId = z.string().safeParse(runtime.configurable?.thread_id);

  if (store === undefined || !threadId.success) {
    return true;
  }

  const result = await memory.rememberIdentity(store, {
    candidate,
    mention: player.mention,
    originThreadId: threadId.data,
    playerIndex: pending.playerIndex,
    processedMessageId: request.processedMessageId,
  });

  return result.status === "unavailable";
};

const createEntityResolutionNode =
  (
    lookup: ReferenceIdentityLookup,
    memory: PlayerMemoryCapability,
    configuredStore: BaseStore | null
  ): GraphNode<typeof AgentState> =>
  async (state, runtime) => {
    const startedAt = Date.now();
    const store = configuredStore ?? getStore(runtime);

    const previousPlayerMemoryStatus =
      state.playerMemoryStatus ?? createInitialPlayerMemoryStatus();

    let memoryReadFailed = false;
    let memoryWriteFailed = false;

    const findMemory: PlayerMemoryLookup = async (mention) => {
      if (store === undefined) {
        memoryReadFailed = true;

        return { status: "unavailable" };
      }

      const result = await memory.findIdentity(store, mention);

      if (result.status === "unavailable") {
        memoryReadFailed = true;
      }

      return result;
    };

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

    const forceReresolution = identityReresolutionRequested(state);

    const resumedIdentity = await resumePendingIdentity(
      request,
      state.pendingClarification,
      lookup,
      findMemory,
      memory.validateReference
    );

    ({ request } = resumedIdentity);

    memoryWriteFailed = await rememberConfirmedIdentity(
      state,
      request,
      runtime,
      store,
      memory
    );

    let playerMemoryStatus = {
      readFailed: previousPlayerMemoryStatus.readFailed || memoryReadFailed,
      writeFailed: previousPlayerMemoryStatus.writeFailed || memoryWriteFailed,
    };

    if (resumedIdentity.shouldStop) {
      if (identityDataUnavailable(request)) {
        logLocalDataFailure(
          "resolve_entities",
          runtime,
          Date.now() - startedAt,
          1
        );

        return {
          conversationContext: conversationContextFromRequest(
            request,
            conversationContext
          ),
          outcome: dataUnavailableOutcome(request),
          pendingClarification: null,
          playerMemoryStatus,
          request,
        };
      }

      return {
        pendingClarification: resumedIdentity.pendingClarification,
        playerMemoryStatus,
        request,
      };
    }

    const outcome = await resolvePlayersInOrder(
      request,
      conversationContext,
      lookup,
      findMemory,
      memory.validateReference,
      forceReresolution
    );

    ({ request } = outcome);
    playerMemoryStatus = {
      readFailed: previousPlayerMemoryStatus.readFailed || memoryReadFailed,
      writeFailed: previousPlayerMemoryStatus.writeFailed || memoryWriteFailed,
    };

    if (outcome.unresolvedPlayerIndex !== null) {
      const player = request.players[outcome.unresolvedPlayerIndex];

      const hasResolvedParticipants = request.players.some(
        (requestPlayer) => requestPlayer.resolution?.status === "resolved"
      );

      const contextWithConfirmedAliases = hasResolvedParticipants
        ? conversationContextFromRequest(request, conversationContext)
        : conversationContext;

      if (identityDataUnavailable(request)) {
        logLocalDataFailure(
          "resolve_entities",
          runtime,
          Date.now() - startedAt,
          1
        );

        return {
          conversationContext: contextWithConfirmedAliases,
          outcome: dataUnavailableOutcome(request),
          pendingClarification: null,
          playerMemoryStatus,
          request,
        };
      }

      return {
        conversationContext: contextWithConfirmedAliases,
        pendingClarification: {
          answer: null,
          kind: "identity",
          playerIndex: outcome.unresolvedPlayerIndex,
          question: identityClarificationQuestion(player),
        },
        playerMemoryStatus,
        request,
      };
    }

    const pendingClarification = recommendationClarificationForRequest(request);

    const update: Partial<AgentStateType> = {
      pendingClarification,
      playerMemoryStatus,
      request,
    };

    if (request.players.length > 0) {
      update.conversationContext = conversationContextFromRequest(
        request,
        conversationContext
      );
    }

    return update;
  };

export { createEntityResolutionNode };
