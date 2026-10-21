import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { PlayerRepository } from "../../players/repository.js";
import type { PlayerProfile } from "../../domain/players.js";
import type { CandidateIdentityGroup } from "../../players/identity/candidate-groups.js";
import {
  type RecruitmentExpansionConstraints,
  type RecruitmentDecisionConstraints,
} from "../conclusion-policy.js";
import {
  buildConclusionCandidateEvidence,
  compactConclusionHistory,
  compactExpansionHistory,
  type ConversationHistoryEntry,
} from "../planner-context.js";
import { projectRecruitmentHistory } from "../context.js";
import type {
  RecruitmentPlanner,
  RecruitmentPlannerUsageObservation,
} from "../recruitment-planner.js";
import { investigationCandidates } from "./required-investigation.js";
import type { EvaluatedPlayer, State } from "./state.js";
import type { DecisionSnapshot } from "./planning-snapshot.js";
import type { RecruitmentTraceObserver } from "./contracts.js";
import { emitProgress } from "./progress.js";

type PlannerInput = Parameters<RecruitmentPlanner["decide"]>[0];

/**
 * A transient, model-facing projection of one authoritative DecisionSnapshot.
 *
 * `plannerInput.decisionSnapshot` carries the hard facts. The extra fields here
 * are bounded navigation and evidence views used by context preflight and
 * conclusion batching; they are never written back to the graph checkpoint.
 */
export interface RecruitmentDecisionContext {
  plannerInput: PlannerInput;
  decisionConstraints: RecruitmentDecisionConstraints | undefined;
  expansionConstraints: RecruitmentExpansionConstraints | undefined;
  eligibleEvaluatedPlayers: Record<string, EvaluatedPlayer>;
}

