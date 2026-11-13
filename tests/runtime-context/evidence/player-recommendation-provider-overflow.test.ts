import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { agentGraphTest } from "../../fixtures/agent-graph.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { recommendationProviderOverflowTest } from "../../fixtures/recommendation-provider-overflow.js";

const playerCandidateSchema = z.object({
  age: z.number(),
  attributes: z.array(z.looseObject({})),
  currentAbility: z.number(),
  currentDistance: z.number(),
  fmId: z.string(),
  name: z.string(),
  positionRating: z.number(),
  potentialAbility: z.number(),
  rank: z.number(),
  sourceRecordId: z.string(),
});

const playerProjectionSchema = z.object({
  batch: z.object({
    candidateRefs: z.array(z.string()),
    index: z.number(),
    list: z.enum(["current", "potential"]),
  }),
  selectedCandidates: z.array(playerCandidateSchema),
});

describe("player recommendation provider overflow recovery", () => {
  it("splits both lists and preserves every candidate row field and order", async () => {
    const scenario =
      recommendationProviderOverflowTest.playerRecommendationOverflowScenario();

    const model = fakeModel();
    const marker = "Player recommendation evidence projection JSON:\n";

    const response =
      recommendationProviderOverflowTest.recommendationBatchResponse(
        marker,
        (value) => playerProjectionSchema.parse(value).selectedCandidates
      );

    for (let attempt = 0; attempt < 6; attempt += 1) {
      model.respond(response);
    }

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 6 },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 10_000,
        maxOutputTokens: 256,
        softTriggerFraction: 0.01,
        targetFraction: 0.001,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = await graph.invoke(scenario.state, {
      configurable: { thread_id: "player-recommendation-overflow" },
    });

    const answer = z.string().parse(result.messages.at(-1)?.content);

    const batches = result.playerRecommendationEvidence?.batches.map(
      ({ answer: batchAnswer, projectionJson }) => ({
        answer: batchAnswer,
        ...playerProjectionSchema.parse(JSON.parse(projectionJson)),
      })
    );

    const candidates = [
      ...scenario.currentCandidates,
      ...scenario.potentialCandidates,
    ];

    const answerKeepsAllRowFields = candidates.every((candidate) =>
      [
        `${candidate.rank}. ${candidate.name}`,
        `FM ID ${candidate.fmId}`,
        `age ${candidate.age}`,
        `position rating ${candidate.positionRating}`,
        `CA ${candidate.currentAbility}`,
        `PA ${candidate.potentialAbility}`,
        `currentDistance ${candidate.currentDistance}`,
      ].every((field) => answer.includes(field))
    );

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      answerKeepsAllRowFields,
      batchLists: batches?.map(({ batch }) => batch.list),
      batchRows: batches?.map(({ selectedCandidates }) => selectedCandidates),
      batchStatuses: result.playerRecommendationEvidence?.batches.map(
        ({ status }) => status
      ),
      evidenceStatus: result.playerRecommendationEvidence?.status,
    }).toStrictEqual({
      allowanceCalls: 6,
      answerKeepsAllRowFields: true,
      batchLists: ["current", "current", "potential", "potential"],
      batchRows: [
        [scenario.currentCandidates[0]],
        [scenario.currentCandidates[1]],
        [scenario.potentialCandidates[0]],
        [scenario.potentialCandidates[1]],
      ],
      batchStatuses: ["ready", "ready", "ready", "ready"],
      evidenceStatus: "complete",
    });
  });
});
