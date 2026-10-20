import type { PlayerRepository } from "../../players/repository.js";
import {
  type RecruitmentExpansionConstraints,
} from "../conclusion-policy.js";
import { toolBudgets, type RecruitmentPlannerAction } from "../recruitment-actions.js";
import type { RecruitmentRetrievalMode } from "./retrieval-policy.js";
import { recruitmentRetrievalNeeds } from "./retrieval-policy.js";
import { investigationCandidates } from "./required-investigation.js";
import type { State } from "./state.js";
import type { PlanningMode } from "./planning-snapshot.js";
import { confirmedPositionSearchObservation } from "./candidate-context.js";

export function availablePlannerActions(input: {
  state: State;
  repository: PlayerRepository;
  decisionMode: PlanningMode;
}): RecruitmentPlannerAction[] {
  const { state, repository, decisionMode } = input;
  if (decisionMode === "conclude") return ["ask_user", "finish"];
  if (decisionMode === "expand") return ["search_candidates", "ask_user", "finish"];
  if (decisionMode === "expand_recovery") return ["search_candidates", "finish"];
  if (decisionMode === "reorient") return [
    "search_candidates",
    "ask_user",
    "finish",
  ];

  const actions: RecruitmentPlannerAction[] = [
    ...(repository.inspectTeam || repository.loadPlayers ? ["inspect_team" as const] : []),
    ...(repository.inspectCandidateGroup ? ["inspect_candidate_group" as const] : []),
    ...(repository.inspectPlayer ? ["inspect_player" as const] : []),
    ...(repository.inspectMatch ? ["inspect_match" as const] : []),
    ...(repository.searchCandidates || repository.loadPlayers ? ["search_candidates" as const] : []),
    "search_methodology",
    "evaluate_candidates",
    "search_player_reports",
    "ask_user",
    "finish",
  ];
  return actions.filter((action) => action === "ask_user" || action === "finish" || state.toolUses[action] < toolBudgets[action]);
}

export function chooseDecisionMode(input: {
  state: State;
  retrievalMode: RecruitmentRetrievalMode;
  understatResearchMode?: "catalog_only" | "fixed_profile" | "adaptive";
}): {
  decisionMode: PlanningMode;
  canExpandCandidates: boolean;
  nextOffset: number | null;
  request: State["candidateSearchObservations"][number]["request"] | null;
  expansionConstraints: RecruitmentExpansionConstraints | undefined;
} {
  const { state } = input;
  const retrievalNeeds = recruitmentRetrievalNeeds(state, input.retrievalMode);
  const { unsearchedReportCandidates } = investigationCandidates(state);
  const currentTurnCandidateSearches = state.candidateSearchObservations.slice(state.candidateSearchTurnStartIndex);
  const latestCandidatePage = currentTurnCandidateSearches.at(-1)
    ?? (state.positionBroadeningApproved ? confirmedPositionSearchObservation(state) : null);
  const nextOffset = latestCandidatePage?.nextOffset ?? null;
  const request = latestCandidatePage?.request ?? null;
  const canExpandCandidates = nextOffset !== null
    && request !== null
    && state.toolUses.search_candidates < toolBudgets.search_candidates
    && state.toolUses.evaluate_candidates < toolBudgets.evaluate_candidates
    && input.understatResearchMode === undefined;
  const reportSearchBudgetReached = state.toolUses.search_player_reports >= toolBudgets.search_player_reports;
  const reportsForCurrentCandidatesComplete = state.candidateSearchObservations.length > 0 && (!retrievalNeeds.playerReports
    || (state.hasSearchedPlayerReports && unsearchedReportCandidates.length === 0)
    || reportSearchBudgetReached);
  const decisionMode: PlanningMode = reportsForCurrentCandidatesComplete
    ? canExpandCandidates
      ? state.policyBlocked && state.action?.action === "ask_user" ? "expand_recovery" : "expand"
      : nextOffset === null && state.toolUses.search_candidates < toolBudgets.search_candidates
        ? "reorient"
        : "conclude"
    : "investigate";
  const expansionConstraints = (decisionMode === "expand" || decisionMode === "expand_recovery")
    && nextOffset !== null
    && request
    ? {
      targetTeam: state.targetTeam,
      nextOffset,
      position: state.confirmedPositions.length > 1 ? null : state.confirmedPosition ?? request.position,
      ...(state.confirmedPositions.length > 1 ? { positions: state.confirmedPositions } : {}),
      playerName: request.playerName,
      maxAge: request.maxAge,
      minimumMinutes: request.minimumMinutes,
      competition: request.competition,
      season: request.season,
    }
    : undefined;
  return { decisionMode, canExpandCandidates, nextOffset, request, expansionConstraints };
}
