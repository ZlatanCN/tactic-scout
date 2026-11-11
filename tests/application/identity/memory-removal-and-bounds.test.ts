import { HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolvePlayerReference } from "../../../src/player-data/resolve-reference.js";
import type { ReferenceIdentityLookup } from "../../../src/player-data/resolve-reference.js";
import {
  agentStateSchemaVersion,
  AgentState,
  createInitialConversationContext,
} from "../../../src/state.js";
import type {
  ConversationContext,
  ReferenceCandidate,
} from "../../../src/state.js";
import { playerMemoryTest } from "../../fixtures/player-memory.js";

describe("removed memory and bounded reads", () => {
  afterEach(async () => {
    await playerMemoryTest.cleanup();
  });

  it("re-resolves a prior-context reference after its shared identity is removed", async () => {
    await playerMemoryTest.withSourceFixtures();
    const store = new InMemoryStore();

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      resolvePlayerReference
    );

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: async (message) => {
        if (message === "重新确认他的身份") {
          return {
            constraints: [],
            kind: "player_lookup",
            players: [
              {
                lookupName: null,
                mention: "他",
                recommendationRole: "reference",
                referenceScope: "prior_context",
                referenceTargetMention: null,
              },
            ],
            teams: [],
          };
        }

        return await playerMemoryTest.sourceGroupExtractor(["Kylian Mbappé"])(
          message,
          createInitialConversationContext()
        );
      },
      store,
      tools: [],
    });

    const config = {
      configurable: { thread_id: "reresolve-prior-context-memory" },
    };

    const previousCandidate: ReferenceCandidate = {
      candidateId: "reep:canonical:mbappe",
      canonicalIdentityId: "canonical:mbappe",
      exactNameMatch: true,
      identityBasis: "reep_registry",
      identityVerified: true,
      name: "Kylian Mbappé",
      records: [
        {
          canonicalIdentityId: "canonical:mbappe",
          competition: null,
          identityVerified: true,
          name: "Kylian Mbappé",
          provider: "fm",
          season: null,
          sourceId: "fm-mbappe",
          team: null,
        },
      ],
    };

    const pending = await graph.invoke(
      {
        conversationContext: {
          ...createInitialConversationContext(),
          focusPlayers: [
            { candidate: previousCandidate, referenceId: "canonical:mbappe" },
          ],
        },
        messages: [new HumanMessage("Look up Kylian Mbappé")],
        stateSchemaVersion: agentStateSchemaVersion,
      },
      config
    );

    const candidates = pending.request.players[0]?.resolution?.candidates ?? [];

    const fmCandidate = playerMemoryTest.candidateWithSource(
      candidates,
      "fm",
      "fm-mbappe"
    );

    await graph.invoke(
      new Command({
        resume: { candidateIds: [fmCandidate.candidateId] },
      }),
      config
    );

    const confirmedThreadSnapshot = await graph.getState(config);
    const confirmedThread = AgentState.parse(confirmedThreadSnapshot.values);
    const confirmedAliases = confirmedThread.conversationContext.playerAliases;

    const [confirmedAlias] = confirmedAliases.toReversed();

    if (confirmedAlias === undefined) {
      throw new Error("Expected a thread-local alias after confirmation.");
    }

    const sharedReresolution = await graph.invoke(
      {
        conversationContext: {
          ...confirmedThread.conversationContext,
          playerAliases: [
            ...confirmedAliases,
            {
              mention: "Kylian nickname",
              reference: confirmedAlias.reference,
            },
          ],
        },
        messages: [new HumanMessage("重新确认他的身份")],
        stateSchemaVersion: agentStateSchemaVersion,
      },
      { configurable: { thread_id: "reresolve-prior-context-memory-b" } }
    );

    const sharedResolution = sharedReresolution.request.players[0]?.resolution;

    const [memoryRecord] = await store.search(
      ["tactiscout", "local-user", "player-memory"],
      { filter: { kind: "player_identity" } }
    );

    if (memoryRecord === undefined) {
      throw new Error("Expected the confirmed identity to be remembered.");
    }

    await store.delete(
      ["tactiscout", "local-user", "player-memory"],
      memoryRecord.key
    );

    const reresolved = await graph.invoke(
      { messages: [new HumanMessage("重新确认他的身份")] },
      config
    );

    expect({
      identityLookupArguments: identityLookup.mock.calls.map(([name]) => name),
      pendingKind: reresolved.pendingClarification?.kind,
      resolutionStatus: reresolved.request.players[0]?.resolution?.status,
      selectedCandidateIds:
        reresolved.request.players[0]?.resolution?.candidates
          .map(({ candidateId }) => candidateId)
          .toSorted() ?? [],
      sharedResolutionStatus: sharedResolution?.status,
      sharedSelectedCandidateId: sharedResolution?.selectedCandidateId,
    }).toStrictEqual({
      identityLookupArguments: ["Kylian Mbappé", "Kylian Mbappé"],
      pendingKind: "identity",
      resolutionStatus: "needs_confirmation",
      selectedCandidateIds: [
        "reep:canonical:mbappe",
        "source:understat:understat-mbappe",
      ],
      sharedResolutionStatus: "resolved",
      sharedSelectedCandidateId: "reep:canonical:mbappe",
    });
  });

  it("bounds shared-memory reads for long prior-context alias histories", async () => {
    await playerMemoryTest.withSourceFixtures();
    const store = new InMemoryStore();
    const storeSearch = vi.spyOn(store, "search");

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      resolvePlayerReference
    );

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: async (message) => {
        if (message !== "重新确认他的身份") {
          throw new Error(`Unexpected player-memory test message: ${message}`);
        }

        return await Promise.resolve({
          constraints: [],
          kind: "player_lookup",
          players: [
            {
              lookupName: null,
              mention: "他",
              recommendationRole: "reference",
              referenceScope: "prior_context",
              referenceTargetMention: null,
            },
          ],
          teams: [],
        });
      },
      store,
      tools: [],
    });

    const previousCandidate: ReferenceCandidate = {
      candidateId: "reep:canonical:mbappe",
      canonicalIdentityId: "canonical:mbappe",
      exactNameMatch: true,
      identityBasis: "reep_registry",
      identityVerified: true,
      name: "Kylian Mbappé",
      records: [
        {
          canonicalIdentityId: "canonical:mbappe",
          competition: null,
          identityVerified: true,
          name: "Kylian Mbappé",
          provider: "fm",
          season: null,
          sourceId: "fm-mbappe",
          team: null,
        },
      ],
    };

    const conversationContext: ConversationContext = {
      ...createInitialConversationContext(),
      focusPlayers: [
        { candidate: previousCandidate, referenceId: "canonical:mbappe" },
      ],
      playerAliases: Array.from({ length: 9 }, (_, index) => ({
        mention: `Mbappé alias ${index}`,
        reference: {
          candidate: previousCandidate,
          referenceId: "canonical:mbappe",
        },
      })),
    };

    const result = await graph.invoke(
      {
        conversationContext,
        messages: [new HumanMessage("重新确认他的身份")],
        stateSchemaVersion: agentStateSchemaVersion,
      },
      { configurable: { thread_id: "bounded-prior-context-alias-search" } }
    );

    expect({
      identityLookupArguments: identityLookup.mock.calls.map(([name]) => name),
      memorySearchCalls: storeSearch.mock.calls.length,
      pendingKind: result.pendingClarification?.kind,
      resolutionStatus: result.request.players[0]?.resolution?.status,
    }).toStrictEqual({
      identityLookupArguments: ["Kylian Mbappé"],
      memorySearchCalls: 8,
      pendingKind: "identity",
      resolutionStatus: "needs_confirmation",
    });
  });
});
