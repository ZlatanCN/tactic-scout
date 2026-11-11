import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import { expect } from "vitest";
import { z } from "zod/v4";

import type { AgentState } from "../../src/state.js";
import { teamRecommendationResultSchema } from "../../src/team-data/recommendation-result.js";
import {
  apiThreadSchema,
  postJson,
  requestJson,
  threadStateSchema,
  waitResponseSchema,
} from "./langgraph-dev-server.js";
import type {
  DevServerSession,
  LocalGateway,
  ThreadState,
} from "./langgraph-dev-server.js";
import { workflowSnapshots } from "./persistence-state.js";

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

const chunkProgressFacts = (
  state: ReturnType<typeof AgentState.parse>,
  message: string,
  messageId: string
) => {
  const allowanceCalls =
    state.contextProcessing.allowance?.consumedAdditionalCalls ?? null;

  const { compaction } = state.contextProcessing;
  const chunking = compaction?.chunking;

  return {
    allProcessedChunksSaved:
      chunking?.chunks.every(({ status }) => status === "ready") ?? false,
    allowanceCalls,
    chunkCount: chunking?.chunks.length ?? 0,
    hasUnprocessedTail: Boolean(
      chunking && chunking.nextStart < chunking.sourceLength
    ),
    originalMessagePresent: state.messages.some(
      ({ content, id, type }) =>
        type === "human" && id === messageId && content === message
    ),
    status: compaction?.status ?? null,
  };
};

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

type LookupEvidenceReservationRecoveryInput = {
  baseUrl: string;
  gateway: LocalGateway;
  question: string;
  questionHash: string;
  resultDigest: string;
  resultJson: string;
  seededState: ReturnType<typeof AgentState.parse>;
  session: DevServerSession;
};

const verifyUnknownLookupEvidenceReservationAfterRestart = async ({
  baseUrl,
  gateway,
  question,
  questionHash,
  resultDigest,
  resultJson,
  seededState,
  session,
}: LookupEvidenceReservationRecoveryInput) => {
  const reservedThread = await createAgentThread(baseUrl);
  const reservedMessageId = "saved-lookup-unknown-batch-reservation";
  const reservedRequestId = `message:${reservedMessageId}`;

  const reservedSourceHash = createHash("sha256")
    .update(
      `saved:${reservedMessageId}:${resultDigest}:${questionHash}:lookup-evidence-v1`
    )
    .digest("hex");

  const { allowance } = seededState.contextProcessing;
  const evidence = seededState.lookupEvidence;

  if (allowance === null || evidence === null) {
    throw new Error("The persistence fixture needs allowance and evidence.");
  }

  const reservation = {
    chunkIndex: 1,
    maxActiveTimeMs: allowance.maxActiveTimeMs - allowance.consumedActiveTimeMs,
    maxAdditionalCalls: 1,
    operation: "explain_lookup_evidence" as const,
    operationId: createHash("sha256")
      .update(`${reservedRequestId}:${reservedSourceHash}:batch:1`)
      .digest("hex"),
    sourceHash: reservedSourceHash,
    sourceMessageId: reservedMessageId,
  };

  const reservedState = {
    ...seededState,
    contextProcessing: {
      ...seededState.contextProcessing,
      allowance: {
        ...allowance,
        requestId: reservedRequestId,
        reservation,
      },
    },
    lookupEvidence: {
      ...evidence,
      batches: evidence.batches.map((batch) =>
        batch.index === reservation.chunkIndex
          ? { ...batch, status: "reserved" as const }
          : batch
      ),
      requestId: reservedRequestId,
      sourceHash: reservedSourceHash,
      sourceMessageId: reservedMessageId,
      status: "processing" as const,
    },
    messages: [{ content: question, id: reservedMessageId, type: "human" }],
    request: {
      ...seededState.request,
      processedMessageId: reservedMessageId,
    },
  };

  await postJson(
    baseUrl,
    `/threads/${reservedThread.thread_id}/state`,
    waitResponseSchema,
    JSON.stringify({ values: reservedState })
  );
  await session.restart();

  const reservedAfterRestart = await getAgentThreadState(
    baseUrl,
    reservedThread.thread_id
  );

  expect({
    allowanceCalls:
      reservedAfterRestart.values.contextProcessing?.allowance
        ?.consumedAdditionalCalls,
    reservationOperation:
      reservedAfterRestart.values.contextProcessing?.allowance?.reservation
        ?.operation,
  }).toStrictEqual({
    allowanceCalls: 1,
    reservationOperation: "explain_lookup_evidence",
  });

  await runPlayerLookup(
    baseUrl,
    reservedThread.thread_id,
    question,
    reservedMessageId
  );

  const settledUnknown = await getAgentThreadState(
    baseUrl,
    reservedThread.thread_id
  );

  const unknownAnswer = latestAssistantText(settledUnknown);

  expect({
    activeTimeMs:
      settledUnknown.values.contextProcessing?.allowance?.consumedActiveTimeMs,
    allowanceCalls:
      settledUnknown.values.contextProcessing?.allowance
        ?.consumedAdditionalCalls,
    batchStatuses: settledUnknown.values.lookupEvidence?.batches.map(
      ({ status }) => status
    ),
    containsCompleteSnapshot: unknownAnswer.includes(resultJson),
    evidenceStatus: settledUnknown.values.lookupEvidence?.status,
    modelCalls: gateway.calls().length,
    reservation:
      settledUnknown.values.contextProcessing?.allowance?.reservation,
  }).toStrictEqual({
    activeTimeMs: 120_000,
    allowanceCalls: 2,
    batchStatuses: ["ready", "failed"],
    containsCompleteSnapshot: true,
    evidenceStatus: "failed",
    modelCalls: 1,
    reservation: null,
  });
};

const managedDevServerTest = {
  addKaneUnderstatSource,
  changeKaneRegistryLink,
  chunkProgressFacts,
  createAgentThread,
  expectedRosterRecommendationFacts,
  getAgentThreadState,
  latestAssistantText,
  memoryForgetOptionLabel,
  providerAndModelCallCountsAreUnchanged,
  readRosterMemory,
  removeKaneUnderstatSource,
  resolvedIdentitySelection,
  resumeAgentRun,
  revalidatePlayerAliasInThread,
  rosterMemberFactsFromState,
  rosterMemberFromState,
  rosterMemoryFacts,
  rosterMemoryIsShownAsConflicting,
  rosterMemoryStoreItemSchema,
  rosterMemoryStoreKey,
  runPlayerLookup,
  teamRecommendationDatesFromState,
  teamRecommendationFactsFromState,
  teamRecommendationResultFromState,
  textCompactionFacts,
  updateFmSnapshot,
  verifyCompletedFailureWaitsForExplicitRetry,
  verifyUnknownLookupEvidenceReservationAfterRestart,
};

export { managedDevServerTest };

export type { RosterMemoryStoreValue };
