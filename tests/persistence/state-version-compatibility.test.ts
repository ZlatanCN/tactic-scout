import { describe, expect, it } from "vitest";

import {
  postJson,
  startDevServerSession,
  waitResponseSchema,
} from "../fixtures/langgraph-dev-server.js";
import { managedDevServerTest } from "../fixtures/managed-dev-server-persistence.js";
import { clarificationDetails } from "../fixtures/persistence-state.js";

describe("persisted state version compatibility", () => {
  it("blocks an old pending interrupt after State version mismatch without losing history", async () => {
    const session = await startDevServerSession();
    const { baseUrl, gateway } = session;

    try {
      const thread = await managedDevServerTest.createAgentThread(baseUrl);
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        "Look up 凯恩"
      );

      const pending = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      await postJson(
        baseUrl,
        `/threads/${thread.thread_id}/state`,
        waitResponseSchema,
        JSON.stringify({ values: { stateSchemaVersion: 0 } })
      );

      await session.restart();

      const restored = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      const modelCallsBeforeResume = gateway.calls().length;

      await managedDevServerTest.resumeAgentRun(baseUrl, thread.thread_id, {
        candidateId: "reep:canonical:kane",
      });

      const incompatible = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      const modelCallsAfterResume = gateway.calls().length;

      const freshThread = await managedDevServerTest.createAgentThread(baseUrl);
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        freshThread.thread_id,
        "Look up 凯恩"
      );

      const freshThreadState = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        freshThread.thread_id
      );

      expect({
        currentVersion: pending.values.stateSchemaVersion,
        freshThreadNeedsConfirmation:
          clarificationDetails(freshThreadState).hasInterrupt,
        incompatibleOutcome: incompatible.values.outcome,
        modelCallsUnchangedOnResume:
          modelCallsAfterResume === modelCallsBeforeResume,
        oldIdentityStillUnresolved:
          incompatible.values.request.players?.[0]?.resolution?.status,
        oldVersion: incompatible.values.stateSchemaVersion,
        originalMessageRetained: incompatible.values.messages.some(
          ({ content }) => content === "Look up 凯恩"
        ),
        restartRestoredPendingQuestion:
          clarificationDetails(restored).question ===
          clarificationDetails(pending).question,
      }).toStrictEqual({
        currentVersion: 1,
        freshThreadNeedsConfirmation: true,
        incompatibleOutcome: {
          kind: "state_compatibility",
          resultJson: JSON.stringify({ currentVersion: 1, storedVersion: 0 }),
          status: "incompatible",
        },
        modelCallsUnchangedOnResume: true,
        oldIdentityStillUnresolved: "needs_confirmation",
        oldVersion: 0,
        originalMessageRetained: true,
        restartRestoredPendingQuestion: true,
      });
    } finally {
      await session.close();
    }
  }, 180_000);
});
