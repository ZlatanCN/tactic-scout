import { isReplacementTarget } from "./replacement-target.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import type { PlayerProfile, Position } from "../domain/schemas.js";
import type { KnowledgeSearchResult } from "../knowledge/schemas.js";
import { candidateMatchesSearchIntent, resolveCandidateSearchIntent, type CandidateSearchIntent } from "./candidate-search-intent.js";
import type { ConversationHistoryEntry } from "./planner-context.js";
import {
  FinishActionSchema,
  RecruitmentActionSchema,
  type ParsedRecruitmentAction,
} from "./recruitment-actions.js";
import type { EvaluatedCandidate } from "./recruitment-evidence-evaluator.js";

export interface RecruitmentCandidatePolicyState {
  referenceNameResolution?: import("../data/player-name-resolver.js").ResolvedPlayerName | null;
  targetTeam: string | null;
  confirmedPosition: Position | null;
  history: ConversationHistoryEntry[];
  discoveredPlayers: Record<string, PlayerProfile>;
  evaluatedPlayers: Record<string, EvaluatedCandidate>;
  retrievedKnowledge: Record<string, KnowledgeSearchResult>;
}

function userMessages(history: ConversationHistoryEntry[]): string[] {
  return history.filter((entry) => entry.role === "user").map((entry) => entry.content);
}

function currentIntent(state: RecruitmentCandidatePolicyState): CandidateSearchIntent {
  return resolveCandidateSearchIntent({
    userMessages: userMessages(state.history),
    confirmedPosition: state.confirmedPosition,
    referenceNames: state.referenceNameResolution?.names,
  });
}

function discoveredPlayersForConstraint(state: RecruitmentCandidatePolicyState, intent: CandidateSearchIntent): PlayerProfile[] {
  return Object.values(state.discoveredPlayers).filter((player) => candidateMatchesSearchIntent(player, intent));
}

function evaluatedPlayersForConstraint(
  state: RecruitmentCandidatePolicyState,
  intent: CandidateSearchIntent,
): Record<string, EvaluatedCandidate> {
  return Object.fromEntries(Object.entries(state.evaluatedPlayers).filter(([, evaluated]) => (
    candidateMatchesSearchIntent(evaluated.player, intent)
  )));
}

function preserveTargetTeam(action: ParsedRecruitmentAction, state: RecruitmentCandidatePolicyState): ParsedRecruitmentAction {
  const targetTeam = state.targetTeam
    ?? action.targetTeam
    ?? (action.action === "inspect_team" ? action.teamName : null);
  if (action.action === "finish") return FinishActionSchema.parse({ ...action, targetTeam });
  return RecruitmentActionSchema.parse({ ...action, targetTeam });
}

function constrainCandidateSearchToUserIntent(
  action: ParsedRecruitmentAction,
  state: RecruitmentCandidatePolicyState,
  intent: CandidateSearchIntent,
): ParsedRecruitmentAction {
  if (action.action !== "search_candidates") return action;
  const normalizedPlayerName = action.playerName ? normalizeSearchText(action.playerName) : null;
  const playerNameWasObservedInReport = Boolean(normalizedPlayerName && Object.values(state.retrievedKnowledge).some(
    (result) => result.corpus === "player_report"
      && result.entityNames.some((name) => normalizeSearchText(name) === normalizedPlayerName),
  ));
  const playerNameIsAlreadyDiscovered = Boolean(normalizedPlayerName && Object.values(state.discoveredPlayers).some(
    (player) => normalizeSearchText(player.name) === normalizedPlayerName,
  ));
  const playerNameIsReference = Boolean(action.playerName
    && isReplacementTarget(action.playerName, intent.replacementTargetNames));
  return RecruitmentActionSchema.parse({
    ...action,
    ...(intent.position ? { position: intent.position } : {}),
    playerName: playerNameWasObservedInReport && !playerNameIsAlreadyDiscovered && !playerNameIsReference
      ? action.playerName
      : null,
    maxAge: intent.maxAge,
    minimumMinutes: intent.minimumMinutes,
    competition: intent.competition,
    season: intent.season,
    limit: 20,
  });
}

function enforceUserConstraints(
  action: ParsedRecruitmentAction,
  state: RecruitmentCandidatePolicyState,
  intent: CandidateSearchIntent,
): ParsedRecruitmentAction {
  if (action.action === "search_candidates") {
    return RecruitmentActionSchema.parse({
      ...action,
      ...(intent.position ? { position: intent.position } : {}),
      maxAge: intent.maxAge,
    });
  }
  if (action.action === "evaluate_candidates") {
    const availablePlayerIds = new Set(discoveredPlayersForConstraint(state, intent).map(({ playerId }) => playerId));
    const eligiblePlayerIds = [...new Set(action.playerIds.filter((playerId) => availablePlayerIds.has(playerId)))];
    const pendingPlayerIds = eligiblePlayerIds.filter((playerId) => !state.evaluatedPlayers[playerId]);
    if (pendingPlayerIds.length > 0) {
      return RecruitmentActionSchema.parse({ ...action, playerIds: pendingPlayerIds });
    }
    if (eligiblePlayerIds.length > 0) {
      // Preserve only discovered IDs so the graph can turn a duplicate evaluation
      // request into the next evidence step without querying arbitrary IDs.
      return RecruitmentActionSchema.parse({ ...action, playerIds: eligiblePlayerIds });
    }
    return RecruitmentActionSchema.parse({
      action: "search_candidates",
      targetTeam: state.targetTeam,
      position: intent.position,
      playerName: null,
      maxAge: intent.maxAge,
      minimumMinutes: intent.minimumMinutes,
      competition: intent.competition,
      season: intent.season,
      offset: 0,
      limit: 20,
    });
  }
  if (action.action === "finish") {
    const eligiblePlayerIds = new Set(Object.values(evaluatedPlayersForConstraint(state, intent))
      .map(({ player }) => player.playerId));
    return FinishActionSchema.parse({
      ...action,
      recommendations: action.recommendations.filter(({ playerId }) => eligiblePlayerIds.has(playerId)),
      reportObservations: action.reportObservations.filter(({ playerId }) => eligiblePlayerIds.has(playerId)),
    });
  }
  return action;
}

/**
 * Applies the user's current hard constraints and evidence eligibility to a
 * Planner proposal. Call once before graph policy gates or tool routing.
 */
export function applyRecruitmentCandidatePolicy(
  proposedAction: ParsedRecruitmentAction,
  state: RecruitmentCandidatePolicyState,
): ParsedRecruitmentAction {
  const intent = currentIntent(state);
  const reportGroundedAction = constrainCandidateSearchToUserIntent(proposedAction, state, intent);
  const teamScopedAction = preserveTargetTeam(reportGroundedAction, state);
  return enforceUserConstraints(teamScopedAction, state, intent);
}
