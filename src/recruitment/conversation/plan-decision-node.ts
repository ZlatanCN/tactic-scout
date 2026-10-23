import { createHash } from "node:crypto";
import { Command, type LangGraphRunnableConfig, type Runtime } from "@langchain/langgraph";
import {
  conclusionPlannerOutputFallback,
  expansionPlannerFallback,
  buildDecisionConstraints,
} from "../conclusion-policy.js";
import {
  RecruitmentModelTimeoutError,
  RecruitmentPlannerOutputError,
} from "../recruitment-planner.js";
import { messageForRecruitmentAction, parseRecruitmentPlannerOutput, type RecruitmentPlannerOutput } from "../recruitment-tools.js";
import { emptyDecision } from "../recruitment-actions.js";
import {
  isModelGatewayAttemptBudgetExhausted,
  isModelGatewayAttemptLimitError,
} from "../../platform/model-gateway-attempt-budget.js";
import type { State } from "./state.js";
import { emitProgress } from "./progress.js";
import { requirePlanningRun, type PlanningRunState } from "./planning-run.js";
import { knowledgeEvidenceAccessContext } from "./knowledge-evidence-context.js";
import {
  type RecruitmentRuntimeContext,
  requireRecruitmentRuntimeContext,
} from "./runtime-context.js";

class EvidenceInvestigationBudgetExceededError extends Error {
  constructor() {
    super("The bounded evidence investigation budget is exhausted.");
    this.name = "EvidenceInvestigationBudgetExceededError";
  }
}

