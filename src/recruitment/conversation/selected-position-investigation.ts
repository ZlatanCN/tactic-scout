import type { PlayerRepository } from "../../players/repository.js";
import { canProvideDetailedPositionEvidence } from "../../players/position-evidence.js";
import { hasAbilityPositionEvidence, playerPositionMatches } from "../../domain/positions.js";
import { positionSelectionLabel } from "../../domain/position-selection.js";
import { RecruitmentActionSchema, toolBudgets } from "../recruitment-actions.js";
import { candidateMatchesSearchIntentForPositionRetrieval } from "../candidate-search-intent.js";
import { candidateSearchObservationIndexForIntent, resolvedCandidateSearchIntent } from "./candidate-context.js";
import type { State } from "./state.js";

/** Shared union search and one position-detail read per player, under existing turn budgets. */
export function nextSelectedPositionInvestigation(state: State, source: PlayerRepository) {
  if (state.confirmedPositions.length < 2) return null;
  const positions = state.confirmedPositions;
  const intent = resolvedCandidateSearchIntent(state);
  const index = candidateSearchObservationIndexForIntent(intent, state.candidateSearchObservations,
    state.candidateSearchScopeChanged ? state.candidateSearchTurnStartIndex : 0);
  const observation = index === null ? null : state.candidateSearchObservations[index];
  if (!observation && state.toolUses.search_candidates < toolBudgets.search_candidates && !state.candidateSearchFailure) {
    return {
      action: RecruitmentActionSchema.parse({ action: "search_candidates", targetTeam: state.targetTeam,
        position: null, positions, playerName: null, maxAge: intent.maxAge, minimumMinutes: intent.minimumMinutes,
        competition: intent.competition, season: intent.season, offset: 0, limit: 12 }),
      message: `正在共同调查${positionSelectionLabel(positions)}，保留其他筛选条件`,
    };
  }
  const players = Object.values(state.discoveredPlayers).filter((player) => candidateMatchesSearchIntentForPositionRetrieval(player, intent));
  const pending = players.filter((player) => player.sourceIdentity?.provider === "understat"
    && positions.some((position) => !hasAbilityPositionEvidence(player, position)
      && (!player.positionEvidenceByPosition?.[position] || player.positionEvidenceByPosition[position]?.status === "pending")));
  if (pending.length) {
    if (source.inspectCandidateGroup && state.toolUses.inspect_candidate_group < toolBudgets.inspect_candidate_group) {
      return {
        action: RecruitmentActionSchema.parse({ action: "inspect_candidate_group", targetTeam: state.targetTeam,
          playerIds: pending.slice(0, 12).map(({ playerId }) => playerId), sections: ["positions"] }),
        message: `正在核实 ${Math.min(pending.length, 12)} 名球员在所选位置的出场记录`,
      };
    }
    if (source.inspectPlayer && state.toolUses.inspect_player < toolBudgets.inspect_player) {
      return {
        action: RecruitmentActionSchema.parse({ action: "inspect_player", targetTeam: state.targetTeam,
          playerId: pending[0]!.playerId, sections: ["positions"] }),
        message: "正在核实候选球员的多个目标位置，分别保留证据",
      };
    }
  }
  const confirmed = players.filter((player) => positions.some((position) => playerPositionMatches(player, position))).length;
  const canResolvePosition = source.mode === "understat" || positions.some((position) => canProvideDetailedPositionEvidence(source.mode, position));
  if (observation?.nextOffset !== null && observation?.nextOffset !== undefined && confirmed < 5
    && canResolvePosition && state.toolUses.search_candidates < toolBudgets.search_candidates) {
    return {
      action: RecruitmentActionSchema.parse({ ...observation.request, offset: observation.nextOffset }),
      message: `已找到 ${confirmed} 名位置有依据的球员，继续读取下一页`,
    };
  }
  return null;
}
