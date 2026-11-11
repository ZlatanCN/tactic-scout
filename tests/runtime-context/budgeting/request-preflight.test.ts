import { isDeepStrictEqual } from "node:util";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import type { ReferenceIdentityLookup } from "../../../src/player-data/resolve-reference.js";
import { AgentState, agentStateSchemaVersion } from "../../../src/state.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";
import type { ExtractedRequest } from "../../fixtures/agent-graph.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import {
  playerReference,
  savedConversationContext,
} from "../../fixtures/persistence-state.js";

describe("runtime model input budget", () => {
  afterEach(() => {
    vi.stubEnv(
      "TACTISCOUT_MODEL_CONTEXT_PROFILE",
      agentGraphTest.testModelContextProfileEnvironment
    );
  });

  it("selects current aliases while preserving ambiguous identity and focus context", async () => {
    const focus = playerReference("focused", "Focused Player");

    const comparisonOther = playerReference(
      "comparison-other",
      "Comparison Other"
    );

    const aliasCandidateA = agentGraphTest.playerCandidate(
      "Scout Candidate A",
      "scout-a"
    );

    const aliasCandidateB = agentGraphTest.playerCandidate(
      "Scout Candidate B",
      "scout-b"
    );

    const legacy = agentGraphTest.playerCandidate("Legacy Player", "legacy");

    const currentAliases = [
      {
        mention: "Scout",
        reference:
          agentGraphTest.conversationReferenceFromCandidate(aliasCandidateA),
      },
      {
        mention: "Scout",
        reference:
          agentGraphTest.conversationReferenceFromCandidate(aliasCandidateB),
      },
    ];

    const savedContext = savedConversationContext(focus, comparisonOther);

    const irrelevantAliases = Array.from({ length: 300 }, (_, index) => ({
      mention: `Legacy alias ${index}`,
      reference: agentGraphTest.conversationReferenceFromCandidate(legacy),
    }));

    const originalAliases = [
      ...irrelevantAliases,
      { mention: focus.candidate.name, reference: focus },
      { mention: comparisonOther.candidate.name, reference: comparisonOther },
      ...currentAliases,
    ];

    const oldMessage = new HumanMessage({
      content: "NEVER_SEND this persisted earlier conversation.",
      id: "long-context-old-message",
    });

    const currentMessage = new HumanMessage({
      content: "Add Scout to the current comparison.",
      id: "long-context-current-message",
    });

    const conversationContext = {
      ...savedContext,
      activeComparison: {
        ...savedContext.activeComparison,
        constraints: [{ name: "season", value: "2025/26" }],
      },
      playerAliases: originalAliases,
    };

    const state = AgentState.parse({
      conversationContext,
      messages: [oldMessage, currentMessage],
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const capturedPayloads: unknown[] = [];
    const model = fakeModel();
    vi.spyOn(model, "getNumTokens").mockImplementation(async (text) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    });
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from((messages: BaseMessage[]) => {
        const [, payloadMessage] = messages;

        if (payloadMessage === undefined) {
          throw new Error("Request understanding did not send its payload.");
        }

        capturedPayloads.push(
          JSON.parse(z.string().parse(payloadMessage.content))
        );

        return {
          parsed: {
            comparisonAction: "add",
            constraints: [],
            kind: "player_comparison",
            players: [
              {
                lookupName: null,
                mention: "Scout",
                recommendationRole: "reference",
                referenceScope: "explicit",
                referenceTargetMention: null,
              },
            ],
            teams: [],
          },
          raw: new AIMessage({
            content: "structured request",
            response_metadata: { finish_reason: "stop" },
          }),
        };
      })
    );

    const store = new InMemoryStore();
    const memoryNamespace = ["tactiscout", "local-user", "player-memory"];

    await store.put(memoryNamespace, "preserve-this-record", {
      kind: "fixture_sentinel",
      value: "unchanged",
    });

    const memoryBefore = await store.search(memoryNamespace, {});

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: {
        maxInputTokens: 4096,
        maxOutputTokens: 512,
      },
      store,
      tools: [],
    });

    const result = await graph.invoke(state, {
      configurable: { thread_id: "bounded-request-understanding-context" },
    });

    expect(capturedPayloads).toHaveLength(1);

    const payload = z
      .record(z.string(), z.unknown())
      .parse(capturedPayloads[0]);

    const aliasesInPayload = z
      .array(
        z.object({
          mention: z.string(),
          name: z.string(),
          referenceId: z.string(),
        })
      )
      .parse(payload.confirmedPlayerAliases);

    const focusPlayersInPayload = z
      .array(z.object({ name: z.string(), referenceId: z.string() }))
      .parse(payload.focusPlayers);

    const comparisonInPayload = z
      .object({
        constraints: z.array(z.object({ name: z.string(), value: z.string() })),
        players: z.array(
          z.object({ name: z.string(), referenceId: z.string() })
        ),
      })
      .parse(payload.activeComparison);

    const lookupInPayload = z
      .object({ playerName: z.string() })
      .parse(payload.activeLookup);

    const recommendationInPayload = z
      .object({ referencePlayers: z.array(z.object({ name: z.string() })) })
      .parse(payload.activeRecommendation);

    const teamRecommendationInPayload = z
      .object({ team: z.object({ name: z.string() }) })
      .parse(payload.activeTeamRecommendation);

    const memoryAfter = await store.search(memoryNamespace, {});

    const snapshotsBefore = {
      activeComparison: conversationContext.activeComparison,
      activeLookup: conversationContext.activeLookup,
      activeRecommendation: conversationContext.activeRecommendation,
      activeTeamRecommendation: conversationContext.activeTeamRecommendation,
    };

    const snapshotsAfter = {
      activeComparison: result.conversationContext.activeComparison,
      activeLookup: result.conversationContext.activeLookup,
      activeRecommendation: result.conversationContext.activeRecommendation,
      activeTeamRecommendation:
        result.conversationContext.activeTeamRecommendation,
    };

    const originalUnrelatedAndCurrentAliases = originalAliases
      .flatMap(({ mention, reference }) =>
        mention.startsWith("Legacy alias ") || mention === "Scout"
          ? [`${mention}:${reference.referenceId}`]
          : []
      )
      .toSorted();

    const resultingUnrelatedAndCurrentAliases =
      result.conversationContext.playerAliases
        .flatMap(({ mention, reference }) =>
          mention.startsWith("Legacy alias ") || mention === "Scout"
            ? [`${mention}:${reference.referenceId}`]
            : []
        )
        .toSorted();

    expect({
      activeComparison: comparisonInPayload,
      aliases: aliasesInPayload.map(({ mention, name, referenceId }) => ({
        mention,
        name,
        referenceId,
      })),
      aliasesUnchanged: isDeepStrictEqual(
        resultingUnrelatedAndCurrentAliases,
        originalUnrelatedAndCurrentAliases
      ),
      allSnapshotsWerePassed: [
        lookupInPayload.playerName,
        recommendationInPayload.referencePlayers[0]?.name,
        teamRecommendationInPayload.team.name,
      ],
      focusPlayers: focusPlayersInPayload,
      historyWasSent: JSON.stringify(payload).includes("NEVER_SEND"),
      interruptAsked: Object.hasOwn(result, "__interrupt__"),
      pendingKind: result.pendingClarification?.kind,
      resolvedCandidates: result.request.players
        .find(({ mention }) => mention === "Scout")
        ?.resolution?.candidates.map(({ name }) => name),
      snapshotsUnchanged: isDeepStrictEqual(snapshotsAfter, snapshotsBefore),
      storeUnchanged: memoryAfter,
      storedAliases: result.conversationContext.playerAliases.length,
    }).toStrictEqual({
      activeComparison: {
        constraints: [{ name: "season", value: "2025/26" }],
        players: [
          { name: "Focused Player", referenceId: "thread:focused" },
          {
            name: "Comparison Other",
            referenceId: "thread:comparison-other",
          },
        ],
      },
      aliases: [
        {
          mention: "Scout",
          name: "Scout Candidate A",
          referenceId: "canonical-scout-a",
        },
        {
          mention: "Scout",
          name: "Scout Candidate B",
          referenceId: "canonical-scout-b",
        },
      ],
      aliasesUnchanged: true,
      allSnapshotsWerePassed: ["Focused Player", "Focused Player", "Test Club"],
      focusPlayers: [{ name: "Focused Player", referenceId: "thread:focused" }],
      historyWasSent: false,
      interruptAsked: true,
      pendingKind: "identity",
      resolvedCandidates: ["Scout Candidate A", "Scout Candidate B"],
      snapshotsUnchanged: true,
      storeUnchanged: memoryBefore,
      storedAliases: 304,
    });
  }, 30_000);

  it("requires a known model window before understanding or reading sources", async () => {
    vi.stubEnv("TACTISCOUT_MODEL_CONTEXT_PROFILE", "");

    const message = "Look up the requested player.";
    const model = fakeModel();

    const graph = agentGraphTest.createAgentWithRuntime({
      checkpointer: new MemorySaver(),
      model,
      store: null,
      tools: [],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "missing-model-context-profile" } }
    );

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect(answer).toContain("上下文预算");
    expect(model.callCount).toBe(0);
    expect(result.faultTolerance.failure?.category).toBe("context_limit");
    expect(result.faultTolerance.failure?.contextIssue).toBe(
      "profile_required"
    );
  });

  it("does not route an incomplete structured request as a completed task", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    const modelResponses = vi.fn<
      () => { parsed: ExtractedRequest; raw: AIMessage }
    >(() => ({
      parsed: agentGraphTest.requestForPlayers("player_lookup", ["Harry Kane"]),
      raw: new AIMessage({
        content: "partial structured request",
        response_metadata: { finish_reason: "length" },
      }),
    }));

    structuredOutput.mockReturnValue(RunnableLambda.from(modelResponses));

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      agentGraphTest.resolvedLookup(
        agentGraphTest.playerCandidate("Harry Kane", "kane")
      )
    );

    const graph = agentGraphTest.createAgent({
      model,
      playerIdentityLookup: identityLookup,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Look up Harry Kane.")] },
      { configurable: { thread_id: "truncated-structured-request" } }
    );

    expect({
      category: result.faultTolerance.failure?.category,
      contextIssue: result.faultTolerance.failure?.contextIssue,
      identityLookupCalls: identityLookup.mock.calls.length,
      modelResponses: modelResponses.mock.calls.length,
      node: result.faultTolerance.failure?.node,
    }).toStrictEqual({
      category: "context_limit",
      contextIssue: "response_truncated",
      identityLookupCalls: 0,
      modelResponses: 1,
      node: "understand_request",
    });
  }, 10_000);

  it("identifies a required numeric span that cannot fit within the input budget", async () => {
    const message = "9".repeat(100_000);

    const model = fakeModel();
    vi.spyOn(model, "getNumTokens").mockImplementation(async (input) => {
      await Promise.resolve();

      return Math.ceil(input.length / 4);
    });

    const graph = agentGraphTest.createAgentWithRuntime({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 16_384,
        maxOutputTokens: 512,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "current-user-input-over-budget" } }
    );

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect(answer).toContain("本轮用户指令超过");
    expect(result.faultTolerance.failure).toMatchObject({
      category: "context_limit",
      contextIssue: "user_input_exceeds_limit",
      node: "understand_request",
    });
    expect(model.callCount).toBe(0);
  }, 15_000);
});