export async function runWithinEvidenceDeadline<T>(input: {
  operation: (signal: AbortSignal) => Promise<T>;
  parentSignal?: AbortSignal;
  remainingMs: number;
}): Promise<T> {
  if (input.remainingMs <= 0) throw new EvidenceInvestigationBudgetExceededError();
  const deadlineController = new AbortController();
  const signal = input.parentSignal
    ? AbortSignal.any([input.parentSignal, deadlineController.signal])
    : deadlineController.signal;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      deadlineController.abort();
      reject(new EvidenceInvestigationBudgetExceededError());
    }, input.remainingMs);
  });
  try {
    return await Promise.race([input.operation(signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Calls the Planner only after policy_gate has decided that a model choice is
 * genuinely required. The raw proposal remains transient until validate_decision
 * has checked it against hard case constraints.
 */
export function createPlanDecisionNode() {
  return async (
    state: State,
    runtime: Runtime<RecruitmentRuntimeContext>,
  ): Promise<Command> => {
    const context = requireRecruitmentRuntimeContext(runtime.context);
    const config = runtime as LangGraphRunnableConfig;
    const planningRun = requirePlanningRun(context, state);
    const snapshot = planningRun.snapshot;
    const decisionContext = planningRun.decisionContext;
    if (!snapshot || !decisionContext || planningRun.policyAction) {
      throw new Error("plan_decision requires a model-stage decision with no policy-selected action.");
    }
    const planner = context.planner;
    const decisionMode = snapshot.caps.stage;
    const decisionContextValue = decisionContext;
    const plannerInput = decisionContextValue.plannerInput;
    const gatewayDispatchRequired = planner.requiresGatewayDispatch?.(plannerInput) ?? true;
    planningRun.decisionSource = gatewayDispatchRequired ? "planner" : "policy";
    const plannerFinalSynthesis = planner.isFinalSynthesis?.(plannerInput) ?? false;
    const fallbackDecisionConstraints = decisionContextValue.decisionConstraints ?? (plannerFinalSynthesis
      ? buildDecisionConstraints({
        targetTeam: snapshot.case.targetTeam,
        brief: snapshot.case.brief,
        includeAbilityProfiles: snapshot.case.abilityProfilesEnabled,
        confirmedPosition: snapshot.case.confirmedPosition,
        confirmedPositions: snapshot.case.confirmedPositions,
        userMessages: snapshot.history.filter(({ role }) => role === "user").map(({ content }) => content),
        evaluatedPlayers: Object.values(decisionContextValue.eligibleEvaluatedPlayers) as Parameters<typeof buildDecisionConstraints>[0]["evaluatedPlayers"],
        retrievedKnowledge: Object.values(state.retrievedKnowledge),
        candidateIdentityGroups: snapshot.candidates.identityGroups,
      })
      : undefined);
    const investigationLedger = context.knowledgeEvidence?.investigations;
    let investigationId = state.ragInvestigationId;
    let plannerDeadlineMs: number | null = null;
    let plannerGatewayAttempts = 0;
    const decisionStartedAt = performance.now();
    let reportGenerationRecorded = false;
    const recordDecisionMetrics = (ok: boolean) => {
      planningRun.decisionElapsedMs = Math.round(performance.now() - decisionStartedAt);
      planningRun.decisionGatewayAttempts = plannerGatewayAttempts;
      planningRun.decisionOk = ok;
    };
    if (plannerFinalSynthesis && investigationId) investigationLedger?.finish(investigationId);
    if (plannerFinalSynthesis) {
      const startedAt = performance.now();
      const recordReportGeneration = (plannerFallback?: NonNullable<PlanningRunState["plannerFallback"]>) => {
        if (reportGenerationRecorded) return;
        reportGenerationRecorded = true;
        context.observer?.({
          phase: "report_generation",
          elapsedMs: Math.round(performance.now() - startedAt),
          gatewayAttempts: plannerGatewayAttempts,
          decisionMode,
          ...(plannerFallback ? { plannerFallback } : {}),
        });
      };
      planningRun.reportGenerationStartedAt = startedAt;
      planningRun.recordReportGeneration = recordReportGeneration;
    }
    if (investigationLedger && decisionMode === "investigate" && gatewayDispatchRequired) {
      investigationId ??= knowledgeEvidenceAccessContext(config, state, "recruitment").investigationId ?? null;
      if (investigationId) {
        investigationLedger.begin(investigationId);
        const ledgerState = investigationLedger.snapshot(investigationId);
        if (ledgerState?.status !== "active") {
          plannerDeadlineMs = null;
        } else {
        const phase = ledgerState && ledgerState.round === 2 && ledgerState.followupQueryCount === 0
          ? "gap_check"
          : "planner";
        const reservation = investigationLedger.reserveGatewayAttempt(
          investigationId,
          phase,
          createHash("sha256").update(JSON.stringify([decisionMode, state.decisionSteps, state.history.length, Object.keys(state.retrievedKnowledge).sort()])).digest("hex"),
        );
        if (reservation.kind === "blocked") {
          planningRun.policyAction = {
            ...emptyDecision(snapshot.case.targetTeam),
            needSummary: "资料综合调查达到预算上限；只保留本轮已取得并核验的证据。",
            limitationKeys: ["other"],
            methodologyClaims: [],
            reportObservations: [],
          };
          planningRun.decisionSource = "policy";
          recordDecisionMetrics(false);
          return new Command({
            update: {
              ragInvestigationId: investigationId,
              ragInvestigationBudgetExhausted: true,
              history: [{ role: "tool" as const, toolName: "investigation_budget", content: "资料调查已达到调用或时间上限；保留已核验证据并停止外呼。" }],
            },
            goto: "validate_decision",
          });
        }
        plannerGatewayAttempts += 1;
        plannerDeadlineMs = reservation.remainingMs;
        }
      }
    }
    const budgetedInvestigationId = plannerDeadlineMs !== null ? investigationId : null;
    let modelAction: RecruitmentPlannerOutput;
    let plannerFallback: "expansion_timeout" | "expansion_output_limit" | "conclusion_timeout" | "conclusion_output_limit" | undefined;
    emitProgress(config, {
      stage: "planning",
      status: "started",
      message: state.evaluationKnowledgeQa ? "正在根据已有资料规划下一步" : "正在按当前调查证据规划下一步",
      completedSteps: state.decisionSteps,
    });
    const stopForEvidenceBudget = (): Command => {
      const safeAction = fallbackDecisionConstraints
        ? conclusionPlannerOutputFallback(fallbackDecisionConstraints, { reason: "timeout" })
        : {
          ...emptyDecision(snapshot.case.targetTeam),
          needSummary: "资料综合调查达到预算上限；只保留本轮已取得并核验的证据。",
          limitationKeys: ["other" as const],
          methodologyClaims: [],
          reportObservations: [],
        };
      planningRun.policyAction = safeAction;
      if (investigationId) investigationLedger?.finish(investigationId, "failed");
      planningRun.decisionSource = "policy";
      recordDecisionMetrics(false);
      emitProgress(config, {
        stage: "planning",
        status: "notice",
        message: "资料调查已达到调用或时间上限，正在使用已有证据收束",
        completedSteps: state.decisionSteps,
      });
      return new Command({
        update: {
          ragInvestigationBudgetExhausted: true,
          ...(investigationId ? { ragInvestigationId: investigationId } : {}),
          history: [{
            role: "tool" as const,
            toolName: "investigation_budget",
            content: "资料综合调查达到预算上限；保留此前已经检索并核验的引用，不再外呼。缺失事实继续标为未知。",
          }],
        },
        goto: "validate_decision",
      });
    };
    const plannerRequestHash = createHash("sha256").update(JSON.stringify([
      decisionMode,
      state.decisionSteps,
      state.history.length,
      Object.keys(state.retrievedKnowledge).sort(),
    ])).digest("hex");
    let usageResponseCount = 0;
    let retryReservations = 0;
    let reportedUsageAttempts = 0;
    const originalUsageObserver = plannerInput.onTokenUsage;
    const boundedPlannerInput = {
      ...plannerInput,
      onTokenUsage: (usage: Parameters<NonNullable<typeof plannerInput.onTokenUsage>>[0]) => {
        if (usageResponseCount > 0) {
          if (retryReservations > 0) retryReservations -= 1;
          else if (budgetedInvestigationId && investigationLedger) {
            const dispatch = investigationLedger.reserveGatewayAttempt(
              budgetedInvestigationId,
              "planner",
              createHash("sha256").update(plannerRequestHash + "\nmodel-response:" + usageResponseCount).digest("hex"),
            );
            if (dispatch.kind === "blocked") throw new EvidenceInvestigationBudgetExceededError();
            plannerGatewayAttempts += 1;
          } else plannerGatewayAttempts += 1;
        } else if (retryReservations > 0) {
          retryReservations -= 1;
        }
        if (!usageResponseCount && !plannerGatewayAttempts) plannerGatewayAttempts += 1;
        usageResponseCount += 1;
        const gatewayAttempts = Math.max(0, plannerGatewayAttempts - reportedUsageAttempts);
        reportedUsageAttempts = plannerGatewayAttempts;
        originalUsageObserver?.({ ...usage, gatewayAttempts });
      },
    };
    try {
      const callPlanner = (signal: AbortSignal | undefined) => planner.decide({
        ...boundedPlannerInput,
        signal,
        onModelRetry: ({ attempt, maxRetries, reason }) => {
          if (budgetedInvestigationId && investigationLedger) {
            const dispatch = investigationLedger.reserveGatewayAttempt(
              budgetedInvestigationId,
              "planner",
              createHash("sha256").update(plannerRequestHash + "\nretry:" + attempt + ":" + reason).digest("hex"),
            );
            if (dispatch.kind === "blocked") throw new EvidenceInvestigationBudgetExceededError();
            plannerGatewayAttempts += 1;
            retryReservations += 1;
          } else {
            plannerGatewayAttempts += 1;
            retryReservations += 1;
          }
          const cause = reason === "rate_limit" ? "模型服务正在限流" : reason === "request_timeout" ? "模型服务响应超时" : reason === "server_error" ? "模型服务暂时异常" : "模型连接中断";
          emitProgress(config, { stage: "planning", status: "notice", message: `${cause}，系统自动重试（${attempt}/${maxRetries}）`, completedSteps: state.decisionSteps });
        },
      });
      if (!plannerGatewayAttempts && gatewayDispatchRequired) plannerGatewayAttempts = 1;
      modelAction = plannerDeadlineMs === null
        ? await callPlanner(runtime.signal)
        : await runWithinEvidenceDeadline({ operation: callPlanner, parentSignal: runtime.signal, remainingMs: plannerDeadlineMs });
    } catch (error) {
      if (error instanceof EvidenceInvestigationBudgetExceededError) return stopForEvidenceBudget();
      if (isModelGatewayAttemptLimitError(error) || isModelGatewayAttemptBudgetExhausted()) {
        const safeAction = emptyDecision(snapshot.case.targetTeam);
        planningRun.policyAction = safeAction;
        if (investigationId) investigationLedger?.finish(investigationId, "failed");
        planningRun.decisionSource = "policy";
        recordDecisionMetrics(false);
        return new Command({
          update: {
            ...(investigationId ? { ragInvestigationId: investigationId } : {}),
            ragInvestigationBudgetExhausted: true,
            history: [{
              role: "tool" as const,
              toolName: "investigation_budget",
              content: "本次应用请求的模型调用上限已到；保留已经核验的资料，并把缺少的证据标为未知。",
            }],
          },
          goto: "validate_decision",
        });
      }
      if (error instanceof RecruitmentModelTimeoutError
        && (decisionMode === "expand" || decisionMode === "expand_recovery")
        && decisionContextValue.decisionConstraints
        && decisionContextValue.expansionConstraints) {
        plannerFallback = "expansion_timeout";
        modelAction = messageForRecruitmentAction(expansionPlannerFallback({
          decisionConstraints: decisionContextValue.decisionConstraints,
          expansionConstraints: decisionContextValue.expansionConstraints,
        }), `fallback-${state.decisionSteps}-expansion-timeout`);
        emitProgress(config, {
          stage: "planning",
          status: "notice",
          message: "扩页模型规划超时，系统按能力证据缺口继续调查",
          completedSteps: state.decisionSteps,
        });
      } else if (error instanceof RecruitmentPlannerOutputError
        && (decisionMode === "expand" || decisionMode === "expand_recovery")
        && error.diagnostics.finishReason === "length"
        && decisionContextValue.decisionConstraints
        && decisionContextValue.expansionConstraints) {
        plannerFallback = "expansion_output_limit";
        modelAction = messageForRecruitmentAction(expansionPlannerFallback({
          decisionConstraints: decisionContextValue.decisionConstraints,
          expansionConstraints: decisionContextValue.expansionConstraints,
        }), `fallback-${state.decisionSteps}-expansion-output-limit`);
        emitProgress(config, {
          stage: "planning",
          status: "notice",
          message: "扩页模型达到输出上限，系统按当前证据继续调查",
          completedSteps: state.decisionSteps,
        });
      } else if (error instanceof RecruitmentModelTimeoutError
        && (decisionMode === "conclude" || decisionMode === "reorient" || plannerFinalSynthesis)
        && fallbackDecisionConstraints) {
        plannerFallback = "conclusion_timeout";
        modelAction = messageForRecruitmentAction(conclusionPlannerOutputFallback(
          fallbackDecisionConstraints,
          { reason: "timeout" },
        ), `fallback-${state.decisionSteps}-conclusion-timeout`);
        emitProgress(config, {
          stage: "planning",
          status: "notice",
          message: "报告规划超时，系统按已复核的比赛证据整理有限结论",
          completedSteps: state.decisionSteps,
        });
      } else if (error instanceof RecruitmentPlannerOutputError
        && (decisionMode === "conclude" || decisionMode === "reorient" || plannerFinalSynthesis)
        && error.diagnostics.finishReason === "length"
        && fallbackDecisionConstraints) {
        plannerFallback = "conclusion_output_limit";
        modelAction = messageForRecruitmentAction(
          conclusionPlannerOutputFallback(fallbackDecisionConstraints),
          `fallback-${state.decisionSteps}-conclusion-output-limit`,
        );
        emitProgress(config, {
          stage: "planning",
          status: "notice",
          message: "报告模型达到输出上限，系统按已复核的比赛证据整理结论",
          completedSteps: state.decisionSteps,
        });
      } else {
        planningRun.recordReportGeneration?.();
        delete planningRun.recordReportGeneration;
        recordDecisionMetrics(false);
        context.observer?.({
          phase: "decision",
          action: null,
          decisionSource: "planner",
          proposedAction: null,
          decisionMode,
          elapsedMs: Math.round(performance.now() - decisionStartedAt),
          ok: false,
          gatewayAttempts: plannerGatewayAttempts,
          targetTeam: snapshot.case.targetTeam,
        });
        throw error;
      }
    }
    const parsed = parseRecruitmentPlannerOutput(
      modelAction,
      snapshot.caps.availableActions,
      snapshot.case.targetTeam,
    );
    planningRun.proposedAction = parsed.action;
    planningRun.plannerFallback = plannerFallback;
    if (planningRun.recordReportGeneration) {
      planningRun.recordReportGeneration(plannerFallback);
    }
    delete planningRun.recordReportGeneration;
    planningRun.decisionContext = {
      ...decisionContextValue,
      plannerInput: {
        ...plannerInput,
        ...(plannerFallback ? { caseProgress: undefined } : {}),
      },
    };
    recordDecisionMetrics(true);
    return new Command({
      update: {
        ...(parsed.nativeMessage ? { messages: [parsed.nativeMessage] } : {}),
        ...(investigationId ? { ragInvestigationId: investigationId } : {}),
        ...(plannerFallback ? {
          history: [{
            role: "tool" as const,
            toolName: "investigation_policy",
            content: plannerFallback === "expansion_timeout"
              ? "扩页 Planner 未及时返回；系统按确定性的精确下一页或当前证据收束。"
              : plannerFallback === "expansion_output_limit"
                ? "扩页 Planner 达到输出长度上限；系统按确定性的精确下一页或当前证据收束。"
                : plannerFallback === "conclusion_timeout"
                  ? "结论 Planner 未及时返回；系统只保留已复核证据并安全收束。"
                  : "结论 Planner 达到输出长度上限；系统只保留已复核证据并安全收束。",
          }],
        } : {}),
      },
      goto: "validate_decision",
    });
  };
}
