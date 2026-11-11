import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { loadEvaluationCases } from "../../../evals/benchmark.js";
import { evaluationCaseSchema } from "../../../evals/contracts.js";
import { evaluationRunnerTest } from "../../fixtures/evaluation-runner-entry.js";

describe("evaluation comparison trials", () => {
  afterEach(async () => {
    await evaluationRunnerTest.cleanup();
  });

  it("runs comparison computation, duplicate identity rejection, scope limits, and multi-turn refinements", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "comparison_resume"
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
      path.join(tmpdir(), "tactiscout-comparison-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: [
        "compare-same-identity-synthetic-v1",
        "compare-synthetic-cross-scope-v1",
        "compare-add-third-synthetic-v1",
        "compare-season-resume-add-synthetic-v1",
      ],
      maxModelRequests: 30,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const trials = report.trials.map((trial) => ({
      actionOutcomes: trial.observation.actionEvents
        .filter(
          ({ kind, name }) =>
            kind === "returned" && name === "compare_player_records"
        )
        .map(({ outcome }) => outcome),
      caseId: trial.caseId,
      codeStatus: trial.codeStatus,
      identityCountsByTurn: trial.observation.turns.map(
        ({ players, turnId }) => ({
          playerCount: players.length,
          turnId,
        })
      ),
      outcomeStatus: trial.observation.outcomeStatus,
      status: trial.status,
    }));

    expect(
      report.trials
        .at(-1)
        ?.checks.filter(({ status }) => status === "failed")
        .map(({ actual, expected, id }) => ({ actual, expected, id }))
    ).toStrictEqual([]);

    expect({
      fakeGatewayRequests: requestCount,
      modelRequests: report.modelRequests,
      reportStatus: report.status,
      trials,
    }).toStrictEqual({
      fakeGatewayRequests: requestCount,
      modelRequests: requestCount,
      reportStatus: "completed",
      trials: [
        {
          actionOutcomes: ["insufficient_distinct_players"],
          caseId: "compare-same-identity-synthetic-v1",
          codeStatus: "passed",
          identityCountsByTurn: [
            {
              playerCount: 2,
              turnId: "compare-same-identity-synthetic-v1-turn-1",
            },
          ],
          outcomeStatus: "insufficient_distinct_players",
          status: "not_assessed",
        },
        {
          actionOutcomes: ["no_comparable_data"],
          caseId: "compare-synthetic-cross-scope-v1",
          codeStatus: "passed",
          identityCountsByTurn: [
            {
              playerCount: 2,
              turnId: "compare-synthetic-cross-scope-v1-turn-1",
            },
          ],
          outcomeStatus: "no_comparable_data",
          status: "not_assessed",
        },
        {
          actionOutcomes: ["ready", "ready"],
          caseId: "compare-add-third-synthetic-v1",
          codeStatus: "passed",
          identityCountsByTurn: [
            {
              playerCount: 2,
              turnId: "compare-add-third-synthetic-v1-turn-1",
            },
            {
              playerCount: 3,
              turnId: "compare-add-third-synthetic-v1-turn-2",
            },
          ],
          outcomeStatus: "ready",
          status: "not_assessed",
        },
        {
          actionOutcomes: ["ready", "ready", "ready", "no_comparable_data"],
          caseId: "compare-season-resume-add-synthetic-v1",
          codeStatus: "passed",
          identityCountsByTurn: [
            {
              playerCount: 2,
              turnId: "compare-season-resume-add-synthetic-v1-turn-1",
            },
            {
              playerCount: 3,
              turnId: "compare-season-resume-add-synthetic-v1-turn-2",
            },
            {
              playerCount: 2,
              turnId: "compare-season-resume-add-synthetic-v1-turn-3",
            },
            {
              playerCount: 2,
              turnId: "compare-season-resume-add-synthetic-v1-turn-4",
            },
          ],
          outcomeStatus: "data_unavailable",
          status: "not_assessed",
        },
      ],
    });
  }, 60_000);

  it("isolates declared turn faults across repeated comparison trials", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "comparison_resume"
      );
    });

    evaluationRunnerTest.servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-comparison-repeat-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: ["compare-season-resume-add-synthetic-v1"],
      maxModelRequests: 100,
      mode: "development",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const summarizeTrial = (trial: (typeof report.trials)[number]) => {
      const activeComparison = z
        .object({
          constraints: z.array(
            z.object({ name: z.string(), value: z.string() })
          ),
          players: z.array(z.object({ name: z.string() })),
        })
        .parse(JSON.parse(trial.observation.activeResults.comparison ?? "{}"));

      return {
        activePlayers: activeComparison.players.map(({ name }) => name),
        codeStatus: trial.codeStatus,
        comparisonCount: trial.observation.actionEvents.filter(
          ({ kind, name }) =>
            kind === "returned" && name === "compare_player_records"
        ).length,
        outcomeStatus: trial.observation.outcomeStatus,
        season: activeComparison.constraints.find(
          ({ name }) => name === "season"
        )?.value,
        turnIdentityStatuses: trial.observation.turns.flatMap((turn) =>
          turn.players.map(({ resolutionStatus }) => resolutionStatus)
        ),
      };
    };

    expect({
      modelRequests: requestCount,
      reportStatus: report.status,
      trials: report.trials.map(summarizeTrial),
    }).toStrictEqual({
      modelRequests: report.modelRequests,
      reportStatus: "completed",
      trials: [1, 2, 3].map(() => ({
        activePlayers: ["Elias Demo", "Synthetic Winger"],
        codeStatus: "passed",
        comparisonCount: 4,
        outcomeStatus: "data_unavailable",
        season: "2024/25",
        turnIdentityStatuses: [
          "resolved",
          "resolved",
          "resolved",
          "resolved",
          "resolved",
          "resolved",
          "resolved",
          "resolved",
          "resolved",
        ],
      })),
    });
  }, 30_000);

  it("keeps a season team separate from current registration in lookup answers", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "season_team_abstention"
      );
    });

    evaluationRunnerTest.servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-season-team-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);

    const caseDirectory = path.join(workspace, "cases");
    const evidenceDirectory = path.join(workspace, "evidence");
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const sourceCase = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(process.cwd(), "evals/cases/lookup-smoke-v1.json"),
          "utf-8"
        ).replaceAll("2024/25", "2026/27")
      )
    );

    const sourceEvidence = readFileSync(
      path.join(process.cwd(), "evals/evidence/lookup-smoke-evidence-v1.json"),
      "utf-8"
    );

    const evidenceContents = sourceEvidence
      .replace(
        '"capturedAt": "2025-11-23T00:00:00.000Z"',
        '"capturedAt": "2026-10-28T00:00:00.000Z"'
      )
      .replace('"seasonStartYear": 2024', '"seasonStartYear": 2026')
      .replace('"team_title": "Fixture City"', '"team_title": "Arsenal"');

    const evidenceBundleSha256 = createHash("sha256")
      .update(evidenceContents)
      .digest("hex");

    const seasonalTeamCase = {
      ...sourceCase,
      contract: {
        ...sourceCase.contract,
        requiredAbstentions: [
          "Current registration is not present in FM or Understat and must be stated as unknown.",
        ],
        requiredEvidence: [
          {
            competition: "EPL",
            field: "team",
            provider: "understat" as const,
            season: "2026/27",
            sourceId: "us-demo-01",
            value: "Arsenal",
          },
        ],
      },
      evidenceBundleSha256,
      turns: sourceCase.turns.map((turn) => ({
        ...turn,
        userMessage:
          "请查一下 Elias Demo 的 2026/27 EPL 表现记录对应球队，以及当前注册俱乐部。",
      })),
    };

    writeFileSync(
      path.join(caseDirectory, "lookup-smoke-v1.json"),
      JSON.stringify(seasonalTeamCase)
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-smoke-evidence-v1.json"),
      evidenceContents
    );

    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${parsedAddress.port}/v1`);

    const report = await evaluationRunnerTest.runEvaluation({
      caseDirectory,
      caseIds: ["lookup-smoke-v1"],
      evidenceDirectory,
      maxModelRequests: 10,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "workspace"),
    });

    const [trial] = report.trials;

    const answer = trial?.observation.conversationContext
      .toReversed()
      .find(({ role }) => role === "assistant")?.content;

    expect(answer).toBe(
      "Understat 的 2026/27 EPL 赛季表现记录列出的球队是 Arsenal。FM 和 Understat 都没有提供当前注册球队，因此无法从这些资料确定 Elias Demo 目前效力的俱乐部。"
    );
    expect(answer).not.toMatch(/(?:Current club|当前俱乐部)\s*:/u);
    expect(
      trial?.checks.find(({ id }) => id === "required-evidence")?.status
    ).toBe("passed");
    expect(trial?.codeStatus).toBe("passed");
    expect(requestCount).toBe(report.modelRequests);
  }, 60_000);

  it("supplies active-result state after each turn to the semantic judge", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void evaluationRunnerTest.handleGatewayRequest(
        request,
        response,
        requestCount,
        "comparison_resume"
      );
    });

    evaluationRunnerTest.servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-active-results-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: ["compare-season-resume-add-synthetic-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 120,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      activeResultKinds: trial?.observation.turns.map(
        (turn) =>
          z.object({ availableResultKinds: z.array(z.string()) }).parse(turn)
            .availableResultKinds
      ),
      calibrationStatus: report.judgeCalibration?.status,
      codeStatus: trial?.codeStatus,
      reportStatus: report.status,
      requestCount,
      semanticStatus: trial?.semanticStatus,
      trialStatus: trial?.status,
    }).toStrictEqual({
      activeResultKinds: [
        ["player_comparison"],
        ["player_comparison"],
        ["player_comparison"],
        ["player_comparison"],
      ],
      calibrationStatus: "passed",
      codeStatus: "passed",
      reportStatus: "completed",
      requestCount: report.modelRequests,
      semanticStatus: "passed",
      trialStatus: "passed",
    });
  }, 30_000);

  it("supplies the per-player identity failure to the semantic judge", async () => {
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
      path.join(tmpdir(), "tactiscout-identity-judge-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds: ["lookup-identity-unavailable-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 80,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      calibration: report.judgeCalibration?.status,
      identityLookupOutcome: trial?.observation.identityLookupEvents.find(
        ({ kind }) => kind === "returned"
      )?.outcome,
      requestCount,
      semanticStatus: trial?.semanticStatus,
      status: report.status,
    }).toStrictEqual({
      calibration: "passed",
      identityLookupOutcome: "data_unavailable",
      requestCount: report.modelRequests,
      semanticStatus: "passed",
      status: "completed",
    });
  }, 30_000);

  it("applies an explicit competition scope in the real comparison workflow", async () => {
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
      path.join(tmpdir(), "tactiscout-comparison-competition-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const [loadedCase] = loadEvaluationCases("development", [
      "compare-add-third-synthetic-v1",
    ]);

    if (loadedCase === undefined) {
      throw new Error("The synthetic comparison fixture is missing.");
    }

    const caseDefinition =
      evaluationRunnerTest.explicitCompetitionComparisonCase(
        loadedCase.caseDefinition
      );

    const { caseId } = caseDefinition;

    const caseDirectory = path.join(workspace, "cases");
    const evidenceDirectory = path.join(workspace, "evidence");

    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(
      path.join(caseDirectory, `${caseId}.json`),
      JSON.stringify(caseDefinition)
    );
    writeFileSync(
      path.join(evidenceDirectory, `${caseDefinition.evidenceBundleId}.json`),
      readFileSync(
        path.join(
          process.cwd(),
          "evals/evidence",
          `${caseDefinition.evidenceBundleId}.json`
        ),
        "utf-8"
      )
    );

    const report = await evaluationRunnerTest.runEvaluation({
      caseDirectory,
      caseIds: [caseId],
      evidenceDirectory,
      maxModelRequests: 10,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "workspace"),
    });

    const [trial] = report.trials;

    const returnedAction = trial?.observation.actionEvents.find(
      ({ kind, name }) =>
        kind === "returned" && name === "compare_player_records"
    );

    const comparisonOutputSchema = z.object({
      players: z.array(
        z.object({
          fm: z.object({ status: z.string() }).nullable().optional(),
          playerName: z.string(),
          understat: z.object({ status: z.string() }).nullable().optional(),
        })
      ),
      status: z.string(),
      understatScopeGroups: z.array(
        z.object({ competition: z.string(), season: z.string() })
      ),
    });

    const parsedOutput = comparisonOutputSchema.safeParse(
      returnedAction?.result === null || returnedAction?.result === undefined
        ? null
        : JSON.parse(returnedAction.result)
    );

    expect({
      codeStatus: trial?.codeStatus,
      comparisonStatus: parsedOutput.success ? parsedOutput.data.status : null,
      effectiveConstraints: trial?.observation.turns[0]?.effectiveConstraints,
      syntheticMidfielderUnderstatStatus: parsedOutput.success
        ? parsedOutput.data.players.find(
            ({ playerName }) => playerName === "Synthetic Midfielder"
          )?.understat?.status
        : null,
      syntheticWingerUnderstatStatus: parsedOutput.success
        ? parsedOutput.data.players.find(
            ({ playerName }) => playerName === "Synthetic Winger"
          )?.understat?.status
        : null,
      understatScopeGroups: parsedOutput.success
        ? parsedOutput.data.understatScopeGroups
        : null,
    }).toStrictEqual({
      codeStatus: "passed",
      comparisonStatus: "ready",
      effectiveConstraints: [
        { name: "season", value: "2024/25" },
        { name: "competition", value: "La Liga" },
      ],
      syntheticMidfielderUnderstatStatus: "not_found",
      syntheticWingerUnderstatStatus: "found",
      understatScopeGroups: [],
    });
  }, 60_000);
});
