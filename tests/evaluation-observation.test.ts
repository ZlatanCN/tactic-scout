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

  it("records a complete lookup rendered after evidence explanation stops", () => {
    const turnId = "lookup-evidence-render-turn";
    const userMessage = "Explain the saved lookup.";

    const resultJson = JSON.stringify({
      query: [{ provider: "understat", sourceId: "understat-demo-01" }],
      understat: {
        records: [
          { player: "Fixture Player", sourcePlayerId: "understat-demo-01" },
        ],
        status: "found",
      },
    });

    const request = evaluationWorkerRequestSchema.parse({
      ageAsOfDate: "2026-11-09",
      caseId: "lookup-evidence-render",
      caseOrigin: "synthetic",
      databasePaths: {
        fm: "test-fm.sqlite",
        identity: "test-identity.sqlite",
        understat: "test-understat.sqlite",
      },
      declaredTurnFaults: [],
      maxClarificationsPerTurn: 2,
      resultPath: "test-result.json",
      runId: "lookup-evidence-render-run",
      threadId: "lookup-evidence-render-thread",
      trialId: "lookup-evidence-render-trial",
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
          `查询数据已完整保存，但模型解释未完成。以下是完整结果与来源：\n\n${resultJson}`
        ),
      ],
      outcome: {
        kind: "player_lookup",
        resultJson,
        source: "saved",
        status: "lookup_follow_up",
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
        ({ content, provider, sourceId }) => ({ content, provider, sourceId })
      ),
    }).toStrictEqual({
      deliveredEvidenceCount: 0,
      renderedEvidence: [
        {
          content: resultJson,
          provider: "understat",
          sourceId: "understat-demo-01",
        },
      ],
    });
  });

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
