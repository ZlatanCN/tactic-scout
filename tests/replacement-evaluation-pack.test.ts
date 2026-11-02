import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { loadEvaluationCases } from "../evals/benchmark.js";
import { evaluationEvidenceBundleSchema } from "../evals/contracts.js";

const rootDirectory = process.cwd();

const replacementCaseDirectory = path.join(
  rootDirectory,
  "evals/replacements/v20/cases"
);

const replacementPlayerNames = [
  "Niclas Füllkrug",
  "Michael Olise",
  "Ante Budimir",
  "Phillip Tietz",
  "Michael Gregoritsch",
  "Aaron Martin",
  "Antoine Griezmann",
  "Ademola Lookman",
].map((name) => name.toLocaleLowerCase());

type OriginCounts = { mixed: number; real: number; synthetic: number };

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

const apiFootballTeamSearchPayloadSchema = z.object({
  response: z.array(
    z.object({
      team: z.object({ id: z.number().int(), name: z.string() }),
    })
  ),
});

const apiFootballSquadPayloadSchema = z.object({
  response: z.array(
    z.object({
      players: z.array(z.object({ id: z.number().int() })),
      team: z.object({ id: z.number().int() }),
    })
  ),
});

const apiFootballSourceIdsFromEvidence = (
  evidence: z.output<typeof evaluationEvidenceBundleSchema>
): Set<string> => {
  const sourceIds = new Set<string>();

  for (const { payload } of evidence.apiFootball.teamSearchResponses) {
    const parsedPayload = apiFootballTeamSearchPayloadSchema.parse(payload);

    for (const { team } of parsedPayload.response) {
      sourceIds.add(`team:${team.id}`);
    }
  }

  for (const { payload } of evidence.apiFootball.squadResponses) {
    const parsedPayload = apiFootballSquadPayloadSchema.parse(payload);

    for (const { players, team } of parsedPayload.response) {
      sourceIds.add(`team:${team.id}`);

      for (const player of players) {
        sourceIds.add(`player:${player.id}`);
      }
    }
  }

  return sourceIds;
};

const apiFootballTeamNamesFromEvidence = (
  evidence: z.output<typeof evaluationEvidenceBundleSchema>
): Set<string> =>
  new Set(
    evidence.apiFootball.teamSearchResponses.flatMap(({ payload }) =>
      apiFootballTeamSearchPayloadSchema
        .parse(payload)
        .response.map(({ team }) => team.name.toLocaleLowerCase())
    )
  );

