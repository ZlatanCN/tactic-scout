import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "vitest";

import { AgentState } from "../../src/state.js";
import {
  postJson,
  startDevServerSession,
  waitResponseSchema,
} from "../fixtures/langgraph-dev-server.js";
import { managedDevServerTest } from "../fixtures/managed-dev-server-persistence.js";
import {
  clarificationDetails,
  workflowSnapshots,
} from "../fixtures/persistence-state.js";

describe("managed roster identity persistence", () => {
  it("reuses a confirmed roster mapping across threads and restart without restoring absent members", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/persistence-agent.ts:agent"
    );

    const { baseUrl, gateway, sourceFixturePaths } = session;
    const message = "Recommend a striker for Roster Memory Club";

    const createThread = async () =>
      await managedDevServerTest.createAgentThread(baseUrl);

    const readState = async (threadId: string) =>
      await managedDevServerTest.getAgentThreadState(baseUrl, threadId);

    try {
      const threadA = await createThread();
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        threadA.thread_id,
        message
      );
      const pendingA = await readState(threadA.thread_id);

      await postJson(
        baseUrl,
        `/threads/${threadA.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({ assistant_id: "agent", command: { resume: "1" } })
      );
      const completedA = await readState(threadA.thread_id);

      const mappingBeforeRestart =
        await managedDevServerTest.readRosterMemory(baseUrl);

      const threadB = await createThread();
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        threadB.thread_id,
        message
      );
      const completedB = await readState(threadB.thread_id);
      const eventsBeforeRestart = gateway.events();

      managedDevServerTest.updateFmSnapshot(sourceFixturePaths.fmDatabasePath);
      await session.restart();

      const persistedMapping =
        await managedDevServerTest.readRosterMemory(baseUrl);

      const restoredThreadB = await readState(threadB.thread_id);

      const threadC = await createThread();
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        threadC.thread_id,
        message
      );
      const completedC = await readState(threadC.thread_id);
      const eventsAfterRestartedRequest = gateway.events();

      await session.restart();

      const threadD = await createThread();
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        threadD.thread_id,
        message
      );
      const departedRoster = await readState(threadD.thread_id);

      const rosterResultDates = [completedB, completedC].map(
        managedDevServerTest.teamRecommendationDatesFromState
      );

      const recommendationFacts = [completedA, completedB, completedC].map(
        managedDevServerTest.teamRecommendationFactsFromState
      );

      expect({
        completedA: managedDevServerTest.rosterMemberFactsFromState(completedA),
        completedB: managedDevServerTest.rosterMemberFactsFromState(completedB),
        completedC: managedDevServerTest.rosterMemberFactsFromState(completedC),
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
        mappingBeforeRestart: managedDevServerTest.rosterMemoryFacts(
          mappingBeforeRestart.value
        ),
        persistedMappingUnchanged: isDeepStrictEqual(
          mappingBeforeRestart.value,
          persistedMapping.value
        ),
        recommendationFacts,
        restoredOldResultDates:
          managedDevServerTest.teamRecommendationDatesFromState(
            restoredThreadB
          ),
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
          managedDevServerTest.expectedRosterRecommendationFacts,
          managedDevServerTest.expectedRosterRecommendationFacts,
          {
            ...managedDevServerTest.expectedRosterRecommendationFacts,
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

  it("revalidates alias and roster memories after the current Reep links change", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/persistence-agent.ts:agent"
    );

    const { baseUrl, gateway, sourceFixturePaths } = session;

    try {
      const aliasThread = await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        aliasThread.thread_id,
        "Look up Kane"
      );

      const aliasPending = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        aliasThread.thread_id
      );

      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        aliasThread.thread_id,
        {
          candidateId: "reep:canonical:kane",
        }
      );

      const confirmedAlias = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        aliasThread.thread_id
      );

      const rosterThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        rosterThread.thread_id,
        "Recommend a striker for Roster Memory Club"
      );

      const rosterPending = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        rosterThread.thread_id
      );

      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        rosterThread.thread_id,
        "1"
      );

      const confirmedRoster = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        rosterThread.thread_id
      );

      managedDevServerTest.changeKaneRegistryLink(
        sourceFixturePaths.reepDatabasePath
      );

      const providerCallsBeforeRestart = gateway.events().length;
      const modelCallsBeforeRestart = gateway.calls().length;

      await session.restart();

      const providerCallsAfterRestart = gateway.events().length;
      const modelCallsAfterRestart = gateway.calls().length;

      const freshAliasThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        freshAliasThread.thread_id,
        "Look up Kane"
      );

      const staleAlias = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        freshAliasThread.thread_id
      );

      const oldThreadRevalidatedAlias =
        await managedDevServerTest.revalidatePlayerAliasInThread(
          baseUrl,
          aliasThread.thread_id
        );

      const freshRosterThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        freshRosterThread.thread_id,
        "Recommend a striker for Roster Memory Club"
      );

      const staleRoster = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        freshRosterThread.thread_id
      );

      const listThread = await managedDevServerTest.createAgentThread(baseUrl);
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        listThread.thread_id,
        "Show remembered player aliases and mappings"
      );

      const listedMemory = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        listThread.thread_id
      );

      const restoredAliasThread =
        await managedDevServerTest.getAgentThreadState(
          baseUrl,
          aliasThread.thread_id
        );

      const restoredRosterThread =
        await managedDevServerTest.getAgentThreadState(
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
        aliasStoredAsUnverified: managedDevServerTest
          .latestAssistantText(listedMemory)
          .includes("需要重新确认"),
        memoriesRetained: managedDevServerTest
          .latestAssistantText(listedMemory)
          .includes("Kane"),
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
          managedDevServerTest.rosterMemberFactsFromState(confirmedRoster),
          managedDevServerTest.rosterMemberFactsFromState(restoredRosterThread)
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
          managedDevServerTest.rosterMemberFactsFromState(staleRoster)
            .mappingStatus,
        rosterStillListedAsConflicting:
          managedDevServerTest.rosterMemoryIsShownAsConflicting(
            managedDevServerTest.latestAssistantText(listedMemory)
          ),
        startMadeNoNewExternalCalls:
          managedDevServerTest.providerAndModelCallCountsAreUnchanged(
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
      managedDevServerTest.addKaneUnderstatSource(
        sourceFixturePaths.understatDatabasePath,
        sourceFixturePaths.reepDatabasePath
      );

      const confirmationThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        confirmationThread.thread_id,
        "Look up Kane"
      );

      const pending = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        confirmationThread.thread_id
      );

      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        confirmationThread.thread_id,
        {
          candidateId: "reep:canonical:kane",
        }
      );

      const confirmed = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        confirmationThread.thread_id
      );

      managedDevServerTest.removeKaneUnderstatSource(
        sourceFixturePaths.understatDatabasePath
      );
      await session.restart();

      const freshThread = await managedDevServerTest.createAgentThread(baseUrl);
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        freshThread.thread_id,
        "Look up Kane"
      );

      const stale = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        freshThread.thread_id
      );

      const listThread = await managedDevServerTest.createAgentThread(baseUrl);
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        listThread.thread_id,
        "Show remembered player aliases and mappings"
      );

      const listed = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        listThread.thread_id
      );

      const currentCandidate =
        stale.values.request.players?.[0]?.resolution?.candidates?.[0];

      expect({
        confirmedSourceIds: managedDevServerTest
          .resolvedIdentitySelection(confirmed)
          .sourceRecords.map(({ sourceId }) => sourceId)
          .toSorted(),
        freshCandidateSourceIds:
          currentCandidate?.records
            .map(({ sourceId }) => sourceId)
            .toSorted() ?? [],
        freshInterrupt: clarificationDetails(stale).hasInterrupt,
        freshSelectedCandidateId:
          stale.values.request.players?.[0]?.resolution?.selectedCandidateId,
        memoryListsRemovedSource: managedDevServerTest
          .latestAssistantText(listed)
          .includes("understat understat-kane"),
        memoryMarkedForConfirmation: managedDevServerTest
          .latestAssistantText(listed)
          .includes("资料已变化，需要重新确认"),
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
});
