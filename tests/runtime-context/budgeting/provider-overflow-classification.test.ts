import { HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import { AgentState } from "../../../src/state.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";

describe("provider overflow classification", () => {
  it("does not compact after model authentication failure", async () => {
    let requestCalls = 0;
    const model = fakeModel();

    textCompactionTest.mockDeterministicTokenCount(model);

    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from(() => {
        requestCalls += 1;

        throw Object.assign(new Error("Invalid model credentials."), {
          code: "invalid_api_key",
          status: 401,
        });
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 10_000,
        maxOutputTokens: 256,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        {
          messages: [
            new HumanMessage({ content: "Hello.", id: "auth-failure" }),
          ],
        },
        { configurable: { thread_id: "primary-overflow-auth-failure" } }
      )
    );

    expect({
      compaction: result.contextProcessing.compaction,
      fault: result.faultTolerance.failure,
      recovery: result.providerOverflowRecovery,
      requestCalls,
    }).toStrictEqual({
      compaction: null,
      fault: { category: "authentication", node: "understand_request" },
      recovery: null,
      requestCalls: 1,
    });
  });
});
