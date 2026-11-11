import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "vitest";

import {
  postJson,
  putJson,
  requestJson,
  startDevServerSession,
  storeItemSchema,
  waitResponseSchema,
} from "../fixtures/langgraph-dev-server.js";
import { managedDevServerTest } from "../fixtures/managed-dev-server-persistence.js";
import {
  clarificationDetails,
  workflowSnapshots,
} from "../fixtures/persistence-state.js";

describe("memory management across restart", () => {
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
      await managedDevServerTest.getAgentThreadState(baseUrl, threadId);

    try {
      const aliasThread = await managedDevServerTest.createAgentThread(baseUrl);
      await runMessage(aliasThread.thread_id, "Look up 凯恩");
      const aliasPending = await readState(aliasThread.thread_id);
      expect(clarificationDetails(aliasPending).hasInterrupt).toBeTruthy();

      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        aliasThread.thread_id,
        {
          candidateId: "reep:canonical:kane",
        }
      );

      const rosterThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await runMessage(
        rosterThread.thread_id,
        "Recommend a striker for Roster Memory Club"
      );
      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        rosterThread.thread_id,
        "1"
      );
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

      const managementThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await runMessage(
        managementThread.thread_id,
        "Show remembered player aliases and mappings"
      );
      const listed = await readState(managementThread.thread_id);

      await runMessage(managementThread.thread_id, "Forget Harry Kane");
      const ambiguous = await readState(managementThread.thread_id);
      await session.restart();
      const restoredAmbiguity = await readState(managementThread.thread_id);
      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        managementThread.thread_id,
        "99"
      );
      const invalidAnswer = await readState(managementThread.thread_id);
      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        managementThread.thread_id,
        "取消"
      );
      const cancelled = await readState(managementThread.thread_id);

      await runMessage(
        managementThread.thread_id,
        "Forget roster mapping Harry Kane"
      );

      const afterDirectRosterForget = await readState(
        managementThread.thread_id
      );

      const restoredRosterThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await runMessage(
        restoredRosterThread.thread_id,
        "Recommend a striker for Roster Memory Club"
      );

      const restoredRosterPending = await readState(
        restoredRosterThread.thread_id
      );

      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        restoredRosterThread.thread_id,
        "1"
      );

      const restoredRosterState = await readState(
        restoredRosterThread.thread_id
      );

      await runMessage(managementThread.thread_id, "Forget Harry Kane");
      const validAmbiguity = await readState(managementThread.thread_id);
      await session.restart();

      const restoredValidAmbiguity = await readState(
        managementThread.thread_id
      );

      const rosterForgetOption = managedDevServerTest.memoryForgetOptionLabel(
        restoredValidAmbiguity,
        "API-Football #11"
      );

      if (rosterForgetOption === undefined) {
        throw new Error(
          "The resumed interrupt lost its roster mapping option."
        );
      }

      await managedDevServerTest.resumeAgentRun(
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

      const freshAliasThread =
        await managedDevServerTest.createAgentThread(baseUrl);

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
          textContainsAlias: managedDevServerTest
            .latestAssistantText(afterAliasForget)
            .includes("凯恩"),
        },
        afterDirectRosterForget: afterDirectRosterForget.values.outcome?.status,
        afterResumedRosterForget: {
          outcome: afterResumedRosterForget.values.outcome?.status,
          textContainsRoster: managedDevServerTest
            .latestAssistantText(afterResumedRosterForget)
            .includes("API-Football #11"),
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
          text: managedDevServerTest.latestAssistantText(emptyList),
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
          containsAlias: managedDevServerTest
            .latestAssistantText(listed)
            .includes("凯恩"),
          containsConfirmationContext:
            managedDevServerTest
              .latestAssistantText(listed)
              .includes("确认编号") &&
            managedDevServerTest
              .latestAssistantText(listed)
              .includes(aliasThread.thread_id) &&
            managedDevServerTest
              .latestAssistantText(listed)
              .includes(rosterThread.thread_id),
          containsHeader: managedDevServerTest
            .latestAssistantText(listed)
            .includes("已记住的球员身份"),
          containsRosterMapping: managedDevServerTest
            .latestAssistantText(listed)
            .includes("API-Football #11"),
          containsSourceId: managedDevServerTest
            .latestAssistantText(listed)
            .includes("FM fm-kane"),
          containsValidation: managedDevServerTest
            .latestAssistantText(listed)
            .includes("当前资料校验通过"),
          outcome: listed.values.outcome?.status,
        },
        oldIdentityContextPreserved: {
          alias: isDeepStrictEqual(
            managedDevServerTest.resolvedIdentitySelection(aliasBeforeForget),
            managedDevServerTest.resolvedIdentitySelection(aliasAfterForget)
          ),
          roster: isDeepStrictEqual(
            managedDevServerTest.rosterMemberFactsFromState(rosterBeforeForget),
            managedDevServerTest.rosterMemberFactsFromState(rosterAfterForget)
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
          mapped:
            managedDevServerTest.rosterMemberFactsFromState(
              restoredRosterState
            ),
        },
        scoutingFollowUpAfterMemoryManagement: {
          kind: rosterBeforeForget.values.outcome?.kind,
          providerCallsUnchanged:
            providerCallsAfterMemoryFollowUp ===
            providerCallsBeforeMemoryFollowUp,
          source: rosterBeforeForget.values.outcome?.source,
        },
        setupConfirmed: {
          alias:
            managedDevServerTest.resolvedIdentitySelection(aliasBeforeForget)
              .status,
          roster: managedDevServerTest.rosterMemberFactsFromState(
            rosterAfterConfirmation
          ),
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

  it("clears both player-memory record kinds only after restarted explicit confirmation", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/persistence-agent.ts:agent"
    );

    const { baseUrl } = session;

    try {
      const aliasThread = await managedDevServerTest.createAgentThread(baseUrl);
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        aliasThread.thread_id,
        "Look up 凯恩"
      );
      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        aliasThread.thread_id,
        {
          candidateId: "reep:canonical:kane",
        }
      );

      const rosterThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        rosterThread.thread_id,
        "Recommend a striker for Roster Memory Club"
      );
      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        rosterThread.thread_id,
        "1"
      );

      await putJson(
        baseUrl,
        "/store/items",
        JSON.stringify({
          key: "keep-through-clear",
          namespace: ["tactiscout", "local-user", "unrelated"],
          value: { confirmed: true, sourceIds: ["fm-haaland"] },
        })
      );

      const clearThread = await managedDevServerTest.createAgentThread(baseUrl);
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        clearThread.thread_id,
        "Clear all player memories"
      );

      const pending = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        clearThread.thread_id
      );

      await session.restart();

      const restoredPending = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        clearThread.thread_id
      );

      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        clearThread.thread_id,
        "maybe"
      );

      const invalidAnswer = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        clearThread.thread_id
      );

      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        clearThread.thread_id,
        "取消"
      );

      const cancelled = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        clearThread.thread_id
      );

      const verifyThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        verifyThread.thread_id,
        "Show remembered player aliases and mappings"
      );

      const memoriesAfterCancel =
        await managedDevServerTest.getAgentThreadState(
          baseUrl,
          verifyThread.thread_id
        );

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        clearThread.thread_id,
        "Clear all player memories"
      );

      const pendingSecondClear = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        clearThread.thread_id
      );

      await session.restart();

      const restoredSecondClear =
        await managedDevServerTest.getAgentThreadState(
          baseUrl,
          clearThread.thread_id
        );

      await managedDevServerTest.resumeAgentRun(
        baseUrl,
        clearThread.thread_id,
        "确认"
      );

      const cleared = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        clearThread.thread_id
      );

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        clearThread.thread_id,
        "Clear all player memories"
      );

      const repeatedClear = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        clearThread.thread_id
      );

      const emptyThread = await managedDevServerTest.createAgentThread(baseUrl);
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        emptyThread.thread_id,
        "Show remembered player aliases and mappings"
      );

      const emptyList = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        emptyThread.thread_id
      );

      const freshIdentityThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        freshIdentityThread.thread_id,
        "Look up 凯恩"
      );

      const freshIdentity = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        freshIdentityThread.thread_id
      );

      const freshRosterThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        freshRosterThread.thread_id,
        "Recommend a striker for Roster Memory Club"
      );

      const freshRoster = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        freshRosterThread.thread_id
      );

      const aliasAfterClear = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        aliasThread.thread_id
      );

      const rosterAfterClear = await managedDevServerTest.getAgentThreadState(
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
        emptyList: managedDevServerTest.latestAssistantText(emptyList),
        freshIdentityInterrupt:
          clarificationDetails(freshIdentity).hasInterrupt,
        freshRosterMappingInterrupt:
          clarificationDetails(freshRoster).hasInterrupt,
        invalidAnswerStillPending:
          clarificationDetails(invalidAnswer).hasInterrupt,
        memoriesAfterCancel: {
          containsAlias: managedDevServerTest
            .latestAssistantText(memoriesAfterCancel)
            .includes("凯恩"),
          containsRoster: managedDevServerTest
            .latestAssistantText(memoriesAfterCancel)
            .includes("API-Football #11"),
        },
        oldAliasStillLocal:
          managedDevServerTest.resolvedIdentitySelection(aliasAfterClear)
            .selectedCandidateId,
        oldRosterStillLocal:
          managedDevServerTest.rosterMemberFactsFromState(rosterAfterClear),
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
});
