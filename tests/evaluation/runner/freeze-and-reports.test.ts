import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { previewEvaluation } from "../../../evals/benchmark.js";
import { compareEvaluationReportFiles } from "../../../evals/report.js";
import { evaluationRunnerTest } from "../../fixtures/evaluation-runner-entry.js";

describe("evaluation freeze and report contracts", () => {
  afterEach(async () => {
    await evaluationRunnerTest.cleanup();
  });

  it("allows held-out preview but requires a freeze ID before dispatch", async () => {
    vi.stubEnv("OPENAI_API_KEY", "evaluation-freeze-test-key");
    vi.stubEnv("OPENAI_MODEL", "evaluation-freeze-test-model");
    vi.stubEnv("OPENAI_BASE_URL", "https://gateway.example.test/v1");

    const preview = previewEvaluation({
      caseIds: ["recommend-isak-real-heldout-v1"],
      mode: "smoke",
    });

    expect(preview.heldOutFreezeReady).toBeFalsy();
    expect(preview.freezeFingerprint).toMatch(
      /^scouting-eval-v1-[a-f0-9]{64}$/u
    );
    expect(
      previewEvaluation({
        caseIds: ["recommend-isak-real-heldout-v1"],
        freezeId: "arbitrary-freeze-name",
        mode: "smoke",
      }).heldOutFreezeReady
    ).toBeFalsy();
    expect(
      previewEvaluation({
        caseIds: ["recommend-isak-real-heldout-v1"],
        freezeId: preview.freezeFingerprint ?? undefined,
        mode: "smoke",
      }).heldOutFreezeReady
    ).toBeTruthy();

    await expect(
      evaluationRunnerTest.runEvaluation({
        caseIds: ["recommend-isak-real-heldout-v1"],
        maxModelRequests: 10,
        mode: "held_out",
        outputDirectory: ".data/evals/freeze-gate-test-runs",
        workspaceDirectory: ".data/evals/freeze-gate-test-work",
      })
    ).rejects.toThrow("Held-out cases require --freeze-id to match");
  });

  it("invalidates a held-out freeze fingerprint when the model changes", () => {
    vi.stubEnv("OPENAI_MODEL", "freeze-agent-v1");
    vi.stubEnv("OPENAI_BASE_URL", "https://gateway.example.test/v1");

    const initialPreview = previewEvaluation({
      caseIds: ["recommend-isak-real-heldout-v1"],
      mode: "smoke",
    });

    vi.stubEnv("OPENAI_MODEL", "freeze-agent-v2");

    const changedPreview = previewEvaluation({
      caseIds: ["recommend-isak-real-heldout-v1"],
      freezeId: initialPreview.freezeFingerprint ?? undefined,
      mode: "smoke",
    });

    expect({
      fingerprintChanged:
        changedPreview.freezeFingerprint !== initialPreview.freezeFingerprint,
      heldOutFreezeReady: changedPreview.heldOutFreezeReady,
    }).toStrictEqual({ fingerprintChanged: true, heldOutFreezeReady: false });
  });

  it("retains three isolated formal trials and compares only compatible report rows", async () => {
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

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-repeat-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      maxModelRequests: 50,
      mode: "development",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const reportPath = path.join(
      workspace,
      "reports",
      report.runId,
      "report.json"
    );

    const comparison = compareEvaluationReportFiles(reportPath, reportPath);

    const trialIds = new Set(
      report.trials.flatMap((trial) =>
        trial.observation.actionEvents.map(({ trialId }) => trialId)
      )
    );

    expect({
      codeStatuses: report.trials.map(({ codeStatus }) => codeStatus),
      comparisonHasCompatibleCoverage:
        comparison.includes("Compatible paired trials: 3") &&
        comparison.includes(
          "N/A: both runs need all reserved validation anchors"
        ),
      estimatedRequests: report.estimatedModelRequests,
      requestCount,
      runStatus: report.status,
      trialCount: report.trials.length,
      uniqueTrialIds: trialIds.size,
    }).toStrictEqual({
      codeStatuses: ["passed", "passed", "passed"],
      comparisonHasCompatibleCoverage: true,
      estimatedRequests: 45,
      requestCount: report.modelRequests,
      runStatus: "completed",
      trialCount: 3,
      uniqueTrialIds: 3,
    });
  }, 60_000);
});
