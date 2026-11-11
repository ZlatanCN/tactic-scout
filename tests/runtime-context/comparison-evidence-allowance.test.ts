import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import {
  configureComparisonEvidenceTestEnvironment,
  comparisonEvidenceTest,
} from "../fixtures/comparison-evidence.js";
import { testModelOutputLimitAdapter } from "../fixtures/model-context.js";

configureComparisonEvidenceTestEnvironment();

const { createAgent } = await import("../../src/agent.js");

describe("comparison evidence allowance ablation", () => {
  it("ablation: removing one batch call from the shared grant prevents a complete explanation", async () => {
    const { resultJson } = comparisonEvidenceTest.comparisonFixture();

    const model = fakeModel().respond(
      new AIMessage("Only the first batch is explained.")
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
      contextProcessingAllowance: { maxAdditionalCalls: 1 },
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
        configurable: { thread_id: "comparison-batch-grant-ablation" },
      }
    );

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      answerContainsCompleteValidatedResult: answer.includes(resultJson),
      batchStatuses: result.comparisonEvidence?.batches.map(
        ({ status }) => status
      ),
      evidenceStatus: result.comparisonEvidence?.status,
      explanationWasNotPresentedAsComplete:
        answer.includes("分批解释未完成") &&
        !answer.includes("Only the first batch is explained."),
      modelCalls: modelInvoke.mock.calls.length,
      reservation: result.contextProcessing.allowance?.reservation,
    }).toStrictEqual({
      allowanceCalls: 1,
      answerContainsCompleteValidatedResult: true,
      batchStatuses: ["ready", "pending"],
      evidenceStatus: "allowance_exhausted",
      explanationWasNotPresentedAsComplete: true,
      modelCalls: 1,
      reservation: null,
    });
  });

  it("ablation: exhausted active time stops batch planning and preserves the full result", async () => {
    const { resultJson } = comparisonEvidenceTest.comparisonFixture();
    const model = fakeModel();

    const tokenCount = vi.fn<(text: string) => Promise<number>>(
      async (text) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      }
    );

    const modelWithTokenCount = Object.assign(model, {
      getNumTokens: tokenCount,
    });

    const modelInvoke = vi.spyOn(model, "invoke");
    let fakeNow = 0;

    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      fakeNow += 5;

      return fakeNow;
    });

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxActiveTimeMs: 1 },
      model: modelWithTokenCount,
      modelContextProfile:
        comparisonEvidenceTest.comparisonEvidenceModelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerReferenceValidator: () => ({ status: "current" }),
      tools: [],
    });

    let result: Awaited<ReturnType<typeof graph.invoke>>;

    try {
      result = await graph.invoke(
        comparisonEvidenceTest.graphStateForSavedComparison(resultJson),
        {
          configurable: { thread_id: "comparison-planning-time-ablation" },
        }
      );
    } finally {
      nowSpy.mockRestore();
    }

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      activeTimeMs: result.contextProcessing.allowance?.consumedActiveTimeMs,
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      answerContainsCompleteValidatedResult: answer.includes(resultJson),
      batchCount: result.comparisonEvidence?.batches.length,
      evidenceStatus: result.comparisonEvidence?.status,
      modelCalls: modelInvoke.mock.calls.length,
      reservation: result.contextProcessing.allowance?.reservation,
      tokenCountCalls: tokenCount.mock.calls.length,
    }).toStrictEqual({
      activeTimeMs: 1,
      allowanceCalls: 0,
      answerContainsCompleteValidatedResult: true,
      batchCount: 0,
      evidenceStatus: "allowance_exhausted",
      modelCalls: 0,
      reservation: null,
      tokenCountCalls: 0,
    });
  });
});
