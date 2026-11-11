import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadEvaluationCases } from "../../../evals/benchmark.js";
import {
  evaluationPackConflicts,
  evaluationPackSummary,
  evaluationProvenanceErrors,
  missingResolvedSourceActions,
} from "./invariants.js";

const rootDirectory = process.cwd();

const replacementCases = loadEvaluationCases(
  "held_out",
  [],
  path.join(rootDirectory, "evals/replacements/v35/cases")
);

const priorReplacementDirectories = Array.from({ length: 15 }, (_, index) =>
  path.join(rootDirectory, `evals/replacements/v${index + 20}/cases`)
);

const priorCases = [
  ...loadEvaluationCases("development", []),
  ...loadEvaluationCases("held_out", []),
  ...priorReplacementDirectories.flatMap((directory) =>
    loadEvaluationCases("held_out", [], directory)
  ),
];

describe("v35 replacement held-out pack", () => {
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

  it("uses identities, sources, scenario families, and bundles new to V1–V34", () => {
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

  it("asks about saved xA without adding an unrelated pronoun identity check", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v35-lookup-boulaye-dia-saved-xa"
    )?.caseDefinition;

    expect({
      followup: caseDefinition?.turns[1]?.userMessage,
      statuses: caseDefinition?.contract.expectedTurnIdentityStatuses.map(
        ({ status }) => status
      ),
    }).toStrictEqual({
      followup: "What was the xA for that record?",
      statuses: ["resolved", "saved_result_reuse"],
    });
  });

  it("carries an explicit La Liga scope when adding a third comparison player", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v35-compare-add-ejuke-la-liga"
    )?.caseDefinition;

    expect({
      participantCounts: caseDefinition?.contract.expectedTurnToolActions.map(
        ({ sourceRecords }) =>
          sourceRecords.filter(({ provider }) => provider === "fm").length
      ),
      scopes: caseDefinition?.contract.expectedActionValues
        .filter(({ path: actionPath }) =>
          ["competition", "seasonStartYear"].includes(actionPath)
        )
        .map(({ path: actionPath, value }) => [actionPath, value]),
    }).toStrictEqual({
      participantCounts: [2, 3],
      scopes: [
        ["seasonStartYear", 2026],
        ["competition", "La Liga"],
        ["seasonStartYear", 2026],
        ["competition", "La Liga"],
      ],
    });
  });

  it("retains age and CA filters with independently calculated candidates", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v35-recommend-evanilson-age-ca-filter"
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
        ["maxAge", 24],
        ["minimumCurrentAbility", 130],
        ["resultLimit", 3],
      ],
      resultIds: ["43424893", "83228802", "2000146883"],
    });
  });

  it("recomputes the full candidate list after adding a second reference", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v35-recommend-add-wimmer-reference"
    )?.caseDefinition;

    expect(
      caseDefinition?.contract.expectedTurnToolActions.map(
        ({ sourceRecords }) => sourceRecords.map(({ sourceId }) => sourceId)
      )
    ).toStrictEqual([
      ["92083800", "2000146355", "91172594", "27137320"],
      ["92083800", "16253898", "50065275", "91150290", "92099272"],
    ]);
  });
});
