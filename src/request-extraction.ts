import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod/v4";

import {
  createExternalFaultError,
  externalFaultFrom,
} from "./fault-tolerance.js";
import { isRequestOutputValidationError } from "./model-requests.js";
import type { ModelRequestBudget } from "./model-requests.js";
import {
  findPlayerReferenceMention,
  isPlayerReferenceMention,
  normalizeMentionText,
} from "./player-mentions.js";
import type {
  ComparisonAction,
  ConversationContext,
  RequestConstraint,
  RequestKind,
  RecommendationPlayerRole,
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
  recommendationRole?: RecommendationPlayerRole;
  referenceScope?: ReferenceScope;
  referenceTargetMention?: string | null;
};

type ExtractedRequest = {
  comparisonAction?: ComparisonAction;
  kind: RequestKind;
  players: ExtractedPlayerMention[];
  recommendationAction?: RecommendationAction;
  recommendation?: RecommendationRequestPatch;
  teamSearchName?: string | null;
  teams: string[];
  constraints: RequestConstraint[];
};

type RecommendationAction = "replace" | "add" | "refine";

type RecommendationRequestPatch = {
  includePotential?: boolean;
  maxAge?: number | null;
  minimumCurrentAbility?: number | null;
  minimumPotentialAbility?: number | null;
  position?: string | null;
  resultLimit?: number | null;
};

type RequestUnderstandingExtractor = (
  message: string,
  context: ConversationContext,
  budget?: ModelRequestBudget
) => Promise<ExtractedRequest>;

type NormalizedExtractedPlayerMention = {
  mention: string;
  lookupName: string | null;
  recommendationRole: RecommendationPlayerRole;
  referenceScope: ReferenceScope;
  referenceTargetMention: string | null;
};

const recommendationExtractionSchema = z.object({
  includePotential: z.boolean().optional(),
  maxAge: z.number().int().min(1).max(120).nullable().optional(),
  minimumCurrentAbility: z.number().int().min(1).max(200).nullable().optional(),
  minimumPotentialAbility: z
    .number()
    .int()
    .min(1)
    .max(200)
    .nullable()
    .optional(),
  position: z
    .enum([
      "amc",
      "aml",
      "amr",
      "dc",
      "dl",
      "dm",
      "dr",
      "gk",
      "mc",
      "ml",
      "mr",
      "stc",
      "sw",
      "wbl",
      "wbr",
    ])
    .nullable()
    .optional(),
  resultLimit: z.number().int().min(1).max(20).nullable().optional(),
});

