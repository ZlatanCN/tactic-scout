import { Command, type Runtime } from "@langchain/langgraph";
import { expansionEvidenceIsSufficient, expansionPlannerFallback } from "../conclusion-policy.js";
import { RecruitmentActionSchema } from "../recruitment-actions.js";
import { emitProgress } from "./progress.js";
import type { State } from "./state.js";
import { requirePlanningRun } from "./planning-run.js";
import {
  type RecruitmentRuntimeContext,
  requireRecruitmentRuntimeContext,
} from "./runtime-context.js";

/**
 * Chooses only actions that can be established from hard case facts.
 * Model-dependent decisions stay in plan_decision.
 */
export function createPolicyGateNode(input: {
  expansionSufficiencyEnabled?: boolean;
}) {
  return async (
    state: State,
    runtime: Runtime<RecruitmentRuntimeContext>,
  ): Promise<Command> => {
    const context = requireRecruitmentRuntimeContext(runtime.context);
    const planningRun = requirePlanningRun(context, state);
    const required = planningRun.requiredAction;
    if (required) {
      planningRun.policyAction = required.action;
      return new Command({ goto: "validate_decision" });
    }

    const snapshot = planningRun.snapshot;
    const decisionContext = planningRun.decisionContext;
    if (!snapshot || !decisionContext) {
      throw new Error("The policy gate requires a prepared decision snapshot and decision context.");
    }
    if (input.expansionSufficiencyEnabled !== false
      && snapshot.caps.stage === "expand"
      && decisionContext.decisionConstraints
      && decisionContext.expansionConstraints
      && expansionEvidenceIsSufficient(decisionContext.decisionConstraints)) {
      const action = expansionPlannerFallback({
        decisionConstraints: decisionContext.decisionConstraints,
        expansionConstraints: decisionContext.expansionConstraints,
        outcome: "sufficient",
      });
      planningRun.policyAction = RecruitmentActionSchema.parse(action);
      return new Command({ goto: "validate_decision" });
    }
    return new Command({ goto: "plan_decision" });
  };
}
