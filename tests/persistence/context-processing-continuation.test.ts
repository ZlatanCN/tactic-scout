import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  AgentState,
  agentStateSchemaVersion,
  createInitialRequestState,
} from "../../src/state.js";
import {
  postJson,
  startDevServerSession,
  waitResponseSchema,
} from "../fixtures/langgraph-dev-server.js";
import { managedDevServerTest } from "../fixtures/managed-dev-server-persistence.js";

const sourceMessageId = "persistent-continuation-source";
const continuationMessageId = "persistent-continuation-1";
const sourceMessage = `Look up Harry Kane. ${"Background note with no scouting constraint. ".repeat(6000)}`;

const chunkCallCount = (gateway: { calls: () => string[] }): number =>
  gateway.calls().filter((call) => call.includes("extract_text_chunk")).length;

const progressAdvanced = (
  continued: number | undefined,
  previous: number | undefined
): boolean =>
  continued !== undefined && previous !== undefined && continued > previous;

const startExhaustedLongInstruction = async (
  baseUrl: string,
  threadId: string,
  gateway: { calls: () => string[] }
) => {
  await managedDevServerTest.runPlayerLookup(
    baseUrl,
    threadId,
    sourceMessage,
    sourceMessageId
  );

  const state = await managedDevServerTest.getParsedAgentThreadState(
    baseUrl,
    threadId
  );

  const chunking = state.contextProcessing.compaction?.chunking;

  expect({
    calls: chunkCallCount(gateway),
    consumedCalls: state.contextProcessing.allowance?.consumedAdditionalCalls,
    status: state.contextProcessing.compaction?.status,
    tailIsUnprocessed:
      (chunking?.nextStart ?? sourceMessage.length) < sourceMessage.length,
  }).toStrictEqual({
    calls: 6,
    consumedCalls: 6,
    status: "allowance_exhausted",
    tailIsUnprocessed: true,
  });

  return state;
};

describe("context processing continuation persistence", () => {
  it("does not grant on restart and resumes long-instruction understanding once per message ID", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/text-compaction-continuation-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;
    const thread = await managedDevServerTest.createAgentThread(baseUrl);

    try {
      const priorThreadMessages = Array.from(
        { length: 12 },
        (_unused, index) => {
          const turn = index + 1;

          return [
            new HumanMessage({
              content: `Earlier scouting context turn ${turn}.`,
              id: `prior-scouting-turn-${turn}`,
            }),
            new AIMessage({
              content: `Acknowledged scouting context turn ${turn}.`,
              id: `prior-scouting-assistant-${turn}`,
            }),
          ];
        }
      ).flat();

      const priorThreadHistory = AgentState.parse({
        messages: priorThreadMessages,
        request: {
          ...createInitialRequestState(),
          processedMessageId: "prior-scouting-turn-12",
        },
        stateSchemaVersion: agentStateSchemaVersion,
      });

      await postJson(
        baseUrl,
        `/threads/${thread.thread_id}/state`,
        waitResponseSchema,
        JSON.stringify({ values: priorThreadHistory })
      );

      const savedHistory = await managedDevServerTest.getParsedAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      console.log(
        JSON.stringify({
          inputMessages: priorThreadHistory.messages.length,
          savedIds: savedHistory.messages.map((message) => message.id),
          savedMessages: savedHistory.messages.length,
        })
      );

      const exhausted = await startExhaustedLongInstruction(
        baseUrl,
        thread.thread_id,
        gateway
      );

      const initialProgress =
        exhausted.contextProcessing.compaction?.chunking?.nextStart;

      const initialCallCount = chunkCallCount(gateway);

      await session.restart();

      const afterRestart = await managedDevServerTest.getParsedAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      expect({
        activeTimeMs:
          afterRestart.contextProcessing.allowance?.consumedActiveTimeMs,
        calls: chunkCallCount(gateway),
        grants: afterRestart.contextProcessing.allowance?.grants,
        progress:
          afterRestart.contextProcessing.compaction?.chunking?.nextStart,
        status: afterRestart.contextProcessing.compaction?.status,
      }).toStrictEqual({
        activeTimeMs:
          exhausted.contextProcessing.allowance?.consumedActiveTimeMs,
        calls: initialCallCount,
        grants: [],
        progress: initialProgress,
        status: "allowance_exhausted",
      });

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        "继续",
        continuationMessageId
      );

      const continued = await managedDevServerTest.getParsedAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      const continuedProgress =
        continued.contextProcessing.compaction?.chunking?.nextStart;

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        "继续",
        continuationMessageId
      );

      expect({
        allowanceCalls:
          continued.contextProcessing.allowance?.consumedAdditionalCalls,
        chunkCalls: chunkCallCount(gateway),
        failure: continued.faultTolerance.failure,
        grants: continued.contextProcessing.allowance?.grants,
        lookupResultAvailable:
          continued.conversationContext.activeLookup?.resultJson.length !==
          undefined,
        originalMessagePreserved:
          continued.messages.find((item) => item.id === sourceMessageId)
            ?.content === sourceMessage,
        outcome: continued.outcome?.status,
        priorAssistantTurnCount: continued.messages.filter(
          (item) => item.id?.startsWith("prior-scouting-assistant-") === true
        ).length,
        priorThreadTurnCount: continued.messages.filter(
          (item) =>
            item.type === "human" &&
            item.id?.startsWith("prior-scouting-turn-") === true
        ).length,
        progressAdvanced: progressAdvanced(continuedProgress, initialProgress),
        requestId: continued.contextProcessing.allowance?.requestId,
        requestKind: continued.request.kind,
        sourceMessageId:
          continued.contextProcessing.compaction?.sourceMessageId,
        status: continued.contextProcessing.compaction?.status,
      }).toStrictEqual({
        allowanceCalls: 11,
        chunkCalls: 10,
        failure: null,
        grants: [
          {
            additionalActiveTimeMs: 120_000,
            additionalCalls: 6,
            continuationMessageId,
            kind: "text_compaction",
            requestId: `message:${sourceMessageId}`,
            sourceHash: continued.contextProcessing.compaction?.sourceHash,
            sourceMessageId,
          },
        ],
        lookupResultAvailable: true,
        originalMessagePreserved: true,
        outcome: "answer_ready",
        priorAssistantTurnCount: 12,
        priorThreadTurnCount: 12,
        progressAdvanced: true,
        requestId: `message:${sourceMessageId}`,
        requestKind: "player_lookup",
        sourceMessageId,
        status: "ready",
      });
    } finally {
      await session.close();
    }
  }, 90_000);
});
