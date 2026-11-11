import { HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { resolvePlayerReference } from "../../../src/player-data/resolve-reference.js";
import { playerMemoryTest } from "../../fixtures/player-memory.js";

describe("player-memory management failure outcomes", () => {
  afterEach(async () => {
    await playerMemoryTest.cleanup();
  });

  it("reports a Store list failure instead of claiming that memory is empty", async () => {
    const store = new InMemoryStore();
    vi.spyOn(store, "search").mockRejectedValue(
      new Error("simulated Store read failure")
    );

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      requestUnderstandingExtractor: async () =>
        await Promise.resolve({
          constraints: [],
          kind: "other",
          playerMemoryManagement: { action: "list" },
          players: [],
          teams: [],
        }),
      store,
      tools: [],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Show remembered player memories")] },
      { configurable: { thread_id: "memory-list-failure" } }
    );

    expect(result.outcome).toMatchObject({
      kind: "player_memory_management",
      status: "failed",
    });
  });

  it("reports a failed zero-delete operation as failed, not partial success", async () => {
    const store = new InMemoryStore();

    await store.put(
      ["tactiscout", "local-user", "player-memory"],
      "v1:player-identity:confirmed-alias",
      {
        canonicalIdentityId: null,
        confirmationId: "confirmation-1",
        confirmedAt: "2026-11-08T00:00:00.000Z",
        displayName: "Harry Kane",
        identityVerified: false,
        kind: "player_identity",
        normalizedMention: "凯恩",
        originThreadId: "seed-thread",
        originalMention: "凯恩",
        schemaVersion: 1,
        sourceRecords: [
          {
            canonicalIdentityId: null,
            competition: null,
            identityVerified: false,
            name: "Harry Kane",
            provider: "fm",
            season: null,
            sourceId: "fm-kane",
          },
        ],
        sourceVersions: {
          fmManifestSha256: null,
          fmSnapshotDate: null,
          identityRegistryRelease: null,
          understatScopes: [],
        },
        stableIdentityKey: "confirmed-alias",
      }
    );

    vi.spyOn(store, "delete").mockRejectedValue(
      new Error("simulated Store write failure")
    );

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      requestUnderstandingExtractor: async () =>
        await Promise.resolve({
          constraints: [],
          kind: "other",
          playerMemoryManagement: {
            action: "forget",
            targetKind: "player_identity",
            targetMention: "凯恩",
          },
          players: [],
          teams: [],
        }),
      store,
      tools: [],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Forget alias 凯恩")] },
      { configurable: { thread_id: "memory-delete-failure" } }
    );

    expect(result.outcome).toMatchObject({
      kind: "player_memory_management",
      status: "failed",
    });
  });

  it("requires clear-all confirmation and reports Store deletion failure honestly", async () => {
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

    const config = {
      configurable: { thread_id: "clear-memory-store-failure" },
    };

    const pendingIdentity = await graph.invoke(
      { messages: [new HumanMessage("Look up 凯恩")] },
      config
    );

    const candidates =
      pendingIdentity.request.players[0]?.resolution?.candidates ?? [];

    const kaneCandidate = playerMemoryTest.candidateWithSource(
      candidates,
      "fm",
      "fm-kane"
    );

    await graph.invoke(
      new Command({ resume: { candidateId: kaneCandidate.candidateId } }),
      config
    );

    vi.spyOn(store, "delete").mockRejectedValue(
      new Error("simulated Store clear failure")
    );

    const pendingClear = await graph.invoke(
      { messages: [new HumanMessage("Clear all player memories")] },
      config
    );

    const invalidAnswer = await graph.invoke(
      new Command({ resume: "maybe" }),
      config
    );

    const clearFailure = await graph.invoke(
      new Command({ resume: "确认" }),
      config
    );

    const listed = await graph.invoke(
      { messages: [new HumanMessage("Show remembered player memories")] },
      config
    );

    const remainingRecordCount = z
      .object({ records: z.array(z.looseObject({ kind: z.string() })) })
      .parse(JSON.parse(z.string().parse(listed.outcome?.resultJson)))
      .records.length;

    expect({
      clearFailureStatus: clearFailure.outcome?.status,
      invalidAnswerInterrupt: Object.hasOwn(invalidAnswer, "__interrupt__"),
      pendingQuestionIncludesScope:
        pendingClear.pendingClarification?.question.includes(
          "称呼/来源组 1 条"
        ),
      remainingRecordCount,
    }).toStrictEqual({
      clearFailureStatus: "failed",
      invalidAnswerInterrupt: true,
      pendingQuestionIncludesScope: true,
      remainingRecordCount: 1,
    });
  });

  it("reports partial clear when only some approved Store deletions succeed", async () => {
    await playerMemoryTest.withSourceFixtures();
    const store = new InMemoryStore();
    const namespace = ["tactiscout", "local-user", "player-memory"];

    await store.put(
      namespace,
      "player-memory-fail",
      playerMemoryTest.playerIdentityMemoryFixture(
        "凯恩",
        "fm-kane",
        "confirmation-kane",
        "stable-kane"
      )
    );
    await store.put(
      namespace,
      "player-memory-delete",
      playerMemoryTest.playerIdentityMemoryFixture(
        "哈兰德",
        "fm-haaland",
        "confirmation-haaland",
        "stable-haaland"
      )
    );

    const deleteEntry = store.delete.bind(store);

    vi.spyOn(store, "delete").mockImplementation(
      async (storeNamespace, key) => {
        if (key === "player-memory-fail") {
          throw new Error("simulated partial Store deletion failure");
        }

        await deleteEntry(storeNamespace, key);
      }
    );

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      requestUnderstandingExtractor: playerMemoryTest.aliasCorrectionExtractor,
      store,
      tools: [],
    });

    const config = {
      configurable: { thread_id: "clear-memory-partial-failure" },
    };

    await graph.invoke(
      { messages: [new HumanMessage("Clear all player memories")] },
      config
    );

    const cleared = await graph.invoke(new Command({ resume: "确认" }), config);

    const listed = await graph.invoke(
      { messages: [new HumanMessage("Show remembered player memories")] },
      config
    );

    const remainingMentions = z
      .object({
        records: z.array(z.looseObject({ mention: z.string() })),
      })
      .parse(JSON.parse(z.string().parse(listed.outcome?.resultJson)))
      .records.map(({ mention }) => mention);

    const clearResult = z
      .object({
        deletedCount: z.number(),
        failedCount: z.number(),
        remainingCount: z.number(),
      })
      .parse(JSON.parse(z.string().parse(cleared.outcome?.resultJson)));

    expect({
      clearResult,
      clearStatus: cleared.outcome?.status,
      remainingMentions,
    }).toStrictEqual({
      clearResult: { deletedCount: 1, failedCount: 1, remainingCount: 1 },
      clearStatus: "partial_failure",
      remainingMentions: ["凯恩"],
    });
  });

  it("replays the approved clear scope without deleting later memories", async () => {
    const store = new InMemoryStore();
    const namespace = ["tactiscout", "local-user", "player-memory"];

    await store.put(
      namespace,
      "approved-alias",
      playerMemoryTest.playerIdentityMemoryFixture(
        "凯恩",
        "fm-kane",
        "approved-confirmation",
        "approved-stable-key"
      )
    );

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      requestUnderstandingExtractor: playerMemoryTest.aliasCorrectionExtractor,
      store,
      tools: [],
    });

    const config = {
      configurable: { thread_id: "clear-memory-approved-replay" },
    };

    const pending = await graph.invoke(
      { messages: [new HumanMessage("Clear all player memories")] },
      config
    );

    const confirmationIds = z
      .object({ clearAllConfirmationIds: z.array(z.string()) })
      .parse(pending.pendingClarification).clearAllConfirmationIds;

    await store.put(
      namespace,
      "memory-added-after-approval",
      playerMemoryTest.playerIdentityMemoryFixture(
        "哈兰德",
        "fm-haaland",
        "unapproved-confirmation",
        "unapproved-stable-key"
      )
    );

    const firstClear = await graph.invoke(
      new Command({ resume: "确认" }),
      config
    );

    await graph.updateState(
      config,
      {
        playerMemoryManagementRequest: {
          action: "clear",
          apiFootballPlayerId: null,
          clearAllApproved: true,
          clearAllConfirmationIds: confirmationIds,
          fmId: null,
          replacementMention: null,
          selectedTarget: null,
          targetKind: null,
          targetMention: null,
        },
      },
      "understand_request"
    );

    const replayedClear = await graph.invoke(null, config);

    const listed = await graph.invoke(
      { messages: [new HumanMessage("Show remembered player memories")] },
      config
    );

    const clearResultSchema = z.object({
      deletedCount: z.number(),
      remainingCount: z.number(),
      status: z.literal("partial_failure"),
    });

    const firstClearResult = clearResultSchema.parse(
      JSON.parse(z.string().parse(firstClear.outcome?.resultJson))
    );

    const replayResult = clearResultSchema.parse(
      JSON.parse(z.string().parse(replayedClear.outcome?.resultJson))
    );

    const remainingMentions = z
      .object({
        records: z.array(z.looseObject({ mention: z.string() })),
      })
      .parse(JSON.parse(z.string().parse(listed.outcome?.resultJson)))
      .records.map(({ mention }) => mention);

    expect({
      firstClear: firstClearResult,
      remainingMentions,
      replay: replayResult,
    }).toStrictEqual({
      firstClear: {
        deletedCount: 1,
        remainingCount: 1,
        status: "partial_failure",
      },
      remainingMentions: ["哈兰德"],
      replay: {
        deletedCount: 0,
        remainingCount: 1,
        status: "partial_failure",
      },
    });
  });
});
