import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  contextProcessingHash,
  createInitialContextProcessing,
} from "../../src/context-processing-state.js";
import { playerRecommendationEvidenceProjections } from "../../src/player-recommendation-evidence.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../src/state.js";
import { agentGraphTest } from "../fixtures/agent-graph.js";
import {
  postJson,
  startDevServerSession,
  waitResponseSchema,
} from "../fixtures/langgraph-dev-server.js";
import { managedDevServerTest } from "../fixtures/managed-dev-server-persistence.js";
import { recommendationResultData } from "../fixtures/workflow-results.js";

const savedPlayerRecommendationContinuationState = () => {
  const messageId = "persistent-saved-recommendation";

  const question =
    "Explain the saved recommendation's current and potential lists.";

  const currentCandidate = {
    age: 22,
    attributes: [],
    currentAbility: 120,
    currentDistance: 0.5,
    fmId: "fm-current",
    name: "Current Candidate",
    positionRating: 18,
    potentialAbility: 150,
    rank: 1,
    sourceRecordId: "source-current",
  };

  const potentialCandidate = {
    ...currentCandidate,
    fmId: "fm-potential",
    name: "Potential Candidate",
    rank: 1,
    sourceRecordId: "source-potential",
  };

  const resultJson = JSON.stringify(
    recommendationResultData("ready", "stc", {
      currentCandidates: [currentCandidate],
      filters: {
        includePotential: true,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        resultLimit: 1,
      },
      potentialCandidates: [potentialCandidate],
    })
  );

  const projections = playerRecommendationEvidenceProjections(
    resultJson,
    "saved",
    1
  );

  if (projections === null || projections.length !== 2) {
    throw new Error("The saved recommendation needs two evidence batches.");
  }

  const savedRequestMessage = new HumanMessage({
    content: question,
    id: messageId,
  });

  const requestId = `message:${messageId}`;
  const questionHash = contextProcessingHash(question);
  const resultDigest = contextProcessingHash(resultJson);

  const sourceHash = contextProcessingHash(
    `saved:${messageId}:${resultDigest}:${questionHash}:player-recommendation-evidence-v1`
  );

  const [currentProjection, potentialProjection] = projections;
  const currentAnswer = `${currentCandidate.rank}. ${currentCandidate.name} (FM ID ${currentCandidate.fmId}; age ${currentCandidate.age}; position rating ${currentCandidate.positionRating}; CA ${currentCandidate.currentAbility}; PA ${currentCandidate.potentialAbility}; currentDistance ${currentCandidate.currentDistance})`;

  if (currentProjection === undefined || potentialProjection === undefined) {
    throw new Error("The saved recommendation evidence batch is missing.");
  }

  const referenceCandidate = agentGraphTest.playerCandidate(
    "Synthetic Reference",
    "synthetic-reference"
  );

  return AgentState.parse({
    contextProcessing: {
      ...createInitialContextProcessing(),
      allowance: {
        consumedActiveTimeMs: 500,
        consumedAdditionalCalls: 1,
        grants: [],
        maxActiveTimeMs: 120_000,
        maxAdditionalCalls: 1,
        requestId,
        reservation: null,
        reservedActiveTimeMs: 0,
      },
    },
    conversationContext: {
      ...createInitialConversationContext(),
      activeRecommendation: {
        excludePlayers: [],
        includePotential: true,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referencePlayers: [
          agentGraphTest.conversationReferenceFromCandidate(referenceCandidate),
        ],
        resultJson,
        resultLimit: 1,
        status: "ready",
      },
    },
    messages: [savedRequestMessage],
    outcome: {
      kind: "player_recommendation",
      resultJson,
      source: "saved",
      status: "ready",
    },
    playerRecommendationEvidence: {
      batches: [
        {
          answer: currentAnswer,
          index: 0,
          projectionJson: currentProjection.projectionJson,
          recordRefs: currentProjection.recordRefs,
          status: "ready",
        },
        {
          answer: null,
          index: 1,
          projectionJson: potentialProjection.projectionJson,
          recordRefs: potentialProjection.recordRefs,
          status: "pending",
        },
      ],
      failureReason: "allowance_exhausted",
      questionHash,
      requestId,
      resultDigest,
      source: "saved",
      sourceHash,
      sourceMessageId: messageId,
      status: "allowance_exhausted",
    },
    request: {
      ...createInitialRequestState(),
      kind: "player_recommendation",
      processedMessageId: messageId,
      recommendation: {
        includePotential: true,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        needsAgeClarification: false,
        position: "stc",
        resultLimit: 1,
      },
      recommendationAction: "replace",
    },
    stateSchemaVersion: agentStateSchemaVersion,
  });
};

