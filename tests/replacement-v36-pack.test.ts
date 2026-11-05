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
  path.join(rootDirectory, "evals/replacements/v36/cases")
);

const priorReplacementDirectories = Array.from({ length: 16 }, (_, index) =>
  path.join(rootDirectory, `evals/replacements/v${index + 20}/cases`)
);

const priorCases = [
  ...loadEvaluationCases("development", []),
  ...loadEvaluationCases("held_out", []),
  ...priorReplacementDirectories.flatMap((directory) =>
    loadEvaluationCases("held_out", [], directory)
  ),
];

describe("v36 replacement held-out pack", () => {
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

  it("uses identities, sources, scenario families, and bundles new to V1–V35", () => {
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

  it("tests an English possessive query against the canonical player identity", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v36-lookup-konrad-laimer-profile"
    )?.caseDefinition;

    expect({
      mention: caseDefinition?.contract.resolvedPlayers[0]?.mention,
      message: caseDefinition?.turns[0]?.userMessage,
    }).toStrictEqual({
      mention: "Konrad Laimer",
      message:
        "Look up Konrad Laimer's FM profile and 2026/27 Bundesliga performance.",
    });
  });

  it("asks about saved xA without adding an unrelated pronoun identity check", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v36-lookup-florian-sotoca-saved-xa"
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
        currentCase.caseId === "v36-compare-add-antony-la-liga"
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

  it("retains the age and CA filters with independently calculated candidates", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v36-recommend-solanke-age-ca-filter"
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
        ["maxAge", 22],
        ["minimumCurrentAbility", 125],
        ["resultLimit", 3],
      ],
      resultIds: ["2000013430", "2000031653", "2000182279"],
    });
  });

  it("recomputes the full candidate list after adding a second reference", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v36-recommend-add-buendia-reference"
    )?.caseDefinition;

    expect(
      caseDefinition?.contract.expectedTurnToolActions.map(
        ({ sourceRecords }) => sourceRecords.map(({ sourceId }) => sourceId)
      )
    ).toStrictEqual([
      ["83174759", "85142865", "67291985", "27128917"],
      ["83174759", "67201783", "49055037", "27128917", "85142865"],
    ]);
  });
});
