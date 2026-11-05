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
  path.join(rootDirectory, "evals/replacements/v33/cases")
);

const priorReplacementDirectories = [
  "v20",
  "v21",
  "v22",
  "v23",
  "v24",
  "v25",
  "v26",
  "v27",
  "v28",
  "v29",
  "v30",
  "v31",
  "v32",
].map((version) =>
  path.join(rootDirectory, `evals/replacements/${version}/cases`)
);

const priorCases = [
  ...loadEvaluationCases("development", []),
  ...loadEvaluationCases("held_out", []),
  ...priorReplacementDirectories.flatMap((directory) =>
    loadEvaluationCases("held_out", [], directory)
  ),
];

describe("v33 replacement held-out pack", () => {
  it("covers all workflows with 12 real and 4 synthetic cases", () => {
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

  it("uses new identities, source records, scenario families, and evidence groups", () => {
    expect(evaluationPackConflicts(replacementCases, priorCases)).toStrictEqual(
      []
    );
  });

  it("keeps age dates and source provenance explicit", () => {
    expect(
      evaluationProvenanceErrors(replacementCases, "2026-11-04")
    ).toStrictEqual([]);
  });

  it("includes each resolved provider ID in its matching tool action", () => {
    expect(missingResolvedSourceActions(replacementCases)).toStrictEqual([]);
  });

  it("uses the exact Reep-linked source records for Kenan Karaman", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v33-lookup-kenan-profile"
    )?.caseDefinition;

    expect(
      caseDefinition?.contract.resolvedPlayers[0]?.sourceRecords
    ).toStrictEqual([
      { provider: "fm", sourceId: "91121536" },
      {
        competition: "Bundesliga",
        provider: "understat",
        season: "2026/27",
        sourceId: "98",
      },
    ]);
  });

  it("reuses the active lookup for season and xA follow-ups", () => {
    const followups = replacementCases
      .filter(({ caseDefinition }) =>
        [
          "v33-lookup-sinayoko-saved-season",
          "v33-lookup-douvikas-saved-xa",
        ].includes(caseDefinition.caseId)
      )
      .map(({ caseDefinition }) => ({
        actions: caseDefinition.contract.expectedTurnToolActions.map(
          ({ name }) => name
        ),
        statuses: caseDefinition.contract.expectedTurnIdentityStatuses.map(
          ({ status }) => status
        ),
      }));

    expect(followups).toStrictEqual([
      {
        actions: ["search_player_records"],
        statuses: ["resolved", "saved_result_reuse"],
      },
      {
        actions: ["search_player_records"],
        statuses: ["resolved", "saved_result_reuse"],
      },
    ]);
  });

  it("defines resultLimit independently for the current and potential lists", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v33-recommend-berardi-under-16-pa"
    )?.caseDefinition;

    expect(caseDefinition?.turns[0]?.userMessage).toContain(
      "at most one candidate in each list"
    );
    expect(
      caseDefinition?.contract.expectedActionValues.find(
        ({ path: actionPath }) => actionPath === "resultLimit"
      )?.value
    ).toBe(1);
  });

  it("requires only the PA and appearance facts Dominic Calvert-Lewin's question asks for", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v33-lookup-calvert-appearances"
    )?.caseDefinition;

    expect(
      caseDefinition?.contract.requiredEvidence.map(({ field }) => field)
    ).toStrictEqual(["potentialAbility", "appearances"]);
  });

  it("keeps the CA-filter recommendation to one turn with explicit constraints", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v33-recommend-calvert-age-ca"
    )?.caseDefinition;

    expect({
      constraints: caseDefinition?.contract.expectedActionValues
        .filter(({ path: actionPath }) =>
          ["maxAge", "minimumCurrentAbility", "resultLimit"].includes(
            actionPath
          )
        )
        .map(({ path: actionPath, value }) => [actionPath, value]),
      turnCount: caseDefinition?.turns.length,
    }).toStrictEqual({
      constraints: [
        ["maxAge", 23],
        ["minimumCurrentAbility", 120],
        ["resultLimit", 3],
      ],
      turnCount: 1,
    });
  });

  it("inherits the age cap when adding a recommendation reference", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v33-recommend-add-semenyo-reference"
    )?.caseDefinition;

    expect({
      ageLimits: caseDefinition?.contract.expectedActionValues
        .filter(({ path: actionPath }) => actionPath === "maxAge")
        .map(({ turnId, value }) => [turnId, value]),
      secondTurnReferences:
        caseDefinition?.contract.expectedTurnToolActions[1]?.sourceRecords.map(
          ({ sourceId }) => sourceId
        ),
      turnCount: caseDefinition?.turns.length,
    }).toStrictEqual({
      ageLimits: [
        ["v33-recommend-add-semenyo-reference-turn-1", 18],
        ["v33-recommend-add-semenyo-reference-turn-2", 18],
      ],
      secondTurnReferences: [
        "28121568",
        "29194724",
        "2000385919",
        "2000357640",
        "2000375662",
      ],
      turnCount: 2,
    });
  });
});
