import "dotenv/config";
import { createLocalKnowledgeBase } from "../../src/knowledge/index.js";
import { createWebSearchKnowledgeRepository } from "../../src/knowledge/web-player-report-search.js";
import { localAgentEvaluationScenarios } from "../../src/evaluation/harness-scenarios.js";
import { runScenarioOnce } from "../../src/evaluation/local-agent-run.js";
const scenario = localAgentEvaluationScenarios.find(({ id }) => id === "barcelona-under-23-midfielder");
if (!scenario) throw new Error("scenario missing");
const result = await runScenarioOnce(scenario, 1, createWebSearchKnowledgeRepository(createLocalKnowledgeBase()), { suppressTraceOutput: true, suppressProgressOutput: true });
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  model: process.env.OPENAI_MODEL,
  scenario: scenario.id,
  allPassed: result.allPassed,
  finalStatus: result.finalStatus,
  checks: result.checks,
  modelUsage: result.modelUsage,
  toolCallCount: result.toolCallCount,
  report: result.report ? {
    recommendationCount: result.report.recommendations.length,
    recommendationPositions: result.report.recommendations.map(({position}) => position),
    evaluatedCandidateCount: result.report.evaluatedCandidateCount,
    methodologyChunksRetrieved: result.report.methodologyChunksRetrieved,
    requestedCapabilityCount: result.report.requestedCapabilityCoverage.length,
    limitationCount: result.report.limitations.length
  } : null,
  errors: "errors" in result ? result.errors.map(({name, category, code, status, stage, plannerResponseDiagnostics}) => ({name, category, code, status, stage, plannerResponseDiagnostics})) : [],
  trace: result.trace.map(event => ({
    phase: event.phase,
    stage: "stage" in event ? event.stage : undefined,
    toolName: "toolName" in event ? event.toolName : undefined,
    action: "action" in event ? event.action : undefined,
    outcome: "outcome" in event ? event.outcome : undefined,
    resultCount: "resultCount" in event ? event.resultCount : undefined,
    failure: "failure" in event ? event.failure : undefined,
    failureKind: "failureKind" in event ? event.failureKind : undefined,
    issuePaths: "issuePaths" in event ? event.issuePaths : undefined
  })),
  progressStages: result.progress.map(event => ({stage: event.stage, status: event.status}))
}));
