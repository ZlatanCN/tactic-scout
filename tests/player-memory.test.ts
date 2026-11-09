import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";

import { HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import type { CreateAgentOptions } from "../src/agent.js";
import type { ReferenceIdentityLookup } from "../src/player-data/resolve-reference.js";
import { resolvePlayerReference } from "../src/player-data/resolve-reference.js";
import type { RequestUnderstandingExtractor } from "../src/request-extraction.js";
import {
  agentStateSchemaVersion,
  AgentState,
  createInitialConversationContext,
  createInitialRequestState,
} from "../src/state.js";
import type {
  AgentStateType,
  ConversationContext,
  ReferenceCandidate,
} from "../src/state.js";
import {
  apiThreadSchema,
  postJson,
  requestJson,
  startDevServerSession,
  threadStateSchema,
  waitResponseSchema,
} from "./fixtures/langgraph-dev-server.js";
import type { ThreadState } from "./fixtures/langgraph-dev-server.js";
import {
  testModelContextProfile,
  testModelOutputLimitAdapter,
} from "./fixtures/model-context.js";
import { clarificationDetails } from "./fixtures/persistence-state.js";
import { createPlayerMemorySources } from "./fixtures/player-memory-sources.js";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent: createAgentWithRuntime } = await import("../src/agent.js");

const createAgent = (options: CreateAgentOptions = {}) =>
  createAgentWithRuntime({
    modelContextProfile: testModelContextProfile,
    modelOutputLimitAdapter: testModelOutputLimitAdapter,
    ...options,
  });

const temporaryDirectories: string[] = [];

const sourceGroupExtraction = (mention: string) => ({
  constraints: [],
  kind: "player_lookup" as const,
  players: [
    { lookupName: null, mention, recommendationRole: "reference" as const },
  ],
  teams: [],
});

const sourceGroupExtractor =
  (mentions: string[]): RequestUnderstandingExtractor =>
  async (message) => {
    const mention = mentions.find(
      (name) => message === `Look up ${name}` || message === `重新解析 ${name}`
    );

    if (mention === undefined) {
      throw new Error(`Unexpected player-memory test message: ${message}`);
    }

    return await Promise.resolve(sourceGroupExtraction(mention));
  };

const aliasCorrectionMessage =
  "Correct the remembered alias 凯恩 to Erling Haaland";

const aliasCorrectionExtractor: RequestUnderstandingExtractor = async (
  message
) => {
  if (message === "Clear all player memories") {
    return await Promise.resolve({
      constraints: [],
      kind: "other" as const,
      playerMemoryManagement: { action: "clear" as const },
      players: [],
      teams: [],
    });
  }

  if (message === "Show remembered player memories") {
    return await Promise.resolve({
      constraints: [],
      kind: "other" as const,
      playerMemoryManagement: { action: "list" as const },
      players: [],
      teams: [],
    });
  }

  if (message === "Look up 凯恩") {
    return await Promise.resolve({
      ...sourceGroupExtraction("凯恩"),
      players: [
        {
          lookupName: "Harry Kane",
          mention: "凯恩",
          recommendationRole: "reference" as const,
        },
      ],
    });
  }

  if (message === "Look up Harry Kane") {
    return await Promise.resolve(sourceGroupExtraction("Harry Kane"));
  }

  if (message === aliasCorrectionMessage) {
    return await Promise.resolve({
      constraints: [],
      kind: "other" as const,
      playerMemoryManagement: {
        action: "correct" as const,
        replacementMention: "Erling Haaland",
        targetKind: "player_identity" as const,
        targetMention: "凯恩",
      },
      players: [],
      teams: [],
    });
  }

  throw new Error(`Unexpected player-memory correction input: ${message}`);
};

const playerIdentityMemoryFixture = (
  mention: string,
  sourceId: string,
  confirmationId: string,
  stableIdentityKey: string
) => ({
  canonicalIdentityId: null,
  confirmationId,
  confirmedAt: "2026-11-08T00:00:00.000Z",
  displayName: sourceId === "fm-kane" ? "Harry Kane" : "Erling Haaland",
  identityVerified: false,
  kind: "player_identity" as const,
  normalizedMention: mention.trim().toLocaleLowerCase().replaceAll(/\s/gu, ""),
  originThreadId: "clear-fixture-thread",
  originalMention: mention,
  schemaVersion: 1,
  sourceRecords: [
    {
      canonicalIdentityId: null,
      competition: null,
      identityVerified: false,
      name: sourceId === "fm-kane" ? "Harry Kane" : "Erling Haaland",
      provider: "fm" as const,
      season: null,
      sourceId,
    },
  ],
  sourceVersions: {
    fmManifestSha256: null,
    fmSnapshotDate: null,
    identityRegistryRelease: null,
    understatScopes: [],
  },
  stableIdentityKey,
});

