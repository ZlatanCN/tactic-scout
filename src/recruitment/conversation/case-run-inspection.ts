import type { StateSnapshot } from "@langchain/langgraph";
import type { State } from "./state.js";

const graphNodeNames = new Set([
  "record_user_turn",
  "understand_request",
  "prepare_decision_snapshot",
  "policy_gate",
  "plan_decision",
  "validate_decision",
  "execute_tool",
  "wait_for_user",
  "review_recommendation",
  "enrich_external_signals",
  "enrich_historical_archive",
  "deliver_recommendation",
  "record_runtime_failure",
]);

export type CaseRunCheckpointInspection = {
  checkpointId: string;
  step: number;
  nextNodes: string[];
  interrupted: boolean;
  safeSummary: {
    action?: string;
    stage?: string;
    candidateCount?: number;
    evaluatedCount?: number;
    failureKind?: string;
  };
};

export type CaseRunInspection = { checkpoints: CaseRunCheckpointInspection[] };

function safeSnapshot(snapshot: StateSnapshot): CaseRunCheckpointInspection {
  const values = snapshot.values as Partial<State> | undefined;
  const stepValue = snapshot.metadata?.step;
  const step = typeof stepValue === "number" && Number.isSafeInteger(stepValue) ? stepValue : 0;
  const checkpointValue = snapshot.config.configurable?.checkpoint_id;
  const checkpointId = typeof checkpointValue === "string" && /^[a-z0-9-]{1,100}$/i.test(checkpointValue)
    ? checkpointValue
    : `step-${step}`;
  const nextNodes = snapshot.next.filter(node => graphNodeNames.has(node)).slice(0, 8);
  const stage = nextNodes[0];
  const safeSummary: CaseRunCheckpointInspection["safeSummary"] = {};
  if (values?.action?.action) safeSummary.action = values.action.action;
  if (stage) safeSummary.stage = stage;
  if (values?.discoveredPlayers && typeof values.discoveredPlayers === "object") {
    safeSummary.candidateCount = Math.min(Object.keys(values.discoveredPlayers).length, 100_000);
  }
  if (values?.evaluatedPlayers && typeof values.evaluatedPlayers === "object") {
    safeSummary.evaluatedCount = Math.min(Object.keys(values.evaluatedPlayers).length, 100_000);
  }
  if (values?.runtimeFailure) safeSummary.failureKind = values.runtimeFailure.category;
  return {
    checkpointId,
    step,
    nextNodes,
    interrupted: snapshot.tasks.some(task => task.interrupts.length > 0),
    safeSummary,
  };
}

export function projectCaseRunHistory(snapshots: Iterable<StateSnapshot>, limit = 20): CaseRunInspection {
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 20;
  const checkpoints = [...snapshots]
    .map(safeSnapshot)
    .sort((left, right) => left.step - right.step || left.checkpointId.localeCompare(right.checkpointId))
    .slice(-boundedLimit);
  return { checkpoints };
}
