import { rm } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  apiThreadSchema,
  createTemporaryProject,
  postJson,
  putJson,
  requestJson,
  reservePort,
  startGateway,
  startServer,
  stopServer,
  storeItemSchema,
  threadStateSchema,
  waitForServerStop,
  waitResponseSchema,
} from "./fixtures/langgraph-dev-server.js";
import type { RunningServer } from "./fixtures/langgraph-dev-server.js";
import {
  playerReference,
  savedConversationContext,
} from "./fixtures/persistence-state.js";

describe("managed Dev Server persistence", () => {
  it("restores workflow snapshots and a pending clarification after a normal restart", async () => {
    const gateway = await startGateway();
    let projectPath: string | null = null;
    let runningServer: RunningServer | null = null;

    try {
      projectPath = await createTemporaryProject(gateway.url);
      const port = await reservePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      runningServer = await startServer(projectPath, gateway.url, port);
      const callsAfterFirstStartup = gateway.calls().length;

      const savedThread = await postJson(
        baseUrl,
        "/threads",
        apiThreadSchema,
        JSON.stringify({ metadata: { graph_id: "agent" } })
      );

      const kane = playerReference("fm-kane", "Harry Kane");
      const haaland = playerReference("fm-haaland", "Erling Haaland");
      const conversationContext = savedConversationContext(kane, haaland);

      const outcome = {
        kind: "player_comparison",
        resultJson: conversationContext.activeComparison.resultJson,
        source: "saved",
        status: "ready",
      };

      await postJson(
        baseUrl,
        `/threads/${savedThread.thread_id}/state`,
        waitResponseSchema,
        JSON.stringify({
          as_node: "compare_players",
          values: {
            conversationContext,
            messages: [
              { content: "Explain the saved comparison.", type: "human" },
            ],
            outcome,
            request: {
              comparisonAction: "replace",
              constraints: [],
              kind: "player_comparison",
              players: [],
              processedMessageId: null,
              teams: [],
            },
          },
        })
      );

      const identityThread = await postJson(
        baseUrl,
        "/threads",
        apiThreadSchema,
        JSON.stringify({ metadata: { graph_id: "agent" } })
      );

      const playerResolution = {
        candidateCount: 1,
        candidates: [kane.candidate],
        candidatesTruncated: false,
        canonicalIdentityId: null,
        clarificationMessage: "Select the intended player.",
        mention: "凯恩",
        selectedCandidateId: null,
        selectedName: null,
        status: "needs_confirmation",
      };

      await postJson(
        baseUrl,
        `/threads/${identityThread.thread_id}/state`,
        waitResponseSchema,
        JSON.stringify({
          as_node: "resolve_entities",
          values: {
            conversationContext,
            messages: [
              { content: "Compare 凯恩 with Haaland.", type: "human" },
            ],
            outcome: null,
            pendingClarification: {
              answer: null,
              kind: "identity",
              playerIndex: 0,
              question: "Which player do you mean by 凯恩?",
            },
            request: {
              comparisonAction: "replace",
              constraints: [],
              kind: "player_comparison",
              players: [
                {
                  attempts: 0,
                  lookupName: "Harry Kane",
                  mention: "凯恩",
                  recommendationRole: "reference",
                  referenceScope: "explicit",
                  referenceTargetMention: null,
                  resolution: playerResolution,
                },
              ],
              processedMessageId: "identity-question",
              teams: [],
            },
          },
        })
      );
      await postJson(
        baseUrl,
        `/threads/${identityThread.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({ assistant_id: "agent", input: null })
      );

      const rosterThread = await postJson(
        baseUrl,
        "/threads",
        apiThreadSchema,
        JSON.stringify({ metadata: { graph_id: "agent" } })
      );

      const team = { country: "England", id: 541, name: "Test Club" };

      const roster = {
        members: [
          {
            apiFootballPlayerId: 10,
            fmCandidates: [{ fmId: "fm-kane", name: "Harry Kane" }],
            fmId: null,
            mappingMethod: null,
            mappingStatus: "pending",
            name: "Harry Kane",
            position: "Attacker",
          },
        ],
        retrievedAt: "2026-11-06T00:00:00.000Z",
        team,
      };

      const fmCandidate = { fmId: "fm-kane", name: "Harry Kane" };

      await postJson(
        baseUrl,
        `/threads/${rosterThread.thread_id}/state`,
        waitResponseSchema,
        JSON.stringify({
          as_node: "resolve_entities",
          values: {
            conversationContext,
            messages: [{ content: "Map the Test Club roster.", type: "human" }],
            outcome: null,
            pendingClarification: {
              answer: null,
              candidates: [fmCandidate],
              kind: "team_roster_profile",
              question: "Choose the FM profile for Harry Kane.",
              rosterIndex: 0,
            },
            request: {
              constraints: [],
              kind: "team_recommendation",
              players: [],
              processedMessageId: "roster-question",
              recommendationAction: "replace",
              teamRecommendation: {
                includePotential: false,
                maxAge: null,
                minimumCurrentAbility: null,
                minimumPotentialAbility: null,
                position: "stc",
                referenceMode: "squad",
                resultLimit: 2,
                roster,
                team,
                teamName: team.name,
                teamSearchName: team.name,
              },
              teamRecommendationAction: "replace",
              teams: [team.name],
            },
          },
        })
      );
      await postJson(
        baseUrl,
        `/threads/${rosterThread.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({ assistant_id: "agent", input: null })
      );

      const identityInterruptedState = await requestJson(
        baseUrl,
        `/threads/${identityThread.thread_id}/state`,
        threadStateSchema
      );

      const rosterInterruptedState = await requestJson(
        baseUrl,
        `/threads/${rosterThread.thread_id}/state`,
        threadStateSchema
      );

      await putJson(
        baseUrl,
        "/store/items",
        JSON.stringify({
          key: "test-player-confirmation",
          namespace: ["tactiscout", "local-user", "player-memory"],
          value: { confirmed: true, sourceIds: ["fm-kane"] },
        })
      );
      const callsBeforeRestart = gateway.calls().length;

      await stopServer(runningServer);
      await waitForServerStop(port);
      runningServer = null;

      runningServer = await startServer(projectPath, gateway.url, port);
      const callsAtRestart = gateway.calls().length;

      const restoredSnapshot = await requestJson(
        baseUrl,
        `/threads/${savedThread.thread_id}/state`,
        threadStateSchema
      );

      const restoredIdentity = await requestJson(
        baseUrl,
        `/threads/${identityThread.thread_id}/state`,
        threadStateSchema
      );

      const restoredRoster = await requestJson(
        baseUrl,
        `/threads/${rosterThread.thread_id}/state`,
        threadStateSchema
      );

      const restoredMemory = await requestJson(
        baseUrl,
        "/store/items?namespace=tactiscout.local-user.player-memory&key=test-player-confirmation",
        storeItemSchema
      );

      await postJson(
        baseUrl,
        `/threads/${savedThread.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({ assistant_id: "agent", input: null })
      );

      const savedAnswerUsedSnapshot = gateway
        .calls()
        .some(
          (call) =>
            call.includes("Harry Kane") && call.includes("Erling Haaland")
        );

      await postJson(
        baseUrl,
        `/threads/${identityThread.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({ assistant_id: "agent", command: { resume: "1" } })
      );

      const resumedIdentity = await requestJson(
        baseUrl,
        `/threads/${identityThread.thread_id}/state`,
        threadStateSchema
      );

      await postJson(
        baseUrl,
        `/threads/${rosterThread.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({ assistant_id: "agent", command: { resume: "1" } })
      );

      const resumedRoster = await requestJson(
        baseUrl,
        `/threads/${rosterThread.thread_id}/state`,
        threadStateSchema
      );

      expect({
        identityHasInterrupt: identityInterruptedState.tasks.some(
          (task) => (task.interrupts?.length ?? 0) > 0
        ),
        identityQuestion:
          identityInterruptedState.values.pendingClarification?.question,
        rosterHasInterrupt: rosterInterruptedState.tasks.some(
          (task) => (task.interrupts?.length ?? 0) > 0
        ),
        rosterQuestion:
          rosterInterruptedState.values.pendingClarification?.question,
        startupModelCalls: callsAfterFirstStartup,
      }).toStrictEqual({
        identityHasInterrupt: true,
        identityQuestion: "Which player do you mean by 凯恩?",
        rosterHasInterrupt: true,
        rosterQuestion: "Choose the FM profile for Harry Kane.",
        startupModelCalls: 0,
      });
      expect({
        callsAtRestart,
        callsBeforeRestart,
      }).toStrictEqual({
        callsAtRestart: callsBeforeRestart,
        callsBeforeRestart,
      });
      expect({
        comparison:
          restoredSnapshot.values.conversationContext.activeComparison
            .resultJson,
        lookup:
          restoredSnapshot.values.conversationContext.activeLookup.resultJson,
        outcome: restoredSnapshot.values.outcome,
        recommendation:
          restoredSnapshot.values.conversationContext.activeRecommendation
            .resultJson,
        savedAnswerUsedSnapshot,
        team: restoredSnapshot.values.conversationContext
          .activeTeamRecommendation.resultJson,
      }).toStrictEqual({
        comparison: conversationContext.activeComparison.resultJson,
        lookup: conversationContext.activeLookup.resultJson,
        outcome,
        recommendation: conversationContext.activeRecommendation.resultJson,
        savedAnswerUsedSnapshot,
        team: conversationContext.activeTeamRecommendation.resultJson,
      });
      expect({
        identityHasInterrupt: restoredIdentity.tasks.some(
          (task) => (task.interrupts?.length ?? 0) > 0
        ),
        identityQuestion:
          restoredIdentity.values.pendingClarification?.question,
        memory: restoredMemory.value,
        rosterHasInterrupt: restoredRoster.tasks.some(
          (task) => (task.interrupts?.length ?? 0) > 0
        ),
        rosterQuestion: restoredRoster.values.pendingClarification?.question,
      }).toStrictEqual({
        identityHasInterrupt: true,
        identityQuestion: "Which player do you mean by 凯恩?",
        memory: { confirmed: true, sourceIds: ["fm-kane"] },
        rosterHasInterrupt: true,
        rosterQuestion: "Choose the FM profile for Harry Kane.",
      });
      expect({
        identityPending: resumedIdentity.values.pendingClarification,
        identityStatus:
          resumedIdentity.values.request.players?.[0]?.resolution?.status,
        rosterFmId:
          resumedRoster.values.request.teamRecommendation?.roster?.members[0]
            ?.fmId,
        rosterMappingMethod:
          resumedRoster.values.request.teamRecommendation?.roster?.members[0]
            ?.mappingMethod,
        rosterPending: resumedRoster.values.pendingClarification,
      }).toStrictEqual({
        identityPending: null,
        identityStatus: "resolved",
        rosterFmId: "fm-kane",
        rosterMappingMethod: "user_confirmation",
        rosterPending: null,
      });
    } finally {
      if (runningServer !== null) {
        await stopServer(runningServer).catch(() => {});
      }

      if (projectPath !== null) {
        await rm(projectPath, { force: true, recursive: true });
      }

      await gateway.close();
    }
  }, 120_000);
});
