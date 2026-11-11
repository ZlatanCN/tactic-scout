import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { previewEvaluation } from "../../../evals/benchmark.js";
import { evaluationReportSchema } from "../../../evals/contracts.js";
import { evaluationRunnerTest } from "../../fixtures/evaluation-runner-entry.js";

describe("evaluation lookup graph trial", () => {
  afterEach(async () => {
    await evaluationRunnerTest.cleanup();
  });

  it("runs the real lookup graph with fixed source evidence under its request allowance", async () => {
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

    const workspace = mkdtempSync(path.join(tmpdir(), "tactiscout-eval-"));
    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const preview = previewEvaluation({
      caseIds: [
        "lookup-smoke-v1",
        "lookup-identity-unavailable-v1",
        "lookup-followup-smoke-v1",
        "lookup-identity-clarification-v1",
      ],
      includeSemanticJudge: true,
      mode: "smoke",
    });

    expect({
      caseIds: preview.cases.map(({ caseId }) => caseId),
      categories: preview.cases.map(({ category }) => category),
      estimatedModelRequests: preview.estimatedModelRequests,
      evidenceStatuses: preview.cases.map(
        ({ evidenceStatus }) => evidenceStatus
      ),
      modelConfigurationReady: preview.modelConfigurationReady,
      requestCount,
      sourceProcessingAllowed: preview.sourceProcessingAllowed,
      trials: preview.trials,
    }).toStrictEqual({
      caseIds: [
        "lookup-smoke-v1",
        "lookup-identity-unavailable-v1",
        "lookup-followup-smoke-v1",
        "lookup-identity-clarification-v1",
      ],
      categories: ["ordinary", "boundary", "multi_turn", "multi_turn"],
      estimatedModelRequests: 213,
      evidenceStatuses: ["ready", "ready", "ready", "ready"],
      modelConfigurationReady: true,
      requestCount: 0,
      sourceProcessingAllowed: true,
      trials: 4,
    });

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: [
        "lookup-smoke-v1",
        "lookup-identity-unavailable-v1",
        "lookup-followup-smoke-v1",
        "lookup-identity-clarification-v1",
      ],
      maxModelRequests: 30,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "workspace"),
    });

    const [
      lookupTrial,
      unavailableTrial,
      followupTrial,
      identityClarificationTrial,
    ] = report.trials;

    if (
      lookupTrial === undefined ||
      unavailableTrial === undefined ||
      followupTrial === undefined ||
      identityClarificationTrial === undefined
    ) {
      throw new Error(
        "The evaluation did not return all selected trial results."
      );
    }

    expect({
      actionEvents: lookupTrial.observation.actionEvents.map(
        ({ kind, name, outcome, sourceRecords, turnId }) => ({
          kind,
          name,
          outcome,
          sourceRecords: sourceRecords.map(({ provider, sourceId }) => ({
            provider,
            sourceId,
          })),
          turnId,
        })
      ),
      checkIds: lookupTrial.checks.map(({ id }) => id),
      codeStatus: lookupTrial.codeStatus,
      deliveredEvidence: lookupTrial.observation.deliveredEvidence.map(
        ({ provider, sourceId, turnId }) => ({ provider, sourceId, turnId })
      ),
      executedTools: lookupTrial.observation.toolMessages.map(
        ({ name, status }) => ({ name, status })
      ),
      followupActionEvents: followupTrial.observation.actionEvents.map(
        ({ kind, name, outcome, turnId }) => ({ kind, name, outcome, turnId })
      ),
      followupIdentityStatus:
        followupTrial.observation.players[0]?.resolutionStatus,
      followupOutcome: followupTrial.observation.outcomeStatus,
      followupStatus: followupTrial.status,
      followupTurnEvidence: followupTrial.observation.turns.map(
        ({
          clarificationAnswers,
          clarificationKinds,
          deliveredEvidenceIds,
          reuse,
          turnId,
        }) => ({
          clarificationAnswers,
          clarificationKinds,
          evidenceCount: deliveredEvidenceIds.length,
          reuseKind: reuse?.kind ?? null,
          turnId,
        })
      ),
      identityClarification: identityClarificationTrial.observation.turns.map(
        ({
          clarificationAnswers,
          clarificationKinds,
          players,
          reuse,
          turnId,
        }) => ({
          clarificationAnswers,
          clarificationKinds,
          identityStatus: players[0]?.resolutionStatus,
          reuseKind: reuse?.kind ?? null,
          turnId,
        })
      ),
      identityClarificationCheck: identityClarificationTrial.checks.find(
        ({ id }) => id === "turn-identity-continuity"
      )?.status,
      identityClarificationOutcome:
        identityClarificationTrial.observation.outcomeStatus,
      identityClarificationStatus: identityClarificationTrial.status,
      latencyByRole: {
        agent: report.latencyByRole.agent.requestsWithLatency,
        calibration: report.latencyByRole.calibration.requestsWithLatency,
        judge: report.latencyByRole.judge.requestsWithLatency,
      },
      modelRequests: report.modelRequests,
      observationError: lookupTrial.observation.error ?? null,
      requestCount,
      requestCountsByRole: report.requestCountsByRole,
      semanticStatus: lookupTrial.semanticStatus,
      sourceRecords: lookupTrial.sourceRecords,
      status: lookupTrial.status,
      tokenUsageByRole: report.tokenUsageByRole.agent,
      unavailableChecks: unavailableTrial.checks.map(({ id, status }) => ({
        id,
        status,
      })),
      unavailableOutcome: unavailableTrial.observation.outcomeStatus,
      unavailableReply:
        unavailableTrial.observation.conversationContext.at(-1)?.content,
      unavailableStatus: unavailableTrial.status,
      workflow: lookupTrial.workflow,
    }).toStrictEqual({
      actionEvents: [
        {
          kind: "attempted",
          name: "search_player_records",
          outcome: null,
          sourceRecords: [
            { provider: "fm", sourceId: "fm-demo-01" },
            { provider: "understat", sourceId: "us-demo-01" },
          ],
          turnId: "lookup-smoke-v1-turn-1",
        },
        {
          kind: "returned",
          name: "search_player_records",
          outcome: "found",
          sourceRecords: [
            { provider: "fm", sourceId: "fm-demo-01" },
            { provider: "understat", sourceId: "us-demo-01" },
          ],
          turnId: "lookup-smoke-v1-turn-1",
        },
        {
          kind: "requested",
          name: "search_player_records",
          outcome: null,
          sourceRecords: [
            { provider: "fm", sourceId: "fm-demo-01" },
            { provider: "understat", sourceId: "us-demo-01" },
          ],
          turnId: "lookup-smoke-v1-turn-1",
        },
      ],
      checkIds: [
        "task-kind",
        "task-outcome",
        "identity-resolution-status",
        "resolved-identity",
        "identity-lookup-observations",
        "lookup-result",
        "required-evidence",
      ],
      codeStatus: "passed",
      deliveredEvidence: [
        {
          provider: "fm",
          sourceId: "fm-demo-01",
          turnId: "lookup-smoke-v1-turn-1",
        },
        {
          provider: "understat",
          sourceId: "us-demo-01",
          turnId: "lookup-smoke-v1-turn-1",
        },
      ],
      executedTools: [{ name: "search_player_records", status: "success" }],
      followupActionEvents: [
        {
          kind: "attempted",
          name: "search_player_records",
          outcome: null,
          turnId: "lookup-followup-smoke-v1-turn-1",
        },
        {
          kind: "returned",
          name: "search_player_records",
          outcome: "found",
          turnId: "lookup-followup-smoke-v1-turn-1",
        },
        {
          kind: "requested",
          name: "search_player_records",
          outcome: null,
          turnId: "lookup-followup-smoke-v1-turn-1",
        },
        {
          kind: "attempted",
          name: "search_player_records",
          outcome: null,
          turnId: "lookup-followup-smoke-v1-turn-2",
        },
        {
          kind: "returned",
          name: "search_player_records",
          outcome: "found",
          turnId: "lookup-followup-smoke-v1-turn-2",
        },
        {
          kind: "requested",
          name: "search_player_records",
          outcome: null,
          turnId: "lookup-followup-smoke-v1-turn-2",
        },
      ],
      followupIdentityStatus: "resolved",
      followupOutcome: "answer_ready",
      followupStatus: "not_assessed",
      followupTurnEvidence: [
        {
          clarificationAnswers: [{ kind: "identity", value: "1" }],
          clarificationKinds: ["identity"],
          evidenceCount: 2,
          reuseKind: null,
          turnId: "lookup-followup-smoke-v1-turn-1",
        },
        {
          clarificationAnswers: [],
          clarificationKinds: [],
          evidenceCount: 2,
          reuseKind: null,
          turnId: "lookup-followup-smoke-v1-turn-2",
        },
      ],
      identityClarification: [
        {
          clarificationAnswers: [{ kind: "identity", value: "1" }],
          clarificationKinds: ["identity"],
          identityStatus: "resolved",
          reuseKind: null,
          turnId: "lookup-identity-clarification-v1-turn-1",
        },
        {
          clarificationAnswers: [],
          clarificationKinds: [],
          identityStatus: "saved_result_reuse",
          reuseKind: "saved_lookup_result",
          turnId: "lookup-identity-clarification-v1-turn-2",
        },
        {
          clarificationAnswers: [],
          clarificationKinds: [],
          identityStatus: "data_unavailable",
          reuseKind: null,
          turnId: "lookup-identity-clarification-v1-turn-3",
        },
      ],
      identityClarificationCheck: "passed",
      identityClarificationOutcome: "identity_data_unavailable",
      identityClarificationStatus: "not_assessed",
      latencyByRole: { agent: 16, calibration: 0, judge: 0 },
      modelRequests: 16,
      observationError: null,
      requestCount: 16,
      requestCountsByRole: { agent: 16, calibration: 0, judge: 0 },
      semanticStatus: "not_assessed",
      sourceRecords: [
        { provider: "fm", sourceId: "fm-demo-01" },
        { provider: "understat", sourceId: "us-demo-01" },
      ],
      status: "not_assessed",
      tokenUsageByRole: {
        completionTokensReported: 192,
        deniedRequests: 0,
        dispatchedRequests: 16,
        modelIds: ["eval-fixture-model"],
        promptTokensReported: 384,
        responsesWithCompletionTokens: 16,
        responsesWithPromptTokens: 16,
        responsesWithTotalTokens: 16,
        responsesWithUsage: 16,
        responsesWithoutUsage: 0,
        totalTokensReported: 576,
      },
      unavailableChecks: [
        { id: "task-kind", status: "passed" },
        { id: "task-outcome", status: "passed" },
        { id: "identity-resolution-status", status: "passed" },
        { id: "resolved-identity", status: "passed" },
        { id: "identity-lookup-observations", status: "passed" },
        { id: "lookup-result", status: "passed" },
        { id: "required-evidence", status: "passed" },
      ],
      unavailableOutcome: "identity_data_unavailable",
      unavailableReply: "无法确认“Elias Demo”对应的球员身份，本次查询已暂停。",
      unavailableStatus: "not_assessed",
      workflow: "player_lookup",
    });

    let savedReportJson: unknown;

    try {
      savedReportJson = JSON.parse(
        readFileSync(
          path.join(workspace, "reports", report.runId, "report.json"),
          "utf-8"
        )
      );
    } catch {
      throw new Error("The evaluation did not persist a valid JSON report.");
    }

    const savedReport = evaluationReportSchema.parse(savedReportJson);

    const savedMarkdown = readFileSync(
      path.join(workspace, "reports", report.runId, "report.md"),
      "utf-8"
    );

    const markdownContainsEvaluationDetails = [
      "Expected vs observed checks",
      "Evidence delivered to the model",
      "search_player_records",
      "Calibration tokens reported",
      "Agent request latency",
    ].every((text) => savedMarkdown.includes(text));

    expect({
      markdownContainsCase:
        savedMarkdown.includes("lookup-smoke-v1") &&
        savedMarkdown.includes("lookup-identity-unavailable-v1"),
      markdownContainsEvaluationDetails,
      savedRunId: savedReport.runId,
      savedStatus: savedReport.trials[0]?.status,
    }).toStrictEqual({
      markdownContainsCase: true,
      markdownContainsEvaluationDetails: true,
      savedRunId: report.runId,
      savedStatus: "not_assessed",
    });

    const limitedReport = await evaluationRunnerTest.runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      maxModelRequests: 2,
      mode: "smoke",
      outputDirectory: path.join(workspace, "limited-reports"),
      workspaceDirectory: path.join(workspace, "limited-workspace"),
    });

    expect({
      deniedRequests: limitedReport.deniedRequests,
      deniedRequestsByRole: limitedReport.deniedRequestsByRole,
      fakeGatewayRequests: requestCount,
      modelRequests: limitedReport.modelRequests,
      status: limitedReport.trials[0]?.status,
    }).toStrictEqual({
      deniedRequests: 1,
      deniedRequestsByRole: { agent: 1, calibration: 0, judge: 0 },
      fakeGatewayRequests: 18,
      modelRequests: 2,
      status: "budget_exhausted",
    });

    const abortController = new AbortController();
    abortController.abort();

    const cancelledReport = await evaluationRunnerTest.runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      maxModelRequests: 3,
      mode: "smoke",
      outputDirectory: path.join(workspace, "cancelled-reports"),
      signal: abortController.signal,
      workspaceDirectory: path.join(workspace, "cancelled-workspace"),
    });

    const cancelledPersistedStatus = evaluationReportSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            workspace,
            "cancelled-reports",
            cancelledReport.runId,
            "report.json"
          ),
          "utf-8"
        )
      )
    ).status;

    const alteredDefinitions = path.join(workspace, "altered-definitions");
    const caseDirectory = path.join(alteredDefinitions, "cases");
    const evidenceDirectory = path.join(alteredDefinitions, "evidence");
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const sourceCase = z
      .looseObject({ evidenceBundleSha256: z.string() })
      .parse(
        JSON.parse(
          readFileSync(
            path.join(process.cwd(), "evals/cases/lookup-smoke-v1.json"),
            "utf-8"
          )
        )
      );

    const sourceEvidence = readFileSync(
      path.join(process.cwd(), "evals/evidence/lookup-smoke-evidence-v1.json"),
      "utf-8"
    );

    writeFileSync(
      path.join(caseDirectory, "lookup-smoke-v1.json"),
      JSON.stringify({ ...sourceCase, evidenceBundleSha256: "0".repeat(64) })
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-smoke-evidence-v1.json"),
      sourceEvidence
    );

    const tamperedFixtureReport = await evaluationRunnerTest.runEvaluation({
      caseDirectory,
      caseIds: ["lookup-smoke-v1"],
      evidenceDirectory,
      maxModelRequests: 3,
      mode: "smoke",
      outputDirectory: path.join(workspace, "tampered-reports"),
      workspaceDirectory: path.join(workspace, "tampered-workspace"),
    });

    expect({
      cancellation: {
        fakeGatewayRequests: requestCount,
        persistedStatus: cancelledPersistedStatus,
        status: cancelledReport.status,
        trialStatus: cancelledReport.trials[0]?.status,
      },
      tamperedFixture: {
        fakeGatewayRequests: requestCount,
        modelRequests: tamperedFixtureReport.modelRequests,
        preflightErrors: tamperedFixtureReport.preflightErrors,
        status: tamperedFixtureReport.status,
        trialStatus: tamperedFixtureReport.trials[0]?.status,
      },
    }).toStrictEqual({
      cancellation: {
        fakeGatewayRequests: 18,
        persistedStatus: "partial",
        status: "partial",
        trialStatus: "not_run",
      },
      tamperedFixture: {
        fakeGatewayRequests: 18,
        modelRequests: 0,
        preflightErrors: ["lookup-smoke-v1:EvidencePreflightError"],
        status: "partial",
        trialStatus: "preflight_error",
      },
    });
  }, 60_000);
});
