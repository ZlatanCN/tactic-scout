import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadEvaluationCases } from "../evals/benchmark.js";

const rootDirectory = process.cwd();

const replacementDirectory = path.join(
  rootDirectory,
  "evals/replacements/v31/cases"
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

const replacementCases = loadEvaluationCases(
  "held_out",
  [],
  replacementDirectory
);

type EvaluationCaseDefinition =
  (typeof replacementCases)[number]["caseDefinition"];

const sourceKeysForCases = (
  cases: { caseDefinition: EvaluationCaseDefinition }[]
): Set<string> =>
  new Set(
    cases
      .flatMap(({ caseDefinition }) => [
        ...caseDefinition.contract.sourceScope,
        ...caseDefinition.contract.resolvedPlayers.flatMap(
          ({ sourceRecords }) => sourceRecords
        ),
        ...caseDefinition.contract.requiredEvidence.map(
          ({ provider, sourceId }) => ({ provider, sourceId })
        ),
      ])
      .map(({ provider, sourceId }) => {
        const normalizedSourceId = sourceId.split(":").at(-1) ?? sourceId;

        return `${provider}:${normalizedSourceId}`;
      })
  );

describe("v31 replacement held-out pack", () => {
  it("covers all workflows with 12 real and 4 synthetic cases", () => {
    const counts = new Map<string, number>();
    const origins = { mixed: 0, real: 0, synthetic: 0 };

    for (const { caseDefinition } of replacementCases) {
      counts.set(
        caseDefinition.workflow,
        (counts.get(caseDefinition.workflow) ?? 0) + 1
      );
      origins[caseDefinition.origin] += 1;
    }

    expect({
      count: replacementCases.length,
      origins,
      workflows: Object.fromEntries(counts),
    }).toStrictEqual({
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

  it("uses the Reep-linked Understat ID when its display name differs", () => {
    const moffiCase = replacementCases.find(
      (loadedCase) =>
        loadedCase.caseDefinition.caseId === "v31-lookup-moffi-profile"
    )?.caseDefinition;

    expect(moffiCase?.contract.resolvedPlayers[0]?.sourceRecords).toStrictEqual(
      [
        { provider: "fm", sourceId: "47079007" },
        {
          competition: "Bundesliga",
          provider: "understat",
          season: "2026/27",
          sourceId: "8997",
        },
      ]
    );
  });

  it("uses new identities, source records, scenario families, and evidence groups", () => {
    const priorCases = [
      ...loadEvaluationCases("development", []),
      ...loadEvaluationCases("held_out", []),
      ...priorReplacementDirectories.flatMap((directory) =>
        loadEvaluationCases("held_out", [], directory)
      ),
    ];

    const priorCaseIds = new Set(
      priorCases.map(({ caseDefinition }) => caseDefinition.caseId)
    );

    const priorFamilies = new Set(
      priorCases.map(({ caseDefinition }) => caseDefinition.scenarioFamily)
    );

    const priorBundles = new Set(
      priorCases.map(({ caseDefinition }) => caseDefinition.evidenceBundleId)
    );

    const priorSources = sourceKeysForCases(priorCases);

    const priorMentions = new Set(
      priorCases.flatMap(({ caseDefinition }) =>
        caseDefinition.contract.resolvedPlayers.map(({ mention }) =>
          mention.toLocaleLowerCase()
        )
      )
    );

    expect(
      replacementCases.flatMap(({ caseDefinition }) => [
        ...(priorCaseIds.has(caseDefinition.caseId)
          ? [caseDefinition.caseId]
          : []),
        ...(priorFamilies.has(caseDefinition.scenarioFamily)
          ? [caseDefinition.scenarioFamily]
          : []),
        ...(priorBundles.has(caseDefinition.evidenceBundleId)
          ? [caseDefinition.evidenceBundleId]
          : []),
        ...caseDefinition.contract.resolvedPlayers
          .filter(({ mention }) =>
            priorMentions.has(mention.toLocaleLowerCase())
          )
          .map(({ mention }) => mention),
        ...[...sourceKeysForCases([{ caseDefinition }])].filter((sourceKey) =>
          priorSources.has(sourceKey)
        ),
      ])
    ).toStrictEqual([]);
  });

  it("freezes age calculations to the case date and keeps season performance out of FM", () => {
    expect(
      new Set(
        replacementCases.map(({ caseDefinition }) => caseDefinition.ageAsOfDate)
      )
    ).toStrictEqual(new Set(["2026-11-04"]));

    const performanceFields = new Set([
      "appearances",
      "assists",
      "expectedAssists",
      "expectedGoals",
      "goals",
      "minutes",
      "shots",
    ]);

    const provenanceErrors = replacementCases.flatMap(({ caseDefinition }) => {
      const fmPerformanceEvidence =
        caseDefinition.contract.requiredEvidence.filter(
          ({ field, provider }) =>
            performanceFields.has(field) && provider !== "understat"
        );

      const understatSourcesWithoutMatchingScope = [
        ...caseDefinition.contract.resolvedPlayers.flatMap(
          ({ sourceRecords }) => sourceRecords
        ),
        ...caseDefinition.contract.requiredEvidence,
        ...caseDefinition.contract.toolActions.flatMap(
          ({ sourceRecords }) => sourceRecords
        ),
        ...caseDefinition.contract.expectedTurnToolActions.flatMap(
          ({ sourceRecords }) => sourceRecords
        ),
      ].filter(
        (record) =>
          record.provider === "understat" &&
          !caseDefinition.contract.sourceScope.some(
            (scope) =>
              scope.provider === "understat" &&
              scope.sourceId === record.sourceId &&
              scope.competition === record.competition &&
              scope.season === record.season
          )
      );

      const invalidApiFootballIds = caseDefinition.contract.sourceScope
        .filter(({ provider }) => provider === "api_football")
        .filter(({ sourceId }) => !/^\d+$/u.test(sourceId));

      return [
        ...fmPerformanceEvidence.map(({ field, sourceId }) => ({
          caseId: caseDefinition.caseId,
          field,
          sourceId,
        })),
        ...understatSourcesWithoutMatchingScope.map(
          ({ competition, season, sourceId }) => ({
            caseId: caseDefinition.caseId,
            competition,
            season,
            sourceId,
          })
        ),
        ...invalidApiFootballIds.map(({ sourceId }) => ({
          caseId: caseDefinition.caseId,
          sourceId,
        })),
      ];
    });

    expect(provenanceErrors).toStrictEqual([]);
  });

  it("includes each resolved provider ID in the matching tool action", () => {
    const missingLinks = replacementCases.flatMap(({ caseDefinition }) =>
      caseDefinition.contract.expectedIdentityLookups.flatMap(
        ({ lookupName, turnId }) => {
          const player = caseDefinition.contract.resolvedPlayers.find(
            ({ mention }) => mention === lookupName
          );

          const actionRecords = caseDefinition.contract.expectedTurnToolActions
            .filter((action) => action.turnId === turnId)
            .flatMap(({ sourceRecords }) => sourceRecords);

          return (player?.sourceRecords ?? [])
            .filter(
              (source) =>
                !actionRecords.some(
                  (actionSource) =>
                    actionSource.provider === source.provider &&
                    actionSource.sourceId === source.sourceId
                )
            )
            .map((source) => ({
              caseId: caseDefinition.caseId,
              lookupName,
              sourceId: source.sourceId,
              turnId,
            }));
        }
      )
    );

    expect(missingLinks).toStrictEqual([]);
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

  it("requires only the Samatta facts requested by the question", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: currentCase }) =>
        currentCase.caseId === "v31-lookup-samatta-appearances"
    )?.caseDefinition;

    expect(
      caseDefinition?.contract.requiredEvidence.map(({ field }) => field)
    ).toStrictEqual(["currentAbility", "potentialAbility", "appearances"]);
  });
});
