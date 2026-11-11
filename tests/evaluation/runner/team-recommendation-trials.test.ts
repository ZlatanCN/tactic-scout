import { once } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { previewEvaluation } from "../../../evals/benchmark.js";
import { evaluationRunnerTest } from "../../fixtures/evaluation-runner-entry.js";

describe("evaluation team recommendation trials", () => {
  afterEach(async () => {
    await evaluationRunnerTest.cleanup();
  });

  it("runs a fixed API-Football roster through its real adapter and the complete team graph", async () => {
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

    const workspace = mkdtempSync(path.join(tmpdir(), "tactiscout-team-eval-"));

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: ["team-rec-synthetic-v1"],
      maxModelRequests: 30,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect(
      trial?.checks.filter(({ status }) => status === "failed")
    ).toStrictEqual([]);
    expect({
      actionEvents: trial?.observation.actionEvents
        .filter(({ kind }) => kind === "returned")
        .map(({ name, outcome, sourceRecords }) => ({
          name,
          outcome,
          sourceRecords: sourceRecords.map(({ provider, sourceId }) => ({
            provider,
            sourceId,
          })),
        })),
      apiFootballCapture: trial?.evidenceSourceMetadata?.apiFootball,
      clarification: trial?.observation.turns[0]?.clarificationAnswers,
      codeStatus: trial?.codeStatus,
      modelRequests: report.modelRequests,
      requestCount,
      status: trial?.status,
    }).toStrictEqual({
      actionEvents: [
        {
          name: "api_football.search_teams",
          outcome: "ok",
          sourceRecords: [{ provider: "api_football", sourceId: "team:901" }],
        },
        {
          name: "api_football.get_squad",
          outcome: "ok",
          sourceRecords: [
            { provider: "api_football", sourceId: "team:901" },
            { provider: "api_football", sourceId: "player:501" },
            { provider: "api_football", sourceId: "player:502" },
          ],
        },
        {
          name: "resolve_team_roster_identity",
          outcome: "resolved",
          sourceRecords: [
            { provider: "api_football", sourceId: "player:501" },
            { provider: "fm", sourceId: "fm-ref-01" },
          ],
        },
        {
          name: "resolve_team_roster_identity",
          outcome: "needs_confirmation",
          sourceRecords: [
            { provider: "api_football", sourceId: "player:502" },
            { provider: "fm", sourceId: "fm-close-01" },
          ],
        },
        {
          name: "recommend_team_player_candidates",
          outcome: "ready",
          sourceRecords: [
            { provider: "api_football", sourceId: "team:901" },
            { provider: "fm", sourceId: "fm-close-01" },
            { provider: "fm", sourceId: "fm-far-01" },
            { provider: "fm", sourceId: "fm-future-01" },
            { provider: "fm", sourceId: "fm-ref-01" },
          ],
        },
      ],
      apiFootballCapture: {
        capturedAt: "2025-11-20T12:00:00.000Z",
        requestedTeams: [],
        sourceRequests: null,
        teamIds: [901],
      },
      clarification: [{ kind: "team_roster_profile", value: "1" }],
      codeStatus: "passed",
      modelRequests: requestCount,
      requestCount,
      status: "not_assessed",
    });
  }, 60_000);

  it("covers ambiguous teams, unmapped roster members, and saved-squad refinements", async () => {
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
      path.join(tmpdir(), "tactiscout-team-boundary-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const caseIds = [
      "team-rec-synthetic-v1",
      "team-rec-ambiguous-team-synthetic-v1",
      "team-rec-unmapped-roster-synthetic-v1",
      "team-rec-refine-synthetic-v1",
    ];

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds,
      maxModelRequests: 120,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    expect(
      report.trials.flatMap((trial) =>
        trial.checks
          .filter(({ status }) => status === "failed")
          .map(({ actual, expected, id }) => ({
            actual,
            caseId: trial.caseId,
            expected,
            id,
          }))
      )
    ).toStrictEqual([]);

    const ambiguousTeamTrial = report.trials.find(
      ({ caseId }) => caseId === "team-rec-ambiguous-team-synthetic-v1"
    );

    const noProfileTrial = report.trials.find(
      ({ caseId }) => caseId === "team-rec-unmapped-roster-synthetic-v1"
    );

    const refinementTrial = report.trials.find(
      ({ caseId }) => caseId === "team-rec-refine-synthetic-v1"
    );

    expect({
      ambiguousTeamClarification:
        ambiguousTeamTrial?.observation.turns[0]?.clarificationAnswers,
      ambiguousTeamId: ambiguousTeamTrial?.observation.actionEvents.find(
        ({ input, kind, name }) =>
          name === "api_football.get_squad" &&
          kind === "attempted" &&
          input !== null
      )?.input,
      noProfileOutcome: noProfileTrial?.observation.outcomeStatus,
      noProfileRecommendationCalls:
        noProfileTrial?.observation.actionEvents.filter(
          ({ name }) => name === "recommend_team_player_candidates"
        ).length,
      refinementFetchCount: refinementTrial?.observation.actionEvents.filter(
        ({ kind, name }) =>
          kind === "returned" && name === "api_football.get_squad"
      ).length,
      refinementRecommendationCalls:
        refinementTrial?.observation.actionEvents.filter(
          ({ kind, name }) =>
            kind === "returned" && name === "recommend_team_player_candidates"
        ).length,
    }).toStrictEqual({
      ambiguousTeamClarification: [{ kind: "team", value: "2" }],
      ambiguousTeamId: { teamId: 902 },
      noProfileOutcome: "team_roster_member_unmapped",
      noProfileRecommendationCalls: 0,
      refinementFetchCount: 1,
      refinementRecommendationCalls: 2,
    });
  }, 40_000);

  it("uses the same fixed roster coverage in the answer, contract check, and judge input", async () => {
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
      path.join(tmpdir(), "tactiscout-roster-coverage-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: ["team-rec-unmapped-roster-synthetic-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 100,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    if (trial === undefined) {
      throw new Error("The roster evaluation returned no trial.");
    }

    const judgeExchange = trial.gatewayExchanges.find(
      ({ role }) => role === "judge"
    );

    if (judgeExchange === undefined) {
      throw new Error("The roster trial did not record its judge request.");
    }

    const judgeInput = evaluationRunnerTest.judgeInputFromRequestBody(
      judgeExchange.requestBody
    );

    const observationCoverage = z
      .looseObject({ teamRosterCoverage: z.json().nullable() })
      .safeParse(trial.observation);

    expect({
      answer: trial.observation.turns[0]?.assistantMessages[0],
      coverageCheck: trial.checks.find(
        ({ id }) => id === "team-roster-coverage"
      )?.status,
      judgeCoverage: judgeInput.teamRosterCoverage ?? null,
      judgeRequests: report.requestCountsByRole.judge,
      observationCoverage: observationCoverage.success
        ? observationCoverage.data.teamRosterCoverage
        : null,
    }).toStrictEqual({
      answer:
        "阵容成员“No Local Profile”（API-Football ID 999）没有可确认的本地 FM 画像，因此已暂停推荐。映射到可用本地 FM 画像 0/1 人（Reep 桥接 0，人工确认 0），无本地画像 1 人，待确认 0 人。",
      coverageCheck: "passed",
      judgeCoverage: {
        mappedMembers: 0,
        noLocalProfileMembers: 1,
        pendingMembers: 0,
        reepBridgeMappings: 0,
        totalMembers: 1,
        userConfirmedMappings: 0,
      },
      judgeRequests: 1,
      observationCoverage: {
        mappedMembers: 0,
        noLocalProfileMembers: 1,
        pendingMembers: 0,
        reepBridgeMappings: 0,
        totalMembers: 1,
        userConfirmedMappings: 0,
      },
    });
  }, 30_000);

  it("runs prepared real team cases or reports missing local preparation", async () => {
    const caseIds = [
      "team-real-madrid-stc-dev-v1",
      "team-real-madrid-ca-filter-dev-v1",
      "team-real-madrid-roster-gap-dev-v1",
      "team-real-madrid-refine-dev-v1",
      "team-bayer-leverkusen-stc-heldout-v1",
      "team-bayer-leverkusen-roster-gap-heldout-v1",
      "team-bayer-leverkusen-ca-filter-heldout-v1",
      "team-bayer-leverkusen-pa-filter-heldout-v1",
    ];

    const evidenceDirectory = path.join(process.cwd(), ".data/evals/evidence");

    const sourcePreview = previewEvaluation({
      caseIds,
      evidenceDirectory,
      mode: "smoke",
    });

    const expectedEvidenceStatuses = caseIds.map((caseId) => {
      const bundleId = caseId.startsWith("team-real-madrid-")
        ? "team-real-madrid-development-v1"
        : "team-bayer-leverkusen-heldout-v1";

      return existsSync(path.join(evidenceDirectory, `${bundleId}.json`))
        ? "ready"
        : "requires_preparation";
    });

    expect(
      sourcePreview.cases.map(({ evidenceStatus }) => evidenceStatus)
    ).toStrictEqual(expectedEvidenceStatuses);

    const bundlesReady = expectedEvidenceStatuses.every(
      (evidenceStatus) => evidenceStatus === "ready"
    );

    if (!bundlesReady) {
      return;
    }

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
      path.join(tmpdir(), "tactiscout-real-team-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const { freezeFingerprint } = previewEvaluation({
      caseIds,
      evidenceDirectory,
      mode: "smoke",
    });

    if (freezeFingerprint === null) {
      throw new Error("The real team fixture needs a freeze fingerprint.");
    }

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds,
      evidenceDirectory,
      freezeId: freezeFingerprint,
      maxModelRequests: 400,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "workspace"),
    });

    expect({
      cases: report.caseCount,
      preflightErrors: report.preflightErrors,
      runStatus: report.status,
      trialCount: report.trials.length,
    }).toStrictEqual({
      cases: 8,
      preflightErrors: [],
      runStatus: "completed",
      trialCount: 8,
    });

    const failedChecks = report.trials.flatMap((trial) =>
      trial.checks
        .filter(({ status }) => status === "failed")
        .map(({ actual, expected, id }) => ({
          actual,
          caseId: trial.caseId,
          expected,
          id,
        }))
    );

    expect(failedChecks).toStrictEqual([]);

    expect(
      report.trials.map(({ observation }) => observation.outcomeStatus)
    ).toStrictEqual(
      Array.from({ length: 8 }, () => "team_roster_member_unmapped")
    );

    expect(
      report.trials.flatMap(({ observation }) =>
        observation.actionEvents.filter(
          ({ name }) => name === "recommend_team_player_candidates"
        )
      )
    ).toStrictEqual([]);
  }, 90_000);
});