const uncertainRecommendationContinuationState = () => {
  const state = savedPlayerRecommendationContinuationState();
  const { allowance } = state.contextProcessing;
  const evidence = state.playerRecommendationEvidence;

  const continuationMessageId =
    "persistent-unknown-recommendation-continuation";

  if (allowance === null || evidence === null) {
    throw new Error(
      "The saved recommendation needs an allowance and evidence."
    );
  }

  const batchIndex = evidence.batches.findIndex(
    ({ status }) => status === "pending"
  );

  const batch = evidence.batches[batchIndex];

  if (batch === undefined) {
    throw new Error(
      "The saved recommendation has no pending explanation batch."
    );
  }

  const grant = {
    additionalActiveTimeMs: 120_000,
    additionalCalls: 6,
    continuationMessageId,
    kind: "explain_player_recommendation_evidence" as const,
    requestId: evidence.requestId,
    sourceHash: evidence.sourceHash,
    sourceMessageId: evidence.sourceMessageId,
  };

  const reservation = {
    chunkIndex: batch.index,
    maxActiveTimeMs: 500,
    maxAdditionalCalls: 1,
    operation: grant.kind,
    operationId: contextProcessingHash(
      `${evidence.requestId}:${evidence.sourceHash}:batch:${batch.index}`
    ),
    sourceHash: evidence.sourceHash,
    sourceMessageId: evidence.sourceMessageId,
  };

  return {
    continuationMessageId,
    state: AgentState.parse({
      ...state,
      contextProcessing: {
        ...state.contextProcessing,
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
        ...state.messages,
        new HumanMessage({ content: "继续", id: continuationMessageId }),
      ],
      playerRecommendationEvidence: {
        ...evidence,
        batches: evidence.batches.map((item) =>
          item.index === batch.index
            ? { ...item, status: "reserved" as const }
            : item
        ),
        status: "processing",
      },
    }),
  };
};

