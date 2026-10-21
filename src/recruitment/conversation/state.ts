import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod/v4";
import { type PlayerSearchFilter, type PlayerSearchPage } from "../../players/repository.js";
import { type DatasetScope } from "../../domain/datasets.js";
import { createEmptyExternalSignalCoverage, type ExternalSignalCoverage, type HistoricalArchiveCoverage, type HistoricalArchiveSample, type PlayerEloSignal } from "../../domain/external-evidence.js";
import { type PlayerProfile } from "../../domain/players.js";
import { type Position, type SelectablePosition } from "../../domain/position-contracts.js";
import { type CapabilityMetricKey } from "../../domain/capabilities.js";
import { RecruitmentSearchScopeSchema, type RecruitmentReport } from "../../domain/reports.js";
import { type UnderstatMatchResearch, type UnderstatPlayerResearch, type UnderstatTeamResearch } from "../../domain/understat-evidence.js";
import { type CandidateIdentityGroupReference } from "../../players/identity/candidate-groups.js";
import { type KnowledgeSearchResult } from "../../knowledge/schemas.js";
import { type ConversationHistoryEntry } from "../planner-context.js";
import { emptyToolUseCounts, type ParsedRecruitmentAction, type ToolUseCounts } from "../recruitment-actions.js";
import { type EvaluatedCandidate } from "../recruitment-evidence-evaluator.js";
import { type ReferencePlayerProfile } from "../recruitment-comparison.js";
import { type PendingQuestion } from "./contracts.js";
import type { ReportFollowupContext } from "./report-followup-context.js";

export type EvaluatedPlayer = EvaluatedCandidate;

const replaceable = <T>(defaultValue: () => T) => Annotation<T>({
  reducer: (_previous, update) => update,
  default: defaultValue,
});

export type CandidateSearchAction = Extract<ParsedRecruitmentAction, { action: "search_candidates" }>;

export interface CandidateSearchObservation {
  discoveryStrategy?: NonNullable<PlayerSearchPage["discovery"]>["strategy"];
  discoveryMetricGroups?: CapabilityMetricKey[][];
  request: CandidateSearchAction;
  appliedFilters: PlayerSearchFilter[];
  actualOffset: number;
  nextOffset: number | null;
  matchingRecordCount: number | null;
  fmCriterionCoverage?: NonNullable<PlayerSearchPage["fmCriterionCoverage"]>;
  agePreferenceCoverage?: NonNullable<PlayerSearchPage["agePreferenceCoverage"]>;
  discoveredSourceRecordIds: string[];
  reportScope: z.infer<typeof RecruitmentSearchScopeSchema>;
}

export const RecruitmentState = Annotation.Root({
  // ToolNode/toolsCondition consume one transient planner call at a time. Domain
  // history remains in the typed `history` channel below.
  messages: replaceable<BaseMessage[]>(() => []),
  brief: replaceable<import("../brief.js").RecruitmentBrief | null>(() => null),
  briefFailure: replaceable<string | null>(() => null),
  briefFailureKind: replaceable<string | null>(() => null),
  briefInterpretedThrough: replaceable<number>(() => 0),
  briefAnswerKind: replaceable<"positions" | "identity" | "identity_reject" | null>(() => null),
  briefQuestionContext: replaceable<string | null>(() => null),
  briefCandidates: replaceable<import("../brief.js").VisibleRecruitmentCandidate[]>(() => []),
  unsupportedConstraintQuestionKey: replaceable<string | null>(() => null),
  referenceComparisonEnabled: replaceable<boolean>(() => true),
  abilityProfilesEnabled: replaceable<boolean>(() => false),
  userMessage: Annotation<string>(),
  incomingPositions: replaceable<SelectablePosition[] | null>(() => null),
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
  referenceNameResolution: replaceable<import("../../players/identity/name-resolver.js").PlayerNameResolution | null>(() => null),
  rejectedReferenceIds: replaceable<string[]>(() => []),
  rejectedReferenceRecordIds: replaceable<string[]>(() => []),
  referenceCandidatesBeforeAnswer: replaceable<import("../../domain/player-identity.js").PlayerIdentityCandidate[]>(() => []),
  referenceResolutionQuery: replaceable<string | null>(() => null),
  inspectedReferenceMention: replaceable<string | null>(() => null),
  replacementReferencePosition: replaceable<Position | null>(() => null),
  confirmedPosition: replaceable<Position | null>(() => null),
  confirmedPositions: replaceable<SelectablePosition[]>(() => []),
  confirmedPositionSearchObservationIndex: replaceable<number | null>(() => null),
  candidateSearchScopeChanged: replaceable<boolean>(() => false),
  confirmedPositionNoMatchQuestionAsked: replaceable<boolean>(() => false),
  confirmedPositionNoMatchDeclined: replaceable<boolean>(() => false),
  positionBroadeningApproved: replaceable<boolean>(() => false),
  roleClarificationAsked: replaceable<boolean>(() => false),
  replacementPositionClarificationAsked: replaceable<boolean>(() => false),
  pendingQuestion: replaceable<PendingQuestion | null>(() => null),
  report: replaceable<RecruitmentReport | null>(() => null),
  reportFollowupContext: replaceable<ReportFollowupContext | null>(() => null),
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
  runtimeFailure: replaceable<import("./node-policies.js").RecruitmentRuntimeFailure | null>(() => null),
});

export type State = typeof RecruitmentState.State;

export const maxDecisionsPerTurn = 16;
