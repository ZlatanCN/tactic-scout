import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod/v4";

import type { ContextProcessingCompaction } from "./context-processing-state.js";
import {
  createExternalFaultError,
  externalFaultFrom,
} from "./fault-tolerance.js";
import { invokeWithModelContext } from "./model-context.js";
import type {
  ModelContextConfiguration,
  ModelContextRequest,
} from "./model-context.js";
import { isRequestOutputValidationError } from "./model-requests.js";
import type { ModelRequestBudget } from "./model-requests.js";
import { supportedPositionCodes } from "./player-data/position-features.js";
import { normalizeLatinNameSpelling } from "./player-data/shared.js";
import {
  findConfirmedPlayerAliasesInMessage,
  findPlayerReferenceMention,
  isPlayerReferenceMention,
  normalizeMentionText,
} from "./player-mentions.js";
import { recommendationPatchFromConstraints } from "./recommendation-constraints.js";
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
  kind: RequestKind | null;
  continuationAction?: "explain" | "refine" | null;
  players: ExtractedPlayerMention[];
  playerMemoryManagement?: PlayerMemoryManagementExtraction;
  recommendationAction?: RecommendationAction;
  recommendation?: RecommendationRequestPatch;
  teamSearchName?: string | null;
  teams: string[];
  constraints: RequestConstraint[];
};

const playerMemoryManagementActionSchema = z.enum([
  "list",
  "forget",
  "correct",
  "clear",
]);

type PlayerMemoryManagementAction = z.infer<
  typeof playerMemoryManagementActionSchema
>;

type PlayerMemoryManagementExtraction = {
  action: PlayerMemoryManagementAction;
  apiFootballPlayerId?: number | null;
  fmId?: string | null;
  replacementMention?: string | null;
  targetKind?: "player_identity" | "roster_identity" | null;
  targetMention?: string | null;
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
  budget?: ModelRequestBudget,
  previousTurn?: PreviousTurnSummary,
  compactedInstruction?: ContextProcessingCompaction | null
) => Promise<ExtractedRequest>;

type PreviousTurnSummary = {
  dataCompleted: boolean;
  failureStage?: "understanding" | "data" | "answer";
  source: "executed" | "saved" | null;
  workflow: RequestKind | null;
};

const buildRequestUnderstandingContextInput = (
  message: string,
  context: ConversationContext,
  previousTurn: PreviousTurnSummary | undefined
) => {
  const mentionedAliases = new Set(
    findConfirmedPlayerAliasesInMessage(message, context).map(
      normalizeMentionText
    )
  );

  return {
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
            referencePlayers: context.activeRecommendation.referencePlayers.map(
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
    confirmedPlayerAliases: context.playerAliases.flatMap(
      ({ mention, reference }) =>
        mentionedAliases.has(normalizeMentionText(mention))
          ? [
              {
                canonicalIdentityId: reference.candidate.canonicalIdentityId,
                mention,
                name: reference.candidate.name,
                referenceId: reference.referenceId,
              },
            ]
          : []
    ),
    currentMessage: message,
    focusPlayers: context.focusPlayers.map(({ referenceId, candidate }) => ({
      canonicalIdentityId: candidate.canonicalIdentityId,
      identityVerified: candidate.identityVerified,
      name: candidate.name,
      referenceId,
    })),
    previousTurn: previousTurn ?? null,
  };
};

type RequestUnderstandingContextInput = ReturnType<
  typeof buildRequestUnderstandingContextInput
>;

type CompactedScoutingInstructionInput = {
  anchors: ContextProcessingCompaction["anchors"];
  formatVersion: number;
  instruction: string | null;
  references: ContextProcessingCompaction["references"];
  sourceClarificationAnswers: string[];
  source: {
    hash: string;
    messageId: string;
    range: ContextProcessingCompaction["progress"];
  };
};

type RequestUnderstandingModelInput = RequestUnderstandingContextInput & {
  compactedScoutingInstruction?: CompactedScoutingInstructionInput;
  validationFeedback?: string;
};

type NormalizedExtractedPlayerMention = {
  mention: string;
  lookupName: string | null;
  recommendationRole: RecommendationPlayerRole;
  referenceScope: ReferenceScope;
  referenceTargetMention: string | null;
};

const englishResultLimitWords = new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
]);

const chineseResultLimitWords = new Map([
  ["一", 1],
  ["二", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9],
  ["十", 10],
  ["十一", 11],
  ["十二", 12],
  ["十三", 13],
  ["十四", 14],
  ["十五", 15],
  ["十六", 16],
  ["十七", 17],
  ["十八", 18],
  ["十九", 19],
  ["二十", 20],
]);

const resultLimitFromToken = (token: string): number | null => {
  const numericValue = Number(token);

  const value = Number.isInteger(numericValue)
    ? numericValue
    : (englishResultLimitWords.get(token.toLocaleLowerCase()) ??
      chineseResultLimitWords.get(token));

  return value !== undefined && value >= 1 && value <= 20 ? value : null;
};

