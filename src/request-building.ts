import {
  activeComparisonContext,
  mergeComparisonConstraints,
  requestPlayerFromReference,
} from "./comparison-context.js";
import { findConfirmedPlayerAliasesInMessage } from "./player-mentions.js";
import { recommendationPatchFromConstraints } from "./recommendation-constraints.js";
import type {
  PreviousTurnSummary,
  RequestUnderstandingExtractor,
} from "./request-extraction.js";
import { normalizeExtractedPlayers, uniqueText } from "./request-extraction.js";
import type {
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
} from "./state.js";
import {
  createInitialFaultToleranceState,
  createInitialRecommendationRequest,
  createInitialTeamRecommendationRequest,
} from "./state.js";
import {
  canReuseSavedWorkflowAfterTurn,
  savedOutcomeForRequest,
} from "./workflow-continuation.js";
import type { WorkflowKind } from "./workflow-continuation.js";

type ExtractedRequest = Awaited<ReturnType<RequestUnderstandingExtractor>>;

type RequestTurnInput = {
  context: ConversationContext;
  extracted: ExtractedRequest;
  messageId: string | null;
  text: string;
};

type RequestTurnBuild = { outcome: TurnOutcome | null; request: RequestState };

type RecommendationAction = "replace" | "add" | "refine";

type RecommendationFilterValues = Pick<
  RecommendationRequestState,
  "maxAge" | "minimumCurrentAbility" | "minimumPotentialAbility" | "resultLimit"
>;

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

const isBlockedLookupFollowUp = (
  state: AgentStateType,
  context: ConversationContext,
  extracted: ExtractedRequest,
  previous: PreviousTurnSummary,
  text: string
): boolean =>
  (extracted.kind === "other" || extracted.kind === "player_lookup") &&
  isLookupFollowUpRequest(extracted, text, context) &&
  !canReuseSavedWorkflowAfterTurn(state, context, previous, "player_lookup");

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
  kind: RequestKind,
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

const mergeRecommendationFilterValues = (
  baseline: RecommendationFilterValues,
  patch: ExtractedRequest["recommendation"]
): RecommendationFilterValues => ({
  maxAge: patchHasField(patch, "maxAge")
    ? (patch?.maxAge ?? null)
    : baseline.maxAge,
  minimumCurrentAbility: patchHasField(patch, "minimumCurrentAbility")
    ? (patch?.minimumCurrentAbility ?? null)
    : baseline.minimumCurrentAbility,
  minimumPotentialAbility: patchHasField(patch, "minimumPotentialAbility")
    ? (patch?.minimumPotentialAbility ?? null)
    : baseline.minimumPotentialAbility,
  resultLimit: patchHasField(patch, "resultLimit")
    ? (patch?.resultLimit ?? null)
    : baseline.resultLimit,
});

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
  const filters = mergeRecommendationFilterValues(baseline, patch);
  let { minimumPotentialAbility } = filters;

  if (excludesPotential) {
    minimumPotentialAbility = null;
  }

  const position = patchHasField(patch, "position")
    ? (patch?.position ?? null)
    : baseline.position;

  return {
    ...filters,
    minimumPotentialAbility,
    position,
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
  const filters = mergeRecommendationFilterValues(baseline, patch);
  let includePotential = patch?.includePotential ?? baseline.includePotential;

  if (
    patchHasField(patch, "minimumPotentialAbility") &&
    patch?.includePotential === undefined &&
    filters.minimumPotentialAbility !== null
  ) {
    includePotential = true;
  }

  return {
    ...filters,
    includePotential,
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
  input: RequestTurnInput,
  workflow: RequestKind
): RequestTurnBuild => {
  const { context, extracted, messageId, text } = input;
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
    workflow === "team_recommendation" &&
    teamRecommendation.referenceMode !== "named"
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
  input: RequestTurnInput
): WorkflowDraft => {
  const { context, extracted, messageId, text } = input;

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
    {
      context,
      extracted,
      messageId: draft.processedMessageId,
      text: draft.text,
    },
    workflow
  );

  const outcome =
    draft.operation === "explain"
      ? savedOutcomeForRequest(workflow, context, extracted)
      : built.outcome;

  return {
    conversationContext: context,
    faultTolerance: createInitialFaultToleranceState(),
    outcome,
    pendingClarification: null,
    request: built.request,
  };
};

export {
  isBlockedLookupFollowUp,
  isLookupFollowUpRequest,
  requestFromCurrentTurn,
  resumeWorkflowClarification,
  workflowDraftFromExtraction,
};

export type { RequestTurnInput };
