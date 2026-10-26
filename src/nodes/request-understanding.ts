import type { GraphNode } from "@langchain/langgraph";

import {
  activeComparisonContext,
  mergeComparisonConstraints,
  requestPlayerFromReference,
} from "../comparison-context.js";
import {
  findConfirmedPlayerAliasesInMessage,
  latestHumanMessage,
  messageText,
} from "../player-mentions.js";
import type { RequestUnderstandingExtractor } from "../request-extraction.js";
import {
  normalizeExtractedPlayers,
  uniqueText,
} from "../request-extraction.js";
import type {
  AgentState,
  ConversationContext,
  RecommendationRequestState,
  RequestConstraint,
  RequestPlayerState,
} from "../state.js";
import {
  createInitialConversationContext,
  createInitialRecommendationRequest,
  createInitialRequestState,
} from "../state.js";

type RecommendationAction = "replace" | "add" | "refine";

const youthRecommendationPattern =
  /年轻|青年|青少年|小将|\bu(?:1[5-9]|2\d)\b|\byoung\b|\byouth\b/iu;

const youthNegationPatterns = [
  /不要年轻|不要青年|不需要年轻|不需要青年|不考虑年轻|不考虑青年|排除年轻|排除青年/iu,
  /no young|no youth|not interested in young/iu,
];

const potentialNegationPatterns = [
  /不要潜力|不要高潜|不需要潜力|不需要高潜|不考虑潜力|不考虑高潜|忽略潜力/iu,
  /不要\s*pa|不需要\s*pa|不考虑\s*pa|忽略\s*pa/iu,
  /只看当前能力|ignore potential|no potential|no\s*pa/iu,
];

const containsNegatedYouth = (text: string): boolean =>
  youthNegationPatterns.some((pattern) => pattern.test(text));

const containsNegatedPotential = (text: string): boolean =>
  potentialNegationPatterns.some((pattern) => pattern.test(text));

const aliasRole = (
  kind: string,
  mention: string,
  text: string
): "reference" | "exclude" | "ambiguous" => {
  if (kind !== "player_recommendation") {
    return "reference";
  }

  const normalizedText = text.normalize("NFKC").toLocaleLowerCase();
  const normalizedMention = mention.normalize("NFKC").toLocaleLowerCase();
  const mentionIndex = normalizedText.indexOf(normalizedMention);

  if (mentionIndex === -1) {
    return "ambiguous";
  }

  const before = normalizedText.slice(
    Math.max(0, mentionIndex - 16),
    mentionIndex
  );

  const after = normalizedText.slice(
    mentionIndex + normalizedMention.length,
    mentionIndex + normalizedMention.length + 20
  );

  const isExcluded =
    /(?:不要|排除|不考虑|剔除)\s*$/iu.test(before) ||
    /^\s*(?:不要|排除|不考虑|剔除)/iu.test(after);

  if (isExcluded) {
    return "exclude";
  }

  const isReference =
    /给|为|按|根据|参考|替代/iu.test(before) ||
    /找|寻找|参考|替代|的能力画像/iu.test(after);

  return isReference ? "reference" : "ambiguous";
};

const patchHasField = (
  patch: Awaited<ReturnType<RequestUnderstandingExtractor>>["recommendation"],
  field: keyof NonNullable<
    Awaited<ReturnType<RequestUnderstandingExtractor>>["recommendation"]
  >
): boolean => patch !== undefined && Object.hasOwn(patch, field);

const recommendationBaseline = (
  context: ConversationContext,
  action: RecommendationAction
): RecommendationRequestState => {
  const previous = context.activeRecommendation;

  if (action === "replace" || previous === null) {
    return createInitialRecommendationRequest();
  }

  return {
    includePotential: previous.includePotential,
    maxAge: previous.maxAge,
    minimumCurrentAbility: previous.minimumCurrentAbility,
    minimumPotentialAbility: previous.minimumPotentialAbility,
    needsAgeClarification: false,
    position: previous.position,
    resultLimit: previous.resultLimit,
  };
};

