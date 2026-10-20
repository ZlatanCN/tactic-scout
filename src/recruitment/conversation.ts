import { createUnderstandingNode } from "./conversation/understanding-node.js";
import { createRecruitmentBriefInterpreter } from "./brief-interpreter.js";
import type { RecruitmentBriefInterpreter } from "./brief.js";
import type { RecruitmentRetrievalMode } from "./conversation/retrieval-policy.js";
import { createConfiguredPlayerNameResolver, type PlayerNameResolver } from "../players/identity/name-resolver.js";
import { createPlayerNameVariantGenerator } from "./player-name-variants.js";
import type { TeamRosterEnrichmentProvider } from "../sources/thesportsdb/roster.js";
import { type BaseCheckpointSaver, type BaseStore, Command, END, MemorySaver, Send, START, StateGraph } from "@langchain/langgraph";
import { toolsCondition } from "@langchain/langgraph/prebuilt";
import { createConfiguredHistoricalArchive } from "../sources/reep/historical-archive-enrichment.js";
import { type PlayerRepository } from "../players/repository.js";
import { createConfiguredPlayerEloReportClient } from "../sources/playerelo/client.js";
import { type ExternalSignalCoverage, createEmptyExternalSignalCoverage } from "../domain/external-evidence.js";
import { type PlayerProfile } from "../domain/players.js";
import { type CandidateIdentityGroup, groupCandidatesByExactIdentity } from "../players/identity/candidate-groups.js";
import { groupCandidatesWithConfiguredReepIndex } from "../players/identity/configured-candidate-grouper.js";
import { type KnowledgeRepository, createLocalKnowledgeBase } from "../knowledge/index.js";
import { createRecruitmentTurnRuntime, recruitmentProgressTransformer, type RecruitmentTurnGraphRun } from "./conversation-turn-runtime.js";
import { assertRepositoryModelProcessingAllowed } from "./conversation/access.js";
import { type RecruitmentAskUserMode, type RecruitmentCandidatePolicyMode, type RecruitmentConversation, type RecruitmentReviewerMode, type RecruitmentTraceObserver, type UnderstatResearchMode, RecruitmentCaseStateExpiredError } from "./conversation/contracts.js";
import { createExternalSignalNode, createHistoricalArchiveNode, externalSignalFailureHandler, historicalArchiveFailureHandler } from "./conversation/enrichment-nodes.js";
import { asksForSpecificMissingReplacementPosition } from "./conversation/interaction-policy.js";
import { createPolicyGateNode } from "./conversation/policy-gate-node.js";
import { createPlanDecisionNode } from "./conversation/plan-decision-node.js";
import { createValidateDecisionNode } from "./conversation/validate-decision-node.js";
import { createReportProjection } from "./conversation/report-projection.js";
import { createReviewNode } from "./conversation/review-node.js";
import { type State, maxDecisionsPerTurn, RecruitmentState } from "./conversation/state.js";
import { createToolNode } from "./conversation/tool-node.js";
import { createRecordUserTurnNode, waitForUser } from "./conversation/turn-nodes.js";
import { type RecruitmentEvidenceEvaluator, createRecruitmentEvidenceEvaluator } from "./recruitment-evidence-evaluator.js";
import { type RecruitmentPlanner, createRecruitmentPlanner, RecruitmentModelTimeoutError, RecruitmentModelUnavailableError } from "./recruitment-planner.js";
import {
  RecruitmentRuntimeContextSchema,
  requireRecruitmentRuntimeContext,
  type RecruitmentRuntimeContext,
} from "./conversation/runtime-context.js";
import { createPlanningRunState, createPreparePlanningNode } from "./conversation/planning-run.js";
import { recruitmentNodePolicies } from "./conversation/node-policies.js";
import { emitProgress } from "./conversation/progress.js";
import { projectCaseRunHistory } from "./conversation/case-run-inspection.js";

export { RecruitmentCaseStateExpiredError } from "./conversation/contracts.js";
export type { RecruitmentAskUserMode, RecruitmentCandidatePolicyMode, RecruitmentConversation, RecruitmentReviewerMode, RecruitmentTraceEvent, RecruitmentTraceObserver, UnderstatResearchMode } from "./conversation/contracts.js";

