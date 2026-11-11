import { describe, expect, it } from "vitest";

import {
  semanticJudgeOutputSchema,
  validateTrialJudgment,
} from "../../../evals/judge.js";
import { judgeValidationTest } from "../../fixtures/judge-validation.js";

describe("claims about executed filter scope", () => {
  it("accepts a no-competition-filter statement when the executed tool input has none", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "lookup-followup-smoke-v1"
    );

    const turnId = "lookup-followup-smoke-v1-turn-2";
    const quote = "查询未设置赛事过滤条件；";

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([[turnId, [quote]]]),
      "player_lookup",
      [
        judgeValidationTest.searchActionForCase(caseDefinition, turnId, {
          sourceRecords: [{ provider: "understat", sourceId: "us-haaland-01" }],
        }),
      ]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation:
            "The action input does not include a competition filter.",
          quote,
          turnId,
        },
      ],
      requiredFactCoverage: judgeValidationTest.allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({ findings: result.findings, status: result.status }).toStrictEqual({
      findings: [],
      status: "passed",
    });
  });

  it("does not accept a no-filter statement when the action input contains a competition", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "lookup-followup-smoke-v1"
    );

    const turnId = "lookup-followup-smoke-v1-turn-2";
    const quote = "查询未设置赛事过滤条件；";

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([[turnId, [quote]]]),
      "player_lookup",
      [
        judgeValidationTest.searchActionForCase(caseDefinition, turnId, {
          competition: "EPL",
          sourceRecords: [{ provider: "understat", sourceId: "us-haaland-01" }],
        }),
      ]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation: "The action input includes a competition filter.",
          quote,
          turnId,
        },
      ],
      requiredFactCoverage: judgeValidationTest.allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({ findings: result.findings, status: result.status }).toStrictEqual({
      findings: judgment.findings,
      status: "failed",
    });
  });

  it("does not use a proposed search to support a no-filter statement", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "lookup-followup-smoke-v1"
    );

    const turnId = "lookup-followup-smoke-v1-turn-2";
    const quote = "查询未设置赛事过滤条件；";

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([[turnId, [quote]]]),
      "player_lookup",
      [
        judgeValidationTest.searchActionForCase(
          caseDefinition,
          turnId,
          {
            sourceRecords: [
              { provider: "understat", sourceId: "us-haaland-01" },
            ],
          },
          "requested"
        ),
      ]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation: "A requested action is not evidence of execution.",
          quote,
          turnId,
        },
      ],
      requiredFactCoverage: judgeValidationTest.allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({ findings: result.findings, status: result.status }).toStrictEqual({
      findings: judgment.findings,
      status: "failed",
    });
  });
});
