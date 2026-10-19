import { createUnderstandingNode } from "./conversation/understanding-node.js";
import { createContextCompactionNode, type ContextManagementMode } from "./conversation/context-compaction-node.js";
import { createRecruitmentBriefInterpreter } from "./brief-interpreter.js";
import type { RecruitmentBriefInterpreter } from "./brief.js";
import type { RecruitmentRetrievalMode } from "./conversation/retrieval-policy.js";
import { createConfiguredPlayerNameResolver, type PlayerNameResolver } from "../players/identity/name-resolver.js";
import { createPlayerNameVariantGenerator } from "./player-name-variants.js";
import type { TeamRosterEnrichmentProvider } from "../sources/thesportsdb/roster.js";
import { type BaseCheckpointSaver, Command, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { createConfiguredHistoricalArchive } from "../sources/reep/historical-archive-enrichment.js";
import { type PlayerRepository } from "../players/repository.js";
import { createConfiguredPlayerEloReportClient } from "../sources/playerelo/client.js";
import { type ExternalSignalCoverage, createEmptyExternalSignalCoverage } from "../domain/external-evidence.js";
import { type PlayerProfile } from "../domain/players.js";
import { type CandidateIdentityGroup, groupCandidatesByExactIdentity } from "../players/identity/candidate-groups.js";
import { groupCandidatesWithConfiguredReepIndex } from "../players/identity/configured-candidate-grouper.js";
import { type KnowledgeRepository, createLocalKnowledgeBase } from "../knowledge/index.js";
import { createRecruitmentTurnRuntime, recruitmentProgressTransformer } from "./conversation-turn-runtime.js";
import { assertRepositoryModelProcessingAllowed } from "./conversation/access.js";
import { resolvedCandidateSearchIntent } from "./conversation/candidate-context.js";
import { type RecruitmentAskUserMode, type RecruitmentCandidatePolicyMode, type RecruitmentConversation, type RecruitmentReviewerMode, type RecruitmentTraceObserver, type UnderstatResearchMode, RecruitmentCaseStateExpiredError } from "./conversation/contracts.js";
import { createExternalSignalNode, createHistoricalArchiveNode } from "./conversation/enrichment-nodes.js";
import { asksForSpecificMissingReplacementPosition } from "./conversation/interaction-policy.js";
import { createPlanningNode } from "./conversation/planning-node.js";
import { createReportProjection } from "./conversation/report-projection.js";
import { createReviewNode } from "./conversation/review-node.js";
import { type State, maxDecisionsPerTurn, RecruitmentState } from "./conversation/state.js";
import { createToolNode } from "./conversation/tool-node.js";
import { createRecordUserTurnNode, waitForUser } from "./conversation/turn-nodes.js";
import { type RecruitmentEvidenceEvaluator, createRecruitmentEvidenceEvaluator } from "./recruitment-evidence-evaluator.js";
import { createCaseSummaryGenerator, type CaseSummaryGenerator } from "./case-summary.js";
import { type RecruitmentPlanner, createRecruitmentPlanner, RecruitmentModelTimeoutError, RecruitmentModelUnavailableError } from "./recruitment-planner.js";

export { RecruitmentCaseStateExpiredError } from "./conversation/contracts.js";
export type { RecruitmentAskUserMode, RecruitmentCandidatePolicyMode, RecruitmentConversation, RecruitmentReviewerMode, RecruitmentTraceEvent, RecruitmentTraceObserver, UnderstatResearchMode } from "./conversation/contracts.js";
export type { ContextManagementMode } from "./conversation/context-compaction-node.js";

export { type RecruitmentAction } from "./recruitment-actions.js";

export { RecruitmentModelTimeoutError, RecruitmentModelUnavailableError };

export {
  conclusionInstructions,
  expansionInstructions, investigationInstructions, RecruitmentPlannerOutputError, reorientationInstructions
} from "./recruitment-planner.js";

export type { ConversationHistoryEntry } from "./planner-context.js";
export type { RecruitmentPlanner, RecruitmentPlannerResponseDiagnostics } from "./recruitment-planner.js";

export function createRecruitmentConversation(input: {
  repository: PlayerRepository;
  briefInterpreter?: RecruitmentBriefInterpreter;
  referenceNameResolver?: PlayerNameResolver;
  teamRosterEnrichment?: TeamRosterEnrichmentProvider;
  planner: RecruitmentPlanner;
  candidateIdentityGrouper?: (records: readonly PlayerProfile[]) => CandidateIdentityGroup[];
  knowledgeBase?: KnowledgeRepository;
  observer?: RecruitmentTraceObserver;
  checkpointer?: BaseCheckpointSaver;
  experimentalReviewerMode?: RecruitmentReviewerMode;
  experimentalAskUserMode?: RecruitmentAskUserMode;
  experimentalCandidatePolicyMode?: RecruitmentCandidatePolicyMode;
  experimentalCandidateSearchFreshnessMode?: "enabled" | "bypassed";
  experimentalDeterministicSearchMode?: "enabled" | "bypassed";
  experimentalRetrievalMode?: RecruitmentRetrievalMode;
  experimentalReferenceProfileMode?: "enabled" | "bypassed";
  experimentalReferenceComparisonMode?: "enabled" | "bypassed";
  experimentalCandidateComparisonMode?: "enabled" | "bypassed";
  experimentalMethodologyReuseMode?: "enabled" | "bypassed";
  experimentalPreviousShortlistContextMode?: "enabled" | "bypassed";
  experimentalShortlistComparisonMode?: "enabled" | "bypassed";
  experimentalExpansionSufficiencyMode?: "enabled" | "bypassed";
  experimentalUnderstatResearchMode?: UnderstatResearchMode;
  evidenceEvaluator?: RecruitmentEvidenceEvaluator;
  experimentalContextManagementMode?: ContextManagementMode;
  caseSummaryGenerator?: CaseSummaryGenerator;
}): RecruitmentConversation {
  const { repository, planner, observer } = input;
  const groupCandidateRecords = input.candidateIdentityGrouper
    ?? ((records) => groupCandidatesByExactIdentity(records));
  const evidenceEvaluator = input.evidenceEvaluator ?? createRecruitmentEvidenceEvaluator(repository);
  const reviewerMode = input.experimentalReviewerMode ?? "enabled";
  const askUserMode = input.experimentalAskUserMode ?? "enabled";
  const candidatePolicyMode = input.experimentalCandidatePolicyMode ?? "enabled";
  const candidateSearchFreshnessMode = input.experimentalCandidateSearchFreshnessMode ?? "enabled";
  const expansionSufficiencyMode = input.experimentalExpansionSufficiencyMode ?? "enabled";
  const contextManagementMode = input.experimentalContextManagementMode ?? "legacy";
  // Keep graph construction side-effect free; configured callers inject the
  // model-backed generator explicitly, tests can supply a deterministic one.
  const caseSummaryGenerator = input.caseSummaryGenerator;
  const enforceCurrentTurnObservation = candidateSearchFreshnessMode === "enabled";
  const knowledgeBase = input.knowledgeBase ?? createLocalKnowledgeBase();
  const playerEloSetup = createConfiguredPlayerEloReportClient();
  const historicalArchiveSetup = createConfiguredHistoricalArchive();
  const disabledPlayerEloCoverage: ExternalSignalCoverage = playerEloSetup.status === "disabled"
    ? createEmptyExternalSignalCoverage("disabled", playerEloSetup.reason)
    : createEmptyExternalSignalCoverage();
  const workflow = new StateGraph(RecruitmentState)
    .addNode("record_user_turn", createRecordUserTurnNode({ disabledPlayerEloCoverage, historicalArchiveSetup, abilityProfilesEnabled: repository.supportsAbilityProfiles }))
    .addNode("understand_request", createUnderstandingNode({ interpreter: input.briefInterpreter, repository, resolver: input.referenceNameResolver, observer, referenceComparisonEnabled: input.experimentalReferenceComparisonMode !== "bypassed", contextManagementMode }))
    .addNode("compact_case_context", createContextCompactionNode({ mode: contextManagementMode, ...(caseSummaryGenerator ? { generator: caseSummaryGenerator } : {}), observer }))
    .addNode("choose_next_action", createPlanningNode({ repository, planner, observer, groupCandidateRecords, askUserMode, candidatePolicyMode, enforceCurrentTurnObservation, deterministicSearchEnabled: input.experimentalDeterministicSearchMode === "enabled", expansionSufficiencyEnabled: expansionSufficiencyMode === "enabled", previousShortlistContextEnabled: input.experimentalPreviousShortlistContextMode !== "bypassed", shortlistComparisonEnabled: input.experimentalShortlistComparisonMode !== "bypassed", retrievalMode: input.experimentalRetrievalMode ?? "fixed", understatResearchMode: input.experimentalUnderstatResearchMode, contextManagementMode }))
    .addNode("execute_tool", createToolNode({ repository, knowledgeBase, evidenceEvaluator, observer, groupCandidateRecords, methodologyReuseEnabled: input.experimentalMethodologyReuseMode !== "bypassed", ...(input.teamRosterEnrichment ? { teamRosterEnrichment: input.teamRosterEnrichment } : {}), referenceNameResolver: input.referenceNameResolver }))
    .addNode("wait_for_user", waitForUser)
    .addNode("review_recommendation", createReviewNode({ observer, reviewerMode }))
    .addNode("enrich_external_signals", createExternalSignalNode({ playerEloSetup, disabledPlayerEloCoverage }))
    .addNode("enrich_historical_archive", createHistoricalArchiveNode({ repository, historicalArchiveSetup }))
    .addNode("deliver_recommendation", createReportProjection({ repository, evidenceEvaluator, groupCandidateRecords, candidateComparisonEnabled: input.experimentalCandidateComparisonMode !== "bypassed", referenceProfileEnabled: input.experimentalReferenceProfileMode !== "bypassed" }))
    .addEdge(START, "record_user_turn")
    .addEdge("record_user_turn", "understand_request")
    .addEdge("understand_request", "compact_case_context")
    .addEdge("compact_case_context", "choose_next_action")
    .addConditionalEdges("choose_next_action", (state: State) => {
      if (state.forcedLimitReached || state.policyLoopStopped) return "review";
      if (state.policyBlocked) return "replan";
      if (state.action?.action === "ask_user" || state.action?.action === "finish") {
        const unresolvedReplacementPosition = state.action.action === "ask_user"
          && asksForSpecificMissingReplacementPosition(
            state.action,
            resolvedCandidateSearchIntent(state).replacementRequest,
            state.replacementReferencePosition,
          )
          && state.history.some((entry) => entry.role === "tool" && entry.toolName === "inspect_team");
        const unresolvedReferenceIdentity = state.action.action === "ask_user"
          && state.pendingQuestion?.input?.kind === "player_identity";
        if (!state.hasInvestigated && !state.brief && !state.briefFailure && !unresolvedReplacementPosition && !unresolvedReferenceIdentity) return "replan";
        return state.action.action === "ask_user" ? "ask" : "review";
      }
      return "tool";
    }, { ask: "wait_for_user", replan: "choose_next_action", review: "review_recommendation", tool: "execute_tool" })
    .addEdge("execute_tool", "compact_case_context")
    .addConditionalEdges("review_recommendation", (state: State) => {
      if (state.reviewResult === "retry") return "retry";
      if ((state.reviewResult === "valid" || state.reviewResult === "bypassed")
        && state.action?.action === "finish"
        && state.action.recommendations.length > 0) {
        return playerEloSetup.client ? "enrich_external" : "enrich_archive";
      }
      return "deliver";
    }, {
      retry: "choose_next_action",
      enrich_external: "enrich_external_signals",
      enrich_archive: "enrich_historical_archive",
      deliver: "deliver_recommendation",
    })
    .addEdge("enrich_external_signals", "enrich_historical_archive")
    .addEdge("enrich_historical_archive", "deliver_recommendation")
    .addEdge("deliver_recommendation", END)
    .compile({ checkpointer: input.checkpointer ?? new MemorySaver() });

  const recursionLimit = maxDecisionsPerTurn * 5 + 10;
  const turn = createRecruitmentTurnRuntime({
    assertTurnAllowed: () => assertRepositoryModelProcessingAllowed(repository),
    createExpiredStateError: () => new RecruitmentCaseStateExpiredError(),
    graph: {
      async getCheckpoint(threadId) {
        const snapshot = await workflow.getState({
          configurable: { thread_id: threadId },
          recursionLimit,
        });
        const state = snapshot.values as State | undefined;
        return {
          values: state ? {
            pendingQuestion: state.pendingQuestion,
            responseMessage: state.responseMessage,
            report: state.report,
            brief: state.brief,
            retryMessage: state.briefFailure ? state.history.filter(entry => entry.role === "user").at(-1)?.content : undefined,
          } : undefined,
          tasks: snapshot.tasks.map((task) => ({ interrupts: task.interrupts })),
        };
      },
      async run({ threadId, message, positionAnswer, playerIdentityAnswer, positionUpdate, resume, signal }) {
        const streamOptions = {
          configurable: { thread_id: threadId },
          recursionLimit,
          version: "v3" as const,
          streamMode: ["custom"] as ("custom")[],
          transformers: [recruitmentProgressTransformer] as const,
          ...(signal ? { signal } : {}),
        };
        if (resume) {
          const graphStream = await workflow.streamEvents(new Command({ resume: positionAnswer ?? playerIdentityAnswer ?? message }), streamOptions);
          return graphStream;
        }
        const graphStream = await workflow.streamEvents({ userMessage: message, incomingPositions: positionUpdate ?? null }, streamOptions);
        return graphStream;
      },
    },
  });
  return { turn };
}

export interface ConfiguredRecruitmentConversationOptions {
  briefInterpreter?: RecruitmentBriefInterpreter;
  referenceNameResolver?: PlayerNameResolver;
  repository: PlayerRepository;
  teamRosterEnrichment?: TeamRosterEnrichmentProvider;
  knowledgeBase?: KnowledgeRepository;
  observer?: RecruitmentTraceObserver;
  checkpointer?: BaseCheckpointSaver;
  experimentalReviewerMode?: RecruitmentReviewerMode;
  experimentalAskUserMode?: RecruitmentAskUserMode;
  plannerFactory?: () => RecruitmentPlanner;
  experimentalDeterministicSearchMode?: "enabled" | "bypassed";
  experimentalRetrievalMode?: RecruitmentRetrievalMode;
  experimentalReferenceProfileMode?: "enabled" | "bypassed";
  experimentalReferenceComparisonMode?: "enabled" | "bypassed";
  experimentalCandidateComparisonMode?: "enabled" | "bypassed";
  experimentalExpansionSufficiencyMode?: "enabled" | "bypassed";
  experimentalUnderstatResearchMode?: UnderstatResearchMode;
  evidenceEvaluator?: RecruitmentEvidenceEvaluator;
  experimentalContextManagementMode?: ContextManagementMode;
  caseSummaryGenerator?: CaseSummaryGenerator;
}

export function configuredRecruitmentConversation(
  options: ConfiguredRecruitmentConversationOptions,
): RecruitmentConversation {
  const {
    repository,
    knowledgeBase,
    observer,
    checkpointer,
    experimentalReviewerMode = "enabled",
    experimentalAskUserMode = "enabled",
    plannerFactory = createRecruitmentPlanner,
    evidenceEvaluator,
  } = options;
  try {
    const contextManagementMode = options.experimentalContextManagementMode ?? "legacy";
    return createRecruitmentConversation({
      repository,
      planner: plannerFactory(),
      briefInterpreter: options.briefInterpreter ?? createRecruitmentBriefInterpreter(),
      referenceNameResolver: options.referenceNameResolver ?? createConfiguredPlayerNameResolver(process.env, { repository,
        variants: createPlayerNameVariantGenerator(usage => observer?.({ phase: "identity_usage", ...usage })) }),
      experimentalDeterministicSearchMode: options.experimentalDeterministicSearchMode ?? "enabled",
      experimentalRetrievalMode: options.experimentalRetrievalMode ?? "on_demand",
      experimentalReferenceProfileMode: options.experimentalReferenceProfileMode,
      experimentalReferenceComparisonMode: options.experimentalReferenceComparisonMode,
      experimentalCandidateComparisonMode: options.experimentalCandidateComparisonMode,
      experimentalExpansionSufficiencyMode: options.experimentalExpansionSufficiencyMode ?? "enabled",
      experimentalUnderstatResearchMode: options.experimentalUnderstatResearchMode,
      ...(options.teamRosterEnrichment ? { teamRosterEnrichment: options.teamRosterEnrichment } : {}),
      candidateIdentityGrouper: groupCandidatesWithConfiguredReepIndex,
      knowledgeBase,
      observer,
      checkpointer,
      experimentalReviewerMode,
      experimentalAskUserMode,
      ...(evidenceEvaluator ? { evidenceEvaluator } : {}),
      experimentalContextManagementMode: contextManagementMode,
      ...(options.caseSummaryGenerator ? { caseSummaryGenerator: options.caseSummaryGenerator }
        : contextManagementMode === "summarized" ? { caseSummaryGenerator: createCaseSummaryGenerator() } : {}),
    });
  } catch (error) {
    if (error instanceof RecruitmentModelUnavailableError) return unavailableRecruitmentConversation();
    throw error;
  }
}

export function unavailableRecruitmentConversation(): RecruitmentConversation {
  return {
    async turn() {
      throw new RecruitmentModelUnavailableError();
    },
  };
}
