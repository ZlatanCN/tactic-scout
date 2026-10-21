import type { LangGraphRunnableConfig, Runtime } from "@langchain/langgraph";
import { type InvestigationDirective, nextRequiredInvestigation } from "./required-investigation.js";
import { recruitmentRetrievalNeeds, type RecruitmentRetrievalMode, type RetrievalNeeds } from "./retrieval-policy.js";
import { buildPlanningSnapshot, type DecisionSnapshot, type PlanningMode } from "./planning-snapshot.js";
import { availablePlannerActions, chooseDecisionMode } from "./planning-policy.js";
import { investigationCandidates } from "./required-investigation.js";
import type { UnderstatResearchMode } from "./contracts.js";
import type { State } from "./state.js";
import type { ParsedRecruitmentAction } from "../recruitment-actions.js";
import { requireRecruitmentRuntimeContext, type RecruitmentRuntimeContext } from "./runtime-context.js";
import {
  buildRecruitmentDecisionContext,
  type RecruitmentDecisionContext,
} from "./planning-decision.js";
import { knowledgeEvidenceAccessContext } from "./knowledge-evidence-context.js";
import { knowledgeSearchResultFromEvidence } from "../../knowledge/evidence-adapter.js";

/**
 * Per-run scratch space shared by adjacent LangGraph supersteps. This object is
 * deliberately absent from RecruitmentState and is recreated for every turn or
 * resume, so a snapshot can never become a second checkpointed source of truth.
 */
export interface PlanningRunState {
  snapshot?: DecisionSnapshot;
  decisionMode?: PlanningMode;
  requiredAction?: InvestigationDirective | null;
  retrievalNeeds?: RetrievalNeeds;
  decisionContext?: RecruitmentDecisionContext;
  policyAction?: ParsedRecruitmentAction;
  proposedAction?: ParsedRecruitmentAction;
  plannerFallback?:
    | "expansion_timeout"
    | "expansion_output_limit"
    | "conclusion_timeout"
    | "conclusion_output_limit";
}
export function createPlanningRunState(): PlanningRunState {
  return {};
}

export function clearPlanningRunState(run: PlanningRunState): void {
  delete run.snapshot;
  delete run.decisionMode;
  delete run.requiredAction;
  delete run.retrievalNeeds;
  delete run.decisionContext;
  delete run.policyAction;
  delete run.proposedAction;
  delete run.plannerFallback;
}

async function refreshKnowledgeEvidenceForModel(input: {
  state: State;
  context: RecruitmentRuntimeContext;
  config: LangGraphRunnableConfig;
}): Promise<{ state: State; update: Partial<State>; modelEvidenceHistory?: State["history"] }> {
  const { state, context, config } = input;
  const referencedKnowledge = Object.values(state.retrievedKnowledge).filter((document) => document.evidenceRef);
  if (!context.knowledgeEvidence || !referencedKnowledge.length) return { state, update: {} };
  const result = await context.knowledgeEvidence.reader.resolve(
    referencedKnowledge.map((document) => document.evidenceRef!),
    knowledgeEvidenceAccessContext(config, state, "recruitment"),
    config.signal,
  );
  const resolvedResults = result.evidence.map(knowledgeSearchResultFromEvidence);
  const nonReferenceDocuments = Object.fromEntries(Object.entries(state.retrievedKnowledge).filter(([, document]) => !document.evidenceRef));
  const retrievedKnowledge = Object.fromEntries([
    ...Object.entries(nonReferenceDocuments),
    ...resolvedResults.map((document) => [document.id, { ...document, text: "" }] as const),
  ]);
  const unavailableMethodology = result.status === "unavailable" && referencedKnowledge.some(({ corpus }) => corpus === "methodology");
  const unavailableReports = result.status === "unavailable" && referencedKnowledge.some(({ corpus }) => corpus === "player_report");
  const updatedState: State = {
    ...state,
    retrievedKnowledge,
    ...(unavailableMethodology ? { methodologySearchOutcome: "unavailable" as const, methodologySearchFailed: true } : {}),
    ...(unavailableReports ? { playerReportSearchOutcome: "unavailable" as const, playerReportSearchFailed: true } : {}),
  };
  const statusNote = result.status === "unavailable"
    ? `当前引用解析不可用（${result.failureCode ?? "unknown"}）；这些资料不会放入模型上下文。`
    : result.evidence.length
      ? `以下引用已按当前策略重新解析，正文对应不可变原文版本；只可在标明的资料类别、来源和样本范围内使用。排序模式：${result.rankingMode ?? "unknown"}。`
      : "此前保存的证据引用当前无法解析；不得继续使用 checkpoint 中的旧正文。";
  const modelEvidenceHistory: State["history"] = [{
    role: "tool",
    toolName: "resolved_knowledge_context",
    content: JSON.stringify({
      status: result.status,
      failureCode: result.failureCode,
      traceId: result.traceId,
      generationId: result.generationId,
      rankingMode: result.rankingMode,
      budgetMsUsed: result.budgetMsUsed,
      budgetMsRemaining: result.budgetMsRemaining,
      note: statusNote,
      results: resolvedResults,
    }),
  }];
  return {
    state: updatedState,
    update: {
      retrievedKnowledge,
      ...(unavailableMethodology ? { methodologySearchOutcome: "unavailable" as const, methodologySearchFailed: true } : {}),
      ...(unavailableReports ? { playerReportSearchOutcome: "unavailable" as const, playerReportSearchFailed: true } : {}),
    },
    modelEvidenceHistory,
  };
}

