import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { previewEvaluation } from "../../../evals/benchmark.js";
import { evaluationRunnerTest } from "../../fixtures/evaluation-runner-entry.js";

describe("semantic judge calibration", () => {
  afterEach(async () => {
    await evaluationRunnerTest.cleanup();
  });

  it("calibrates the semantic judge and scores a real graph trial through the shared entry", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount
      );
    });

    evaluationRunnerTest.servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const preview = previewEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      mode: "smoke",
    });

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 100,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      anchorCounts: {
        development: report.judgeCalibration?.development,
        validation: report.judgeCalibration?.validation,
      },
      anchorPriorTuningExposure:
        report.judgeCalibration?.anchorPriorTuningExposure,
      anchorVersion: report.judgeCalibration?.anchorVersion,
      calibrationRequests: report.requestCountsByRole.calibration,
      calibrationStatus: report.judgeCalibration?.status,
      calibrationTelemetry: {
        inputTokens: report.tokenUsageByRole.calibration.promptTokensReported,
        outputTokens:
          report.tokenUsageByRole.calibration.completionTokensReported,
        requestsWithLatency:
          report.latencyByRole.calibration.requestsWithLatency,
        responsesWithUsage:
          report.tokenUsageByRole.calibration.responsesWithUsage,
      },
      judgeEnabled: preview.judgeEnabled && report.judgeEnabled,
      judgePromptVersion: report.judgeCalibration?.judgePromptVersion,
      judgeRequests: report.requestCountsByRole.judge,
      modelRequests: report.modelRequests,
      requestCount,
      retiredValidationAnchorIds:
        report.judgeCalibration?.retiredValidationAnchorIds,
      rubricVersion: report.judgeCalibration?.rubricVersion,
      semanticStatus: trial?.semanticStatus,
      status: trial?.status,
      trialRequestsByRole: trial?.modelRequestsByRole,
    }).toStrictEqual({
      anchorCounts: {
        development: { passed: 16, total: 16 },
        validation: { passed: 16, total: 16 },
      },
      anchorPriorTuningExposure:
        "Version 9 adds an explicit application source rule for the fixed-date FM snapshot after V41 exposed a judge false positive. It distinguishes the general snapshot property from a specific date claim. A reserved validation anchor confirms that an exact date is supported when the evidence supplies it. V41 is exposed and is not reused.",
      anchorVersion: "scouting-judge-anchors-v9",
      calibrationRequests: 32,
      calibrationStatus: "passed",
      calibrationTelemetry: {
        inputTokens: 768,
        outputTokens: 384,
        requestsWithLatency: 32,
        responsesWithUsage: 32,
      },
      judgeEnabled: true,
      judgePromptVersion: "scouting-semantic-judge-v24",
      judgeRequests: 1,
      modelRequests: requestCount,
      requestCount,
      retiredValidationAnchorIds: [
        "unsupported-fact-08-v1",
        "factual-contradiction-08-v1",
        "false-execution-claim-07-v1",
        "unsupported-fact-05-v1",
        "factual-contradiction-overlap-08-v3",
        "correct-paraphrase-05-v1",
        "correct-paraphrase-06-v1",
        "correct-paraphrase-07-v1",
        "correct-paraphrase-08-v1",
        "factual-contradiction-05-v1",
        "factual-contradiction-06-v1",
        "factual-contradiction-07-v1",
        "unsupported-fact-09-v4",
        "unsupported-fact-06-v1",
        "unsupported-fact-07-v1",
        "false-execution-claim-05-v1",
        "false-execution-claim-06-v1",
        "false-execution-claim-08-v1",
        "unsupported-fact-08-v2",
        "factual-contradiction-09-v4",
        "false-execution-claim-overlap-07-v3",
        "correct-paraphrase-06-v5",
      ],
      rubricVersion: "scouting-evaluation-rubric-v3",
      semanticStatus: "passed",
      status: "passed",
      trialRequestsByRole: {
        agent: trial?.modelRequestsByRole.agent,
        calibration: 0,
        judge: 1,
      },
    });
  }, 30_000);

  it("retries one transient judge 5xx within the calibration request budget", async () => {
    let requestCount = 0;
    const gatewayState = { judgeFailuresRemaining: 1, judgeRequests: 0 };

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "judge_transient_server_error",
        gatewayState
      );
    });

    evaluationRunnerTest.servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-transient-retry-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 100,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      calibrationRequests: report.requestCountsByRole.calibration,
      calibrationStatus: report.judgeCalibration?.status,
      judgeRequests: report.requestCountsByRole.judge,
      modelRequests: report.modelRequests,
      requestCount,
      semanticStatus: trial?.semanticStatus,
      transientFailuresLeft: gatewayState.judgeFailuresRemaining,
      trialStatus: trial?.status,
    }).toStrictEqual({
      calibrationRequests: 33,
      calibrationStatus: "passed",
      judgeRequests: 1,
      modelRequests: requestCount,
      requestCount,
      semanticStatus: "passed",
      transientFailuresLeft: 0,
      trialStatus: "passed",
    });
  }, 30_000);

  it("counts a judge repair and transient retry within three total attempts", async () => {
    let requestCount = 0;
    const gatewayState = { judgeFailuresRemaining: 1, judgeRequests: 0 };

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "judge_invalid_quote_repaired_after_transient",
        gatewayState
      );
    });

    evaluationRunnerTest.servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-repair-retry-budget-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 100,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      calibrationStatus: report.judgeCalibration?.status,
      judgeRequests: report.requestCountsByRole.judge,
      semanticStatus: trial?.semanticStatus,
      status: trial?.status,
      transientFailuresLeft: gatewayState.judgeFailuresRemaining,
      validationErrors: trial?.semanticValidationErrors,
    }).toStrictEqual({
      calibrationStatus: "passed",
      judgeRequests: 3,
      semanticStatus: "passed",
      status: "passed",
      transientFailuresLeft: 0,
      validationErrors: [],
    });
  }, 30_000);
});
