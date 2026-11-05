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
  path.join(rootDirectory, "evals/replacements/v31/cases")
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

describe("v31 replacement held-out pack", () => {
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

  it("keeps the linked Understat ID when the display name differs", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v31-lookup-moffi-profile"
    )?.caseDefinition;

    expect(
      caseDefinition?.contract.resolvedPlayers[0]?.sourceRecords
    ).toStrictEqual([
      { provider: "fm", sourceId: "47079007" },
      {
        competition: "Bundesliga",
        provider: "understat",
        season: "2026/27",
        sourceId: "8997",
      },
    ]);
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

  it("reuses the active lookup for season and xA follow-ups", () => {
    const followups = replacementCases
      .filter(({ caseDefinition }) =>
        ["v31-lookup-pablo-saved-season", "v31-lookup-amo-saved-xa"].includes(
          caseDefinition.caseId
        )
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

  it("defines resultLimit as one candidate per recommendation list", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v31-recommend-samatta-under-16-pa"
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

  it("retains the original V31 Samatta contract that over-required current CA", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v31-lookup-samatta-appearances"
    )?.caseDefinition;

    expect(
      caseDefinition?.contract.requiredEvidence.map(({ field }) => field)
    ).toStrictEqual(["currentAbility", "potentialAbility", "appearances"]);
  });
});
