import { toolBudgets } from "../recruitment/recruitment-actions.js";

export interface EvaluationRunSummaryInput {
  checks: Record<string, boolean>;
  elapsedMs: number;
  operationLatencySamples?: readonly EvaluationOperationLatencySample[];
}

export type EvaluationOperationLatencySample = {
  kind: "planner_action" | "policy_decision" | "tool";
  operation: string;
  elapsedMs: number;
};

const knownToolOperations = new Set(Object.keys(toolBudgets));
const knownPlannerOperations = new Set([
  "ask_user",
  "finish",
  "investigate",
  "expand",
  "expand_recovery",
  "reorient",
  "conclude",
  "unresolved",
  ...knownToolOperations,
]);

export interface EvaluationRunSummary {
  runCount: number;
  passedRunCount: number;
  passRate: number;
  failedRunsByCheck: Record<string, number>;
  latencyMs: { p50: number; p95: number };
  operationLatencyMs: Array<{
    kind: "planner_action" | "tool";
    operation: string;
    sampleCount: number;
    p50: number;
    p95: number;
  }>;
}

function nearestRankPercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]!;
}

export function summarizeEvaluationRuns(runs: readonly EvaluationRunSummaryInput[]): EvaluationRunSummary {
  if (runs.length === 0) throw new Error("At least one evaluation run is required.");
  if (runs.some(({ checks }) => Object.keys(checks).length === 0)) {
    throw new Error("Every evaluation run must include at least one check.");
  }
  if (runs.some(({ elapsedMs }) => !Number.isFinite(elapsedMs) || elapsedMs < 0)) {
    throw new Error("Evaluation elapsed time must be a finite non-negative number.");
  }
  const operationLatencySamples = runs.flatMap(({ operationLatencySamples: samples }) => samples ?? []);
  if (operationLatencySamples.some((sample) => !sample
    || !["planner_action", "policy_decision", "tool"].includes(sample.kind)
    || typeof sample.operation !== "string"
    || (sample.kind === "tool"
      ? !knownToolOperations.has(sample.operation)
      : sample.operation !== "unresolved" && !knownPlannerOperations.has(sample.operation))
    || !Number.isFinite(sample.elapsedMs)
    || sample.elapsedMs < 0)) {
    throw new Error("Operation latency samples must have a supported kind and operation name, and a finite non-negative duration.");
  }

  const checkNames = new Set(runs.flatMap(({ checks }) => Object.keys(checks)));
  const failedRunsByCheck: Record<string, number> = {};
  for (const name of checkNames) {
    const failedCount = runs.filter(({ checks }) => checks[name] !== true).length;
    if (failedCount > 0) failedRunsByCheck[name] = failedCount;
  }
  const passedRunCount = runs.filter(({ checks }) => [...checkNames].every((name) => checks[name] === true)).length;
  const elapsedTimes = runs.map(({ elapsedMs }) => elapsedMs);
  const samplesByOperation = new Map<string, { kind: "planner_action" | "tool"; operation: string; elapsedMs: number[] }>();
  for (const sample of operationLatencySamples) {
    if (sample.kind === "policy_decision") continue;
    const key = JSON.stringify([sample.kind, sample.operation]);
    const group = samplesByOperation.get(key) ?? { kind: sample.kind, operation: sample.operation, elapsedMs: [] };
    group.elapsedMs.push(sample.elapsedMs);
    samplesByOperation.set(key, group);
  }
  const operationLatencyMs = [...samplesByOperation.values()]
    .sort((left, right) => left.kind < right.kind ? -1 : left.kind > right.kind ? 1
      : left.operation < right.operation ? -1 : left.operation > right.operation ? 1 : 0)
    .map(({ kind, operation, elapsedMs: values }) => ({
      kind,
      operation,
      sampleCount: values.length,
      p50: nearestRankPercentile(values, 0.5),
      p95: nearestRankPercentile(values, 0.95),
    }));

  return {
    runCount: runs.length,
    passedRunCount,
    passRate: passedRunCount / runs.length,
    failedRunsByCheck,
    latencyMs: {
      p50: nearestRankPercentile(elapsedTimes, 0.5),
      p95: nearestRankPercentile(elapsedTimes, 0.95),
    },
    operationLatencyMs,
  };
}
