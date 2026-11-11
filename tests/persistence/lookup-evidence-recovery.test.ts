import { createHash } from "node:crypto";

import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../src/state.js";
import {
  postJson,
  requestJson,
  startDevServerSession,
  waitResponseSchema,
} from "../fixtures/langgraph-dev-server.js";
import { managedDevServerTest } from "../fixtures/managed-dev-server-persistence.js";
import { playerReference } from "../fixtures/persistence-state.js";

describe("lookup evidence allowance recovery", () => {
  it("continues saved lookup evidence with its allowance after a native restart", async () => {
    const session = await startDevServerSession();
    const { baseUrl, gateway } = session;
    const thread = await managedDevServerTest.createAgentThread(baseUrl);
    const messageId = "saved-lookup-evidence-restart";
    const question = "What xA did Understat report across these seasons?";

    const resultJson = JSON.stringify({
      identityGroups: {
        canonicalGroups: [
          {
            canonicalIdentityId: "canonical-mikel",
            name: "Mikel Oyarzabal",
            records: [
              {
                identitySourceId: "understat-mikel",
                name: "Mikel Oyarzabal",
                provider: "understat",
                recordId: "understat-mikel",
              },
            ],
          },
        ],
        registryStatus: "available",
        unlinkedRecords: [],
      },
      query: [{ provider: "understat", sourceId: "understat-mikel" }],
      requestedUnderstatSeasonStartYear: null,
      understat: {
        records: [
          {
            appearances: 8,
            assists: 2,
            competition: "La_liga",
            expectedAssists: 0.8,
            expectedGoals: 1.1,
            goals: 2,
            keyPasses: 9,
            minutes: 520,
            nonPenaltyExpectedGoals: 1.1,
            player: "Mikel Oyarzabal",
            position: "F M S",
            season: "2024/25",
            shots: 14,
            source: "Understat",
            sourcePlayerId: "understat-mikel",
            team: "Real Sociedad",
          },
          {
            appearances: 10,
            assists: 3,
            competition: "La_liga",
            expectedAssists: 1.4,
            expectedGoals: 1.7,
            goals: 3,
            keyPasses: 12,
            minutes: 700,
            nonPenaltyExpectedGoals: 1.7,
            player: "Mikel Oyarzabal",
            position: "F M S",
            season: "2025/26",
            shots: 20,
            source: "Understat",
            sourcePlayerId: "understat-mikel",
            team: "Real Sociedad",
          },
        ],
        status: "found",
      },
    });

    const resultDigest = createHash("sha256").update(resultJson).digest("hex");

    const questionHash = createHash("sha256").update(question).digest("hex");
    const requestId = `message:${messageId}`;

    const sourceHash = createHash("sha256")
      .update(
        `saved:${messageId}:${resultDigest}:${questionHash}:lookup-evidence-v1`
      )
      .digest("hex");

    const identityGroups = {
      canonicalGroups: [
        {
          canonicalIdentityId: "canonical-mikel",
          name: "Mikel Oyarzabal",
          records: [
            {
              identitySourceId: "understat-mikel",
              name: "Mikel Oyarzabal",
              provider: "understat",
              recordId: "understat-mikel",
            },
          ],
        },
      ],
      registryStatus: "available" as const,
      unlinkedRecords: [],
    };

    const query = [{ provider: "understat", sourceId: "understat-mikel" }];

    const projection = (index: number, season: string) =>
      JSON.stringify({
        batch: {
          completedRecordRefs: index === 0 ? [] : ["understat.records[0]"],
          index,
          recordRefs: [`understat.records[${index}]`],
          remainingRecordRefs: index === 0 ? ["understat.records[1]"] : [],
          total: 2,
        },
        coverage: {
          fields: {
            fm: { selected: [], unselected: [] },
            understat: {
              selected: ["expectedAssists"],
              unselected: [],
            },
          },
          providers: {
            fm: { queried: false, status: "not_queried" },
            understat: {
              queried: true,
              seasonMode: "default_snapshot",
              status: "found",
            },
          },
          records: [`understat.records[${index}]`],
        },
        digest: resultDigest,
        identityGroups,
        query,
        records: [
          {
            competition: "La_liga",
            fieldStates: {
              expectedAssists: {
                state: "value",
                value: index === 0 ? 0.8 : 1.4,
              },
            },
            player: "Mikel Oyarzabal",
            provider: "understat",
            recordRef: `understat.records[${index}]`,
            season,
            selectedFields: ["expectedAssists"],
            source: "Understat",
            sourceId: "understat-mikel",
            team: "Real Sociedad",
            unselectedFields: [],
          },
        ],
        requestedUnderstatSeasonStartYear: null,
        source: "saved",
        version: 1,
      });

    const seededState = AgentState.parse({
      contextProcessing: {
        allowance: {
          consumedActiveTimeMs: 500,
          consumedAdditionalCalls: 1,
          maxActiveTimeMs: 120_000,
          maxAdditionalCalls: 2,
          requestId,
          reservation: null,
        },
        clarification: null,
        compaction: null,
      },
      conversationContext: {
        ...createInitialConversationContext(),
        activeLookup: {
          player: playerReference("fm-mikel", "Mikel Oyarzabal"),
          resultJson,
        },
      },
      lookupEvidence: {
        batches: [
          {
            answer: "The 2024/25 xA was 0.8.",
            index: 0,
            projectionJson: projection(0, "2024/25"),
            recordRefs: ["understat.records[0]"],
            status: "ready",
          },
          {
            answer: null,
            index: 1,
            projectionJson: projection(1, "2025/26"),
            recordRefs: ["understat.records[1]"],
            status: "pending",
          },
        ],
        failureReason: null,
        questionHash,
        requestId,
        resultDigest,
        source: "saved",
        sourceHash,
        sourceMessageId: messageId,
        status: "processing",
      },
      messages: [new HumanMessage({ content: question, id: messageId })],
      outcome: {
        kind: "player_lookup",
        resultJson,
        source: "saved",
        status: "lookup_follow_up",
      },
      request: {
        ...createInitialRequestState(),
        kind: "player_lookup",
        processedMessageId: messageId,
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    try {
      const values = {
        ...seededState,
        messages: [{ content: question, id: messageId, type: "human" }],
      };

      await postJson(
        baseUrl,
        `/threads/${thread.thread_id}/state`,
        waitResponseSchema,
        JSON.stringify({ values })
      );

      const beforeRestart = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      expect({
        allowanceCalls:
          beforeRestart.values.contextProcessing?.allowance
            ?.consumedAdditionalCalls,
        evidenceStatuses: beforeRestart.values.lookupEvidence?.batches.map(
          ({ status }) => status
        ),
      }).toStrictEqual({
        allowanceCalls: 1,
        evidenceStatuses: ["ready", "pending"],
      });

      await session.restart();

      const restored = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      expect({
        allowanceCalls:
          restored.values.contextProcessing?.allowance?.consumedAdditionalCalls,
        evidenceStatuses: restored.values.lookupEvidence?.batches.map(
          ({ status }) => status
        ),
        resultJson:
          restored.values.conversationContext.activeLookup?.resultJson,
      }).toStrictEqual({
        allowanceCalls: 1,
        evidenceStatuses: ["ready", "pending"],
        resultJson,
      });

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        question,
        messageId
      );

      const completed = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      expect({
        allowanceCalls:
          completed.values.contextProcessing?.allowance
            ?.consumedAdditionalCalls,
        answer: managedDevServerTest.latestAssistantText(completed),
        evidenceAnswers: completed.values.lookupEvidence?.batches.map(
          ({ answer }) => answer
        ),
        evidenceStatus: completed.values.lookupEvidence?.status,
        modelCalls: gateway.calls().length,
        providerEvents: gateway.events(),
        reservation: completed.values.contextProcessing?.allowance?.reservation,
      }).toStrictEqual({
        allowanceCalls: 2,
        answer:
          "按来源记录分别说明：\n\nThe 2024/25 xA was 0.8.\n\nThe saved scouting context is ready.",
        evidenceAnswers: [
          "The 2024/25 xA was 0.8.",
          "The saved scouting context is ready.",
        ],
        evidenceStatus: "complete",
        modelCalls: 1,
        providerEvents: [],
        reservation: null,
      });

      await managedDevServerTest.verifyUnknownLookupEvidenceReservationAfterRestart(
        {
          baseUrl,
          gateway,
          question,
          questionHash,
          resultDigest,
          resultJson,
          seededState,
          session,
        }
      );
    } finally {
      await session.close();
    }
  }, 60_000);

  it("retries an unfinished lookup after restart and rebuilds an incompatible compaction cache", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/text-compaction-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;
    const thread = await managedDevServerTest.createAgentThread(baseUrl);
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const message = `Look up Harry Kane. ${filler}`;
    const messageId = "understanding-restart-recovery";

    try {
      const readSparseAgentState = async () => {
        const state = await requestJson(
          baseUrl,
          `/threads/${thread.thread_id}/state`,
          z.looseObject({ values: z.looseObject({}).optional() })
        );

        if (state.values === undefined) {
          throw new Error("The interrupted thread has no state values.");
        }

        return AgentState.parse(state.values);
      };

      gateway.failModelCallsAt([2, 3, 4]);
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        message,
        messageId
      );

      const interrupted = await readSparseAgentState();
      const interruptedCompaction = interrupted.contextProcessing.compaction;

      if (
        interruptedCompaction === undefined ||
        interruptedCompaction === null
      ) {
        throw new Error("The interrupted request has no compaction record.");
      }

      const compactionCallsBeforeRestart = gateway
        .calls()
        .filter((call) =>
          call.includes('"name":"compact_scouting_instruction"')
        );

      expect({
        allowanceCalls:
          interrupted.contextProcessing.allowance?.consumedAdditionalCalls,
        compactionCalls: compactionCallsBeforeRestart.length,
        compactionStatus: interruptedCompaction.status,
        originalMessagePresent: interrupted.messages.some(
          (item) =>
            item.type === "human" &&
            item.id === messageId &&
            item.content === message
        ),
        understandingFailureReported:
          interrupted.faultTolerance.failure?.node === "understand_request",
      }).toStrictEqual({
        allowanceCalls: 1,
        compactionCalls: 1,
        compactionStatus: "ready",
        originalMessagePresent: true,
        understandingFailureReported: true,
      });

      const incompatibleCompaction = {
        ...interruptedCompaction,
        activeContextHash: "stale-online-context-hash",
      };

      const { contextProcessing } = interrupted;

      await postJson(
        baseUrl,
        `/threads/${thread.thread_id}/state`,
        waitResponseSchema,
        JSON.stringify({
          values: {
            contextProcessing: {
              ...contextProcessing,
              compaction: incompatibleCompaction,
            },
          },
        })
      );
      await session.restart();

      const restarted = await readSparseAgentState();
      gateway.failModelCallsAt([]);
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
        originalMessagePresent: completed.values.messages.some(
          ({ content, id, type }) =>
            type === "human" && id === messageId && content === message
        ),
        staleCacheSurvivedRestart:
          restarted.contextProcessing.compaction?.activeContextHash ===
          "stale-online-context-hash",
      }).toStrictEqual({
        allowanceCalls: 2,
        compactionCalls: 2,
        compactionStatus: "ready",
        lookupOutcome: "answer_ready",
        originalMessagePresent: true,
        staleCacheSurvivedRestart: true,
      });
      expect(
        managedDevServerTest.textCompactionFacts(completed)
          .lookupResultAvailable
      ).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  }, 90_000);
});
