import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkCaseContract, emptyWorkerResult } from "../../evals/checks.js";
import { evaluationCaseSchema } from "../../evals/contracts.js";
import type { WorkerTrialResult } from "../../evals/contracts.js";

const observationPlayer = (
  mention: string,
  resolutionStatus: string,
  selectedCandidateId: string | null
) => ({
  candidates: [],
  lookupName: null,
  mention,
  resolutionStatus,
  selectedCandidateId,
  selectedName: mention,
});

describe("evaluation identity lookup checks", () => {
  it("accepts a Latin spelling variant while requiring the exact selected identity", () => {
    const baseCase = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(process.cwd(), "evals/cases/lookup-haaland-real-v1.json"),
          "utf-8"
        )
      )
    );

    const expectedPlayer = {
      candidateId: "reep:reep-jorgen-1",
      canonicalIdentityId: "reep-jorgen-1",
      mention: "Jørgen Strand Larsen",
      sourceRecords: [{ provider: "fm" as const, sourceId: "fm-jorgen-1" }],
    };

    const caseDefinition = {
      ...baseCase,
      contract: {
        ...baseCase.contract,
        expectedActionValues: [],
        expectedActiveLookupSourceRecords: [],
        expectedActiveResultValues: [],
        expectedIdentityLookups: [],
        expectedIdentityStatuses: [
          { mention: expectedPlayer.mention, status: "resolved" },
        ],
        expectedTeamRosterCoverage: null,
        expectedTurnConstraints: [],
        expectedTurnIdentityStatuses: [],
        expectedTurnParameters: [],
        expectedTurnToolActions: [],
        outcomeStatus: "answer_ready" as const,
        requiredAbstentions: [],
        requiredEvidence: [],
        resolvedPlayers: [expectedPlayer],
        sourceScope: [],
        taskKind: "player_lookup" as const,
        toolActions: [],
      },
    };

    const player = {
      candidates: [
        {
          candidateId: expectedPlayer.candidateId,
          canonicalIdentityId: expectedPlayer.canonicalIdentityId,
          records: expectedPlayer.sourceRecords,
        },
      ],
      lookupName: "Jorgen Strand Larsen",
      mention: "Jorgen Strand Larsen",
      resolutionStatus: "resolved",
      selectedCandidateId: expectedPlayer.candidateId,
      selectedName: "Jorgen Strand Larsen",
    };

    const worker = {
      ...emptyWorkerResult("variant test"),
      outcomeKind: "player_lookup",
      outcomeStatus: "answer_ready",
      players: [player],
      requestKind: "player_lookup",
    } satisfies WorkerTrialResult;

    const checks = checkCaseContract(caseDefinition, worker);

    const identityStatuses = checks
      .filter(({ id }) =>
        ["identity-resolution-status", "resolved-identity"].includes(id)
      )
      .map(({ id, status }) => [id, status]);

    const wrongIdentityWorker = {
      ...worker,
      players: [
        {
          ...player,
          candidates: [
            {
              ...player.candidates[0],
              candidateId: "reep:some-other-player",
              canonicalIdentityId: "some-other-player",
            },
          ],
          selectedCandidateId: "reep:some-other-player",
        },
      ],
    } satisfies WorkerTrialResult;

    const wrongIdentityStatus = checkCaseContract(
      caseDefinition,
      wrongIdentityWorker
    ).find(({ id }) => id === "resolved-identity")?.status;

    expect({ identityStatuses, wrongIdentityStatus }).toStrictEqual({
      identityStatuses: [
        ["identity-resolution-status", "passed"],
        ["resolved-identity", "passed"],
      ],
      wrongIdentityStatus: "failed",
    });
  });

  it("accepts an accent-only mention difference but still requires the same identity ID", () => {
    const caseDefinition = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "evals/cases/lookup-identity-clarification-v1.json"
          ),
          "utf-8"
        )
      )
    );

    const [initialTurn, followupTurn, unavailableTurn] = caseDefinition.turns;

    if (
      initialTurn === undefined ||
      followupTurn === undefined ||
      unavailableTurn === undefined
    ) {
      throw new Error("The lookup fixture must declare three user turns.");
    }

    const expectedPlayer = {
      candidateId: "reep:identity-demo-01",
      canonicalIdentityId: "identity-demo-01",
      mention: "Nikola Krstović",
      sourceRecords: [{ provider: "fm" as const, sourceId: "fm-demo-01" }],
    };

    const caseWithExpectedIdentity = {
      ...caseDefinition,
      contract: {
        ...caseDefinition.contract,
        expectedIdentityStatuses: [
          { mention: "Nikola Krstović", status: "resolved" },
        ],
        expectedTurnIdentityStatuses: [
          {
            mention: "Nikola Krstović",
            selectedCandidateId: expectedPlayer.candidateId,
            status: "resolved",
            turnId: initialTurn.turnId,
          },
          {
            acceptableStatuses: ["saved_result_reuse"],
            mention: "Nikola Krstović",
            selectedCandidateId: expectedPlayer.candidateId,
            status: "resolved",
            turnId: followupTurn.turnId,
          },
          {
            mention: "Synthetic Failure Demo",
            status: "data_unavailable",
            turnId: unavailableTurn.turnId,
          },
        ],
        resolvedPlayers: [expectedPlayer],
      },
    };

    const accentedPlayer = {
      candidates: [
        {
          candidateId: expectedPlayer.candidateId,
          canonicalIdentityId: expectedPlayer.canonicalIdentityId,
          records: expectedPlayer.sourceRecords,
        },
      ],
      lookupName: "Nikola Krstovic",
      mention: "Nikola Krstovic",
      resolutionStatus: "resolved",
      selectedCandidateId: expectedPlayer.candidateId,
      selectedName: "Nikola Krstovic",
    };

    const turns = [
      { player: accentedPlayer, status: "answer_ready", turn: initialTurn },
      { player: accentedPlayer, status: "answer_ready", turn: followupTurn },
      {
        player: observationPlayer(
          "Synthetic Failure Demo",
          "data_unavailable",
          null
        ),
        status: "identity_data_unavailable",
        turn: unavailableTurn,
      },
    ].map(({ player, status, turn }, index) => {
      const availableResultKinds: WorkerTrialResult["turns"][number]["availableResultKinds"] =
        index < 2 ? ["player_lookup"] : [];

      return {
        assistantMessages: [],
        availableResultKinds,
        clarificationAnswers: [],
        clarificationKinds: [],
        deliveredEvidenceIds: [],
        effectiveConditions: null,
        effectiveConstraints: [],
        outcomeKind: "player_lookup",
        outcomeStatus: status,
        players: [player],
        requestKind: "player_lookup",
        reuse:
          index === 1
            ? { evidenceIds: [], kind: "saved_lookup_result" as const }
            : null,
        turnId: turn.turnId,
        userMessage: turn.userMessage,
      };
    });

    const worker = {
      ...emptyWorkerResult("accent-variant-test"),
      players: [accentedPlayer],
      turns,
    } satisfies WorkerTrialResult;

    const checks = checkCaseContract(caseWithExpectedIdentity, worker);

    const checkStatuses = [
      "identity-resolution-status",
      "resolved-identity",
      "turn-identity-continuity",
    ].map((id) => checks.find((check) => check.id === id)?.status);

    const wrongIdentityWorker = {
      ...worker,
      players: [
        { ...accentedPlayer, selectedCandidateId: "reep:wrong-identity" },
      ],
    } satisfies WorkerTrialResult;

    const wrongIdentityStatus = checkCaseContract(
      caseWithExpectedIdentity,
      wrongIdentityWorker
    ).find(({ id }) => id === "resolved-identity")?.status;

    const compatibilityVariantWorker = {
      ...worker,
      players: [
        {
          ...accentedPlayer,
          mention: "Ｅlias Demo",
          selectedName: "Ｅlias Demo",
        },
      ],
    } satisfies WorkerTrialResult;

    const compatibilityVariantStatus = checkCaseContract(
      caseWithExpectedIdentity,
      compatibilityVariantWorker
    ).find(({ id }) => id === "resolved-identity")?.status;

    expect({
      checkStatuses,
      compatibilityVariantStatus,
      wrongIdentityStatus,
    }).toStrictEqual({
      checkStatuses: ["passed", "passed", "passed"],
      compatibilityVariantStatus: "failed",
      wrongIdentityStatus: "failed",
    });
  });

  it("rejects a player expectation whose candidate ID disagrees with its canonical Reep ID", () => {
    const caseDefinition = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(process.cwd(), "evals/cases/lookup-haaland-real-v1.json"),
          "utf-8"
        )
      )
    );

    const [player] = caseDefinition.contract.resolvedPlayers;

    if (player === undefined) {
      throw new Error("The lookup fixture must declare a resolved player.");
    }

    const invalidCase = {
      ...caseDefinition,
      contract: {
        ...caseDefinition.contract,
        resolvedPlayers: [
          { ...player, candidateId: "reep:a-different-identity" },
        ],
      },
    };

    expect(evaluationCaseSchema.safeParse(invalidCase).success).toBeFalsy();
  });

  it("keeps distinct Chinese player names distinct while normalizing accents", () => {
    const caseDefinition = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(process.cwd(), "evals/cases/lookup-smoke-v1.json"),
          "utf-8"
        )
      )
    );

    const [turn] = caseDefinition.turns;

    if (turn === undefined) {
      throw new Error("The lookup fixture must declare a turn.");
    }

    const caseWithChineseLookup = {
      ...caseDefinition,
      contract: {
        ...caseDefinition.contract,
        expectedIdentityLookups: [
          {
            lookupName: "孙兴慜",
            status: "resolved",
            turnId: turn.turnId,
          },
        ],
      },
    };

    const worker = {
      ...emptyWorkerResult("test-fixture"),
      identityLookupEvents: [
        {
          candidates: [],
          caseId: caseDefinition.caseId,
          durationMs: 0,
          error: null,
          eventId: "test-identity-lookup",
          kind: "returned" as const,
          lookupName: "武磊",
          outcome: "resolved",
          runId: "test-run",
          selectedCandidateId: "source:fm:wu-lei",
          trialId: "test-trial",
          turnId: turn.turnId,
        },
      ],
    };

    const check = checkCaseContract(caseWithChineseLookup, worker).find(
      ({ id }) => id === "identity-lookup-observations"
    );

    expect(check?.status).toBe("failed");
  });

  it("accepts an explain-only lookup when identity remains resolved without another search", () => {
    const caseDefinition = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "evals/cases/lookup-identity-clarification-v1.json"
          ),
          "utf-8"
        )
      )
    );

    const [initialTurn, followupTurn, unavailableTurn] = caseDefinition.turns;

    if (
      initialTurn === undefined ||
      followupTurn === undefined ||
      unavailableTurn === undefined
    ) {
      throw new Error("The lookup fixture must declare three user turns.");
    }

    const turns = caseDefinition.turns.map((turn, index) => ({
      assistantMessages: [],
      availableResultKinds: index < 2 ? ["player_lookup" as const] : [],
      clarificationAnswers: [],
      clarificationKinds: [],
      deliveredEvidenceIds: [],
      effectiveConditions: null,
      effectiveConstraints: [],
      outcomeKind: "player_lookup",
      outcomeStatus: index === 2 ? "identity_data_unavailable" : "answer_ready",
      players:
        index === 2
          ? [
              observationPlayer(
                "Synthetic Failure Demo",
                "data_unavailable",
                null
              ),
            ]
          : [
              observationPlayer(
                "Elias Demo",
                "resolved",
                "reep:identity-demo-01"
              ),
            ],
      requestKind: "player_lookup",
      reuse:
        index === 1
          ? { evidenceIds: [], kind: "saved_lookup_result" as const }
          : null,
      turnId: turn.turnId,
      userMessage: turn.userMessage,
    }));

    const worker = {
      ...emptyWorkerResult("test-trial"),
      actionEvents: [
        {
          actionId: "initial-search",
          caseId: caseDefinition.caseId,
          durationMs: 0,
          eventId: "initial-search-returned",
          input: null,
          kind: "returned" as const,
          name: "search_player_records",
          outcome: "found",
          result: null,
          runId: "test-run",
          sourceRecords: [
            { provider: "fm", sourceId: "fm-demo-01" },
            {
              competition: "EPL",
              provider: "understat",
              season: "2024/25",
              sourceId: "us-demo-01",
            },
          ],
          toolCallId: null,
          trialId: "test-trial",
          turnId: initialTurn.turnId,
        },
      ],
      turns,
    } satisfies WorkerTrialResult;

    const checks = checkCaseContract(caseDefinition, worker);

    const wrongIdentityWorker = {
      ...worker,
      turns: worker.turns.map((turn, index) =>
        index === 1
          ? {
              ...turn,
              players: [
                observationPlayer(
                  "Elias Demo",
                  "resolved",
                  "reep:wrong-player"
                ),
              ],
            }
          : turn
      ),
    } satisfies WorkerTrialResult;

    const wrongIdentityCheck = checkCaseContract(
      caseDefinition,
      wrongIdentityWorker
    ).find(({ id }) => id === "turn-identity-continuity");

    expect({
      identityContinuity: checks.find(
        ({ id }) => id === "turn-identity-continuity"
      )?.status,
      searchCalls: checks.find(({ id }) => id === "turn-tool-actions")?.status,
      wrongIdentityContinuity: wrongIdentityCheck?.status,
    }).toStrictEqual({
      identityContinuity: "passed",
      searchCalls: "passed",
      wrongIdentityContinuity: "failed",
    });
  });

  it("accepts no repeat team clarification only when the case declares that path", () => {
    const caseDefinition = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "evals/cases/team-real-madrid-refine-dev-v1.json"
          ),
          "utf-8"
        )
      )
    );

    const turns = caseDefinition.turns.map((turn, index) => ({
      assistantMessages: [],
      availableResultKinds: [],
      clarificationAnswers: index === 0 ? [{ kind: "team", value: "1" }] : [],
      clarificationKinds: index === 0 ? ["team"] : [],
      deliveredEvidenceIds: [],
      effectiveConditions: null,
      effectiveConstraints: [],
      outcomeKind: "team_recommendation",
      outcomeStatus: "team_roster_member_unmapped",
      players: [],
      requestKind: "team_recommendation",
      reuse: null,
      turnId: turn.turnId,
      userMessage: turn.userMessage,
    }));

    const worker = {
      ...emptyWorkerResult(""),
      outcomeKind: "team_recommendation",
      outcomeStatus: "team_roster_member_unmapped",
      requestKind: "team_recommendation",
      turns,
    } satisfies WorkerTrialResult;

    const secondTurnIndex = 1;

    const caseWithoutNoAnswerAlternative = {
      ...caseDefinition,
      turns: caseDefinition.turns.map((turn, index) =>
        index === secondTurnIndex
          ? { ...turn, clarificationAlternatives: [] }
          : turn
      ),
    };

    const checkForCase = (caseToCheck: typeof caseDefinition) =>
      checkCaseContract(caseToCheck, worker).find(
        ({ id }) => id === "scripted-clarifications"
      );

    expect({
      actualCase: checkForCase(caseDefinition)?.status,
      withoutNoAnswerAlternative: checkForCase(caseWithoutNoAnswerAlternative)
        ?.status,
    }).toStrictEqual({
      actualCase: "passed",
      withoutNoAnswerAlternative: "failed",
    });
  });
});
