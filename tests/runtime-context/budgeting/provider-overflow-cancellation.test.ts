import { setTimeout as delay } from "node:timers/promises";

import { HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import type { RunnableConfig } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";

describe("provider overflow cancellation", () => {
  it("stops recovery after cancellation without another provider request", async () => {
    const controller = new AbortController();

    const message = new HumanMessage({
      content: `Look up Harry Kane. ${"Background detail. ".repeat(140)}`,
      id: "cancel-provider-overflow-recovery",
    });

    let chunkStarted = false;
    let requestCalls = 0;
    const model = fakeModel();

    textCompactionTest.mockDeterministicTokenCount(model);

    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from(async (_input, config: RunnableConfig) => {
        requestCalls += 1;

        if (requestCalls === 1) {
          throw Object.assign(
            new Error("The request exceeds the maximum context length."),
            { code: "context_length_exceeded", status: 400 }
          );
        }

        chunkStarted = true;

        const { signal } = config;

        if (signal === undefined) {
          throw new Error("The recovery request did not receive cancellation.");
        }

        await delay(60_000, undefined, { signal });

        throw new Error("The recovery request was not cancelled.");
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 6 },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 10_000,
        maxOutputTokens: 256,
        softTriggerFraction: 0.99,
        targetFraction: 0.6,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const pendingRun = graph.invoke(
      { messages: [message] },
      {
        configurable: { thread_id: "cancel-provider-overflow-recovery" },
        signal: controller.signal,
      }
    );

    await vi.waitFor(() => {
      expect(chunkStarted).toBeTruthy();
    });
    controller.abort(new Error("The user cancelled recovery."));

    const wasCancelled = await pendingRun.then(
      () => false,
      () => true
    );

    expect({ requestCalls, wasCancelled }).toStrictEqual({
      requestCalls: 2,
      wasCancelled: true,
    });
  });
});
