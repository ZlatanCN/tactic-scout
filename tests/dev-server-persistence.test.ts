import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { comparisonResultSchema } from "../src/player-data/compare-records.js";
import { recommendationResultSchema } from "../src/player-data/recommend-players.js";
import { AgentState, agentStateSchemaVersion } from "../src/state.js";
import { teamRecommendationResultSchema } from "../src/team-data/recommendation-result.js";
import {
  apiThreadSchema,
  postJson,
  putJson,
  requestJson,
  startDevServerSession,
  storeItemSchema,
  threadStateSchema,
  waitResponseSchema,
} from "./fixtures/langgraph-dev-server.js";
import type {
  DevServerSession,
  LocalGateway,
  ThreadState,
} from "./fixtures/langgraph-dev-server.js";
import {
  activeRecommendationFromState,
  clarificationDetails,
  persistedThreadFacts,
  playerReference,
  resumedInterruptFacts,
  savedTeamSnapshotOutcome,
  savedConversationContext,
  workflowSnapshots,
} from "./fixtures/persistence-state.js";

const resolvedIdentitySelection = (state: ThreadState) => {
  const resolution = state.values.request.players?.[0]?.resolution;

  const selectedCandidate = resolution?.candidates?.find(
    (candidate) => candidate.candidateId === resolution.selectedCandidateId
  );

  return {
    selectedCandidateId: resolution?.selectedCandidateId ?? null,
    sourceRecords:
      selectedCandidate?.records
        .map(
          ({ canonicalIdentityId, identityVerified, provider, sourceId }) => ({
            canonicalIdentityId,
            identityVerified,
            provider,
            sourceId,
          })
        )
        .toSorted(
          (left, right) =>
            left.provider.localeCompare(right.provider) ||
            left.sourceId.localeCompare(right.sourceId)
        ) ?? [],
    status: resolution?.status ?? null,
  };
};

const createAgentThread = async (baseUrl: string) =>
  await postJson(
    baseUrl,
    "/threads",
    apiThreadSchema,
    JSON.stringify({ metadata: { graph_id: "agent" } })
  );

const getAgentThreadState = async (baseUrl: string, threadId: string) =>
  await requestJson(baseUrl, `/threads/${threadId}/state`, threadStateSchema);

const latestAssistantText = (state: ThreadState) => {
  const message = state.values.messages
    .toReversed()
    .find(({ type }) => type === "ai");

  return z.string().parse(message?.content ?? "");
};

const textCompactionFacts = (state: ThreadState) => ({
  allowanceCalls:
    state.values.contextProcessing?.allowance?.consumedAdditionalCalls,
  compactionStatus: state.values.contextProcessing?.compaction?.status,
  instruction: state.values.contextProcessing?.compaction?.instruction,
  lookupOutcome: state.values.outcome?.status,
  lookupResultAvailable:
    state.values.conversationContext.activeLookup?.resultJson.length ?? 0,
  requestKind: state.values.request.kind,
});

const memoryForgetOptionLabel = (state: ThreadState, marker: string) => {
  const pending = z
    .object({
      options: z.array(z.object({ label: z.string() })),
    })
    .parse(state.values.pendingClarification);

  return pending.options.find(({ label }) => label.includes(marker))?.label;
};

const rosterMemberFromState = (state: ThreadState) =>
  state.values.request.teamRecommendation?.roster?.members?.[0];

const rosterMemberFactsFromState = (state: ThreadState) => {
  const member = rosterMemberFromState(state);

  return {
    apiFootballPlayerId: member?.apiFootballPlayerId,
    fmId: member?.fmId,
    mappingMethod: member?.mappingMethod,
    mappingStatus: member?.mappingStatus,
  };
};

const changeKaneRegistryLink = (databasePath: string) => {
  const identityRegistry = new DatabaseSync(databasePath);

  try {
    identityRegistry
      .prepare(
        "INSERT INTO bridges (provider, namespace, external_id, canonical_reep_id, redirect_status) VALUES (?, ?, ?, ?, ?)"
      )
      .run("api_football", "player", "11", "canonical:kane", "resolved");
    identityRegistry
      .prepare(
        "UPDATE bridges SET canonical_reep_id = ? WHERE provider = ? AND namespace = ? AND external_id = ?"
      )
      .run("canonical:haaland", "fm", "player", "fm-kane");
  } finally {
    identityRegistry.close();
  }
};

const addKaneUnderstatSource = (
  understatDatabasePath: string,
  reepDatabasePath: string
) => {
  const understatDatabase = new DatabaseSync(understatDatabasePath);

  try {
    understatDatabase
      .prepare(
        "INSERT INTO source_snapshots (kind, resource_id, season_start_year, payload_json) VALUES ('league', 'Bundesliga', 2025, ?)"
      )
      .run(
        JSON.stringify({
          players: [
            {
              assists: "0",
              games: "1",
              goals: "0",
              id: "understat-kane",
              key_passes: "0",
              npxG: "0.0",
              player_name: "Harry Kane",
              position: "F",
              shots: "0",
              team_title: "Bayern Munich",
              time: "90",
              xA: "0.0",
              xG: "0.0",
            },
          ],
        })
      );
  } finally {
    understatDatabase.close();
  }

  const identityRegistry = new DatabaseSync(reepDatabasePath);

  try {
    identityRegistry
      .prepare(
        "INSERT INTO bridges (provider, namespace, external_id, canonical_reep_id, redirect_status) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        "understat",
        "player",
        "understat-kane",
        "canonical:kane",
        "resolved"
      );
  } finally {
    identityRegistry.close();
  }
};

const removeKaneUnderstatSource = (understatDatabasePath: string) => {
  const understatDatabase = new DatabaseSync(understatDatabasePath);

  try {
    understatDatabase
      .prepare(
        "DELETE FROM source_snapshots WHERE kind = 'league' AND resource_id = 'Bundesliga' AND season_start_year = 2025"
      )
      .run();
  } finally {
    understatDatabase.close();
  }
};

const updateFmSnapshot = (databasePath: string) => {
  const fmDatabase = new DatabaseSync(databasePath);

  try {
    const manifestRow = z
      .object({ payload: z.string() })
      .parse(
        fmDatabase.prepare("SELECT payload FROM manifest WHERE id = 1").get()
      );

    const manifest = z
      .object({
        gameBuild: z.string(),
        inGameDate: z.string(),
        sha256: z.string(),
      })
      .parse(JSON.parse(manifestRow.payload));

    fmDatabase.prepare("UPDATE manifest SET payload = ? WHERE id = 1").run(
      JSON.stringify({
        ...manifest,
        inGameDate: "2026-10-31",
        sha256: "persistence-updated-snapshot",
      })
    );

    const profileRow = z
      .object({ payload: z.instanceof(Uint8Array) })
      .parse(
        fmDatabase
          .prepare("SELECT payload FROM players WHERE unique_id = ?")
          .get("fm-kane")
      );

    const profile = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(inflateRawSync(profileRow.payload).toString("utf-8")));

    const updatedProfile = Object.fromEntries(
      Object.entries(profile).map(([key, value]) => [
        key,
        key.startsWith("raw_attributes_") && z.number().safeParse(value).success
          ? 17
          : value,
      ])
    );

    fmDatabase
      .prepare("UPDATE players SET payload = ? WHERE unique_id = ?")
      .run(
        deflateRawSync(
          Buffer.from(
            JSON.stringify({
              ...updatedProfile,
              ability_current: 170,
              ability_potential: 185,
            })
          )
        ),
        "fm-kane"
      );
  } finally {
    fmDatabase.close();
  }
};

const rosterMemoryIsShownAsConflicting = (message: string): boolean =>
  message.includes("API-Football #11") &&
  message.includes("存在冲突，需要重新确认");

const providerAndModelCallCountsAreUnchanged = (
  providerBefore: number,
  providerAfter: number,
  modelBefore: number,
  modelAfter: number
): boolean => providerBefore === providerAfter && modelBefore === modelAfter;

const teamRecommendationResultFromState = (state: ThreadState) => {
  const resultJson =
    state.values.conversationContext.activeTeamRecommendation?.resultJson;

  return resultJson === undefined
    ? null
    : teamRecommendationResultSchema.parse(JSON.parse(resultJson));
};

const teamRecommendationDatesFromState = (state: ThreadState) => {
  const result = teamRecommendationResultFromState(state);

  return result === null
    ? null
    : {
        fmSnapshotDate: result.fmSnapshotDate,
        retrievedAt: result.roster.retrievedAt,
      };
};