export function buildRecruitmentDecisionContext(input: {
  state: State;
  snapshot: DecisionSnapshot;
  config: LangGraphRunnableConfig;
  repository: PlayerRepository;
  observer?: RecruitmentTraceObserver;
  groupCandidateRecords: (records: readonly PlayerProfile[]) => CandidateIdentityGroup[];
  previousShortlistContextEnabled?: boolean;
}): RecruitmentDecisionContext {
  const {
    state,
    snapshot,
    config,
    repository,
    observer,
    groupCandidateRecords,
  } = input;
  const { eligibleEvaluatedPlayers } = investigationCandidates(state);
  const decisionMode = snapshot.caps.stage;
  const decisionConstraints = snapshot.constraints ?? undefined;
  const expansionConstraints = snapshot.search.expansionConstraints ?? undefined;
  const protectedQuotes = [
    snapshot.case.brief?.targetTeam?.quote,
    snapshot.case.brief?.referencePlayer?.quote,
    ...(snapshot.case.brief?.referenceClues?.map(clue => clue.quote) ?? []),
    ...(snapshot.case.brief?.criteria.map(criterion => criterion.quote) ?? []),
  ].filter((quote): quote is string => Boolean(quote));
  const caseId = typeof config.configurable?.thread_id === "string" ? config.configurable.thread_id : "";
  const plannerHistory = (decisionMode === "expand" || decisionMode === "expand_recovery"
    ? compactExpansionHistory(snapshot.history, { includeLatestPolicyFeedback: decisionMode === "expand_recovery" })
    : decisionMode === "conclude" || decisionMode === "reorient"
      ? compactConclusionHistory(snapshot.history, decisionConstraints?.requestedCapabilityCoverage, {
        preserveAllMethodology: decisionMode === "reorient",
      })
      : snapshot.history).map(entry => ({ ...entry }));
  if (input.previousShortlistContextEnabled !== false && state.briefCandidates.length > 0) {
    const latestUserIndex = plannerHistory.reduce((latest, entry, index) => entry.role === "user" ? index : latest, -1);
    plannerHistory.splice(latestUserIndex < 0 ? plannerHistory.length : latestUserIndex, 0, {
      role: "tool",
      toolName: "previous_shortlist",
      content: JSON.stringify({
        candidates: state.briefCandidates,
        note: "这是上一轮实际展示给用户的短名单，仅用于解析‘这些候选’等指代和保持可见顺序。若用户明确要求在现有考察范围内继续比较，应优先复用仍符合当前条件且有真实评估证据的候选；若候选因当前硬条件或缺少所需证据而不能延续，必须说明具体原因。此快照本身不代表本轮推荐，不得据此补造指标或资格。",
      }),
    });
  }
  const conclusionMode = decisionMode === "conclude" || decisionMode === "reorient";
  const replacedToolResults = conclusionMode
    ? new Set(["search_candidates", "evaluate_candidates"])
    : new Set<string>();
  const historyForProjection = plannerHistory.filter(entry => entry.role !== "tool" || !replacedToolResults.has(entry.toolName ?? ""));
  const replacedHistoryEntries = plannerHistory.length - historyForProjection.length;
  const projectedHistory = projectRecruitmentHistory(historyForProjection, {
    caseId,
    recentUserTurns: 3,
    protectedQuotes,
  });
  const omittedHistoryEventIds = projectedHistory.manifest.omittedEventIds;
  const currentTurnObservations = state.candidateSearchObservations.slice(state.candidateSearchTurnStartIndex);
  const conclusionCandidateEvidence = conclusionMode && decisionConstraints
    ? buildConclusionCandidateEvidence(
      Object.values(eligibleEvaluatedPlayers),
      decisionConstraints.requestedCapabilityCoverage.flatMap(area => area.requestedMetricKeys),
    )
    : undefined;
  const candidateEvidenceForBatching = decisionMode === "conclude" ? conclusionCandidateEvidence : undefined;
  const caseProgress = {
    toolUses: snapshot.budget,
    currentTurnCandidatePages: currentTurnObservations.map(observation => ({
      offset: observation.actualOffset,
      nextOffset: observation.nextOffset,
      position: observation.request.position,
      positions: observation.request.positions ?? [],
      matchingRecordCount: observation.matchingRecordCount,
      discoveredRecordCount: observation.discoveredSourceRecordIds.length,
    })),
    evaluatedCandidateCount: snapshot.candidates.eligiblePlayerIds.length,
    discoveredCandidateCount: Object.keys(state.discoveredPlayers).length,
    hasSearchedMethodology: state.hasSearchedMethodology,
    hasSearchedPlayerReports: state.hasSearchedPlayerReports,
    searchedReportPlayerCount: state.searchedReportPlayerNames.length,
    omittedHistoryEntries: projectedHistory.manifest.omittedEntryCount + replacedHistoryEntries,
    protectedQuoteCount: projectedHistory.manifest.protectedQuoteCount,
    omittedHistoryEventIds,
    protectedQuoteReferences: projectedHistory.manifest.protectedQuoteReferences,
    ...(conclusionMode && decisionConstraints ? {
      candidateEvidence: conclusionCandidateEvidence,
    } : {}),
  };
  const modelFacingSnapshot = structuredClone(snapshot);
  modelFacingSnapshot.history = projectedHistory.entries.map(entry => ({ ...entry }));
  const plannerInput: PlannerInput = {
    decisionSnapshot: modelFacingSnapshot,
    history: modelFacingSnapshot.history,
    dataMode: repository.mode,
    dataSource: repository.sourceName,
    ...(config.signal ? { signal: config.signal } : {}),
    ...(candidateEvidenceForBatching ? { candidateEvidenceForBatching } : {}),
    caseProgress,
    omittedHistoryEventIds,
    contextRevision: JSON.stringify([
      caseId,
      snapshot.history.length,
      snapshot.case.brief,
      state.datasetScope ?? null,
      snapshot.candidates.eligiblePlayerIds,
      Object.keys(state.retrievedKnowledge).sort(),
    ]),
    ...(observer ? {
      onTokenUsage: (usage: RecruitmentPlannerUsageObservation) => observer({
        phase: "model_usage",
        ...usage,
      }),
    } : {}),
    onContextCompaction: status => emitProgress(config, {
      stage: "context_compaction",
      status,
      message: status === "started" ? "正在整理较早的对话内容，保留本轮需求与案件证据" : "对话整理完成，继续本轮调查",
      completedSteps: 0,
    }),
  };
  return {
    plannerInput,
    decisionConstraints,
    expansionConstraints,
    eligibleEvaluatedPlayers,
  };
}
