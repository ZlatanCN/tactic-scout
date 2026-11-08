import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { comparisonResultSchema } from "../src/player-data/compare-records.js";
import { recommendationResultSchema } from "../src/player-data/recommend-players.js";
import { AgentState } from "../src/state.js";
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
    fmSnapshotDate: result.fmSnapshotDate,
    rankingBasis: result.rankingBasis,
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
  fmSnapshotDate: "2025-11-23",
  rankingBasis: "equal_weight_mean_of_position_capable_squad_profiles",
  retrievedAt: "2026-11-07T00:00:00.000Z",
  status: "ready",
};

const runPlayerLookup = async (
  baseUrl: string,
  threadId: string,
  message: string
) =>
  await postJson(
    baseUrl,
    `/threads/${threadId}/runs/wait`,
    waitResponseSchema,
    JSON.stringify({
      assistant_id: "agent",
      input: { messages: [{ content: message, role: "user" }] },
    })
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
  it("reuses a confirmed roster mapping across threads and restart without restoring absent members", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/persistence-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;
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

      await session.restart();

      const persistedMapping = await readRosterMemory(baseUrl);

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
          expectedRosterRecommendationFacts,
        ],
      });

      expect(
        rosterResultDates.map((dates) => dates?.fmSnapshotDate ?? null)
      ).toStrictEqual(["2025-11-23", "2025-11-23"]);
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
