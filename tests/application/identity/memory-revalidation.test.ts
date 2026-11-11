import { DatabaseSync } from "node:sqlite";

import { HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { resolvePlayerReference } from "../../../src/player-data/resolve-reference.js";
import { playerMemoryTest } from "../../fixtures/player-memory.js";

describe("current-source confirmation for remembered identities", () => {
  it("requires confirmation for an unsupported memory even when the name has one current match", async () => {
    await playerMemoryTest.withSourceFixtures();
    const store = new InMemoryStore();

    const unsupportedMemory = {
      ...playerMemoryTest.playerIdentityMemoryFixture(
        "Harry Kane",
        "fm-haaland",
        "unsupported-confirmation",
        "unsupported-schema-key"
      ),
      schemaVersion: 2,
    };

    await store.put(
      ["tactiscout", "local-user", "player-memory"],
      "unsupported-memory-record",
      unsupportedMemory
    );

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: resolvePlayerReference,
      requestUnderstandingExtractor: playerMemoryTest.aliasCorrectionExtractor,
      store,
      tools: [],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Look up Harry Kane")] },
      { configurable: { thread_id: "unsupported-player-memory-schema" } }
    );

    const stored = await store.get(
      ["tactiscout", "local-user", "player-memory"],
      "unsupported-memory-record"
    );

    const storedRecord = z
      .looseObject({
        confirmationId: z.string(),
        schemaVersion: z.number(),
      })
      .safeParse(stored?.value);

    expect({
      currentCandidateId:
        result.request.players[0]?.resolution?.candidates?.[0]?.candidateId,
      memoryReadFailed: result.playerMemoryStatus.readFailed,
      needsIdentityConfirmation:
        result.pendingClarification?.kind === "identity",
      retainedConfirmationId:
        storedRecord.success &&
        storedRecord.data.confirmationId === "unsupported-confirmation",
      retainedSchemaVersion: storedRecord.success
        ? storedRecord.data.schemaVersion
        : null,
      selectedCandidateId:
        result.request.players[0]?.resolution?.selectedCandidateId,
    }).toStrictEqual({
      currentCandidateId: "reep:canonical:kane",
      memoryReadFailed: false,
      needsIdentityConfirmation: true,
      retainedConfirmationId: true,
      retainedSchemaVersion: 2,
      selectedCandidateId: null,
    });
  });

  it("requires re-confirmation when a remembered exact source ID is removed", async () => {
    const sourcePaths = await playerMemoryTest.withSourceFixtures();
    const store = new InMemoryStore();

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: resolvePlayerReference,
      requestUnderstandingExtractor: playerMemoryTest.aliasCorrectionExtractor,
      store,
      tools: [],
    });

    const confirmationThread = {
      configurable: { thread_id: "removed-source-confirmation" },
    };

    const pending = await graph.invoke(
      { messages: [new HumanMessage("Look up 凯恩")] },
      confirmationThread
    );

    const candidates = pending.request.players[0]?.resolution?.candidates ?? [];

    const kaneCandidate = playerMemoryTest.candidateWithSource(
      candidates,
      "fm",
      "fm-kane"
    );

    await graph.invoke(
      new Command({ resume: { candidateId: kaneCandidate.candidateId } }),
      confirmationThread
    );

    const fmDatabase = new DatabaseSync(sourcePaths.fmDatabasePath);

    try {
      fmDatabase
        .prepare("DELETE FROM players WHERE unique_id = ?")
        .run("fm-kane");
    } finally {
      fmDatabase.close();
    }

    const fresh = await graph.invoke(
      { messages: [new HumanMessage("Look up 凯恩")] },
      { configurable: { thread_id: "removed-source-fresh-thread" } }
    );

    const storedItems = await store.search([
      "tactiscout",
      "local-user",
      "player-memory",
    ]);

    const question = fresh.pendingClarification?.question ?? "";

    expect({
      interrupt: Object.hasOwn(fresh, "__interrupt__"),
      memoryReadFailed: fresh.playerMemoryStatus.readFailed,
      questionMentionsRemovedSource: question.includes(
        "已记住的“凯恩”身份所指来源已不在当前资料中"
      ),
      resolutionStatus: fresh.request.players[0]?.resolution?.status,
      selectedCandidateId:
        fresh.request.players[0]?.resolution?.selectedCandidateId,
      storedConfirmationCount: storedItems.length,
    }).toStrictEqual({
      interrupt: true,
      memoryReadFailed: false,
      questionMentionsRemovedSource: true,
      resolutionStatus: "needs_confirmation",
      selectedCandidateId: null,
      storedConfirmationCount: 1,
    });
  });

  it("rejects an identity choice from an interrupt after its Reep link changes", async () => {
    const sourcePaths = await playerMemoryTest.withSourceFixtures();
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
      configurable: { thread_id: "pending-identity-reeep-change" },
    };

    const pending = await graph.invoke(
      { messages: [new HumanMessage("Look up 凯恩")] },
      config
    );

    const candidate = playerMemoryTest.candidateWithSource(
      pending.request.players[0]?.resolution?.candidates ?? [],
      "fm",
      "fm-kane"
    );

    const registry = new DatabaseSync(sourcePaths.reepDatabasePath);

    try {
      registry
        .prepare(
          "UPDATE bridges SET canonical_reep_id = ? WHERE external_id = ?"
        )
        .run("canonical:haaland", "fm-kane");
    } finally {
      registry.close();
    }

    const resumed = await graph.invoke(
      new Command({ resume: { candidateId: candidate.candidateId } }),
      config
    );

    const storedItems = await store.search([
      "tactiscout",
      "local-user",
      "player-memory",
    ]);

    expect({
      currentCandidateCanonicalId:
        resumed.request.players[0]?.resolution?.candidates?.[0]
          ?.canonicalIdentityId,
      interrupt: Object.hasOwn(resumed, "__interrupt__"),
      selectedCandidateId:
        resumed.request.players[0]?.resolution?.selectedCandidateId,
      status: resumed.request.players[0]?.resolution?.status,
      storedMemoryCount: storedItems.length,
    }).toStrictEqual({
      currentCandidateCanonicalId: "canonical:haaland",
      interrupt: true,
      selectedCandidateId: null,
      status: "needs_confirmation",
      storedMemoryCount: 0,
    });
  });
});
