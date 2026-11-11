import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { evaluationCaseSchema } from "../../../evals/contracts.js";
import {
  judgeInputForTrial,
  semanticJudgeOutputSchema,
  validateTrialJudgment,
} from "../../../evals/judge.js";
import { judgeValidationTest } from "../../fixtures/judge-validation.js";

describe("numeric and source fact grounding", () => {
  it("counts a correctly labeled numeric fact in an earlier player section", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "compare-season-resume-add-synthetic-v1"
    );

    const answer = [
      "**Synthetic Winger's Football Manager record**",
      "| Ability / attribute | Value |",
      "|---|---:|",
      "| Current ability | 139 |",
    ].join("\n");

    const turnId = "compare-season-resume-add-synthetic-v1-turn-2";

    const coverage = judgeValidationTest
      .allFactsCovered(caseDefinition)
      .map((fact) =>
        fact.factId === "required-fact-3"
          ? { ...fact, status: "missing" as const }
          : fact
      );

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([[turnId, [answer]]]),
      "player_comparison"
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [],
      requiredFactCoverage: coverage,
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({
      factStatus: result.requiredFactCoverage.find(
        ({ factId }) => factId === "required-fact-3"
      )?.status,
      status: result.status,
    }).toStrictEqual({ factStatus: "covered", status: "passed" });
  });

  it("keeps a numeric fact missing when the player table shows a different value", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "compare-season-resume-add-synthetic-v1"
    );

    const answer = [
      "**Synthetic Winger's Football Manager record**",
      "| Ability / attribute | Value |",
      "|---|---:|",
      "| Current ability | 180 |",
    ].join("\n");

    const coverage = judgeValidationTest
      .allFactsCovered(caseDefinition)
      .map((fact) =>
        fact.factId === "required-fact-3"
          ? { ...fact, status: "missing" as const }
          : fact
      );

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([["compare-season-resume-add-synthetic-v1-turn-2", [answer]]]),
      "player_comparison"
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [],
      requiredFactCoverage: coverage,
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({
      factStatus: result.requiredFactCoverage.find(
        ({ factId }) => factId === "required-fact-3"
      )?.status,
      status: result.status,
    }).toStrictEqual({ factStatus: "missing", status: "failed" });
  });

  it("counts player values under matching Markdown column headers", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "compare-saka-foden-real-v1"
    );

    const turnId = caseDefinition.turns[0]?.turnId;

    if (turnId === undefined) {
      throw new Error("The comparison case must declare a user turn.");
    }

    const answer = [
      "## Football Manager 数据",
      "| 球员 | 出生日期 | 身高 | 自然位置 | 当前能力 | 潜力能力 |",
      "|---|---|---:|---|---:|---:|",
      "| Bukayo Saka | 2001-09-05 | 178 cm | AMR | 182 | 188 |",
      "| Phil Foden | 2000-05-28 | 171 cm | AMC; AML; AMR | 169 | 180 |",
    ].join("\n");

    const serializedAnswer = JSON.stringify([
      {
        annotations: [],
        phase: "final_answer",
        text: answer,
        type: "text",
      },
    ]);

    const coverage = judgeValidationTest
      .allFactsCovered(caseDefinition)
      .map((fact) =>
        fact.factId === "required-fact-1" || fact.factId === "required-fact-2"
          ? { ...fact, status: "missing" as const }
          : fact
      );

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([[turnId, [serializedAnswer]]]),
      "player_comparison"
    );

    expect(
      judgeInputForTrial(caseDefinition, worker).turns[0]?.assistantMessages
    ).toStrictEqual([answer]);

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [],
      requiredFactCoverage: coverage,
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect(
      result.requiredFactCoverage.find(
        ({ factId }) => factId === "required-fact-1"
      )?.status
    ).toBe("covered");
    expect(
      result.requiredFactCoverage.find(
        ({ factId }) => factId === "required-fact-2"
      )?.status
    ).toBe("covered");
    expect(result.status).toBe("passed");
  });

  it("counts source-backed numeric facts in an earlier serialized prose answer", () => {
    const caseDefinition = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "evals/replacements/v36/cases/v36-lookup-florian-sotoca-saved-xa.json"
          ),
          "utf-8"
        )
      )
    );

    const [firstTurn, secondTurn] = caseDefinition.turns;

    if (firstTurn === undefined || secondTurn === undefined) {
      throw new Error("The lookup case must declare two turns.");
    }

    const firstAnswer = [
      "## Florian Sotoca",
      "",
      "**Football Manager profile:** CA 119, PA 130; natural positions: STC, AMR, AMC.",
      "",
      "**Ligue 1, 2026/27 (Understat):** 4 appearances, 180 minutes, 1 goal, 0 assists, 6 shots, 0.614 xG, and 0.113 xA.",
    ].join("\n");

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([
        [
          firstTurn.turnId,
          [
            JSON.stringify([
              {
                annotations: [],
                phase: "final_answer",
                text: firstAnswer,
                type: "text",
              },
            ]),
          ],
        ],
        [
          secondTurn.turnId,
          [
            JSON.stringify([
              {
                annotations: [],
                phase: "final_answer",
                text: "The record's xA was 0.11293121799826622.",
                type: "text",
              },
            ]),
          ],
        ],
      ]),
      "player_lookup"
    );

    const coverage = judgeValidationTest
      .allFactsCovered(caseDefinition)
      .map((fact, index) =>
        index < 6 ? { ...fact, status: "missing" as const } : fact
      );

    const result = validateTrialJudgment(
      caseDefinition,
      worker,
      semanticJudgeOutputSchema.parse({
        findings: [],
        requiredFactCoverage: coverage,
      })
    );

    expect(
      result.requiredFactCoverage.map(({ status }) => status)
    ).toStrictEqual(Array.from({ length: 7 }, () => "covered"));
    expect(result.status).toBe("passed");
  });

  it("does not cover a numeric fact when visible prose states a different value", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "compare-haaland-foden-real-v1"
    );

    const turnId = caseDefinition.turns[0]?.turnId;

    if (turnId === undefined) {
      throw new Error("The comparison case must declare a user turn.");
    }

    const answer =
      "## Erling Haaland\nCurrent ability 999, potential ability 191.";

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([[turnId, [answer]]]),
      "player_comparison"
    );

    const coverage = judgeValidationTest
      .allFactsCovered(caseDefinition)
      .map((fact) =>
        fact.factId === "required-fact-1"
          ? { ...fact, status: "missing" as const }
          : fact
      );

    const result = validateTrialJudgment(
      caseDefinition,
      worker,
      semanticJudgeOutputSchema.parse({
        findings: [],
        requiredFactCoverage: coverage,
      })
    );

    expect(
      result.requiredFactCoverage.find(
        ({ factId }) => factId === "required-fact-1"
      )?.status
    ).toBe("missing");
    expect(result.status).toBe("failed");
  });

  it("links team candidate facts to source IDs and covers them in earlier prose", () => {
    const caseDefinition = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "evals/replacements/v36/cases/v36-team-northvale-ca-tightening.json"
          ),
          "utf-8"
        )
      )
    );

    const [firstTurn, followUpTurn] = caseDefinition.turns;

    if (firstTurn === undefined) {
      throw new Error("The team case must declare a first turn.");
    }

    const candidateAction = {
      ...judgeValidationTest.teamRecommendationActionForCase(
        caseDefinition,
        firstTurn.turnId,
        ["fm-v36-future-01"]
      ),
      result: JSON.stringify({
        recommendation: {
          currentCandidates: [
            {
              currentAbility: 124,
              fmId: "fm-v36-future-01",
              name: "Ari Patel",
              potentialAbility: 195,
            },
          ],
          potentialCandidates: null,
        },
      }),
    };

    const firstAnswer =
      "Current candidates: 1. Ari Patel (FM ID fm-v36-future-01; age 19; position rating 19; CA 124; PA 195; currentDistance 2.7688746209726918).";

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([
        [firstTurn.turnId, [firstAnswer]],
        [followUpTurn?.turnId ?? "missing-turn", ["Filtered the candidates."]],
      ]),
      "team_recommendation",
      [candidateAction]
    );

    const coverage = judgeValidationTest
      .allFactsCovered(caseDefinition)
      .map((fact) =>
        ["required-fact-2", "required-fact-3"].includes(fact.factId)
          ? { ...fact, status: "missing" as const }
          : fact
      );

    const judgeInput = judgeInputForTrial(caseDefinition, worker);

    const result = validateTrialJudgment(
      caseDefinition,
      worker,
      semanticJudgeOutputSchema.parse({
        findings: [],
        requiredFactCoverage: coverage,
      })
    );

    expect(
      judgeInput.contract.requiredFacts.find(
        ({ factId }) => factId === "required-fact-2"
      )?.description
    ).toContain("Ari Patel");
    expect(
      result.requiredFactCoverage
        .filter(({ factId }) =>
          ["required-fact-2", "required-fact-3"].includes(factId)
        )
        .map(({ status }) => status)
    ).toStrictEqual(["covered", "covered"]);
    expect(result.status).toBe("passed");
  });
});
