import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLocalKnowledgeBase } from "../../src/knowledge/index.js";
import { localAgentEvaluationScenarios } from "../../src/evaluation/harness-scenarios.js";
import { runScenarioOnce } from "../../src/evaluation/local-agent-run.js";

const scenario = localAgentEvaluationScenarios.find(({ id }) => id === "barcelona-under-23-midfielder");
if (!scenario) throw new Error("Missing registered context-management scenario.");

const result = await runScenarioOnce(scenario, 1, createLocalKnowledgeBase(), {
  contextManagementMode: process.argv[2] === "legacy" ? "legacy" : "summarized",
  contextStressTurns: 20,
  suppressTraceOutput: true,
  suppressProgressOutput: true,
});

const traceByTurn = result.trace.flatMap((event) => {
  if (event.phase === "decision") return [{
    turn: event.turn,
    phase: event.phase,
    action: event.action ?? null,
    proposedAction: event.proposedAction ?? null,
    policyBlocked: event.policyBlocked ?? false,
    policyReasonCodes: event.policyReasonCodes ?? [],
    decisionSource: event.decisionSource ?? null,
  }];
  if (event.phase === "tool") return [{
    turn: event.turn,
    phase: event.phase,
    toolName: event.toolName,
    ok: event.ok,
    resultCount: event.resultCount,
    errorCode: event.errorCode ?? null,
  }];
  if (event.phase === "brief_failure") return [{
    turn: event.turn,
    phase: event.phase,
    failureKind: event.failureKind,
    failureCode: event.failureCode ?? null,
    failureStatus: event.failureStatus ?? null,
  }];
  if (["brief_usage", "model_usage", "summary_usage"].includes(event.phase)) return [{
    turn: event.turn,
    phase: event.phase,
    outcome: event.outcome ?? null,
    callPhase: event.callPhase ?? null,
    contextStatus: event.contextStatus ?? null,
  }];
  return [];
});

const output = {
  experiment: "context-report-retention-reproduction-v1",
  model: process.env.OPENAI_MODEL ?? null,
  scenario: scenario.id,
  contextMode: result.contextManagementMode,
  allPassed: result.allPassed,
  failedChecks: Object.entries(result.checks).filter(([, passed]) => !passed).map(([check]) => check),
  firstTurnStatus: result.firstTurnStatus,
  finalStatus: result.finalStatus,
  reportGenerated: Boolean(result.report),
  recommendationCount: result.report?.recommendations.length ?? null,
  contextStressTurnsRequested: result.contextStressTurnsRequested,
  contextStressTurnsAttempted: result.contextStressTurnsAttempted,
  contextStressTurnsCompleted: result.contextStressTurnsCompleted,
  turns: result.contextStressTurnMatrix.map(({ turn, checks, allPassed }) => ({
    turn,
    allPassed,
    completedWithReport: checks.completedWithReport,
    failedChecks: Object.entries(checks).filter(([, passed]) => !passed).map(([check]) => check),
  })),
  traceByTurn,
  candidatePages: result.trace.flatMap(event => event.phase === "tool" && event.toolName === "search_candidates" ? [{
    turn: event.turn ?? null,
    ok: event.ok,
    offset: event.filters.offset ?? null,
    nextOffset: event.filters.nextOffset ?? null,
    limit: event.filters.limit ?? null,
    resultCount: event.resultCount,
    matchingRecordCount: event.matchingRecordCount ?? null,
    position: event.filters.position ?? null,
    maxAge: event.filters.maxAge ?? null,
    discoveryMetricGroups: event.filters.discoveryMetricGroups ?? null,
  }] : []),
  modelUsage: result.modelUsage,
  elapsedMs: result.elapsedMs,
};

const outputPath = path.resolve(`.data/evaluations/context-report-retention-repro-${Date.now()}.json`);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ ...output, artifact: outputPath })}\n`);
if (output.turns.some((turn) => !turn.completedWithReport)) process.exitCode = 1;
