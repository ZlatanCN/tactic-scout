import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { searchPlayerRecordsResultSchema } from "../../../src/player-data/search-records.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../../src/state.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { recommendationProviderOverflowTest } from "../../fixtures/recommendation-provider-overflow.js";

const partialResponse = () =>
  new AIMessage({
    content: "PARTIAL_TRUNCATED_EVIDENCE_EXPLANATION",
    response_metadata: { finish_reason: "length" },
    usage_metadata: {
      input_tokens: 101,
      output_tokens: 256,
      total_tokens: 357,
    },
  });

const projectionJsonSchema = z.json();

type ProjectionJson = z.output<typeof projectionJsonSchema>;

const projectionFromCall = (
  messages: BaseMessage[],
  marker: string
): ProjectionJson => {
  const humanMessage = messages.find(
    (message) => message instanceof HumanMessage
  );

  const content = z.string().parse(humanMessage?.content);
  const [projectionJson] = content.split(marker).slice(1);

  if (projectionJson === undefined) {
    throw new Error(`The evidence projection is missing: ${marker}`);
  }

  return projectionJsonSchema.parse(JSON.parse(projectionJson));
};

const createTruncatingModel = (
  response: (messages: BaseMessage[]) => BaseMessage | Error,
  callLimit = 20
) => {
  const model = fakeModel();

  for (let attempt = 0; attempt < callLimit; attempt += 1) {
    model.respond(response);
  }

  Object.assign(model, {
    getNumTokens: async (text: string) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    },
  });

  return model;
};

