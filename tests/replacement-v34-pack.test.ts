import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadEvaluationCases } from "../evals/benchmark.js";
import {
  evaluationPackConflicts,
  evaluationPackSummary,
  evaluationProvenanceErrors,
  missingResolvedSourceActions,
} from "./evaluation-pack-invariants.js";

const rootDirectory = process.cwd();

const replacementCases = loadEvaluationCases(
  "held_out",
  [],
  path.join(rootDirectory, "evals/replacements/v34/cases")
);

const priorReplacementDirectories = Array.from({ length: 14 }, (_, index) =>
  path.join(rootDirectory, `evals/replacements/v${index + 20}/cases`)
);

const priorCases = [
  ...loadEvaluationCases("development", []),
  ...loadEvaluationCases("held_out", []),
  ...priorReplacementDirectories.flatMap((directory) =>
    loadEvaluationCases("held_out", [], directory)
  ),
];

describe("v34 replacement held-out pack", () => {
  it("covers each workflow with 12 real and 4 synthetic cases", () => {
    expect(evaluationPackSummary(replacementCases)).toStrictEqual({
      count: 16,
      origins: { mixed: 0, real: 12, synthetic: 4 },
      workflows: {
        player_comparison: 4,
        player_lookup: 4,
        player_recommendation: 4,
        team_recommendation: 4,
      },
    });
  });

  it("uses identities, sources, scenario families, and bundles new to V1–V33", () => {
    expect(evaluationPackConflicts(replacementCases, priorCases)).toStrictEqual(
      []
    );
  });

  it("pins source dates and provenance for every case", () => {
    expect(
      evaluationProvenanceErrors(replacementCases, "2026-11-04")
    ).toStrictEqual([]);
  });

  it("includes each resolved provider record in its matching lookup action", () => {
    expect(missingResolvedSourceActions(replacementCases)).toStrictEqual([]);
  });

  it("carries a resolved comparison scope when a third participant is added", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v34-compare-add-amiri-bundesliga"
    )?.caseDefinition;

    expect({
      actionCount: caseDefinition?.contract.expectedTurnToolActions.length,
      participantCounts: caseDefinition?.contract.expectedTurnToolActions.map(
        ({ sourceRecords }) =>
          sourceRecords.filter(({ provider }) => provider === "fm").length
      ),
      scopeValues: caseDefinition?.contract.expectedActionValues
        .filter(({ path: actionPath }) =>
          ["competition", "seasonStartYear"].includes(actionPath)
        )
        .map(({ path: actionPath, value }) => [actionPath, value]),
    }).toStrictEqual({
      actionCount: 2,
      participantCounts: [2, 3],
      scopeValues: [
        ["seasonStartYear", 2026],
        ["competition", "Bundesliga"],
        ["seasonStartYear", 2026],
        ["competition", "Bundesliga"],
      ],
    });
  });

  it("keeps age and CA filters and the fixed result IDs in the recommendation case", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v34-recommend-schade-age-ca-filter"
    )?.caseDefinition;

    expect({
      filters: caseDefinition?.contract.expectedActionValues
        .filter(({ path: actionPath }) =>
          ["maxAge", "minimumCurrentAbility", "resultLimit"].includes(
            actionPath
          )
        )
        .map(({ path: actionPath, value }) => [actionPath, value]),
      resultIds:
        caseDefinition?.contract.expectedTurnToolActions[0]?.sourceRecords
          .filter(({ provider }) => provider === "fm")
          .map(({ sourceId }) => sourceId)
          .slice(1),
    }).toStrictEqual({
      filters: [
        ["maxAge", 23],
        ["minimumCurrentAbility", 130],
        ["resultLimit", 3],
      ],
      resultIds: ["42102493", "2000227373", "12092528"],
    });
  });

  it("changes the complete candidate list after adding the second reference", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v34-recommend-add-honorat-reference"
    )?.caseDefinition;

    expect(
      caseDefinition?.contract.expectedTurnToolActions.map(
        ({ sourceRecords }) => sourceRecords.map(({ sourceId }) => sourceId)
      )
    ).toStrictEqual([
      ["92016244", "18073840", "37076659", "28094954"],
      ["92016244", "48036785", "28094954", "67277676", "2000021340"],
    ]);
  });
});
