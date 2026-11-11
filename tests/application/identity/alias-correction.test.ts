import { isDeepStrictEqual } from "node:util";

import { HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { resolvePlayerReference } from "../../../src/player-data/resolve-reference.js";
import {
  agentStateSchemaVersion,
  createInitialConversationContext,
} from "../../../src/state.js";
import { playerMemoryTest } from "../../fixtures/player-memory.js";

describe("corrected alias lifecycle", () => {
  it("replaces a corrected alias for new threads while keeping the old thread's local identity", async () => {
    await playerMemoryTest.withSourceFixtures();
    const store = new InMemoryStore();
    const lookup = resolvePlayerReference("Harry Kane");

    const snapshotCandidate = playerMemoryTest.candidateWithSource(
      lookup.candidates,
      "fm",
      "fm-kane"
    );

    const savedLookup = {
      player: {
        candidate: snapshotCandidate,
        referenceId:
          snapshotCandidate.canonicalIdentityId ??
          snapshotCandidate.candidateId,
      },
      resultJson: "historical-kane-lookup",
    };

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: resolvePlayerReference,
      requestUnderstandingExtractor: playerMemoryTest.aliasCorrectionExtractor,
      store,
      tools: [],
    });

    const correctionThread = {
      configurable: { thread_id: "player-memory-correction-thread" },
    };

    const pending = await graph.invoke(
      {
        conversationContext: {
          ...createInitialConversationContext(),
          activeLookup: savedLookup,
        },
        messages: [new HumanMessage("Look up 凯恩")],
        stateSchemaVersion: agentStateSchemaVersion,
      },
      correctionThread
    );

    const candidates = pending.request.players[0]?.resolution?.candidates ?? [];

    const kaneCandidate = playerMemoryTest.candidateWithSource(
      candidates,
      "fm",
      "fm-kane"
    );

    const confirmed = await graph.invoke(
      new Command({
        resume: { candidateId: kaneCandidate.candidateId },
      }),
      correctionThread
    );

    const corrected = await graph.invoke(
      {
        messages: [new HumanMessage(playerMemoryTest.aliasCorrectionMessage)],
      },
      correctionThread
    );

    const replayedCorrection = await graph.invoke(
      { messages: [new HumanMessage(playerMemoryTest.aliasCorrectionMessage)] },
      correctionThread
    );

    const replayedList = await graph.invoke(
      { messages: [new HumanMessage("Show remembered player memories")] },
      correctionThread
    );

    const replacementBindingCount = z
      .object({
        records: z.array(
          z.looseObject({
            kind: z.string(),
            mention: z.string().optional(),
          })
        ),
      })
      .parse(JSON.parse(z.string().parse(replayedList.outcome?.resultJson)))
      .records.filter(
        ({ kind, mention }) => kind === "player_identity" && mention === "凯恩"
      ).length;

    const freshThread = await graph.invoke(
      { messages: [new HumanMessage("Look up 凯恩")] },
      { configurable: { thread_id: "player-memory-correction-fresh-thread" } }
    );

    const oldLocalAlias = confirmed.conversationContext.playerAliases.find(
      ({ mention }) => mention === "凯恩"
    );

    const correctedThreadAlias =
      corrected.conversationContext.playerAliases.find(
        ({ mention }) => mention === "凯恩"
      );

    expect({
      correctedThreadAlias:
        correctedThreadAlias?.reference.candidate.canonicalIdentityId,
      correctionStatus: corrected.outcome?.status,
      freshThreadIdentity: playerMemoryTest.selectedIdentity(freshThread),
      freshThreadInterrupt: Object.hasOwn(freshThread, "__interrupt__"),
      oldLocalAlias: oldLocalAlias?.reference.candidate.canonicalIdentityId,
      oldSnapshotPreserved: isDeepStrictEqual(
        confirmed.conversationContext.activeLookup,
        corrected.conversationContext.activeLookup
      ),
      replacementBindingCount,
      replayStatus: replayedCorrection.outcome?.status,
    }).toStrictEqual({
      correctedThreadAlias: "canonical:kane",
      correctionStatus: "corrected",
      freshThreadIdentity: {
        canonicalIdentityId: "canonical:haaland",
        identityBasis: "reep_registry",
        records: [
          {
            canonicalIdentityId: "canonical:haaland",
            identityVerified: true,
            provider: "fm",
            sourceId: "fm-haaland",
          },
        ],
        status: "resolved",
      },
      freshThreadInterrupt: false,
      oldLocalAlias: "canonical:kane",
      oldSnapshotPreserved: true,
      replacementBindingCount: 1,
      replayStatus: "corrected",
    });
  });

  it("reports a partial correction when old bindings cannot be removed", async () => {
    await playerMemoryTest.withSourceFixtures();
    const store = new InMemoryStore();

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: resolvePlayerReference,
      requestUnderstandingExtractor: playerMemoryTest.aliasCorrectionExtractor,
      store,
      tools: [],
    });

    const correctionThread = {
      configurable: { thread_id: "player-memory-correction-store-failure" },
    };

    const pending = await graph.invoke(
      { messages: [new HumanMessage("Look up 凯恩")] },
      correctionThread
    );

    const candidates = pending.request.players[0]?.resolution?.candidates ?? [];

    const kaneCandidate = playerMemoryTest.candidateWithSource(
      candidates,
      "fm",
      "fm-kane"
    );

    await graph.invoke(
      new Command({ resume: { candidateId: kaneCandidate.candidateId } }),
      correctionThread
    );

    vi.spyOn(store, "delete").mockRejectedValue(
      new Error("simulated Store delete failure")
    );

    const correction = await graph.invoke(
      { messages: [new HumanMessage(playerMemoryTest.aliasCorrectionMessage)] },
      correctionThread
    );

    const freshThread = await graph.invoke(
      { messages: [new HumanMessage("Look up 凯恩")] },
      {
        configurable: {
          thread_id: "player-memory-correction-store-failure-fresh",
        },
      }
    );

    expect({
      correctionStatus: correction.outcome?.status,
      freshCandidates:
        freshThread.request.players[0]?.resolution?.candidates
          .map(({ candidateId }) => candidateId)
          .toSorted() ?? [],
      freshInterrupt: Object.hasOwn(freshThread, "__interrupt__"),
    }).toStrictEqual({
      correctionStatus: "partial_failure",
      freshCandidates: ["reep:canonical:haaland", "reep:canonical:kane"],
      freshInterrupt: true,
    });
  });
});
