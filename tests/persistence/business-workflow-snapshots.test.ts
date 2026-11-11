import { describe, expect, it } from "vitest";

import { comparisonResultSchema } from "../../src/player-data/compare-records.js";
import { recommendationResultSchema } from "../../src/player-data/recommend-players.js";
import { AgentState } from "../../src/state.js";
import { teamRecommendationResultSchema } from "../../src/team-data/recommendation-result.js";
import {
  apiThreadSchema,
  postJson,
  requestJson,
  startDevServerSession,
  threadStateSchema,
  waitResponseSchema,
} from "../fixtures/langgraph-dev-server.js";
import { managedDevServerTest } from "../fixtures/managed-dev-server-persistence.js";
import {
  activeRecommendationFromState,
  persistedThreadFacts,
  savedTeamSnapshotOutcome,
} from "../fixtures/persistence-state.js";

describe("four workflow snapshots survive a managed restart", () => {
  it("runs and restores all four business workflows through the managed graph", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/persistence-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;

    try {
      const thread = await postJson(
        baseUrl,
        "/threads",
        apiThreadSchema,
        JSON.stringify({ metadata: { graph_id: "agent" } })
      );

      const runMessage = async (content: string): Promise<void> => {
        await postJson(
          baseUrl,
          `/threads/${thread.thread_id}/runs/wait`,
          waitResponseSchema,
          JSON.stringify({
            assistant_id: "agent",
            input: { messages: [{ content, role: "user" }] },
          })
        );
      };

      const getThreadState = async () =>
        await requestJson(
          baseUrl,
          `/threads/${thread.thread_id}/state`,
          threadStateSchema
        );

      const lookupRunResponse = await postJson(
        baseUrl,
        `/threads/${thread.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          input: {
            messages: [{ content: "Look up Harry Kane", role: "user" }],
          },
        })
      );

      const lookupStateResponse = await requestJson(
        baseUrl,
        `/threads/${thread.thread_id}/state`,
        waitResponseSchema
      );

      const parsedLookupState =
        threadStateSchema.safeParse(lookupStateResponse);

      if (!parsedLookupState.success) {
        throw new Error(
          JSON.stringify({
            issues: parsedLookupState.error.issues,
            modelRequests: gateway.calls(),
            run: lookupRunResponse,
            state: lookupStateResponse,
          })
        );
      }

      const lookupState = parsedLookupState.data;

      expect({
        fixtureEvents: gateway.events(),
        lookupPresent:
          lookupState.values.conversationContext.activeLookup?.resultJson !==
          undefined,
        outcome: lookupState.values.outcome,
        playerStatus:
          lookupState.values.request.players?.[0]?.resolution?.status,
        requestKind: lookupState.values.request.kind,
      }).toMatchObject({
        fixtureEvents: ["player-search"],
        lookupPresent: true,
        outcome: { kind: "player_lookup", status: "answer_ready" },
        playerStatus: "resolved",
        requestKind: "player_lookup",
      });
      await runMessage("Compare Harry Kane and Erling Haaland");
      await runMessage("Find alternatives to Harry Kane");
      await runMessage("Recommend a striker for Test Club");

      const finishedState = await getThreadState();
      activeRecommendationFromState(finishedState);

      const finishedFacts = persistedThreadFacts(
        AgentState.parse(finishedState.values)
      );

      const initialSnapshots = {
        comparison:
          finishedState.values.conversationContext.activeComparison
            ?.resultJson ?? "",
        lookup:
          finishedState.values.conversationContext.activeLookup?.resultJson,
        recommendation:
          finishedState.values.conversationContext.activeRecommendation
            ?.resultJson,
        team: finishedState.values.conversationContext.activeTeamRecommendation
          ?.resultJson,
      };

      const fixtureEvents = gateway.events();
      const modelCallsBeforeRestart = gateway.calls().length;

      await session.restart();

      const restoredState = await getThreadState();

      const restoredFacts = persistedThreadFacts(
        AgentState.parse(restoredState.values)
      );

      const restoredSnapshots = {
        comparison:
          restoredState.values.conversationContext.activeComparison
            ?.resultJson ?? "",
        lookup:
          restoredState.values.conversationContext.activeLookup?.resultJson,
        recommendation:
          restoredState.values.conversationContext.activeRecommendation
            ?.resultJson,
        team: restoredState.values.conversationContext.activeTeamRecommendation
          ?.resultJson,
      };

      const callsAfterStartup = gateway.calls().length;
      const eventsAfterStartup = gateway.events();

      await runMessage("Explain the saved team recommendation");
      const explainedState = await getThreadState();
      const eventsAfterSavedExplanation = gateway.events();

      await managedDevServerTest.verifyCompletedFailureWaitsForExplicitRetry({
        baseUrl,
        gateway,
        runMessage,
        session,
        threadId: thread.thread_id,
      });

      expect({
        comparison: comparisonResultSchema.parse(
          JSON.parse(initialSnapshots.comparison)
        ).status,
        lookupPresent: initialSnapshots.lookup !== undefined,
        recommendation: recommendationResultSchema.parse(
          JSON.parse(initialSnapshots.recommendation ?? "{}")
        ).status,
        team: teamRecommendationResultSchema.parse(
          JSON.parse(initialSnapshots.team ?? "{}")
        ).status,
      }).toStrictEqual({
        comparison: "ready",
        lookupPresent: true,
        recommendation: "ready",
        team: "ready",
      });
      expect({
        callsAfterStartup,
        callsBeforeRestart: modelCallsBeforeRestart,
        eventsAfterStartup,
        eventsBeforeRestart: fixtureEvents,
        initialSnapshots,
        restoredFacts,
        restoredSnapshots,
      }).toStrictEqual({
        callsAfterStartup: modelCallsBeforeRestart,
        callsBeforeRestart: modelCallsBeforeRestart,
        eventsAfterStartup: fixtureEvents,
        eventsBeforeRestart: fixtureEvents,
        initialSnapshots,
        restoredFacts: finishedFacts,
        restoredSnapshots: initialSnapshots,
      });
      expect({
        eventsAfterReuse: eventsAfterSavedExplanation,
        eventsBeforeReuse: fixtureEvents,
        savedSnapshot: savedTeamSnapshotOutcome(
          initialSnapshots.team,
          explainedState
        ),
      }).toStrictEqual({
        eventsAfterReuse: fixtureEvents,
        eventsBeforeReuse: fixtureEvents,
        savedSnapshot: {
          fmSnapshotDate: "2025-11-23",
          kind: "team_recommendation",
          matchesOriginalSnapshot: true,
          rosterRetrievedAt: "2026-11-07T00:00:00.000Z",
          source: "saved",
          status: "ready",
        },
      });
    } finally {
      await session.close();
    }
  }, 120_000);
});
