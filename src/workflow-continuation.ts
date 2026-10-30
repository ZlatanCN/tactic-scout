import { completedComparisonResultSchema } from "./player-data/compare-records.js";
import { selectedReferenceCandidate } from "./player-data/contracts.js";
import { searchPlayerRecordsResultSchema } from "./player-data/search-records.js";
import { normalizeMentionText } from "./player-mentions.js";
import { recommendationPatchFromConstraints } from "./recommendation-constraints.js";
import type {
  PreviousTurnSummary,
  RequestUnderstandingExtractor,
} from "./request-extraction.js";
import type {
  AgentStateType,
  ConversationContext,
  RequestKind,
  RequestPlayerState,
  TurnOutcome,
} from "./state.js";
import { createInitialRequestState } from "./state.js";
import { teamRecommendationResultSchema } from "./team-data/recommendation-result.js";
import { recommendationToolResultSchema } from "./tools/recommend-player-candidates.js";
import { decodeResultJson } from "./workflow-results.js";

type ExtractedRequest = Awaited<ReturnType<RequestUnderstandingExtractor>>;

const workflowKinds = [
  "player_lookup",
  "player_comparison",
  "player_recommendation",
  "team_recommendation",
] as const;

type WorkflowKind = (typeof workflowKinds)[number];

const workflowLabels: Record<WorkflowKind, string> = {
  player_comparison: "球员比较",
  player_lookup: "球员查询",
  player_recommendation: "球员推荐",
  team_recommendation: "球队推荐",
};

type ContinuationChoice = {
  requiresConfirmation: boolean;
  options: WorkflowKind[];
  workflow: WorkflowKind | null;
};

const workflowFromRequestKind = (
  kind: RequestKind | null
): WorkflowKind | null => {
  if (
    kind === "player_lookup" ||
    kind === "player_comparison" ||
    kind === "player_recommendation" ||
    kind === "team_recommendation"
  ) {
    return kind;
  }

  return null;
};

const previousTurnSummary = (state: AgentStateType): PreviousTurnSummary => {
  const failure = state.faultTolerance?.failure ?? null;

  if (failure?.node === "understand_request") {
    return {
      dataCompleted: false,
      failureStage: "understanding",
      source: null,
      workflow: null,
    };
  }

  const outcome = state.outcome ?? null;

  const source =
    outcome !== null && "source" in outcome ? outcome.source : null;

  const dataCompleted = source !== null;
  let failureStage: PreviousTurnSummary["failureStage"];

  if (failure !== null) {
    failureStage = failure.node === "answer" ? "answer" : "data";
  } else if (
    outcome !== null &&
    source === null &&
    outcome.status !== "answer_ready"
  ) {
    failureStage = "data";
  }

  const request = state.request ?? createInitialRequestState();

  const workflow =
    outcome?.kind ?? (request.kind === "other" ? null : request.kind);

  const summary: PreviousTurnSummary = { dataCompleted, source, workflow };

  if (failureStage !== undefined) {
    summary.failureStage = failureStage;
  }

  return summary;
};

const hasSavedWorkflowResult = (
  context: ConversationContext,
  workflow: WorkflowKind
): boolean => {
  if (workflow === "player_lookup") {
    return context.activeLookup !== null;
  }

  if (workflow === "player_comparison") {
    return (
      context.activeComparison.players.length >= 2 &&
      context.activeComparison.resultJson.length > 0
    );
  }

  if (workflow === "player_recommendation") {
    return context.activeRecommendation !== null;
  }

  return context.activeTeamRecommendation !== null;
};

const workflowsWithSavedResults = (
  context: ConversationContext
): WorkflowKind[] =>
  workflowKinds.filter((workflow) => hasSavedWorkflowResult(context, workflow));

const sameStringSet = (first: string[], second: string[]): boolean => {
  const firstValues = [...new Set(first)].toSorted();
  const secondValues = [...new Set(second)].toSorted();

  return (
    firstValues.length === secondValues.length &&
    firstValues.every((value, index) => value === secondValues[index])
  );
};

const requestIdentity = (player: RequestPlayerState): string | null => {
  const candidate = selectedReferenceCandidate(player.resolution);

  return candidate === null
    ? null
    : (candidate.canonicalIdentityId ?? candidate.candidateId);
};

