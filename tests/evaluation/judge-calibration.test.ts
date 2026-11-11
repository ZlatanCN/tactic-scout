import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runJudgeCalibration } from "../../evals/judge.js";

const anchor = (split: "development" | "validation", index: number) => ({
  actions: [],
  anchorId: `${split}-anchor-${index}`,
  answer: "The answer is supported by the supplied record.",
  category: "correct_paraphrase",
  evidence: [],
  expectedCategories: [],
  scenarioFamily: `${split}-family-${index}`,
  split,
  userMessage: "What does the supplied record say?",
});

describe("semantic judge calibration gate", () => {
  it("fails calibration when any development or validation anchor fails", async () => {
    const anchorDirectory = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-calibration-gate-")
    );

    const anchors = [
      ...Array.from({ length: 16 }, (_, index) => anchor("development", index)),
      ...Array.from({ length: 16 }, (_, index) => anchor("validation", index)),
    ];

    const observedStateSnapshots: unknown[] = [];

    writeFileSync(
      path.join(anchorDirectory, "v9.json"),
      JSON.stringify({
        anchorVersion: "calibration-gate-test-v1",
        anchors,
        priorTuningExposure: "Synthetic unit fixture.",
        retiredValidationAnchorIds: [],
      })
    );

    try {
      const calibration = await runJudgeCalibration({
        agentModel: "fake-agent",
        anchorDirectory,
        judge: async (input) => {
          observedStateSnapshots.push(input.turns[0]?.availableResultKinds);

          await Promise.resolve();

          if (input.caseId !== "development-anchor-0") {
            return { findings: [], requiredFactCoverage: [] };
          }

          return {
            findings: [
              {
                actionIds: [],
                category: "unsupported_fact",
                evidenceIds: [],
                explanation:
                  "The fake judge deliberately misclassified this anchor.",
                quote: input.turns[0]?.assistantMessages[0] ?? "",
                turnId: input.caseId,
              },
            ],
            requiredFactCoverage: [],
          };
        },
        judgeModel: "fake-judge",
      });

      expect(observedStateSnapshots).toStrictEqual(
        Array.from({ length: 32 }, () => null)
      );
      expect(calibration).toMatchObject({
        development: { passed: 15, total: 16 },
        status: "failed",
        validation: { passed: 16, total: 16 },
      });
    } finally {
      rmSync(anchorDirectory, { force: true, recursive: true });
    }
  });
});
