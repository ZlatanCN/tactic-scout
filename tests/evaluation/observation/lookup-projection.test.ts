import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { evaluationWorkerRequestSchema } from "../../../evals/contracts.js";
import { createEvaluationObserver } from "../../../evals/observation.js";
import { AgentState, agentStateSchemaVersion } from "../../../src/state.js";

describe("observed lookup projection evidence", () => {
  it("attributes model evidence to the selected projection batch records", () => {
    const turnId = "lookup-projection-turn";
    const userMessage = "What xA did Understat report?";

    const projection = JSON.stringify({
      batch: {
        completedRecordRefs: [],
        index: 0,
        recordRefs: ["understat.records[0]"],
        remainingRecordRefs: ["understat.records[1]"],
        total: 2,
      },
      coverage: {
        providers: {
          fm: { queried: true, status: "found" },
          understat: { queried: true, status: "found" },
        },
      },
      digest: "saved-result-digest",
      identityGroups: {
        canonicalGroups: [],
        registryStatus: "available",
        unlinkedRecords: [],
      },
      query: [
        { provider: "fm", sourceId: "fm-player" },
        { provider: "understat", sourceId: "understat-player" },
      ],
      records: [
        {
          competition: "La_liga",
          expectedAssists: 1.2,
          player: "Fixture Player",
          provider: "understat",
          recordRef: "understat.records[0]",
          season: "2025/26",
          source: "Understat",
          sourceId: "understat-player",
        },
      ],
      requestedUnderstatSeasonStartYear: null,
      source: "saved",
      version: 1,
    });

    const request = evaluationWorkerRequestSchema.parse({
      ageAsOfDate: "2026-11-09",
      caseId: "lookup-projection",
      caseOrigin: "synthetic",
      databasePaths: {
        fm: "test-fm.sqlite",
        identity: "test-identity.sqlite",
        understat: "test-understat.sqlite",
      },
      declaredTurnFaults: [],
      maxClarificationsPerTurn: 2,
      resultPath: "test-result.json",
      runId: "lookup-projection-run",
      threadId: "lookup-projection-thread",
      trialId: "lookup-projection-trial",
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

    const state = AgentState.parse({
      messages: [
        new HumanMessage(userMessage),
        new AIMessage("Understat reports xA 1.2."),
      ],
      outcome: {
        kind: "player_lookup",
        resultJson: JSON.stringify({
          query: [{ provider: "fm", sourceId: "fm-player" }],
        }),
        source: "saved",
        status: "lookup_follow_up",
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
            `用户追问：${userMessage}\n\nScouting evidence projection JSON:\n${projection}`
          ),
        ],
      ],
      "lookup-projection-model-run"
    );

    const turn = request.turns.at(0);

    if (turn === undefined) {
      throw new Error("The observer fixture needs one turn.");
    }

    observer.recordTurn(turn, state, []);

    expect({
      deliveredEvidence: observer.deliveredEvidence.map(
        ({ provider, sourceId }) => ({ provider, sourceId })
      ),
      renderedEvidenceCount: observer.renderedEvidence.length,
      reuse: observer.turnObservations[0]?.reuse,
    }).toStrictEqual({
      deliveredEvidence: [
        { provider: "fm", sourceId: "fm-player" },
        { provider: "understat", sourceId: "understat-player" },
      ],
      renderedEvidenceCount: 0,
      reuse: {
        evidenceIds: observer.turnObservations[0]?.deliveredEvidenceIds,
        kind: "saved_lookup_result",
      },
    });
  });
});
