import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { beginContextProcessingContinuation } from "../../../src/context-processing-continuation.js";
import {
  contextProcessingHash,
  createInitialContextProcessing,
} from "../../../src/context-processing-state.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../../src/state.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";

describe("compacted lookup explanation continuation", () => {
  it("grants continuation when exhausted evidence is keyed by its compacted instruction", () => {
    const sourceMessageId = "compacted-lookup-source";

    const sourceText =
      "Please look up Elias Demo's 2024/25 performance. Long notes.";

    const instruction = "Look up Elias Demo's Understat 2024/25 performance.";
    const requestId = `message:${sourceMessageId}`;

    const resultJson = JSON.stringify({
      query: [{ provider: "understat", sourceId: "us-demo-01" }],
    });

    const candidate = agentGraphTest.playerCandidate("Elias Demo", "elias");

    const conversationContext = {
      ...createInitialConversationContext(),
      activeLookup: {
        player: agentGraphTest.conversationReferenceFromCandidate(candidate),
        resultJson,
      },
    };

    const state = AgentState.parse({
      contextProcessing: {
        ...createInitialContextProcessing(),
        allowance: {
          consumedActiveTimeMs: 120_000,
          consumedAdditionalCalls: 6,
          grants: [],
          maxActiveTimeMs: 120_000,
          maxAdditionalCalls: 6,
          requestId,
          reservation: null,
          reservedActiveTimeMs: 0,
        },
        compaction: {
          activeContextHash: "active-context-hash",
          ambiguities: [],
          anchors: [{ kind: "participant", text: "Elias Demo" }],
          chunking: null,
          formatVersion: 2,
          instruction,
          instructionHash: contextProcessingHash(instruction),
          modelConfigurationHash: "model-configuration-hash",
          outputTokenEstimate: 12,
          progress: { end: sourceText.length, start: 0 },
          references: [],
          requestId,
          sourceClarificationAnswers: [],
          sourceHash: contextProcessingHash(sourceText),
          sourceMessageId,
          sourceTokenEstimate: 300,
          status: "ready",
          stopReason: null,
          targetTokenEstimate: 100,
        },
      },
      conversationContext,
      lookupEvidence: {
        batches: [
          {
            answer: null,
            index: 0,
            projectionJson: "{}",
            recordRefs: ["understat.records[0]"],
            status: "pending",
          },
        ],
        failureReason: "allowance_exhausted",
        questionHash: contextProcessingHash(instruction),
        requestId,
        resultDigest: contextProcessingHash(resultJson),
        source: "executed",
        sourceHash: "lookup-evidence-source-hash",
        sourceMessageId,
        status: "allowance_exhausted",
      },
      messages: [
        new HumanMessage({ content: sourceText, id: sourceMessageId }),
      ],
      outcome: {
        kind: "player_lookup",
        resultJson,
        source: "executed",
        status: "data_ready",
      },
      request: createInitialRequestState(),
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const decision = beginContextProcessingContinuation(
      state,
      new HumanMessage({ content: "继续查询", id: "continue-lookup" }),
      { maxActiveTimeMs: 120_000, maxAdditionalCalls: 6 }
    );

    expect(decision.kind).toBe("granted");

    if (decision.kind !== "granted") {
      throw new Error(
        "The compacted lookup explanation was not eligible to continue."
      );
    }

    expect(decision.grant).toMatchObject({
      kind: "explain_lookup_evidence",
      requestId,
      sourceMessageId,
    });
    expect(decision.update.lookupEvidence?.status).toBe("processing");

    const resumedState = AgentState.parse({ ...state, ...decision.update });

    const replay = beginContextProcessingContinuation(
      resumedState,
      new HumanMessage({ content: "继续查询", id: "continue-lookup" }),
      { maxActiveTimeMs: 120_000, maxAdditionalCalls: 6 }
    );

    expect(replay.kind).toBe("active");

    if (replay.kind !== "active") {
      throw new Error(
        "The resumed evidence grant was not recognized as active."
      );
    }

    expect(replay.grant).toStrictEqual(decision.grant);
  });
});