const lookupRequestMatchesSavedWorkflow = (
  state: AgentStateType,
  context: ConversationContext
): boolean => {
  const { request } = state;
  const { activeLookup } = context;

  if (request.kind !== "player_lookup" || activeLookup === null) {
    return false;
  }

  const [player] = request.players;
  const referenceId = player === undefined ? null : requestIdentity(player);

  if (referenceId !== activeLookup.player.referenceId || player === undefined) {
    return false;
  }

  const candidate = selectedReferenceCandidate(player.resolution);

  if (candidate === null) {
    return false;
  }

  const currentSourceRecords = candidate.records.map(
    ({ provider, sourceId }) => `${provider}:${sourceId}`
  );

  const savedResult = decodeResultJson(
    activeLookup.resultJson,
    searchPlayerRecordsResultSchema
  ).data;

  if ("result" in savedResult) {
    return false;
  }

  const savedSourceRecords = savedResult.query.map(
    ({ provider, sourceId }) => `${provider}:${sourceId}`
  );

  const requestedSeason = request.constraints.find(
    ({ name }) => name === "understatSeasonStartYear"
  );

  const requestedSeasonStartYear =
    requestedSeason === undefined ? null : Number(requestedSeason.value);

  const savedSeasonStartYear =
    savedResult.requestedUnderstatSeasonStartYear ?? null;

  return (
    sameStringSet(currentSourceRecords, savedSourceRecords) &&
    requestedSeasonStartYear === savedSeasonStartYear
  );
};

const comparisonRequestMatchesSavedWorkflow = (
  state: AgentStateType,
  context: ConversationContext
): boolean => {
  const { request } = state;

  if (request.kind !== "player_comparison") {
    return false;
  }

  const current = request.players.flatMap((player) => {
    const referenceId = requestIdentity(player);

    return referenceId === null ? [] : [referenceId];
  });

  const saved = context.activeComparison.players.map(
    ({ referenceId }) => referenceId
  );

  if (request.comparisonAction === "replace") {
    return sameStringSet(current, saved);
  }

  const currentSet = new Set(current);

  return saved.every((referenceId) => currentSet.has(referenceId));
};

const playerRecommendationMatchesSavedWorkflow = (
  state: AgentStateType,
  context: ConversationContext
): boolean => {
  const { request } = state;
  const saved = context.activeRecommendation;

  if (request.kind !== "player_recommendation" || saved === null) {
    return false;
  }

  const currentReferences = request.players.flatMap((player) => {
    if (player.recommendationRole !== "reference") {
      return [];
    }

    const referenceId = requestIdentity(player);

    return referenceId === null ? [] : [referenceId];
  });

  const currentExclusions = request.players.flatMap((player) => {
    if (player.recommendationRole !== "exclude") {
      return [];
    }

    const referenceId = requestIdentity(player);

    return referenceId === null ? [] : [referenceId];
  });

  return (
    request.recommendation.position === saved.position &&
    sameStringSet(
      currentReferences,
      saved.referencePlayers.map(({ referenceId }) => referenceId)
    ) &&
    sameStringSet(
      currentExclusions,
      saved.excludePlayers.map(({ referenceId }) => referenceId)
    )
  );
};

const teamRecommendationMatchesSavedWorkflow = (
  state: AgentStateType,
  context: ConversationContext
): boolean => {
  const { request } = state;
  const saved = context.activeTeamRecommendation;

  if (request.kind !== "team_recommendation" || saved === null) {
    return false;
  }

  const requestedTeam = request.teamRecommendation.team;

  const teamMatches =
    requestedTeam === null
      ? request.teamRecommendation.teamName
          ?.trim()
          .normalize("NFKC")
          .toLowerCase() ===
        saved.team.name.trim().normalize("NFKC").toLowerCase()
      : requestedTeam.id === saved.team.id;

  const targetMatches =
    teamMatches &&
    request.teamRecommendation.position === saved.position &&
    request.teamRecommendation.referenceMode === saved.referenceMode;

  if (targetMatches && saved.referenceMode === "squad") {
    return true;
  }

  if (targetMatches && saved.referenceMode === "named") {
    const currentReferences = request.players.flatMap((player) => {
      const referenceId = requestIdentity(player);

      return referenceId === null ? [] : [referenceId];
    });

    return sameStringSet(
      currentReferences,
      saved.referencePlayers.map(({ referenceId }) => referenceId)
    );
  }

  return false;
};