const explicitResultLimitFromText = (message: string): number | null => {
  const normalizedMessage = message.normalize("NFKC");

  const englishLimit =
    /\b(?:up to|at most|no more than|maximum(?: of)?|limit(?: to| of)?)\s+(?<value>\d{1,2}|[a-z]+)\b/iu.exec(
      normalizedMessage
    )?.groups?.value;

  if (englishLimit !== undefined) {
    return resultLimitFromToken(englishLimit);
  }

  const chineseLimit =
    /(?:最多|不超过|不多于|上限(?:为)?|限制为)\s*(?<value>\d{1,2}|[一二三四五六七八九十]{1,3})\s*[名个位人]?/u.exec(
      normalizedMessage
    )?.groups?.value;

  return chineseLimit === undefined ? null : resultLimitFromToken(chineseLimit);
};

const normalizedRecommendationConstraintName = (name: string): string =>
  name
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[\s_-]/gu, "");

const isResultLimitConstraint = (name: string): boolean =>
  ["limit", "resultlimit", "maximumresults", "结果数", "最多"].includes(
    normalizedRecommendationConstraintName(name)
  );

const explicitRecommendationResultLimit = (
  kind: RequestKind | null,
  message: string
): number | null =>
  kind === "player_recommendation" || kind === "team_recommendation"
    ? explicitResultLimitFromText(message)
    : null;

const applyExplicitResultLimit = (
  constraints: RequestConstraint[],
  resultLimit: number | null
): RequestConstraint[] => {
  if (resultLimit === null) {
    return constraints;
  }

  return [
    ...constraints.filter(({ name }) => !isResultLimitConstraint(name)),
    { name: "resultLimit", value: String(resultLimit) },
  ];
};

const applyExplicitRecommendationValues = (
  recommendation: RecommendationRequestPatch | undefined,
  position: string | null,
  resultLimit: number | null
): RecommendationRequestPatch | undefined => {
  if (position === null && resultLimit === null) {
    return recommendation;
  }

  const updated: RecommendationRequestPatch = { ...recommendation };

  if (position !== null) {
    updated.position = position;
  }

  if (resultLimit !== null) {
    updated.resultLimit = resultLimit;
  }

  return updated;
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

const dataSourceMentionKeys = new Set([
  "apifootball",
  "fm",
  "footballmanager",
  "reep",
  "understat",
]);

const requestPlayerExtractionSchema = z.object({
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
    .describe("same_turn 时照抄本轮中被代词指向的明确姓名；其他情况为 null。"),
});

const normalizedRequestPlayerExtractionSchema =
  requestPlayerExtractionSchema.extend({
    referenceScope:
      requestPlayerExtractionSchema.shape.referenceScope.default("explicit"),
    referenceTargetMention:
      requestPlayerExtractionSchema.shape.referenceTargetMention.default(null),
  });

const requestExtractionSchema = z.object({
  comparisonAction: z
    .enum(["replace", "add", "refine"])
    .optional()
    .describe(
      "球员比较请求：replace 使用本轮完整名单；add 明确将球员加入当前比较；refine 表示只修改最近一次成功比较的条件并继承参与者。"
    ),
  constraints: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            "只记录用户明确提出且当前工作流支持的范围；player_lookup 的 Understat 赛季由程序从本轮原话解析，勿在此猜测。player_comparison 可用 season 和 competition 表示范围。指标名称不是筛选条件。"
          ),
        value: z.string(),
      })
    )
    .describe("只记录用户明确提出且当前数据工具支持的范围，不要补猜。"),
  continuationAction: z
    .enum(["explain", "refine"])
    .nullable()
    .optional()
    .describe(
      "引用已完成结果要求解释时为 explain；只改已完成任务条件时为 refine；其他新任务或普通聊天填 null。"
    ),
  kind: z
    .enum([
      "player_lookup",
      "player_comparison",
      "player_recommendation",
      "team_recommendation",
      "other",
    ])
    .nullable()
    .describe(
      "明确说出任务类型时填对应 workflow；只续接之前结果但没说类型时填 null；普通聊天和无关请求填 other。"
    ),
  playerMemoryManagement: z
    .object({
      action: playerMemoryManagementActionSchema,
      apiFootballPlayerId: z.number().int().positive().nullable().optional(),
      fmId: z.string().nullable().optional(),
      replacementMention: z.string().nullable().optional(),
      targetKind: z
        .enum(["player_identity", "roster_identity"])
        .nullable()
        .optional(),
      targetMention: z.string().nullable().optional(),
    })
    .optional()
    .describe(
      "仅用户明确要求查看、忘记、纠正或清空跨对话球员身份记忆时填写。forget 可指定球员称呼或 roster_identity 的精确 API-Football/FM ID。correct 必须分别提取原记忆称呼 targetMention 和替换球员 replacementMention，照抄本轮原话；不确定时留空。明确要求清空全部时用 action=clear，后续必须通过确认 interrupt 才能删除。"
    ),
  players: z.array(requestPlayerExtractionSchema),
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

