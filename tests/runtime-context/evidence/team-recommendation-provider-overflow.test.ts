import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { agentGraphTest } from "../../fixtures/agent-graph.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { recommendationProviderOverflowTest } from "../../fixtures/recommendation-provider-overflow.js";

const teamCandidateSchema = z.object({
  age: z.number().nullable(),
  candidateRef: z.string(),
  currentAbility: z.number().nullable(),
  currentDistance: z.number(),
  fmId: z.string(),
  name: z.string(),
  positionRating: z.number(),
  potentialAbility: z.number().nullable(),
  rank: z.number(),
});

const teamProjectionSchema = z.object({
  batch: z.object({ candidateRefs: z.array(z.string()), index: z.number() }),
  currentCandidates: z.array(teamCandidateSchema),
  potentialCandidates: z.array(teamCandidateSchema).nullable(),
});

const projectedCandidate = (
  candidate: ReturnType<
    typeof recommendationProviderOverflowTest.recommendationCandidate
  >,
  candidateRef: string
) => ({
  age: candidate.age,
  candidateRef,
  currentAbility: candidate.currentAbility,
  currentDistance: candidate.currentDistance,
  fmId: candidate.fmId,
  name: candidate.name,
  positionRating: candidate.positionRating,
  potentialAbility: candidate.potentialAbility,
  rank: candidate.rank,
});

describe("team recommendation provider overflow recovery", () => {
  it("splits both lists and retains all candidate fields and order", async () => {
    const scenario =
      recommendationProviderOverflowTest.teamRecommendationOverflowScenario();

    const model = fakeModel();
    const marker = "Team recommendation evidence projection JSON:\n";

    const response =
      recommendationProviderOverflowTest.recommendationBatchResponse(
        marker,
        (value) => {
          const projection = teamProjectionSchema.parse(value);

          return [
            ...projection.currentCandidates,
            ...(projection.potentialCandidates ?? []),
          ];
        },
        2
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
      configurable: { thread_id: "team-recommendation-overflow" },
    });

    const answer = z.string().parse(result.messages.at(-1)?.content);

    const batches = result.teamRecommendationEvidence?.batches.map(
      ({ projectionJson }) =>
        teamProjectionSchema.parse(JSON.parse(projectionJson))
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
      batchCandidateRefs: batches?.map(({ batch }) => batch.candidateRefs),
      batchRows: batches?.map(({ currentCandidates, potentialCandidates }) => [
        ...currentCandidates,
        ...(potentialCandidates ?? []),
      ]),
      batchStatuses: result.teamRecommendationEvidence?.batches.map(
        ({ status }) => status
      ),
      evidenceStatus: result.teamRecommendationEvidence?.status,
      savedResultIsPreserved:
        result.conversationContext.activeTeamRecommendation?.resultJson ===
        scenario.resultJson,
    }).toStrictEqual({
      allowanceCalls: 3,
      answerKeepsAllRowFields: true,
      batchCandidateRefs: [
        ["recommendation.currentCandidates[0]"],
        [
          "recommendation.currentCandidates[1]",
          "recommendation.potentialCandidates[0]",
        ],
      ],
      batchRows: [
        [
          projectedCandidate(
            scenario.currentCandidates[0],
            "recommendation.currentCandidates[0]"
          ),
        ],
        [
          projectedCandidate(
            scenario.currentCandidates[1],
            "recommendation.currentCandidates[1]"
          ),
          projectedCandidate(
            scenario.potentialCandidates[0],
            "recommendation.potentialCandidates[0]"
          ),
        ],
      ],
      batchStatuses: ["ready", "ready"],
      evidenceStatus: "complete",
      savedResultIsPreserved: true,
    });
  });
});
