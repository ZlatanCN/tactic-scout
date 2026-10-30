import type { GraphNode } from "@langchain/langgraph";

import {
  activeComparisonContext,
  mergeComparisonConstraints,
  requestPlayerFromReference,
} from "../comparison-context.js";
import { createModelRequestBudget } from "../model-requests.js";
import {
  findConfirmedPlayerAliasesInMessage,
  latestHumanMessage,
  messageText,
} from "../player-mentions.js";
import { recommendationPatchFromConstraints } from "../recommendation-constraints.js";
import type { RequestUnderstandingExtractor } from "../request-extraction.js";
import {
  normalizeExtractedPlayers,
  uniqueText,
} from "../request-extraction.js";
import type {
  AgentState,
  AgentStateType,
  ConversationContext,
  RecommendationRequestState,
  RequestConstraint,
  RequestKind,
  RequestPlayerState,
  RequestState,
  TeamRecommendationRequestState,
  TurnOutcome,
  WorkflowDraft,
} from "../state.js";
import {
  createInitialConversationContext,
  createInitialFaultToleranceState,
  createInitialRecommendationRequest,
  createInitialRequestState,
  createInitialTeamRecommendationRequest,
} from "../state.js";
import {
  continuationChoice,
  previousTurnSummary,
  savedOutcomeForWorkflow,
} from "../workflow-continuation.js";
import type { WorkflowKind } from "../workflow-continuation.js";

type ExtractedRequest = Awaited<ReturnType<RequestUnderstandingExtractor>>;

type RequestTurnBuild = { outcome: TurnOutcome | null; request: RequestState };

type RecommendationAction = "replace" | "add" | "refine";

const recommendationPatchFromRequest = (
  extracted: Awaited<ReturnType<RequestUnderstandingExtractor>>
) => ({
  ...extracted.recommendation,
  ...recommendationPatchFromConstraints(extracted.constraints),
});

const youthRecommendationPattern =
  /年轻|青年|青少年|小将|\bu(?:1[5-9]|2\d)\b|\byoung\b|\byouth\b/iu;

const lookupFollowUpPattern =
  /\b(?:which|what)\s+(?:season|league|source)\b|哪个赛季|什么赛季|哪个联赛|什么联赛|刚才(?:查到|的).{0,8}(?:赛季|数据|资料)/iu;

const explicitUnderstatSeasonPattern =
  /\b(?<startYear>20\d{2})\s*[/\-\u2010-\u2015]\s*(?:\d{2}|20\d{2})\b/u;

const seasonConstraintNamePattern = /season|赛季/iu;

const explicitUnderstatSeasonStartYearFromText = (
  text: string
): number | null => {
  const startYear =
    explicitUnderstatSeasonPattern.exec(text)?.groups?.startYear;

  return startYear === undefined ? null : Number(startYear);
};

const isLookupFollowUpRequest = (
  extracted: Awaited<ReturnType<RequestUnderstandingExtractor>>,
  text: string,
  context: ConversationContext
): boolean => {
  if (context.activeLookup === null || !lookupFollowUpPattern.test(text)) {
    return false;
  }

  const priorContextOnly = normalizeExtractedPlayers(
    text,
    extracted.players
  ).every(({ referenceScope }) => referenceScope === "prior_context");

  return (
    (extracted.kind === "other" || extracted.kind === "player_lookup") &&
    priorContextOnly
  );
};

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
    recommendationPatchFromRequest(extracted),
    text
  );

