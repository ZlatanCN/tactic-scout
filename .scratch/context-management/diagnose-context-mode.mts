import "dotenv/config";
import { createLocalKnowledgeBase } from "../../src/knowledge/index.js";
import { localAgentEvaluationScenarios } from "../../src/evaluation/harness-scenarios.js";
import { runScenarioOnce } from "../../src/evaluation/local-agent-run.js";

const scenario = localAgentEvaluationScenarios.find(({ id }) => id === "barcelona-under-23-midfielder");
if (!scenario) throw new Error("Missing registered context-management scenario.");

const result = await runScenarioOnce(scenario, 1, createLocalKnowledgeBase(), {
  contextManagementMode: "evidence",
  suppressTraceOutput: true,
  suppressProgressOutput: true,
});

process.stdout.write(`${JSON.stringify({
  mode: result.contextManagementMode,
  finalStatus: result.finalStatus,
  allPassed: result.allPassed,
  failedChecks: Object.entries(result.checks).filter(([, passed]) => !passed).map(([name]) => name),
  errors: "errors" in result ? result.errors.map((error) => ({
    name: error.name,
    category: error.category,
    stage: error.stage,
    plannerResponseDiagnostics: error.plannerResponseDiagnostics ? {
      failure: error.plannerResponseDiagnostics.failure,
      toolCallProtocolFailure: error.plannerResponseDiagnostics.toolCallProtocolFailure,
      toolCallIssuePaths: error.plannerResponseDiagnostics.toolCallIssuePaths,
      toolCallIssueCodes: error.plannerResponseDiagnostics.toolCallIssueCodes,
    } : undefined,
  })) : [],
  plannerRequestAttempts: result.plannerRequestAttempts,
  toolCallCount: result.toolCallCount,
  reportGenerated: Boolean(result.report),
})}\n`);