export { type RecruitmentAction } from "./recruitment-actions.js";

export { RecruitmentModelTimeoutError, RecruitmentModelUnavailableError };

export {
  conclusionInstructions,
  expansionInstructions, investigationInstructions, RecruitmentPlannerOutputError, reorientationInstructions
} from "./recruitment-planner.js";

export type { ConversationHistoryEntry } from "./planner-context.js";
export type { RecruitmentPlanner, RecruitmentPlannerResponseDiagnostics } from "./recruitment-planner.js";

export function createRecruitmentConversation(input: {
  repository?: PlayerRepository;
  briefInterpreter?: RecruitmentBriefInterpreter;
  referenceNameResolver?: PlayerNameResolver;
  teamRosterEnrichment?: TeamRosterEnrichmentProvider;
  planner?: RecruitmentPlanner;
  candidateIdentityGrouper?: (records: readonly PlayerProfile[]) => CandidateIdentityGroup[];
  knowledgeBase?: KnowledgeRepository;
  observer?: RecruitmentTraceObserver;
  checkpointer?: BaseCheckpointSaver;
  store?: BaseStore;
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
  runtime?: Partial<RecruitmentRuntimeContext>;
}): RecruitmentConversation {
  const constructionRepository = input.repository ?? input.runtime?.repository;
  const constructionPlanner = input.planner ?? input.runtime?.planner;
  const { observer } = input;
  const groupCandidateRecords = input.candidateIdentityGrouper
    ?? input.runtime?.candidateIdentityGrouper
    ?? ((records) => groupCandidatesByExactIdentity(records));
  const evidenceEvaluator = input.evidenceEvaluator
    ?? input.runtime?.evidenceEvaluator
    ?? (constructionRepository ? createRecruitmentEvidenceEvaluator(constructionRepository) : undefined);
  const reviewerMode = input.experimentalReviewerMode ?? "enabled";
  const askUserMode = input.experimentalAskUserMode ?? "enabled";
  const candidatePolicyMode = input.experimentalCandidatePolicyMode ?? "enabled";
  const candidateSearchFreshnessMode = input.experimentalCandidateSearchFreshnessMode ?? "enabled";
  const expansionSufficiencyMode = input.experimentalExpansionSufficiencyMode ?? "enabled";
  const enforceCurrentTurnObservation = candidateSearchFreshnessMode === "enabled";
  const knowledgeBase = input.knowledgeBase ?? input.runtime?.knowledgeBase ?? createLocalKnowledgeBase();
  const playerEloSetup = input.runtime?.playerEloSetup ?? createConfiguredPlayerEloReportClient();
  const historicalArchiveSetup = createConfiguredHistoricalArchive();
  const disabledPlayerEloCoverage: ExternalSignalCoverage = playerEloSetup.status === "disabled"
    ? createEmptyExternalSignalCoverage("disabled", playerEloSetup.reason)
    : createEmptyExternalSignalCoverage();
  const defaultRuntimeContext: RecruitmentRuntimeContext | undefined = constructionRepository
    && constructionPlanner
    && evidenceEvaluator
    ? {
      repository: constructionRepository,
      planner: constructionPlanner,
      ...(input.runtime?.briefInterpreter ?? input.briefInterpreter
        ? { briefInterpreter: input.runtime?.briefInterpreter ?? input.briefInterpreter }
        : {}),
      ...(input.runtime?.referenceNameResolver ?? input.referenceNameResolver
        ? { referenceNameResolver: input.runtime?.referenceNameResolver ?? input.referenceNameResolver }
        : {}),
      ...(input.runtime?.teamRosterEnrichment ?? input.teamRosterEnrichment
        ? { teamRosterEnrichment: input.runtime?.teamRosterEnrichment ?? input.teamRosterEnrichment }
        : {}),
      candidateIdentityGrouper: groupCandidateRecords,
      knowledgeBase,
      ...(observer ?? input.runtime?.observer ? { observer: observer ?? input.runtime?.observer } : {}),
      evidenceEvaluator,
      userPreferences: input.runtime?.userPreferences ?? [],
      playerEloSetup,
      historicalArchiveSetup: input.runtime?.historicalArchiveSetup ?? historicalArchiveSetup,
    }
    : undefined;
  const workflow = new StateGraph(RecruitmentState, RecruitmentRuntimeContextSchema)
    .addNode("record_user_turn", createRecordUserTurnNode({ disabledPlayerEloCoverage, historicalArchiveSetup }))
    .addNode("understand_request", createUnderstandingNode({ referenceComparisonEnabled: input.experimentalReferenceComparisonMode !== "bypassed" }), recruitmentNodePolicies.understand_request)
    .addNode("prepare_decision_snapshot", createPreparePlanningNode({
      retrievalMode: input.experimentalRetrievalMode ?? "fixed",
      understatResearchMode: input.experimentalUnderstatResearchMode,
      previousShortlistContextEnabled: input.experimentalPreviousShortlistContextMode !== "bypassed",
      deterministicSearchEnabled: input.experimentalDeterministicSearchMode === "enabled",
    }))
    .addNode("policy_gate", createPolicyGateNode({ expansionSufficiencyEnabled: expansionSufficiencyMode === "enabled" }), { ends: ["plan_decision", "validate_decision"] })
    .addNode("plan_decision", createPlanDecisionNode(), { ...recruitmentNodePolicies.plan_decision, ends: ["validate_decision", "record_runtime_failure"] })
    .addNode("validate_decision", createValidateDecisionNode({ askUserMode, candidatePolicyMode, enforceCurrentTurnObservation, shortlistComparisonEnabled: input.experimentalShortlistComparisonMode !== "bypassed", understatResearchMode: input.experimentalUnderstatResearchMode }), { ends: ["execute_tool", "wait_for_user", "review_recommendation", "prepare_decision_snapshot"] })
    .addNode("execute_tool", createToolNode({ methodologyReuseEnabled: input.experimentalMethodologyReuseMode !== "bypassed" }), { ...recruitmentNodePolicies.execute_tool, ends: ["record_runtime_failure"] })
    .addNode("wait_for_user", waitForUser)
    .addNode("review_recommendation", createReviewNode({ reviewerMode }), { ...recruitmentNodePolicies.review_recommendation, ends: ["record_runtime_failure"] })
    .addNode("enrich_external_signals", createExternalSignalNode(), {
      ...recruitmentNodePolicies.enrichment,
      ends: ["deliver_recommendation"],
      errorHandler: externalSignalFailureHandler,
    })
    .addNode("enrich_historical_archive", createHistoricalArchiveNode(), {
      ...recruitmentNodePolicies.enrichment,
      ends: ["deliver_recommendation"],
      errorHandler: historicalArchiveFailureHandler,
    })
    .addNode("deliver_recommendation", createReportProjection({ candidateComparisonEnabled: input.experimentalCandidateComparisonMode !== "bypassed", referenceProfileEnabled: input.experimentalReferenceProfileMode !== "bypassed" }))
    .addNode("record_runtime_failure", (state: State, config: import("@langchain/langgraph").LangGraphRunnableConfig) => {
      emitProgress(config, {
        stage: "failed",
        status: "failed",
        message: "案件已安全暂停；调查状态已保存，可以稍后重试",
        completedSteps: state.decisionSteps,
      });
      return {};
    })
    .addEdge(START, "record_user_turn")
    .addEdge("record_user_turn", "understand_request")
    .addEdge("understand_request", "prepare_decision_snapshot")
    .addEdge("prepare_decision_snapshot", "policy_gate")
    .addEdge("execute_tool", "prepare_decision_snapshot")
    .addConditionalEdges("review_recommendation", (state: State) => {
      if (state.reviewResult === "retry") return "retry";
      if ((state.reviewResult === "valid" || state.reviewResult === "bypassed")
        && state.action?.action === "finish"
        && state.action.recommendations.length > 0) {
        return [
          new Send("enrich_external_signals", state),
          new Send("enrich_historical_archive", state),
        ];
      }
      return "deliver";
    }, {
      retry: "prepare_decision_snapshot",
      deliver: "deliver_recommendation",
    })
    .addEdge(["enrich_external_signals", "enrich_historical_archive"], "deliver_recommendation")
    .addEdge("deliver_recommendation", END)
    .addEdge("record_runtime_failure", END)
    .compile({ checkpointer: input.checkpointer ?? new MemorySaver(), ...(input.store ? { store: input.store } : {}) });

  const recursionLimit = maxDecisionsPerTurn * 5 + 10;
  const turn = createRecruitmentTurnRuntime({
    assertTurnAllowed: (runtimeContext) => {
      const effectiveContext = requireRecruitmentRuntimeContext(defaultRuntimeContext && runtimeContext
        ? { ...defaultRuntimeContext, ...runtimeContext }
        : runtimeContext ?? defaultRuntimeContext);
      assertRepositoryModelProcessingAllowed(effectiveContext.repository);
    },
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
            runtimeFailure: state.runtimeFailure,
            retryMessage: state.briefFailure ? state.history.filter(entry => entry.role === "user").at(-1)?.content : undefined,
          } : undefined,
          tasks: snapshot.tasks.map((task) => ({ interrupts: task.interrupts })),
          next: [...snapshot.next],
        };
      },
      async run({ threadId, message, positionAnswer, playerIdentityAnswer, positionUpdate, resume, resumeCheckpoint, signal, runControl, context }) {
        const runContextBase = defaultRuntimeContext && context
          ? { ...defaultRuntimeContext, ...context }
          : context ?? defaultRuntimeContext;
        const validRunContext = requireRecruitmentRuntimeContext(runContextBase);
        const runContext = { ...validRunContext, userPreferences: validRunContext.userPreferences ?? [], planningRun: createPlanningRunState() } satisfies RecruitmentRuntimeContext;
        const streamOptions = {
          configurable: { thread_id: threadId },
          recursionLimit,
          version: "v3" as const,
          streamMode: ["custom"] as ("custom")[],
          transformers: [recruitmentProgressTransformer] as const,
          ...(signal ? { signal } : {}),
          ...(runControl ? { control: runControl } : {}),
          context: runContext,
          durability: "sync" as const,
        };
        if (resume) {
          const graphStream = await workflow.streamEvents(new Command({ resume: positionAnswer ?? playerIdentityAnswer ?? message }), streamOptions);
          return graphStream as RecruitmentTurnGraphRun;
        }
        if (resumeCheckpoint) {
          const graphStream = await workflow.streamEvents(null, streamOptions);
          return graphStream as unknown as RecruitmentTurnGraphRun;
        }
        const graphStream = await workflow.streamEvents({ userMessage: message, incomingPositions: positionUpdate ?? null }, streamOptions);
        return graphStream as unknown as RecruitmentTurnGraphRun;
      },
    },
  });
  return {
    turn,
    async inspectCaseRun({ threadId, limit = 20 }) {
      const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 20;
      const snapshots = [];
      for await (const snapshot of workflow.getStateHistory(
        { configurable: { thread_id: threadId } },
        { limit: boundedLimit },
      )) snapshots.push(snapshot);
      return projectCaseRunHistory(snapshots, boundedLimit);
    },
  };
}

export interface ConfiguredRecruitmentConversationOptions {
  briefInterpreter?: RecruitmentBriefInterpreter;
  referenceNameResolver?: PlayerNameResolver;
  repository: PlayerRepository;
  teamRosterEnrichment?: TeamRosterEnrichmentProvider;
  knowledgeBase?: KnowledgeRepository;
  observer?: RecruitmentTraceObserver;
  checkpointer?: BaseCheckpointSaver;
  store?: BaseStore;
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
}

export function configuredRecruitmentConversation(
  options: ConfiguredRecruitmentConversationOptions,
): RecruitmentConversation {
  const {
    repository,
    knowledgeBase,
    observer,
    checkpointer,
    store,
    experimentalReviewerMode = "enabled",
    experimentalAskUserMode = "enabled",
    plannerFactory = createRecruitmentPlanner,
    evidenceEvaluator,
  } = options;
  try {
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
      store,
      experimentalReviewerMode,
      experimentalAskUserMode,
      ...(evidenceEvaluator ? { evidenceEvaluator } : {}),
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
    async inspectCaseRun() {
      return { checkpoints: [] };
    },
  };
}
