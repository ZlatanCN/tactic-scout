import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { checkCaseContract } from "../../../evals/checks.js";
import {
  evaluationCaseSchema,
  evaluationWorkerRequestSchema,
  workerTrialResultSchema,
} from "../../../evals/contracts.js";
import { judgeInputForTrial } from "../../../evals/judge.js";
import { createEvaluationObserver } from "../../../evals/observation.js";
import {
  contextProcessingHash,
  createInitialContextProcessing,
} from "../../../src/context-processing-state.js";
import { AgentState, agentStateSchemaVersion } from "../../../src/state.js";

describe("context-processing judge evidence", () => {
  it("supplies the exhausted grant and retained source progress to the judge", () => {
    const caseId = "context-processing-state-evidence";
    const turnId = "context-processing-state-evidence-turn-1";
    const userMessage = "Look up Elias Demo and preserve this long request.";

    const caseDefinition = evaluationCaseSchema.parse({
      caseId,
      category: "multi_turn",
      contract: {
        outcomeStatus: "answer_ready",
        prohibitedClaims: [],
        requiredEvidence: [],
        resolvedPlayers: [],
        taskKind: "player_lookup",
        toolActions: [],
      },
      evidenceBundleId: "lookup-smoke-evidence-v1",
      evidenceBundleSha256: "a".repeat(64),
      origin: "synthetic",
      priorTuningExposure: "Synthetic state-observation contract test.",
      scenarioFamily: "context-processing-state-observation",
      split: "development",
      turns: [{ turnId, userMessage }],
      workflow: "player_lookup",
    });

    const request = evaluationWorkerRequestSchema.parse({
      ageAsOfDate: "2026-11-13",
      caseId,
      caseOrigin: "synthetic",
      databasePaths: {
        fm: "fm.sqlite",
        identity: "identity.sqlite",
        understat: "understat.sqlite",
      },
      declaredTurnFaults: [],
      maxClarificationsPerTurn: 2,
      resultPath: "result.json",
      runId: "context-processing-state-run",
      threadId: "context-processing-state-thread",
      trialId: "context-processing-state-trial",
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

    const sourceMessageId = turnId;
    const sourceHash = contextProcessingHash(userMessage);

    const contextProcessing = {
      ...createInitialContextProcessing(),
      allowance: {
        consumedActiveTimeMs: 12_000,
        consumedAdditionalCalls: 6,
        grants: [],
        maxActiveTimeMs: 120_000,
        maxAdditionalCalls: 6,
        requestId: "context-processing-request",
        reservation: null,
        reservedActiveTimeMs: 0,
      },
      compaction: {
        activeContextHash: "active-context-hash",
        ambiguities: [],
        anchors: [{ kind: "participant", text: "Elias Demo" }],
        chunking: {
          chunks: [
            {
              ambiguities: [],
              anchors: [{ kind: "participant", text: "Elias Demo" }],
              end: 20,
              instruction: "Look up Elias Demo.",
              instructionTokenEstimate: 6,
              references: [],
              sourceHash,
              start: 0,
              status: "ready",
              targetTokenEstimate: 32,
            },
          ],
          mergeGroups: [],
          mergeStatus: "pending",
          nextStart: 20,
          sourceHash,
          sourceLength: 40,
          sourceMessageId,
        },
        formatVersion: 2,
        instruction: null,
        instructionHash: null,
        modelConfigurationHash: "model-configuration-hash",
        outputTokenEstimate: null,
        progress: { end: 20, start: 0 },
        references: [],
        requestId: "context-processing-request",
        sourceClarificationAnswers: [],
        sourceHash,
        sourceMessageId,
        sourceTokenEstimate: 8000,
        status: "allowance_exhausted",
        stopReason: "allowance_exhausted",
        targetTokenEstimate: 32,
      },
    };

    const state = AgentState.parse({
      contextProcessing,
      messages: [
        new HumanMessage({ content: userMessage, id: sourceMessageId }),
        new AIMessage(
          "本请求的自动上下文处理额度已用完，原文和处理进度仍保留。"
        ),
      ],
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const observer = createEvaluationObserver(request);

    observer.recordTurn(request.turns[0], state, []);

    const worker = workerTrialResultSchema.parse({
      actionEvents: observer.actionEvents,
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
      outcomeKind: null,
      outcomeStatus: null,
      players: [],
      requestKind: null,
      teamRosterCoverage: null,
      toolMessages: [],
      turns: observer.turnObservations,
    });

    const judgeInput = judgeInputForTrial(caseDefinition, worker);

    expect(
      judgeInput.actions.find(({ name }) => name === "context_processing_state")
    ).toMatchObject({
      input: {
        allowance: {
          consumedAdditionalCalls: 6,
          maxAdditionalCalls: 6,
        },
        compaction: {
          chunking: {
            completedChunkCount: 1,
            nextStart: 20,
            sourceLength: 40,
          },
          originalSourceRetained: true,
          progress: { end: 20, start: 0 },
          sourceMessageId,
          status: "allowance_exhausted",
          stopReason: "allowance_exhausted",
        },
      },
      kind: "returned",
      outcome: "allowance_exhausted",
      turnId,
    });
    expect(
      checkCaseContract(caseDefinition, worker).find(
        ({ id }) => id === "lookup-result"
      )
    ).toMatchObject({ status: "passed" });
  });
});
