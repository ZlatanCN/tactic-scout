import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod/v4";

import {
  findPlayerReferenceMention,
  isPlayerReferenceMention,
  normalizeMentionText,
} from "./player-mentions.js";
import type {
  ConversationContext,
  RequestConstraint,
  RequestKind,
} from "./state.js";

const referenceScopes = [
  "explicit",
  "prior_context",
  "same_turn",
  "ambiguous",
] as const;

type ReferenceScope = (typeof referenceScopes)[number];

type ExtractedPlayerMention = {
  mention: string;
  lookupName: string | null;
  referenceScope?: ReferenceScope;
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
  context: ConversationContext
) => Promise<ExtractedRequest>;

type NormalizedExtractedPlayerMention = {
  mention: string;
  lookupName: string | null;
  referenceScope: ReferenceScope;
  referenceTargetMention: string | null;
};

const requestExtractionSchema = z.object({
  constraints: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
      })
    )
    .describe("只记录用户明确提出的筛选条件，不要补猜。"),
  kind: z.enum([
    "player_lookup",
    "player_comparison",
    "player_recommendation",
    "team_recommendation",
    "other",
  ]),
  players: z.array(
    z.object({
      lookupName: z
        .string()
        .nullable()
        .describe(
          "仅用于本地搜索的可能标准姓名；非 explicit 引用必须为 null，不能据此确认身份。"
        ),
      mention: z.string().describe("照抄用户本轮消息里的球员称呼。"),
      referenceScope: z
        .enum(["explicit", "prior_context", "same_turn", "ambiguous"])
        .describe(
          "明确姓名为 explicit；代词指向前文焦点为 prior_context；指向本轮某个明确姓名为 same_turn；无法确定时为 ambiguous。"
        ),
      referenceTargetMention: z
        .string()
        .nullable()
        .describe(
          "same_turn 时照抄本轮中被代词指向的明确姓名；其他情况为 null。"
        ),
    })
  ),
  teams: z.array(z.string()).describe("照抄用户本轮消息里提到的球队名。"),
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

const uniqueText = (values: string[]): string[] => {
  const seen = new Set<string>();

  return values.flatMap((value) => {
    const text = value.trim();
    const key = text.normalize("NFKC").toLocaleLowerCase();

    if (!text || seen.has(key)) {
      return [];
    }

    seen.add(key);

    return [text];
  });
};

const createRequestUnderstandingExtractor = (
  model: BaseChatModel
): RequestUnderstandingExtractor => {
  const structuredModel = model.withStructuredOutput(requestExtractionSchema);

  return async (message, context) => {
    const contextInput = {
      confirmedPlayerAliases: context.playerAliases.map(
        ({ mention, reference }) => ({
          canonicalIdentityId: reference.candidate.canonicalIdentityId,
          mention,
          name: reference.candidate.name,
          referenceId: reference.referenceId,
        })
      ),
      currentMessage: message,
      focusPlayers: context.focusPlayers.map(({ referenceId, candidate }) => ({
        canonicalIdentityId: candidate.canonicalIdentityId,
        identityVerified: candidate.identityVerified,
        name: candidate.name,
        referenceId,
      })),
    };

    const result = await structuredModel.invoke([
      new SystemMessage(requestExtractionPrompt),
      new HumanMessage(JSON.stringify(contextInput)),
    ]);

    return {
      constraints: result.constraints.flatMap((constraint) => {
        const name = constraint.name.trim();
        const value = constraint.value.trim();

        return name && value ? [{ name, value }] : [];
      }),
      kind: result.kind,
      players: result.players.flatMap((player) => {
        const mention = player.mention.trim();

        return mention
          ? [
              {
                lookupName: player.lookupName?.trim() ?? null,
                mention,
                referenceScope: player.referenceScope,
                referenceTargetMention:
                  player.referenceTargetMention?.trim() ?? null,
              },
            ]
          : [];
      }),
      teams: uniqueText(result.teams),
    };
  };
};

const uniquePlayers = <T extends { mention: string }>(players: T[]): T[] => {
  const seen = new Set<string>();

  return players.filter((player) => {
    const key = player.mention.normalize("NFKC").trim().toLocaleLowerCase();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
};

const normalizeExtractedPlayer = (
  player: ExtractedPlayerMention,
  messageKey: string,
  detectedReference: string | null
): NormalizedExtractedPlayerMention | null => {
  const mention = player.mention.trim();

  if (mention.length === 0) {
    return null;
  }

  const mentionKey = normalizeMentionText(mention);

  const appearsInMessage =
    mentionKey.length > 0 && messageKey.includes(mentionKey);

  let referenceScope =
    player.referenceScope ??
    (isPlayerReferenceMention(mention) ? "prior_context" : "explicit");

  if (isPlayerReferenceMention(mention) && referenceScope === "explicit") {
    referenceScope = "prior_context";
  }

  if (
    !appearsInMessage &&
    detectedReference !== null &&
    referenceScope === "explicit"
  ) {
    referenceScope = "prior_context";
  }

  if (referenceScope !== "explicit") {
    const referenceMention = isPlayerReferenceMention(mention)
      ? mention
      : detectedReference;

    if (referenceMention === null) {
      return null;
    }

    return {
      lookupName: null,
      mention: referenceMention,
      referenceScope,
      referenceTargetMention:
        referenceScope === "same_turn"
          ? (player.referenceTargetMention?.trim() ?? null)
          : null,
    };
  }

  if (!appearsInMessage) {
    return null;
  }

  return {
    lookupName: player.lookupName?.trim() ?? null,
    mention,
    referenceScope: "explicit",
    referenceTargetMention: null,
  };
};

const normalizeExtractedPlayers = (
  message: string,
  players: ExtractedPlayerMention[]
): NormalizedExtractedPlayerMention[] => {
  const messageKey = normalizeMentionText(message);
  const detectedReference = findPlayerReferenceMention(message);
  const normalizedPlayers: NormalizedExtractedPlayerMention[] = [];

  for (const player of players) {
    const normalized = normalizeExtractedPlayer(
      player,
      messageKey,
      detectedReference
    );

    if (normalized !== null) {
      normalizedPlayers.push(normalized);
    }
  }

  if (
    detectedReference !== null &&
    !normalizedPlayers.some((player) => player.referenceScope !== "explicit")
  ) {
    normalizedPlayers.push({
      lookupName: null,
      mention: detectedReference,
      referenceScope: "prior_context",
      referenceTargetMention: null,
    });
  }

  return uniquePlayers(normalizedPlayers);
};

export {
  createRequestUnderstandingExtractor,
  normalizeExtractedPlayers,
  uniqueText,
};

export type { RequestUnderstandingExtractor };