const requestFromExtraction = (
  extracted: ExtractedRequest & { kind: RequestKind },
  fields: {
    constraints: RequestConstraint[];
    players: RequestPlayerState[];
    processedMessageId: string | null;
    teams: string[];
  },
  recommendation: ReturnType<typeof recommendationFromText>,
  teamRecommendation: TeamRecommendationRequestState
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

  if (extracted.kind === "team_recommendation") {
    return {
      ...requestFields,
      kind: extracted.kind,
      teamRecommendation,
    };
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

const teamFiltersFromPatch = (
  baseline: Pick<
    TeamRecommendationRequestState,
    | "includePotential"
    | "maxAge"
    | "minimumCurrentAbility"
    | "minimumPotentialAbility"
    | "resultLimit"
  >,
  patch: Awaited<ReturnType<RequestUnderstandingExtractor>>["recommendation"]
) => {
  let { maxAge, minimumCurrentAbility, minimumPotentialAbility, resultLimit } =
    baseline;

  let includePotential = patch?.includePotential ?? baseline.includePotential;

  if (patchHasField(patch, "maxAge")) {
    maxAge = patch?.maxAge ?? null;
  }

  if (patchHasField(patch, "minimumCurrentAbility")) {
    minimumCurrentAbility = patch?.minimumCurrentAbility ?? null;
  }

  if (patchHasField(patch, "minimumPotentialAbility")) {
    minimumPotentialAbility = patch?.minimumPotentialAbility ?? null;

    if (
      patch?.includePotential === undefined &&
      minimumPotentialAbility !== null
    ) {
      includePotential = true;
    }
  }

  if (patchHasField(patch, "resultLimit")) {
    resultLimit = patch?.resultLimit ?? null;
  }

  return {
    includePotential,
    maxAge,
    minimumCurrentAbility,
    minimumPotentialAbility,
    resultLimit,
  };
};

const teamRecommendationFromText = (
  extracted: Awaited<ReturnType<RequestUnderstandingExtractor>>,
  context: ConversationContext
): TeamRecommendationRequestState => {
  const existing = context.activeTeamRecommendation;
  const teamNames = uniqueText(extracted.teams);
  const hasNewTeam = teamNames.length > 0;
  const patch = recommendationPatchFromRequest(extracted);

  const baseline =
    existing !== null && !hasNewTeam
      ? existing
      : createInitialTeamRecommendationRequest();

  let position = hasNewTeam ? null : baseline.position;

  let teamSearchName: string | null = existing?.team.name ?? null;

  if (patchHasField(patch, "position")) {
    position = patch.position ?? null;
  }

  if (hasNewTeam) {
    const extractedSearchName = extracted.teamSearchName?.trim() ?? "";
    teamSearchName =
      extractedSearchName.length > 0
        ? extractedSearchName
        : (teamNames[0] ?? null);
  }

  return {
    ...teamFiltersFromPatch(baseline, patch),
    position,
    referenceMode: baseline.referenceMode,
    roster: hasNewTeam ? null : baseline.roster,
    team: hasNewTeam ? null : baseline.team,
    teamName: teamNames[0] ?? existing?.team.name ?? null,
    teamSearchName,
  };
};

const teamRecommendationPlayersFromContext = (
  context: ConversationContext,
  request: TeamRecommendationRequestState
): RequestPlayerState[] => {
  if (
    request.referenceMode !== "named" ||
    context.activeTeamRecommendation === null
  ) {
    return [];
  }

  return context.activeTeamRecommendation.referencePlayers.map(
    requestPlayerFromReference
  );
};

const constraintsForRequest = (
  extracted: Awaited<ReturnType<RequestUnderstandingExtractor>>,
  context: ConversationContext,
  text: string,
  isComparisonAddition: boolean
): RequestConstraint[] => {
  if (extracted.kind === "player_lookup") {
    const seasonStartYear = explicitUnderstatSeasonStartYearFromText(text);

    const constraintsWithoutUnrequestedSeason = extracted.constraints.filter(
      ({ name }) => !seasonConstraintNamePattern.test(name)
    );

    if (seasonStartYear === null) {
      return constraintsWithoutUnrequestedSeason;
    }

    return [
      ...constraintsWithoutUnrequestedSeason,
      { name: "understatSeasonStartYear", value: String(seasonStartYear) },
    ];
  }

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

const requestFromCurrentTurn = (
  extracted: ExtractedRequest,
  workflow: RequestKind,
  context: ConversationContext,
  text: string,
  messageId: string | null
): RequestTurnBuild => {
  const routedExtraction = { ...extracted, kind: workflow };
  const confirmedAliases = findConfirmedPlayerAliasesInMessage(text, context);

  const extractedPlayers = [
    ...routedExtraction.players,
    ...confirmedAliases.map((mention) => ({
      lookupName: null,
      mention,
      recommendationRole: aliasRole(workflow, mention, text),
      referenceScope: "explicit" as const,
    })),
  ];

  const recommendationAction = recommendationActionForRequest(
    routedExtraction,
    context
  );

  const recommendation = recommendationFromText(
    routedExtraction,
    text,
    context,
    recommendationAction
  );

  const teamRecommendation = teamRecommendationFromText(
    routedExtraction,
    context
  );

  const isComparisonContinuation =
    workflow === "player_comparison" &&
    routedExtraction.comparisonAction !== "replace";

  const inheritedComparisonPlayers = isComparisonContinuation
    ? context.activeComparison.players.map(requestPlayerFromReference)
    : [];

  const inheritedRecPlayers =
    workflow === "player_recommendation" && recommendationAction !== "replace"
      ? recommendationPlayersFromContext(context, recommendationAction)
      : [];

  const inheritedTeamPlayers =
    workflow === "team_recommendation"
      ? teamRecommendationPlayersFromContext(context, teamRecommendation)
      : [];

  const constraints = constraintsForRequest(
    routedExtraction,
    context,
    text,
    isComparisonContinuation
  );

  const currentTurnPlayers =
    workflow === "team_recommendation"
      ? []
      : normalizeExtractedPlayers(text, extractedPlayers).map((player) => ({
          ...player,
          attempts: 0,
          resolution: null,
        }));

  const request = requestFromExtraction(
    routedExtraction,
    {
      constraints,
      players: [
        ...inheritedComparisonPlayers,
        ...inheritedRecPlayers,
        ...inheritedTeamPlayers,
        ...currentTurnPlayers,
      ],
      processedMessageId: messageId,
      teams: uniqueText(routedExtraction.teams),
    },
    recommendation,
    teamRecommendation
  );

  const lookupResultJson = context.activeLookup?.resultJson;

  const outcome: TurnOutcome | null =
    isLookupFollowUpRequest(routedExtraction, text, context) &&
    lookupResultJson !== undefined
      ? {
          kind: "player_lookup",
          resultJson: lookupResultJson,
          source: "saved",
          status: "lookup_follow_up",
        }
      : null;

  return { outcome, request };
};

const workflowDraftFromExtraction = (
  extracted: ExtractedRequest,
  text: string,
  messageId: string | null,
  context: ConversationContext
): WorkflowDraft => {
  const players = normalizeExtractedPlayers(text, [
    ...extracted.players,
    ...findConfirmedPlayerAliasesInMessage(text, context).map((mention) => ({
      lookupName: null,
      mention,
      recommendationRole: aliasRole("player_recommendation", mention, text),
      referenceScope: "explicit" as const,
    })),
  ]);

  return {
    comparisonAction: extracted.comparisonAction ?? null,
    constraints: extracted.constraints,
    operation:
      extracted.continuationAction === "explain" ? "explain" : "refine",
    players,
    processedMessageId: messageId,
    recommendation: extracted.recommendation ?? {},
    recommendationAction: extracted.recommendationAction ?? null,
    teamSearchName: extracted.teamSearchName ?? null,
    teams: uniqueText(extracted.teams),
    text,
  };
};

const recommendationPatchFromWorkflowDraft = (
  draft: WorkflowDraft
): NonNullable<ExtractedRequest["recommendation"]> => {
  const source = draft.recommendation;
  const patch: NonNullable<ExtractedRequest["recommendation"]> = {};

  if (Object.hasOwn(source, "includePotential")) {
    patch.includePotential = source.includePotential;
  }

  if (Object.hasOwn(source, "maxAge")) {
    patch.maxAge = source.maxAge;
  }

  if (Object.hasOwn(source, "minimumCurrentAbility")) {
    patch.minimumCurrentAbility = source.minimumCurrentAbility;
  }

  if (Object.hasOwn(source, "minimumPotentialAbility")) {
    patch.minimumPotentialAbility = source.minimumPotentialAbility;
  }

  if (Object.hasOwn(source, "position")) {
    patch.position = source.position;
  }

  if (Object.hasOwn(source, "resultLimit")) {
    patch.resultLimit = source.resultLimit;
  }

  return patch;
};

const resumeWorkflowClarification = (
  state: AgentStateType,
  draft: WorkflowDraft,
  workflow: WorkflowKind
) => {
  const context = {
    ...state.conversationContext,
    activeComparison: activeComparisonContext(state.conversationContext),
  };

  const extracted: ExtractedRequest = {
    comparisonAction: draft.comparisonAction ?? undefined,
    constraints: draft.constraints,
    continuationAction: draft.operation,
    kind: workflow,
    players: draft.players,
    recommendation: recommendationPatchFromWorkflowDraft(draft),
    recommendationAction: draft.recommendationAction ?? undefined,
    teamSearchName: draft.teamSearchName,
    teams: draft.teams,
  };

  const built = requestFromCurrentTurn(
    extracted,
    workflow,
    context,
    draft.text,
    draft.processedMessageId
  );

  const outcome =
    draft.operation === "explain"
      ? savedOutcomeForWorkflow(workflow, context)
      : built.outcome;

  return {
    conversationContext: context,
    faultTolerance: createInitialFaultToleranceState(),
    outcome,
    pendingClarification: null,
    request: built.request,
  };
};

const createRequestUnderstandingNode =
  (
    extractRequest: RequestUnderstandingExtractor
  ): GraphNode<typeof AgentState> =>
  async (state, runtime) => {
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
    const budget = createModelRequestBudget(runtime, "understand_request");
    const previous = previousTurnSummary(state);

    const extracted = await extractRequest(
      text,
      contextWithComparison,
      budget,
      previous
    );

    if (extracted.kind === null) {
      const choice = continuationChoice(
        state,
        contextWithComparison,
        extracted,
        previous
      );

      if (choice.options.length > 1) {
        const labels: Record<WorkflowKind, string> = {
          player_comparison: "球员比较",
          player_lookup: "球员查询",
          player_recommendation: "球员推荐",
          team_recommendation: "球队推荐",
        };

        const optionsText = choice.options
          .map((workflow, index) => `${index + 1}. ${labels[workflow]}`)
          .join("；");

        return {
          conversationContext: contextWithComparison,
          faultTolerance: createInitialFaultToleranceState(),
          outcome: null,
          pendingClarification: {
            answer: null,
            draft: workflowDraftFromExtraction(
              extracted,
              text,
              messageId,
              contextWithComparison
            ),
            kind: "workflow",
            options: choice.options,
            question: `你这次的修改可能指向多个已完成结果：${optionsText}。请选择一个编号。`,
          },
          request: {
            ...createInitialRequestState(),
            processedMessageId: messageId,
          },
        };
      }

      const workflow = choice.workflow ?? "other";

      const built = requestFromCurrentTurn(
        extracted,
        workflow,
        contextWithComparison,
        text,
        messageId
      );

      const outcome =
        workflow !== "other" && extracted.continuationAction === "explain"
          ? savedOutcomeForWorkflow(workflow, contextWithComparison)
          : built.outcome;

      return {
        conversationContext: contextWithComparison,
        faultTolerance: createInitialFaultToleranceState(),
        outcome,
        pendingClarification: null,
        request: built.request,
      };
    }

    const built = requestFromCurrentTurn(
      extracted,
      extracted.kind,
      contextWithComparison,
      text,
      messageId
    );

    const outcome =
      extracted.kind !== "other" && extracted.continuationAction === "explain"
        ? savedOutcomeForWorkflow(extracted.kind, contextWithComparison)
        : built.outcome;

    return {
      conversationContext: contextWithComparison,
      faultTolerance: createInitialFaultToleranceState(),
      outcome,
      pendingClarification: null,
      request: built.request,
    };
  };

const routeAfterRequestUnderstanding = (state: AgentStateType): string => {
  if (state.pendingClarification?.kind === "workflow") {
    return "clarify";
  }

  if (state.outcome?.status === "saved_result_unavailable") {
    return "answer";
  }

  if (
    state.outcome?.kind === "player_lookup" &&
    state.outcome.status === "lookup_follow_up"
  ) {
    return "answer";
  }

  if (state.outcome !== null && "source" in state.outcome) {
    return state.outcome.source === "saved" ? "answer" : "resolve_entities";
  }

  return "resolve_entities";
};

export {
  createRequestUnderstandingNode,
  resumeWorkflowClarification,
  routeAfterRequestUnderstanding,
};
