import { Command, type LangGraphRunnableConfig, type Runtime } from "@langchain/langgraph";
import {
  conclusionPlannerOutputFallback,
  expansionPlannerFallback,
} from "../conclusion-policy.js";
import {
  RecruitmentModelTimeoutError,
  RecruitmentPlannerOutputError,
} from "../recruitment-planner.js";
import { messageForRecruitmentAction, parseRecruitmentPlannerOutput, type RecruitmentPlannerOutput } from "../recruitment-tools.js";
import type { State } from "./state.js";
import { emitProgress } from "./progress.js";
import { requirePlanningRun } from "./planning-run.js";
import {
  type RecruitmentRuntimeContext,
  requireRecruitmentRuntimeContext,
} from "./runtime-context.js";

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
    const decisionStartedAt = performance.now();
    let modelAction: RecruitmentPlannerOutput;
    let plannerFallback: "expansion_timeout" | "expansion_output_limit" | "conclusion_timeout" | "conclusion_output_limit" | undefined;
    emitProgress(config, {
      stage: "planning",
      status: "started",
      message: "正在按当前调查证据规划下一步",
      completedSteps: state.decisionSteps,
    });
    try {
      modelAction = await planner.decide({ ...plannerInput, signal: runtime.signal });
    } catch (error) {
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
        && (decisionMode === "conclude" || decisionMode === "reorient")
        && decisionContextValue.decisionConstraints) {
        plannerFallback = "conclusion_timeout";
        modelAction = messageForRecruitmentAction(conclusionPlannerOutputFallback(
          decisionContextValue.decisionConstraints,
          { reason: "timeout" },
        ), `fallback-${state.decisionSteps}-conclusion-timeout`);
        emitProgress(config, {
          stage: "planning",
          status: "notice",
          message: "报告规划超时，系统按已复核的比赛证据整理有限结论",
          completedSteps: state.decisionSteps,
        });
      } else if (error instanceof RecruitmentPlannerOutputError
        && (decisionMode === "conclude" || decisionMode === "reorient")
        && error.diagnostics.finishReason === "length"
        && decisionContextValue.decisionConstraints) {
        plannerFallback = "conclusion_output_limit";
        modelAction = messageForRecruitmentAction(
          conclusionPlannerOutputFallback(decisionContextValue.decisionConstraints),
          `fallback-${state.decisionSteps}-conclusion-output-limit`,
        );
        emitProgress(config, {
          stage: "planning",
          status: "notice",
          message: "报告模型达到输出上限，系统按已复核的比赛证据整理结论",
          completedSteps: state.decisionSteps,
        });
      } else {
        context.observer?.({
          phase: "decision",
          action: null,
          decisionSource: "planner",
          proposedAction: null,
          decisionMode,
          elapsedMs: Math.round(performance.now() - decisionStartedAt),
          ok: false,
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
    planningRun.decisionContext = {
      ...decisionContextValue,
      plannerInput: {
        ...plannerInput,
        ...(plannerFallback ? { caseProgress: undefined } : {}),
      },
    };
    return new Command({
      update: {
        ...(parsed.nativeMessage ? { messages: [parsed.nativeMessage] } : {}),
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