type RawExtractedRequest = z.input<typeof requestExtractionSchema>;

const structuredRequestResponseSchema = requestExtractionSchema.extend({
  players: z.array(normalizedRequestPlayerExtractionSchema),
});

const addToComparisonPattern =
  /(?:加入|加上|添加|纳入).{0,12}(?:对比|比较)|\b(?:add|include)\b.{0,80}\b(?:comparison|comparison set)\b/iu;

const addToRecommendationPattern =
  /(?:加入|加上|添加|纳入).{0,12}(?:参考|参考球员|推荐参考)|\b(?:add|include)\b.{0,80}\b(?:reference|recommendation reference)\b/iu;

const explicitUnderstatSeasonPattern =
  /\b(?<startYear>20\d{2})\s*[/\-\u2010-\u2015]\s*(?:\d{2}|20\d{2})\b/u;

const relativeComparisonSeasonPattern =
  /\b(?:last|previous|current|this) season\b|上赛季|本赛季|这个赛季/iu;

const savedResultExplanationPattern =
  /(?:上次|之前|刚才).{0,12}(?:解释|说明|结果|推荐|比较)|\b(?:explain|describe)\b.{0,20}\b(?:previous|last|saved)\b/iu;

const requestExtractionPrompt = `把用户本轮消息整理为一个请求类型和实体清单。输入还会包含本线程之前已确认的焦点球员、本轮消息中出现的已绑定称呼、最近一次成功球员查询和各类已完成工作流摘要。
如果输入含 compactedScoutingInstruction，这是依据 currentMessage 原文生成的辅助表示；仅用它帮助理解请求，精确锚点及原文引用须与摘要一致。sourceClarificationAnswers 是用户针对同一原始请求给出的后续澄清，较新的明确答案覆盖原文中被纠正的含糊条件。摘要和引用都不是身份确认或新事实，必须继续遵守原有身份解析规则。条件含糊或相互矛盾时不要自行选择。
player_lookup：查询球员记录或画像；player_comparison：比较球员；player_recommendation：寻找球员或替代者；team_recommendation：为球队推荐球员；null：用户只说“年龄改到 22”“解释上次结果”等续接，但没说类型；other：普通聊天或无关请求。
如果用户明确询问你记住了哪些球员称呼/阵容映射，填写 playerMemoryManagement.action=list。若明确要求忘记一个称呼或一条阵容映射，填写 action=forget，尽量提取精确称呼、API-Football 球员 ID、FM ID 和 targetKind。没有明确查看/忘记操作时省略整个字段；“清空全部”或“纠正/改绑”不要作为 forget 处理。
continuationAction 为 explain 时只解释已保存结果，不得重跑工具；refine 表示把本轮明确条件补丁应用于选定成功快照。显式提到任务类型时必须填写对应 kind，不能因为其他 workflow 存在而改写用户目标。
player_lookup 的 Understat 赛季范围由程序从本轮原话解析；不要从上下文或模型知识补一个赛季。球员查询暂不按联赛过滤，competition 只用于球员比较范围。
team_recommendation 需要一个明确的球队和一个明确的 FM 位置。球队推荐的 recommendation 字段表示位置、年龄、CA、PA、结果数和高潜名单条件。team_recommendation 中，用户直接写出的受支持位置代码（如 stc、dc、dm）必须填入 recommendation.position，不能因为用户也提供了球队而省略。teams 必须保留本轮原话中出现的球队名；即使该球队与上次相同、用户同时细化筛选条件，也必须照抄到 teams。只有本轮没有写出球队名、且可从最近一次成功团队推荐继承时，teams 才留空。若用户使用中文球队名或简称，teamSearchName 可给出 API-Football 常用搜索名称，但这只用于查候选，不能据此自动认定球队。明确写出另一支球队时照抄新球队名称，程序会重置旧球队上下文。
如果用户说“根据 X 推荐 stc 球员”或“以 X 的能力画像推荐”，X 是球员参考，不是球队：分类为 player_recommendation，放入 players，不要放入 teams 或 teamSearchName。只有用户明确把 X 当作球队或俱乐部时，才分类为 team_recommendation。
如果用户在追问最近成功球员查询中的赛季、赛事或来源，仍分类为 player_lookup；引用之前结果时不要要求用户重报球员。
comparisonAction 仅在 player_comparison 时有意义。用户明确说“把 X 也加入/加进当前对比”“再加上 X”时设为 add；只修改最近成功比较的赛季或赛事范围时设为 refine；用户明确列出一组新的完整比较对象时设为 replace。没有明确增补或条件细化语义时一律 replace。add 时 players 只列本轮新增的称呼；refine 时 players 为空；程序负责继承已有参与者和条件。
recommendationAction 仅在 player_recommendation 时有意义。明确给出新参考名单时用 replace；明确要求把新球员加入最近成功推荐的参考名单时用 add；只修改最近成功推荐的条件、位置或结果数且没有新球员时用 refine。refine 时 players 为空，程序会继承最近成功推荐的已确认参考和排除身份。
player_comparison 的 constraints 只表示范围：赛季用 name=season，联赛用 name=competition，value 保留用户说的赛季或联赛名。比如“比较 2026/27 EPL 表现和 FM ability”应提取 season=2026/27、competition=EPL；“FM ability”是要展示的比较维度，不是筛选条件，不要提取为 attribute=FM ability。比较工具会单独展示 FM 能力，并只把同一联赛和赛季的 Understat 记录作为共同表现范围。
constraints 只提取本轮原文明确指定且当前工作流支持的条件，不要复制 activeComparison.constraints；程序负责继承。其他指标名称、数据来源或展示维度不是硬筛选条件，不要补猜或改写成条件。
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

const normalizeLookupName = (
  value: string | null | undefined
): string | null => {
  const lookupName = value?.trim() ?? "";

  return lookupName.length === 0 || /^(?:null|undefined)$/iu.test(lookupName)
    ? null
    : lookupName;
};

const stripPlayerNamePossessive = (value: string): string =>
  value.replaceAll(/['’]s$/giu, "");

const explicitUnderstatSeasonStartYearFromText = (
  text: string
): number | null => {
  const startYear =
    explicitUnderstatSeasonPattern.exec(text)?.groups?.startYear;

  return startYear === undefined ? null : Number(startYear);
};

const relativeComparisonSeasonFromText = (text: string): string | null => {
  if (explicitUnderstatSeasonPattern.test(text)) {
    return null;
  }

  return relativeComparisonSeasonPattern.exec(text)?.[0] ?? null;
};

const explicitPositionCodeFromText = (text: string): string | null => {
  const normalizedText = text.normalize("NFKC");

  const pattern = new RegExp(
    `(?:^|[^a-z0-9])(${supportedPositionCodes.join("|")})(?=$|[^a-z0-9])`,
    "giu"
  );

  const matches = [...normalizedText.matchAll(pattern)];

  if (matches.length !== 1) {
    return null;
  }

  const [match] = matches;
  const matchIndex = match?.index ?? 0;

  const precedingText = normalizedText.slice(
    Math.max(0, matchIndex - 8),
    matchIndex
  );

  if (/(?:不要|不需要|不考虑|不选|排除|no|not)\s*$/iu.test(precedingText)) {
    return null;
  }

  return match?.[1]?.toLowerCase() ?? null;
};

const teamRecommendationFromText = (
  text: string
): { position: string; team: string } | null => {
  const position = explicitPositionCodeFromText(text);

  if (position === null) {
    return null;
  }

  const chinesePattern = new RegExp(
    `(?:为|给)\\s*(?<team>[\\p{L}\\p{N}][\\p{L}\\p{N} .&'’\\-]{0,60}?)\\s*(?:推荐|寻找|找)\\s*(?:(?:一个|一名|一些)\\s*)?${position}\\s*(?:位置的?)?\\s*(?:球员|球员候选|人)(?=$|[。.!?])`,
    "iu"
  );

  const englishPattern = new RegExp(
    `\\b(?:recommend|find)\\s+(?:an?\\s+)?${position}\\s+(?:players?|prospects?)\\s+for\\s+(?<team>[\\p{L}\\p{N}][\\p{L}\\p{N} .&'’\\-]{0,60}?)(?:[.!?]|$)`,
    "iu"
  );

  const match = chinesePattern.exec(text) ?? englishPattern.exec(text);
  const team = match?.groups?.team?.trim() ?? "";

  if (
    !team ||
    new Set(["我", "我们", "你", "你们", "me", "us", "you"]).has(
      team.toLocaleLowerCase()
    )
  ) {
    return null;
  }

  return { position, team };
};

