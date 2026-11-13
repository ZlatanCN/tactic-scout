import { describe, expect, it } from "vitest";

import { AgentState } from "../../src/state.js";
import {
  postJson,
  startDevServerSession,
  waitResponseSchema,
} from "../fixtures/langgraph-dev-server.js";
import { managedDevServerTest } from "../fixtures/managed-dev-server-persistence.js";

const sourceMessageId = "continuation-boundary-source";
const sourceMessage = `Look up Harry Kane. ${"Background note with no scouting constraint. ".repeat(6000)}`;

const persistAndContinue = async (input: {
  baseUrl: string;
  continuationId: string;
  state: ReturnType<typeof AgentState.parse>;
}) => {
  const thread = await managedDevServerTest.createAgentThread(input.baseUrl);

  await postJson(
    input.baseUrl,
    `/threads/${thread.thread_id}/state`,
    waitResponseSchema,
    JSON.stringify({ values: input.state })
  );

  await managedDevServerTest.runPlayerLookup(
    input.baseUrl,
    thread.thread_id,
    "继续",
    input.continuationId
  );

  return await managedDevServerTest.getParsedAgentThreadState(
    input.baseUrl,
    thread.thread_id
  );
};

describe("persisted continuation eligibility", () => {
  it("blocks grants for clarification, source drift, unknown completion, failures, and incompatible State", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/text-compaction-continuation-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;
    const thread = await managedDevServerTest.createAgentThread(baseUrl);

    try {
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        sourceMessage,
        sourceMessageId
      );

      const exhaustedState =
        await managedDevServerTest.getParsedAgentThreadState(
          baseUrl,
          thread.thread_id
        );

      const { compaction } = exhaustedState.contextProcessing;

      if (compaction === null) {
        throw new Error("The persistence fixture did not exhaust compaction.");
      }

      const callCountBeforeBlockedRuns = gateway.calls().length;

      const pendingClarification = AgentState.parse({
        ...exhaustedState,
        pendingClarification: {
          answer: null,
          kind: "context_processing",
          question: "Please clarify the season.",
          sourceHash: compaction.sourceHash,
          sourceMessageId: compaction.sourceMessageId,
        },
      });

      const sourceChanged = AgentState.parse({
        ...exhaustedState,
        contextProcessing: {
          ...exhaustedState.contextProcessing,
          compaction: {
            ...compaction,
            sourceHash: "stale-source-input-digest",
          },
        },
      });

      const completionUnknown = AgentState.parse({
        ...exhaustedState,
        contextProcessing: {
          ...exhaustedState.contextProcessing,
          compaction: {
            ...compaction,
            status: "unknown",
            stopReason: "reservation_unknown",
          },
        },
      });

      const authenticationFailure = AgentState.parse({
        ...exhaustedState,
        faultTolerance: {
          ...exhaustedState.faultTolerance,
          failure: { category: "authentication", node: "understand_request" },
        },
      });

      const incompatibleState = AgentState.parse({
        ...exhaustedState,
        stateSchemaVersion: 0,
      });

      const attempts = await Promise.all([
        persistAndContinue({
          baseUrl,
          continuationId: "blocked-continuation-pending-clarification",
          state: pendingClarification,
        }),
        persistAndContinue({
          baseUrl,
          continuationId: "blocked-continuation-source-changed",
          state: sourceChanged,
        }),
        persistAndContinue({
          baseUrl,
          continuationId: "blocked-continuation-unknown",
          state: completionUnknown,
        }),
        persistAndContinue({
          baseUrl,
          continuationId: "blocked-continuation-authentication",
          state: authenticationFailure,
        }),
        persistAndContinue({
          baseUrl,
          continuationId: "blocked-continuation-incompatible-state",
          state: incompatibleState,
        }),
      ]);

      expect({
        grantCounts: attempts.map(
          (state) => state.contextProcessing.allowance?.grants.length
        ),
        modelCallsAfter: gateway.calls().length,
        modelCallsBefore: callCountBeforeBlockedRuns,
        threads: attempts.length,
      }).toStrictEqual({
        grantCounts: [0, 0, 0, 0, 0],
        modelCallsAfter: callCountBeforeBlockedRuns,
        modelCallsBefore: callCountBeforeBlockedRuns,
        threads: 5,
      });
    } finally {
      await session.close();
    }
  }, 90_000);
});
