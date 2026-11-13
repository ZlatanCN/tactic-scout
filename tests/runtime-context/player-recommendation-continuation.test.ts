import { HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it } from "vitest";

import { contextProcessingHash } from "../../src/context-processing-state.js";
import { AgentState } from "../../src/state.js";
import { agentGraphTest } from "../fixtures/agent-graph.js";
import { testModelOutputLimitAdapter } from "../fixtures/model-context.js";
import {
  recommendationBatchAnswer,
  playerRecommendationResultJson as resultJson,
  savedRecommendationState,
} from "../fixtures/player-recommendation-evidence-graph.js";

const recommendationEvidenceModel = () =>
  Object.assign(
    fakeModel()
      .respond(recommendationBatchAnswer)
      .respond(recommendationBatchAnswer),
    {
      getNumTokens: async (text: string) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      },
    }
  );

describe("saved player recommendation continuation", () => {
  it("continues saved recommendation evidence without reranking and grants once per message ID", async () => {
    const model = recommendationEvidenceModel();

    const graph = agentGraphTest.createAgent({
      contextProcessingAllowance: { maxAdditionalCalls: 1 },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 2400,
        maxOutputTokens: 512,
        softTriggerFraction: 0.9,
        targetFraction: 0.6,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const config = {
      configurable: { thread_id: "continue-saved-player-recommendation" },
    };

    const exhausted = AgentState.parse(
      await graph.invoke(savedRecommendationState(), config)
    );

    const continued = AgentState.parse(
      await graph.invoke(
        {
          messages: [
            new HumanMessage({
              content: "继续",
              id: "recommendation-continue-1",
            }),
          ],
        },
        config
      )
    );

    await graph.invoke(
      {
        messages: [
          new HumanMessage({
            content: "继续",
            id: "recommendation-continue-1",
          }),
        ],
      },
      config
    );

    expect({
      allowanceCalls:
        continued.contextProcessing.allowance?.consumedAdditionalCalls,
      exhaustedStatus: exhausted.playerRecommendationEvidence?.status,
      grants: continued.contextProcessing.allowance?.grants,
      modelCalls: model.callCount,
      readyBatchCount: continued.playerRecommendationEvidence?.batches.filter(
        ({ status }) => status === "ready"
      ).length,
      resultSnapshotIsPreserved:
        continued.conversationContext.activeRecommendation?.resultJson ===
        resultJson,
      sourceMessageId: continued.playerRecommendationEvidence?.sourceMessageId,
      status: continued.playerRecommendationEvidence?.status,
    }).toStrictEqual({
      allowanceCalls: 2,
      exhaustedStatus: "allowance_exhausted",
      grants: [
        {
          additionalActiveTimeMs: 120_000,
          additionalCalls: 1,
          continuationMessageId: "recommendation-continue-1",
          kind: "explain_player_recommendation_evidence",
          requestId: "message:saved-two-list-recommendation",
          sourceHash: continued.playerRecommendationEvidence?.sourceHash,
          sourceMessageId: "saved-two-list-recommendation",
        },
      ],
      modelCalls: 2,
      readyBatchCount: 2,
      resultSnapshotIsPreserved: true,
      sourceMessageId: "saved-two-list-recommendation",
      status: "complete",
    });
  });

  it("rebuilds a stale recommendation projection from the saved result before continuing", async () => {
    const model = recommendationEvidenceModel();

    const graph = agentGraphTest.createAgent({
      contextProcessingAllowance: { maxAdditionalCalls: 1 },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 2400,
        maxOutputTokens: 512,
        softTriggerFraction: 0.9,
        targetFraction: 0.6,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const original = AgentState.parse(savedRecommendationState());

    const partial = AgentState.parse(
      await graph.invoke(original, {
        configurable: { thread_id: "continue-stale-player-recommendation" },
      })
    );

    const partialEvidence = partial.playerRecommendationEvidence;

    if (partialEvidence === null) {
      throw new Error("The saved recommendation has no partial evidence.");
    }

    const originalProjections = partialEvidence.batches.map(
      ({ projectionJson }) => projectionJson
    );

    const staleState = AgentState.parse({
      ...partial,
      playerRecommendationEvidence: {
        ...partialEvidence,
        batches: partialEvidence.batches.map((batch, index) =>
          index === 0
            ? { ...batch, projectionJson: "stale projection cache" }
            : batch
        ),
        resultDigest: "stale-result-digest",
        sourceHash: "stale-cache-version",
      },
    });

    const resumed = AgentState.parse(
      await graph.invoke(
        {
          ...staleState,
          messages: [
            ...staleState.messages,
            new HumanMessage({
              content: "继续",
              id: "rebuild-stale-projection",
            }),
          ],
        },
        { configurable: { thread_id: "continue-stale-player-recommendation" } }
      )
    );

    const resumedEvidence = resumed.playerRecommendationEvidence;

    expect({
      allowanceCalls:
        resumed.contextProcessing.allowance?.consumedAdditionalCalls,
      modelCalls: model.callCount,
      projectionPlanRebuilt: originalProjections.every(
        (projection, index) =>
          resumedEvidence?.batches[index]?.projectionJson === projection
      ),
      resultDigest: resumedEvidence?.resultDigest,
      resultSnapshotPreserved:
        resumed.conversationContext.activeRecommendation?.resultJson ===
        resultJson,
      status: resumedEvidence?.status,
    }).toStrictEqual({
      allowanceCalls: 2,
      modelCalls: 2,
      projectionPlanRebuilt: true,
      resultDigest: contextProcessingHash(resultJson),
      resultSnapshotPreserved: true,
      status: "allowance_exhausted",
    });

    if (resumedEvidence === null) {
      throw new Error("The resumed recommendation evidence is missing.");
    }

    const sourceChangedAfterGrant = AgentState.parse({
      ...resumed,
      messages: resumed.messages.map((message) =>
        message instanceof HumanMessage &&
        message.id === "saved-two-list-recommendation"
          ? new HumanMessage({
              content: "Explain a changed recommendation request.",
              id: message.id,
            })
          : message
      ),
      playerRecommendationEvidence: {
        ...resumedEvidence,
        failureReason: null,
        status: "processing",
      },
    });

    const sourceChangedReplay = AgentState.parse(
      await graph.invoke(
        {
          ...sourceChangedAfterGrant,
          messages: [
            ...sourceChangedAfterGrant.messages,
            new HumanMessage({
              content: "继续",
              id: "rebuild-stale-projection",
            }),
          ],
        },
        {
          configurable: {
            thread_id: "continue-stale-player-recommendation-source-changed",
          },
        }
      )
    );

    expect({
      grantCount:
        sourceChangedReplay.contextProcessing.allowance?.grants.length,
      modelCalls: model.callCount,
      status: sourceChangedReplay.playerRecommendationEvidence?.status,
    }).toStrictEqual({ grantCount: 1, modelCalls: 2, status: "processing" });
  });

  it("settles an unknown reserved explanation batch when the same continuation ID is replayed", async () => {
    const model = recommendationEvidenceModel();

    const graph = agentGraphTest.createAgent({
      contextProcessingAllowance: { maxAdditionalCalls: 1 },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 2400,
        maxOutputTokens: 512,
        softTriggerFraction: 0.9,
        targetFraction: 0.6,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const partial = AgentState.parse(
      await graph.invoke(savedRecommendationState(), {
        configurable: { thread_id: "unknown-saved-recommendation-before" },
      })
    );

    const evidence = partial.playerRecommendationEvidence;
    const { allowance } = partial.contextProcessing;

    if (evidence === null || allowance === null) {
      throw new Error("The recommendation continuation checkpoint is missing.");
    }

    const continuationMessageId = "unknown-recommendation-continuation";

    const reservedBatchIndex = evidence.batches.findIndex(
      ({ status }) => status === "pending"
    );

    const reservedBatch = evidence.batches[reservedBatchIndex];

    if (reservedBatch === undefined) {
      throw new Error("The recommendation checkpoint has no pending batch.");
    }

    const grant = {
      additionalActiveTimeMs: 120_000,
      additionalCalls: 1,
      continuationMessageId,
      kind: "explain_player_recommendation_evidence" as const,
      requestId: evidence.requestId,
      sourceHash: evidence.sourceHash,
      sourceMessageId: evidence.sourceMessageId,
    };

    const reservation = {
      chunkIndex: reservedBatch.index,
      maxActiveTimeMs: 500,
      maxAdditionalCalls: 1,
      operation: grant.kind,
      operationId: contextProcessingHash(
        `${evidence.requestId}:${evidence.sourceHash}:batch:${reservedBatch.index}`
      ),
      sourceHash: evidence.sourceHash,
      sourceMessageId: evidence.sourceMessageId,
    };

    const unknownReservationState = AgentState.parse({
      ...partial,
      contextProcessing: {
        ...partial.contextProcessing,
        allowance: {
          ...allowance,
          grants: [...allowance.grants, grant],
          maxActiveTimeMs:
            allowance.maxActiveTimeMs + grant.additionalActiveTimeMs,
          maxAdditionalCalls:
            allowance.maxAdditionalCalls + grant.additionalCalls,
          reservation,
          reservedActiveTimeMs: reservation.maxActiveTimeMs,
        },
      },
      messages: [
        ...partial.messages,
        new HumanMessage({ content: "继续", id: continuationMessageId }),
      ],
      playerRecommendationEvidence: {
        ...evidence,
        batches: evidence.batches.map((batch) =>
          batch.index === reservedBatch.index
            ? { ...batch, status: "reserved" as const }
            : batch
        ),
        status: "processing",
      },
    });

    const settled = AgentState.parse(
      await graph.invoke(unknownReservationState, {
        configurable: { thread_id: "unknown-saved-recommendation-after" },
      })
    );

    expect({
      consumedCalls:
        settled.contextProcessing.allowance?.consumedAdditionalCalls,
      grantCount: settled.contextProcessing.allowance?.grants.length,
      modelCalls: model.callCount,
      pendingBatchStatus:
        settled.playerRecommendationEvidence?.batches[reservedBatchIndex]
          ?.status,
      reservation: settled.contextProcessing.allowance?.reservation,
      status: settled.playerRecommendationEvidence?.status,
      stopReason: settled.playerRecommendationEvidence?.failureReason,
    }).toStrictEqual({
      consumedCalls: 2,
      grantCount: 1,
      modelCalls: 1,
      pendingBatchStatus: "failed",
      reservation: null,
      status: "failed",
      stopReason: "reservation_unknown",
    });
  });
});
