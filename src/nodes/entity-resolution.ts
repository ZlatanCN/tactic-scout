import type { GraphNode } from "@langchain/langgraph";

import { logLocalDataFailure } from "../fault-tolerance.js";
import { selectedReferenceCandidate } from "../player-data/contracts.js";
import type { ReferenceIdentityLookup } from "../player-data/resolve-reference.js";
import {
  isPlayerReferenceMention,
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

const retryIdentityLookup = async (
  request: RequestState,
  index: number,
  player: RequestPlayerState,
  current: PlayerResolutionState,
  answer: string,
  lookup: ReferenceIdentityLookup
): Promise<RequestState> => {
  if (player.attempts >= 1) {
    return request;
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
  };
};

const applyPlayerAnswer = (
  request: RequestState,
  index: number,
  answer: string,
  lookup: ReferenceIdentityLookup
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

  return retryIdentityLookup(request, index, player, current, answer, lookup);
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
    return await refreshKnownAliasForComparison(
      player,
      request,
      knownAlias,
      lookup
    );
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
    return { request, unresolvedPlayerIndex: null };
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
    return { request, unresolvedPlayerIndex: playerIndex };
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
    return { request: updatedRequest, unresolvedPlayerIndex: playerIndex };
  }

  return await resolvePlayersInOrder(
    updatedRequest,
    context,
    lookup,
    scopeIndex,
    playerIndex + 1
  );
};

const resumePendingIdentity = async (
  request: RequestState,
  pending: AgentStateType["pendingClarification"],
  lookup: ReferenceIdentityLookup
): Promise<{
  pendingClarification: AgentStateType["pendingClarification"];
  request: RequestState;
  shouldStop: boolean;
}> => {
  if (pending?.kind !== "identity" || pending.answer === null) {
    return { pendingClarification: null, request, shouldStop: false };
  }

  const resumedRequest = await applyPlayerAnswer(
    request,
    pending.playerIndex,
    pending.answer,
    lookup
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

const outcomeKindForRequest = (
  request: RequestState
): Extract<AgentStateType["outcome"], { kind: string }>["kind"] => {
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

const dataUnavailableOutcome = (request: RequestState) => ({
  kind: outcomeKindForRequest(request),
  resultJson: null,
  status: "identity_data_unavailable",
});

const identityDataUnavailable = (request: RequestState): boolean =>
  request.players.some(
    (player) => player.resolution?.status === "data_unavailable"
  );

const createEntityResolutionNode =
  (lookup: ReferenceIdentityLookup): GraphNode<typeof AgentState> =>
  async (state, runtime) => {
    const startedAt = Date.now();
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

    const resumedIdentity = await resumePendingIdentity(
      request,
      state.pendingClarification,
      lookup
    );

    ({ request } = resumedIdentity);

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
          request,
        };
      }

      return {
        pendingClarification: resumedIdentity.pendingClarification,
        request,
      };
    }

    const outcome = await resolvePlayersInOrder(
      request,
      conversationContext,
      lookup
    );

    ({ request } = outcome);

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
        request,
      };
    }

    const pendingClarification = recommendationClarificationForRequest(request);

    const update: Partial<AgentStateType> = {
      pendingClarification,
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