const withSourceFixtures = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "tactiscout-memory-"));
  temporaryDirectories.push(directory);
  const sourcePaths = await createPlayerMemorySources(directory);

  vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:1");
  vi.stubEnv("TACTISCOUT_FM_PROFILES_PATH", sourcePaths.fmDatabasePath);
  vi.stubEnv("TACTISCOUT_REEP_IDENTITY_DB_PATH", sourcePaths.reepDatabasePath);
  vi.stubEnv("TACTISCOUT_UNDERSTAT_DB_PATH", sourcePaths.understatDatabasePath);
  vi.stubEnv("TACTISCOUT_UNDERSTAT_AI_PROCESSING_ALLOWED", "true");

  return sourcePaths;
};

const candidateWithSource = (
  candidates: ReferenceCandidate[],
  provider: "fm" | "understat",
  sourceId: string
): ReferenceCandidate => {
  const candidate = candidates.find((item) =>
    item.records.some(
      (record) => record.provider === provider && record.sourceId === sourceId
    )
  );

  if (candidate === undefined) {
    throw new Error(`Could not find ${provider} source ${sourceId}.`);
  }

  return candidate;
};

const selectedIdentity = (state: AgentStateType) => {
  const resolution = state.request.players[0]?.resolution;

  if (resolution?.status !== "resolved") {
    return {
      candidates: resolution?.candidates ?? [],
      status: resolution?.status,
    };
  }

  const candidate = resolution.candidates.find(
    (item) => item.candidateId === resolution.selectedCandidateId
  );

  return {
    canonicalIdentityId: resolution.canonicalIdentityId,
    identityBasis: candidate?.identityBasis,
    records:
      candidate?.records.map(
        ({ canonicalIdentityId, identityVerified, provider, sourceId }) => ({
          canonicalIdentityId,
          identityVerified,
          provider,
          sourceId,
        })
      ) ?? [],
    status: resolution.status,
  };
};

const selectedServerIdentity = (state: ThreadState) =>
  selectedIdentity(AgentState.parse(state.values));

