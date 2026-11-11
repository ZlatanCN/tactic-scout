import { describe, expect, it } from "vitest";

import {
  semanticJudgeOutputSchema,
  validateTrialJudgment,
} from "../../../evals/judge.js";
import { judgeValidationTest } from "../../fixtures/judge-validation.js";

describe("recommendation exclusion evidence", () => {
  it("accepts a distance-attribute exclusion supported by the recommendation count", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "recommend-smoke-synthetic-v1"
    );

    const [turn] = caseDefinition.turns;

    if (turn === undefined) {
      throw new Error("The recommendation case must declare a user turn.");
    }

    const quote = "另有 1 个因距离属性不完整而无法排名。";

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([[turn.turnId, [quote]]]),
      null,
      [
        judgeValidationTest.recommendationActionForCase(
          caseDefinition,
          turn.turnId,
          1
        ),
      ]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation:
            "The tool reports one profile missing distance attributes.",
          quote,
          turnId: turn.turnId,
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

  it("keeps a distance-attribute claim when the returned count is zero", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "recommend-smoke-synthetic-v1"
    );

    const [turn] = caseDefinition.turns;

    if (turn === undefined) {
      throw new Error("The recommendation case must declare a user turn.");
    }

    const quote = "另有 1 个因距离属性不完整而无法排名。";

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([[turn.turnId, [quote]]]),
      null,
      [
        judgeValidationTest.recommendationActionForCase(
          caseDefinition,
          turn.turnId,
          0
        ),
      ]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation: "The tool reports no incomplete distance attributes.",
          quote,
          turnId: turn.turnId,
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

  it("accepts mapped roster exclusions when candidate IDs belong to other players", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "team-rec-refine-synthetic-v1"
    );

    const [, turn] = caseDefinition.turns;

    if (turn === undefined) {
      throw new Error(
        "The team recommendation case needs its refinement turn."
      );
    }

    const quote = "当前阵容中所有已映射的 FM 球员均已排除。";

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([[turn.turnId, [quote]]]),
      null,
      [
        judgeValidationTest.teamRecommendationActionForCase(
          caseDefinition,
          turn.turnId,
          ["fm-far-01"]
        ),
      ]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "factual_contradiction",
          evidenceIds: [],
          explanation:
            "The listed candidate does not match either mapped roster FM ID.",
          quote,
          turnId: turn.turnId,
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

  it("keeps a roster-exclusion finding when a mapped roster ID appears as a candidate", () => {
    const caseDefinition = judgeValidationTest.caseFile(
      "team-rec-refine-synthetic-v1"
    );

    const [, turn] = caseDefinition.turns;

    if (turn === undefined) {
      throw new Error(
        "The team recommendation case needs its refinement turn."
      );
    }

    const quote = "当前阵容中所有已映射的 FM 球员均已排除。";

    const worker = judgeValidationTest.workerForCase(
      caseDefinition,
      new Map([[turn.turnId, [quote]]]),
      null,
      [
        judgeValidationTest.teamRecommendationActionForCase(
          caseDefinition,
          turn.turnId,
          ["fm-close-01"]
        ),
      ]
    );

    const judgment = semanticJudgeOutputSchema.parse({
      findings: [
        {
          actionIds: [],
          category: "unsupported_fact",
          evidenceIds: [],
          explanation:
            "The result lists a mapped roster player as a candidate.",
          quote,
          turnId: turn.turnId,
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
