import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import {
  contextProcessingHash,
  contextProcessingRequestId,
} from "../../src/context-processing-state.js";
import { AgentState } from "../../src/state.js";
import {
  postJson,
  requestJson,
  startDevServerSession,
  waitResponseSchema,
} from "../fixtures/langgraph-dev-server.js";
import { managedDevServerTest } from "../fixtures/managed-dev-server-persistence.js";

const readAgentState = async (baseUrl: string, threadId: string) => {
  const response = await requestJson(
    baseUrl,
    `/threads/${threadId}/state`,
    z.looseObject({ values: z.unknown().optional() })
  );

  if (response.values === undefined) {
    throw new Error("The provider recovery thread has no state values.");
  }

  return AgentState.parse(response.values);
};

type PersistedAgentState = ReturnType<typeof AgentState.parse>;

const pendingOverflowClarificationFacts = (
  state: PersistedAgentState,
  modelCalls: number
) => ({
  compactionStatus: state.contextProcessing.compaction?.status,
  compactionStopReason: state.contextProcessing.compaction?.stopReason,
  faultReason: state.faultTolerance.failure?.category ?? null,
  modelCalls,
  pendingKind: state.pendingClarification?.kind,
  primaryRequestReserved:
    state.providerOverflowRecovery?.primaryRequestReserved,
  recoveryOpen: state.providerOverflowRecovery?.recoveryAllowanceOpen,
  sourceRequestId: state.providerOverflowRecovery?.sourceRequestId,
});

const restoredOverflowClarificationFacts = (state: PersistedAgentState) => ({
  compactionStatus: state.contextProcessing.compaction?.status,
  pendingKind: state.pendingClarification?.kind,
  recoveryOpen: state.providerOverflowRecovery?.recoveryAllowanceOpen,
  restoredRunId: state.providerOverflowRecovery?.runId,
});

const resumedOverflowClarificationFacts = (
  state: PersistedAgentState,
  message: string,
  messageId: string,
  modelCallsBefore: number,
  modelCallsAfter: number
) => ({
  allowanceCalls: state.contextProcessing.allowance?.consumedAdditionalCalls,
  allowanceMaxAdditionalCalls:
    state.contextProcessing.allowance?.maxAdditionalCalls,
  clarificationAnswers: state.contextProcessing.clarification?.answers,
  compactionStatus: state.contextProcessing.compaction?.status,
  compactionStopReason: state.contextProcessing.compaction?.stopReason,
  completedChunkPreserved:
    state.contextProcessing.compaction?.chunking?.chunks.some(
      ({ status }) => status === "ready"
    ) ?? false,
  lookupResultAvailable:
    (state.conversationContext.activeLookup?.resultJson.length ?? 0) > 0,
  modelCallsAfterResume: modelCallsAfter - modelCallsBefore,
  originalMessagePresent: state.messages.some(
    ({ content, id, type }) =>
      type === "human" && id === messageId && content === message
  ),
  outcomeStatus: state.outcome?.status,
  pendingKind: state.pendingClarification,
  recoveryOpen: state.providerOverflowRecovery?.recoveryAllowanceOpen,
  recoveryRunId: state.providerOverflowRecovery?.runId,
  requestKind: state.request.kind,
});