const teamRecommendationFactsFromState = (state: ThreadState) => {
  const result = teamRecommendationResultFromState(state);

  if (result === null || !("recommendation" in result)) {
    return null;
  }

  const { recommendation } = result;

  if (!("currentCandidates" in recommendation)) {
    return null;
  }

  return {
    candidateProfiles: recommendation.currentCandidates.map(
      ({ attributes, currentAbility, fmId, potentialAbility, rank }) => ({
        currentAbility,
        finishing:
          attributes.find(({ attribute }) => attribute === "finishing")
            ?.candidateValue ?? null,
        fmId,
        potentialAbility,
        rank,
      })
    ),
    candidateRanks: recommendation.currentCandidates.map(({ fmId, rank }) => ({
      fmId,
      rank,
    })),
    coverage: {
      mappedMembers: result.roster.mappedMembers,
      pendingMembers: result.roster.pendingMembers,
      reepBridgeMappings: result.roster.reepBridgeMappings,
      totalMembers: result.roster.totalMembers,
      userConfirmedMappings: result.roster.userConfirmedMappings,
    },
    fmManifestSha256: recommendation.manifestSha256,
    fmSnapshotDate: result.fmSnapshotDate,
    rankingBasis: result.rankingBasis,
    referenceFinishing: recommendation.referenceMeanAttributes.finishing,
    retrievedAt: result.roster.retrievedAt,
    status: result.status,
  };
};

const rosterMemoryStoreItemSchema = z.looseObject({
  value: z.looseObject({
    apiFootballPlayerId: z.number(),
    confirmationId: z.string(),
    confirmedAt: z.iso.datetime(),
    fmId: z.string(),
    fmPlayerName: z.string(),
    kind: z.literal("roster_identity"),
    originThreadId: z.string(),
    rosterPlayerName: z.string(),
    rosterRetrievedAt: z.iso.datetime().nullable(),
    schemaVersion: z.literal(1),
    sourceVersions: z.object({
      fmManifestSha256: z.string().nullable(),
      fmSnapshotDate: z.string().nullable(),
    }),
    stableIdentityKey: z.string(),
  }),
});

const rosterMemoryStoreKey = `v1:roster-identity:${createHash("sha256")
  .update(JSON.stringify([11, "fm-kane"]))
  .digest("hex")}`;

const readRosterMemory = async (baseUrl: string) =>
  await requestJson(
    baseUrl,
    `/store/items?namespace=tactiscout.local-user.player-memory&key=${rosterMemoryStoreKey}`,
    rosterMemoryStoreItemSchema
  );

type RosterMemoryStoreValue = z.output<
  typeof rosterMemoryStoreItemSchema
>["value"];

const rosterMemoryFacts = (value: RosterMemoryStoreValue) => ({
  apiFootballPlayerId: value.apiFootballPlayerId,
  confirmationIdPresent: value.confirmationId.length > 0,
  confirmedAtPresent: value.confirmedAt.length > 0,
  fmId: value.fmId,
  fmPlayerName: value.fmPlayerName,
  kind: value.kind,
  originThreadId: value.originThreadId,
  rosterPlayerName: value.rosterPlayerName,
  rosterRetrievedAt: value.rosterRetrievedAt,
  schemaVersion: value.schemaVersion,
  sourceVersions: value.sourceVersions,
  stableIdentityKeyPresent: value.stableIdentityKey.length > 0,
});

const expectedRosterRecommendationFacts = {
  candidateProfiles: [
    {
      currentAbility: 150,
      finishing: 15,
      fmId: "fm-haaland",
      potentialAbility: 165,
      rank: 1,
    },
    {
      currentAbility: 160,
      finishing: 16,
      fmId: "fm-prospect",
      potentialAbility: 175,
      rank: 2,
    },
  ],
  candidateRanks: [
    { fmId: "fm-haaland", rank: 1 },
    { fmId: "fm-prospect", rank: 2 },
  ],
  coverage: {
    mappedMembers: 1,
    pendingMembers: 0,
    reepBridgeMappings: 0,
    totalMembers: 1,
    userConfirmedMappings: 1,
  },
  fmManifestSha256: "persistence-test-snapshot",
  fmSnapshotDate: "2025-11-23",
  rankingBasis: "equal_weight_mean_of_position_capable_squad_profiles",
  referenceFinishing: 14,
  retrievedAt: "2026-11-07T00:00:00.000Z",
  status: "ready",
};

const runPlayerLookup = async (
  baseUrl: string,
  threadId: string,
  message: string,
  messageId?: string
) =>
  await postJson(
    baseUrl,
    `/threads/${threadId}/runs/wait`,
    waitResponseSchema,
    JSON.stringify({
      assistant_id: "agent",
      input: {
        messages: [
          {
            content: message,
            id: messageId,
            role: "user",
          },
        ],
      },
    })
  );

const revalidatePlayerAliasInThread = async (
  baseUrl: string,
  threadId: string
) => {
  await runPlayerLookup(baseUrl, threadId, "Look up Kane");

  return await getAgentThreadState(baseUrl, threadId);
};

const resumeAgentRun = async (
  baseUrl: string,
  threadId: string,
  answer: string | { candidateId: string }
) =>
  await postJson(
    baseUrl,
    `/threads/${threadId}/runs/wait`,
    waitResponseSchema,
    JSON.stringify({ assistant_id: "agent", command: { resume: answer } })
  );

type FailureRecoveryInput = {
  baseUrl: string;
  gateway: LocalGateway;
  runMessage: (content: string) => Promise<void>;
  session: DevServerSession;
  threadId: string;
};

const verifyCompletedFailureWaitsForExplicitRetry = async ({
  baseUrl,
  gateway,
  runMessage,
  session,
  threadId,
}: FailureRecoveryInput) => {
  const getThreadState = async () =>
    await requestJson(baseUrl, `/threads/${threadId}/state`, threadStateSchema);

  const priorState = await getThreadState();
  const priorSnapshots = workflowSnapshots(priorState);

  const failureEvent = "team-search-failure";

  const failureCount = (events: string[]) =>
    events.filter((event) => event === failureEvent).length;

  const eventsBeforeFailure = gateway.events();

  await runMessage("Recommend a striker for Outage Club");
  const failedState = await getThreadState();
  const eventsAfterFailure = gateway.events();
  await session.restart();
  const restoredFailure = await getThreadState();
  const eventsAfterRestart = gateway.events();
  await postJson(
    baseUrl,
    `/threads/${threadId}/runs/wait`,
    waitResponseSchema,
    JSON.stringify({ assistant_id: "agent", input: null })
  );
  const afterEmptyResume = await getThreadState();
  const eventsAfterEmptyResume = gateway.events();
  await runMessage("Retry the Outage Club striker search");
  const retryState = await getThreadState();
  const eventsAfterFreshRetry = gateway.events();

  const result = {
    emptyResumeLeavesFailure: afterEmptyResume.values.outcome?.status,
    failureOutcome: failedState.values.outcome?.status,
    freshRetryOutcome: retryState.values.outcome?.status,
    preservesPriorSnapshots: {
      afterEmptyResume: isDeepStrictEqual(
        priorSnapshots,
        workflowSnapshots(afterEmptyResume)
      ),
      afterFailure: isDeepStrictEqual(
        priorSnapshots,
        workflowSnapshots(failedState)
      ),
      afterFreshRetry: isDeepStrictEqual(
        priorSnapshots,
        workflowSnapshots(retryState)
      ),
      afterRestart: isDeepStrictEqual(
        priorSnapshots,
        workflowSnapshots(restoredFailure)
      ),
    },
    providerCalledDuringFailure:
      failureCount(eventsAfterFailure) > failureCount(eventsBeforeFailure),
    providerCalledOnFreshRetry:
      failureCount(eventsAfterFreshRetry) >
      failureCount(eventsAfterEmptyResume),
    providerNotCalledByEmptyResume:
      failureCount(eventsAfterEmptyResume) === failureCount(eventsAfterRestart),
    providerNotCalledOnRestart:
      failureCount(eventsAfterRestart) === failureCount(eventsAfterFailure),
  };

  expect(result).toStrictEqual({
    emptyResumeLeavesFailure: "team_provider_error",
    failureOutcome: "team_provider_error",
    freshRetryOutcome: "team_provider_error",
    preservesPriorSnapshots: {
      afterEmptyResume: true,
      afterFailure: true,
      afterFreshRetry: true,
      afterRestart: true,
    },
    providerCalledDuringFailure: true,
    providerCalledOnFreshRetry: true,
    providerNotCalledByEmptyResume: true,
    providerNotCalledOnRestart: true,
  });
};