describe("v20 replacement held-out pack", () => {
  const replacementCases = loadEvaluationCases(
    "held_out",
    [],
    replacementCaseDirectory
  );

  it("has 16 held-out cases with the planned workflow and category split", () => {
    const counts = new Map<string, number>();
    const origins: OriginCounts = { mixed: 0, real: 0, synthetic: 0 };
    const workflows = new Map<string, number>();

    for (const { caseDefinition } of replacementCases) {
      const key = `${caseDefinition.workflow}:${caseDefinition.category}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
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

  it("does not reuse a development or exposed-held-out identity, scenario, or evidence group", () => {
    const existingCases = [
      ...loadEvaluationCases("development", []),
      ...loadEvaluationCases("held_out", []),
    ];

    const existingCaseIds = new Set(
      existingCases.map(({ caseDefinition }) => caseDefinition.caseId)
    );

    const existingFamilies = new Set(
      existingCases.map(({ caseDefinition }) => caseDefinition.scenarioFamily)
    );

    const existingBundles = new Set(
      existingCases.map(({ caseDefinition }) => caseDefinition.evidenceBundleId)
    );

    const oldSources = sourceIdsForCases(existingCases);
    const replacementSources = sourceIdsForCases(replacementCases);

    const existingPlayerMentions = new Set(
      existingCases.flatMap(({ caseDefinition }) =>
        caseDefinition.contract.resolvedPlayers.map(({ mention }) =>
          mention.toLocaleLowerCase()
        )
      )
    );

    const replacementPlayerMentions = replacementCases.flatMap(
      ({ caseDefinition }) =>
        caseDefinition.contract.resolvedPlayers.map(({ mention }) =>
          mention.toLocaleLowerCase()
        )
    );

    const existingTurnText = existingCases
      .flatMap(({ caseDefinition }) =>
        caseDefinition.turns.map(({ userMessage }) =>
          userMessage.toLocaleLowerCase()
        )
      )
      .join("\n");

    const replacementTurnText = replacementCases
      .flatMap(({ caseDefinition }) =>
        caseDefinition.turns.map(({ userMessage }) =>
          userMessage.toLocaleLowerCase()
        )
      )
      .join("\n");

    const overlappingPlayerNames = replacementPlayerNames.filter((name) =>
      existingTurnText.includes(name)
    );

    const missingPlayerNames = replacementPlayerNames.filter(
      (name) => !replacementTurnText.includes(name)
    );

    const overlappingSources = [...replacementSources].filter((sourceId) =>
      oldSources.has(sourceId)
    );

    const overlappingPlayerMentions = replacementPlayerMentions.filter(
      (mention) => existingPlayerMentions.has(mention)
    );

    const families = replacementCases.map(
      ({ caseDefinition }) => caseDefinition.scenarioFamily
    );

    expect({
      bundles: replacementCases.filter(({ caseDefinition }) =>
        existingBundles.has(caseDefinition.evidenceBundleId)
      ),
      caseIds: replacementCases.filter(({ caseDefinition }) =>
        existingCaseIds.has(caseDefinition.caseId)
      ),
      families: replacementCases.filter(({ caseDefinition }) =>
        existingFamilies.has(caseDefinition.scenarioFamily)
      ),
      familyCount: new Set(families).size,
      missingPlayerNames,
      overlappingPlayerMentions,
      overlappingPlayerNames,
      overlappingSources,
    }).toStrictEqual({
      bundles: [],
      caseIds: [],
      families: [],
      familyCount: 16,
      missingPlayerNames: [],
      overlappingPlayerMentions: [],
      overlappingPlayerNames: [],
      overlappingSources: [],
    });

    const teamEvidencePath = path.join(
      rootDirectory,
      "evals/evidence/replacement-v20-team-synthetic.json"
    );

    const teamEvidence = evaluationEvidenceBundleSchema.parse(
      JSON.parse(readFileSync(teamEvidencePath, "utf-8"))
    );

    const existingTeamNames = apiFootballTeamNamesFromEvidence(teamEvidence);

    const overlappingTeamNames = [...existingTeamNames].filter((teamName) =>
      existingTurnText.includes(teamName)
    );

    expect(overlappingTeamNames).toStrictEqual([]);
  });

  it("uses a scripted answer for the identity interrupt", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: definition }) =>
        definition.caseId === "v20-lookup-aaron-martin-identity-resume"
    )?.caseDefinition;

    if (caseDefinition === undefined) {
      throw new Error("The v20 identity-resume case is missing.");
    }

    expect(caseDefinition.turns[0]?.clarificationAnswers).toStrictEqual([
      { expectedKind: "identity", resumeValue: "1" },
    ]);
    expect(caseDefinition.contract.expectedIdentityLookups).toContainEqual({
      lookupName: "Aaron Martin",
      status: "needs_confirmation",
      turnId: "v20-lookup-aaron-martin-identity-resume-turn-1",
    });
  });

  it("checks the comparison's inherited league at the action seam", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: definition }) =>
        definition.caseId ===
        "v20-compare-add-budimir-with-bundesliga-inherited"
    )?.caseDefinition;

    if (caseDefinition === undefined) {
      throw new Error("The v20 explicit-scope addition case is missing.");
    }

    expect(caseDefinition.contract.expectedActionValues).toContainEqual(
      expect.objectContaining({
        name: "compare_player_records",
        path: "competition",
        source: "input",
        turnId: "v20-compare-add-budimir-with-bundesliga-inherited-turn-2",
        value: "Bundesliga",
      })
    );

    const secondTurnRecords =
      caseDefinition.contract.expectedTurnToolActions.find(({ turnId }) =>
        turnId.endsWith("turn-2")
      )?.sourceRecords;

    expect(secondTurnRecords).not.toContainEqual({
      provider: "understat",
      sourceId: "1235",
    });
  });

  it("checks PA and result limit on recommendation tool inputs", () => {
    const caseDefinition = replacementCases.find(
      ({ caseDefinition: definition }) =>
        definition.caseId === "v20-recommend-refine-pa-and-result-limit"
    )?.caseDefinition;

    if (caseDefinition === undefined) {
      throw new Error("The v20 PA/result-limit refinement case is missing.");
    }

    expect(caseDefinition.contract.expectedActionValues).toContainEqual(
      expect.objectContaining({
        name: "recommend_player_candidates",
        path: "minimumPotentialAbility",
        source: "input",
        turnId: "v20-recommend-refine-pa-and-result-limit-turn-2",
        value: 160,
      })
    );
    expect(caseDefinition.contract.expectedActionValues).toContainEqual(
      expect.objectContaining({
        name: "recommend_player_candidates",
        path: "resultLimit",
        source: "input",
        turnId: "v20-recommend-refine-pa-and-result-limit-turn-2",
        value: 2,
      })
    );
    expect(caseDefinition.contract.expectedTurnConstraints).toStrictEqual([]);
  });

  it("stores the synthetic team evidence under a new bundle hash", () => {
    const evidencePath = path.join(
      rootDirectory,
      "evals/evidence/replacement-v20-team-synthetic.json"
    );

    const contents = readFileSync(evidencePath);

    const evidence = evaluationEvidenceBundleSchema.parse(
      JSON.parse(contents.toString("utf-8"))
    );

    const cases = replacementCases.filter(
      ({ caseDefinition }) =>
        caseDefinition.evidenceBundleId === evidence.bundleId
    );

    expect(evidence.origin).toBe("synthetic");
    expect(cases).toHaveLength(4);
    expect(
      cases.every(
        ({ caseDefinition }) =>
          caseDefinition.evidenceBundleSha256 ===
          createHash("sha256").update(contents).digest("hex")
      )
    ).toBeTruthy();
  });

  it("keeps synthetic team action source IDs aligned with the API responses", () => {
    const evidencePath = path.join(
      rootDirectory,
      "evals/evidence/replacement-v20-team-synthetic.json"
    );

    const evidence = evaluationEvidenceBundleSchema.parse(
      JSON.parse(readFileSync(evidencePath, "utf-8"))
    );

    const fixtureSourceIds = apiFootballSourceIdsFromEvidence(evidence);

    const teamCases = replacementCases.filter(
      ({ caseDefinition }) => caseDefinition.workflow === "team_recommendation"
    );

    const unknownActionSourceIds = teamCases.flatMap(({ caseDefinition }) => {
      const actions = [
        ...caseDefinition.contract.expectedTurnToolActions,
        ...caseDefinition.contract.toolActions,
      ];

      return actions.flatMap(({ sourceRecords }) =>
        sourceRecords
          .filter(({ provider }) => provider === "api_football")
          .map(({ sourceId }) => sourceId)
          .filter((sourceId) => !fixtureSourceIds.has(sourceId))
      );
    });

    expect(teamCases).toHaveLength(4);
    expect(unknownActionSourceIds).toStrictEqual([]);
  });

  it("regenerates the three real bundles from the local source snapshots", () => {
    const evidenceDirectory = path.join(
      rootDirectory,
      ".data/evals/v20-evidence"
    );

    const realBundleIds = [
      "replacement-v20-real-player-data",
      "replacement-v20-real-recommendation-data",
    ];

    for (const bundleId of realBundleIds) {
      const bundlePath = path.join(evidenceDirectory, `${bundleId}.json`);

      if (!existsSync(bundlePath)) {
        continue;
      }

      const contents = readFileSync(bundlePath);

      const bundle = evaluationEvidenceBundleSchema.parse(
        JSON.parse(contents.toString("utf-8"))
      );

      const cases = replacementCases.filter(
        ({ caseDefinition }) => caseDefinition.evidenceBundleId === bundleId
      );

      expect(bundle.origin).toBe("real");
      expect(cases.length).toBeGreaterThan(0);
      expect(
        cases.every(
          ({ caseDefinition }) =>
            caseDefinition.evidenceBundleSha256 ===
            createHash("sha256").update(contents).digest("hex")
        )
      ).toBeTruthy();
    }
  });
});
