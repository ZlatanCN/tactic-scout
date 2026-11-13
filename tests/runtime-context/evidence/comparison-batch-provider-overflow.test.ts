import { AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { agentGraphTest } from "../../fixtures/agent-graph.js";
import {
  configureComparisonEvidenceTestEnvironment,
  comparisonEvidenceTest,
} from "../../fixtures/comparison-evidence.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";

configureComparisonEvidenceTestEnvironment();

const comparisonOverflowResponse = (messages: BaseMessage[]) => {
  const input = messages.at(-1)?.text ?? "";

  const [projectionJson] = input
    .split("Comparison evidence projection JSON:\n")
    .slice(1);

  if (projectionJson === undefined) {
    return new Error("The comparison evidence projection is missing.");
  }

  const projection = z
    .object({
      selectedPlayers: z.array(z.object({ playerName: z.string() })),
    })
    .parse(JSON.parse(projectionJson));

  if (projection.selectedPlayers.length > 1) {
    return Object.assign(
      new Error("The request exceeds the maximum context length."),
      { code: "context_length_exceeded", status: 400 }
    );
  }

  const [player] = projection.selectedPlayers;

  return new AIMessage(`${player?.playerName} was reviewed.`);
};

describe("comparison evidence provider overflow recovery", () => {
  it("splits an overflowing comparison batch and completes every participant", async () => {
    const { players, resultJson } = comparisonEvidenceTest.comparisonFixture();

    const expectedRecordRefsFor = (participantIndexes: number[]) => [
      ...participantIndexes.flatMap((participantIndex) => {
        const player = players[participantIndex];

        if (player === undefined) {
          throw new Error("The comparison fixture is missing a participant.");
        }

        return [
          ...player.fm.records.map(
            (_record, recordIndex) =>
              `players[${participantIndex}].fm.records[${recordIndex}]`
          ),
          ...player.understat.records.map(
            (_record, recordIndex) =>
              `players[${participantIndex}].understat.records[${recordIndex}]`
          ),
        ];
      }),
      ...[0, 1].flatMap((scopeIndex) =>
        participantIndexes.flatMap((participantIndex) =>
          players[participantIndex]?.understat.records[scopeIndex] === undefined
            ? []
            : [
                `understatScopeGroups[${scopeIndex}].players[${participantIndex}].record`,
              ]
        )
      ),
    ];

    const model = fakeModel();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      model.respond(comparisonOverflowResponse);
    }

    Object.assign(model, {
      getNumTokens: async (text: string) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      },
    });

    const modelInvoke = vi.spyOn(model, "invoke");

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 10 },
      model,
      modelContextProfile: {
        ...comparisonEvidenceTest.comparisonEvidenceModelContextProfile,
        maxInputTokens: 10_000,
        softTriggerFraction: 0.5,
        targetFraction: 0.1,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = await graph.invoke(
      comparisonEvidenceTest.graphStateForSavedComparison(resultJson),
      { configurable: { thread_id: "provider-overflow-comparison" } }
    );

    const requestedProjectionSizes = modelInvoke.mock.calls.map(([input]) => {
      const messages = z.array(z.object({ content: z.unknown() })).parse(input);
      const content = z.string().parse(messages.at(-1)?.content);

      const [projectionJson] = content
        .split("Comparison evidence projection JSON:\n")
        .slice(1);

      if (projectionJson === undefined) {
        throw new Error("The comparison evidence projection is missing.");
      }

      return z
        .object({ selectedPlayers: z.array(z.unknown()) })
        .parse(JSON.parse(projectionJson)).selectedPlayers.length;
    });

    const evidenceBatches = result.comparisonEvidence?.batches.map(
      ({ projectionJson, recordRefs }) => {
        const projection = z
          .looseObject({
            batch: z.object({ participantRefs: z.array(z.string()) }),
            understatScopes: z.array(
              z.looseObject({
                competition: z.string(),
                coverage: z.object({
                  coveredPlayerCount: z.number(),
                  coversAllParticipants: z.boolean(),
                  participantCount: z.number(),
                }),
                includedPlayers: z.array(
                  z.looseObject({
                    participantRef: z.string(),
                    record: z.unknown(),
                  })
                ),
                season: z.string(),
              })
            ),
          })
          .parse(JSON.parse(projectionJson));

        return {
          participantRefs: projection.batch.participantRefs,
          recordRefs,
          scopeCoverage: projection.understatScopes.map((scope) => ({
            competition: scope.competition,
            coversAllParticipants: scope.coverage.coversAllParticipants,
            recordFlags: scope.includedPlayers.map(
              ({ record }) => record !== null
            ),
            season: scope.season,
          })),
        };
      }
    );

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      batchStatuses: result.comparisonEvidence?.batches.map(
        ({ status }) => status
      ),
      evidenceBatches,
      evidenceStatus: result.comparisonEvidence?.status,
      participantNames: players.map(({ playerName }) =>
        answer.includes(playerName)
      ),
      requestedProjectionSizes,
    }).toStrictEqual({
      allowanceCalls: 7,
      batchStatuses: ["ready", "ready", "ready", "ready"],
      evidenceBatches: players.map((_player, participantIndex) => ({
        participantRefs: [`players[${participantIndex}]`],
        recordRefs: expectedRecordRefsFor([participantIndex]),
        scopeCoverage: [
          {
            competition: "Bundesliga",
            coversAllParticipants: true,
            recordFlags: [true],
            season: "2025/26",
          },
          {
            competition: "La_liga",
            coversAllParticipants: false,
            recordFlags: [participantIndex < 2],
            season: "2024/25",
          },
        ],
      })),
      evidenceStatus: "complete",
      participantNames: [true, true, true, true],
      requestedProjectionSizes: [4, 2, 1, 1, 2, 1, 1],
    });
  });
});