describe("managed Dev Server persistence", () => {
  it("reuses a completed text compaction after a native Dev Server restart", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/text-compaction-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;
    const thread = await createAgentThread(baseUrl);
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const message = `Look up Harry Kane. ${filler}`;

    try {
      await runPlayerLookup(baseUrl, thread.thread_id, message);

      const completedBeforeRestart = await getAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      const compactionBeforeRestart =
        completedBeforeRestart.values.contextProcessing?.compaction;

      const originalMessage = completedBeforeRestart.values.messages
        .toReversed()
        .find(({ content, type }) => type === "human" && content === message);

      const messageId = originalMessage?.id;

      if (messageId === undefined) {
        throw new Error("The completed scouting message has no stable ID.");
      }

      expect({
        allowanceCalls:
          completedBeforeRestart.values.contextProcessing?.allowance
            ?.consumedAdditionalCalls,
        compactionStatus: compactionBeforeRestart?.status,
        instruction: compactionBeforeRestart?.instruction,
        lookupOutcome: completedBeforeRestart.values.outcome?.status,
        lookupResultAvailable:
          textCompactionFacts(completedBeforeRestart).lookupResultAvailable > 0,
        originalMessagePresent: originalMessage?.content === message,
      }).toStrictEqual({
        allowanceCalls: 1,
        compactionStatus: "ready",
        instruction: "Look up Harry Kane",
        lookupOutcome: "answer_ready",
        lookupResultAvailable: true,
        originalMessagePresent: true,
      });
      expect(
        gateway
          .calls()
          .filter((call) =>
            call.includes('"name":"compact_scouting_instruction"')
          )
      ).toHaveLength(1);

      await session.restart();

      const restartedState = await getAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      expect({
        allowanceCalls:
          restartedState.values.contextProcessing?.allowance
            ?.consumedAdditionalCalls,
        compaction: restartedState.values.contextProcessing?.compaction,
        lookupResultJson:
          restartedState.values.conversationContext.activeLookup?.resultJson,
      }).toStrictEqual({
        allowanceCalls: 1,
        compaction: compactionBeforeRestart,
        lookupResultJson:
          completedBeforeRestart.values.conversationContext.activeLookup
            ?.resultJson,
      });

      await runPlayerLookup(baseUrl, thread.thread_id, message, messageId);

      const completed = await getAgentThreadState(baseUrl, thread.thread_id);

      const completedCompactionCalls = gateway
        .calls()
        .filter((call) =>
          call.includes('"name":"compact_scouting_instruction"')
        );

      expect({
        allowanceCalls:
          completed.values.contextProcessing?.allowance
            ?.consumedAdditionalCalls,
        compactionCalls: completedCompactionCalls.length,
        compactionStatus:
          completed.values.contextProcessing?.compaction?.status,
        lookupOutcome: completed.values.outcome?.status,
        requestKind: completed.values.request.kind,
      }).toStrictEqual({
        allowanceCalls: 1,
        compactionCalls: 1,
        compactionStatus: "ready",
        lookupOutcome: "answer_ready",
        requestKind: "player_lookup",
      });
      expect(
        textCompactionFacts(completed).lookupResultAvailable
      ).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  }, 45_000);

  it("reuses a confirmed roster mapping across threads and restart without restoring absent members", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/persistence-agent.ts:agent"
    );

    const { baseUrl, gateway, sourceFixturePaths } = session;
    const message = "Recommend a striker for Roster Memory Club";
    const createThread = async () => await createAgentThread(baseUrl);

    const readState = async (threadId: string) =>
      await getAgentThreadState(baseUrl, threadId);

    try {
      const threadA = await createThread();
      await runPlayerLookup(baseUrl, threadA.thread_id, message);
      const pendingA = await readState(threadA.thread_id);

      await postJson(
        baseUrl,
        `/threads/${threadA.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({ assistant_id: "agent", command: { resume: "1" } })
      );
      const completedA = await readState(threadA.thread_id);

      const mappingBeforeRestart = await readRosterMemory(baseUrl);

      const threadB = await createThread();
      await runPlayerLookup(baseUrl, threadB.thread_id, message);
      const completedB = await readState(threadB.thread_id);
      const eventsBeforeRestart = gateway.events();

      updateFmSnapshot(sourceFixturePaths.fmDatabasePath);
      await session.restart();

      const persistedMapping = await readRosterMemory(baseUrl);
      const restoredThreadB = await readState(threadB.thread_id);

      const threadC = await createThread();
      await runPlayerLookup(baseUrl, threadC.thread_id, message);
      const completedC = await readState(threadC.thread_id);
      const eventsAfterRestartedRequest = gateway.events();

      await session.restart();

      const threadD = await createThread();
      await runPlayerLookup(baseUrl, threadD.thread_id, message);
      const departedRoster = await readState(threadD.thread_id);

      const rosterResultDates = [completedB, completedC].map(
        teamRecommendationDatesFromState
      );

      const recommendationFacts = [completedA, completedB, completedC].map(
        teamRecommendationFactsFromState
      );

      expect({
        completedA: rosterMemberFactsFromState(completedA),
        completedB: rosterMemberFactsFromState(completedB),
        completedC: rosterMemberFactsFromState(completedC),
        completedCClarification: clarificationDetails(completedC),
        completedCPlayerMemoryStatus: completedC.values.playerMemoryStatus,
        departedRoster: {
          memberCount:
            departedRoster.values.request.teamRecommendation?.roster?.members
              ?.length ?? 0,
          outcomeStatus: departedRoster.values.outcome?.status,
        },
        events: {
          afterC: eventsAfterRestartedRequest.filter(
            (event) => event === "team-roster"
          ).length,
          afterD: gateway.events().filter((event) => event === "team-roster")
            .length,
          beforeRestart: eventsBeforeRestart.filter(
            (event) => event === "team-roster"
          ).length,
        },
        interruptions: [pendingA, completedB, completedC].map(
          (state) => clarificationDetails(state).hasInterrupt
        ),
        mappingBeforeRestart: rosterMemoryFacts(mappingBeforeRestart.value),
        persistedMappingUnchanged: isDeepStrictEqual(
          mappingBeforeRestart.value,
          persistedMapping.value
        ),
        recommendationFacts,
        restoredOldResultDates:
          teamRecommendationDatesFromState(restoredThreadB),
      }).toStrictEqual({
        completedA: {
          apiFootballPlayerId: 11,
          fmId: "fm-kane",
          mappingMethod: "user_confirmation",
          mappingStatus: "resolved",
        },
        completedB: {
          apiFootballPlayerId: 11,
          fmId: "fm-kane",
          mappingMethod: "user_confirmation",
          mappingStatus: "resolved",
        },
        completedC: {
          apiFootballPlayerId: 11,
          fmId: "fm-kane",
          mappingMethod: "user_confirmation",
          mappingStatus: "resolved",
        },
        completedCClarification: { hasInterrupt: false, question: null },
        completedCPlayerMemoryStatus: { readFailed: false, writeFailed: false },
        departedRoster: { memberCount: 0, outcomeStatus: "team_roster_empty" },
        events: { afterC: 2, afterD: 3, beforeRestart: 1 },
        interruptions: [true, false, false],
        mappingBeforeRestart: {
          apiFootballPlayerId: 11,
          confirmationIdPresent: true,
          confirmedAtPresent: true,
          fmId: "fm-kane",
          fmPlayerName: "Harry Kane",
          kind: "roster_identity",
          originThreadId: threadA.thread_id,
          rosterPlayerName: "Harry Kane",
          rosterRetrievedAt: "2026-11-07T00:00:00.000Z",
          schemaVersion: 1,
          sourceVersions: {
            fmManifestSha256: "persistence-test-snapshot",
            fmSnapshotDate: "2025-11-23",
          },
          stableIdentityKeyPresent: true,
        },
        persistedMappingUnchanged: true,
        recommendationFacts: [
          expectedRosterRecommendationFacts,
          expectedRosterRecommendationFacts,
          {
            ...expectedRosterRecommendationFacts,
            candidateProfiles: [
              {
                currentAbility: 160,
                finishing: 16,
                fmId: "fm-prospect",
                potentialAbility: 175,
                rank: 1,
              },
              {
                currentAbility: 150,
                finishing: 15,
                fmId: "fm-haaland",
                potentialAbility: 165,
                rank: 2,
              },
            ],
            candidateRanks: [
              { fmId: "fm-prospect", rank: 1 },
              { fmId: "fm-haaland", rank: 2 },
            ],
            fmManifestSha256: "persistence-updated-snapshot",
            fmSnapshotDate: "2026-10-31",
            referenceFinishing: 17,
          },
        ],
        restoredOldResultDates: {
          fmSnapshotDate: "2025-11-23",
          retrievedAt: "2026-11-07T00:00:00.000Z",
        },
      });

      expect(
        rosterResultDates.map((dates) => dates?.fmSnapshotDate ?? null)
      ).toStrictEqual(["2025-11-23", "2026-10-31"]);
      expect(
        rosterResultDates.every(
          (dates) =>
            dates !== null && Number.isFinite(Date.parse(dates.retrievedAt))
        )
      ).toBeTruthy();
    } finally {
      await session.close();
    }
  }, 120_000);

  it("reuses an explicitly confirmed Chinese player alias across restart and thread deletion", async () => {
    const session = await startDevServerSession();
    const { baseUrl } = session;

    try {
      const threadA = await createAgentThread(baseUrl);
      await runPlayerLookup(baseUrl, threadA.thread_id, "Look up 凯恩");
      const pendingA = await getAgentThreadState(baseUrl, threadA.thread_id);

      await postJson(
        baseUrl,
        `/threads/${threadA.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          command: { resume: { candidateId: "reep:canonical:kane" } },
        })
      );

      const confirmedA = await getAgentThreadState(baseUrl, threadA.thread_id);

      const deleteResponse = await fetch(
        `${baseUrl}/threads/${threadA.thread_id}`,
        { method: "DELETE" }
      );

      if (!deleteResponse.ok) {
        throw new Error(
          `Could not delete the confirmed thread: ${deleteResponse.status}`
        );
      }

      const threadB = await createAgentThread(baseUrl);
      await runPlayerLookup(baseUrl, threadB.thread_id, "Look up 凯恩");
      const stateB = await getAgentThreadState(baseUrl, threadB.thread_id);
      await session.restart();
      const threadC = await createAgentThread(baseUrl);
      await runPlayerLookup(baseUrl, threadC.thread_id, "Look up 凯恩");
      const stateC = await getAgentThreadState(baseUrl, threadC.thread_id);

      expect({
        confirmedA: clarificationDetails(pendingA),
        confirmedIdentity: resolvedIdentitySelection(confirmedA),
        threadB: {
          clarification: clarificationDetails(stateB),
          identity: resolvedIdentitySelection(stateB),
        },
        threadC: {
          clarification: clarificationDetails(stateC),
          identity: resolvedIdentitySelection(stateC),
        },
      }).toStrictEqual({
        confirmedA: {
          hasInterrupt: true,
          question:
            "你写的是“凯恩”。本地资料中找到“Harry Kane”，请确认是否指这位球员。",
        },
        confirmedIdentity: {
          selectedCandidateId: "reep:canonical:kane",
          sourceRecords: [
            {
              canonicalIdentityId: "canonical:kane",
              identityVerified: true,
              provider: "fm",
              sourceId: "fm-kane",
            },
          ],
          status: "resolved",
        },
        threadB: {
          clarification: { hasInterrupt: false, question: null },
          identity: {
            selectedCandidateId: "reep:canonical:kane",
            sourceRecords: [
              {
                canonicalIdentityId: "canonical:kane",
                identityVerified: true,
                provider: "fm",
                sourceId: "fm-kane",
              },
            ],
            status: "resolved",
          },
        },
        threadC: {
          clarification: { hasInterrupt: false, question: null },
          identity: {
            selectedCandidateId: "reep:canonical:kane",
            sourceRecords: [
              {
                canonicalIdentityId: "canonical:kane",
                identityVerified: true,
                provider: "fm",
                sourceId: "fm-kane",
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

  it("lists and selectively forgets confirmed alias and roster memories through a restarted conversation", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/persistence-agent.ts:agent"
    );

    const { baseUrl } = session;

    const runMessage = async (threadId: string, content: string) =>
      await postJson(
        baseUrl,
        `/threads/${threadId}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          input: { messages: [{ content, role: "user" }] },
        })
      );

    const readState = async (threadId: string) =>
      await getAgentThreadState(baseUrl, threadId);

    try {
      const aliasThread = await createAgentThread(baseUrl);
      await runMessage(aliasThread.thread_id, "Look up 凯恩");
      const aliasPending = await readState(aliasThread.thread_id);
      expect(clarificationDetails(aliasPending).hasInterrupt).toBeTruthy();

      await resumeAgentRun(baseUrl, aliasThread.thread_id, {
        candidateId: "reep:canonical:kane",
      });

      const rosterThread = await createAgentThread(baseUrl);
      await runMessage(
        rosterThread.thread_id,
        "Recommend a striker for Roster Memory Club"
      );
      await resumeAgentRun(baseUrl, rosterThread.thread_id, "1");
      const aliasBeforeForget = await readState(aliasThread.thread_id);
      const rosterAfterConfirmation = await readState(rosterThread.thread_id);

      const providerCallsBeforeMemoryFollowUp = session.gateway
        .events()
        .filter((event) => event === "team-roster").length;

      await runMessage(
        rosterThread.thread_id,
        "Show remembered player aliases and mappings"
      );
      await runMessage(
        rosterThread.thread_id,
        "Explain the saved Roster Memory Club recommendation"
      );
      const rosterBeforeForget = await readState(rosterThread.thread_id);
      expect(rosterBeforeForget.values.outcome).toMatchObject({
        source: "saved",
      });

      const providerCallsAfterMemoryFollowUp = session.gateway
        .events()
        .filter((event) => event === "team-roster").length;

      await putJson(
        baseUrl,
        "/store/items",
        JSON.stringify({
          key: "keep-me",
          namespace: ["tactiscout", "local-user", "unrelated"],
          value: { confirmed: true, sourceIds: ["fm-haaland"] },
        })
      );

      const managementThread = await createAgentThread(baseUrl);

      await runMessage(
        managementThread.thread_id,
        "Show remembered player aliases and mappings"
      );
      const listed = await readState(managementThread.thread_id);

      await runMessage(managementThread.thread_id, "Forget Harry Kane");
      const ambiguous = await readState(managementThread.thread_id);
      await session.restart();
      const restoredAmbiguity = await readState(managementThread.thread_id);
      await resumeAgentRun(baseUrl, managementThread.thread_id, "99");
      const invalidAnswer = await readState(managementThread.thread_id);
      await resumeAgentRun(baseUrl, managementThread.thread_id, "取消");
      const cancelled = await readState(managementThread.thread_id);

      await runMessage(
        managementThread.thread_id,
        "Forget roster mapping Harry Kane"
      );

      const afterDirectRosterForget = await readState(
        managementThread.thread_id
      );

      const restoredRosterThread = await createAgentThread(baseUrl);
      await runMessage(
        restoredRosterThread.thread_id,
        "Recommend a striker for Roster Memory Club"
      );

      const restoredRosterPending = await readState(
        restoredRosterThread.thread_id
      );

      await resumeAgentRun(baseUrl, restoredRosterThread.thread_id, "1");

      const restoredRosterState = await readState(
        restoredRosterThread.thread_id
      );

      await runMessage(managementThread.thread_id, "Forget Harry Kane");
      const validAmbiguity = await readState(managementThread.thread_id);
      await session.restart();

      const restoredValidAmbiguity = await readState(
        managementThread.thread_id
      );

      const rosterForgetOption = memoryForgetOptionLabel(
        restoredValidAmbiguity,
        "API-Football #11"
      );

      if (rosterForgetOption === undefined) {
        throw new Error(
          "The resumed interrupt lost its roster mapping option."
        );
      }

      await resumeAgentRun(
        baseUrl,
        managementThread.thread_id,
        rosterForgetOption
      );

      const afterResumedRosterForget = await readState(
        managementThread.thread_id
      );

      await runMessage(managementThread.thread_id, "Forget alias 凯恩");
      const afterAliasForget = await readState(managementThread.thread_id);
      await runMessage(managementThread.thread_id, "Forget alias 凯恩");
      const repeatedAliasForget = await readState(managementThread.thread_id);
      await runMessage(
        managementThread.thread_id,
        "Show remembered player aliases and mappings"
      );
      const emptyList = await readState(managementThread.thread_id);

      const freshAliasThread = await createAgentThread(baseUrl);
      await runMessage(freshAliasThread.thread_id, "Look up 凯恩");
      const freshAlias = await readState(freshAliasThread.thread_id);

      const aliasAfterForget = await readState(aliasThread.thread_id);
      const rosterAfterForget = await readState(rosterThread.thread_id);

      const unrelatedRecord = await requestJson(
        baseUrl,
        "/store/items?namespace=tactiscout.local-user.unrelated&key=keep-me",
        storeItemSchema
      );

      expect({
        afterAliasForget: {
          outcome: afterAliasForget.values.outcome?.status,
          textContainsAlias:
            latestAssistantText(afterAliasForget).includes("凯恩"),
        },
        afterDirectRosterForget: afterDirectRosterForget.values.outcome?.status,
        afterResumedRosterForget: {
          outcome: afterResumedRosterForget.values.outcome?.status,
          textContainsRoster: latestAssistantText(
            afterResumedRosterForget
          ).includes("API-Football #11"),
        },
        ambiguous: {
          asksToSelect:
            clarificationDetails(ambiguous).question?.includes(
              "请选择要忘记的记录"
            ),
          hasInterrupt: clarificationDetails(ambiguous).hasInterrupt,
        },
        cancelled: {
          outcome: cancelled.values.outcome?.status,
          pending: cancelled.values.pendingClarification ?? null,
        },
        emptyList: {
          outcome: emptyList.values.outcome?.status,
          text: latestAssistantText(emptyList),
        },
        freshAliasNeedsConfirmation:
          clarificationDetails(freshAlias).hasInterrupt,
        invalidAnswer: {
          asksForValidOption: clarificationDetails(
            invalidAnswer
          ).question?.includes("请选择一个有效的记忆目标编号"),
          hasInterrupt: clarificationDetails(invalidAnswer).hasInterrupt,
        },
        listed: {
          containsAlias: latestAssistantText(listed).includes("凯恩"),
          containsConfirmationContext:
            latestAssistantText(listed).includes("确认编号") &&
            latestAssistantText(listed).includes(aliasThread.thread_id) &&
            latestAssistantText(listed).includes(rosterThread.thread_id),
          containsHeader:
            latestAssistantText(listed).includes("已记住的球员身份"),
          containsRosterMapping:
            latestAssistantText(listed).includes("API-Football #11"),
          containsSourceId: latestAssistantText(listed).includes("FM fm-kane"),
          containsValidation:
            latestAssistantText(listed).includes("当前资料校验通过"),
          outcome: listed.values.outcome?.status,
        },
        oldIdentityContextPreserved: {
          alias: isDeepStrictEqual(
            resolvedIdentitySelection(aliasBeforeForget),
            resolvedIdentitySelection(aliasAfterForget)
          ),
          roster: isDeepStrictEqual(
            rosterMemberFactsFromState(rosterBeforeForget),
            rosterMemberFactsFromState(rosterAfterForget)
          ),
        },
        originHistoryPreserved: {
          alias: isDeepStrictEqual(
            workflowSnapshots(aliasBeforeForget),
            workflowSnapshots(aliasAfterForget)
          ),
          roster: isDeepStrictEqual(
            workflowSnapshots(rosterBeforeForget),
            workflowSnapshots(rosterAfterForget)
          ),
        },
        repeatedAliasForget: repeatedAliasForget.values.outcome?.status,
        restoredAmbiguity: {
          asksToSelect:
            clarificationDetails(restoredAmbiguity).question?.includes(
              "请选择要忘记的记录"
            ),
          hasInterrupt: clarificationDetails(restoredAmbiguity).hasInterrupt,
        },
        restoredRosterMapping: {
          asked: clarificationDetails(restoredRosterPending).hasInterrupt,
          mapped: rosterMemberFactsFromState(restoredRosterState),
        },
        scoutingFollowUpAfterMemoryManagement: {
          kind: rosterBeforeForget.values.outcome?.kind,
          providerCallsUnchanged:
            providerCallsAfterMemoryFollowUp ===
            providerCallsBeforeMemoryFollowUp,
          source: rosterBeforeForget.values.outcome?.source,
        },
        setupConfirmed: {
          alias: resolvedIdentitySelection(aliasBeforeForget).status,
          roster: rosterMemberFactsFromState(rosterAfterConfirmation),
        },
        unrelatedRecord: unrelatedRecord.value,
        validAmbiguity: {
          hasInterrupt: clarificationDetails(validAmbiguity).hasInterrupt,
          restoredInterrupt: clarificationDetails(restoredValidAmbiguity)
            .hasInterrupt,
        },
      }).toStrictEqual({
        afterAliasForget: {
          outcome: "forgotten",
          textContainsAlias: true,
        },
        afterDirectRosterForget: "forgotten",
        afterResumedRosterForget: {
          outcome: "forgotten",
          textContainsRoster: true,
        },
        ambiguous: {
          asksToSelect: true,
          hasInterrupt: true,
        },
        cancelled: { outcome: "cancelled", pending: null },
        emptyList: {
          outcome: "listed",
          text: "当前没有已记住的球员称呼或阵容映射。",
        },
        freshAliasNeedsConfirmation: true,
        invalidAnswer: {
          asksForValidOption: true,
          hasInterrupt: true,
        },
        listed: {
          containsAlias: true,
          containsConfirmationContext: true,
          containsHeader: true,
          containsRosterMapping: true,
          containsSourceId: true,
          containsValidation: true,
          outcome: "listed",
        },
        oldIdentityContextPreserved: { alias: true, roster: true },
        originHistoryPreserved: { alias: true, roster: true },
        repeatedAliasForget: "not_found",
        restoredAmbiguity: {
          asksToSelect: true,
          hasInterrupt: true,
        },
        restoredRosterMapping: {
          asked: true,
          mapped: {
            apiFootballPlayerId: 11,
            fmId: "fm-kane",
            mappingMethod: "user_confirmation",
            mappingStatus: "resolved",
          },
        },
        scoutingFollowUpAfterMemoryManagement: {
          kind: "team_recommendation",
          providerCallsUnchanged: true,
          source: "saved",
        },
        setupConfirmed: {
          alias: "resolved",
          roster: {
            apiFootballPlayerId: 11,
            fmId: "fm-kane",
            mappingMethod: "user_confirmation",
            mappingStatus: "resolved",
          },
        },
        unrelatedRecord: { confirmed: true, sourceIds: ["fm-haaland"] },
        validAmbiguity: { hasInterrupt: true, restoredInterrupt: true },
      });
    } finally {
      await session.close();
    }
  }, 180_000);

  it("resolves a corrected alias replacement through a restarted identity confirmation", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/persistence-agent.ts:agent"
    );

    const { baseUrl } = session;

    try {
      const correctionThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        correctionThread.thread_id,
        "Look up 凯恩"
      );
      await postJson(
        baseUrl,
        `/threads/${correctionThread.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          command: { resume: { candidateId: "reep:canonical:kane" } },
        })
      );

      const originalThread = await getAgentThreadState(
        baseUrl,
        correctionThread.thread_id
      );

      const secondAliasThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        secondAliasThread.thread_id,
        "Look up Kane"
      );

      const secondAliasPending = await getAgentThreadState(
        baseUrl,
        secondAliasThread.thread_id
      );

      await postJson(
        baseUrl,
        `/threads/${secondAliasThread.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          command: { resume: { candidateId: "reep:canonical:kane" } },
        })
      );

      const secondAliasOriginalThread = await getAgentThreadState(
        baseUrl,
        secondAliasThread.thread_id
      );

      await runPlayerLookup(
        baseUrl,
        correctionThread.thread_id,
        "Correct the remembered alias Harry Kane to Replacement Candidate"
      );

      const pending = await getAgentThreadState(
        baseUrl,
        correctionThread.thread_id
      );

      await session.restart();

      const restoredTargetPending = await getAgentThreadState(
        baseUrl,
        correctionThread.thread_id
      );

      const aliasTargetOption = memoryForgetOptionLabel(
        restoredTargetPending,
        "称呼“Kane”"
      );

      if (aliasTargetOption === undefined) {
        throw new Error("The resumed correction lost its alias target option.");
      }

      await postJson(
        baseUrl,
        `/threads/${correctionThread.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({ assistant_id: "agent", command: { resume: "99" } })
      );

      const invalidTargetAnswer = await getAgentThreadState(
        baseUrl,
        correctionThread.thread_id
      );

      const aliasTargetOptionAfterInvalid = memoryForgetOptionLabel(
        invalidTargetAnswer,
        "称呼“Kane”"
      );

      if (aliasTargetOptionAfterInvalid === undefined) {
        throw new Error("An invalid target answer discarded the correction.");
      }

      await postJson(
        baseUrl,
        `/threads/${correctionThread.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          command: { resume: aliasTargetOptionAfterInvalid },
        })
      );

      const pendingReplacement = await getAgentThreadState(
        baseUrl,
        correctionThread.thread_id
      );

      await session.restart();

      const restoredReplacementPending = await getAgentThreadState(
        baseUrl,
        correctionThread.thread_id
      );

      const replacementCandidates =
        restoredReplacementPending.values.request.players?.[0]?.resolution
          ?.candidates ?? [];

      const replacementCandidate = replacementCandidates.find(
        ({ candidateId }) => candidateId === "reep:canonical:replacement-one"
      );

      if (replacementCandidate === undefined) {
        throw new Error(
          `The corrected replacement candidate was not offered: ${JSON.stringify(
            {
              outcome: restoredReplacementPending.values.outcome,
              pending: restoredReplacementPending.values.pendingClarification,
              request: restoredReplacementPending.values.request,
            }
          )}`
        );
      }

      await postJson(
        baseUrl,
        `/threads/${correctionThread.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          command: {
            resume: { candidateId: replacementCandidate.candidateId },
          },
        })
      );

      const corrected = await getAgentThreadState(
        baseUrl,
        correctionThread.thread_id
      );

      const secondAliasAfterCorrection = await getAgentThreadState(
        baseUrl,
        secondAliasThread.thread_id
      );

      const freshThread = await createAgentThread(baseUrl);
      await runPlayerLookup(baseUrl, freshThread.thread_id, "Look up Kane");

      const freshResolution = await getAgentThreadState(
        baseUrl,
        freshThread.thread_id
      );

      const freshOriginalAliasThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        freshOriginalAliasThread.thread_id,
        "Look up 凯恩"
      );

      const freshOriginalAlias = await getAgentThreadState(
        baseUrl,
        freshOriginalAliasThread.thread_id
      );

      const invalidCorrectionThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        invalidCorrectionThread.thread_id,
        "Correct the remembered alias Harry Kane to Replacement Candidate"
      );
      await postJson(
        baseUrl,
        `/threads/${invalidCorrectionThread.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          command: { resume: "99" },
        })
      );

      const invalidCorrection = await getAgentThreadState(
        baseUrl,
        invalidCorrectionThread.thread_id
      );

      const afterInvalidCorrectionThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        afterInvalidCorrectionThread.thread_id,
        "Look up Kane"
      );

      const afterInvalidCorrection = await getAgentThreadState(
        baseUrl,
        afterInvalidCorrectionThread.thread_id
      );

      const cancelledCorrectionThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        cancelledCorrectionThread.thread_id,
        "Correct the remembered alias Harry Kane to Replacement Candidate"
      );
      await postJson(
        baseUrl,
        `/threads/${cancelledCorrectionThread.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          command: { resume: "取消" },
        })
      );

      const cancelledCorrection = await getAgentThreadState(
        baseUrl,
        cancelledCorrectionThread.thread_id
      );

      const afterCancelledCorrectionThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        afterCancelledCorrectionThread.thread_id,
        "Look up Kane"
      );

      const afterCancelledCorrection = await getAgentThreadState(
        baseUrl,
        afterCancelledCorrectionThread.thread_id
      );

      const originalAlias = AgentState.parse(
        originalThread.values
      ).conversationContext.playerAliases.find(
        ({ mention }) => mention === "凯恩"
      );

      const correctedAlias = AgentState.parse(
        corrected.values
      ).conversationContext.playerAliases.find(
        ({ mention }) => mention === "凯恩"
      );

      expect({
        cancelledCorrectionOutcome: cancelledCorrection.values.outcome?.status,
        cancelledCorrectionPreservesReplacement: resolvedIdentitySelection(
          afterCancelledCorrection
        ).selectedCandidateId,
        correctedAliasIdentity:
          correctedAlias?.reference.candidate.canonicalIdentityId,
        correctedTargetThreadIdentity: AgentState.parse(
          secondAliasAfterCorrection.values
        ).conversationContext.playerAliases.find(
          ({ mention }) => mention === "Kane"
        )?.reference.candidate.canonicalIdentityId,
        correctionOutcome: corrected.values.outcome?.status,
        freshOriginalAliasIdentity:
          resolvedIdentitySelection(freshOriginalAlias).selectedCandidateId,
        freshResolution: resolvedIdentitySelection(freshResolution),
        freshThreadInterrupt:
          clarificationDetails(freshResolution).hasInterrupt,
        invalidCorrectionOutcome: invalidCorrection.values.outcome?.status,
        invalidCorrectionPreservesReplacement: resolvedIdentitySelection(
          afterInvalidCorrection
        ).selectedCandidateId,
        invalidTargetAnswerAsksAgain: clarificationDetails(
          invalidTargetAnswer
        ).question?.includes("请选择要纠正的那一个"),
        invalidTargetAnswerHasInterrupt:
          clarificationDetails(invalidTargetAnswer).hasInterrupt,
        originalAliasIdentity:
          originalAlias?.reference.candidate.canonicalIdentityId,
        originalTargetThreadIdentity: AgentState.parse(
          secondAliasOriginalThread.values
        ).conversationContext.playerAliases.find(
          ({ mention }) => mention === "Kane"
        )?.reference.candidate.canonicalIdentityId,
        restoredReplacementInterrupt: clarificationDetails(
          restoredReplacementPending
        ).hasInterrupt,
        restoredTargetInterrupt: clarificationDetails(restoredTargetPending)
          .hasInterrupt,
        secondAliasAsked: clarificationDetails(secondAliasPending).hasInterrupt,
        waitingForAliasTarget: clarificationDetails(pending).hasInterrupt,
        waitingForReplacement:
          clarificationDetails(pendingReplacement).hasInterrupt,
      }).toStrictEqual({
        cancelledCorrectionOutcome: "cancelled",
        cancelledCorrectionPreservesReplacement:
          "reep:canonical:replacement-one",
        correctedAliasIdentity: "canonical:kane",
        correctedTargetThreadIdentity: "canonical:kane",
        correctionOutcome: "corrected",
        freshOriginalAliasIdentity: "reep:canonical:kane",
        freshResolution: {
          selectedCandidateId: "reep:canonical:replacement-one",
          sourceRecords: [
            {
              canonicalIdentityId: "canonical:replacement-one",
              identityVerified: true,
              provider: "fm",
              sourceId: "fm-replacement-one",
            },
          ],
          status: "resolved",
        },
        freshThreadInterrupt: false,
        invalidCorrectionOutcome: "failed",
        invalidCorrectionPreservesReplacement: "reep:canonical:replacement-one",
        invalidTargetAnswerAsksAgain: true,
        invalidTargetAnswerHasInterrupt: true,
        originalAliasIdentity: "canonical:kane",
        originalTargetThreadIdentity: "canonical:kane",
        restoredReplacementInterrupt: true,
        restoredTargetInterrupt: true,
        secondAliasAsked: true,
        waitingForAliasTarget: true,
        waitingForReplacement: true,
      });
    } finally {
      await session.close();
    }
  }, 180_000);

  it("clears both player-memory record kinds only after restarted explicit confirmation", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/persistence-agent.ts:agent"
    );

    const { baseUrl } = session;

    try {
      const aliasThread = await createAgentThread(baseUrl);
      await runPlayerLookup(baseUrl, aliasThread.thread_id, "Look up 凯恩");
      await resumeAgentRun(baseUrl, aliasThread.thread_id, {
        candidateId: "reep:canonical:kane",
      });

      const rosterThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        rosterThread.thread_id,
        "Recommend a striker for Roster Memory Club"
      );
      await resumeAgentRun(baseUrl, rosterThread.thread_id, "1");

      await putJson(
        baseUrl,
        "/store/items",
        JSON.stringify({
          key: "keep-through-clear",
          namespace: ["tactiscout", "local-user", "unrelated"],
          value: { confirmed: true, sourceIds: ["fm-haaland"] },
        })
      );

      const clearThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        clearThread.thread_id,
        "Clear all player memories"
      );
      const pending = await getAgentThreadState(baseUrl, clearThread.thread_id);
      await session.restart();

      const restoredPending = await getAgentThreadState(
        baseUrl,
        clearThread.thread_id
      );

      await resumeAgentRun(baseUrl, clearThread.thread_id, "maybe");

      const invalidAnswer = await getAgentThreadState(
        baseUrl,
        clearThread.thread_id
      );

      await resumeAgentRun(baseUrl, clearThread.thread_id, "取消");

      const cancelled = await getAgentThreadState(
        baseUrl,
        clearThread.thread_id
      );

      const verifyThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        verifyThread.thread_id,
        "Show remembered player aliases and mappings"
      );

      const memoriesAfterCancel = await getAgentThreadState(
        baseUrl,
        verifyThread.thread_id
      );

      await runPlayerLookup(
        baseUrl,
        clearThread.thread_id,
        "Clear all player memories"
      );

      const pendingSecondClear = await getAgentThreadState(
        baseUrl,
        clearThread.thread_id
      );

      await session.restart();

      const restoredSecondClear = await getAgentThreadState(
        baseUrl,
        clearThread.thread_id
      );

      await resumeAgentRun(baseUrl, clearThread.thread_id, "确认");
      const cleared = await getAgentThreadState(baseUrl, clearThread.thread_id);

      await runPlayerLookup(
        baseUrl,
        clearThread.thread_id,
        "Clear all player memories"
      );

      const repeatedClear = await getAgentThreadState(
        baseUrl,
        clearThread.thread_id
      );

      const emptyThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        emptyThread.thread_id,
        "Show remembered player aliases and mappings"
      );

      const emptyList = await getAgentThreadState(
        baseUrl,
        emptyThread.thread_id
      );

      const freshIdentityThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        freshIdentityThread.thread_id,
        "Look up 凯恩"
      );

      const freshIdentity = await getAgentThreadState(
        baseUrl,
        freshIdentityThread.thread_id
      );

      const freshRosterThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        freshRosterThread.thread_id,
        "Recommend a striker for Roster Memory Club"
      );

      const freshRoster = await getAgentThreadState(
        baseUrl,
        freshRosterThread.thread_id
      );

      const aliasAfterClear = await getAgentThreadState(
        baseUrl,
        aliasThread.thread_id
      );

      const rosterAfterClear = await getAgentThreadState(
        baseUrl,
        rosterThread.thread_id
      );

      const unrelatedRecord = await requestJson(
        baseUrl,
        "/store/items?namespace=tactiscout.local-user.unrelated&key=keep-through-clear",
        storeItemSchema
      );

      expect({
        cancelledOutcome: cancelled.values.outcome?.status,
        clearScopeAfterRestart: clarificationDetails(restoredPending).question,
        clearScopeContainsAliasCount:
          clarificationDetails(pending).question?.includes("称呼/来源组 1 条"),
        clearedOutcome: cleared.values.outcome?.status,
        emptyList: latestAssistantText(emptyList),
        freshIdentityInterrupt:
          clarificationDetails(freshIdentity).hasInterrupt,
        freshRosterMappingInterrupt:
          clarificationDetails(freshRoster).hasInterrupt,
        invalidAnswerStillPending:
          clarificationDetails(invalidAnswer).hasInterrupt,
        memoriesAfterCancel: {
          containsAlias:
            latestAssistantText(memoriesAfterCancel).includes("凯恩"),
          containsRoster:
            latestAssistantText(memoriesAfterCancel).includes(
              "API-Football #11"
            ),
        },
        oldAliasStillLocal:
          resolvedIdentitySelection(aliasAfterClear).selectedCandidateId,
        oldRosterStillLocal: rosterMemberFactsFromState(rosterAfterClear),
        pendingAfterInvalidQuestionAsksConfirm:
          clarificationDetails(invalidAnswer).question?.includes(
            "回复“确认”执行清空"
          ),
        pendingSecondClear:
          clarificationDetails(pendingSecondClear).hasInterrupt,
        repeatedClear: {
          hasInterrupt: clarificationDetails(repeatedClear).hasInterrupt,
          outcome: repeatedClear.values.outcome?.status,
        },
        restoredSecondClear:
          clarificationDetails(restoredSecondClear).hasInterrupt,
        unrelatedRecord: unrelatedRecord.value,
      }).toStrictEqual({
        cancelledOutcome: "cancelled",
        clearScopeAfterRestart: clarificationDetails(pending).question,
        clearScopeContainsAliasCount: true,
        clearedOutcome: "cleared",
        emptyList: "当前没有已记住的球员称呼或阵容映射。",
        freshIdentityInterrupt: true,
        freshRosterMappingInterrupt: true,
        invalidAnswerStillPending: true,
        memoriesAfterCancel: { containsAlias: true, containsRoster: true },
        oldAliasStillLocal: "reep:canonical:kane",
        oldRosterStillLocal: {
          apiFootballPlayerId: 11,
          fmId: "fm-kane",
          mappingMethod: "user_confirmation",
          mappingStatus: "resolved",
        },
        pendingAfterInvalidQuestionAsksConfirm: true,
        pendingSecondClear: true,
        repeatedClear: { hasInterrupt: false, outcome: "cleared" },
        restoredSecondClear: true,
        unrelatedRecord: { confirmed: true, sourceIds: ["fm-haaland"] },
      });

      expect(clarificationDetails(pending).question).toContain("阵容映射 1 条");
    } finally {
      await session.close();
    }
  }, 180_000);

  it("blocks an old pending interrupt after State version mismatch without losing history", async () => {
    const session = await startDevServerSession();
    const { baseUrl, gateway } = session;

    try {
      const thread = await createAgentThread(baseUrl);
      await runPlayerLookup(baseUrl, thread.thread_id, "Look up 凯恩");
      const pending = await getAgentThreadState(baseUrl, thread.thread_id);

      await postJson(
        baseUrl,
        `/threads/${thread.thread_id}/state`,
        waitResponseSchema,
        JSON.stringify({ values: { stateSchemaVersion: 0 } })
      );

      await session.restart();
      const restored = await getAgentThreadState(baseUrl, thread.thread_id);
      const modelCallsBeforeResume = gateway.calls().length;

      await resumeAgentRun(baseUrl, thread.thread_id, {
        candidateId: "reep:canonical:kane",
      });

      const incompatible = await getAgentThreadState(baseUrl, thread.thread_id);
      const modelCallsAfterResume = gateway.calls().length;

      const freshThread = await createAgentThread(baseUrl);
      await runPlayerLookup(baseUrl, freshThread.thread_id, "Look up 凯恩");

      const freshThreadState = await getAgentThreadState(
        baseUrl,
        freshThread.thread_id
      );

      expect({
        currentVersion: pending.values.stateSchemaVersion,
        freshThreadNeedsConfirmation:
          clarificationDetails(freshThreadState).hasInterrupt,
        incompatibleOutcome: incompatible.values.outcome,
        modelCallsUnchangedOnResume:
          modelCallsAfterResume === modelCallsBeforeResume,
        oldIdentityStillUnresolved:
          incompatible.values.request.players?.[0]?.resolution?.status,
        oldVersion: incompatible.values.stateSchemaVersion,
        originalMessageRetained: incompatible.values.messages.some(
          ({ content }) => content === "Look up 凯恩"
        ),
        restartRestoredPendingQuestion:
          clarificationDetails(restored).question ===
          clarificationDetails(pending).question,
      }).toStrictEqual({
        currentVersion: 1,
        freshThreadNeedsConfirmation: true,
        incompatibleOutcome: {
          kind: "state_compatibility",
          resultJson: JSON.stringify({ currentVersion: 1, storedVersion: 0 }),
          status: "incompatible",
        },
        modelCallsUnchangedOnResume: true,
        oldIdentityStillUnresolved: "needs_confirmation",
        oldVersion: 0,
        originalMessageRetained: true,
        restartRestoredPendingQuestion: true,
      });
    } finally {
      await session.close();
    }
  }, 180_000);

  it("revalidates alias and roster memories after the current Reep links change", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/persistence-agent.ts:agent"
    );

    const { baseUrl, gateway, sourceFixturePaths } = session;

    try {
      const aliasThread = await createAgentThread(baseUrl);

      await runPlayerLookup(baseUrl, aliasThread.thread_id, "Look up Kane");

      const aliasPending = await getAgentThreadState(
        baseUrl,
        aliasThread.thread_id
      );

      await resumeAgentRun(baseUrl, aliasThread.thread_id, {
        candidateId: "reep:canonical:kane",
      });

      const confirmedAlias = await getAgentThreadState(
        baseUrl,
        aliasThread.thread_id
      );

      const rosterThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        rosterThread.thread_id,
        "Recommend a striker for Roster Memory Club"
      );

      const rosterPending = await getAgentThreadState(
        baseUrl,
        rosterThread.thread_id
      );

      await resumeAgentRun(baseUrl, rosterThread.thread_id, "1");

      const confirmedRoster = await getAgentThreadState(
        baseUrl,
        rosterThread.thread_id
      );

      changeKaneRegistryLink(sourceFixturePaths.reepDatabasePath);

      const providerCallsBeforeRestart = gateway.events().length;
      const modelCallsBeforeRestart = gateway.calls().length;

      await session.restart();

      const providerCallsAfterRestart = gateway.events().length;
      const modelCallsAfterRestart = gateway.calls().length;

      const freshAliasThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        freshAliasThread.thread_id,
        "Look up Kane"
      );

      const staleAlias = await getAgentThreadState(
        baseUrl,
        freshAliasThread.thread_id
      );

      const oldThreadRevalidatedAlias = await revalidatePlayerAliasInThread(
        baseUrl,
        aliasThread.thread_id
      );

      const freshRosterThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        freshRosterThread.thread_id,
        "Recommend a striker for Roster Memory Club"
      );

      const staleRoster = await getAgentThreadState(
        baseUrl,
        freshRosterThread.thread_id
      );

      const listThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        listThread.thread_id,
        "Show remembered player aliases and mappings"
      );

      const listedMemory = await getAgentThreadState(
        baseUrl,
        listThread.thread_id
      );

      const restoredAliasThread = await getAgentThreadState(
        baseUrl,
        aliasThread.thread_id
      );

      const restoredRosterThread = await getAgentThreadState(
        baseUrl,
        rosterThread.thread_id
      );

      expect({
        aliasAskedAgain: clarificationDetails(staleAlias).hasInterrupt,
        aliasCanonicalCandidate:
          staleAlias.values.request.players?.[0]?.resolution?.candidates?.[0]
            ?.canonicalIdentityId,
        aliasSelectedCandidate:
          staleAlias.values.request.players?.[0]?.resolution
            ?.selectedCandidateId,
        aliasStoredAsUnverified:
          latestAssistantText(listedMemory).includes("需要重新确认"),
        memoriesRetained: latestAssistantText(listedMemory).includes("Kane"),
        oldAliasReferencePreserved: isDeepStrictEqual(
          AgentState.parse(
            confirmedAlias.values
          ).conversationContext.playerAliases.find(
            ({ mention }) => mention === "Kane"
          )?.reference.referenceId,
          AgentState.parse(
            restoredAliasThread.values
          ).conversationContext.playerAliases.find(
            ({ mention }) => mention === "Kane"
          )?.reference.referenceId
        ),
        oldRosterMappingPreserved: isDeepStrictEqual(
          rosterMemberFactsFromState(confirmedRoster),
          rosterMemberFactsFromState(restoredRosterThread)
        ),
        oldRosterSnapshotPreserved: isDeepStrictEqual(
          workflowSnapshots(confirmedRoster),
          workflowSnapshots(restoredRosterThread)
        ),
        oldThreadAsksBeforeNewExecution: clarificationDetails(
          oldThreadRevalidatedAlias
        ).hasInterrupt,
        oldThreadDidNotAutoSelectNewIdentity:
          oldThreadRevalidatedAlias.values.request.players?.[0]?.resolution
            ?.selectedCandidateId === null,
        oldThreadNewIdentityCandidate:
          oldThreadRevalidatedAlias.values.request.players?.[0]?.resolution
            ?.candidates?.[0]?.canonicalIdentityId,
        pendingAliasRestored: clarificationDetails(aliasPending).hasInterrupt,
        pendingRosterRestored: clarificationDetails(rosterPending).hasInterrupt,
        rosterAskedAgain: clarificationDetails(staleRoster).hasInterrupt,
        rosterMappingStatus:
          rosterMemberFactsFromState(staleRoster).mappingStatus,
        rosterStillListedAsConflicting: rosterMemoryIsShownAsConflicting(
          latestAssistantText(listedMemory)
        ),
        startMadeNoNewExternalCalls: providerAndModelCallCountsAreUnchanged(
          providerCallsBeforeRestart,
          providerCallsAfterRestart,
          modelCallsBeforeRestart,
          modelCallsAfterRestart
        ),
      }).toStrictEqual({
        aliasAskedAgain: true,
        aliasCanonicalCandidate: "canonical:haaland",
        aliasSelectedCandidate: null,
        aliasStoredAsUnverified: true,
        memoriesRetained: true,
        oldAliasReferencePreserved: true,
        oldRosterMappingPreserved: true,
        oldRosterSnapshotPreserved: true,
        oldThreadAsksBeforeNewExecution: true,
        oldThreadDidNotAutoSelectNewIdentity: true,
        oldThreadNewIdentityCandidate: "canonical:haaland",
        pendingAliasRestored: true,
        pendingRosterRestored: true,
        rosterAskedAgain: true,
        rosterMappingStatus: "pending",
        rosterStillListedAsConflicting: true,
        startMadeNoNewExternalCalls: true,
      });
    } finally {
      await session.close();
    }
  }, 180_000);

  it("reconfirms a remembered cross-provider identity after restart when one source ID disappears", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/persistence-agent.ts:agent"
    );

    const { baseUrl, sourceFixturePaths } = session;

    try {
      addKaneUnderstatSource(
        sourceFixturePaths.understatDatabasePath,
        sourceFixturePaths.reepDatabasePath
      );

      const confirmationThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        confirmationThread.thread_id,
        "Look up Kane"
      );

      const pending = await getAgentThreadState(
        baseUrl,
        confirmationThread.thread_id
      );

      await resumeAgentRun(baseUrl, confirmationThread.thread_id, {
        candidateId: "reep:canonical:kane",
      });

      const confirmed = await getAgentThreadState(
        baseUrl,
        confirmationThread.thread_id
      );

      removeKaneUnderstatSource(sourceFixturePaths.understatDatabasePath);
      await session.restart();

      const freshThread = await createAgentThread(baseUrl);
      await runPlayerLookup(baseUrl, freshThread.thread_id, "Look up Kane");

      const stale = await getAgentThreadState(baseUrl, freshThread.thread_id);

      const listThread = await createAgentThread(baseUrl);
      await runPlayerLookup(
        baseUrl,
        listThread.thread_id,
        "Show remembered player aliases and mappings"
      );

      const listed = await getAgentThreadState(baseUrl, listThread.thread_id);

      const currentCandidate =
        stale.values.request.players?.[0]?.resolution?.candidates?.[0];

      expect({
        confirmedSourceIds: resolvedIdentitySelection(confirmed)
          .sourceRecords.map(({ sourceId }) => sourceId)
          .toSorted(),
        freshCandidateSourceIds:
          currentCandidate?.records
            .map(({ sourceId }) => sourceId)
            .toSorted() ?? [],
        freshInterrupt: clarificationDetails(stale).hasInterrupt,
        freshSelectedCandidateId:
          stale.values.request.players?.[0]?.resolution?.selectedCandidateId,
        memoryListsRemovedSource: latestAssistantText(listed).includes(
          "understat understat-kane"
        ),
        memoryMarkedForConfirmation: latestAssistantText(listed).includes(
          "资料已变化，需要重新确认"
        ),
        pendingBeforeConfirmation: clarificationDetails(pending).hasInterrupt,
      }).toStrictEqual({
        confirmedSourceIds: ["fm-kane", "understat-kane"],
        freshCandidateSourceIds: ["fm-kane"],
        freshInterrupt: true,
        freshSelectedCandidateId: null,
        memoryListsRemovedSource: true,
        memoryMarkedForConfirmation: true,
        pendingBeforeConfirmation: true,
      });
    } finally {
      await session.close();
    }
  }, 180_000);

  it("restores workflow snapshots and a pending clarification after a normal restart", async () => {
    const session = await startDevServerSession();
    const { baseUrl, gateway } = session;

    try {
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
            stateSchemaVersion: agentStateSchemaVersion,
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
                {
                  attempts: 0,
                  lookupName: "Erling Haaland",
                  mention: "Haaland",
                  recommendationRole: "reference",
                  referenceScope: "explicit",
                  referenceTargetMention: null,
                  resolution: {
                    candidateCount: 1,
                    candidates: [haaland.candidate],
                    candidatesTruncated: false,
                    canonicalIdentityId: null,
                    clarificationMessage: null,
                    mention: "Haaland",
                    selectedCandidateId: haaland.candidate.candidateId,
                    selectedName: haaland.candidate.name,
                    status: "resolved",
                  },
                },
              ],
              processedMessageId: "identity-question",
              teams: [],
            },
            stateSchemaVersion: agentStateSchemaVersion,
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
              constraints: [
                { name: "maximum_age", value: "34" },
                { name: "minimum_current_ability", value: "130" },
                { name: "minimum_potential_ability", value: "150" },
              ],
              kind: "team_recommendation",
              players: [],
              processedMessageId: "roster-question",
              recommendationAction: "replace",
              teamRecommendation: {
                includePotential: true,
                maxAge: 34,
                minimumCurrentAbility: 130,
                minimumPotentialAbility: 150,
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
            stateSchemaVersion: agentStateSchemaVersion,
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

      await session.restart();
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

      const identityResumeRun = await postJson(
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

      if (
        resumedIdentity.values.request.players?.[0]?.resolution?.status !==
        "resolved"
      ) {
        throw new Error(
          JSON.stringify({ identityResumeRun, resumedIdentity }, null, 2)
        );
      }

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
        identity: clarificationDetails(identityInterruptedState),
        roster: clarificationDetails(rosterInterruptedState),
        startupModelCalls: callsAfterFirstStartup,
      }).toStrictEqual({
        identity: {
          hasInterrupt: true,
          question: "Which player do you mean by 凯恩?",
        },
        roster: {
          hasInterrupt: true,
          question: "Choose the FM profile for Harry Kane.",
        },
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
            ?.resultJson ?? "",
        lookup:
          restoredSnapshot.values.conversationContext.activeLookup
            ?.resultJson ?? "",
        outcome: restoredSnapshot.values.outcome,
        recommendation:
          restoredSnapshot.values.conversationContext.activeRecommendation
            ?.resultJson ?? "",
        savedAnswerUsedSnapshot,
        team:
          restoredSnapshot.values.conversationContext.activeTeamRecommendation
            ?.resultJson ?? "",
      }).toStrictEqual({
        comparison: conversationContext.activeComparison.resultJson,
        lookup: conversationContext.activeLookup.resultJson,
        outcome,
        recommendation: conversationContext.activeRecommendation.resultJson,
        savedAnswerUsedSnapshot,
        team: conversationContext.activeTeamRecommendation.resultJson,
      });
      expect({
        identity: clarificationDetails(restoredIdentity),
        memory: restoredMemory.value,
        roster: clarificationDetails(restoredRoster),
      }).toStrictEqual({
        identity: {
          hasInterrupt: true,
          question: "Which player do you mean by 凯恩?",
        },
        memory: { confirmed: true, sourceIds: ["fm-kane"] },
        roster: {
          hasInterrupt: true,
          question: "Choose the FM profile for Harry Kane.",
        },
      });
      expect(
        resumedInterruptFacts(
          restoredIdentity,
          resumedIdentity,
          restoredRoster,
          resumedRoster
        )
      ).toStrictEqual({
        identity: {
          comparisonPlayers: ["Harry Kane", "Erling Haaland"],
          outcome: {
            kind: "player_comparison",
            resultMatchesComparison: true,
            source: "executed",
            status: "ready",
          },
          pending: null,
          priorSnapshotsPreserved: true,
          resolutionStatus: "resolved",
        },
        roster: {
          conditions: {
            constraints: [
              { name: "maximum_age", value: "34" },
              { name: "minimum_current_ability", value: "130" },
              { name: "minimum_potential_ability", value: "150" },
            ],
            filters: {
              includePotential: true,
              maxAge: 34,
              minimumCurrentAbility: 130,
              minimumPotentialAbility: 150,
              position: "stc",
              resultLimit: 2,
            },
          },
          fmId: "fm-kane",
          mappingMethod: "user_confirmation",
          outcome: {
            kind: "team_recommendation",
            source: "executed",
            status: "ready",
          },
          pending: null,
          priorSnapshotsPreserved: true,
          result: {
            fmSnapshotDate: "2025-11-23",
            retrievedAt: "2026-11-06T00:00:00.000Z",
            status: "ready",
            team: "Test Club",
          },
        },
      });
    } finally {
      await session.close();
    }
  }, 120_000);

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

      await verifyCompletedFailureWaitsForExplicitRetry({
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