const playerBasedRecommendationFromText = (
  result: ExtractedRequest,
  message: string
): boolean => {
  if (
    result.kind !== "team_recommendation" ||
    explicitPositionCodeFromText(message) === null ||
    /球队|俱乐部|阵容|\b(?:team|club|squad)\b/iu.test(message)
  ) {
    return false;
  }

  const messageKey = normalizeMentionText(message);

  const referencePlayers = result.players.filter(
    ({ recommendationRole }) => recommendationRole !== "exclude"
  );

  const hasExplicitPlayer = referencePlayers.some(({ mention }) => {
    const mentionKey = normalizeMentionText(mention);

    return mentionKey.length > 0 && messageKey.includes(mentionKey);
  });

  const extractedTeamsArePlayerMentions = result.teams.every((team) =>
    referencePlayers.some(
      ({ mention }) =>
        normalizeMentionText(mention) === normalizeMentionText(team)
    )
  );

  const isPlayerBased =
    /(?:根据|基于|按照|参考|以).{0,80}(?:推荐|寻找|找)|\b(?:based on|using|similar to|like)\b/iu.test(
      message
    );

  return hasExplicitPlayer && extractedTeamsArePlayerMentions && isPlayerBased;
};

const recommendationActionFromResult = (
  result: {
    kind: RequestKind | null;
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

const continuationActionFromResult = (
  result: ExtractedRequest,
  message: string
): ExtractedRequest["continuationAction"] => {
  if (result.continuationAction !== undefined) {
    return result.continuationAction;
  }

  if (savedResultExplanationPattern.test(message)) {
    return "explain";
  }

  return result.kind === null ? "refine" : null;
};

const comparisonActionFromResult = (
  result: ExtractedRequest,
  context: ConversationContext,
  message: string
): ComparisonAction | undefined => {
  if (
    result.comparisonAction === "add" ||
    addToComparisonPattern.test(message)
  ) {
    return "add";
  }

  if (result.kind === null || result.comparisonAction === "refine") {
    return result.comparisonAction;
  }

  if (
    result.kind === "player_comparison" &&
    result.players.length === 0 &&
    context.activeComparison.players.length >= 2 &&
    result.constraints.length > 0
  ) {
    return "refine";
  }

  return "replace";
};

const memoryListVerbs =
  /查看|列出|显示|看看|告诉我|\blist\b|\bshow\b|\bview\b|what do you remember/iu;

const memoryNouns =
  /记住|记忆|已保存|球员身份|球员称呼|阵容映射|remembered|saved|players|aliases|mappings|memories/iu;

const memoryForgetVerbs =
  /忘记|遗忘|删除|移除|忘掉|\bforget\b|\bdelete\b|\bremove\b/iu;

const memoryCorrectionVerbs =
  /纠正|更正|改绑|改成|改为|记错|纠错|\bcorrect\b|\bfix\b|\bchange\b|\breplace\b/iu;

const memoryCorrectionContext =
  /记住的|已记住|记忆|称呼|别名|\bremembered\b|\bmemory\b|\balias(?:es)?\b|\bnickname\b/iu;

const memoryClearAll =
  /清空|清除|删除所有|删除全部|forget all|delete all|clear all|forget everything|clear everything/iu;

const memoryClearNegationPatterns = [
  /\b(?:do not|don't|never|should not|shouldn't|must not)\s+(?:clear|delete|forget)\b/iu,
  /\b(?:do not|don't)\s+(?:want|need)\s+to\b.{0,16}\b(?:clear|delete|forget)\b/iu,
  /(?:不要|别|不可|禁止|不想|不用|不需要)\s*(?:清空|清除|删除|忘记)/u,
] as const;

const aliasMemoryTargetWords =
  /别名|称呼|别称|球员身份|\balias(?:es)?\b|\bnickname\b/iu;

const rosterMemoryTargetWords =
  /阵容映射|阵容身份|\b(?:roster|squad)\s+(?:mapping|identity|link)\b/iu;

const normalizedMemoryCommandText = (value: string): string =>
  normalizeMentionText(
    normalizeLatinNameSpelling(value.normalize("NFKD")).normalize("NFKC")
  );

const mentionedMemoryTargetKind = (
  message: string
): PlayerMemoryManagementExtraction["targetKind"] => {
  const mentionsAlias = aliasMemoryTargetWords.test(message);
  const mentionsRoster = rosterMemoryTargetWords.test(message);

  if (mentionsAlias === mentionsRoster) {
    return null;
  }

  return mentionsAlias ? "player_identity" : "roster_identity";
};

const mentionIsPresentInMessage = (
  message: string,
  mention: string
): boolean => {
  const mentionKey = normalizedMemoryCommandText(mention);

  return (
    mentionKey.length > 0 &&
    normalizedMemoryCommandText(message).includes(mentionKey)
  );
};

const sourceIdIsPresentInMessage = (
  message: string,
  sourceId: string
): boolean =>
  sourceId.trim().length > 0 &&
  message.toLocaleLowerCase().includes(sourceId.trim().toLocaleLowerCase());

const apiFootballIdIsPresentInMessage = (
  message: string,
  apiFootballPlayerId: number
): boolean => {
  const id = String(apiFootballPlayerId);

  const idPattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${id}(?![\\p{L}\\p{N}])`,
    "u"
  );

  return idPattern.test(message);
};

const isExplicitPlayerMemoryManagementCommand = (
  message: string,
  action: PlayerMemoryManagementExtraction["action"]
): boolean => {
  if (action === "clear") {
    return (
      memoryClearAll.test(message) &&
      memoryNouns.test(message) &&
      !memoryClearNegationPatterns.some((pattern) => pattern.test(message))
    );
  }

  if (memoryClearAll.test(message)) {
    return false;
  }

  if (action === "list") {
    return memoryListVerbs.test(message) && memoryNouns.test(message);
  }

  if (action === "forget") {
    return memoryForgetVerbs.test(message);
  }

  return (
    memoryCorrectionVerbs.test(message) &&
    memoryCorrectionContext.test(message) &&
    aliasMemoryTargetWords.test(message)
  );
};

const normalizedClearCommand = (): PlayerMemoryManagementExtraction => ({
  action: "clear",
  apiFootballPlayerId: null,
  fmId: null,
  replacementMention: null,
  targetKind: null,
  targetMention: null,
});

const normalizedCorrectionCommand = (
  command: NonNullable<RawExtractedRequest["playerMemoryManagement"]>,
  message: string
): PlayerMemoryManagementExtraction => ({
  action: "correct",
  apiFootballPlayerId: null,
  fmId: null,
  replacementMention:
    command.replacementMention !== undefined &&
    command.replacementMention !== null &&
    mentionIsPresentInMessage(message, command.replacementMention)
      ? command.replacementMention.trim()
      : null,
  targetKind:
    mentionedMemoryTargetKind(message) === "player_identity"
      ? "player_identity"
      : null,
  targetMention:
    command.targetMention !== undefined &&
    command.targetMention !== null &&
    mentionIsPresentInMessage(message, command.targetMention)
      ? command.targetMention.trim()
      : null,
});

const normalizedForgetOrListCommand = (
  command: NonNullable<RawExtractedRequest["playerMemoryManagement"]>,
  message: string
): PlayerMemoryManagementExtraction => ({
  action: command.action,
  apiFootballPlayerId:
    command.apiFootballPlayerId !== undefined &&
    command.apiFootballPlayerId !== null &&
    apiFootballIdIsPresentInMessage(message, command.apiFootballPlayerId)
      ? command.apiFootballPlayerId
      : null,
  fmId:
    command.fmId !== undefined &&
    command.fmId !== null &&
    sourceIdIsPresentInMessage(message, command.fmId)
      ? command.fmId.trim()
      : null,
  targetKind: mentionedMemoryTargetKind(message),
  targetMention:
    command.targetMention !== undefined &&
    command.targetMention !== null &&
    mentionIsPresentInMessage(message, command.targetMention)
      ? command.targetMention.trim()
      : null,
});

const normalizePlayerMemoryManagement = (
  command: RawExtractedRequest["playerMemoryManagement"],
  message: string
): PlayerMemoryManagementExtraction | undefined => {
  if (
    command === undefined ||
    !isExplicitPlayerMemoryManagementCommand(message, command.action)
  ) {
    return undefined;
  }

  if (command.action === "clear") {
    return normalizedClearCommand();
  }

  if (command.action === "correct") {
    return normalizedCorrectionCommand(command, message);
  }

  return normalizedForgetOrListCommand(command, message);
};

const requestWithPlayerMemoryManagement = (
  request: ExtractedRequest,
  command: PlayerMemoryManagementExtraction | undefined
): ExtractedRequest =>
  command === undefined
    ? request
    : { ...request, playerMemoryManagement: command };

const normalizeRequestExtraction = (
  result: RawExtractedRequest,
  message: string,
  context: ConversationContext
): ExtractedRequest => {
  const teamRecommendation = teamRecommendationFromText(message);

  const playerBasedRecommendation = playerBasedRecommendationFromText(
    result,
    message
  );

  const isPlayerBasedRecommendation =
    playerBasedRecommendation && teamRecommendation === null;

  let { kind } = result;

  if (isPlayerBasedRecommendation) {
    kind = "player_recommendation";
  }

  if (teamRecommendation !== null) {
    kind = "team_recommendation";
  }

  const explicitResultLimit = explicitRecommendationResultLimit(kind, message);

  const normalizedConstraints = result.constraints.flatMap((constraint) => {
    const name = constraint.name.trim();
    const value = constraint.value.trim();

    return name && value ? [{ name, value }] : [];
  });

  const relativeSeason =
    result.kind === "player_comparison"
      ? relativeComparisonSeasonFromText(message)
      : null;

  const baseConstraints =
    relativeSeason === null
      ? normalizedConstraints
      : [
          ...normalizedConstraints.filter(
            ({ name }) => !/season|赛季/iu.test(name)
          ),
          { name: "season", value: relativeSeason },
        ];

  const constraints = applyExplicitResultLimit(
    baseConstraints,
    explicitResultLimit
  );

  const explicitTeamPosition =
    kind === "team_recommendation" || kind === "player_recommendation"
      ? explicitPositionCodeFromText(message)
      : null;

  const recommendation = applyExplicitRecommendationValues(
    result.recommendation,
    explicitTeamPosition,
    explicitResultLimit
  );

  let teams = uniqueText(result.teams);

  if (isPlayerBasedRecommendation) {
    teams = [];
  }

  if (teamRecommendation !== null) {
    teams = [teamRecommendation.team];
  }

  const normalizedRequest: ExtractedRequest = {
    comparisonAction: comparisonActionFromResult(result, context, message),
    constraints,
    continuationAction: continuationActionFromResult(result, message),
    kind,
    players: result.players.flatMap((player) => {
      const mention = player.mention.trim();

      return mention
        ? [
            {
              lookupName: normalizeLookupName(player.lookupName),
              mention,
              recommendationRole: player.recommendationRole ?? "reference",
              referenceScope: player.referenceScope ?? "explicit",
              referenceTargetMention:
                player.referenceTargetMention?.trim() ?? null,
            },
          ]
        : [];
    }),
    recommendation,
    recommendationAction:
      kind === null
        ? result.recommendationAction
        : recommendationActionFromResult({ ...result, kind }, context, message),
    teamSearchName: isPlayerBasedRecommendation
      ? null
      : (result.teamSearchName?.trim() ?? null),
    teams,
  };

  return requestWithPlayerMemoryManagement(
    normalizedRequest,
    normalizePlayerMemoryManagement(result.playerMemoryManagement, message)
  );
};

const recommendationPatchFromRequest = (extracted: ExtractedRequest) => ({
  ...extracted.recommendation,
  ...recommendationPatchFromConstraints(extracted.constraints),
});

const requestExtractionSchemaReminder =
  "必需字段 constraints、kind、players、teams 必须全部返回；没有内容时用空数组，kind 可以为 null。可选枚举字段 comparisonAction 和 recommendationAction 未指定时必须省略，不能填 null。";

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
      return `结构化输出未通过校验。请修正这些字段后重新输出：${[...new Set(paths)].join("、")}。${requestExtractionSchemaReminder}`;
    }
  }

  return `结构化输出未通过 request schema 校验。请根据原始请求重新输出完整、符合 schema 的结构化结果，不要补猜。${requestExtractionSchemaReminder}`;
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

const teamCurrentAbilityMinimumFromText = (
  message: string,
  context: ConversationContext
): ExtractedRequest | null => {
  if (context.activeTeamRecommendation === null) {
    return null;
  }

  const normalizedMessage = message.normalize("NFKC");

  const abilityMatch = /(?:\bCA\b|current\s+ability|当前能力)/iu.exec(
    normalizedMessage
  );

  if (abilityMatch === null) {
    return null;
  }

  const afterAbility = normalizedMessage.slice(
    abilityMatch.index + abilityMatch[0].length
  );

  const lowerBoundMatch =
    /^\s*(?:下限|不低于|至少|minimum|floor|at\s+least)/iu.exec(afterAbility);

  if (lowerBoundMatch === null) {
    return null;
  }

  const afterLowerBound = afterAbility.slice(
    lowerBoundMatch.index + lowerBoundMatch[0].length
  );

  const numericValue = afterLowerBound
    .trimStart()
    .replace(/^(?:设为|设置为|改为|调整为|to|of)\s*/iu, "")
    .trimStart();

  const valueMatch = /^(?<value>\d{1,3})/u.exec(numericValue);
  const value = Number(valueMatch?.groups?.value);

  if (valueMatch?.groups?.value === undefined || value < 1 || value > 200) {
    return null;
  }

  return normalizeRequestExtraction(
    {
      constraints: [],
      continuationAction: "refine",
      kind: "team_recommendation",
      players: [],
      recommendation: { minimumCurrentAbility: value },
      teams: [],
    },
    message,
    context
  );
};

const prepareRequestUnderstandingModelRequest = (input: {
  compactedInstruction?: ContextProcessingCompaction | null;
  context: ConversationContext;
  feedback?: string;
  message: string;
  previousTurn?: PreviousTurnSummary;
}): ModelContextRequest => {
  const contextInput = buildRequestUnderstandingContextInput(
    input.message,
    input.context,
    input.previousTurn
  );

  const compaction = input.compactedInstruction;
  const modelInput: RequestUnderstandingModelInput = contextInput;

  if (compaction !== undefined && compaction !== null) {
    modelInput.compactedScoutingInstruction = {
      anchors: compaction.anchors,
      formatVersion: compaction.formatVersion,
      instruction: compaction.instruction,
      references: compaction.references,
      source: {
        hash: compaction.sourceHash,
        messageId: compaction.sourceMessageId,
        range: compaction.progress,
      },
      sourceClarificationAnswers: compaction.sourceClarificationAnswers,
    };
    modelInput.currentMessage = compaction.instruction ?? input.message;
  }

  if (input.feedback !== undefined) {
    modelInput.validationFeedback = input.feedback;
  }

  const messages = [
    new SystemMessage(requestExtractionPrompt),
    new HumanMessage(JSON.stringify(modelInput)),
  ];

  return {
    currentUserInput: compaction?.instruction ?? input.message,
    messages,
    purpose: "understand_request",
    structuredOutputSchemas: [requestExtractionSchema],
  };
};

const createRequestUnderstandingExtractor =
  (
    model: BaseChatModel,
    modelContextConfiguration: ModelContextConfiguration = {}
  ): RequestUnderstandingExtractor =>
  async (message, context, budget, previousTurn, compactedInstruction) => {
    const teamFilterRefinement = teamCurrentAbilityMinimumFromText(
      message,
      context
    );

    if (teamFilterRefinement !== null) {
      return teamFilterRefinement;
    }

    const invokeStructuredOutput = async (feedback?: string) => {
      const request = prepareRequestUnderstandingModelRequest({
        compactedInstruction,
        context,
        feedback,
        message,
        previousTurn,
      });

      const response = await invokeWithModelContext(
        model,
        request,
        modelContextConfiguration,
        {},
        async (limitedModel, signal) =>
          await limitedModel
            .withStructuredOutput(requestExtractionSchema, {
              includeRaw: true,
              method: "functionCalling",
            })
            .invoke(request.messages, { signal }),
        budget,
        { allowRateLimitRetry: feedback === undefined }
      );

      const parsedResponse = z
        .looseObject({ parsed: requestExtractionSchema })
        .safeParse(response);

      return parsedResponse.success
        ? parsedResponse.data.parsed
        : structuredRequestResponseSchema.parse(response);
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
  const mention = stripPlayerNamePossessive(player.mention.trim());

  const lookupName = normalizeLookupName(
    player.lookupName === null || player.lookupName === undefined
      ? player.lookupName
      : stripPlayerNamePossessive(player.lookupName.trim())
  );

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
      lookupName,
      mention,
      recommendationRole,
      referenceScope,
      referenceTargetMention: null,
    };
  }

  if (
    referenceScope === "ambiguous" &&
    appearsInMessage &&
    !isPlayerReferenceMention(mention)
  ) {
    return {
      lookupName,
      mention,
      recommendationRole,
      referenceScope: "explicit",
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

const isCollectiveReferenceMention = (mention: string): boolean =>
  /^(?:they|them|their|theirs|themselves|他们|他们的|她们|她们的|它们|它们的)(?:respective|own|各自)?$/iu.test(
    normalizeMentionText(mention)
  );

const isDataSourceMention = (mention: string): boolean =>
  dataSourceMentionKeys.has(normalizeMentionText(mention));

const isExplicitPlayerMention = (
  messageKey: string,
  mention: string
): boolean => {
  const mentionKey = normalizeMentionText(mention);

  if (mentionKey.length === 0 || !messageKey.includes(mentionKey)) {
    return false;
  }

  return (
    !isDataSourceMention(mention) &&
    !isPlayerReferenceMention(mention) &&
    !isCollectiveReferenceMention(mention)
  );
};

const isIgnoredPlayerMention = (
  mention: string,
  hasCollectiveParticipants: boolean,
  hasSingleExplicitPlayer: boolean
): boolean => {
  if (isDataSourceMention(mention)) {
    return true;
  }

  if (hasCollectiveParticipants && isCollectiveReferenceMention(mention)) {
    return true;
  }

  return hasSingleExplicitPlayer && isPlayerReferenceMention(mention);
};

const normalizeExtractedPlayers = (
  message: string,
  players: ExtractedPlayerMention[]
): NormalizedExtractedPlayerMention[] => {
  const messageKey = normalizeMentionText(message);

  const explicitPlayerMentions = uniquePlayers(
    players.filter(({ mention }) =>
      isExplicitPlayerMention(messageKey, mention)
    )
  );

  const explicitPlayerCount = explicitPlayerMentions.length;
  const hasCollectiveParticipants = explicitPlayerCount >= 2;
  const hasSingleExplicitPlayer = explicitPlayerCount === 1;
  const detectedReferenceCandidate = findPlayerReferenceMention(message);

  const detectedReference =
    hasCollectiveParticipants &&
    detectedReferenceCandidate !== null &&
    isCollectiveReferenceMention(detectedReferenceCandidate)
      ? null
      : detectedReferenceCandidate;

  const normalizedPlayers: NormalizedExtractedPlayerMention[] = [];

  for (const player of players) {
    if (
      isIgnoredPlayerMention(
        player.mention,
        hasCollectiveParticipants,
        hasSingleExplicitPlayer
      )
    ) {
      continue;
    }

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
    !hasSingleExplicitPlayer &&
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
  buildRequestUnderstandingContextInput,
  createRequestUnderstandingExtractor,
  explicitUnderstatSeasonStartYearFromText,
  isExplicitPlayerMemoryManagementCommand,
  normalizeExtractedPlayers,
  prepareRequestUnderstandingModelRequest,
  recommendationPatchFromRequest,
  uniqueText,
};

export type {
  PlayerMemoryManagementExtraction,
  PreviousTurnSummary,
  RequestUnderstandingContextInput,
  RequestUnderstandingExtractor,
};