const requestExtractionSchema = z.object({
  comparisonAction: z
    .enum(["replace", "add"])
    .optional()
    .describe(
      "球员比较请求：replace 表示本轮提供的是完整比较名单；add 仅用于明确要求把球员加入当前 thread 已有比较。"
    ),
  constraints: z
    .array(
      z.object({
        name: z
          .string()
          .describe("赛季条件统一使用 season；其他条件使用其明确名称。"),
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
      recommendationRole: z
        .enum(["reference", "exclude", "ambiguous"])
        .default("reference")
        .describe(
          "仅用于球员推荐：reference 是能力画像参考对象；exclude 是用户明确要求排除的人；无法判断才用 ambiguous。球员查询/比较时使用 reference。"
        ),
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
  recommendation: recommendationExtractionSchema.optional(),
  recommendationAction: z
    .enum(["replace", "add", "refine"])
    .optional()
    .describe(
      "推荐请求：replace 使用本轮完整参考名单；add 明确把本轮球员加入最近成功的推荐参考名单；refine 只修改条件并继承最近成功推荐的身份和条件。"
    ),
  teamSearchName: z
    .string()
    .nullable()
    .optional()
    .describe(
      "仅用于 team_recommendation 的 API-Football 搜索词。保留 teams 里的原始称呼；若用户使用中文名或简称，可填对应的 API-Football 常见名称。它只生成搜索候选，不确认球队身份；不确定时留空。"
    ),
  teams: z.array(z.string()).describe("照抄用户本轮消息里提到的球队名。"),
});

const addToComparisonPattern =
  /(?:加入|加上|添加|纳入).{0,12}(?:对比|比较)|\b(?:add|include)\b.{0,80}\b(?:comparison|comparison set)\b/iu;

const addToRecommendationPattern =
  /(?:加入|加上|添加|纳入).{0,12}(?:参考|参考球员|推荐参考)|\b(?:add|include)\b.{0,80}\b(?:reference|recommendation reference)\b/iu;

const requestExtractionPrompt = `把用户本轮消息整理为一个请求类型和实体清单。输入还会包含本线程之前已确认的焦点球员、中文称呼绑定、最近一次成功球员查询和最近一次成功推荐。
player_lookup：查询球员记录或画像；player_comparison：比较球员；player_recommendation：寻找球员或替代者；team_recommendation：为球队推荐球员；other：其他请求。
team_recommendation 需要一个明确的球队和一个明确的 FM 位置。球队推荐的 recommendation 字段表示位置、年龄、CA、PA、结果数和高潜名单条件。teams 必须保留用户原话；若用户使用中文球队名或简称，teamSearchName 可给出 API-Football 常用搜索名称，但这只用于查候选，不能据此自动认定球队。用户只修改上次成功团队推荐的筛选条件时，teams 为空；明确换球队时照抄新球队名称，程序会重置旧球队上下文。
如果用户在追问最近成功球员查询中的赛季、赛事或来源，仍分类为 player_lookup；引用之前结果时不要要求用户重报球员。
comparisonAction 仅在 player_comparison 时有意义。用户明确说“把 X 也加入/加进当前对比”“再加上 X”时设为 add；用户明确列出一组新的完整比较对象时设为 replace。没有明确增补语义时一律 replace。add 时 players 仍只列本轮新增的称呼，已有比较对象会由程序从 thread 状态合并，不要重复输出。
recommendationAction 仅在 player_recommendation 时有意义。明确给出新参考名单时用 replace；明确要求把新球员加入最近成功推荐的参考名单时用 add；只修改最近成功推荐的条件、位置或结果数且没有新球员时用 refine。refine 时 players 为空，程序会继承最近成功推荐的已确认参考和排除身份。
constraints 只提取本轮原文明确指定的条件，不要复制 activeComparison.constraints；程序负责继承。赛季条件的 name 统一用 season，value 保留用户指定的赛季。
列出本轮消息里出现的所有球员称呼和球队。mention 必须照抄本轮原文。
球员推荐时，把每个称呼标为 reference 或 exclude。只有用户明确说“不要/排除/不考虑某人”才标 exclude；无法判断该人是参考还是排除时标 ambiguous。没有明确排除语义的球员都是 reference。recommendation.position 仅在用户明确指定一个 FM 位置时填对应小写代码：gk 守门员、dc 中卫、dl/dr 左右后卫、wbl/wbr 左右翼卫、dm 后腰、mc 中场中路、ml/mr 左右中场、aml/amr 左右边锋、amc 前腰、stc 中锋、sw 清道夫；“边锋”等含混说法不要擅自选择左右或中路。推荐字段只填写本轮明确修改的值：没有提及就省略字段；用户明确清除限制时填 null。不要把所有字段都填 null。年龄、CA、PA 和结果数只填写用户明确提出的数字；只说“年轻”不推算年龄上限。用户明确要求高潜名单时 includePotential=true，明确说不考虑潜力或只看当前能力时 includePotential=false。不要从单个“年轻”关键词推断用户想要高潜榜。
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

const recommendationActionFromResult = (
  result: {
    kind: RequestKind;
    players: { mention: string }[];
    recommendationAction?: RecommendationAction;
  },
  context: ConversationContext,
  message: string
): RecommendationAction | undefined => {
  if (result.kind === "player_recommendation") {
    if (
      result.recommendationAction === "add" ||
      addToRecommendationPattern.test(message)
    ) {
      return "add";
    }

    if (result.players.length === 0 && context.activeRecommendation !== null) {
      return "refine";
    }

    return result.recommendationAction === "refine" ? "refine" : "replace";
  }

  return undefined;
};

const normalizeRequestExtraction = (
  result: ExtractedRequest,
  message: string,
  context: ConversationContext
): ExtractedRequest => ({
  comparisonAction:
    result.comparisonAction === "add" || addToComparisonPattern.test(message)
      ? "add"
      : "replace",
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
            recommendationRole: player.recommendationRole ?? "reference",
            referenceScope: player.referenceScope ?? "explicit",
            referenceTargetMention:
              player.referenceTargetMention?.trim() ?? null,
          },
        ]
      : [];
  }),
  recommendation: result.recommendation,
  recommendationAction: recommendationActionFromResult(
    result,
    context,
    message
  ),
  teamSearchName: result.teamSearchName?.trim() ?? null,
  teams: uniqueText(result.teams),
});

const requestValidationFeedback = (error: Error): string => {
  const issueSchema = z.looseObject({
    issues: z.array(
      z.looseObject({
        path: z.array(z.union([z.string(), z.number()])).optional(),
      })
    ),
  });

  const parsed = issueSchema.safeParse(error);

  if (parsed.success) {
    const paths = parsed.data.issues.flatMap((issue) => {
      const path = issue.path?.join(".") ?? "";

      return path.length > 0 ? [path] : [];
    });

    if (paths.length > 0) {
      return `结构化输出未通过校验。请修正这些字段后重新输出：${[...new Set(paths)].join("、")}。`;
    }
  }

  return "结构化输出未通过 request schema 校验。请根据原始请求重新输出完整、符合 schema 的结构化结果，不要补猜。";
};

const invalidRequestOutputFailure = (
  requestsUsed: number,
  durationMs?: number
) =>
  createExternalFaultError({
    category: "invalid_response",
    durationMs,
    message: "模型未能返回有效的请求结构，本轮没有执行任何数据操作。",
    provider: "model",
    requestsUsed,
    retryable: false,
  });

const createRequestUnderstandingExtractor = (
  model: BaseChatModel
): RequestUnderstandingExtractor => {
  const structuredModel = model.withStructuredOutput(requestExtractionSchema, {
    method: "functionCalling",
  });

  return async (message, context, budget) => {
    const contextInput = {
      activeComparison: {
        constraints: context.activeComparison.constraints,
        players: context.activeComparison.players.map(
          ({ referenceId, candidate }) => ({
            canonicalIdentityId: candidate.canonicalIdentityId,
            name: candidate.name,
            referenceId,
          })
        ),
      },
      activeLookup:
        context.activeLookup === null
          ? null
          : {
              playerName: context.activeLookup.player.candidate.name,
              referenceId: context.activeLookup.player.referenceId,
            },
      activeRecommendation:
        context.activeRecommendation === null
          ? null
          : {
              excludePlayers: context.activeRecommendation.excludePlayers.map(
                ({ referenceId, candidate }) => ({
                  name: candidate.name,
                  referenceId,
                })
              ),
              filters: {
                includePotential: context.activeRecommendation.includePotential,
                maxAge: context.activeRecommendation.maxAge,
                minimumCurrentAbility:
                  context.activeRecommendation.minimumCurrentAbility,
                minimumPotentialAbility:
                  context.activeRecommendation.minimumPotentialAbility,
                position: context.activeRecommendation.position,
                resultLimit: context.activeRecommendation.resultLimit,
              },
              referencePlayers:
                context.activeRecommendation.referencePlayers.map(
                  ({ referenceId, candidate }) => ({
                    name: candidate.name,
                    referenceId,
                  })
                ),
            },
      activeTeamRecommendation:
        context.activeTeamRecommendation === null
          ? null
          : {
              filters: {
                includePotential:
                  context.activeTeamRecommendation.includePotential,
                maxAge: context.activeTeamRecommendation.maxAge,
                minimumCurrentAbility:
                  context.activeTeamRecommendation.minimumCurrentAbility,
                minimumPotentialAbility:
                  context.activeTeamRecommendation.minimumPotentialAbility,
                position: context.activeTeamRecommendation.position,
                resultLimit: context.activeTeamRecommendation.resultLimit,
              },
              team: {
                country: context.activeTeamRecommendation.team.country,
                id: context.activeTeamRecommendation.team.id,
                name: context.activeTeamRecommendation.team.name,
              },
            },
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

    const invokeStructuredOutput = async (feedback?: string) => {
      const input =
        feedback === undefined
          ? contextInput
          : { ...contextInput, validationFeedback: feedback };

      const messages = [
        new SystemMessage(requestExtractionPrompt),
        new HumanMessage(JSON.stringify(input)),
      ];

      return budget === undefined
        ? await structuredModel.invoke(messages)
        : await budget.invoke(
            async (signal) =>
              await structuredModel.invoke(messages, { signal }),
            { allowRateLimitRetry: feedback === undefined }
          );
    };

    try {
      return normalizeRequestExtraction(
        await invokeStructuredOutput(),
        message,
        context
      );
    } catch (error) {
      if (!(error instanceof Error) || !isRequestOutputValidationError(error)) {
        throw error;
      }

      if (budget === undefined || !budget.canMakeRequest()) {
        throw invalidRequestOutputFailure(
          budget?.requestsUsed() ?? 0,
          budget?.lastRequestDurationMs()
        );
      }

      budget.logRepair();

      try {
        return normalizeRequestExtraction(
          await invokeStructuredOutput(requestValidationFeedback(error)),
          message,
          context
        );
      } catch (repairError) {
        if (!(repairError instanceof Error)) {
          throw repairError;
        }

        const previousFault = externalFaultFrom(repairError);

        if (previousFault !== null) {
          throw createExternalFaultError({
            ...previousFault,
            retryable: false,
          });
        }

        if (isRequestOutputValidationError(repairError)) {
          throw invalidRequestOutputFailure(
            budget.requestsUsed(),
            budget.lastRequestDurationMs()
          );
        }

        throw repairError;
      }
    }
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

const resolveReferenceScope = (
  player: ExtractedPlayerMention,
  mention: string,
  appearsInMessage: boolean,
  detectedReference: string | null
): ReferenceScope => {
  let scope =
    player.referenceScope ??
    (isPlayerReferenceMention(mention) ? "prior_context" : "explicit");

  if (isPlayerReferenceMention(mention) && scope === "explicit") {
    scope = "prior_context";
  }

  if (!appearsInMessage && detectedReference !== null && scope === "explicit") {
    return "prior_context";
  }

  return scope;
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

  const referenceScope = resolveReferenceScope(
    player,
    mention,
    appearsInMessage,
    detectedReference
  );

  const recommendationRole = player.recommendationRole ?? "reference";

  if (referenceScope === "explicit") {
    if (!appearsInMessage) {
      return null;
    }

    return {
      lookupName: player.lookupName?.trim() ?? null,
      mention,
      recommendationRole,
      referenceScope,
      referenceTargetMention: null,
    };
  }

  const referenceMention = isPlayerReferenceMention(mention)
    ? mention
    : detectedReference;

  if (referenceMention === null) {
    return null;
  }

  return {
    lookupName: null,
    mention: referenceMention,
    recommendationRole,
    referenceScope,
    referenceTargetMention:
      referenceScope === "same_turn"
        ? (player.referenceTargetMention?.trim() ?? null)
        : null,
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
      recommendationRole: "reference",
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
