import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { previewEvaluation } from "../../../evals/benchmark.js";
import { evaluationRunnerTest } from "../../fixtures/evaluation-runner-entry.js";

describe("evaluation failure handling and prepared private evidence", () => {
  afterEach(async () => {
    await evaluationRunnerTest.cleanup();
  });

  it("records malformed model tool arguments without claiming a search ran", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "malformed_search"
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
      path.join(tmpdir(), "tactiscout-schema-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const caseDirectory = path.join(workspace, "cases");
    const evidenceDirectory = path.join(workspace, "evidence");
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const caseContents = readFileSync(
      path.join(process.cwd(), "evals/cases/lookup-smoke-v1.json"),
      "utf-8"
    ).replace(
      "请查一下 Elias Demo 的 FM 画像和表现资料。",
      "MALFORMED_TOOL_ARGS_TEST: 请查一下 Elias Demo 的 FM 画像和表现资料。"
    );

    const evidenceContents = readFileSync(
      path.join(process.cwd(), "evals/evidence/lookup-smoke-evidence-v1.json"),
      "utf-8"
    );

    writeFileSync(
      path.join(caseDirectory, "lookup-smoke-v1.json"),
      caseContents
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-smoke-evidence-v1.json"),
      evidenceContents
    );

    const report = await evaluationRunnerTest.runEvaluation({
      caseDirectory,
      caseIds: ["lookup-smoke-v1"],
      evidenceDirectory,
      maxModelRequests: 10,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      invalidCalls: trial?.observation.conversationContext.flatMap(
        ({ invalidToolCalls }) => invalidToolCalls.map(({ name }) => name)
      ),
      modelRequests: report.modelRequests,
      requestCount,
      schemaRejectedEvents: trial?.observation.actionEvents
        .flatMap(({ kind, name }) =>
          kind === "schema_rejected" ? [`${name}:${kind}`] : []
        )
        .toSorted(),
      searchToolMessages: trial?.observation.toolMessages.length,
    }).toStrictEqual({
      invalidCalls: ["search_player_records"],
      modelRequests: 2,
      requestCount: 2,
      schemaRejectedEvents: ["search_player_records:schema_rejected"],
      searchToolMessages: 0,
    });
  }, 30_000);

  it("records malformed request extraction as a failed trial, not a runtime error", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "malformed_extraction"
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
      path.join(tmpdir(), "tactiscout-missing-pending-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: ["lookup-identity-unavailable-v1"],
      maxModelRequests: 10,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "workspace"),
    });

    const [trial] = report.trials;

    expect(requestCount).toBeGreaterThan(0);
    expect({
      codeStatus: trial?.codeStatus,
      failureCategory: trial?.observation.failureCategory,
      status: trial?.status,
    }).toStrictEqual({
      codeStatus: "failed",
      failureCategory: "invalid_response",
      status: "failed",
    });
    expect(trial?.observation.error).toBeUndefined();
  }, 15_000);

  it("reuses a successful search result when the model repeats the same request", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "loop_search"
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
      path.join(tmpdir(), "tactiscout-guard-eval-")
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
      maxModelRequests: 10,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    const searchEvents =
      trial?.observation.actionEvents.filter(
        ({ name }) => name === "search_player_records"
      ) ?? [];

    expect({
      attempted: searchEvents.filter(({ kind }) => kind === "attempted").length,
      blocked: searchEvents.filter(({ kind }) => kind === "blocked").length,
      modelRequests: report.modelRequests,
      requestCount,
      requested: searchEvents.filter(({ kind }) => kind === "requested").length,
      returned: searchEvents.filter(({ kind }) => kind === "returned").length,
      toolMessageStatuses: trial?.observation.toolMessages.map(
        ({ status }) => status
      ),
    }).toStrictEqual({
      attempted: 1,
      blocked: 0,
      modelRequests: 4,
      requestCount: 4,
      requested: 2,
      returned: 1,
      toolMessageStatuses: ["success", "success"],
    });
  }, 15_000);

  it("runs prepared private real-source cases or reports preparation needs", async () => {
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

    const { port } = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(path.join(tmpdir(), "tactiscout-real-eval-"));

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);

    const caseIds = [
      "lookup-saka-real-v1",
      "lookup-haaland-real-v1",
      "lookup-bellingham-confirmation-real-v1",
      "lookup-mbappe-confirmation-real-v1",
      "lookup-kane-real-heldout-v1",
      "lookup-raphinha-confirmation-heldout-v1",
      "lookup-kane-followup-heldout-v1",
      "lookup-van-dijk-followup-heldout-v1",
      "compare-saka-haaland-real-v1",
      "compare-saka-foden-real-v1",
      "compare-haaland-foden-real-v1",
      "compare-saka-bellingham-cross-scope-real-v1",
      "compare-kane-musiala-heldout-v1",
      "compare-kane-van-dijk-cross-scope-heldout-v1",
      "compare-add-raphinha-heldout-v1",
      "compare-season-add-van-dijk-heldout-v1",
      "recommend-haaland-real-v1",
      "recommend-kane-real-v1",
      "recommend-ca-empty-real-v1",
      "recommend-add-haaland-kane-real-v1",
      "recommend-isak-real-heldout-v1",
      "recommend-ca-empty-real-heldout-v1",
      "recommend-add-isak-watkins-heldout-v1",
      "recommend-refine-young-isak-heldout-v1",
    ];

    const evidenceDirectory = path.join(process.cwd(), ".data/evals/evidence");

    const evidencePreview = previewEvaluation({
      caseIds,
      evidenceDirectory,
      mode: "smoke",
    });

    expect(
      evidencePreview.cases.every(
        ({ evidenceStatus }) =>
          evidenceStatus === "ready" ||
          evidenceStatus === "requires_preparation"
      )
    ).toBeTruthy();

    const requiredBundles = [
      "lookup-real-development-v1",
      "lookup-real-heldout-v1",
      "recommendation-real-development-v1",
      "recommendation-real-heldout-v1",
    ];

    const bundlesReady = requiredBundles.every((bundleId) =>
      existsSync(path.join(evidenceDirectory, `${bundleId}.json`))
    );

    if (!bundlesReady) {
      return;
    }

    const { freezeFingerprint } = evidencePreview;

    if (freezeFingerprint === null) {
      throw new Error(
        "The real-source fixture test needs a freeze fingerprint."
      );
    }

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds,
      evidenceDirectory,
      freezeId: freezeFingerprint,
      maxModelRequests: 250,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "workspace"),
    });

    const missingSeasonTrial = report.trials.find(
      ({ caseId }) => caseId === "lookup-mbappe-confirmation-real-v1"
    );

    const notFoundTrial = report.trials.find(
      ({ caseId }) => caseId === "lookup-kane-followup-heldout-v1"
    );

    const comparisonTrial = report.trials.find(
      ({ caseId }) => caseId === "compare-saka-haaland-real-v1"
    );

    const resetComparisonTrial = report.trials.find(
      ({ caseId }) => caseId === "compare-season-add-van-dijk-heldout-v1"
    );

    const resetTurn = resetComparisonTrial?.observation.turns.at(-1);

    const recommendationTrials = report.trials.filter(
      ({ workflow }) => workflow === "player_recommendation"
    );

    const recommendationFailures = recommendationTrials.flatMap((trial) =>
      trial.checks
        .filter(({ status }) => status === "failed")
        .map(({ actual, expected, id }) => ({
          actual,
          caseId: trial.caseId,
          expected,
          id,
        }))
    );

    if (recommendationFailures.length > 0) {
      throw new Error(JSON.stringify(recommendationFailures, null, 2));
    }

    expect({
      allPreparedFromRealSources: report.trials.every(
        ({ evidenceSourceMetadata, origin }) =>
          origin === "real" && evidenceSourceMetadata !== null
      ),
      caseCount: report.caseCount,
      comparisonActionStatus: comparisonTrial?.observation.actionEvents.find(
        ({ kind, name }) =>
          kind === "returned" && name === "compare_player_records"
      )?.outcome,
      comparisonCaseChecks: report.trials
        .filter(({ workflow }) => workflow === "player_comparison")
        .map(({ caseId, codeStatus }) => ({ caseId, codeStatus })),
      comparisonCodeStatus: comparisonTrial?.codeStatus,
      comparisonWorkflowCount: report.trials.filter(
        ({ workflow }) => workflow === "player_comparison"
      ).length,
      fakeGatewayRequests: requestCount,
      finalNotFoundIdentityStatus:
        notFoundTrial?.observation.players[0]?.resolutionStatus,
      finalNotFoundOutcome: notFoundTrial?.observation.outcomeStatus,
      freshComparisonCodeStatus: resetComparisonTrial?.codeStatus,
      freshComparisonConstraints: resetTurn?.effectiveConstraints,
      freshComparisonParticipants: resetTurn?.players.map(
        ({ mention }) => mention
      ),
      freshComparisonToolCount:
        resetComparisonTrial?.observation.actionEvents.filter(
          ({ kind, name }) =>
            kind === "returned" && name === "compare_player_records"
        ).length,
      missingSeasonActionOutcome:
        missingSeasonTrial?.observation.actionEvents.find(
          ({ kind, name }) =>
            kind === "returned" && name === "search_player_records"
        )?.outcome,
      missingSeasonActionValues: evaluationRunnerTest.evaluationCheckStatus(
        missingSeasonTrial,
        "expected-action-values"
      ),
      missingSeasonStatus: missingSeasonTrial?.status,
      modelRequests: report.modelRequests,
      preflightErrors: report.preflightErrors,
      previousLookupPreserved: notFoundTrial?.checks.find(
        ({ id }) => id === "active-lookup-preserved"
      )?.status,
      recommendationCaseChecks: recommendationTrials.map(
        ({ caseId, codeStatus, status }) => ({ caseId, codeStatus, status })
      ),
      recommendationWorkflowCount: recommendationTrials.length,
      runStatus: report.status,
      savedResultReuseTurns: report.trials
        .flatMap(({ observation }) => observation.turns)
        .filter(({ reuse }) => reuse?.kind === "saved_lookup_result").length,
      trialCount: report.trials.length,
      workflowCount: report.trials.filter(
        ({ workflow }) => workflow === "player_lookup"
      ).length,
    }).toStrictEqual({
      allPreparedFromRealSources: true,
      caseCount: 24,
      comparisonActionStatus: "ready",
      comparisonCaseChecks: [
        {
          caseId: "compare-saka-haaland-real-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-saka-foden-real-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-haaland-foden-real-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-saka-bellingham-cross-scope-real-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-kane-musiala-heldout-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-kane-van-dijk-cross-scope-heldout-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-add-raphinha-heldout-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-season-add-van-dijk-heldout-v1",
          codeStatus: "passed",
        },
      ],
      comparisonCodeStatus: "passed",
      comparisonWorkflowCount: 8,
      fakeGatewayRequests: requestCount,
      finalNotFoundIdentityStatus: "not_found",
      finalNotFoundOutcome: null,
      freshComparisonCodeStatus: "passed",
      freshComparisonConstraints: [{ name: "season", value: "2026/27" }],
      freshComparisonParticipants: ["Harry Kane", "Virgil van Dijk"],
      freshComparisonToolCount: 3,
      missingSeasonActionOutcome: "not_found",
      missingSeasonActionValues: "passed",
      missingSeasonStatus: "not_assessed",
      modelRequests: requestCount,
      preflightErrors: [],
      previousLookupPreserved: "passed",
      recommendationCaseChecks: [
        "recommend-haaland-real-v1",
        "recommend-kane-real-v1",
        "recommend-ca-empty-real-v1",
        "recommend-add-haaland-kane-real-v1",
        "recommend-isak-real-heldout-v1",
        "recommend-ca-empty-real-heldout-v1",
        "recommend-add-isak-watkins-heldout-v1",
        "recommend-refine-young-isak-heldout-v1",
      ].map((caseId) => ({
        caseId,
        codeStatus: "passed",
        status: "not_assessed",
      })),
      recommendationWorkflowCount: 8,
      runStatus: "completed",
      savedResultReuseTurns: 2,
      trialCount: 24,
      workflowCount: 8,
    });
  }, 180_000);
});
