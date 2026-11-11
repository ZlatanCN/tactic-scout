import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { evaluationRunnerTest } from "../../fixtures/evaluation-runner-entry.js";

describe("evaluation clarification dispatch", () => {
  afterEach(async () => {
    await evaluationRunnerTest.cleanup();
  });

  it("records a scripted clarification mismatch without resuming the graph", async () => {
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
      path.join(tmpdir(), "tactiscout-eval-script-")
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
      path.join(
        process.cwd(),
        "evals/cases/lookup-identity-clarification-v1.json"
      ),
      "utf-8"
    ).replace('"expectedKind": "identity"', '"expectedKind": "season"');

    const evidenceContents = readFileSync(
      path.join(
        process.cwd(),
        "evals/evidence/lookup-ambiguous-evidence-v1.json"
      ),
      "utf-8"
    );

    writeFileSync(
      path.join(caseDirectory, "lookup-identity-clarification-v1.json"),
      caseContents
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-ambiguous-evidence-v1.json"),
      evidenceContents
    );

    const report = await evaluationRunnerTest.runEvaluation({
      caseDirectory,
      caseIds: ["lookup-identity-clarification-v1"],
      evidenceDirectory,
      maxModelRequests: 3,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      clarificationKinds: trial?.observation.turns[0]?.clarificationKinds,
      codeStatus: trial?.codeStatus,
      driverIssue: trial?.observation.driverIssue,
      modelRequests: report.modelRequests,
      requestCount,
      scriptCheck: trial?.checks.find(
        ({ id }) => id === "scripted-clarifications"
      )?.status,
      status: trial?.status,
    }).toStrictEqual({
      clarificationKinds: ["identity"],
      codeStatus: "failed",
      driverIssue: "The scripted clarification does not match the graph.",
      modelRequests: 1,
      requestCount: 1,
      scriptCheck: "failed",
      status: "failed",
    });
  }, 15_000);

  it("uses a clarification path only when its declared kind matches the real interrupt", async () => {
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
      path.join(tmpdir(), "tactiscout-eval-paths-")
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

    const answerSchema = z.looseObject({
      expectedKind: z.string(),
      resumeValue: z.string(),
    });

    const caseSchema = z.looseObject({
      turns: z.array(
        z.looseObject({
          clarificationAlternatives: z.array(z.array(answerSchema)).optional(),
          clarificationAnswers: z.array(answerSchema).default([]),
        })
      ),
    });

    const originalCase = caseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "evals/cases/lookup-identity-clarification-v1.json"
          ),
          "utf-8"
        )
      )
    );

    const [firstTurn] = originalCase.turns;

    if (firstTurn === undefined) {
      throw new Error("The clarification case needs a first turn.");
    }

    const alternativeCase = {
      ...originalCase,
      turns: [
        {
          ...firstTurn,
          clarificationAlternatives: [
            [{ expectedKind: "identity", resumeValue: "1" }],
          ],
          clarificationAnswers: [
            { expectedKind: "season", resumeValue: "2024/25" },
          ],
        },
        ...originalCase.turns.slice(1),
      ],
    };

    const evidenceContents = readFileSync(
      path.join(
        process.cwd(),
        "evals/evidence/lookup-ambiguous-evidence-v1.json"
      ),
      "utf-8"
    );

    writeFileSync(
      path.join(caseDirectory, "lookup-identity-clarification-v1.json"),
      JSON.stringify(alternativeCase)
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-ambiguous-evidence-v1.json"),
      evidenceContents
    );

    const report = await evaluationRunnerTest.runEvaluation({
      caseDirectory,
      caseIds: ["lookup-identity-clarification-v1"],
      evidenceDirectory,
      maxModelRequests: 10,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      answers: trial?.observation.turns[0]?.clarificationAnswers,
      driverIssue: trial?.observation.driverIssue,
      modelRequests: report.modelRequests,
      requestCount,
      scriptCheck: trial?.checks.find(
        ({ id }) => id === "scripted-clarifications"
      )?.status,
      status: trial?.status,
    }).toStrictEqual({
      answers: [{ kind: "identity", value: "1" }],
      driverIssue: null,
      modelRequests: 6,
      requestCount: 6,
      scriptCheck: "passed",
      status: "not_assessed",
    });
  }, 15_000);
});