export function preparePlanningRunState(input: {
  state: State;
  context: RecruitmentRuntimeContext;
  retrievalMode: RecruitmentRetrievalMode;
  understatResearchMode?: UnderstatResearchMode;
  deterministicSearchEnabled?: boolean;
}): PlanningRunState {
  const {
    state,
    context,
    retrievalMode,
    understatResearchMode,
    deterministicSearchEnabled = false,
  } = input;
  const retrievalNeeds = recruitmentRetrievalNeeds(state, retrievalMode);
  const requiredAction = nextRequiredInvestigation(state, context.repository, {
    retrievalNeeds,
    deterministicSearchEnabled,
    understatResearchMode,
  });
  const decision = chooseDecisionMode({ state, retrievalMode, understatResearchMode });
  const eligible = investigationCandidates(state);
  const run: PlanningRunState = {
    retrievalNeeds,
    requiredAction,
    decisionMode: decision.decisionMode,
    snapshot: buildPlanningSnapshot({
      state,
      repository: context.repository,
      decisionMode: decision.decisionMode,
      availableActions: availablePlannerActions({
        state,
        repository: context.repository,
        decisionMode: decision.decisionMode,
      }),
      eligibleEvaluatedPlayers: eligible.eligibleEvaluatedPlayers,
      groupCandidateRecords: context.candidateIdentityGrouper,
      ...(decision.expansionConstraints ? { expansionConstraints: decision.expansionConstraints } : {}),
      ...(context.userPreferences ? { userPreferences: context.userPreferences } : {}),
    }),
  };
  context.planningRun = run;
  return run;
}

export function requirePlanningRun(
  context: RecruitmentRuntimeContext,
  state: State,
): PlanningRunState {
  if (context.planningRun) return context.planningRun;
  throw new Error(`Recruitment planning runtime is missing its prepared decision snapshot at decision step ${state.decisionSteps}.`);
}

export function createPreparePlanningNode(input: {
  retrievalMode: RecruitmentRetrievalMode;
  understatResearchMode?: UnderstatResearchMode;
  previousShortlistContextEnabled?: boolean;
  deterministicSearchEnabled?: boolean;
}) {
  return async (state: State, runtime: Runtime<RecruitmentRuntimeContext>): Promise<Partial<State>> => {
    const context = requireRecruitmentRuntimeContext(runtime.context);
    const config = runtime as LangGraphRunnableConfig;
    const refreshed = await refreshKnowledgeEvidenceForModel({ state, context, config });
    const planningRun = preparePlanningRunState({
      state: refreshed.state,
      context,
      retrievalMode: input.retrievalMode,
      understatResearchMode: input.understatResearchMode,
      deterministicSearchEnabled: input.deterministicSearchEnabled,
    });
    if (!planningRun.snapshot) {
      throw new Error("Recruitment decision preparation did not produce a decision snapshot.");
    }
    if (refreshed.modelEvidenceHistory) {
      const historyWithoutStaleRagText = planningRun.snapshot.history.filter((entry) => entry.role !== "tool"
        || !["search_methodology", "search_player_reports", "resolved_knowledge_context"].includes(entry.toolName ?? ""));
      planningRun.snapshot.history = [...historyWithoutStaleRagText, ...refreshed.modelEvidenceHistory];
    }
    planningRun.decisionContext = buildRecruitmentDecisionContext({
      state: refreshed.state,
      snapshot: planningRun.snapshot,
      config,
      repository: context.repository,
      ...(context.observer ? { observer: context.observer } : {}),
      groupCandidateRecords: context.candidateIdentityGrouper,
      previousShortlistContextEnabled: input.previousShortlistContextEnabled,
    });
    return refreshed.update;
  };
}