describe("provider overflow recovery persistence", () => {
  it("settles an unknown recovery reservation after restart without replaying it", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/text-compaction-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;
    const thread = await managedDevServerTest.createAgentThread(baseUrl);
    const sourceText = "Look up Harry Kane.";
    const messageId = "provider-overflow-unknown-completion";
    const sourceHash = contextProcessingHash(sourceText);

    const sourceRequestId = contextProcessingRequestId(
      messageId,
      sourceText,
      1
    );

    const seededState = AgentState.parse({
      contextProcessing: {
        allowance: {
          consumedActiveTimeMs: 5000,
          consumedAdditionalCalls: 6,
          maxActiveTimeMs: 120_000,
          maxAdditionalCalls: 6,
          requestId: sourceRequestId,
          reservation: null,
          reservedActiveTimeMs: 1000,
        },
        clarification: null,
        compaction: null,
      },
      messages: [{ content: sourceText, id: messageId, type: "human" }],
      providerOverflowRecovery: {
        attempts: 1,
        node: "understand_request",
        operationRequestsUsed: 1,
        primaryRequestReserved: true,
        recoveryAllowanceCallsReserved: 2,
        recoveryAllowanceOpen: true,
        reservedActiveTimeMs: 1000,
        runId: "previous-provider-run",
        sourceHash,
        sourceRequestId,
      },
    });

    const readState = async () => {
      const response = await requestJson(
        baseUrl,
        `/threads/${thread.thread_id}/state`,
        z.looseObject({ values: z.unknown().optional() })
      );

      if (response.values === undefined) {
        throw new Error("The provider recovery thread has no state values.");
      }

      return AgentState.parse(response.values);
    };

    try {
      await postJson(
        baseUrl,
        `/threads/${thread.thread_id}/state`,
        waitResponseSchema,
        JSON.stringify({ values: seededState })
      );

      const beforeRestart = await readState();

      await session.restart();

      const afterRestart = await readState();
      const callsBeforeReplay = gateway.calls().length;

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        sourceText,
        messageId
      );

      const afterReplay = await readState();

      expect({
        beforeRestartOpen:
          beforeRestart.providerOverflowRecovery?.recoveryAllowanceOpen,
        callsAfterReplay: gateway.calls().length - callsBeforeReplay,
        consumedActiveTimeMs:
          afterReplay.contextProcessing.allowance?.consumedActiveTimeMs,
        consumedAdditionalCalls:
          afterReplay.contextProcessing.allowance?.consumedAdditionalCalls,
        failureNode: afterReplay.faultTolerance.failure?.node,
        failureReason: afterReplay.faultTolerance.failure?.category,
        recoveryCallsReserved:
          afterReplay.providerOverflowRecovery?.recoveryAllowanceCallsReserved,
        recoveryOpen:
          afterReplay.providerOverflowRecovery?.recoveryAllowanceOpen,
        reservedActiveTimeMs:
          afterReplay.contextProcessing.allowance?.reservedActiveTimeMs,
        restoredRunId: afterRestart.providerOverflowRecovery?.runId,
      }).toStrictEqual({
        beforeRestartOpen: true,
        callsAfterReplay: 0,
        consumedActiveTimeMs: 6000,
        consumedAdditionalCalls: 6,
        failureNode: "understand_request",
        failureReason: "context_limit",
        recoveryCallsReserved: 0,
        recoveryOpen: false,
        reservedActiveTimeMs: 0,
        restoredRunId: "previous-provider-run",
      });
    } finally {
      await session.close();
    }
  }, 60_000);

  it("resumes an overflow clarification across restart with its pending grant", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/provider-overflow-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;
    const thread = await managedDevServerTest.createAgentThread(baseUrl);

    const message = `Look up Harry Kane. Which season should I use? ${"Background detail. ".repeat(100)} Erling Haaland.`;

    const messageId = "provider-overflow-clarification-resume";
    const sourceRequestId = contextProcessingRequestId(messageId, message, 1);

    gateway.overflowModelCallsAt([1]);
    gateway.ambiguousCompactionCallsAt([2]);

    try {
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        message,
        messageId
      );

      const paused = await readAgentState(baseUrl, thread.thread_id);
      const pausedRunId = paused.providerOverflowRecovery?.runId;

      expect(
        pendingOverflowClarificationFacts(paused, gateway.calls().length)
      ).toStrictEqual({
        compactionStatus: "needs_clarification",
        compactionStopReason: "ambiguous_conditions",
        faultReason: null,
        modelCalls: 4,
        pendingKind: "context_processing",
        primaryRequestReserved: false,
        recoveryOpen: true,
        sourceRequestId,
      });

      await session.restart();

      const restored = await readAgentState(baseUrl, thread.thread_id);
      const callsBeforeResume = gateway.calls().length;

      expect(restoredOverflowClarificationFacts(restored)).toStrictEqual({
        compactionStatus: "needs_clarification",
        pendingKind: "context_processing",
        recoveryOpen: true,
        restoredRunId: pausedRunId,
      });

      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        thread.thread_id,
        "Use 2025/26."
      );

      const resumed = await readAgentState(baseUrl, thread.thread_id);
      expect(
        resumedOverflowClarificationFacts(
          resumed,
          message,
          messageId,
          callsBeforeResume,
          gateway.calls().length
        )
      ).toStrictEqual({
        allowanceCalls: 7,
        allowanceMaxAdditionalCalls: 10,
        clarificationAnswers: ["Use 2025/26."],
        compactionStatus: "ready",
        compactionStopReason: null,
        completedChunkPreserved: true,
        lookupResultAvailable: true,
        modelCallsAfterResume: 6,
        originalMessagePresent: true,
        outcomeStatus: "answer_ready",
        pendingKind: null,
        recoveryOpen: false,
        recoveryRunId: pausedRunId,
        requestKind: "player_lookup",
      });
    } finally {
      await session.close();
    }
  }, 90_000);
});
