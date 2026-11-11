import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { comparisonBatchPrompt } from "../../src/comparison-evidence.js";
import { assessModelRequest } from "../../src/model-context.js";
import type { PlayerSearch } from "../../src/player-data/search-records.js";
import { createTools } from "../../src/tools/search-player-records.js";
import {
  configureComparisonEvidenceTestEnvironment,
  comparisonEvidenceTest,
} from "../fixtures/comparison-evidence.js";
import { testModelOutputLimitAdapter } from "../fixtures/model-context.js";

configureComparisonEvidenceTestEnvironment();

const { createAgent } = await import("../../src/agent.js");

describe("comparison evidence participant and provider coverage", () => {
  it("explains every saved participant while preserving full and partial scope coverage", async () => {
    const { players, resultJson } = comparisonEvidenceTest.comparisonFixture();

    const model = fakeModel()
      .respond(
        new AIMessage(
          "Synthetic Comparison Player 1 和 Synthetic Comparison Player 2 的出生日期未提供。"
        )
      )
      .respond(
        new AIMessage(
          "Synthetic Comparison Player 3 和 Synthetic Comparison Player 4 的出生日期未提供。"
        )
      );

    const modelWithTokenCount = Object.assign(model, {
      getNumTokens: async (text: string) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      },
    });

    const modelInvoke = vi.spyOn(model, "invoke");

    const search = vi.fn<PlayerSearch>(() => {
      throw new Error("A saved comparison must not read its providers again.");
    });

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 2 },
      model: modelWithTokenCount,
      modelContextProfile:
        comparisonEvidenceTest.comparisonEvidenceModelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerReferenceValidator: () => ({ status: "current" }),
      tools: createTools(search),
    });

    const result = await graph.invoke(
      comparisonEvidenceTest.graphStateForSavedComparison(resultJson),
      {
        configurable: { thread_id: "saved-four-player-comparison-batches" },
      }
    );

    const projections = modelInvoke.mock.calls.map(([input]) =>
      comparisonEvidenceTest.comparisonProjectionFromCall(input)
    );

    const batchRequests = modelInvoke.mock.calls.map(([input]) =>
      comparisonEvidenceTest.modelMessagesFromCall(input)
    );

    const batchAssessments = await Promise.all(
      batchRequests.map(
        async (messages) =>
          await assessModelRequest(
            model,
            { messages, purpose: "answer" },
            {
              outputLimitAdapter: testModelOutputLimitAdapter,
              profile:
                comparisonEvidenceTest.comparisonEvidenceModelContextProfile,
            }
          )
      )
    );

    const [firstBatchRequest] = batchRequests;

    if (firstBatchRequest === undefined) {
      const firstStoredBatch = result.comparisonEvidence?.batches[0];

      const storedBatchAssessment =
        firstStoredBatch === undefined
          ? null
          : await assessModelRequest(
              model,
              {
                messages: [
                  new SystemMessage(comparisonBatchPrompt),
                  new HumanMessage(
                    `用户请求：${comparisonEvidenceTest.savedComparisonQuestion}\n\nComparison evidence projection JSON:\n${firstStoredBatch.projectionJson}`
                  ),
                ],
                purpose: "answer",
              },
              {
                outputLimitAdapter: testModelOutputLimitAdapter,
                profile:
                  comparisonEvidenceTest.comparisonEvidenceModelContextProfile,
              }
            );

      throw new Error(
        `The graph should send an evidence batch: ${JSON.stringify({
          allowance: result.contextProcessing.allowance,
          evidence: {
            batches: result.comparisonEvidence?.batches.map(
              ({ status }) => status
            ),
            failureReason: result.comparisonEvidence?.failureReason,
            status: result.comparisonEvidence?.status,
          },
          failure: result.faultTolerance.failure,
          outcomeStatus: result.outcome?.status,
          storedBatchAssessment: storedBatchAssessment?.assessment,
          storedBatchFailure: storedBatchAssessment?.failure,
        })}`
      );
    }

    const [systemMessage] = firstBatchRequest;

    if (systemMessage === undefined) {
      throw new Error("The evidence batch should include its system prompt.");
    }

    const unbatchedAssessment = await assessModelRequest(
      model,
      {
        messages: [
          systemMessage,
          new HumanMessage(
            `用户请求：${comparisonEvidenceTest.savedComparisonQuestion}\n\n结构化工具结果：\n${resultJson}`
          ),
        ],
        purpose: "answer",
      },
      {
        outputLimitAdapter: testModelOutputLimitAdapter,
        profile: comparisonEvidenceTest.comparisonEvidenceModelContextProfile,
      }
    );

    const answer = z.string().parse(result.messages.at(-1)?.content);

    const firstBatchAnswer =
      result.comparisonEvidence?.batches[0]?.answer ?? "";

    expect({
      answerIncludesBothBatches:
        answer.includes(
          "第 1 批（Synthetic Comparison Player 1、Synthetic Comparison Player 2）"
        ) &&
        answer.includes(
          "第 2 批（Synthetic Comparison Player 3、Synthetic Comparison Player 4）"
        ),
      answerLimitsItsOverallClaim: answer.includes(
        "不构成全体参与者的整体强弱排名"
      ),
      batchCorrectionStaysWithinSelectedParticipants:
        firstBatchAnswer.includes("2000-01-02") &&
        firstBatchAnswer.includes("2001-01-02") &&
        !firstBatchAnswer.includes("2002-01-02") &&
        !firstBatchAnswer.includes("2003-01-02"),
      batches: projections.map((projection) => ({
        commonUnderstatScopeCount:
          projection.coverage.commonUnderstatScopeCount,
        coveredLocalPlayers: projection.understatScopes
          .find(({ competition }) => competition === "La_liga")
          ?.includedPlayers.flatMap(({ playerName, record }) =>
            record === null ? [] : [playerName]
          ),
        localScopeCoverage: projection.understatScopes.find(
          ({ competition }) => competition === "La_liga"
        )?.coverage,
        participants: projection.participants.map(
          ({ playerName }) => playerName
        ),
        selectedPlayers: projection.selectedPlayers.map(
          ({ playerName }) => playerName
        ),
      })),
      modelCalls: modelInvoke.mock.calls.length,
      modelWindowAblation: {
        batchFailures: batchAssessments.map(({ failure }) => failure),
        unbatchedFailure: unbatchedAssessment.failure,
      },
      savedSnapshotIsUnchanged:
        result.conversationContext.activeComparison.resultJson === resultJson,
      savedSourcesAreNotQueried: search.mock.calls.length === 0,
    }).toStrictEqual({
      answerIncludesBothBatches: true,
      answerLimitsItsOverallClaim: true,
      batchCorrectionStaysWithinSelectedParticipants: true,
      batches: [
        {
          commonUnderstatScopeCount: 1,
          coveredLocalPlayers: [
            "Synthetic Comparison Player 1",
            "Synthetic Comparison Player 2",
          ],
          localScopeCoverage: {
            coveredPlayerCount: 2,
            coversAllParticipants: false,
            participantCount: 4,
          },
          participants: players.map(({ playerName }) => playerName),
          selectedPlayers: players
            .slice(0, 2)
            .map(({ playerName }) => playerName),
        },
        {
          commonUnderstatScopeCount: 1,
          coveredLocalPlayers: [],
          localScopeCoverage: {
            coveredPlayerCount: 2,
            coversAllParticipants: false,
            participantCount: 4,
          },
          participants: players.map(({ playerName }) => playerName),
          selectedPlayers: players.slice(2).map(({ playerName }) => playerName),
        },
      ],
      modelCalls: 2,
      modelWindowAblation: {
        batchFailures: [null, null],
        unbatchedFailure: "input_exceeds_limit",
      },
      savedSnapshotIsUnchanged: true,
      savedSourcesAreNotQueried: true,
    });
  });

  it("keeps unavailable, not-found, unqueried, and source-null states distinct", async () => {
    const { players, resultJson } =
      comparisonEvidenceTest.comparisonFixtureWithProviderStatuses();

    const model = fakeModel().respond(
      new AIMessage("Synthetic Comparison Player 1、2、3、4 的来源状态已说明。")
    );

    const modelWithTokenCount = Object.assign(model, {
      getNumTokens: async (text: string) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      },
    });

    const modelInvoke = vi.spyOn(model, "invoke");

    const search = vi.fn<PlayerSearch>(() => {
      throw new Error("A saved comparison must not reread data sources.");
    });

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 2 },
      model: modelWithTokenCount,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 100_000,
        maxOutputTokens: 2048,
        softTriggerFraction: 0.01,
        targetFraction: 0.005,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerReferenceValidator: () => ({ status: "current" }),
      tools: createTools(search),
    });

    const result = await graph.invoke(
      comparisonEvidenceTest.graphStateForSavedComparison(resultJson, players),
      { configurable: { thread_id: "comparison-provider-status-batches" } }
    );

    const projections = modelInvoke.mock.calls.map(([input]) =>
      comparisonEvidenceTest.comparisonProjectionFromCall(input)
    );

    const providerStates = projections[0]?.participants.map(
      ({ playerName, providerCoverage }) => ({
        fm: providerCoverage.fm.status,
        playerName,
        understat: providerCoverage.understat.status,
      })
    );

    const sourceNullIsExplicit = projections[0]?.selectedPlayers.some(
      ({ understat }) =>
        understat !== null &&
        JSON.stringify(understat).includes('"expectedAssists":null')
    );

    expect({
      commonScopeCount: projections[0]?.coverage.commonUnderstatScopeCount,
      modelCalls: modelInvoke.mock.calls.length,
      providerStates,
      scopeCoverage: projections[0]?.understatScopes.map(
        ({ competition, coverage, season }) => ({
          competition,
          coverage,
          season,
        })
      ),
      searchCalls: search.mock.calls.length,
      snapshotRetained:
        result.conversationContext.activeComparison.resultJson === resultJson,
      sourceNullIsExplicit,
    }).toStrictEqual({
      commonScopeCount: 0,
      modelCalls: 1,
      providerStates: [
        {
          fm: "found",
          playerName: "Synthetic Comparison Player 1",
          understat: "found",
        },
        {
          fm: "unavailable",
          playerName: "Synthetic Comparison Player 2",
          understat: "found",
        },
        {
          fm: "not_found",
          playerName: "Synthetic Comparison Player 3",
          understat: "found",
        },
        {
          fm: "not_queried",
          playerName: "Synthetic Comparison Player 4",
          understat: "found",
        },
      ],
      scopeCoverage: [
        {
          competition: "La_liga",
          coverage: {
            coveredPlayerCount: 2,
            coversAllParticipants: false,
            participantCount: 4,
          },
          season: "2024/25",
        },
        {
          competition: "Serie_A",
          coverage: {
            coveredPlayerCount: 2,
            coversAllParticipants: false,
            participantCount: 4,
          },
          season: "2025/26",
        },
      ],
      searchCalls: 0,
      snapshotRetained: true,
      sourceNullIsExplicit: true,
    });
  });

  it("shrinks participant batches until each projection fits the model input budget", async () => {
    const { resultJson } = comparisonEvidenceTest.comparisonFixture();

    const model = fakeModel();

    for (const playerNumber of [1, 2, 3, 4]) {
      model.respond(
        new AIMessage(
          `Synthetic Comparison Player ${playerNumber} is explained.`
        )
      );
    }

    const modelWithTokenCount = Object.assign(model, {
      getNumTokens: async (text: string) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      },
    });

    const modelInvoke = vi.spyOn(model, "invoke");

    const modelContextProfile = {
      countingMarginTokens: 64,
      maxInputTokens: 3000,
      maxOutputTokens: 256,
    };

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 6 },
      model: modelWithTokenCount,
      modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerReferenceValidator: () => ({ status: "current" }),
      tools: [],
    });

    const result = await graph.invoke(
      comparisonEvidenceTest.graphStateForSavedComparison(resultJson),
      {
        configurable: { thread_id: "comparison-adaptive-batch-sizing" },
      }
    );

    const projections = modelInvoke.mock.calls.map(([input]) =>
      comparisonEvidenceTest.comparisonProjectionFromCall(input)
    );

    const assessments = await Promise.all(
      modelInvoke.mock.calls.map(
        async ([input]) =>
          await assessModelRequest(
            model,
            {
              messages: comparisonEvidenceTest.modelMessagesFromCall(input),
              purpose: "answer",
            },
            {
              outputLimitAdapter: testModelOutputLimitAdapter,
              profile: modelContextProfile,
            }
          )
      )
    );

    expect({
      allBatchInputsFit: assessments.every(({ failure }) => failure === null),
      batchSizes: projections.map(
        ({ selectedPlayers }) => selectedPlayers.length
      ),
      modelCalls: modelInvoke.mock.calls.length,
      participantRefs: projections.flatMap(
        ({ batch }) => batch.participantRefs
      ),
      resultRetained:
        result.conversationContext.activeComparison.resultJson === resultJson,
      status: result.comparisonEvidence?.status,
    }).toStrictEqual({
      allBatchInputsFit: true,
      batchSizes: [1, 1, 1, 1],
      modelCalls: 4,
      participantRefs: ["players[0]", "players[1]", "players[2]", "players[3]"],
      resultRetained: true,
      status: "complete",
    });
  });

  it("fails safely when even one participant projection exceeds the input budget", async () => {
    const { resultJson } = comparisonEvidenceTest.comparisonFixture();
    const model = fakeModel();

    const modelWithTokenCount = Object.assign(model, {
      getNumTokens: async (text: string) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      },
    });

    const modelInvoke = vi.spyOn(model, "invoke");

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 6 },
      model: modelWithTokenCount,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 500,
        maxOutputTokens: 256,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerReferenceValidator: () => ({ status: "current" }),
      tools: [],
    });

    const result = await graph.invoke(
      comparisonEvidenceTest.graphStateForSavedComparison(resultJson),
      {
        configurable: { thread_id: "comparison-single-participant-overflow" },
      }
    );

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      answerContainsCompleteResult: answer.includes(resultJson),
      answerMarksExplanationIncomplete: answer.includes("分批解释未完成"),
      batchCount: result.comparisonEvidence?.batches.length,
      evidenceStatus: result.comparisonEvidence?.status,
      modelCalls: modelInvoke.mock.calls.length,
      reservation: result.contextProcessing.allowance?.reservation,
    }).toStrictEqual({
      allowanceCalls: 0,
      answerContainsCompleteResult: true,
      answerMarksExplanationIncomplete: true,
      batchCount: 0,
      evidenceStatus: "failed",
      modelCalls: 0,
      reservation: null,
    });
  });

  it("does not complete an explanation when nonempty batch answers omit participants", async () => {
    const { resultJson } = comparisonEvidenceTest.comparisonFixture();

    const model = fakeModel()
      .respond(new AIMessage("The first batch has been reviewed."))
      .respond(new AIMessage("The second batch has been reviewed."));

    const modelWithTokenCount = Object.assign(model, {
      getNumTokens: async (text: string) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      },
    });

    const modelInvoke = vi.spyOn(model, "invoke");

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 6 },
      model: modelWithTokenCount,
      modelContextProfile:
        comparisonEvidenceTest.comparisonEvidenceModelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerReferenceValidator: () => ({ status: "current" }),
      tools: [],
    });

    const result = await graph.invoke(
      comparisonEvidenceTest.graphStateForSavedComparison(resultJson),
      {
        configurable: { thread_id: "comparison-answer-participant-coverage" },
      }
    );

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      answerContainsCompleteResult: answer.includes(resultJson),
      answerMarksExplanationIncomplete: answer.includes("分批解释未完成"),
      evidenceStatus: result.comparisonEvidence?.status,
      modelCalls: modelInvoke.mock.calls.length,
    }).toStrictEqual({
      answerContainsCompleteResult: true,
      answerMarksExplanationIncomplete: true,
      evidenceStatus: "failed",
      modelCalls: 2,
    });
  });

  it("revalidates completed projections against every source field before presenting a complete explanation", async () => {
    const { resultJson } = comparisonEvidenceTest.comparisonFixture();

    const model = fakeModel()
      .respond(
        new AIMessage(
          "Synthetic Comparison Player 1 and Synthetic Comparison Player 2 are explained."
        )
      )
      .respond(
        new AIMessage(
          "Synthetic Comparison Player 3 and Synthetic Comparison Player 4 are explained."
        )
      );

    const modelWithTokenCount = Object.assign(model, {
      getNumTokens: async (text: string) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      },
    });

    const modelInvoke = vi.spyOn(model, "invoke");

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 6 },
      model: modelWithTokenCount,
      modelContextProfile:
        comparisonEvidenceTest.comparisonEvidenceModelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerReferenceValidator: () => ({ status: "current" }),
      tools: [],
    });

    const config = {
      configurable: { thread_id: "comparison-projection-field-revalidation" },
    };

    const completed = await graph.invoke(
      comparisonEvidenceTest.graphStateForSavedComparison(resultJson),
      config
    );

    const evidence = completed.comparisonEvidence;
    const firstBatch = evidence?.batches[0];

    if (
      evidence?.status !== "complete" ||
      firstBatch === undefined ||
      !firstBatch.projectionJson.includes('"techniqueRaw":18,')
    ) {
      throw new Error("The comparison fixture did not complete as expected.");
    }

    const tamperedEvidence = {
      ...evidence,
      batches: evidence.batches.map((batch, index) =>
        index === 0
          ? {
              ...batch,
              projectionJson: batch.projectionJson.replace(
                '"techniqueRaw":18,',
                ""
              ),
            }
          : batch
      ),
    };

    await graph.updateState(
      config,
      { comparisonEvidence: tamperedEvidence },
      "prepare_comparison_evidence"
    );

    const recovered = await graph.invoke(null, config);
    const answer = z.string().parse(recovered.messages.at(-1)?.content);

    expect({
      answerContainsCompleteResult: answer.includes(resultJson),
      answerMarksExplanationIncomplete: answer.includes("分批解释未完成"),
      modelCalls: modelInvoke.mock.calls.length,
      partialModelExplanationWasNotPublished: !answer.includes(
        "The first pair is explained."
      ),
    }).toStrictEqual({
      answerContainsCompleteResult: true,
      answerMarksExplanationIncomplete: true,
      modelCalls:
        completed.contextProcessing.allowance?.consumedAdditionalCalls,
      partialModelExplanationWasNotPublished: true,
    });
  });
});
