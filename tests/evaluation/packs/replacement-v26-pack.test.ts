import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { loadEvaluationCases } from "../../../evals/benchmark.js";
import { evaluationEvidenceBundleSchema } from "../../../evals/contracts.js";

const rootDirectory = process.cwd();

const replacementCaseDirectory = path.join(
  rootDirectory,
  "evals/replacements/v26/cases"
);

const v20CaseDirectory = path.join(
  rootDirectory,
  "evals/replacements/v20/cases"
);

const v21CaseDirectory = path.join(
  rootDirectory,
  "evals/replacements/v21/cases"
);

const v22CaseDirectory = path.join(
  rootDirectory,
  "evals/replacements/v22/cases"
);

const v23CaseDirectory = path.join(
  rootDirectory,
  "evals/replacements/v23/cases"
);

const v24CaseDirectory = path.join(
  rootDirectory,
  "evals/replacements/v24/cases"
);

const v25CaseDirectory = path.join(
  rootDirectory,
  "evals/replacements/v25/cases"
);

const replacementCases = loadEvaluationCases(
  "held_out",
  [],
  replacementCaseDirectory
);

const sourceIdsForCases = (
  cases: ReturnType<typeof loadEvaluationCases>
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
      .map(({ provider, sourceId }) => `${provider}:${sourceId}`)
  );

const teamNamesFromEvidence = (evidencePath: string): Set<string> => {
  const evidence = evaluationEvidenceBundleSchema.parse(
    JSON.parse(readFileSync(evidencePath, "utf-8"))
  );

  const teamSearchPayloadSchema = z.object({
    response: z.array(z.object({ team: z.object({ name: z.string() }) })),
  });

  return new Set(
    evidence.apiFootball.teamSearchResponses.flatMap(({ payload }) =>
      teamSearchPayloadSchema
        .parse(payload)
        .response.map(({ team }) => team.name.toLocaleLowerCase())
    )
  );
};

