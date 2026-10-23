import { Command } from "@langchain/langgraph";
import {
  emptyDecision,
  RecruitmentActionSchema,
  type ParsedRecruitmentAction,
} from "../recruitment-actions.js";
import { type RecruitmentAskUserMode, type RecruitmentCandidatePolicyMode, type UnderstatResearchMode } from "./contracts.js";
import {
  actionForAskPolicy,
  askPolicyDisabledPause,
  policyBlockReasonCode,
  questionForAskPolicy,
} from "./interaction-policy.js";
import {
  enforceInvestigationAction,
  investigationActionFeedback,
} from "./planned-action-policy.js";
import { emitProgress } from "./progress.js";
import { type State } from "./state.js";
import { preserveExplicitShortlistComparison } from "./shortlist-comparison.js";
import { messageForRecruitmentAction } from "../recruitment-tools.js";
import type { LangGraphRunnableConfig, Runtime } from "@langchain/langgraph";
import { requirePlanningRun } from "./planning-run.js";
import {
  type RecruitmentRuntimeContext,
  requireRecruitmentRuntimeContext,
} from "./runtime-context.js";

export function createValidateDecisionNode(input: {
  askUserMode: RecruitmentAskUserMode;
  candidatePolicyMode: RecruitmentCandidatePolicyMode;
  enforceCurrentTurnObservation: boolean;
  shortlistComparisonEnabled?: boolean;
  understatResearchMode?: UnderstatResearchMode;
}) {
  return async (
    state: State,
    runtime: Runtime<RecruitmentRuntimeContext>,
  ): Promise<Command | undefined> => {
    const context = requireRecruitmentRuntimeContext(runtime.context);
    const config = runtime as LangGraphRunnableConfig;
    const planningRun = requirePlanningRun(context, state);
    const snapshot = planningRun.snapshot;
    const decisionContext = planningRun.decisionContext;
    if (!snapshot || !decisionContext) {
      throw new Error("validate_decision requires a prepared decision snapshot.");
    }
    const requiredAction = planningRun.requiredAction;
    if (requiredAction) {
      return validateDirectedAction(state, config, context, input, requiredAction.action);
    }
    const proposedAction = planningRun.proposedAction ?? planningRun.policyAction;
    if (!proposedAction) {
      throw new Error("validate_decision found neither a policy nor model action.");
    }
    const proposedByPolicy = !planningRun.proposedAction;
    return validateDirectedAction(
      state,
      config,
      context,
      input,
      proposedAction,
      proposedByPolicy,
    );
  };
}

