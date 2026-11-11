import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { evaluationWorkerRequestSchema } from "../../../evals/contracts.js";
import { createEvaluationObserver } from "../../../evals/observation.js";
import { AgentState, agentStateSchemaVersion } from "../../../src/state.js";

describe("deterministic comparison fallback evidence", () => {
  it("records a deterministic comparison fallback separately from model evidence", () => {
    const turnId = "comparison-render-turn";
    const userMessage = "Explain the saved comparison.";

    const resultJson = JSON.stringify({
      coverage: {
        commonUnderstatScopeCount: 0,
        fmPlayerCount: 2,
        hasFmRecords: true,
        hasUnderstatRecords: true,
        playerCount: 2,
      },
      players: [
        {
          fm: {
            records: [{ identitySourceId: "fm-player-one" }],
            status: "found",
          },
          playerName: "Player One",
          understat: {
            records: [{ sourcePlayerId: "understat-player-one" }],
            status: "found",
          },
        },
        {
          fm: {
            records: [{ identitySourceId: "fm-player-two" }],
            status: "found",
          },
          playerName: "Player Two",
          understat: null,
        },
      ],
      status: "ready",
      understatScopeGroups: [],
    });

    const request = evaluationWorkerRequestSchema.parse({
      ageAsOfDate: "2026-11-10",
      caseId: "comparison-render",
      caseOrigin: "synthetic",
      databasePaths: {
        fm: "test-fm.sqlite",
        identity: "test-identity.sqlite",
        understat: "test-understat.sqlite",
      },
      declaredTurnFaults: [],
      maxClarificationsPerTurn: 2,
      resultPath: "test-result.json",
      runId: "comparison-render-run",
      threadId: "comparison-render-thread",
      trialId: "comparison-render-trial",
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
        new AIMessage(
          `比较数据已完整验证，但分批解释未完成。以下是完整比较结果与来源：\n\n${resultJson}`
        ),
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
    const turn = request.turns.at(0);

    if (turn === undefined) {
      throw new Error("The observer fixture needs one turn.");
    }

    observer.recordTurn(turn, state, []);

    expect({
      deliveredEvidenceCount: observer.deliveredEvidence.length,
      renderedEvidence: observer.renderedEvidence.map(
        ({ provider, sourceId }) => ({ provider, sourceId })
      ),
    }).toStrictEqual({
      deliveredEvidenceCount: 0,
      renderedEvidence: [
        { provider: "fm", sourceId: "fm-player-one" },
        { provider: "fm", sourceId: "fm-player-two" },
        { provider: "understat", sourceId: "understat-player-one" },
      ],
    });
  });
});