const failedRequestMatchesSavedWorkflow = (
  state: AgentStateType,
  context: ConversationContext,
  workflow: WorkflowKind
): boolean => {
  if (!hasSavedWorkflowResult(context, workflow)) {
    return false;
  }

  if (workflow === "player_lookup") {
    return lookupRequestMatchesSavedWorkflow(state, context);
  }

  if (workflow === "player_comparison") {
    return comparisonRequestMatchesSavedWorkflow(state, context);
  }

  if (workflow === "player_recommendation") {
    return playerRecommendationMatchesSavedWorkflow(state, context);
  }

  return teamRecommendationMatchesSavedWorkflow(state, context);
};

const canReuseSavedWorkflowAfterTurn = (
  state: AgentStateType,
  context: ConversationContext,
  previous: PreviousTurnSummary,
  workflow: WorkflowKind
): boolean => {
  if (previous.failureStage === "understanding") {
    return false;
  }

  if (previous.failureStage === "data") {
    return (
      workflowFromRequestKind(previous.workflow) === workflow &&
      failedRequestMatchesSavedWorkflow(state, context, workflow)
    );
  }

  return previous.failureStage !== "answer" || previous.dataCompleted;
};

const compatibleContinuationWorkflows = (
  extracted: ExtractedRequest,
  context: ConversationContext
): WorkflowKind[] => {
  const saved = workflowsWithSavedResults(context);

  if (extracted.continuationAction === "explain") {
    return saved;
  }

  const recommendationPatch = {
    ...extracted.recommendation,
    ...recommendationPatchFromConstraints(extracted.constraints),
  };

  const hasRecommendationPatch = Object.keys(recommendationPatch).length > 0;

  const hasComparisonScope = extracted.constraints.some(({ name }) =>
    /season|赛季|competition/iu.test(name)
  );

  let candidates: WorkflowKind[];

  if (hasComparisonScope) {
    candidates = ["player_comparison"];
  } else if (extracted.teams.length > 0) {
    candidates = ["team_recommendation"];
  } else if (hasRecommendationPatch) {
    candidates = ["player_recommendation", "team_recommendation"];
  } else if (extracted.players.length > 0) {
    candidates = ["player_comparison", "player_recommendation"];

    if (context.activeTeamRecommendation?.referenceMode === "named") {
      candidates.push("team_recommendation");
    }
  } else {
    candidates = [
      "player_comparison",
      "player_recommendation",
      "team_recommendation",
    ];
  }

  const savedSet = new Set(saved);

  return candidates.filter((workflow) => savedSet.has(workflow));
};

const continuationChoice = (
  state: AgentStateType,
  context: ConversationContext,
  extracted: ExtractedRequest,
  previous: PreviousTurnSummary
): ContinuationChoice => {
  const candidates = compatibleContinuationWorkflows(extracted, context);
  const previousWorkflow = workflowFromRequestKind(previous.workflow);

  if (
    previous.failureStage === "data" &&
    previousWorkflow !== null &&
    failedRequestMatchesSavedWorkflow(state, context, previousWorkflow)
  ) {
    return {
      options: [],
      requiresConfirmation: false,
      workflow: candidates.includes(previousWorkflow) ? previousWorkflow : null,
    };
  }

  if (
    previous.failureStage === "data" ||
    (previous.failureStage === "answer" && !previous.dataCompleted)
  ) {
    return { options: [], requiresConfirmation: false, workflow: null };
  }

  if (
    previous.dataCompleted &&
    previousWorkflow !== null &&
    candidates.includes(previousWorkflow)
  ) {
    return {
      options: [],
      requiresConfirmation: false,
      workflow: previousWorkflow,
    };
  }

  if (previous.failureStage === "understanding" && candidates.length > 0) {
    return {
      options: candidates,
      requiresConfirmation: true,
      workflow: null,
    };
  }

  if (candidates.length === 1) {
    return {
      options: [],
      requiresConfirmation: false,
      workflow: candidates[0] ?? null,
    };
  }

  return candidates.length > 1
    ? { options: candidates, requiresConfirmation: true, workflow: null }
    : { options: [], requiresConfirmation: false, workflow: null };
};

