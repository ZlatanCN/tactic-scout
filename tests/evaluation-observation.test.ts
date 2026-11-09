import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { evaluationWorkerRequestSchema } from "../evals/contracts.js";
import { createEvaluationObserver } from "../evals/observation.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialFaultToleranceState,
} from "../src/state.js";

describe("deterministic result presentation evidence", () => {
  it("records rendered source evidence separately from model input evidence", () => {
    const turnId = "context-budget-render-turn";
    const userMessage = "Explain the saved comparison.";

    const resultJson = JSON.stringify({
      query: [{ provider: "fm", sourceId: "fm-demo-01" }],
    });

    const request = evaluationWorkerRequestSchema.parse({
      ageAsOfDate: "2026-11-09",
      caseId: "context-budget-render",
      caseOrigin: "synthetic",
      databasePaths: {
        fm: "test-fm.sqlite",
        identity: "test-identity.sqlite",
        understat: "test-understat.sqlite",
      },
      declaredTurnFaults: [],
      maxClarificationsPerTurn: 2,
      resultPath: "test-result.json",
      runId: "context-budget-render-run",
      threadId: "context-budget-render-thread",
      trialId: "context-budget-render-trial",
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
      faultTolerance: {
        ...createInitialFaultToleranceState(),
        failure: {
          category: "context_limit",
          contextIssue: "input_exceeds_limit",
          node: "answer",
        },
      },
      messages: [
        new HumanMessage(userMessage),
        new AIMessage(
          `上下文预算不足，模型解释未完成。以下是本次已完成并验证的完整结构化结果与来源：\n\n${resultJson}`
        ),
      ],
      outcome: {
        kind: "player_lookup",
        resultJson,
        source: "executed",
        status: "answer_ready",
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const observer = createEvaluationObserver(request);
    const turn = request.turns.at(0);

    if (turn === undefined) {
      throw new Error("The observer fixture needs one turn.");
    }

    observer.recordTurn(turn, state, []);

    const [evidence] = observer.renderedEvidence;

    if (evidence === undefined) {
      throw new Error("The displayed saved result should record evidence.");
    }

    expect({
      deliveredModelEvidenceCount: observer.deliveredEvidence.length,
      renderedEvidence: {
        content: evidence.content,
        provider: evidence.provider,
        sourceId: evidence.sourceId,
        turnId: evidence.turnId,
      },
    }).toStrictEqual({
      deliveredModelEvidenceCount: 0,
      renderedEvidence: {
        content: resultJson,
        provider: "fm",
        sourceId: "fm-demo-01",
        turnId,
      },
    });

    expect(observer.turnObservations[0]?.renderedEvidenceIds).toStrictEqual([
      evidence.evidenceId,
    ]);
  });
});
