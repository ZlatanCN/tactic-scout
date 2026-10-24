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

const mentionOccursInMessage = (message: string, mention: string): boolean => {
  if (/\p{Script=Han}/u.test(mention)) {
    return normalizeMentionText(message).includes(
      normalizeMentionText(mention)
    );
  }

  const escapedMention = mention
    .normalize("NFKC")
    .replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapedMention}(?=$|[^\\p{L}\\p{N}])`,
    "iu"
  ).test(message.normalize("NFKC"));
};

const findConfirmedPlayerAliasesInMessage = (
  message: string,
  context: ConversationContext
): string[] =>
  context.playerAliases.flatMap((alias) =>
    mentionOccursInMessage(message, alias.mention) ? [alias.mention] : []
  );

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