const recommendationFiltersFromPatch = (
  baseline: RecommendationRequestState,
  patch: Awaited<ReturnType<RequestUnderstandingExtractor>>["recommendation"],
  excludesPotential: boolean
): Pick<
  RecommendationRequestState,
  | "maxAge"
  | "minimumCurrentAbility"
  | "minimumPotentialAbility"
  | "position"
  | "resultLimit"
> => {
  const maxAge = patchHasField(patch, "maxAge")
    ? (patch?.maxAge ?? null)
    : baseline.maxAge;

  const minimumCurrentAbility = patchHasField(patch, "minimumCurrentAbility")
    ? (patch?.minimumCurrentAbility ?? null)
    : baseline.minimumCurrentAbility;

  let minimumPotentialAbility = patchHasField(patch, "minimumPotentialAbility")
    ? (patch?.minimumPotentialAbility ?? null)
    : baseline.minimumPotentialAbility;

  if (excludesPotential) {
    minimumPotentialAbility = null;
  }

  const position = patchHasField(patch, "position")
    ? (patch?.position ?? null)
    : baseline.position;

  const resultLimit = patchHasField(patch, "resultLimit")
    ? (patch?.resultLimit ?? null)
    : baseline.resultLimit;

  return {
    maxAge,
    minimumCurrentAbility,
    minimumPotentialAbility,
    position,
    resultLimit,
  };
};

const includePotentialFromIntent = (
  baseline: RecommendationRequestState,
  patch: Awaited<ReturnType<RequestUnderstandingExtractor>>["recommendation"],
  mentionsYouth: boolean,
  minimumPotentialAbility: number | null,
  excludesPotential: boolean
): boolean => {
  if (excludesPotential) {
    return false;
  }

  if (patchHasField(patch, "includePotential")) {
    return patch?.includePotential ?? false;
  }

  return (
    baseline.includePotential ||
    mentionsYouth ||
    minimumPotentialAbility !== null
  );
};

const mergeRecommendationIntent = (
  baseline: RecommendationRequestState,
  patch: Awaited<ReturnType<RequestUnderstandingExtractor>>["recommendation"],
  text: string
): RecommendationRequestState => {
  const mentionsYouth =
    youthRecommendationPattern.test(text) && !containsNegatedYouth(text);

  const excludesPotential = containsNegatedPotential(text);

  const filters = recommendationFiltersFromPatch(
    baseline,
    patch,
    excludesPotential
  );

  const { maxAge, minimumPotentialAbility } = filters;

  return {
    ...filters,
    includePotential: includePotentialFromIntent(
      baseline,
      patch,
      mentionsYouth,
      minimumPotentialAbility,
      excludesPotential
    ),
    needsAgeClarification:
      mentionsYouth && maxAge === null && !patchHasField(patch, "maxAge"),
  };
};

const recommendationFromText = (
  extracted: Awaited<ReturnType<RequestUnderstandingExtractor>>,
  text: string,
  context: ConversationContext,
  action: RecommendationAction
): RecommendationRequestState =>
  mergeRecommendationIntent(
    recommendationBaseline(context, action),
    extracted.recommendation,
    text
  );

const requestFromExtraction = (
  extracted: Awaited<ReturnType<RequestUnderstandingExtractor>>,
  fields: {
    constraints: RequestConstraint[];
    players: RequestPlayerState[];
    processedMessageId: string | null;
    teams: string[];
  },
  recommendation: ReturnType<typeof recommendationFromText>
) => {
  const requestFields = {
    constraints: fields.constraints,
    players: fields.players,
    processedMessageId: fields.processedMessageId,
    teams: fields.teams,
  };

  if (extracted.kind === "player_comparison") {
    return {
      ...requestFields,
      comparisonAction: extracted.comparisonAction ?? "replace",
      kind: extracted.kind,
    };
  }

  if (extracted.kind === "player_recommendation") {
    return { ...requestFields, kind: extracted.kind, recommendation };
  }

  return { ...requestFields, kind: extracted.kind };
};

const recommendationActionForRequest = (
  extracted: Awaited<ReturnType<RequestUnderstandingExtractor>>,
  context: ConversationContext
): RecommendationAction => {
  if (extracted.kind !== "player_recommendation") {
    return "replace";
  }

  if (extracted.recommendationAction === "add") {
    return "add";
  }

  if (extracted.players.length === 0 && context.activeRecommendation !== null) {
    return "refine";
  }

  return extracted.recommendationAction ?? "replace";
};

