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

import type { ReferenceIdentityLookup } from "../src/player-data/resolve-reference.js";
import { resolvePlayerReference } from "../src/player-data/resolve-reference.js";
import type { RequestUnderstandingExtractor } from "../src/request-extraction.js";
import { AgentState } from "../src/state.js";
import type { AgentStateType, ReferenceCandidate } from "../src/state.js";
import {
  apiThreadSchema,
  postJson,
  requestJson,
  startDevServerSession,
  threadStateSchema,
  waitResponseSchema,
} from "./fixtures/langgraph-dev-server.js";
import type { ThreadState } from "./fixtures/langgraph-dev-server.js";
import { clarificationDetails } from "./fixtures/persistence-state.js";
import { createPlayerMemorySources } from "./fixtures/player-memory-sources.js";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent } = await import("../src/agent.js");

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
