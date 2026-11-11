import { describe, expect, it } from "vitest";

import { AgentState } from "../../src/state.js";
import {
  postJson,
  startDevServerSession,
  waitResponseSchema,
} from "../fixtures/langgraph-dev-server.js";
import { managedDevServerTest } from "../fixtures/managed-dev-server-persistence.js";
import { clarificationDetails } from "../fixtures/persistence-state.js";

describe("player alias lifecycle across restart", () => {
  it("reuses an explicitly confirmed Chinese player alias across restart and thread deletion", async () => {
    const session = await startDevServerSession();
    const { baseUrl } = session;

    try {
      const threadA = await managedDevServerTest.createAgentThread(baseUrl);
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        threadA.thread_id,
        "Look up 凯恩"
      );

      const pendingA = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        threadA.thread_id
      );

      await postJson(
        baseUrl,
        `/threads/${threadA.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          command: { resume: { candidateId: "reep:canonical:kane" } },
        })
      );

      const confirmedA = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        threadA.thread_id
      );

      const deleteResponse = await fetch(
        `${baseUrl}/threads/${threadA.thread_id}`,
        { method: "DELETE" }
      );

      if (!deleteResponse.ok) {
        throw new Error(
          `Could not delete the confirmed thread: ${deleteResponse.status}`
        );
      }

      const threadB = await managedDevServerTest.createAgentThread(baseUrl);
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        threadB.thread_id,
        "Look up 凯恩"
      );

      const stateB = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        threadB.thread_id
      );

      await session.restart();
      const threadC = await managedDevServerTest.createAgentThread(baseUrl);
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        threadC.thread_id,
        "Look up 凯恩"
      );

      const stateC = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        threadC.thread_id
      );

      expect({
        confirmedA: clarificationDetails(pendingA),
        confirmedIdentity:
          managedDevServerTest.resolvedIdentitySelection(confirmedA),
        threadB: {
          clarification: clarificationDetails(stateB),
          identity: managedDevServerTest.resolvedIdentitySelection(stateB),
        },
        threadC: {
          clarification: clarificationDetails(stateC),
          identity: managedDevServerTest.resolvedIdentitySelection(stateC),
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

  it("resolves a corrected alias replacement through a restarted identity confirmation", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/persistence-agent.ts:agent"
    );

    const { baseUrl } = session;

    try {
      const correctionThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
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

      const originalThread = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        correctionThread.thread_id
      );

      const secondAliasThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        secondAliasThread.thread_id,
        "Look up Kane"
      );

      const secondAliasPending = await managedDevServerTest.getAgentThreadState(
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

      const secondAliasOriginalThread =
        await managedDevServerTest.getAgentThreadState(
          baseUrl,
          secondAliasThread.thread_id
        );

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        correctionThread.thread_id,
        "Correct the remembered alias Harry Kane to Replacement Candidate"
      );

      const pending = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        correctionThread.thread_id
      );

      await session.restart();

      const restoredTargetPending =
        await managedDevServerTest.getAgentThreadState(
          baseUrl,
          correctionThread.thread_id
        );

      const aliasTargetOption = managedDevServerTest.memoryForgetOptionLabel(
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

      const invalidTargetAnswer =
        await managedDevServerTest.getAgentThreadState(
          baseUrl,
          correctionThread.thread_id
        );

      const aliasTargetOptionAfterInvalid =
        managedDevServerTest.memoryForgetOptionLabel(
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

      const pendingReplacement = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        correctionThread.thread_id
      );

      await session.restart();

      const restoredReplacementPending =
        await managedDevServerTest.getAgentThreadState(
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

      const corrected = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        correctionThread.thread_id
      );

      const secondAliasAfterCorrection =
        await managedDevServerTest.getAgentThreadState(
          baseUrl,
          secondAliasThread.thread_id
        );

      const freshThread = await managedDevServerTest.createAgentThread(baseUrl);
      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        freshThread.thread_id,
        "Look up Kane"
      );

      const freshResolution = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        freshThread.thread_id
      );

      const freshOriginalAliasThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        freshOriginalAliasThread.thread_id,
        "Look up 凯恩"
      );

      const freshOriginalAlias = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        freshOriginalAliasThread.thread_id
      );

      const invalidCorrectionThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
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

      const invalidCorrection = await managedDevServerTest.getAgentThreadState(
        baseUrl,
        invalidCorrectionThread.thread_id
      );

      const afterInvalidCorrectionThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        afterInvalidCorrectionThread.thread_id,
        "Look up Kane"
      );

      const afterInvalidCorrection =
        await managedDevServerTest.getAgentThreadState(
          baseUrl,
          afterInvalidCorrectionThread.thread_id
        );

      const cancelledCorrectionThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
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

      const cancelledCorrection =
        await managedDevServerTest.getAgentThreadState(
          baseUrl,
          cancelledCorrectionThread.thread_id
        );

      const afterCancelledCorrectionThread =
        await managedDevServerTest.createAgentThread(baseUrl);

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        afterCancelledCorrectionThread.thread_id,
        "Look up Kane"
      );

      const afterCancelledCorrection =
        await managedDevServerTest.getAgentThreadState(
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
        cancelledCorrectionPreservesReplacement:
          managedDevServerTest.resolvedIdentitySelection(
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
          managedDevServerTest.resolvedIdentitySelection(freshOriginalAlias)
            .selectedCandidateId,
        freshResolution:
          managedDevServerTest.resolvedIdentitySelection(freshResolution),
        freshThreadInterrupt:
          clarificationDetails(freshResolution).hasInterrupt,
        invalidCorrectionOutcome: invalidCorrection.values.outcome?.status,
        invalidCorrectionPreservesReplacement:
          managedDevServerTest.resolvedIdentitySelection(afterInvalidCorrection)
            .selectedCandidateId,
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
});
