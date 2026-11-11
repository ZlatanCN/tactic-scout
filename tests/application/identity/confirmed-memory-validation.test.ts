import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";

import { HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { resolvePlayerReference } from "../../../src/player-data/resolve-reference.js";
import type { ReferenceIdentityLookup } from "../../../src/player-data/resolve-reference.js";
import { playerMemoryTest } from "../../fixtures/player-memory.js";

describe("confirmed identity validation", () => {
  afterEach(async () => {
    await playerMemoryTest.cleanup();
  });

  it("reuses a confirmed FM/Understat group after validating exact source IDs", async () => {
    await playerMemoryTest.withSourceFixtures();
    const store = new InMemoryStore();

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      resolvePlayerReference
    );

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: playerMemoryTest.sourceGroupExtractor([
        "Kylian Mbappé",
        "Kylian Mbappe",
      ]),
      store,
      tools: [],
    });

    const threadA = { configurable: { thread_id: "source-group-thread-a" } };
    const threadB = { configurable: { thread_id: "source-group-thread-b" } };

    const pending = await graph.invoke(
      { messages: [new HumanMessage("Look up Kylian Mbappé")] },
      threadA
    );

    const candidates = pending.request.players[0]?.resolution?.candidates ?? [];

    const fmCandidate = playerMemoryTest.candidateWithSource(
      candidates,
      "fm",
      "fm-mbappe"
    );

    const understatCandidate = playerMemoryTest.candidateWithSource(
      candidates,
      "understat",
      "understat-mbappe"
    );

    expect(Object.hasOwn(pending, "__interrupt__")).toBeTruthy();
    expect(candidates).toHaveLength(2);

    const confirmed = await graph.invoke(
      new Command({
        resume: {
          candidateIds: [
            fmCandidate.candidateId,
            understatCandidate.candidateId,
          ],
        },
      }),
      threadA
    );

    const storedItems = await store.search(
      ["tactiscout", "local-user", "player-memory"],
      { filter: { kind: "player_identity" } }
    );

    const identityRecord = z
      .looseObject({
        canonicalIdentityId: z.string().nullable(),
        confirmationId: z.string().regex(/^[a-f0-9]{64}$/u),
        confirmedAt: z.iso.datetime(),
        identityVerified: z.boolean(),
        kind: z.literal("player_identity"),
        normalizedMention: z.string(),
        originThreadId: z.string(),
        originalMention: z.string(),
        schemaVersion: z.literal(1),
        sourceRecords: z.array(
          z.looseObject({
            canonicalIdentityId: z.string().nullable(),
            identityVerified: z.boolean(),
            provider: z.enum(["fm", "understat"]),
            sourceId: z.string(),
          })
        ),
        sourceVersions: z.object({
          fmManifestSha256: z.string().nullable(),
          fmSnapshotDate: z.string().nullable(),
          identityRegistryRelease: z.string().nullable(),
          understatScopes: z.array(
            z.object({
              competition: z.string(),
              season: z.string(),
              sourceId: z.string(),
            })
          ),
        }),
        stableIdentityKey: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .parse(storedItems[0]?.value);

    const reused = await graph.invoke(
      { messages: [new HumanMessage("Look up Kylian Mbappe")] },
      threadB
    );

    const reresolved = await graph.invoke(
      { messages: [new HumanMessage("重新解析 Kylian Mbappe")] },
      threadB
    );

    const observed = {
      confirmation: playerMemoryTest.selectedIdentity(confirmed),
      identityLookupCalls: identityLookup.mock.calls.length,
      reresolution: playerMemoryTest.selectedIdentity(reresolved),
      reresolutionInterrupt: Object.hasOwn(reresolved, "__interrupt__"),
      reuse: playerMemoryTest.selectedIdentity(reused),
      reuseInterrupt: Object.hasOwn(reused, "__interrupt__"),
      storedIdentity: {
        canonicalIdentityId: identityRecord.canonicalIdentityId,
        confirmationIdPresent: identityRecord.confirmationId.length === 64,
        identityVerified: identityRecord.identityVerified,
        kind: identityRecord.kind,
        normalizedMention: identityRecord.normalizedMention,
        originThreadId: identityRecord.originThreadId,
        originalMention: identityRecord.originalMention,
        schemaVersion: identityRecord.schemaVersion,
        sourceRecords: identityRecord.sourceRecords.map(
          ({ canonicalIdentityId, identityVerified, provider, sourceId }) => ({
            canonicalIdentityId,
            identityVerified,
            provider,
            sourceId,
          })
        ),
        sourceVersions: identityRecord.sourceVersions,
        stableIdentityKeyPresent:
          identityRecord.stableIdentityKey.length === 64,
      },
      storedIdentityKeys: Object.keys(storedItems[0]?.value ?? {}).toSorted(),
    };

    const expected = {
      confirmation: {
        canonicalIdentityId: null,
        identityBasis: "thread_confirmed",
        records: [
          {
            canonicalIdentityId: "canonical:mbappe",
            identityVerified: true,
            provider: "fm",
            sourceId: "fm-mbappe",
          },
          {
            canonicalIdentityId: null,
            identityVerified: false,
            provider: "understat",
            sourceId: "understat-mbappe",
          },
        ],
        status: "resolved",
      },
      identityLookupCalls: 1,
      reresolution: {
        canonicalIdentityId: null,
        identityBasis: "thread_confirmed",
        records: [
          {
            canonicalIdentityId: "canonical:mbappe",
            identityVerified: true,
            provider: "fm",
            sourceId: "fm-mbappe",
          },
          {
            canonicalIdentityId: null,
            identityVerified: false,
            provider: "understat",
            sourceId: "understat-mbappe",
          },
        ],
        status: "resolved",
      },
      reresolutionInterrupt: false,
      reuse: {
        canonicalIdentityId: null,
        identityBasis: "thread_confirmed",
        records: [
          {
            canonicalIdentityId: "canonical:mbappe",
            identityVerified: true,
            provider: "fm",
            sourceId: "fm-mbappe",
          },
          {
            canonicalIdentityId: null,
            identityVerified: false,
            provider: "understat",
            sourceId: "understat-mbappe",
          },
        ],
        status: "resolved",
      },
      reuseInterrupt: false,
      storedIdentity: {
        canonicalIdentityId: null,
        confirmationIdPresent: true,
        identityVerified: false,
        kind: "player_identity",
        normalizedMention: "kylianmbappe",
        originThreadId: "source-group-thread-a",
        originalMention: "Kylian Mbappé",
        schemaVersion: 1,
        sourceRecords: [
          {
            canonicalIdentityId: "canonical:mbappe",
            identityVerified: true,
            provider: "fm",
            sourceId: "fm-mbappe",
          },
          {
            canonicalIdentityId: null,
            identityVerified: false,
            provider: "understat",
            sourceId: "understat-mbappe",
          },
        ],
        sourceVersions: {
          fmManifestSha256: "player-memory-test-snapshot",
          fmSnapshotDate: "2025-11-23",
          identityRegistryRelease: "player-memory-test-reep-release",
          understatScopes: [
            {
              competition: "Bundesliga",
              season: "2025/26",
              sourceId: "understat-mbappe",
            },
          ],
        },
        stableIdentityKeyPresent: true,
      },
      storedIdentityKeys: [
        "canonicalIdentityId",
        "confirmationId",
        "confirmedAt",
        "displayName",
        "identityVerified",
        "kind",
        "normalizedMention",
        "originThreadId",
        "originalMention",
        "schemaVersion",
        "sourceRecords",
        "sourceVersions",
        "stableIdentityKey",
      ],
    };

    if (!isDeepStrictEqual(observed, expected)) {
      throw new Error(JSON.stringify({ actual: observed, expected }, null, 2));
    }

    expect(observed).toStrictEqual(expected);
  }, 10_000);

  it("retains an outdated confirmation and requires current-source confirmation", async () => {
    const sourcePaths = await playerMemoryTest.withSourceFixtures();
    const store = new InMemoryStore();

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      resolvePlayerReference
    );

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: playerMemoryTest.sourceGroupExtractor([
        "Kylian Mbappé",
      ]),
      store,
      tools: [],
    });

    const threadA = { configurable: { thread_id: "outdated-memory-thread-a" } };

    const pendingA = await graph.invoke(
      { messages: [new HumanMessage("Look up Kylian Mbappé")] },
      threadA
    );

    const candidates =
      pendingA.request.players[0]?.resolution?.candidates ?? [];

    const fmCandidate = playerMemoryTest.candidateWithSource(
      candidates,
      "fm",
      "fm-mbappe"
    );

    const understatCandidate = playerMemoryTest.candidateWithSource(
      candidates,
      "understat",
      "understat-mbappe"
    );

    await graph.invoke(
      new Command({
        resume: {
          candidateIds: [
            fmCandidate.candidateId,
            understatCandidate.candidateId,
          ],
        },
      }),
      threadA
    );

    const database = new DatabaseSync(sourcePaths.understatDatabasePath);

    const row = z
      .object({ payload_json: z.string() })
      .parse(
        database
          .prepare(
            "SELECT payload_json FROM source_snapshots WHERE resource_id = 'Bundesliga' AND season_start_year = 2025"
          )
          .get()
      );

    const payload = z
      .object({ players: z.array(z.unknown()) })
      .parse(JSON.parse(row.payload_json));

    const sourcePlayerSchema = z.looseObject({
      id: z.union([z.string(), z.number()]),
    });

    const missingUnderstatPlayer = JSON.stringify({
      players: payload.players.filter((player) => {
        const parsedPlayer = sourcePlayerSchema.safeParse(player);

        return (
          !parsedPlayer.success ||
          String(parsedPlayer.data.id) !== "understat-mbappe"
        );
      }),
    });

    database
      .prepare(
        "UPDATE source_snapshots SET payload_json = ? WHERE resource_id = 'Bundesliga' AND season_start_year = 2025"
      )
      .run(missingUnderstatPlayer);
    database.close();

    const threadB = { configurable: { thread_id: "outdated-memory-thread-b" } };

    const needsConfirmation = await graph.invoke(
      { messages: [new HumanMessage("Look up Kylian Mbappé")] },
      threadB
    );

    const restoreDatabase = new DatabaseSync(sourcePaths.understatDatabasePath);
    restoreDatabase
      .prepare(
        "UPDATE source_snapshots SET payload_json = ? WHERE resource_id = 'Bundesliga' AND season_start_year = 2025"
      )
      .run(row.payload_json);
    restoreDatabase.close();

    const threadC = await graph.invoke(
      { messages: [new HumanMessage("Look up Kylian Mbappé")] },
      { configurable: { thread_id: "outdated-memory-thread-c" } }
    );

    expect({
      currentCandidateIds:
        needsConfirmation.request.players[0]?.resolution?.candidates.map(
          (candidate) => candidate.candidateId
        ) ?? [],
      identityLookupCalls: identityLookup.mock.calls.length,
      noLongerUsesAutomaticIdentity:
        needsConfirmation.request.players[0]?.resolution?.status,
      pendingKind: needsConfirmation.pendingClarification?.kind,
      restoredIdentity: playerMemoryTest.selectedIdentity(threadC),
      restoredInterrupt: Object.hasOwn(threadC, "__interrupt__"),
    }).toStrictEqual({
      currentCandidateIds: ["reep:canonical:mbappe"],
      identityLookupCalls: 2,
      noLongerUsesAutomaticIdentity: "needs_confirmation",
      pendingKind: "identity",
      restoredIdentity: {
        canonicalIdentityId: null,
        identityBasis: "thread_confirmed",
        records: [
          {
            canonicalIdentityId: "canonical:mbappe",
            identityVerified: true,
            provider: "fm",
            sourceId: "fm-mbappe",
          },
          {
            canonicalIdentityId: null,
            identityVerified: false,
            provider: "understat",
            sourceId: "understat-mbappe",
          },
        ],
        status: "resolved",
      },
      restoredInterrupt: false,
    });
  });

  it("preserves distinct confirmed identities for one alias and asks again", async () => {
    await playerMemoryTest.withSourceFixtures();
    const store = new InMemoryStore();

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      resolvePlayerReference
    );

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: playerMemoryTest.sourceGroupExtractor([
        "Kane",
      ]),
      store,
      tools: [],
    });

    const threadA = { configurable: { thread_id: "multiple-alias-thread-a" } };
    const threadB = { configurable: { thread_id: "multiple-alias-thread-b" } };

    const pendingA = await graph.invoke(
      { messages: [new HumanMessage("Look up Kane")] },
      threadA
    );

    const pendingB = await graph.invoke(
      { messages: [new HumanMessage("Look up Kane")] },
      threadB
    );

    const kaneCandidate = playerMemoryTest.candidateWithSource(
      pendingA.request.players[0]?.resolution?.candidates ?? [],
      "fm",
      "fm-kane"
    );

    const haalandCandidate = playerMemoryTest.candidateWithSource(
      pendingB.request.players[0]?.resolution?.candidates ?? [],
      "fm",
      "fm-haaland"
    );

    await graph.invoke(
      new Command({ resume: { candidateId: kaneCandidate.candidateId } }),
      threadA
    );
    await graph.invoke(
      new Command({ resume: { candidateId: haalandCandidate.candidateId } }),
      threadB
    );

    const pendingC = await graph.invoke(
      { messages: [new HumanMessage("Look up Kane")] },
      { configurable: { thread_id: "multiple-alias-thread-c" } }
    );

    const resolution = pendingC.request.players[0]?.resolution;

    const confirmedIds = (resolution?.candidates ?? [])
      .map((candidate) => ({
        canonicalIdentityId: candidate.canonicalIdentityId,
        sourceId: candidate.records[0]?.sourceId ?? null,
      }))
      .toSorted((left, right) =>
        (left.canonicalIdentityId ?? "").localeCompare(
          right.canonicalIdentityId ?? ""
        )
      );

    const rememberedKane = resolution?.candidates.find(
      (candidate) => candidate.candidateId === "reep:canonical:kane"
    );

    if (rememberedKane === undefined) {
      throw new Error(
        "The shared memory alternatives omitted the Kane identity."
      );
    }

    await graph.invoke(
      new Command({ resume: { candidateId: rememberedKane.candidateId } }),
      { configurable: { thread_id: "multiple-alias-thread-c" } }
    );

    const pendingD = await graph.invoke(
      { messages: [new HumanMessage("Look up Kane")] },
      { configurable: { thread_id: "multiple-alias-thread-d" } }
    );

    const resolutionD = pendingD.request.players[0]?.resolution;

    const candidateSourceIdsAfterRepeat =
      resolutionD?.candidates.map((candidate) =>
        candidate.records.map((record) => record.sourceId)
      ) ?? [];

    expect({
      candidateIdentities: confirmedIds,
      candidateSourceIdsAfterRepeat,
      identityLookupCalls: identityLookup.mock.calls.length,
      isInterrupt:
        Object.hasOwn(pendingC, "__interrupt__") &&
        Object.hasOwn(pendingD, "__interrupt__"),
      status: resolution?.status,
    }).toStrictEqual({
      candidateIdentities: [
        { canonicalIdentityId: "canonical:haaland", sourceId: "fm-haaland" },
        { canonicalIdentityId: "canonical:kane", sourceId: "fm-kane" },
      ],
      candidateSourceIdsAfterRepeat: [["fm-haaland"], ["fm-kane"]],
      identityLookupCalls: 2,
      isInterrupt: true,
      status: "needs_confirmation",
    });
  });
});
