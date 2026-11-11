import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { evaluationRunnerTest } from "../../fixtures/evaluation-runner-entry.js";

describe("evaluation player recommendation trials", () => {
  afterEach(async () => {
    await evaluationRunnerTest.cleanup();
  });

  it("runs synthetic player recommendations through the real graph and ranking algorithm", async () => {
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
      path.join(tmpdir(), "tactiscout-recommendation-eval-")
    );

    evaluationRunnerTest.temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const caseIds = [
      "recommend-smoke-synthetic-v1",
      "recommend-youth-clarification-synthetic-v1",
      "recommend-ambiguous-profile-synthetic-v1",
      "recommend-add-refine-synthetic-v1",
    ];

    const report = await evaluationRunnerTest.runEvaluation({
      caseIds,
      maxModelRequests: 60,
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

    expect({
      reportRequests: report.modelRequests,
      requestCount,
      statuses: report.trials.map(({ caseId, codeStatus, status }) => ({
        caseId,
        codeStatus,
        status,
      })),
      values: report.trials.map((trial) => ({
        actionOutcomes: trial.observation.actionEvents
          .filter(
            ({ kind, name }) =>
              kind === "returned" && name === "recommend_player_candidates"
          )
          .map(({ outcome }) => outcome),
        clarifications: trial.observation.turns.map(
          ({ clarificationAnswers, clarificationKinds }) => ({
            answers: clarificationAnswers,
            kinds: clarificationKinds,
          })
        ),
        identityLookups: trial.observation.identityLookupEvents
          .filter(({ kind }) => kind === "returned")
          .map(({ lookupName, outcome }) => ({ lookupName, outcome })),
      })),
    }).toStrictEqual({
      reportRequests: report.modelRequests,
      requestCount: report.modelRequests,
      statuses: caseIds.map((caseId) => ({
        caseId,
        codeStatus: "passed",
        status: "not_assessed",
      })),
      values: [
        {
          actionOutcomes: ["ready"],
          clarifications: [
            {
              answers: [{ kind: "identity", value: "1" }],
              kinds: ["identity"],
            },
          ],
          identityLookups: [
            { lookupName: "Synthetic Reference", outcome: "resolved" },
            {
              lookupName: "Synthetic Far Candidate",
              outcome: "needs_confirmation",
            },
          ],
        },
        {
          actionOutcomes: ["position_required", "ready"],
          clarifications: [
            {
              answers: [
                { kind: "age", value: "21" },
                { kind: "position", value: "stc" },
              ],
              kinds: ["age", "position"],
            },
          ],
          identityLookups: [
            { lookupName: "Synthetic Reference", outcome: "resolved" },
          ],
        },
        {
          actionOutcomes: ["ready"],
          clarifications: [
            {
              answers: [{ kind: "fm_profile", value: "fm-amb-b" }],
              kinds: ["fm_profile"],
            },
          ],
          identityLookups: [
            { lookupName: "Synthetic Ambiguous", outcome: "resolved" },
          ],
        },
        {
          actionOutcomes: ["ready", "ready", "ready"],
          clarifications: [
            { answers: [], kinds: [] },
            {
              answers: [{ kind: "identity", value: "1" }],
              kinds: ["identity"],
            },
            { answers: [], kinds: [] },
            { answers: [], kinds: [] },
          ],
          identityLookups: [
            { lookupName: "Synthetic Reference", outcome: "resolved" },
            {
              lookupName: "Synthetic Close Candidate",
              outcome: "needs_confirmation",
            },
            {
              lookupName: "Synthetic Failure Reference",
              outcome: "data_unavailable",
            },
          ],
        },
      ],
    });

    const ambiguousProfileTrial = report.trials.find(
      ({ caseId }) => caseId === "recommend-ambiguous-profile-synthetic-v1"
    );

    const finalAssistantMessage =
      ambiguousProfileTrial?.observation.turns
        .at(-1)
        ?.assistantMessages.at(-1) ?? "";

    expect({
      currentAbility: finalAssistantMessage.includes("CA 142"),
      fmId: finalAssistantMessage.includes("FM ID fm-amb-b"),
      potentialAbility: finalAssistantMessage.includes("PA 181"),
    }).toStrictEqual({
      currentAbility: true,
      fmId: true,
      potentialAbility: true,
    });
  }, 60_000);
});