const savedResultUnavailable = (workflow: WorkflowKind): TurnOutcome => ({
  kind: workflow,
  resultJson: null,
  status: "saved_result_unavailable",
});

const savedOutcomeForWorkflow = (
  workflow: WorkflowKind,
  context: ConversationContext
): TurnOutcome => {
  if (workflow === "player_lookup") {
    const stored = context.activeLookup?.resultJson;

    if (stored === undefined) {
      return savedResultUnavailable(workflow);
    }

    const { resultJson } = decodeResultJson(
      stored,
      searchPlayerRecordsResultSchema
    );

    return {
      kind: workflow,
      resultJson,
      source: "saved",
      status: "lookup_follow_up",
    };
  }

  if (workflow === "player_comparison") {
    const stored = context.activeComparison.resultJson;

    if (!stored) {
      return savedResultUnavailable(workflow);
    }

    const { data, resultJson } = decodeResultJson(
      stored,
      completedComparisonResultSchema
    );

    if (data.status !== "ready" && data.status !== "no_comparable_data") {
      return savedResultUnavailable(workflow);
    }

    return {
      kind: workflow,
      resultJson,
      source: "saved",
      status: data.status,
    };
  }

  if (workflow === "player_recommendation") {
    const stored = context.activeRecommendation?.resultJson;

    if (stored === undefined) {
      return savedResultUnavailable(workflow);
    }

    const { data, resultJson } = decodeResultJson(
      stored,
      recommendationToolResultSchema
    );

    if (data.status !== "ready" && data.status !== "no_candidates") {
      return savedResultUnavailable(workflow);
    }

    return {
      kind: workflow,
      resultJson,
      source: "saved",
      status: data.status,
    };
  }

  const stored = context.activeTeamRecommendation?.resultJson;

  if (stored === undefined) {
    return savedResultUnavailable(workflow);
  }

  const { data, resultJson } = decodeResultJson(
    stored,
    teamRecommendationResultSchema
  );

  if (data.status !== "ready" && data.status !== "no_candidates") {
    return savedResultUnavailable(workflow);
  }

  return {
    kind: workflow,
    resultJson,
    source: "saved",
    status: data.status,
  };
};

const savedLookupTargetMatches = (
  extracted: ExtractedRequest,
  context: ConversationContext
): boolean => {
  const { activeLookup } = context;

  if (activeLookup === null) {
    return false;
  }

  if (extracted.players.length === 0) {
    return true;
  }

  const { referenceId } = activeLookup.player;

  const aliases = context.playerAliases.flatMap(({ mention, reference }) =>
    reference.referenceId === referenceId ? [mention] : []
  );

  const knownNames = new Set(
    [
      activeLookup.player.candidate.name,
      ...activeLookup.player.candidate.records.map(({ name }) => name),
      ...aliases,
    ].map(normalizeMentionText)
  );

  return extracted.players.every((player) => {
    if (player.referenceScope === "explicit") {
      return knownNames.has(normalizeMentionText(player.mention));
    }

    return (
      player.referenceScope === "prior_context" &&
      context.focusPlayers.some(
        ({ referenceId: focusedId }) => focusedId === referenceId
      )
    );
  });
};

const savedOutcomeForRequest = (
  workflow: WorkflowKind,
  context: ConversationContext,
  extracted: ExtractedRequest
): TurnOutcome => {
  if (
    workflow === "player_lookup" &&
    !savedLookupTargetMatches(extracted, context)
  ) {
    return savedResultUnavailable(workflow);
  }

  return savedOutcomeForWorkflow(workflow, context);
};

const savedOutcomeForTurn = (
  state: AgentStateType,
  context: ConversationContext,
  previous: PreviousTurnSummary,
  workflow: WorkflowKind,
  extracted: ExtractedRequest
): TurnOutcome =>
  canReuseSavedWorkflowAfterTurn(state, context, previous, workflow)
    ? savedOutcomeForRequest(workflow, context, extracted)
    : savedResultUnavailable(workflow);

export {
  continuationChoice,
  canReuseSavedWorkflowAfterTurn,
  previousTurnSummary,
  savedOutcomeForRequest,
  savedOutcomeForTurn,
  savedResultUnavailable,
  savedOutcomeForWorkflow,
  workflowLabels,
  workflowKinds,
};

export type { WorkflowKind };
