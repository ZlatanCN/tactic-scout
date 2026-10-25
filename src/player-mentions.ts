import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod/v4";

import type { AgentStateType, ConversationContext } from "./state.js";

const latestHumanMessage = (messages: AgentStateType["messages"]) =>
  [...messages].toReversed().find((message) => message instanceof HumanMessage);

const messageText = (message: HumanMessage): string => {
  const content = z.string().safeParse(message.content);

  return content.success ? content.data : JSON.stringify(message.content);
};

const normalizeMentionText = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replaceAll(/[\s\p{P}\p{S}]/gu, "");

type AliasOccurrence = {
  end: number;
  mention: string;
  referenceId: string;
  start: number;
};

const aliasOccurrencesInMessage = (
  message: string,
  mention: string,
  referenceId: string
): AliasOccurrence[] => {
  if (/\p{Script=Han}/u.test(mention)) {
    const messageKey = normalizeMentionText(message);
    const mentionKey = normalizeMentionText(mention);
    const occurrences: AliasOccurrence[] = [];

    if (!mentionKey) {
      return occurrences;
    }

    let start = messageKey.indexOf(mentionKey);

    while (start >= 0) {
      occurrences.push({
        end: start + mentionKey.length,
        mention,
        referenceId,
        start,
      });
      start = messageKey.indexOf(mentionKey, start + 1);
    }

    return occurrences;
  }

  const escapedMention = mention
    .normalize("NFKC")
    .replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?<mention>${escapedMention})(?![\\p{L}\\p{N}])`,
    "giu"
  );

  const normalizedMessage = message.normalize("NFKC");
  const occurrences: AliasOccurrence[] = [];

  for (const match of normalizedMessage.matchAll(pattern)) {
    if (match.index !== undefined && match.groups?.mention !== undefined) {
      occurrences.push({
        end: match.index + match.groups.mention.length,
        mention,
        referenceId,
        start: match.index,
      });
    }
  }

  return occurrences;
};

const findConfirmedPlayerAliasesInMessage = (
  message: string,
  context: ConversationContext
): string[] => {
  const occurrences = context.playerAliases
    .flatMap((alias) =>
      aliasOccurrencesInMessage(
        message,
        alias.mention,
        alias.reference.referenceId
      )
    )
    .toSorted(
      (left, right) =>
        left.start - right.start ||
        right.end - right.start - (left.end - left.start)
    );

  const selectedOccurrences: AliasOccurrence[] = [];

  for (const occurrence of occurrences) {
    const overlappingIndex = selectedOccurrences.findIndex(
      (selected) =>
        selected.referenceId === occurrence.referenceId &&
        selected.start < occurrence.end &&
        occurrence.start < selected.end
    );

    if (overlappingIndex === -1) {
      selectedOccurrences.push(occurrence);
      continue;
    }

    const selected = selectedOccurrences[overlappingIndex];

    if (
      selected !== undefined &&
      occurrence.end - occurrence.start > selected.end - selected.start
    ) {
      selectedOccurrences[overlappingIndex] = occurrence;
    }
  }

  const seenMentions = new Set<string>();

  return selectedOccurrences.flatMap(({ mention }) => {
    const key = normalizeMentionText(mention);

    if (!key || seenMentions.has(key)) {
      return [];
    }

    seenMentions.add(key);

    return [mention];
  });
};

const findPlayerReferenceMention = (value: string): string | null => {
  const chineseMatch =
    /(?<!其)(?:他的|她的|它的|他自己|她自己|他|她|它)(?!们)|(?:这位|这名|这个|该)球员/gu.exec(
      value
    );

  if (chineseMatch) {
    return chineseMatch[0];
  }

  const englishMatch =
    /\b(?:himself|herself|their|them|they|him|her|his|hers|he|she|this player|that player|the player)\b/iu.exec(
      value
    );

  return englishMatch?.[0] ?? null;
};

const isPlayerReferenceMention = (value: string): boolean => {
  const referenceMention = findPlayerReferenceMention(value);

  return (
    (referenceMention !== null &&
      normalizeMentionText(referenceMention) === normalizeMentionText(value)) ||
    /^(?:this player|that player|the player)$/iu.test(value.trim())
  );
};

export {
  findConfirmedPlayerAliasesInMessage,
  findPlayerReferenceMention,
  isPlayerReferenceMention,
  latestHumanMessage,
  messageText,
  normalizeMentionText,
};
