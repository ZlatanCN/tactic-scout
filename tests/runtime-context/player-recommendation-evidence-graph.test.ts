import type { BaseMessage } from "@langchain/core/messages";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { assessModelRequest } from "../../src/model-context.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../src/state.js";
import { agentGraphTest } from "../fixtures/agent-graph.js";
import { testModelOutputLimitAdapter } from "../fixtures/model-context.js";
import { recommendationResultData } from "../fixtures/workflow-results.js";

const candidate = (list: string, index: number) => ({
  age: 19 + (index % 10),
  attributes: [],
  currentAbility: 110 + index,
  currentDistance: Number((index / 10).toFixed(2)),
  fmId: `fm-${list}-${String(index + 1).padStart(2, "0")}`,
  name: `${list} Candidate ${String(index + 1).padStart(2, "0")}`,
  positionRating: 15 + (index % 6),
  potentialAbility: 150 + index,
  rank: index + 1,
  sourceRecordId: `source-${list}-${String(index + 1).padStart(2, "0")}`,
});

const resultJson = JSON.stringify(
  recommendationResultData("ready", "stc", {
    currentCandidates: Array.from({ length: 20 }, (_unused, index) =>
      candidate("current", index)
    ),
    filterCounts: {
      afterAge: 40,
      afterCurrentAbility: 35,
      afterIdentityExclusion: 30,
      afterPotentialAbility: 25,
      currentAttributeComplete: 45,
      eligiblePositionProfiles: 50,
      excludedMissingAttribute: 5,
      excludedMissingFmIdCandidates: 0,
      excludedMissingPotentialForPotentialList: 3,
    },
    filters: {
      includePotential: true,
      maxAge: 25,
      minimumCurrentAbility: null,
      minimumPotentialAbility: 150,
      resultLimit: 20,
    },
    potentialCandidates: Array.from({ length: 20 }, (_unused, index) =>
      candidate("potential", index)
    ),
  })
);

const savedRecommendationState = () => {
  const reference = agentGraphTest.playerCandidate(
    "Synthetic Reference",
    "reference"
  );

  const message = new HumanMessage({
    content: "Explain the saved two-list player recommendation.",
    id: "saved-two-list-recommendation",
  });

  return AgentState.parse({
    conversationContext: {
      ...createInitialConversationContext(),
      activeRecommendation: {
        excludePlayers: [],
        includePotential: true,
        maxAge: 25,
        minimumCurrentAbility: null,
        minimumPotentialAbility: 150,
        position: "stc",
        referencePlayers: [
          agentGraphTest.conversationReferenceFromCandidate(reference),
        ],
        resultJson,
        resultLimit: 20,
        status: "ready",
      },
    },
    messages: [message],
    outcome: {
      kind: "player_recommendation",
      resultJson,
      source: "saved",
      status: "ready",
    },
    request: {
      ...createInitialRequestState(),
      processedMessageId: message.id,
    },
    stateSchemaVersion: agentStateSchemaVersion,
  });
};

