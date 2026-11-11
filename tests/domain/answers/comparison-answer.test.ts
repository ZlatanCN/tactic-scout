import { describe, expect, it } from "vitest";

import { correctComparisonAnswer } from "../../../src/comparison-answer.js";

const comparisonResultWithBirthDates = (
  birthDates: (string | null)[],
  naturalPositions: (string | null)[] = birthDates.map(() => null)
) =>
  JSON.stringify({
    coverage: {
      commonUnderstatScopeCount: 0,
      fmPlayerCount: birthDates.length,
      hasFmRecords: true,
      hasUnderstatRecords: false,
      playerCount: birthDates.length,
    },
    players: birthDates.map((birthDate, index) => ({
      fm: {
        records: [
          {
            attributes: {
              accelerationRaw: null,
              decisionsRaw: null,
              finishingRaw: null,
              first_touchRaw: null,
              off_the_ballRaw: null,
              paceRaw: null,
              passingRaw: null,
              strengthRaw: null,
              techniqueRaw: null,
              visionRaw: null,
            },
            birthDate,
            currentAbility: null,
            heightCm: null,
            identitySourceId: `fm-id-${index + 1}`,
            naturalPositions: naturalPositions[index] ?? null,
            player: `Comparison Player ${index + 1}`,
            potentialAbility: null,
            source: "Football Manager",
            sourceRecordId: `fm-record-${index + 1}`,
          },
        ],
        status: "found",
      },
      playerName: `Comparison Player ${index + 1}`,
      understat: null,
    })),
    status: "ready",
    understatScopeGroups: [],
  });

describe("comparison answer corrections", () => {
  it("replaces a false missing-birth-date claim with dates present in FM records", () => {
    const result = correctComparisonAnswer(
      "出生日期未提供。",
      comparisonResultWithBirthDates(["2001-02-03", "2000-04-05"])
    );

    expect(result).toBe(
      "FM 记录中的出生日期：Comparison Player 1 2001-02-03；Comparison Player 2 2000-04-05。"
    );
  });

  it("leaves a missing-date statement unchanged when FM records have no dates", () => {
    expect(
      correctComparisonAnswer(
        "出生日期未提供。",
        comparisonResultWithBirthDates([null, null])
      )
    ).toBeNull();
  });

  it("does not rewrite an answer that makes no missing-date claim", () => {
    expect(
      correctComparisonAnswer(
        "FM 能力值分别为 140 和 150。",
        comparisonResultWithBirthDates(["2001-02-03", "2000-04-05"])
      )
    ).toBeNull();
  });

  it("labels FM natural positions without claiming current position", () => {
    const answer = [
      "| 球员 | 当前位置 | CA |",
      "|---|---|---:|",
      "| Liam Delap | STC | 142 |",
    ].join("\n");

    const result = correctComparisonAnswer(
      answer,
      comparisonResultWithBirthDates([null, null], ["STC", "MC"])
    );

    expect(result).toContain("自然位置");
    expect(result).not.toContain("当前位置");
  });
});