describe("saved recommendation continuation persistence", () => {
  it("resumes saved ranked data and unfinished explanation after restart", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/text-compaction-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;

    try {
      const thread = await managedDevServerTest.createAgentThread(baseUrl);

      await postJson(
        baseUrl,
        `/threads/${thread.thread_id}/state`,
        waitResponseSchema,
        JSON.stringify({ values: savedPlayerRecommendationContinuationState() })
      );

      await session.restart();

      const restored = await managedDevServerTest.getParsedAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      const callsBeforeContinue = gateway.calls().length;
      const providerEventsBeforeContinue = gateway.events();

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        "继续",
        "persistent-recommendation-continue"
      );

      const completed = await managedDevServerTest.getParsedAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      const completedThreadState =
        await managedDevServerTest.getAgentThreadState(
          baseUrl,
          thread.thread_id
        );

      const completedAnswer =
        managedDevServerTest.latestAssistantText(completedThreadState);

      const callsAfterContinue = gateway.calls().length;

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        "继续",
        "persistent-recommendation-continue"
      );

      const afterReplay = await managedDevServerTest.getParsedAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      expect({
        answerContainsBothLists: [
          "Current Candidate",
          "fm-current",
          "Potential Candidate",
          "fm-potential",
        ].every((fact) => completedAnswer.includes(fact)),
        callsAfterContinue,
        callsAfterReplay: gateway.calls().length,
        callsBeforeContinue,
        completedBatchCount:
          completed.playerRecommendationEvidence?.batches.filter(
            ({ status }) => status === "ready"
          ).length,
        evidenceStatus: completed.playerRecommendationEvidence?.status,
        grantCount: completed.contextProcessing.allowance?.grants.length,
        providerEventsAfterReplay: gateway.events(),
        providerEventsBeforeContinue,
        replayPreservedCompleteEvidence:
          afterReplay.playerRecommendationEvidence?.status === "complete",
        resultSnapshotPreserved:
          completed.conversationContext.activeRecommendation?.resultJson ===
          restored.conversationContext.activeRecommendation?.resultJson,
      }).toStrictEqual({
        answerContainsBothLists: true,
        callsAfterContinue: 1,
        callsAfterReplay: 1,
        callsBeforeContinue: 0,
        completedBatchCount: 2,
        evidenceStatus: "complete",
        grantCount: 1,
        providerEventsAfterReplay: providerEventsBeforeContinue,
        providerEventsBeforeContinue,
        replayPreservedCompleteEvidence: true,
        resultSnapshotPreserved: true,
      });
    } finally {
      await session.close();
    }
  }, 60_000);

  it("rebuilds a stale saved explanation cache from its result after restart", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/text-compaction-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;

    try {
      const thread = await managedDevServerTest.createAgentThread(baseUrl);
      const validState = savedPlayerRecommendationContinuationState();
      const evidence = validState.playerRecommendationEvidence;

      if (evidence === null) {
        throw new Error("The saved recommendation has no evidence cache.");
      }

      const expectedProjections = evidence.batches.map(
        ({ projectionJson }) => projectionJson
      );

      const staleState = AgentState.parse({
        ...validState,
        playerRecommendationEvidence: {
          ...evidence,
          batches: evidence.batches.map((batch, index) =>
            index === 0
              ? { ...batch, projectionJson: "stale projection" }
              : batch
          ),
          resultDigest: "stale-result-digest",
          sourceHash: "stale-cache-version",
        },
      });

      await postJson(
        baseUrl,
        `/threads/${thread.thread_id}/state`,
        waitResponseSchema,
        JSON.stringify({ values: staleState })
      );
      await session.restart();

      const providerEventsBeforeContinue = gateway.events();

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        "继续",
        "persistent-stale-cache-rebuild"
      );

      const completed = await managedDevServerTest.getParsedAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      expect({
        allowanceCalls:
          completed.contextProcessing.allowance?.consumedAdditionalCalls,
        grantCount: completed.contextProcessing.allowance?.grants.length,
        modelCalls: gateway.calls().length,
        projectionPlanRebuilt: expectedProjections.every(
          (projection, index) =>
            completed.playerRecommendationEvidence?.batches[index]
              ?.projectionJson === projection
        ),
        providerEvents: gateway.events(),
        resultSnapshotPreserved:
          completed.conversationContext.activeRecommendation?.resultJson ===
          validState.conversationContext.activeRecommendation?.resultJson,
        status: completed.playerRecommendationEvidence?.status,
      }).toStrictEqual({
        allowanceCalls: 3,
        grantCount: 1,
        modelCalls: 2,
        projectionPlanRebuilt: true,
        providerEvents: providerEventsBeforeContinue,
        resultSnapshotPreserved: true,
        status: "complete",
      });
    } finally {
      await session.close();
    }
  }, 60_000);

  it("settles a persisted unknown explanation reservation on explicit replay without another call", async () => {
    const session = await startDevServerSession(
      "./tests/fixtures/text-compaction-agent.ts:agent"
    );

    const { baseUrl, gateway } = session;

    try {
      const thread = await managedDevServerTest.createAgentThread(baseUrl);
      const seeded = uncertainRecommendationContinuationState();

      await postJson(
        baseUrl,
        `/threads/${thread.thread_id}/state`,
        waitResponseSchema,
        JSON.stringify({ values: seeded.state })
      );
      await session.restart();

      await managedDevServerTest.runPlayerLookup(
        baseUrl,
        thread.thread_id,
        "继续",
        seeded.continuationMessageId
      );

      const settled = await managedDevServerTest.getParsedAgentThreadState(
        baseUrl,
        thread.thread_id
      );

      expect({
        activeTimeMs: settled.contextProcessing.allowance?.consumedActiveTimeMs,
        calls: gateway.calls().length,
        grantCount: settled.contextProcessing.allowance?.grants.length,
        pendingBatchStatus:
          settled.playerRecommendationEvidence?.batches[1]?.status,
        reservation: settled.contextProcessing.allowance?.reservation,
        status: settled.playerRecommendationEvidence?.status,
        stopReason: settled.playerRecommendationEvidence?.failureReason,
      }).toStrictEqual({
        activeTimeMs: 1000,
        calls: 0,
        grantCount: 1,
        pendingBatchStatus: "failed",
        reservation: null,
        status: "failed",
        stopReason: "reservation_unknown",
      });
    } finally {
      await session.close();
    }
  }, 60_000);
});