describe("v26 replacement held-out pack", () => {
  it("contains 16 independent cases balanced across workflows and origins", () => {
    const counts = new Map<string, number>();
    const origins = { mixed: 0, real: 0, synthetic: 0 };
    const workflows = new Map<string, number>();

    for (const { caseDefinition } of replacementCases) {
      const categoryKey = `${caseDefinition.workflow}:${caseDefinition.category}`;
      counts.set(categoryKey, (counts.get(categoryKey) ?? 0) + 1);
      origins[caseDefinition.origin] += 1;
      workflows.set(
        caseDefinition.workflow,
        (workflows.get(caseDefinition.workflow) ?? 0) + 1
      );
    }

    expect({
      count: replacementCases.length,
      origins,
      workflowCategories: Object.fromEntries(counts),
      workflows: Object.fromEntries(workflows),
    }).toStrictEqual({
      count: 16,
      origins: { mixed: 0, real: 12, synthetic: 4 },
      workflowCategories: {
        "player_comparison:boundary": 1,
        "player_comparison:multi_turn": 2,
        "player_comparison:ordinary": 1,
        "player_lookup:boundary": 1,
        "player_lookup:multi_turn": 2,
        "player_lookup:ordinary": 1,
        "player_recommendation:boundary": 1,
        "player_recommendation:multi_turn": 2,
        "player_recommendation:ordinary": 1,
        "team_recommendation:boundary": 1,
        "team_recommendation:multi_turn": 2,
        "team_recommendation:ordinary": 1,
      },
      workflows: {
        player_comparison: 4,
        player_lookup: 4,
        player_recommendation: 4,
        team_recommendation: 4,
      },
    });
  });

  it("does not reuse player mentions, source IDs, evidence groups, or scenario families", () => {
    const existingCases = [
      ...loadEvaluationCases("development", []),
      ...loadEvaluationCases("held_out", []),
      ...loadEvaluationCases("held_out", [], v20CaseDirectory),
      ...loadEvaluationCases("held_out", [], v21CaseDirectory),
      ...loadEvaluationCases("held_out", [], v22CaseDirectory),
      ...loadEvaluationCases("held_out", [], v23CaseDirectory),
      ...loadEvaluationCases("held_out", [], v24CaseDirectory),
      ...loadEvaluationCases("held_out", [], v25CaseDirectory),
    ];

    const oldCaseIds = new Set(
      existingCases.map(({ caseDefinition }) => caseDefinition.caseId)
    );

    const oldFamilies = new Set(
      existingCases.map(({ caseDefinition }) => caseDefinition.scenarioFamily)
    );

    const oldBundles = new Set(
      existingCases.map(({ caseDefinition }) => caseDefinition.evidenceBundleId)
    );

    const oldSources = sourceIdsForCases(existingCases);

    const oldMentions = new Set(
      existingCases.flatMap(({ caseDefinition }) =>
        caseDefinition.contract.resolvedPlayers.map(({ mention }) =>
          mention.toLocaleLowerCase()
        )
      )
    );

    const oldTurnText = existingCases
      .flatMap(({ caseDefinition }) =>
        caseDefinition.turns.map(({ userMessage }) =>
          userMessage.toLocaleLowerCase()
        )
      )
      .join("\n");

    const newMentions = replacementCases.flatMap(({ caseDefinition }) =>
      caseDefinition.contract.resolvedPlayers.map(({ mention }) =>
        mention.toLocaleLowerCase()
      )
    );

    const newTurnText = replacementCases
      .flatMap(({ caseDefinition }) =>
        caseDefinition.turns.map(({ userMessage }) =>
          userMessage.toLocaleLowerCase()
        )
      )
      .join("\n");

    const newSources = sourceIdsForCases(replacementCases);

    const newFamilies = replacementCases.map(
      ({ caseDefinition }) => caseDefinition.scenarioFamily
    );

    const teamNames = teamNamesFromEvidence(
      path.join(
        rootDirectory,
        "evals/evidence/replacement-v26-team-synthetic.json"
      )
    );

    expect({
      caseIds: replacementCases.filter(({ caseDefinition }) =>
        oldCaseIds.has(caseDefinition.caseId)
      ),
      duplicateFamilies: newFamilies.length - new Set(newFamilies).size,
      evidenceGroups: replacementCases.filter(({ caseDefinition }) =>
        oldBundles.has(caseDefinition.evidenceBundleId)
      ),
      missingMentions: newMentions.filter(
        (mention) => !newTurnText.includes(mention)
      ),
      overlappingFamilies: replacementCases.filter(({ caseDefinition }) =>
        oldFamilies.has(caseDefinition.scenarioFamily)
      ),
      overlappingMentions: newMentions.filter((mention) =>
        oldMentions.has(mention)
      ),
      overlappingPlayersInPrompts: [...teamNames].filter((name) =>
        oldTurnText.includes(name)
      ),
      overlappingSources: [...newSources].filter((sourceId) =>
        oldSources.has(sourceId)
      ),
    }).toStrictEqual({
      caseIds: [],
      duplicateFamilies: 0,
      evidenceGroups: [],
      missingMentions: [],
      overlappingFamilies: [],
      overlappingMentions: [],
      overlappingPlayersInPrompts: [],
      overlappingSources: [],
    });
  });

  it("keeps expected Understat source scopes aligned across each case contract", () => {
    const mismatches = replacementCases.flatMap(({ caseDefinition }) => {
      const declaredRecords = [
        ...caseDefinition.contract.resolvedPlayers.flatMap(
          ({ sourceRecords }) => sourceRecords
        ),
        ...caseDefinition.contract.requiredEvidence.map(
          ({ competition, provider, season, sourceId }) => ({
            competition,
            provider,
            season,
            sourceId,
          })
        ),
        ...caseDefinition.contract.toolActions.flatMap(
          ({ sourceRecords }) => sourceRecords
        ),
        ...caseDefinition.contract.expectedTurnToolActions.flatMap(
          ({ sourceRecords }) => sourceRecords
        ),
      ];

      return declaredRecords.flatMap((record) => {
        const hasUnderstatMetadata =
          record.provider === "understat" &&
          record.competition !== undefined &&
          record.season !== undefined;

        const hasMatchingScope = caseDefinition.contract.sourceScope.some(
          (scope) =>
            scope.provider === "understat" &&
            scope.sourceId === record.sourceId &&
            scope.competition === record.competition &&
            scope.season === record.season
        );

        return hasUnderstatMetadata && !hasMatchingScope
          ? [
              {
                caseId: caseDefinition.caseId,
                competition: record.competition,
                season: record.season,
                sourceId: record.sourceId,
              },
            ]
          : [];
      });
    });

    expect(mismatches).toStrictEqual([]);
  });

  it("does not expect identity resolution again on saved-result follow-ups", () => {
    const followups = replacementCases.filter(({ caseDefinition }) =>
      ["v26-lookup-lemar-saved-xa", "v26-lookup-hlozek-saved-season"].includes(
        caseDefinition.caseId
      )
    );

    expect(
      followups.map(({ caseDefinition }) => ({
        expectedIdentityStatuses:
          caseDefinition.contract.expectedIdentityStatuses,
        identityLookupTurns:
          caseDefinition.contract.expectedIdentityLookups.map(
            ({ turnId }) => turnId
          ),
        turnCount: caseDefinition.turns.length,
        turnIdentityStatuses:
          caseDefinition.contract.expectedTurnIdentityStatuses.map(
            ({ mention, status, turnId }) => ({
              mention,
              status,
              turnId,
            })
          ),
      }))
    ).toStrictEqual([
      {
        expectedIdentityStatuses: [
          { mention: "Adam Hlozek", status: "saved_result_reuse" },
        ],
        identityLookupTurns: ["v26-lookup-hlozek-saved-season-turn-1"],
        turnCount: 2,
        turnIdentityStatuses: [
          {
            mention: "Adam Hlozek",
            status: "resolved",
            turnId: "v26-lookup-hlozek-saved-season-turn-1",
          },
          {
            mention: "Adam Hlozek",
            status: "saved_result_reuse",
            turnId: "v26-lookup-hlozek-saved-season-turn-2",
          },
        ],
      },
      {
        expectedIdentityStatuses: [
          { mention: "Thomas Lemar", status: "saved_result_reuse" },
        ],
        identityLookupTurns: ["v26-lookup-lemar-saved-xa-turn-1"],
        turnCount: 2,
        turnIdentityStatuses: [
          {
            mention: "Thomas Lemar",
            status: "resolved",
            turnId: "v26-lookup-lemar-saved-xa-turn-1",
          },
          {
            mention: "Thomas Lemar",
            status: "saved_result_reuse",
            turnId: "v26-lookup-lemar-saved-xa-turn-2",
          },
        ],
      },
    ]);
  });

  it("uses the team names backed by the new synthetic provider responses", () => {
    const expectedSearchTerms = new Map([
      ["v26-team-bluewater-ranking", "Bluewater City FC"],
      ["v26-team-bluewater-ca-refinement", "Bluewater City FC"],
      ["v26-team-bluewater-ca-tightening", "Bluewater City FC"],
      ["v26-team-highlands-unmapped-roster", "Highlands Rovers"],
    ]);

    expect(
      replacementCases
        .filter(({ caseDefinition }) =>
          expectedSearchTerms.has(caseDefinition.caseId)
        )
        .map(({ caseDefinition }) => ({
          hasExpectedTeamName: caseDefinition.turns.some(({ userMessage }) =>
            userMessage.includes(
              expectedSearchTerms.get(caseDefinition.caseId) ?? ""
            )
          ),
          hasRetiredPrefix: caseDefinition.turns.some(({ userMessage }) =>
            userMessage.includes("V26")
          ),
        }))
    ).toStrictEqual([
      { hasExpectedTeamName: true, hasRetiredPrefix: false },
      { hasExpectedTeamName: true, hasRetiredPrefix: false },
      { hasExpectedTeamName: true, hasRetiredPrefix: false },
      { hasExpectedTeamName: true, hasRetiredPrefix: false },
    ]);
  });
});
