import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { searchPlayerRecordsResultSchema } from "../../../src/player-data/search-records.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../../src/state.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";

const lookupResult = {
  identityGroups: {
    canonicalGroups: [],
    registryStatus: "available",
    unlinkedRecords: [],
  },
  query: [{ provider: "understat", sourceId: "mikel-understat" }],
  requestedUnderstatSeasonStartYear: null,
  understat: {
    records: ["2022/23", "2023/24", "2024/25", "2025/26"].map(
      (season, index) => ({
        appearances: 9 + index,
        assists: 2 + index,
        competition: "La_liga",
        expectedAssists: 0.7 + index * 0.2,
        expectedGoals: 1.3 + index * 0.3,
        goals: 2 + index,
        keyPasses: 11 + index,
        minutes: 606 + index * 100,
        nonPenaltyExpectedGoals: 1.3 + index * 0.2,
        player: "Mikel Oyarzabal",
        position: "F M S",
        season,
        shots: 19 + index,
        source: "Understat",
        sourcePlayerId: "mikel-understat",
        team: "Real Sociedad",
      })
    ),
    status: "found",
  },
};

const lookupResultJson = JSON.stringify(
  searchPlayerRecordsResultSchema.parse(lookupResult)
);

const lookupOverflowResponse = (messages: BaseMessage[]) => {
  const humanMessage = messages.find(
    (message) => message instanceof HumanMessage
  );

  const content = z.string().parse(humanMessage?.content);
  const marker = "Scouting evidence projection JSON:\n";
  const [projectionJson] = content.split(marker).slice(1);

  if (projectionJson === undefined) {
    return new Error("The lookup evidence projection is missing.");
  }

  const projection = z
    .object({
      batch: z.object({ recordRefs: z.array(z.string()) }),
      records: z.array(z.object({ season: z.string() })),
    })
    .parse(JSON.parse(projectionJson));

  if (projection.records.length > 1) {
    return Object.assign(
      new Error("The request exceeds the maximum context length."),
      { code: "context_length_exceeded", status: 400 }
    );
  }

  return new AIMessage(`${projection.records[0]?.season} xA was reported.`);
};

describe("lookup provider context overflow recovery", () => {
  it("replans an overflowing multi-batch lookup while keeping source references", async () => {
    const model = fakeModel();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      model.respond(lookupOverflowResponse);
    }

    Object.assign(model, {
      getNumTokens: async (text: string) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      },
    });

    const candidate = agentGraphTest.playerCandidate(
      "Mikel Oyarzabal",
      "mikel"
    );

    const playerReference =
      agentGraphTest.conversationReferenceFromCandidate(candidate);

    const message = new HumanMessage({
      content: "What xA did Understat report across these seasons?",
      id: "saved-lookup-provider-overflow",
    });

    const state = AgentState.parse({
      conversationContext: {
        ...createInitialConversationContext(),
        activeLookup: { player: playerReference, resultJson: lookupResultJson },
      },
      messages: [message],
      outcome: {
        kind: "player_lookup",
        resultJson: lookupResultJson,
        source: "saved",
        status: "lookup_follow_up",
      },
      request: {
        ...createInitialRequestState(),
        processedMessageId: message.id,
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 6 },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 10_000,
        maxOutputTokens: 256,
        softTriggerFraction: 0.99,
        targetFraction: 0.6,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = await graph.invoke(state, {
      configurable: { thread_id: "lookup-provider-overflow" },
    });

    const batches = result.lookupEvidence?.batches ?? [];
    const response = z.string().parse(result.messages.at(-1)?.content);

    expect(response).toContain("2023/24");
    expect(response).toContain("2024/25");
    expect(response).toContain("2022/23");
    expect(response).toContain("2025/26");

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      batchStatuses: batches.map(({ status }) => status),
      evidenceStatus: result.lookupEvidence?.status,
      refs: batches.map(({ recordRefs }) => recordRefs),
    }).toStrictEqual({
      allowanceCalls: 6,
      batchStatuses: ["ready", "ready", "ready", "ready"],
      evidenceStatus: "complete",
      refs: [
        ["understat.records[0]"],
        ["understat.records[1]"],
        ["understat.records[2]"],
        ["understat.records[3]"],
      ],
    });
  });
});
