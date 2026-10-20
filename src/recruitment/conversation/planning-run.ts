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
    const planningRun = preparePlanningRunState({
      state,
      context,
      retrievalMode: input.retrievalMode,
      understatResearchMode: input.understatResearchMode,
      deterministicSearchEnabled: input.deterministicSearchEnabled,
    });
    if (!planningRun.snapshot) {
      throw new Error("Recruitment decision preparation did not produce a decision snapshot.");
    }
    planningRun.decisionContext = buildRecruitmentDecisionContext({
      state,
      snapshot: planningRun.snapshot,
      config: runtime as LangGraphRunnableConfig,
      repository: context.repository,
      ...(context.observer ? { observer: context.observer } : {}),
      groupCandidateRecords: context.candidateIdentityGrouper,
      previousShortlistContextEnabled: input.previousShortlistContextEnabled,
    });
    return {};
  };
}
