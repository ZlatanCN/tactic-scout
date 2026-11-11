import { HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { comparisonEvidenceProjections } from "../../src/comparison-evidence.js";
import { contextProcessingHash } from "../../src/context-processing-state.js";
import { AgentState } from "../../src/state.js";
import {
  configureComparisonEvidenceTestEnvironment,
  comparisonEvidenceTest,
} from "../fixtures/comparison-evidence.js";
import {
  testModelContextProfile,
  testModelOutputLimitAdapter,
} from "../fixtures/model-context.js";

configureComparisonEvidenceTestEnvironment();

const { createAgent } = await import("../../src/agent.js");

describe("comparison evidence reservation recovery", () => {
  it("settles a reserved comparison batch after restoring its checkpoint", async () => {
    const { resultJson } = comparisonEvidenceTest.comparisonFixture();

    const baseState =
      comparisonEvidenceTest.graphStateForSavedComparison(resultJson);

    const projections = comparisonEvidenceProjections(resultJson, "saved");

    if (projections === null || projections.length !== 2) {
      throw new Error("The recovery fixture needs two comparison batches.");
    }

    const [sourceMessage] = baseState.messages;

    if (
      !(sourceMessage instanceof HumanMessage) ||
      sourceMessage.id === undefined
    ) {
      throw new Error("The saved comparison needs a stable source message ID.");
    }

    const sourceMessageId = sourceMessage.id;
    const question = z.string().parse(sourceMessage.content);
    const requestId = `message:${sourceMessageId}`;
    const questionHash = contextProcessingHash(question);
    const resultDigest = contextProcessingHash(resultJson);

    const sourceHash = contextProcessingHash(
      `saved:${sourceMessageId}:${resultDigest}:${questionHash}:comparison-evidence-v1`
    );

    const reservation = {
      chunkIndex: 1,
      maxActiveTimeMs: 119_900,
      maxAdditionalCalls: 1,
      operation: "explain_comparison_evidence" as const,
      operationId: contextProcessingHash(`${requestId}:${sourceHash}:batch:1`),
      sourceHash,
      sourceMessageId,
    };

    const interruptedState = AgentState.parse({
      ...baseState,
      comparisonEvidence: {
        batches: projections.map((projection, index) => ({
          answer: index === 0 ? "The first batch was already explained." : null,
          index,
          projectionJson: projection.projectionJson,
          recordRefs: projection.recordRefs,
          status: index === 0 ? ("ready" as const) : ("reserved" as const),
        })),
        failureReason: null,
        questionHash,
        requestId,
        resultDigest,
        source: "saved",
        sourceHash,
        sourceMessageId,
        status: "processing",
      },
      contextProcessing: {
        ...baseState.contextProcessing,
        allowance: {
          consumedActiveTimeMs: 100,
          consumedAdditionalCalls: 1,
          maxActiveTimeMs: 120_000,
          maxAdditionalCalls: 3,
          requestId,
          reservation,
        },
      },
    });

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
      contextProcessingAllowance: { maxAdditionalCalls: 3 },
      model: modelWithTokenCount,
      modelContextProfile: testModelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerReferenceValidator: () => ({ status: "current" }),
      tools: [],
    });

    const restored = await graph.invoke(interruptedState, {
      configurable: { thread_id: "comparison-reservation-recovery" },
    });

    const answer = z.string().parse(restored.messages.at(-1)?.content);

    expect({
      allowanceCalls:
        restored.contextProcessing.allowance?.consumedAdditionalCalls,
      allowanceTimeMs:
        restored.contextProcessing.allowance?.consumedActiveTimeMs,
      answerIncludesCompleteResult: answer.includes(resultJson),
      batchStatuses: restored.comparisonEvidence?.batches.map(
        ({ status }) => status
      ),
      evidenceFailure: restored.comparisonEvidence?.failureReason,
      evidenceStatus: restored.comparisonEvidence?.status,
      modelCalls: modelInvoke.mock.calls.length,
      reservation: restored.contextProcessing.allowance?.reservation,
    }).toStrictEqual({
      allowanceCalls: 2,
      allowanceTimeMs: 120_000,
      answerIncludesCompleteResult: true,
      batchStatuses: ["ready", "failed"],
      evidenceFailure: "reservation_unknown",
      evidenceStatus: "failed",
      modelCalls: 0,
      reservation: null,
    });
  });
});