function validateDirectedAction(
  state: State,
  config: LangGraphRunnableConfig,
  context: RecruitmentRuntimeContext,
  input: {
    askUserMode: RecruitmentAskUserMode;
    candidatePolicyMode: RecruitmentCandidatePolicyMode;
    enforceCurrentTurnObservation: boolean;
    shortlistComparisonEnabled?: boolean;
    understatResearchMode?: UnderstatResearchMode;
  },
  proposedAction: ParsedRecruitmentAction,
  proposedByPolicy = true,
): Command {
  const planningRun = requirePlanningRun(context, state);
  const snapshot = planningRun.snapshot!;
  const decisionContext = planningRun.decisionContext!;
  const decisionMode = snapshot.caps.stage;
  const expansionConstraints = decisionContext.expansionConstraints;
  const retrievalNeeds = planningRun.retrievalNeeds ?? { methodology: true, playerReports: true };
  if (proposedByPolicy && proposedAction.action === "ask_user") {
    const suppressed = input.askUserMode === "disabled";
    const pendingQuestion = planningRun.requiredAction?.pendingQuestion
      ?? questionForAskPolicy(proposedAction, input.askUserMode);
    const effectivePendingQuestion = suppressed ? askPolicyDisabledPause : pendingQuestion;
    const action = suppressed ? actionForAskPolicy(proposedAction, "disabled") : proposedAction;
    context.observer?.({
      phase: "decision",
      action: proposedAction.action,
      decisionSource: "policy",
      elapsedMs: planningRun.decisionElapsedMs ?? 0,
      ok: planningRun.decisionOk ?? true,
      gatewayAttempts: planningRun.decisionGatewayAttempts ?? 0,
      policyBlocked: false,
      askPolicyOutcome: suppressed ? "suppressed" : "allowed",
      targetTeam: proposedAction.targetTeam,
    });
    emitProgress(config, {
      stage: "planning",
      status: "completed",
      message: suppressed
        ? planningRun.requiredAction?.suppressedMessage ?? planningRun.requiredAction?.message ?? "需要用户补充信息"
        : planningRun.requiredAction?.message ?? "需要用户补充信息",
      completedSteps: state.decisionSteps,
    });
    return new Command({
      update: {
        action,
        messages: [messageForRecruitmentAction(action, `policy-${state.decisionSteps}-${action.action}`)],
        decisionSteps: state.decisionSteps + 1,
        policyBlocked: false,
        policyBlockedRepeatCount: 0,
        ...(effectivePendingQuestion ? {
          pendingQuestion: effectivePendingQuestion,
          responseMessage: effectivePendingQuestion.question,
        } : {}),
        history: planningRun.requiredAction?.history
          ?? [{ role: "assistant", content: suppressed ? JSON.stringify({ action: "ask_user", suppressed: true }) : JSON.stringify(proposedAction) }],
        ...planningRun.requiredAction?.update,
      },
      goto: "wait_for_user",
    });
  }
  if (proposedByPolicy) {
    const action = proposedAction;
    context.observer?.({
      phase: "decision",
      action: action.action,
      decisionSource: "policy",
      elapsedMs: 0,
      ok: true,
      policyBlocked: false,
      ...(decisionMode === "expand" ? { policyReasonCodes: ["evidence_sufficient_for_expansion"] } : {}),
      targetTeam: action.action === "inspect_team" ? action.teamName : action.targetTeam ?? snapshot.case.targetTeam,
    });
    emitProgress(config, {
      stage: "planning",
      status: "completed",
      message: planningRun.requiredAction?.message ?? "已完成确定性调查决策",
      completedSteps: state.decisionSteps,
    });
    return policyCommand(state, action, planningRun.requiredAction?.update, planningRun.requiredAction?.history);
  }

  const budgetFinish = state.ragInvestigationBudgetExhausted && proposedAction.action === "finish";
  const enforced = budgetFinish
    ? { action: proposedAction, policyOverrodePlanner: true, candidateSearchExhausted: false }
    : enforceInvestigationAction(proposedAction, state, {
      candidatePolicyMode: input.candidatePolicyMode,
      enforceCurrentTurnObservation: input.enforceCurrentTurnObservation,
      decisionMode,
      ...(expansionConstraints ? { expansionConstraints } : {}),
      retrievalNeeds,
      understatResearchMode: input.understatResearchMode,
    });
  let action = enforced.action;
  let policyOverrodePlanner = enforced.policyOverrodePlanner;
  let shortlistComparisonApplied = false;
  if (input.shortlistComparisonEnabled !== false && action.action === "finish") {
    const continuation = preserveExplicitShortlistComparison(action, state);
    action = continuation.action;
    if (continuation.handled) {
      policyOverrodePlanner = true;
      shortlistComparisonApplied = true;
    }
  }
  const { endedTooEarly, policyFeedback } = budgetFinish
    ? { endedTooEarly: false, policyFeedback: [] as string[] }
    : investigationActionFeedback(
      state,
      proposedAction,
      action,
      decisionMode,
      enforced.candidateSearchExhausted,
      retrievalNeeds,
    );
  const policyReasonCodes = policyFeedback.map(policyBlockReasonCode);
  if (shortlistComparisonApplied) policyReasonCodes.push("shortlist_comparison_handled");
  if (decisionMode === "expand"
    && state.positionBroadeningApproved
    && expansionConstraints
    && action.action === "ask_user"
    && policyFeedback.length > 0) {
    action = RecruitmentActionSchema.parse({
      action: "search_candidates",
      targetTeam: expansionConstraints.targetTeam,
      position: expansionConstraints.position,
      ...(expansionConstraints.positions ? { positions: expansionConstraints.positions } : {}),
      playerName: expansionConstraints.playerName,
      maxAge: expansionConstraints.maxAge,
      ...(expansionConstraints.minAge == null ? {} : { minAge: expansionConstraints.minAge }),
      agePreference: expansionConstraints.agePreference ?? null,
      ...(expansionConstraints.fmCriteria?.length ? { fmCriteria: [...expansionConstraints.fmCriteria] } : {}),
      minimumMinutes: expansionConstraints.minimumMinutes,
      competition: expansionConstraints.competition,
      season: expansionConstraints.season,
      offset: expansionConstraints.nextOffset,
      limit: 20,
    });
    policyOverrodePlanner = true;
    policyFeedback.length = 0;
  }
  const blockedByPolicy = policyFeedback.length > 0;
  const askPolicyOutcome = action.action === "ask_user" && !endedTooEarly && !blockedByPolicy
    ? input.askUserMode === "disabled" ? "suppressed" as const : "allowed" as const
    : undefined;
  const stateAction = askPolicyOutcome === "suppressed" && action.action === "ask_user"
    ? actionForAskPolicy(action, "disabled")
    : action;
  const previousFeedback = state.history.at(-1);
  const sameBlockedAction = blockedByPolicy && state.policyBlocked
    && JSON.stringify(state.action) === JSON.stringify(action)
    && previousFeedback?.role === "tool" && previousFeedback.toolName === "investigation_policy"
    && previousFeedback.content === policyFeedback.join(" ");
  const policyBlockedRepeatCount = blockedByPolicy
    ? sameBlockedAction ? state.policyBlockedRepeatCount + 1 : 1
    : 0;
  const stopRepeatedPolicyAction = sameBlockedAction && state.policyBlockedRepeatCount >= 1;
  context.observer?.({
      phase: "decision",
      action: action.action,
      decisionSource: policyOverrodePlanner || planningRun.plannerFallback || planningRun.decisionSource === "policy" ? "policy" : "planner",
      ...(!planningRun.plannerFallback ? { proposedAction: proposedAction.action } : {}),
      ...(planningRun.plannerFallback ? { plannerFallback: planningRun.plannerFallback } : {}),
      decisionMode,
      elapsedMs: planningRun.decisionElapsedMs ?? 0,
      ok: planningRun.decisionOk ?? true,
      gatewayAttempts: planningRun.decisionGatewayAttempts ?? 0,
      policyBlocked: blockedByPolicy,
      ...(askPolicyOutcome ? { askPolicyOutcome } : {}),
      ...(policyReasonCodes.length ? { policyReasonCodes } : {}),
      targetTeam: action.action === "inspect_team" ? action.teamName : action.targetTeam ?? state.targetTeam,
  });
  if (stopRepeatedPolicyAction) {
    const fallback = emptyDecision(state.targetTeam);
    return new Command({
      update: {
        action: fallback,
        messages: [messageForRecruitmentAction(fallback, `guard-${state.decisionSteps}`)],
        decisionSteps: state.decisionSteps + 1,
        policyBlocked: false,
        policyBlockedRepeatCount: 0,
        policyLoopStopped: true,
        history: [
          { role: "assistant", content: JSON.stringify(fallback) },
          {
            role: "tool",
            toolName: "investigation_guard",
            content: "Agent 连续两次重复提出被调查策略拒绝的相同动作；已停止继续调用模型并只报告当前可验证证据。",
          },
        ],
      },
      goto: "review_recommendation",
    });
  }
  const update: Partial<State> = {
    action: stateAction,
    messages: [messageForRecruitmentAction(stateAction, `planner-${state.decisionSteps}-${stateAction.action}`)],
    decisionSteps: state.decisionSteps + 1,
    policyBlocked: blockedByPolicy,
    policyBlockedRepeatCount,
    candidateSearchCursorAdjustment: "candidateSearchCursorAdjustment" in enforced ? enforced.candidateSearchCursorAdjustment : null,
    ...(action.targetTeam ? { targetTeam: action.targetTeam } : {}),
    ...(action.action === "ask_user" && !endedTooEarly && !blockedByPolicy ? {
      pendingQuestion: questionForAskPolicy(action, input.askUserMode),
      responseMessage: input.askUserMode === "disabled"
        ? askPolicyDisabledPause.question
        : action.question,
    } : {}),
    history: [
      {
        role: "assistant",
        content: askPolicyOutcome === "suppressed"
          ? JSON.stringify({ action: "ask_user", suppressed: true })
          : JSON.stringify(action),
      },
      ...(askPolicyOutcome === "suppressed" ? [{
        role: "tool" as const,
        toolName: "ask_policy",
        content: "评测控制组关闭了追问能力；关键需求未解决，因此暂停并且不生成候选名单。",
      }] : []),
      ...(blockedByPolicy ? [{
        role: "tool" as const,
        toolName: "investigation_policy",
        content: policyFeedback.join(" "),
      }] : []),
    ],
  };
  return new Command({
    update,
    goto: blockedByPolicy
      ? "prepare_decision_snapshot"
      : stateAction.action === "ask_user"
        ? "wait_for_user"
        : stateAction.action === "finish"
          ? "review_recommendation"
          : "execute_tool",
  });
}

function policyCommand(
  state: State,
  action: ParsedRecruitmentAction,
  update: Partial<State> | undefined,
  history: State["history"] | undefined,
): Command {
  return new Command({
    update: {
      action,
      messages: [messageForRecruitmentAction(action, `policy-${state.decisionSteps}-${action.action}`)],
      decisionSteps: state.decisionSteps + 1,
      policyBlocked: false,
      policyBlockedRepeatCount: 0,
      history: history ?? [{ role: "assistant", content: JSON.stringify(action) }],
      ...update,
    },
    goto: action.action === "finish"
      ? "review_recommendation"
      : action.action === "ask_user"
        ? "wait_for_user"
        : "execute_tool",
  });
}
