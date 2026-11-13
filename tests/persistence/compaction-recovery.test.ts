import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { AgentState } from "../../src/state.js";
import {
  requestJson,
  startDevServerSession,
} from "../fixtures/langgraph-dev-server.js";
import { managedDevServerTest } from "../fixtures/managed-dev-server-persistence.js";

const assertThreadStateContainsContext = async (
  baseUrl: string,
  threadId: string,
  modelCalls: string[],
  providerEvents: string[]
): Promise<void> => {
  const rawState = await requestJson(
    baseUrl,
    `/threads/${threadId}/state`,
    z.looseObject({ values: z.unknown().optional() })
  );

  const stateKeys = z.record(z.string(), z.unknown()).parse(rawState.values);

  const modelCallTools = modelCalls.map((body) => {
    const call = z
      .looseObject({
        tools: z
          .array(
            z.looseObject({ function: z.looseObject({ name: z.string() }) })
          )
          .optional(),
      })
      .parse(JSON.parse(body));

    return call.tools?.map(({ function: tool }) => tool.name) ?? [];
  });

  if (stateKeys.conversationContext !== undefined) {
    return;
  }

  const state = AgentState.safeParse(rawState.values);

  throw new Error(
    JSON.stringify({
      modelCallTools,
      modelCalls: modelCalls.length,
      providerEvents,
      stateKeys: Object.keys(stateKeys),
      status: state.success
        ? {
            compaction: state.data.contextProcessing.compaction?.status,
            compactionStop: state.data.contextProcessing.compaction?.stopReason,
            fault: state.data.faultTolerance.failure?.category,
            outcome: state.data.outcome?.status,
            requestKind: state.data.request.kind,
          }
        : state.error.issues.map(({ path }) => path.join(".")),
    })
  );
};