describe("player recommendation evidence delivery through the full graph", () => {
  it("explains both complete ranked lists in bounded batches without reranking", async () => {
    const modelContextProfile = {
      countingMarginTokens: 64,
      maxInputTokens: 2400,
      maxOutputTokens: 512,
      softTriggerFraction: 0.9,
      targetFraction: 0.6,
    };

    const modelInputs: BaseMessage[][] = [];

    const dynamicModelResponse = (messages: BaseMessage[]) => {
      modelInputs.push(messages);

      const humanMessage = messages.find(
        (message) => message instanceof HumanMessage
      );

      const content = z.string().parse(humanMessage?.content);
      const marker = "Player recommendation evidence projection JSON:\n";
      const markerIndex = content.indexOf(marker);

      if (markerIndex === -1) {
        throw new Error(
          "The graph must send a bounded recommendation projection."
        );
      }

      const projection = z
        .object({
          selectedCandidates: z.array(z.record(z.string(), z.unknown())),
        })
        .parse(JSON.parse(content.slice(markerIndex + marker.length)));

      const answer = projection.selectedCandidates
        .map((selected) => {
          const values = z
            .object({
              age: z.number().nullable(),
              currentAbility: z.number().nullable(),
              currentDistance: z.number(),
              fmId: z.string(),
              name: z.string(),
              positionRating: z.number(),
              potentialAbility: z.number().nullable(),
              rank: z.number(),
            })
            .parse(selected);

          return `${values.rank}. ${values.name} (FM ID ${values.fmId}; age ${values.age}; position rating ${values.positionRating}; CA ${values.currentAbility}; PA ${values.potentialAbility}; currentDistance ${values.currentDistance})`;
        })
        .join("\n");

      return new AIMessage(answer);
    };

    const model = Object.assign(
      fakeModel()
        .respond(dynamicModelResponse)
        .respond(dynamicModelResponse)
        .respond(dynamicModelResponse)
        .respond(dynamicModelResponse)
        .respond(dynamicModelResponse)
        .respond(dynamicModelResponse)
        .respond(dynamicModelResponse)
        .respond(dynamicModelResponse)
        .respond(dynamicModelResponse)
        .respond(dynamicModelResponse)
        .respond(dynamicModelResponse)
        .respond(dynamicModelResponse),
      {
        getNumTokens: async (text: string) => {
          await Promise.resolve();

          return Math.ceil(text.length / 4);
        },
      }
    );

    const graph = agentGraphTest.createAgent({
      model,
      modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = await graph.invoke(savedRecommendationState(), {
      configurable: { thread_id: "saved-player-recommendation-batches" },
    });

    const answer = z.string().parse(result.messages.at(-1)?.content);

    const batchAssessments = await Promise.all(
      modelInputs.map(
        async (messages) =>
          await assessModelRequest(
            model,
            { messages, purpose: "answer" },
            {
              outputLimitAdapter: testModelOutputLimitAdapter,
              profile: modelContextProfile,
            }
          )
      )
    );

    const firstBatchSystemMessage = modelInputs[0]?.find(
      (message) => message instanceof SystemMessage
    );

    if (firstBatchSystemMessage === undefined) {
      throw new Error("The batch explanation should include a system prompt.");
    }

    const unbatchedAssessment = await assessModelRequest(
      model,
      {
        messages: [
          firstBatchSystemMessage,
          new HumanMessage(
            `用户请求：Explain the saved two-list player recommendation.\n\n结构化工具结果：\n${resultJson}`
          ),
        ],
        purpose: "answer",
      },
      {
        outputLimitAdapter: testModelOutputLimitAdapter,
        profile: modelContextProfile,
      }
    );

    const projectionInputs = modelInputs.map((messages) => {
      const user = messages.find((message) => message instanceof HumanMessage);
      const text = z.string().parse(user?.content);
      const marker = "Player recommendation evidence projection JSON:\n";
      const markerIndex = text.indexOf(marker);

      if (markerIndex === -1) {
        throw new Error(
          "Every batch call must contain its evidence projection."
        );
      }

      return z
        .object({
          batch: z.object({
            candidateRefs: z.array(z.string()),
            list: z.enum(["current", "potential"]),
          }),
          candidateCounts: z.object({
            current: z.number(),
            potential: z.number(),
          }),
          selectedCandidates: z.array(
            z.object({ fmId: z.string(), name: z.string(), rank: z.number() })
          ),
        })
        .parse(JSON.parse(text.slice(markerIndex + marker.length)));
    });

    expect({
      additionalCallsWithinDefaultGrant:
        (result.contextProcessing.allowance?.consumedAdditionalCalls ?? 7) <= 6,
      allCandidatesDelivered: [
        ...Array.from({ length: 20 }, (_unused, index) =>
          candidate("current", index)
        ),
        ...Array.from({ length: 20 }, (_unused, index) =>
          candidate("potential", index)
        ),
      ].every(
        ({
          age,
          currentAbility,
          currentDistance,
          fmId,
          name,
          positionRating,
          potentialAbility,
          rank,
        }) =>
          [
            name,
            fmId,
            String(rank),
            String(age),
            String(positionRating),
            String(currentAbility),
            String(potentialAbility),
            String(currentDistance),
          ].every((value) => answer.includes(value))
      ),
      answerContainsBothLists:
        answer.includes("当前能力相似候选") && answer.includes("高潜候选"),
      batchesAreSeparateAndOrdered: projectionInputs.every(
        ({ batch, candidateCounts, selectedCandidates }) =>
          selectedCandidates.every(({ rank }, index) => {
            const expectedPrefix =
              batch.list === "current"
                ? "currentCandidates["
                : "potentialCandidates[";

            return (
              candidateCounts.current === 20 &&
              candidateCounts.potential === 20 &&
              batch.candidateRefs[index]?.startsWith(expectedPrefix) &&
              rank > 0
            );
          })
      ),
      batchesFit: batchAssessments.every(
        ({ assessment, failure }) =>
          failure === null && !assessment.compactionSuggested
      ),
      listBatchCount: new Set(projectionInputs.map(({ batch }) => batch.list))
        .size,
      modelCalls: modelInputs.length,
      savedOutcome:
        result.outcome !== null && "source" in result.outcome
          ? result.outcome.source
          : null,
      storedEvidenceStatus: result.playerRecommendationEvidence?.status,
      unbatchedNeedsProcessing:
        unbatchedAssessment.failure !== null ||
        unbatchedAssessment.assessment.compactionSuggested,
    }).toMatchObject({
      additionalCallsWithinDefaultGrant: true,
      allCandidatesDelivered: true,
      answerContainsBothLists: true,
      batchesAreSeparateAndOrdered: true,
      batchesFit: true,
      listBatchCount: 2,
      savedOutcome: "saved",
      storedEvidenceStatus: "complete",
      unbatchedNeedsProcessing: true,
    });
    expect(modelInputs.length).toBeGreaterThan(1);
  });

  it("renders every saved candidate when the shared grant stops after one batch", async () => {
    const model = Object.assign(
      fakeModel().respond(new AIMessage("Only the first batch is explained.")),
      {
        getNumTokens: async (text: string) => {
          await Promise.resolve();

          return Math.ceil(text.length / 4);
        },
      }
    );

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

    const result = await graph.invoke(savedRecommendationState(), {
      configurable: { thread_id: "saved-player-recommendation-quota" },
    });

    const answer = z.string().parse(result.messages.at(-1)?.content);

    const everyCandidate = [
      ...Array.from({ length: 20 }, (_unused, index) =>
        candidate("current", index)
      ),
      ...Array.from({ length: 20 }, (_unused, index) =>
        candidate("potential", index)
      ),
    ];

    expect({
      allCandidateRowsRemainAvailable: everyCandidate.every(
        ({
          age,
          currentAbility,
          currentDistance,
          fmId,
          name,
          positionRating,
          potentialAbility,
          rank,
        }) =>
          [
            `${rank}. ${name}`,
            fmId,
            String(age),
            String(positionRating),
            String(currentAbility),
            String(potentialAbility),
            String(currentDistance),
          ].every((value) => answer.includes(value))
      ),
      explanationIsMarkedIncomplete: answer.includes("分批解释未完成"),
      modelCalls: model.callCount,
      resultSnapshotIsPreserved:
        result.conversationContext.activeRecommendation?.resultJson ===
        resultJson,
      status: result.playerRecommendationEvidence?.status,
    }).toStrictEqual({
      allCandidateRowsRemainAvailable: true,
      explanationIsMarkedIncomplete: true,
      modelCalls: 1,
      resultSnapshotIsPreserved: true,
      status: "allowance_exhausted",
    });
  });
});