const createEvidenceGraph = (model: ReturnType<typeof fakeModel>) =>
  agentGraphTest.createAgent({
    checkpointer: new MemorySaver(),
    contextProcessingAllowance: { maxAdditionalCalls: 10 },
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

const lookupResultJson = JSON.stringify(
  searchPlayerRecordsResultSchema.parse({
    identityGroups: {
      canonicalGroups: [],
      registryStatus: "available",
      unlinkedRecords: [],
    },
    query: [{ provider: "understat", sourceId: "mikel-understat" }],
    requestedUnderstatSeasonStartYear: null,
    understat: {
      records: ["2022/23", "2023/24", "2024/25", "2025/26"].map(
        (season, index) => ({
          appearances: 9 + index,
          assists: 2 + index,
          competition: "La_liga",
          expectedAssists: 0.7 + index * 0.2,
          expectedGoals: 1.3 + index * 0.3,
          goals: 2 + index,
          keyPasses: 11 + index,
          minutes: 606 + index * 100,
          nonPenaltyExpectedGoals: 1.3 + index * 0.2,
          player: "Mikel Oyarzabal",
          position: "F M S",
          season,
          shots: 19 + index,
          source: "Understat",
          sourcePlayerId: "mikel-understat",
          team: "Real Sociedad",
        })
      ),
      status: "found",
    },
  })
);

const lookupGraphState = () => {
  const message = new HumanMessage({
    content: "What xA did Understat report across these seasons?",
    id: "saved-lookup-output-truncation",
  });

  const candidate = agentGraphTest.playerCandidate("Mikel Oyarzabal", "mikel");

  return AgentState.parse({
    conversationContext: {
      ...createInitialConversationContext(),
      activeLookup: {
        player: agentGraphTest.conversationReferenceFromCandidate(candidate),
        resultJson: lookupResultJson,
      },
    },
    messages: [message],
    outcome: {
      kind: "player_lookup",
      resultJson: lookupResultJson,
      source: "saved",
      status: "lookup_follow_up",
    },
    request: {
      ...createInitialRequestState(),
      processedMessageId: message.id,
    },
    stateSchemaVersion: agentStateSchemaVersion,
  });
};

describe("lookup and recommendation output truncation recovery", () => {
  it("re-splits truncated saved lookup batches while preserving source references", async () => {
    const marker = "Scouting evidence projection JSON:\n";
    const requestedRecordCounts: number[] = [];

    const model = createTruncatingModel((messages) => {
      const projection = z
        .object({
          batch: z.object({ recordRefs: z.array(z.string()) }),
          records: z.array(z.object({ season: z.string() })),
        })
        .parse(projectionFromCall(messages, marker));

      requestedRecordCounts.push(projection.records.length);

      return projection.records.length > 1
        ? partialResponse()
        : new AIMessage(`${projection.records[0]?.season} xA was reported.`);
    });

    const graph = createEvidenceGraph(model);

    const result = await graph.invoke(lookupGraphState(), {
      configurable: { thread_id: "saved-lookup-output-truncation" },
    });

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      evidenceStatus: result.lookupEvidence?.status,
      partialAnswerPublished: answer.includes(
        "PARTIAL_TRUNCATED_EVIDENCE_EXPLANATION"
      ),
      participantSeasons: ["2022/23", "2023/24", "2024/25", "2025/26"].map(
        (season) => answer.includes(season)
      ),
      recordRefs: result.lookupEvidence?.batches.map(
        ({ recordRefs }) => recordRefs
      ),
      requestedRecordCounts,
      statuses: result.lookupEvidence?.batches.map(({ status }) => status),
    }).toStrictEqual({
      allowanceCalls: 6,
      evidenceStatus: "complete",
      partialAnswerPublished: false,
      participantSeasons: [true, true, true, true],
      recordRefs: [
        ["understat.records[0]"],
        ["understat.records[1]"],
        ["understat.records[2]"],
        ["understat.records[3]"],
      ],
      requestedRecordCounts: [2, 1, 1, 2, 1, 1],
      statuses: ["ready", "ready", "ready", "ready"],
    });
  });

  it("re-splits both player recommendation lists after truncated batch responses", async () => {
    const scenario =
      recommendationProviderOverflowTest.playerRecommendationOverflowScenario();

    const marker = "Player recommendation evidence projection JSON:\n";
    const requestedRows: number[] = [];

    const response =
      recommendationProviderOverflowTest.recommendationBatchResponse(
        marker,
        (value) => {
          const projection = z
            .object({ selectedCandidates: z.array(z.unknown()) })
            .parse(value);

          requestedRows.push(projection.selectedCandidates.length);

          return projection.selectedCandidates.map((candidate) =>
            z
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
              .parse(candidate)
          );
        },
        1,
        "output_truncated"
      );

    const model = createTruncatingModel((messages) => response(messages));
    const graph = createEvidenceGraph(model);

    const result = await graph.invoke(scenario.state, {
      configurable: { thread_id: "player-recommendation-output-truncation" },
    });

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      batchLists: result.playerRecommendationEvidence?.batches.map(
        ({ projectionJson }) =>
          z
            .object({ batch: z.object({ list: z.string() }) })
            .parse(JSON.parse(projectionJson)).batch.list
      ),
      evidenceStatus: result.playerRecommendationEvidence?.status,
      partialAnswerPublished: answer.includes(
        "PARTIAL_TRUNCATED_RECOMMENDATION_EXPLANATION"
      ),
      requestedRows,
      statuses: result.playerRecommendationEvidence?.batches.map(
        ({ status }) => status
      ),
    }).toStrictEqual({
      allowanceCalls: 6,
      batchLists: ["current", "current", "potential", "potential"],
      evidenceStatus: "complete",
      partialAnswerPublished: false,
      requestedRows: [2, 1, 1, 2, 1, 1],
      statuses: ["ready", "ready", "ready", "ready"],
    });
  });

  it("re-splits team recommendation evidence after a truncated batch response", async () => {
    const scenario =
      recommendationProviderOverflowTest.teamRecommendationOverflowScenario();

    const marker = "Team recommendation evidence projection JSON:\n";
    const requestedRows: number[] = [];

    const response =
      recommendationProviderOverflowTest.recommendationBatchResponse(
        marker,
        (value) => {
          const projection = z
            .object({
              currentCandidates: z.array(z.unknown()),
              potentialCandidates: z.array(z.unknown()).nullable(),
            })
            .parse(value);

          const candidates = [
            ...projection.currentCandidates,
            ...(projection.potentialCandidates ?? []),
          ];

          requestedRows.push(candidates.length);

          return candidates.map((candidate) =>
            z
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
              .parse(candidate)
          );
        },
        1,
        "output_truncated"
      );

    const model = createTruncatingModel((messages) => response(messages));
    const graph = createEvidenceGraph(model);

    const result = await graph.invoke(scenario.state, {
      configurable: { thread_id: "team-recommendation-output-truncation" },
    });

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      batchCandidateRefs: result.teamRecommendationEvidence?.batches.map(
        ({ projectionJson }) =>
          z
            .object({ batch: z.object({ candidateRefs: z.array(z.string()) }) })
            .parse(JSON.parse(projectionJson)).batch.candidateRefs
      ),
      evidenceStatus: result.teamRecommendationEvidence?.status,
      partialAnswerPublished: answer.includes(
        "PARTIAL_TRUNCATED_RECOMMENDATION_EXPLANATION"
      ),
      requestedRows,
      statuses: result.teamRecommendationEvidence?.batches.map(
        ({ status }) => status
      ),
    }).toStrictEqual({
      allowanceCalls: 5,
      batchCandidateRefs: [
        ["recommendation.currentCandidates[0]"],
        ["recommendation.currentCandidates[1]"],
        ["recommendation.potentialCandidates[0]"],
      ],
      evidenceStatus: "complete",
      partialAnswerPublished: false,
      requestedRows: [3, 1, 2, 1, 1],
      statuses: ["ready", "ready", "ready"],
    });
  });
});
