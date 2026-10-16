import { type PlayerProfile, type Position } from "../../domain/schemas.js";
import { normalizeSearchText } from "../../domain/text-matching.js";
import { type CandidateIdentityGroup, type CandidateIdentityGroupReference, toCandidateIdentityGroupReferences } from "../../identity/candidate-groups.js";
import { sourcePlayerKey } from "../../identity/source-player-key.js";
import { type CandidateSearchIntent, candidateMatchesSearchIntent, resolveCandidateSearchIntent } from "../candidate-search-intent.js";
import { type ConversationHistoryEntry } from "../planner-context.js";
import { type CandidateSearchAction, type CandidateSearchObservation, type EvaluatedPlayer, type State } from "./state.js";

export function candidateSearchScopeKey(action: CandidateSearchAction, discoveryMetricGroups: readonly (readonly string[])[] = []): string {
  return JSON.stringify({
    position: action.position,
    playerName: action.playerName ? normalizeSearchText(action.playerName) : null,
    maxAge: action.maxAge,
    minimumMinutes: action.minimumMinutes,
    competition: action.competition ? normalizeSearchText(action.competition) : null,
    season: action.season ? normalizeSearchText(action.season) : null,
    discoveryMetricGroups: discoveryMetricGroups.map(keys => [...keys].sort()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
}

function candidateSearchScopeKeyForIntent(intent: CandidateSearchIntent): string {
  return candidateSearchScopeKey({
    action: "search_candidates",
    position: intent.position,
    playerName: null,
    maxAge: intent.maxAge,
    minimumMinutes: intent.minimumMinutes,
    competition: intent.competition,
    season: intent.season,
    offset: 0,
    limit: 20,
  }, intent.discoveryMetricGroups);
}

export function candidateSearchObservationIndexForIntent(
  intent: CandidateSearchIntent,
  observations: CandidateSearchObservation[],
  minimumIndex = 0,
): number | null {
  const expectedScope = candidateSearchScopeKeyForIntent(intent);
  for (let index = observations.length - 1; index >= minimumIndex; index -= 1) {
    const observation = observations[index];
    if (observation.request.playerName === null
      && candidateSearchScopeKey(observation.request, observation.discoveryMetricGroups) === expectedScope) return index;
  }
  return null;
}

export function confirmedPositionSearchObservation(state: State): CandidateSearchObservation | null {
  const index = state.confirmedPositionSearchObservationIndex;
  return index === null ? null : state.candidateSearchObservations[index] ?? null;
}

export function constrainedPositionSearchObservation(state: State): CandidateSearchObservation | null {
  const intent = resolvedCandidateSearchIntent(state);
  if (!intent.position) return null;
  const minimumIndex = state.candidateSearchScopeChanged ? state.candidateSearchTurnStartIndex : 0;
  const index = candidateSearchObservationIndexForIntent(intent, state.candidateSearchObservations, minimumIndex);
  return index === null ? null : state.candidateSearchObservations[index] ?? null;
}

export function sampleUnevaluatedCandidates(state: State, limit = 10): string[] {
  const intent = resolvedCandidateSearchIntent(state);
  const groups = state.candidateIdentityGroups.length
    ? state.candidateIdentityGroups
    : Object.values(state.discoveredPlayers).map((player) => ({
      identityKey: `source:${sourcePlayerKey(player)}`,
      status: player.sourceIdentity ? "registry_unavailable" as const : "missing_source_identity" as const,
      registryAvailable: false,
      reepId: null,
      releaseStamp: null,
      recordPlayerIds: [player.playerId],
    }));
  const candidates: string[] = [];
  for (const group of groups) {
    for (const playerId of group.recordPlayerIds) {
      const player = state.discoveredPlayers[playerId];
      if (!player || state.evaluatedPlayers[playerId] || !candidateMatchesSearchIntent(player, intent)) continue;
      candidates.push(playerId);
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}

export function routeCandidateSearch(
  action: CandidateSearchAction,
  state: State,
  enforceCurrentTurnObservation: boolean,
): {
  action: CandidateSearchAction;
  requestedOffset: number;
  effectiveOffset: number;
  exhausted: boolean;
} {
  const key = candidateSearchScopeKey(action, resolvedCandidateSearchIntent(state).discoveryMetricGroups);
  const observations = enforceCurrentTurnObservation && state.candidateSearchScopeChanged
    ? state.candidateSearchObservations.slice(state.candidateSearchTurnStartIndex)
    : state.candidateSearchObservations;
  const previousSearch = observations.slice().reverse().find((observation) => (
    candidateSearchScopeKey(observation.request, observation.discoveryMetricGroups) === key
  ));
  const hasPreviousPage = previousSearch !== undefined;
  const nextOffset = previousSearch?.nextOffset;
  const requestedOffset = action.offset;
  const exhausted = hasPreviousPage && nextOffset === null;
  const effectiveOffset = exhausted ? requestedOffset : hasPreviousPage ? nextOffset! : 0;
  return {
    action: { ...action, offset: effectiveOffset },
    requestedOffset,
    effectiveOffset,
    exhausted,
  };
}

type CandidateConstraintState = Pick<State, "confirmedPosition" | "replacementReferencePosition" | "history"> & Partial<Pick<State, "referenceNameResolution">>;

export function resolvedCandidateSearchIntent(state: CandidateConstraintState, latestMessage?: string): CandidateSearchIntent {
  const messages = userMessages(state.history);
  return resolveCandidateSearchIntent({
    userMessages: latestMessage === undefined ? messages : [...messages, latestMessage],
    confirmedPosition: state.confirmedPosition,
    replacementReferencePosition: state.replacementReferencePosition,
    referenceNames: state.referenceNameResolution?.names,
    ...(latestMessage === undefined ? {} : { latestMessage }),
  });
}

export function hasCandidateSearchScopeChanged(
  history: ConversationHistoryEntry[],
  latestMessage: string,
  confirmedPosition: Position | null,
  replacementReferencePosition: Position | null = null,
): boolean {
  const priorMessages = userMessages(history);
  if (priorMessages.length === 0) return false;
  const priorIntent = resolveCandidateSearchIntent({ userMessages: priorMessages, confirmedPosition, replacementReferencePosition });
  const latestIntent = resolveCandidateSearchIntent({
    userMessages: [...priorMessages, latestMessage],
    confirmedPosition,
    replacementReferencePosition,
    latestMessage,
  });
  return candidateSearchScopeKeyForIntent(priorIntent) !== candidateSearchScopeKeyForIntent(latestIntent);
}

export function discoveredPlayersForConstraint(
  state: CandidateConstraintState & Pick<State, "discoveredPlayers">,
  intent = resolvedCandidateSearchIntent(state),
): PlayerProfile[] {
  return Object.values(state.discoveredPlayers).filter((player) => candidateMatchesSearchIntent(player, intent));
}

export function evaluatedPlayersForConstraint(
  state: CandidateConstraintState & Pick<State, "evaluatedPlayers">,
  intent = resolvedCandidateSearchIntent(state),
): Record<string, EvaluatedPlayer> {
  return Object.fromEntries(Object.entries(state.evaluatedPlayers).filter(([, evaluated]) =>
    candidateMatchesSearchIntent(evaluated.player, intent),
  ));
}

export function userMessages(history: ConversationHistoryEntry[]): string[] {
  return history.filter((entry) => entry.role === "user").map((entry) => entry.content);
}

export function candidateIdentityGroupReferencesFor(state: Pick<State, "candidateIdentityGroups" | "discoveredPlayers">, groupCandidateRecords: (records: readonly PlayerProfile[]) => CandidateIdentityGroup[]): CandidateIdentityGroupReference[] {
  return state.candidateIdentityGroups.length ? state.candidateIdentityGroups : toCandidateIdentityGroupReferences(groupCandidateRecords(Object.values(state.discoveredPlayers)));
}
