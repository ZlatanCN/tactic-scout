import { describe, expect, it } from "vitest";

import {
  judgeInputForTrial,
  semanticJudgeOutputSchema,
  validateTrialJudgment,
} from "../../../evals/judge.js";
import { judgeValidationTest } from "../../fixtures/judge-validation.js";

describe("saved result and historical evidence", () => {
  it("does not flag a generic retained-result statement when thread state confirms a saved lookup", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "lookup-identity-clarification-v1"
    );

    const finalTurn = caseDefinition.turns.at(-1);

    if (finalTurn === undefined) {
      throw new Error("The lookup case must declare a final turn.");
    }

    const quote = "此前已完成的结果仍保留。";

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([[finalTurn.turnId, [quote]]]),
      "player_lookup"
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation:
            "The active result kind confirms a saved lookup remains.",
          quote,
          turnId: finalTurn.turnId,
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

  it("keeps a generic retained-result claim unsupported when no result remains in state", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "lookup-identity-clarification-v1"
    );

    const finalTurn = caseDefinition.turns.at(-1);

    if (finalTurn === undefined) {
      throw new Error("The lookup case must declare a final turn.");
    }

    const quote = "此前已完成的结果仍保留。";

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([[finalTurn.turnId, [quote]]]),
      null
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation: "No completed result is available in this turn.",
          quote,
          turnId: finalTurn.turnId,
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

  it("accepts evidence from an earlier turn when judging a later historical claim", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "lookup-identity-clarification-v1"
    );

    const [, turn] = caseDefinition.turns;

    if (turn === undefined) {
      throw new Error("The lookup case must include a follow-up turn.");
    }

    const quote =
      "当前没有对应的已完成结果可供解释或修改，请先完成一次该类任务。";

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([[turn.turnId, [quote]]]),
      "player_lookup"
    );

    const judgeInput = judgeInputForTrial(caseDefinition, worker);

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "factual_contradiction",
          evidenceIds: judgeInput.evidence.map(({ evidenceId }) => evidenceId),
          explanation:
            "The prior lookup is present in the current thread result state.",
          quote,
          turnId: turn.turnId,
        },
      ],
      requiredFactCoverage: judgeValidationTest.allFactsCovered(caseDefinition),
    });

    const result = validateTrialJudgment(caseDefinition, worker, judgment);

    expect({
      findings: result.findings.length,
      status: result.status,
    }).toStrictEqual({
      findings: 1,
      status: "failed",
    });
  });
});
