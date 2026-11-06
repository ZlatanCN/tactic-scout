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
  path.join(rootDirectory, "evals/replacements/v37/cases")
);

const priorReplacementDirectories = Array.from({ length: 17 }, (_, index) =>
  path.join(rootDirectory, `evals/replacements/v${index + 20}/cases`)
);

const priorCases = [
  ...loadEvaluationCases("development", []),
  ...loadEvaluationCases("held_out", []),
  ...priorReplacementDirectories.flatMap((directory) =>
    loadEvaluationCases("held_out", [], directory)
  ),
];

describe("v37 replacement held-out pack", () => {
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

  it("uses identities, sources, scenario families, and bundles new to V1–V36", () => {
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

  it("tests a possessive player query against the canonical name and source", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v37-lookup-bilal-nadir-possessive"
    )?.caseDefinition;

    expect({
      mention: caseDefinition?.contract.resolvedPlayers[0]?.mention,
      message: caseDefinition?.turns[0]?.userMessage,
      records: caseDefinition?.contract.resolvedPlayers[0]?.sourceRecords.map(
        ({ provider, sourceId }) => [provider, sourceId]
      ),
    }).toStrictEqual({
      mention: "Bilal Nadir",
      message:
        "Look up Bilal Nadir's FM profile and 2026/27 Bundesliga performance.",
      records: [
        ["fm", "2000011617"],
        ["understat", "9673"],
      ],
    });
  });

  it("asks about saved xA without adding an unrelated pronoun identity check", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v37-lookup-alex-iwobi-saved-xa"
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

  it("carries a La Liga scope when a third comparison participant is added", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v37-compare-add-ilias-la-liga"
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

  it("pins the Serie A scope for the two-player comparison", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v37-compare-simeone-hojlund-serie-a"
    )?.caseDefinition;

    expect(
      caseDefinition?.contract.expectedActionValues.find(
        ({ path: actionPath }) => actionPath === "competition"
      )?.value
    ).toBe("Serie A");
  });

  it("uses age and CA filters with independently calculated candidates", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v37-recommend-bernardeschi-age-ca-filter"
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
      resultIds: ["49059201", "43425069", "2000062523"],
    });
  });

  it("recomputes the full candidate list after adding another reference", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v37-recommend-add-makengo-reference"
    )?.caseDefinition;

    expect(
      caseDefinition?.contract.expectedTurnToolActions.map(
        ({ sourceRecords }) => sourceRecords.map(({ sourceId }) => sourceId)
      )
    ).toStrictEqual([
      ["2001040995", "49063538", "91193169", "2000164598"],
      ["2001040995", "85144993", "49063538", "2000047196", "2000141600"],
    ]);
  });
});
