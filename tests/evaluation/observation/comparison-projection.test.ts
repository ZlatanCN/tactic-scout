import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { evaluationWorkerRequestSchema } from "../../../evals/contracts.js";
import { createEvaluationObserver } from "../../../evals/observation.js";
import { AgentState, agentStateSchemaVersion } from "../../../src/state.js";

describe("observed comparison projection evidence", () => {
  it("records comparison batch scope and only the selected source records", () => {
    const turnId = "comparison-projection-turn";
    const userMessage = "Explain the saved four-player comparison.";

    const projection = JSON.stringify({
      batch: {
        completedParticipantRefs: ["players[0]", "players[1]"],
        index: 1,
        participantRefs: ["players[2]", "players[3]"],
        remainingParticipantRefs: [],
        total: 2,
      },
      coverage: {
        commonUnderstatScopeCount: 0,
        fmPlayerCount: 4,
        hasFmRecords: true,
        hasUnderstatRecords: true,
        playerCount: 4,
      },
      digest: "comparison-result-digest",
      participants: [
        { participantRef: "players[0]", playerName: "Player One" },
        { participantRef: "players[1]", playerName: "Player Two" },
        { participantRef: "players[2]", playerName: "Player Three" },
        { participantRef: "players[3]", playerName: "Player Four" },
      ],
      recordRefs: [
        "players[2].fm.records[0]",
        "players[2].understat.records[0]",
        "understatScopeGroups[0].players[2].record",
      ],
      selectedPlayers: [
        {
          fm: {
            records: [
              {
                identitySourceId: "fm-player-three",
                player: "Player Three",
                sourceRecordId: "fm-record-three",
              },
            ],
            status: "found",
          },
          participantRef: "players[2]",
          playerName: "Player Three",
          understat: {
            records: [
              {
                competition: "La_liga",
                season: "2025/26",
                sourcePlayerId: "understat-player-three",
              },
            ],
            status: "found",
          },
        },
        {
          fm: { records: [], status: "not_found" },
          participantRef: "players[3]",
          playerName: "Player Four",
          understat: { records: [], status: "not_found" },
        },
      ],
      source: "saved",
      understatScopes: [
        {
          competition: "La_liga",
          coverage: {
            coveredPlayerCount: 2,
            coversAllParticipants: false,
            participantCount: 4,
          },
          includedPlayers: [
            {
              participantRef: "players[2]",
              playerName: "Player Three",
              record: {
                competition: "La_liga",
                sourcePlayerId: "understat-player-three",
              },
              recordRef: "understatScopeGroups[0].players[2].record",
            },
            {
              participantRef: "players[3]",
              playerName: "Player Four",
              record: null,
              recordRef: null,
            },
          ],
          season: "2025/26",
        },
      ],
      version: 1,
    });

    const request = evaluationWorkerRequestSchema.parse({
      ageAsOfDate: "2026-11-10",
      caseId: "comparison-projection",
      caseOrigin: "synthetic",
      databasePaths: {
        fm: "test-fm.sqlite",
        identity: "test-identity.sqlite",
        understat: "test-understat.sqlite",
      },
      declaredTurnFaults: [],
      maxClarificationsPerTurn: 2,
      resultPath: "test-result.json",
      runId: "comparison-projection-run",
      threadId: "comparison-projection-thread",
      trialId: "comparison-projection-trial",
      turnIds: [turnId],
      turns: [
        {
          clarificationAlternatives: [],
          clarificationAnswers: [],
          turnId,
          userMessage,
        },
      ],
    });

    const resultJson = JSON.stringify({
      coverage: { playerCount: 4 },
      players: [],
      status: "ready",
      understatScopeGroups: [],
    });

    const state = AgentState.parse({
      messages: [
        new HumanMessage(userMessage),
        new AIMessage("Batch received."),
      ],
      outcome: {
        kind: "player_comparison",
        resultJson,
        source: "saved",
        status: "ready",
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const observer = createEvaluationObserver(request);

    if (observer.callbacks.handleChatModelStart === undefined) {
      throw new Error("The evaluation observer has no model-start callback.");
    }

    observer.callbacks.handleChatModelStart(
      {
        id: ["tests", "chat-model"],
        kwargs: {},
        lc: 1,
        name: "chat-model",
        type: "constructor",
      },
      [
        [
          new HumanMessage(
            `用户请求：${userMessage}\n\nComparison evidence projection JSON:\n${projection}`
          ),
        ],
      ],
      "comparison-projection-model-run"
    );

    const turn = request.turns.at(0);

    if (turn === undefined) {
      throw new Error("The observer fixture needs one turn.");
    }

    observer.recordTurn(turn, state, []);

    expect({
      deliveredEvidence: observer.deliveredEvidence.map(
        ({ projection: metadata, provider, sourceId }) => ({
          projection: metadata,
          provider,
          sourceId,
        })
      ),
      renderedEvidenceCount: observer.renderedEvidence.length,
    }).toStrictEqual({
      deliveredEvidence: [
        {
          projection: {
            batchCount: 2,
            batchIndex: 1,
            commonUnderstatScopeCount: 0,
            kind: "comparison",
            participantCount: 4,
            participantRefs: ["players[2]", "players[3]"],
            recordRefs: [
              "players[2].fm.records[0]",
              "players[2].understat.records[0]",
              "understatScopeGroups[0].players[2].record",
            ],
            resultDigest: "comparison-result-digest",
            understatScopes: [
              {
                competition: "La_liga",
                coveredPlayerCount: 2,
                coversAllParticipants: false,
                participantCount: 4,
                season: "2025/26",
              },
            ],
          },
          provider: "fm",
          sourceId: "fm-player-three",
        },
        {
          projection: {
            batchCount: 2,
            batchIndex: 1,
            commonUnderstatScopeCount: 0,
            kind: "comparison",
            participantCount: 4,
            participantRefs: ["players[2]", "players[3]"],
            recordRefs: [
              "players[2].fm.records[0]",
              "players[2].understat.records[0]",
              "understatScopeGroups[0].players[2].record",
            ],
            resultDigest: "comparison-result-digest",
            understatScopes: [
              {
                competition: "La_liga",
                coveredPlayerCount: 2,
                coversAllParticipants: false,
                participantCount: 4,
                season: "2025/26",
              },
            ],
          },
          provider: "understat",
          sourceId: "understat-player-three",
        },
      ],
      renderedEvidenceCount: 0,
    });
  });
});