const recommendationPlayersFromContext = (
  context: ConversationContext,
  action: RecommendationAction
): RequestPlayerState[] => {
  const { activeRecommendation } = context;

  if (action === "replace" || activeRecommendation === null) {
    return [];
  }

  return [
    ...activeRecommendation.referencePlayers.map(requestPlayerFromReference),
    ...activeRecommendation.excludePlayers.map((reference) => ({
      ...requestPlayerFromReference(reference),
      recommendationRole: "exclude" as const,
    })),
  ];
};

const constraintsForRequest = (
  extracted: Awaited<ReturnType<RequestUnderstandingExtractor>>,
  context: ConversationContext,
  text: string,
  isComparisonAddition: boolean
): RequestConstraint[] => {
  if (extracted.kind === "player_comparison") {
    return mergeComparisonConstraints(
      isComparisonAddition ? context.activeComparison.constraints : [],
      extracted.constraints
    );
  }

  if (
    extracted.kind === "player_recommendation" &&
    containsNegatedYouth(text)
  ) {
    return [
      ...extracted.constraints,
      { name: "unsupported_youth_exclusion", value: "true" },
    ];
  }

  return extracted.constraints;
};

const createRequestUnderstandingNode =
  (
    extractRequest: RequestUnderstandingExtractor
  ): GraphNode<typeof AgentState> =>
  async (state) => {
    const currentRequest = state.request ?? createInitialRequestState();

    const conversationContext =
      state.conversationContext ?? createInitialConversationContext();

    const contextWithComparison = {
      ...conversationContext,
      activeComparison: activeComparisonContext(conversationContext),
    };

    const latestUserMessage = latestHumanMessage(state.messages);

    if (!latestUserMessage) {
      return {};
    }

    const messageId = latestUserMessage.id ?? null;

    if (messageId !== null && messageId === currentRequest.processedMessageId) {
      return {};
    }

    const text = messageText(latestUserMessage);
    const extracted = await extractRequest(text, contextWithComparison);

    const confirmedAliases = findConfirmedPlayerAliasesInMessage(
      text,
      contextWithComparison
    );

    const extractedPlayers = [
      ...extracted.players,
      ...confirmedAliases.map((mention) => ({
        lookupName: null,
        mention,
        recommendationRole: aliasRole(extracted.kind, mention, text),
        referenceScope: "explicit" as const,
      })),
    ];

    const recommendationAction = recommendationActionForRequest(
      extracted,
      contextWithComparison
    );

    const recommendation = recommendationFromText(
      extracted,
      text,
      contextWithComparison,
      recommendationAction
    );

    const isComparisonAddition =
      extracted.kind === "player_comparison" &&
      extracted.comparisonAction === "add";

    const inheritedComparisonPlayers = isComparisonAddition
      ? contextWithComparison.activeComparison.players.map(
          requestPlayerFromReference
        )
      : [];

    const isRecommendationContinuation =
      extracted.kind === "player_recommendation" &&
      recommendationAction !== "replace";

    const inheritedRecPlayers = isRecommendationContinuation
      ? recommendationPlayersFromContext(
          contextWithComparison,
          recommendationAction
        )
      : [];

    const constraints = constraintsForRequest(
      extracted,
      contextWithComparison,
      text,
      isComparisonAddition
    );

    const currentTurnPlayers = normalizeExtractedPlayers(
      text,
      extractedPlayers
    ).map((player) => ({
      ...player,
      attempts: 0,
      resolution: null,
    }));

    const players = [
      ...inheritedComparisonPlayers,
      ...inheritedRecPlayers,
      ...currentTurnPlayers,
    ];

    const request = requestFromExtraction(
      extracted,
      {
        constraints,
        players,
        processedMessageId: messageId,
        teams: uniqueText(extracted.teams),
      },
      recommendation
    );

    return {
      conversationContext: contextWithComparison,
      outcome: null,
      pendingClarification: null,
      request,
    };
  };

export { createRequestUnderstandingNode };
