import type { PlayerRepository } from "../../players/repository.js";
import type { PlayerProfile } from "../../domain/players.js";
import type { CandidateIdentityGroup } from "../../players/identity/candidate-groups.js";
import {
  type RecruitmentExpansionConstraints,
  buildDecisionConstraints,
  type RecruitmentDecisionConstraints,
} from "../conclusion-policy.js";
import { type ToolUseCounts } from "../recruitment-actions.js";
import type { RecruitmentBrief } from "../brief.js";
import type { Position, SelectablePosition } from "../../domain/position-contracts.js";
import type { CandidateIdentityGroupReference } from "../../players/identity/candidate-groups.js";
import type { PendingQuestion } from "./contracts.js";
import type { State } from "./state.js";
import { candidateIdentityGroupReferencesFor, confirmedPositionSearchObservation, userMessages } from "./candidate-context.js";
import type { RecruitmentPlannerAction } from "../recruitment-actions.js";
import type { RecruitmentPreference } from "../preferences/schemas.js";

export type PlanningMode = "investigate" | "expand" | "expand_recovery" | "reorient" | "conclude";

/**
 * The sole deterministic planning view. It contains facts already held by the
 * case graph plus the exact current cursor and the repository's capabilities.
 * It is intentionally derived for one decision step and is never written back
 * as a second source of truth.
 */
export type DecisionSnapshot = {
  version: 1;
  userPreferences: Array<{
    key: RecruitmentPreference["key"];
    value: string;
    guidance: string;
    source: "explicit_user_confirmation";
  }>;
  case: {
    latestUserRequest: string;
    targetTeam: string | null;
    brief: RecruitmentBrief | null;
    abilityProfilesEnabled: boolean;
    confirmedPosition: Position | null;
    confirmedPositions: SelectablePosition[];
    positionBroadeningApproved: boolean;
    pendingQuestion: PendingQuestion | null;
  };
  history: Array<{ role: "user" | "assistant" | "tool"; toolName?: string; content: string; eventId?: string }>;
  caps: {
    stage: PlanningMode;
    availableActions: readonly RecruitmentPlannerAction[];
  };
  candidates: {
    eligiblePlayerIds: string[];
    evaluatedPlayerIds: string[];
    identityGroups: CandidateIdentityGroupReference[];
  };
  search: {
    nextOffset: number | null;
    request: Extract<NonNullable<State["action"]>, { action: "search_candidates" }> | null;
    expansionConstraints: RecruitmentExpansionConstraints | null;
  };
  budget: ToolUseCounts;
  constraints: RecruitmentDecisionConstraints | null;
};

export function buildPlanningSnapshot(input: {
  state: State;
  repository: PlayerRepository;
  decisionMode: PlanningMode;
  availableActions: readonly RecruitmentPlannerAction[];
  eligibleEvaluatedPlayers: Readonly<Record<string, unknown>>;
  groupCandidateRecords: (records: readonly PlayerProfile[]) => CandidateIdentityGroup[];
  expansionConstraints?: RecruitmentExpansionConstraints;
  userPreferences?: RecruitmentPreference[];
}): DecisionSnapshot {
  const { state, decisionMode } = input;
  const eligiblePlayerIds = new Set(Object.keys(input.eligibleEvaluatedPlayers));
  const latestCandidatePage = state.candidateSearchObservations.slice(state.candidateSearchTurnStartIndex).at(-1)
    ?? (state.positionBroadeningApproved ? confirmedPositionSearchObservation(state) : null);
  const nextOffset = latestCandidatePage?.nextOffset ?? null;
  const request = latestCandidatePage?.request ?? null;
  const constraints = decisionMode === "investigate"
    ? null
    : buildDecisionConstraints({
      targetTeam: state.targetTeam,
      brief: state.brief,
      confirmedPosition: state.confirmedPosition,
      confirmedPositions: state.confirmedPositions,
      userMessages: userMessages(state.history),
      evaluatedPlayers: Object.values(input.eligibleEvaluatedPlayers) as Parameters<typeof buildDecisionConstraints>[0]["evaluatedPlayers"],
      retrievedKnowledge: Object.values(state.retrievedKnowledge),
      candidateIdentityGroups: candidateIdentityGroupReferencesFor(state, input.groupCandidateRecords),
    });
  const currentRequest = state.userMessage.toLocaleLowerCase();
  const explicitCompetition = Boolean(state.brief?.filters.competition)
    || /premier\s+league|la\s+liga|bundesliga|serie\s+a|ligue\s+1|英超|西甲|德甲|意甲|法甲/.test(currentRequest);
  const explicitAnalysisFocus = /防守|推进|创造机会|对抗|defensive actions|progression|chance creation|duels/i.test(currentRequest);
  const userPreferences = (input.userPreferences ?? []).flatMap((preference) => {
    if (preference.key === "preferred_competition" && explicitCompetition) return [];
    if (preference.key === "analysis_focus" && explicitAnalysisFocus) return [];
    return [{
      key: preference.key,
      value: preference.value,
      guidance: preference.appliesWhen,
      source: preference.source,
    }];
  });
  return structuredClone({
    version: 1,
    userPreferences,
    case: {
      latestUserRequest: state.userMessage,
      targetTeam: state.targetTeam,
      brief: state.brief,
      abilityProfilesEnabled: state.abilityProfilesEnabled,
      confirmedPosition: state.confirmedPosition,
      confirmedPositions: state.confirmedPositions,
      positionBroadeningApproved: state.positionBroadeningApproved,
      pendingQuestion: state.pendingQuestion,
    },
    history: state.history.map(entry => ({ ...entry })),
    caps: {
      stage: decisionMode,
      availableActions: input.availableActions,
    },
    candidates: {
      eligiblePlayerIds: Object.keys(state.discoveredPlayers)
        .filter(playerId => eligiblePlayerIds.has(playerId))
        .sort((left, right) => left.localeCompare(right, "en", { numeric: true })),
      evaluatedPlayerIds: Object.keys(state.evaluatedPlayers)
        .sort((left, right) => left.localeCompare(right, "en", { numeric: true })),
      identityGroups: candidateIdentityGroupReferencesFor(state, input.groupCandidateRecords),
    },
    search: {
      nextOffset,
      request,
      expansionConstraints: input.expansionConstraints ?? null,
    },
    budget: state.toolUses,
    constraints,
  });
}
