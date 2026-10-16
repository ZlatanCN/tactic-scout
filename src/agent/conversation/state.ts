import { Annotation } from "@langchain/langgraph";
import { z } from "zod/v4";
import { type PlayerSearchFilter, type PlayerSearchPage } from "../../data/player-repository.js";
import { createEmptyExternalSignalCoverage, RecruitmentSearchScopeSchema, type DatasetScope, type ExternalSignalCoverage, type HistoricalArchiveCoverage, type HistoricalArchiveSample, type PlayerEloSignal, type PlayerProfile, type Position, type RecruitmentReport, type UnderstatMatchResearch, type UnderstatPlayerResearch, type UnderstatTeamResearch } from "../../domain/schemas.js";
import { type CandidateIdentityGroupReference } from "../../identity/candidate-groups.js";
import { type KnowledgeSearchResult } from "../../knowledge/schemas.js";
import { type ConversationHistoryEntry } from "../planner-context.js";
import { emptyToolUseCounts, type ParsedRecruitmentAction, type ToolUseCounts } from "../recruitment-actions.js";
import { type EvaluatedCandidate } from "../recruitment-evidence-evaluator.js";
import { type ReferencePlayerProfile } from "../recruitment-comparison.js";
import { type PendingQuestion } from "./contracts.js";

export type EvaluatedPlayer = EvaluatedCandidate;

const replaceable = <T>(defaultValue: () => T) => Annotation<T>({
  reducer: (_previous, update) => update,
  default: defaultValue,
});

export type CandidateSearchAction = Extract<ParsedRecruitmentAction, { action: "search_candidates" }>;

export interface CandidateSearchObservation {
  discoveryStrategy?: NonNullable<PlayerSearchPage["discovery"]>["strategy"];
  discoveryMetricGroups?: import("../../domain/schemas.js").CapabilityMetricKey[][];
  request: CandidateSearchAction;
  appliedFilters: PlayerSearchFilter[];
  actualOffset: number;
  nextOffset: number | null;
  matchingRecordCount: number | null;
  discoveredSourceRecordIds: string[];
  reportScope: z.infer<typeof RecruitmentSearchScopeSchema>;
}

export const RecruitmentState = Annotation.Root({
  userMessage: Annotation<string>(),
  history: Annotation<ConversationHistoryEntry[]>({
    reducer: (previous, update) => previous.concat(update),
    default: () => [],
  }),
  action: replaceable<ParsedRecruitmentAction | undefined>(() => undefined),
  discoveredPlayers: Annotation<Record<string, PlayerProfile>>({
    reducer: (previous, update) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  candidateIdentityGroups: replaceable<CandidateIdentityGroupReference[]>(() => []),
  observedRecords: Annotation<Record<string, { competition: string; season: string }>>({
    reducer: (previous, update) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  evaluatedPlayers: Annotation<Record<string, EvaluatedPlayer>>({
    reducer: (previous, update) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  evidenceEvaluationWithheld: replaceable<boolean>(() => false),
  externalSignals: replaceable<Record<string, PlayerEloSignal>>(() => ({})),
  externalSignalCoverage: replaceable<ExternalSignalCoverage>(() => createEmptyExternalSignalCoverage()),
  historicalArchiveSamplesByPlayerId: replaceable<Record<string, HistoricalArchiveSample[]>>(() => ({})),
  historicalArchiveCoverage: replaceable<HistoricalArchiveCoverage>(() => ({
    status: "not_run",
    disabledReason: null,
    checkedCandidates: 0,
    mappedCandidates: 0,
    matchedCandidates: 0,
    failedCandidates: 0,
  })),
  targetTeam: replaceable<string | null>(() => null),
  referenceProfiles: replaceable<ReferencePlayerProfile[]>(() => []),
  understatPlayerResearch: replaceable<Record<string, UnderstatPlayerResearch>>(() => ({})),
  understatTeamResearch: replaceable<UnderstatTeamResearch | null>(() => null),
  understatMatchResearch: replaceable<Record<string, UnderstatMatchResearch>>(() => ({})),
  referenceNameResolution: replaceable<import("../../data/player-name-resolver.js").ResolvedPlayerName | null>(() => null),
  inspectedReferenceMention: replaceable<string | null>(() => null),
  replacementReferencePosition: replaceable<Position | null>(() => null),
  confirmedPosition: replaceable<Position | null>(() => null),
  confirmedPositionSearchObservationIndex: replaceable<number | null>(() => null),
  candidateSearchScopeChanged: replaceable<boolean>(() => false),
  confirmedPositionNoMatchQuestionAsked: replaceable<boolean>(() => false),
  confirmedPositionNoMatchDeclined: replaceable<boolean>(() => false),
  positionBroadeningApproved: replaceable<boolean>(() => false),
  roleClarificationAsked: replaceable<boolean>(() => false),
  replacementPositionClarificationAsked: replaceable<boolean>(() => false),
  pendingQuestion: replaceable<PendingQuestion | null>(() => null),
  report: replaceable<RecruitmentReport | null>(() => null),
  datasetScope: replaceable<DatasetScope | undefined>(() => undefined),
  responseMessage: replaceable<string>(() => ""),
  decisionSteps: replaceable<number>(() => 0),
  toolUses: replaceable<ToolUseCounts>(emptyToolUseCounts),
  reviewAttempts: replaceable<number>(() => 0),
  reviewResult: replaceable<"valid" | "retry" | "exhausted" | "bypassed">(() => "valid"),
  forcedLimitReached: replaceable<boolean>(() => false),
  hasInvestigated: replaceable<boolean>(() => false),
  hasSearchedMethodology: replaceable<boolean>(() => false),
  hasSearchedPlayerReports: replaceable<boolean>(() => false),
  methodologySearchFailed: replaceable<boolean>(() => false),
  successfulMethodologyQueries: replaceable<Record<string, number>>(() => ({})),
  playerReportSearchFailed: replaceable<boolean>(() => false),
  sourceAccessFailure: replaceable<{ code: "blocked" | "rate_limit"; message: string } | null>(() => null),
  candidateSearchFailure: replaceable<{ code: string | null; message: string } | null>(() => null),
  candidateSearchSucceededThisTurn: replaceable<boolean>(() => false),
  candidateSearchTurnStartIndex: replaceable<number>(() => 0),
  policyBlocked: replaceable<boolean>(() => false),
  policyBlockedRepeatCount: replaceable<number>(() => 0),
  policyLoopStopped: replaceable<boolean>(() => false),
  searchedReportPlayerNames: Annotation<string[]>({
    reducer: (previous, update) => [...new Set([...previous, ...update])],
    default: () => [],
  }),
  retrievedKnowledge: replaceable<Record<string, KnowledgeSearchResult>>(() => ({})),
  candidateSearchObservations: Annotation<CandidateSearchObservation[]>({
    reducer: (previous, update) => previous.concat(update),
    default: () => [],
  }),
  candidateSearchCursorAdjustment: replaceable<{ requestedOffset: number; effectiveOffset: number } | null>(() => null),
});

export type State = typeof RecruitmentState.State;

export const maxDecisionsPerTurn = 16;
