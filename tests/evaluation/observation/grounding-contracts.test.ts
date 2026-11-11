import { afterEach, describe, expect, it } from "vitest";

import { loadEvaluationCases } from "../../../evals/benchmark.js";
import { workerTrialResultSchema } from "../../../evals/contracts.js";
import { judgeInputForTrial } from "../../../evals/judge.js";
import { evaluationRunnerTest } from "../../fixtures/evaluation-runner-entry.js";

describe("evaluation evidence and judge grounding contracts", () => {
  afterEach(async () => {
    await evaluationRunnerTest.cleanup();
  });

  it("keeps each judge turn's participants, source mappings and failures separate", () => {
    const [loadedCase] = loadEvaluationCases("smoke", [
      "compare-add-third-synthetic-v1",
    ]);

    if (loadedCase === undefined) {
      throw new Error("The comparison evaluation case was not loaded.");
    }

    const [firstCaseTurn, secondCaseTurn] = loadedCase.caseDefinition.turns;

    if (firstCaseTurn === undefined || secondCaseTurn === undefined) {
      throw new Error("The comparison evaluation case needs two turns.");
    }

    const firstTurnPlayers = [
      {
        candidates: [
          {
            candidateId: "candidate:Elias Demo",
            canonicalIdentityId: "identity:elias",
            records: [
              { provider: "fm", sourceId: "fm-demo-01" },
              {
                competition: "EPL",
                provider: "understat",
                season: "2024/25",
                sourceId: "us-demo-01",
              },
            ],
          },
        ],
        lookupName: null,
        mention: "Elias Demo",
        resolutionStatus: "resolved",
        selectedCandidateId: "candidate:Elias Demo",
        selectedName: "Elias Demo",
      },
      {
        candidates: [
          {
            candidateId: "candidate:Synthetic Midfielder",
            canonicalIdentityId: "identity:midfielder",
            records: [
              { provider: "fm", sourceId: "fm-mid-01" },
              {
                competition: "EPL",
                provider: "understat",
                season: "2024/25",
                sourceId: "us-mid-01",
              },
            ],
          },
        ],
        lookupName: null,
        mention: "Synthetic Midfielder",
        resolutionStatus: "resolved",
        selectedCandidateId: "candidate:Synthetic Midfielder",
        selectedName: "Synthetic Midfielder",
      },
    ];

    const secondTurnPlayers = [
      ...firstTurnPlayers,
      {
        candidates: [
          {
            candidateId: "candidate:Synthetic Winger",
            canonicalIdentityId: "identity:winger",
            records: [
              { provider: "fm", sourceId: "fm-wing-01" },
              {
                competition: "La_liga",
                provider: "understat",
                season: "2024/25",
                sourceId: "us-wing-01",
              },
            ],
          },
        ],
        lookupName: null,
        mention: "Synthetic Winger",
        resolutionStatus: "resolved",
        selectedCandidateId: "candidate:Synthetic Winger",
        selectedName: "Synthetic Winger",
      },
    ];

    const worker = workerTrialResultSchema.parse({
      actionEvents: [
        {
          actionId: "comparison-attempt-1",
          caseId: loadedCase.caseDefinition.caseId,
          durationMs: 1,
          eventId: "comparison-attempt-1:returned",
          input: {
            players: ["Elias Demo", "Synthetic Midfielder"],
            seasonStartYear: 2024,
          },
          kind: "returned",
          name: "compare_player_records",
          outcome: "ready",
          result: "{}",
          runId: "run-test",
          sourceRecords: [],
          toolCallId: null,
          trialId: "trial-test",
          turnId: firstCaseTurn.turnId,
        },
      ],
      activeLookupResult: null,
      activeResults: {
        comparison: null,
        lookup: null,
        playerRecommendation: null,
        teamRecommendation: null,
      },
      conversationContext: [],
      deliveredEvidence: [],
      driverIssue: null,
      failureCategory: null,
      identityLookupEvents: [],
      outcomeKind: "player_comparison",
      outcomeStatus: "ready",
      players: secondTurnPlayers,
      requestKind: "player_comparison",
      teamRosterCoverage: null,
      toolMessages: [],
      turns: [
        {
          assistantMessages: ["The comparison covers all participants."],
          availableResultKinds: ["player_comparison"],
          clarificationAnswers: [],
          clarificationKinds: [],
          deliveredEvidenceIds: [],
          effectiveConditions: null,
          effectiveConstraints: [],
          nodeFailure: { category: "server", node: "understand_request" },
          outcomeKind: "player_comparison",
          outcomeStatus: "ready",
          players: firstTurnPlayers,
          requestKind: "player_comparison",
          reuse: null,
          turnId: firstCaseTurn.turnId,
          userMessage: firstCaseTurn.userMessage,
        },
        {
          assistantMessages: ["A third player was added."],
          availableResultKinds: ["player_comparison"],
          clarificationAnswers: [],
          clarificationKinds: [],
          deliveredEvidenceIds: [],
          effectiveConditions: null,
          effectiveConstraints: [],
          outcomeKind: "player_comparison",
          outcomeStatus: "ready",
          players: secondTurnPlayers,
          requestKind: "player_comparison",
          reuse: null,
          turnId: secondCaseTurn.turnId,
          userMessage: secondCaseTurn.userMessage,
        },
      ],
    });

    const judgeInput = judgeInputForTrial(loadedCase.caseDefinition, worker);

    expect(
      judgeInput.contract.requiredFacts.map(({ description }) => description)
    ).toStrictEqual([
      "fm:fm-demo-01 (Elias Demo) 当前能力 / CA [currentAbility] = 132",
      "fm:fm-mid-01 (Synthetic Midfielder) 当前能力 / CA [currentAbility] = 145",
      "fm:fm-wing-01 (Synthetic Winger) 当前能力 / CA [currentAbility] = 139",
      "understat:us-demo-01 (Elias Demo) 预期进球 / xG [expectedGoals] = 5.2",
      "understat:us-mid-01 (Synthetic Midfielder) 预期进球 / xG [expectedGoals] = 2.8",
    ]);

    expect(judgeInput.turns).toMatchObject([
      {
        nodeFailure: { category: "server", node: "understand_request" },
        participants: [
          {
            mention: "Elias Demo",
            resolvedName: "Elias Demo",
            sourceRecords: [
              {
                competition: null,
                provider: "fm",
                season: null,
                sourceId: "fm-demo-01",
              },
              {
                competition: "EPL",
                provider: "understat",
                season: "2024/25",
                sourceId: "us-demo-01",
              },
            ],
          },
          {
            mention: "Synthetic Midfielder",
            resolvedName: "Synthetic Midfielder",
            sourceRecords: [
              {
                competition: null,
                provider: "fm",
                season: null,
                sourceId: "fm-mid-01",
              },
              {
                competition: "EPL",
                provider: "understat",
                season: "2024/25",
                sourceId: "us-mid-01",
              },
            ],
          },
        ],
      },
      {
        nodeFailure: null,
        participants: [
          {
            mention: "Elias Demo",
            resolvedName: "Elias Demo",
            sourceRecords: [
              {
                competition: null,
                provider: "fm",
                season: null,
                sourceId: "fm-demo-01",
              },
              {
                competition: "EPL",
                provider: "understat",
                season: "2024/25",
                sourceId: "us-demo-01",
              },
            ],
          },
          {
            mention: "Synthetic Midfielder",
            resolvedName: "Synthetic Midfielder",
            sourceRecords: [
              {
                competition: null,
                provider: "fm",
                season: null,
                sourceId: "fm-mid-01",
              },
              {
                competition: "EPL",
                provider: "understat",
                season: "2024/25",
                sourceId: "us-mid-01",
              },
            ],
          },
          {
            mention: "Synthetic Winger",
            resolvedName: "Synthetic Winger",
            sourceRecords: [
              {
                competition: null,
                provider: "fm",
                season: null,
                sourceId: "fm-wing-01",
              },
              {
                competition: "La_liga",
                provider: "understat",
                season: "2024/25",
                sourceId: "us-wing-01",
              },
            ],
          },
        ],
      },
    ]);
    expect(judgeInput.actions).toMatchObject([
      {
        input: {
          players: ["Elias Demo", "Synthetic Midfielder"],
          seasonStartYear: 2024,
        },
        turnId: firstCaseTurn.turnId,
      },
    ]);
  });

  it("passes clarification confirmation and executed search parameters to the judge", () => {
    const [loadedCase] = loadEvaluationCases("smoke", [
      "lookup-mbappe-confirmation-real-v1",
    ]);

    if (loadedCase === undefined) {
      throw new Error("The Mbappé evaluation case was not loaded.");
    }

    const [caseTurn] = loadedCase.caseDefinition.turns;

    if (caseTurn === undefined) {
      throw new Error("The Mbappé evaluation case has no user turn.");
    }

    const candidateId = "source:understat:3423";

    const selectedCandidate = {
      candidateId,
      canonicalIdentityId: null,
      records: [
        {
          competition: "La_liga",
          provider: "understat",
          season: "2026/27",
          sourceId: "3423",
        },
      ],
    };

    const player = {
      candidates: [selectedCandidate],
      lookupName: "Kylian Mbappé",
      mention: "Kylian Mbappé",
      resolutionStatus: "resolved",
      selectedCandidateId: candidateId,
      selectedName: "Kylian Mbappe-Lottin",
    };

    const worker = workerTrialResultSchema.parse({
      actionEvents: [
        {
          actionId: "search-1",
          caseId: loadedCase.caseDefinition.caseId,
          durationMs: 1,
          eventId: "search-1:return",
          input: {
            seasonStartYear: 2024,
            sourceRecords: [{ provider: "understat", sourceId: "3423" }],
          },
          kind: "returned",
          name: "search_player_records",
          outcome: "not_found",
          result: "{}",
          runId: "run-test",
          sourceRecords: [
            {
              competition: null,
              provider: "understat",
              season: null,
              sourceId: "3423",
            },
          ],
          toolCallId: "search-call-1",
          trialId: "trial-test",
          turnId: caseTurn.turnId,
        },
      ],
      activeLookupResult: null,
      activeResults: {
        comparison: null,
        lookup: null,
        playerRecommendation: null,
        teamRecommendation: null,
      },
      conversationContext: [],
      deliveredEvidence: [],
      driverIssue: null,
      failureCategory: null,
      identityLookupEvents: [
        {
          actionId: "identity-1",
          candidates: [selectedCandidate],
          caseId: loadedCase.caseDefinition.caseId,
          durationMs: 1,
          error: null,
          eventId: "identity-1:return",
          kind: "returned",
          lookupName: "Kylian Mbappé",
          outcome: "needs_confirmation",
          runId: "run-test",
          selectedCandidateId: null,
          trialId: "trial-test",
          turnId: caseTurn.turnId,
        },
      ],
      outcomeKind: "player_lookup",
      outcomeStatus: "answer_ready",
      players: [player],
      requestKind: "player_lookup",
      teamRosterCoverage: null,
      toolMessages: [],
      turns: [
        {
          assistantMessages: ["No Understat rows were returned."],
          availableResultKinds: ["player_lookup"],
          clarificationAnswers: [{ kind: "identity", value: "1" }],
          clarificationKinds: ["identity"],
          deliveredEvidenceIds: [],
          effectiveConditions: null,
          effectiveConstraints: [
            { name: "understatSeasonStartYear", value: "2024" },
          ],
          outcomeKind: "player_lookup",
          outcomeStatus: "answer_ready",
          players: [player],
          requestKind: "player_lookup",
          reuse: null,
          turnId: caseTurn.turnId,
          userMessage: caseTurn.userMessage,
        },
      ],
    });

    const judgeInput = judgeInputForTrial(loadedCase.caseDefinition, worker);

    expect({
      actions: judgeInput.actions.map(({ input, name, outcome }) => ({
        input,
        name,
        outcome,
      })),
      clarificationAnswers: judgeInput.turns[0]?.clarificationAnswers,
      participants: judgeInput.turns[0]?.participants,
    }).toMatchObject({
      actions: [
        {
          input: { lookupName: "Kylian Mbappé" },
          name: "resolve_player_identity",
          outcome: "needs_confirmation",
        },
        {
          input: {
            seasonStartYear: 2024,
            sourceRecords: [{ provider: "understat", sourceId: "3423" }],
          },
          name: "search_player_records",
          outcome: "not_found",
        },
      ],
      clarificationAnswers: [{ kind: "identity", value: "1" }],
      participants: [
        {
          mention: "Kylian Mbappé",
          resolutionStatus: "resolved",
          resolvedName: "Kylian Mbappe-Lottin",
          selectedCandidateId: candidateId,
          sourceRecords: [
            {
              competition: "La_liga",
              provider: "understat",
              season: "2026/27",
              sourceId: "3423",
            },
          ],
        },
      ],
    });
  });

  it.each([
    "player_lookup",
    "player_comparison",
    "player_recommendation",
    "team_recommendation",
  ] as const)("keeps 12 %s cases in the approved split", (workflow) => {
    const development = loadEvaluationCases("development", []).filter(
      ({ caseDefinition }) => caseDefinition.workflow === workflow
    );

    const heldOut = loadEvaluationCases("held_out", []).filter(
      ({ caseDefinition }) => caseDefinition.workflow === workflow
    );

    const scenarioSplits = new Map<string, Set<string>>();

    for (const loadedCase of [...development, ...heldOut]) {
      const { scenarioFamily, split } = loadedCase.caseDefinition;
      const splits = scenarioSplits.get(scenarioFamily) ?? new Set<string>();
      splits.add(split);
      scenarioSplits.set(scenarioFamily, splits);
    }

    expect({
      development: {
        categories: evaluationRunnerTest.categoryCounts(development),
        count: development.length,
        origins: evaluationRunnerTest.originCounts(development),
      },
      heldOut: {
        categories: evaluationRunnerTest.categoryCounts(heldOut),
        count: heldOut.length,
        origins: evaluationRunnerTest.originCounts(heldOut),
      },
      scenarioFamiliesStayInOneSplit: [...scenarioSplits.values()].every(
        (splits) => splits.size === 1
      ),
      total: development.length + heldOut.length,
    }).toStrictEqual({
      development: {
        categories: { boundary: 3, multi_turn: 2, ordinary: 3 },
        count: 8,
        origins: { real: 4, synthetic: 4 },
      },
      heldOut: {
        categories: { boundary: 1, multi_turn: 2, ordinary: 1 },
        count: 4,
        origins: { real: 4, synthetic: 0 },
      },
      scenarioFamiliesStayInOneSplit: true,
      total: 12,
    });
  });

  it("keeps judge anchors in four balanced, independent groups", () => {
    const categories = [
      "correct_paraphrase",
      "factual_contradiction",
      "unsupported_fact",
      "false_execution_claim",
    ];

    expect({
      categoryCounts: categories.map((category) => ({
        category,
        count: evaluationRunnerTest.judgeAnchors.filter(
          (anchor) => anchor.category === category
        ).length,
        development: evaluationRunnerTest.judgeAnchors.filter(
          (anchor) =>
            anchor.category === category && anchor.split === "development"
        ).length,
        validation: evaluationRunnerTest.judgeAnchors.filter(
          (anchor) =>
            anchor.category === category && anchor.split === "validation"
        ).length,
      })),
      familySplits: new Map(
        evaluationRunnerTest.judgeAnchors.map((anchor) => [
          anchor.scenarioFamily,
          anchor.split,
        ])
      ).size,
      total: evaluationRunnerTest.judgeAnchors.length,
    }).toStrictEqual({
      categoryCounts: categories.map((category) => ({
        category,
        count: 8,
        development: 4,
        validation: 4,
      })),
      familySplits: 32,
      total: 32,
    });
  });
});
