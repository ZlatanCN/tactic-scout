import { createHash } from "node:crypto";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it, vi } from "vitest";

import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../../src/state.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";

describe("lookup evidence projection and bounded delivery", () => {
  it("rebuilds saved evidence when a new lookup replaces its source digest", async () => {
    const player = agentGraphTest.playerCandidate("Mikel Oyarzabal", "mikel");

    const message = new HumanMessage({
      content: "What xA did Understat report?",
      id: "saved-lookup-new-result",
    });

    const resultJson = JSON.stringify({
      identityGroups: {
        canonicalGroups: [],
        registryStatus: "not_needed",
        unlinkedRecords: [],
      },
      query: [{ provider: "understat", sourceId: "mikel-understat" }],
      requestedUnderstatSeasonStartYear: 2025,
      understat: {
        records: [
          {
            appearances: 8,
            assists: 2,
            competition: "La_liga",
            expectedAssists: 1.2,
            expectedGoals: 1.1,
            goals: 2,
            keyPasses: 9,
            minutes: 520,
            nonPenaltyExpectedGoals: 1.1,
            player: player.name,
            position: "F M S",
            season: "2025/26",
            shots: 14,
            source: "Understat",
            sourcePlayerId: "mikel-understat",
            team: "Real Sociedad",
          },
        ],
        status: "found",
      },
    });

    const model = fakeModel().respond(
      new AIMessage("The current saved lookup reports xA 1.2.")
    );

    const modelInvoke = vi.spyOn(model, "invoke");
    const graph = agentGraphTest.createAgent({ model, tools: [] });
    const oldMessageId = "saved-lookup-old-result";

    const state = AgentState.parse({
      contextProcessing: {
        allowance: {
          consumedActiveTimeMs: 300,
          consumedAdditionalCalls: 1,
          maxActiveTimeMs: 120_000,
          maxAdditionalCalls: 6,
          requestId: `message:${oldMessageId}`,
          reservation: null,
        },
        clarification: null,
        compaction: null,
      },
      conversationContext: {
        ...createInitialConversationContext(),
        activeLookup: {
          player: agentGraphTest.conversationReferenceFromCandidate(player),
          resultJson,
        },
      },
      lookupEvidence: {
        batches: [
          {
            answer: "STALE: the previous lookup reported xA 0.1.",
            index: 0,
            projectionJson: "stale projection",
            recordRefs: ["understat.records[0]"],
            status: "ready",
          },
        ],
        failureReason: null,
        questionHash: "stale-question-hash",
        requestId: `message:${oldMessageId}`,
        resultDigest: "stale-result-digest",
        source: "saved",
        sourceHash: "stale-source-hash",
        sourceMessageId: oldMessageId,
        status: "complete",
      },
      messages: [message],
      outcome: {
        kind: "player_lookup",
        resultJson,
        source: "saved",
        status: "lookup_follow_up",
      },
      request: {
        ...createInitialRequestState(),
        processedMessageId: message.id,
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const result = await graph.invoke(state, {
      configurable: { thread_id: "saved-lookup-new-result" },
    });

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      answer: result.messages.at(-1)?.content,
      evidenceDigestMatches:
        result.lookupEvidence?.resultDigest ===
        createHash("sha256").update(resultJson).digest("hex"),
      evidenceStatus: result.lookupEvidence?.status,
      modelCalls: modelInvoke.mock.calls.length,
    }).toStrictEqual({
      allowanceCalls: 1,
      answer: "The current saved lookup reports xA 1.2.",
      evidenceDigestMatches: true,
      evidenceStatus: "complete",
      modelCalls: 1,
    });
  });
});
