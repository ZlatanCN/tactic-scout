import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { evaluationCaseSchema } from "../../../evals/contracts.js";
import { evaluationRunnerTest } from "../../fixtures/evaluation-runner-entry.js";

describe("semantic judge evidence contracts", () => {
  afterEach(async () => {
    await evaluationRunnerTest.cleanup();
  });

  it("keeps semantic scores unassessed when a reserved judge anchor is misclassified", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "judge_wrong_anchor"
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
      path.join(tmpdir(), "tactiscout-judge-calibration-fail-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 100,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    expect({
      calibrationStatus: report.judgeCalibration?.status,
      codeStatus: report.trials[0]?.codeStatus,
      judgeRequests: report.requestCountsByRole.judge,
      modelRequests: report.modelRequests,
      requestCount,
      semanticStatus: report.trials[0]?.semanticStatus,
      trialStatus: report.trials[0]?.status,
      validation: report.judgeCalibration?.validation,
    }).toStrictEqual({
      calibrationStatus: "failed",
      codeStatus: "passed",
      judgeRequests: 0,
      modelRequests: requestCount,
      requestCount,
      semanticStatus: "not_assessed",
      trialStatus: "not_assessed",
      validation: { passed: 15, total: 16 },
    });
  }, 30_000);

  it("fails a trial when the calibrated judge confirms an unsupported claim", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "judge_unsupported_finding"
      );
    });

    evaluationRunnerTest.servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-claim-eval-")
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

    const judgeExchange = trial?.gatewayExchanges.find(
      ({ role }) => role === "judge"
    );

    if (judgeExchange === undefined) {
      throw new Error("The trial did not record its judge request.");
    }

    const judgeInput = evaluationRunnerTest.judgeInputFromRequestBody(
      judgeExchange.requestBody
    );

    expect({
      actionEventIdsAreNamespaced: judgeInput.actions.every(({ eventId }) =>
        eventId.startsWith("action-event:")
      ),
      actionIdsAreNamespaced: judgeInput.actions.every(({ actionId }) =>
        actionId.startsWith("action:")
      ),
      calibration: report.judgeCalibration?.status,
      codeStatus: trial?.codeStatus,
      evidenceIdsAreNamespaced: judgeInput.evidence.every(({ evidenceId }) =>
        evidenceId.startsWith("evidence:")
      ),
      findingCategories: trial?.semanticFindings.map(
        ({ category }) => category
      ),
      semanticStatus: trial?.semanticStatus,
      status: trial?.status,
    }).toStrictEqual({
      actionEventIdsAreNamespaced: true,
      actionIdsAreNamespaced: true,
      calibration: "passed",
      codeStatus: "passed",
      evidenceIdsAreNamespaced: true,
      findingCategories: ["unsupported_fact"],
      semanticStatus: "failed",
      status: "failed",
    });
  }, 30_000);

  it("invalidates factual contradictions without evidence citations", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "judge_missing_contradiction_evidence"
      );
    });

    evaluationRunnerTest.servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-missing-evidence-eval-")
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
      calibration: report.judgeCalibration?.status,
      judgeRequests: report.requestCountsByRole.judge,
      semanticStatus: trial?.semanticStatus,
      status: trial?.status,
      validationErrors: trial?.semanticValidationErrors,
    }).toStrictEqual({
      calibration: "passed",
      judgeRequests: 2,
      semanticStatus: "invalid",
      status: "judge_invalid",
      validationErrors: ["contradiction_missing_evidence_reference"],
    });
  }, 30_000);

  it.each([
    "judge_self_denying_contradiction",
    "judge_supported_contradiction",
  ] as const)(
    "invalidates a contradiction finding whose explanation does not establish conflict: %s",
    async (judgeMode) => {
      let requestCount = 0;

      const gateway = createServer((request, response) => {
        requestCount += 1;
        void evaluationRunnerTest.handleGatewayRequest(
          request,
          response,
          requestCount,
          judgeMode
        );
      });

      evaluationRunnerTest.servers.push(gateway);
      gateway.listen(0, "127.0.0.1");
      await once(gateway, "listening");

      const address = z
        .object({ port: z.number().int().positive() })
        .parse(gateway.address());

      const workspace = mkdtempSync(
        path.join(tmpdir(), `tactiscout-${judgeMode}-`)
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
        calibration: report.judgeCalibration?.status,
        judgeRequests: report.requestCountsByRole.judge,
        semanticStatus: trial?.semanticStatus,
        status: trial?.status,
        validationErrors: trial?.semanticValidationErrors,
      }).toStrictEqual({
        calibration: "passed",
        judgeRequests: 2,
        semanticStatus: "invalid",
        status: "judge_invalid",
        validationErrors: ["contradiction_explanation_is_inconclusive"],
      });
    },
    30_000
  );

  it("rejects an action identifier placed in evidenceIds after one repair attempt", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "judge_action_id_in_evidence"
      );
    });

    evaluationRunnerTest.servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-action-as-evidence-eval-")
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

    const judgeExchange = trial?.gatewayExchanges.find(
      ({ role }) => role === "judge"
    );

    if (judgeExchange === undefined) {
      throw new Error("The trial did not record its judge request.");
    }

    const judgeInput = evaluationRunnerTest.judgeInputFromRequestBody(
      judgeExchange.requestBody
    );

    const [firstAction] = judgeInput.actions;

    if (firstAction === undefined) {
      throw new Error("The judge request did not contain an action.");
    }

    expect({
      actionIdIsNamespaced: firstAction.actionId.startsWith("action:"),
      judgeRequests: report.requestCountsByRole.judge,
      semanticStatus: trial?.semanticStatus,
      status: trial?.status,
      validationErrors: trial?.semanticValidationErrors,
    }).toStrictEqual({
      actionIdIsNamespaced: true,
      judgeRequests: 2,
      semanticStatus: "invalid",
      status: "judge_invalid",
      validationErrors: [`unknown_evidence:${firstAction.actionId}`],
    });
  }, 30_000);

  it("retries a judge quote-validation error once and stays invalid if it persists", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "judge_invalid_quote"
      );
    });

    evaluationRunnerTest.servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-invalid-eval-")
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
      calibration: report.judgeCalibration?.status,
      codeStatus: trial?.codeStatus,
      judgeRequests: report.requestCountsByRole.judge,
      semanticStatus: trial?.semanticStatus,
      status: trial?.status,
      validationErrors: trial?.semanticValidationErrors,
    }).toStrictEqual({
      calibration: "passed",
      codeStatus: "passed",
      judgeRequests: 2,
      semanticStatus: "invalid",
      status: "judge_invalid",
      validationErrors: ["quote_not_found:lookup-smoke-v1-turn-1"],
    });
  }, 30_000);

  it("repairs a judge quote-validation error when the corrected judgment is valid", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "judge_invalid_quote_repaired"
      );
    });

    evaluationRunnerTest.servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-quote-repair-eval-")
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

    expect(report.requestCountsByRole.judge).toBe(2);

    expect({
      calibration: report.judgeCalibration?.status,
      judgeRequests: report.requestCountsByRole.judge,
      semanticStatus: trial?.semanticStatus,
      status: trial?.status,
      validationErrors: trial?.semanticValidationErrors,
    }).toStrictEqual({
      calibration: "passed",
      judgeRequests: 2,
      semanticStatus: "passed",
      status: "passed",
      validationErrors: [],
    });
  }, 30_000);

  it("keeps undelivered required evidence inconclusive", async () => {
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

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-undelivered-evidence-eval-")
    );

    const caseDirectory = path.join(workspace, "cases");
    const evidenceDirectory = path.join(workspace, "evidence");

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const sourceCase = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "evals/cases/lookup-identity-unavailable-v1.json"
          ),
          "utf-8"
        )
      )
    );

    const evidenceContents = readFileSync(
      path.join(process.cwd(), "evals/evidence/lookup-smoke-evidence-v1.json"),
      "utf-8"
    );

    const caseWithRequiredEvidence = {
      ...sourceCase,
      contract: {
        ...sourceCase.contract,
        requiredEvidence: [
          {
            field: "currentAbility",
            provider: "fm" as const,
            sourceId: "fm-demo-01",
            value: 132,
          },
        ],
      },
    };

    writeFileSync(
      path.join(caseDirectory, "lookup-identity-unavailable-v1.json"),
      JSON.stringify(caseWithRequiredEvidence)
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-smoke-evidence-v1.json"),
      evidenceContents
    );

    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);

    const report = await evaluationRunnerTest.runEvaluation({
      caseDirectory,
      caseIds: ["lookup-identity-unavailable-v1"],
      evidenceDirectory,
      includeSemanticJudge: true,
      maxModelRequests: 100,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      judgeRequests: report.requestCountsByRole.judge,
      semanticStatus: trial?.semanticStatus,
      validationErrors: trial?.semanticValidationErrors,
    }).toStrictEqual({
      judgeRequests: 1,
      semanticStatus: "inconclusive",
      validationErrors: ["required_evidence_not_delivered"],
    });
  }, 30_000);

  it("enforces one total request cap across agent and judge calibration roles", async () => {
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
      path.join(tmpdir(), "tactiscout-judge-budget-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 34,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    expect({
      calibrationStatus: report.judgeCalibration?.status,
      deniedCalibration: report.deniedRequestsByRole.calibration,
      deniedRequests: report.deniedRequests,
      forwardedCalibration: report.requestCountsByRole.calibration,
      modelRequests: report.modelRequests,
      reportStatus: report.status,
      requestCount,
      semanticStatus: report.trials[0]?.semanticStatus,
      trialStatus: report.trials[0]?.status,
    }).toStrictEqual({
      calibrationStatus: "incomplete",
      deniedCalibration: 1,
      deniedRequests: 1,
      forwardedCalibration: 31,
      modelRequests: 34,
      reportStatus: "partial",
      requestCount: 34,
      semanticStatus: "not_assessed",
      trialStatus: "not_assessed",
    });
  }, 30_000);
});