describe("cross-thread player memory", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directory) => {
        await rm(directory, { force: true, recursive: true });
      })
    );
  });

  it("reuses a confirmed FM/Understat group after validating exact source IDs", async () => {
    await withSourceFixtures();
    const store = new InMemoryStore();

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      resolvePlayerReference
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: sourceGroupExtractor([
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
    const fmCandidate = candidateWithSource(candidates, "fm", "fm-mbappe");

    const understatCandidate = candidateWithSource(
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
      confirmation: selectedIdentity(confirmed),
      identityLookupCalls: identityLookup.mock.calls.length,
      reresolution: selectedIdentity(reresolved),
      reresolutionInterrupt: Object.hasOwn(reresolved, "__interrupt__"),
      reuse: selectedIdentity(reused),
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

  it("re-resolves a prior-context reference after its shared identity is removed", async () => {
    await withSourceFixtures();
    const store = new InMemoryStore();

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      resolvePlayerReference
    );

    const graph = createAgent({
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

        return await sourceGroupExtractor(["Kylian Mbappé"])(
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
    const fmCandidate = candidateWithSource(candidates, "fm", "fm-mbappe");

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
    await withSourceFixtures();
    const store = new InMemoryStore();
    const storeSearch = vi.spyOn(store, "search");

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      resolvePlayerReference
    );

    const graph = createAgent({
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

  it("retains an outdated confirmation and requires current-source confirmation", async () => {
    const sourcePaths = await withSourceFixtures();
    const store = new InMemoryStore();

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      resolvePlayerReference
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: sourceGroupExtractor(["Kylian Mbappé"]),
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

    const fmCandidate = candidateWithSource(candidates, "fm", "fm-mbappe");

    const understatCandidate = candidateWithSource(
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
      restoredIdentity: selectedIdentity(threadC),
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
    await withSourceFixtures();
    const store = new InMemoryStore();

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      resolvePlayerReference
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: sourceGroupExtractor(["Kane"]),
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

    const kaneCandidate = candidateWithSource(
      pendingA.request.players[0]?.resolution?.candidates ?? [],
      "fm",
      "fm-kane"
    );

    const haalandCandidate = candidateWithSource(
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

  it("reuses a cross-provider confirmation through the managed Store after restart", async () => {
    await withSourceFixtures();

    const session = await startDevServerSession(
      "./tests/fixtures/player-memory-agent.ts:agent"
    );

    const { baseUrl } = session;

    const createThread = async () =>
      await postJson(
        baseUrl,
        "/threads",
        apiThreadSchema,
        JSON.stringify({ metadata: { graph_id: "agent" } })
      );

    const runLookup = async (threadId: string, message: string) =>
      await postJson(
        baseUrl,
        `/threads/${threadId}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          input: { messages: [{ content: message, role: "user" }] },
        })
      );

    const getThreadState = async (threadId: string) =>
      await requestJson(
        baseUrl,
        `/threads/${threadId}/state`,
        threadStateSchema
      );

    try {
      const threadA = await createThread();
      await runLookup(threadA.thread_id, "Look up Kylian Mbappé");
      const pendingA = await getThreadState(threadA.thread_id);

      const candidates =
        pendingA.values.request.players?.[0]?.resolution?.candidates ?? [];

      const candidateIdForSource = (
        provider: "fm" | "understat",
        sourceId: string
      ) =>
        candidates.find((candidate) =>
          candidate.records.some(
            (record) =>
              record.provider === provider && record.sourceId === sourceId
          )
        )?.candidateId;

      const fmCandidateId = candidateIdForSource("fm", "fm-mbappe");

      const understatCandidateId = candidateIdForSource(
        "understat",
        "understat-mbappe"
      );

      if (fmCandidateId === undefined || understatCandidateId === undefined) {
        throw new Error(
          "The managed Store thread did not return both sources."
        );
      }

      await postJson(
        baseUrl,
        `/threads/${threadA.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          command: {
            resume: {
              candidateIds: [fmCandidateId, understatCandidateId],
            },
          },
        })
      );

      const confirmed = await getThreadState(threadA.thread_id);
      const threadB = await createThread();
      await runLookup(threadB.thread_id, "Look up Kylian Mbappe");
      const stateB = await getThreadState(threadB.thread_id);
      await session.restart();
      const threadC = await createThread();
      await runLookup(threadC.thread_id, "Look up Kylian Mbappe");
      const stateC = await getThreadState(threadC.thread_id);

      expect({
        confirmed: selectedServerIdentity(confirmed),
        pending: clarificationDetails(pendingA),
        threadB: {
          clarification: clarificationDetails(stateB),
          identity: selectedServerIdentity(stateB),
        },
        threadC: {
          clarification: clarificationDetails(stateC),
          identity: selectedServerIdentity(stateC),
        },
      }).toStrictEqual({
        confirmed: {
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
        pending: {
          hasInterrupt: true,
          question:
            "“Kylian Mbappé”匹配到多个同名候选。请回复候选编号，或补充球队、赛事或赛季；多个编号（例如 1,2）表示你确认这些来源记录属于同一人。",
        },
        threadB: {
          clarification: { hasInterrupt: false, question: null },
          identity: {
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
        },
        threadC: {
          clarification: { hasInterrupt: false, question: null },
          identity: {
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
        },
      });
    } finally {
      await session.close();
    }
  }, 180_000);
});

describe("conversational player-memory management", () => {
  it("blocks an incompatible checkpoint before request extraction or memory access", async () => {
    const store = new InMemoryStore();
    const storeSearch = vi.spyOn(store, "search");

    const extractor = vi.fn<RequestUnderstandingExtractor>(
      aliasCorrectionExtractor
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      requestUnderstandingExtractor: extractor,
      store,
      tools: [],
    });

    const result = await graph.invoke(
      {
        messages: [new HumanMessage("Look up 凯恩")],
        request: {
          ...createInitialRequestState(),
          processedMessageId: "completed-old-turn",
        },
        stateSchemaVersion: 0,
      },
      { configurable: { thread_id: "incompatible-state-version" } }
    );

    expect({
      extractorCalls: extractor.mock.calls.length,
      memoryReads: storeSearch.mock.calls.length,
      notice: result.messages.at(-1)?.content,
      outcome: result.outcome,
      requestMessageId: result.request.processedMessageId,
    }).toStrictEqual({
      extractorCalls: 0,
      memoryReads: 0,
      notice:
        "这个对话使用的状态版本（0）与当前应用版本 1 不兼容。历史记录仍可查看；请新建 thread 继续。此次请求没有执行，也没有修改球员记忆。",
      outcome: {
        kind: "state_compatibility",
        resultJson: JSON.stringify({ currentVersion: 1, storedVersion: 0 }),
        status: "incompatible",
      },
      requestMessageId: "completed-old-turn",
    });
  });

  it("blocks a legacy unversioned State that contains a pending interrupt", async () => {
    const store = new InMemoryStore();

    const extractor = vi.fn<RequestUnderstandingExtractor>(
      aliasCorrectionExtractor
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      requestUnderstandingExtractor: extractor,
      store,
      tools: [],
    });

    const result = await graph.invoke(
      {
        messages: [new HumanMessage("1")],
        pendingClarification: {
          answer: null,
          kind: "identity",
          playerIndex: 0,
          question: "Which player did you mean?",
        },
        stateSchemaVersion: null,
      },
      { configurable: { thread_id: "legacy-unversioned-pending-state" } }
    );

    expect({
      extractorCalls: extractor.mock.calls.length,
      outcomeStatus: result.outcome?.status,
      pendingKind: result.pendingClarification?.kind,
    }).toStrictEqual({
      extractorCalls: 0,
      outcomeStatus: "incompatible",
      pendingKind: "identity",
    });
  });

  it("requires confirmation for an unsupported memory even when the name has one current match", async () => {
    await withSourceFixtures();
    const store = new InMemoryStore();

    const unsupportedMemory = {
      ...playerIdentityMemoryFixture(
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

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: resolvePlayerReference,
      requestUnderstandingExtractor: aliasCorrectionExtractor,
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
    const sourcePaths = await withSourceFixtures();
    const store = new InMemoryStore();

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: resolvePlayerReference,
      requestUnderstandingExtractor: aliasCorrectionExtractor,
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
    const kaneCandidate = candidateWithSource(candidates, "fm", "fm-kane");

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
    const sourcePaths = await withSourceFixtures();
    const store = new InMemoryStore();

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: resolvePlayerReference,
      requestUnderstandingExtractor: aliasCorrectionExtractor,
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

    const candidate = candidateWithSource(
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

  it("replaces a corrected alias for new threads while keeping the old thread's local identity", async () => {
    await withSourceFixtures();
    const store = new InMemoryStore();
    const lookup = resolvePlayerReference("Harry Kane");

    const snapshotCandidate = candidateWithSource(
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

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: resolvePlayerReference,
      requestUnderstandingExtractor: aliasCorrectionExtractor,
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
    const kaneCandidate = candidateWithSource(candidates, "fm", "fm-kane");

    const confirmed = await graph.invoke(
      new Command({
        resume: { candidateId: kaneCandidate.candidateId },
      }),
      correctionThread
    );

    const corrected = await graph.invoke(
      {
        messages: [new HumanMessage(aliasCorrectionMessage)],
      },
      correctionThread
    );

    const replayedCorrection = await graph.invoke(
      { messages: [new HumanMessage(aliasCorrectionMessage)] },
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
      freshThreadIdentity: selectedIdentity(freshThread),
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
    await withSourceFixtures();
    const store = new InMemoryStore();

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: resolvePlayerReference,
      requestUnderstandingExtractor: aliasCorrectionExtractor,
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
    const kaneCandidate = candidateWithSource(candidates, "fm", "fm-kane");

    await graph.invoke(
      new Command({ resume: { candidateId: kaneCandidate.candidateId } }),
      correctionThread
    );

    vi.spyOn(store, "delete").mockRejectedValue(
      new Error("simulated Store delete failure")
    );

    const correction = await graph.invoke(
      { messages: [new HumanMessage(aliasCorrectionMessage)] },
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

  it("reports a Store list failure instead of claiming that memory is empty", async () => {
    const store = new InMemoryStore();
    vi.spyOn(store, "search").mockRejectedValue(
      new Error("simulated Store read failure")
    );

    const graph = createAgent({
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

    const graph = createAgent({
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
    await withSourceFixtures();
    const store = new InMemoryStore();

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: resolvePlayerReference,
      requestUnderstandingExtractor: aliasCorrectionExtractor,
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

    const kaneCandidate = candidateWithSource(candidates, "fm", "fm-kane");

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
    await withSourceFixtures();
    const store = new InMemoryStore();
    const namespace = ["tactiscout", "local-user", "player-memory"];

    await store.put(
      namespace,
      "player-memory-fail",
      playerIdentityMemoryFixture(
        "凯恩",
        "fm-kane",
        "confirmation-kane",
        "stable-kane"
      )
    );
    await store.put(
      namespace,
      "player-memory-delete",
      playerIdentityMemoryFixture(
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

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      requestUnderstandingExtractor: aliasCorrectionExtractor,
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
      playerIdentityMemoryFixture(
        "凯恩",
        "fm-kane",
        "approved-confirmation",
        "approved-stable-key"
      )
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      requestUnderstandingExtractor: aliasCorrectionExtractor,
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
      playerIdentityMemoryFixture(
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