describe("compaction and chunk checkpoint recovery", () => {
  it("reuses a completed text compaction after a native Dev Server restart", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/text-compaction-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;
    const thread = await managedDevServerTest.createAgentThread(baseUrl);
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const message = `Look up Harry Kane. ${filler}`;

    try {
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        message
      );

      await assertThreadStateContainsContext(
        baseUrl,
        thread.thread_id,
        gateway.calls(),
        gateway.events()
      );

      const completedBeforeRestart =
        await managedDevServerTest.getAgentThreadState(
          baseUrl,
          thread.thread_id
        );

      const compactionBeforeRestart =
        completedBeforeRestart.values.contextProcessing?.compaction;

      const originalMessage = completedBeforeRestart.values.messages
        .toReversed()
        .find(({ content, type }) => type === "human" && content === message);

      const messageId = originalMessage?.id;

      if (messageId === undefined) {
        throw new Error("The completed scouting message has no stable ID.");
      }

      expect({
        allowanceCalls:
          completedBeforeRestart.values.contextProcessing?.allowance
            ?.consumedAdditionalCalls,
        compactionStatus: compactionBeforeRestart?.status,
        instruction: compactionBeforeRestart?.instruction,
        lookupOutcome: completedBeforeRestart.values.outcome?.status,
        lookupResultAvailable:
          managedDevServerTest.textCompactionFacts(completedBeforeRestart)
            .lookupResultAvailable > 0,
        originalMessagePresent: originalMessage?.content === message,
      }).toStrictEqual({
        allowanceCalls: 1,
        compactionStatus: "ready",
        instruction: "Look up Harry Kane",
        lookupOutcome: "answer_ready",
        lookupResultAvailable: true,
        originalMessagePresent: true,
      });
      expect(
        gateway
          .calls()
          .filter((call) =>
            call.includes('"name":"compact_scouting_instruction"')
          )
      ).toHaveLength(1);

      await session.restart();

      const restartedState = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      expect({
        allowanceCalls:
          restartedState.values.contextProcessing?.allowance
            ?.consumedAdditionalCalls,
        compaction: restartedState.values.contextProcessing?.compaction,
        lookupResultJson:
          restartedState.values.conversationContext.activeLookup?.resultJson,
      }).toStrictEqual({
        allowanceCalls: 1,
        compaction: compactionBeforeRestart,
        lookupResultJson:
          completedBeforeRestart.values.conversationContext.activeLookup
            ?.resultJson,
      });

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        message,
        messageId
      );

      const completed = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      const completedCompactionCalls = gateway
        .calls()
        .filter((call) =>
          call.includes('"name":"compact_scouting_instruction"')
        );

      expect({
        allowanceCalls:
          completed.values.contextProcessing?.allowance
            ?.consumedAdditionalCalls,
        compactionCalls: completedCompactionCalls.length,
        compactionStatus:
          completed.values.contextProcessing?.compaction?.status,
        lookupOutcome: completed.values.outcome?.status,
        requestKind: completed.values.request.kind,
      }).toStrictEqual({
        allowanceCalls: 1,
        compactionCalls: 1,
        compactionStatus: "ready",
        lookupOutcome: "answer_ready",
        requestKind: "player_lookup",
      });
      expect(
        managedDevServerTest.textCompactionFacts(completed)
          .lookupResultAvailable
      ).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  }, 45_000);

  it("persists completed chunks and exhausted allowance through a native restart", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/text-compaction-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;
    const thread = await managedDevServerTest.createAgentThread(baseUrl);
    const filler = "Background note with no scouting constraint. ".repeat(6000);
    const message = `Look up Harry Kane. ${filler}`;
    const messageId = "partial-chunk-progress";

    const chunkCalls = () =>
      gateway.calls().filter((call) => call.includes("extract_text_chunk"));

    const readAgentState = async () => {
      const state = await requestJson(
        baseUrl,
        `/threads/${thread.thread_id}/state`,
        z.looseObject({ values: z.unknown().optional() })
      );

      if (state.values === undefined) {
        throw new Error("The chunked thread has no state values.");
      }

      return AgentState.parse(state.values);
    };

    try {
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        message,
        messageId
      );
      const beforeRestart = await readAgentState();

      const beforeCompaction = beforeRestart.contextProcessing.compaction;

      const beforeChunking = beforeCompaction?.chunking;

      expect({
        ...managedDevServerTest.chunkProgressFacts(
          beforeRestart,
          message,
          messageId
        ),
        chunkCalls: chunkCalls().length,
        mergeCalls: gateway
          .calls()
          .filter((call) => call.includes("merge_text_chunks")).length,
      }).toStrictEqual({
        allProcessedChunksSaved: true,
        allowanceCalls: 6,
        chunkCalls: 6,
        chunkCount: 6,
        hasUnprocessedTail: true,
        mergeCalls: 0,
        originalMessagePresent: true,
        status: "allowance_exhausted",
      });

      await session.restart();

      const afterRestart = await readAgentState();

      expect({
        ...managedDevServerTest.chunkProgressFacts(
          afterRestart,
          message,
          messageId
        ),
        chunkCalls: chunkCalls().length,
        chunkingMatches: isDeepStrictEqual(
          afterRestart.contextProcessing.compaction?.chunking,
          beforeChunking
        ),
      }).toStrictEqual({
        allProcessedChunksSaved: true,
        allowanceCalls: 6,
        chunkCalls: 6,
        chunkCount: 6,
        chunkingMatches: true,
        hasUnprocessedTail: true,
        originalMessagePresent: true,
        status: "allowance_exhausted",
      });

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        message,
        messageId
      );

      const afterReplay = await readAgentState();

      expect({
        ...managedDevServerTest.chunkProgressFacts(
          afterReplay,
          message,
          messageId
        ),
        chunkCalls: chunkCalls().length,
        chunkingMatches: isDeepStrictEqual(
          afterReplay.contextProcessing.compaction?.chunking,
          beforeChunking
        ),
      }).toStrictEqual({
        allProcessedChunksSaved: true,
        allowanceCalls: 6,
        chunkCalls: 6,
        chunkCount: 6,
        chunkingMatches: true,
        hasUnprocessedTail: true,
        originalMessagePresent: true,
        status: "allowance_exhausted",
      });
    } finally {
      await session.close();
    }
  }, 90_000);
});
