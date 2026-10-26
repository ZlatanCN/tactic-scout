import { setTimeout as delay } from "node:timers/promises";

import { HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import type { RunnableConfig } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import { modelRequestTimeoutMs } from "../src/fault-tolerance.js";
import { createRequestUnderstandingExtractor } from "../src/request-extraction.js";
import { createInitialConversationContext } from "../src/state.js";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent } = await import("../src/agent.js");

const mockShortModelTimeout = () => {
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);

  return vi
    .spyOn(AbortSignal, "timeout")
    .mockImplementation((milliseconds) =>
      originalTimeout(milliseconds === modelRequestTimeoutMs ? 5 : milliseconds)
    );
};

describe("request understanding extraction", () => {
  it("uses tool calling and recognizes a request to add a player to the active comparison", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        comparisonAction: "replace",
        constraints: [],
        kind: "player_comparison",
        players: [
          {
            lookupName: "Erling Haaland",
            mention: "哈兰德",
            referenceScope: "explicit",
            referenceTargetMention: null,
          },
        ],
        teams: [],
      }))
    );
    const extractor = createRequestUnderstandingExtractor(model);

    const result = await extractor(
      "把哈兰德也加入对比，三人对比",
      createInitialConversationContext()
    );

    expect(structuredOutput).toHaveBeenCalledWith(expect.anything(), {
      method: "functionCalling",
    });
    expect(result).toMatchObject({
      comparisonAction: "add",
      kind: "player_comparison",
      players: [{ lookupName: "Erling Haaland", mention: "哈兰德" }],
    });
  });

  it("preserves explicit null while omitting recommendation fields the user did not mention", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        constraints: [],
        kind: "player_recommendation",
        players: [],
        recommendation: { maxAge: null },
        teams: [],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(model);

    const result = await extractor(
      "Remove the age limit from the last recommendation.",
      createInitialConversationContext()
    );

    expect({
      action: result.recommendationAction,
      recommendation: result.recommendation,
    }).toStrictEqual({
      action: "replace",
      recommendation: { maxAge: null },
    });
  });

  it("keeps the user's team mention separate from the provider search name", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        constraints: [],
        kind: "team_recommendation",
        players: [],
        recommendation: { position: "stc" },
        teamSearchName: "Arsenal",
        teams: ["阿森纳"],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(model);

    const result = await extractor(
      "为阿森纳找一个中锋",
      createInitialConversationContext()
    );

    expect(result).toMatchObject({
      kind: "team_recommendation",
      recommendation: { position: "stc" },
      teamSearchName: "Arsenal",
      teams: ["阿森纳"],
    });
  });

  it("retries a transient request, then repairs one invalid structured response", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;

        if (calls === 1) {
          throw Object.assign(new Error("temporary connection failure"), {
            code: "ECONNRESET",
          });
        }

        if (calls === 2) {
          throw Object.assign(new Error("Invalid structured request."), {
            name: "OutputParserException",
          });
        }

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-output-repair" } }
    );

    expect({
      kind: result.request.kind,
      outputCalls: calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      kind: "other",
      outputCalls: 3,
      response:
        "当前版本支持查询、比较和推荐球员资料。请说明你要完成哪一种任务。",
    });
  });

  it("does not restart extraction when the single repair request fails", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;

        if (calls === 1) {
          throw Object.assign(new Error("Invalid structured request."), {
            name: "OutputParserException",
          });
        }

        throw Object.assign(new Error("temporary connection failure"), {
          code: "ECONNRESET",
        });
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-repair-failure" } }
    );

    expect({
      outputCalls: calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      outputCalls: 2,
      response:
        "请求理解模型暂时不可用，因此没有执行这条新请求。之前已完成的结果仍保留。",
    });
    expect(result).not.toHaveProperty("request");
  });

  it("stops after a timed-out structured repair instead of restarting extraction", async () => {
    const timeoutSpy = mockShortModelTimeout();

    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(async (_input, options: RunnableConfig) => {
        calls += 1;

        if (calls === 1) {
          throw Object.assign(new Error("Invalid structured request."), {
            name: "OutputParserException",
          });
        }

        await delay(1000, undefined, { signal: options.signal });

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-repair-timeout" } }
    );

    timeoutSpy.mockRestore();

    expect({
      calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      calls: 2,
      response:
        "请求理解模型暂时不可用，因此没有执行这条新请求。之前已完成的结果仍保留。",
    });
    expect(result).not.toHaveProperty("request");
  });

  it("retries a short model 429 only with delay and remaining-quota evidence", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;

        if (calls === 1) {
          throw Object.assign(new Error("short rate limit"), {
            code: "rate_limit_exceeded",
            headers: new Headers({
              "retry-after": "0",
              "x-ratelimit-remaining-requests": "5",
            }),
            status: 429,
          });
        }

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-short-rate-limit" } }
    );

    expect({
      kind: result.request.kind,
      outputCalls: calls,
    }).toStrictEqual({ kind: "other", outputCalls: 2 });
  });

  it("does not retry a model 429 that reports exhausted quota", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;
        throw Object.assign(new Error("quota exhausted"), {
          code: "insufficient_quota",
          headers: new Headers({
            "retry-after": "0",
            "x-ratelimit-remaining-requests": "5",
          }),
          status: 429,
        });
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-quota" } }
    );

    expect({
      outputCalls: calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      outputCalls: 1,
      response:
        "模型服务额度已用完。本次请求没有完成，已确认的数据和之前的结果仍保留。",
    });
  });

  it("retries a recognized model-attempt timeout", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;

        if (calls === 1) {
          throw Object.assign(new Error("model request timed out"), {
            name: "TimeoutError",
          });
        }

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-attempt-timeout" } }
    );

    expect({ calls, kind: result.request.kind }).toStrictEqual({
      calls: 2,
      kind: "other",
    });
  });

  it("limits timed-out physical model requests to the shared three-request budget", async () => {
    const timeoutSpy = mockShortModelTimeout();

    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(async (_input, options: RunnableConfig) => {
        calls += 1;
        await delay(1000, undefined, { signal: options.signal });

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-timeout-budget" } }
    );

    timeoutSpy.mockRestore();

    expect({
      calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      calls: 3,
      response:
        "请求理解模型暂时不可用，因此没有执行这条新请求。之前已完成的结果仍保留。",
    });
  });

  it("propagates caller cancellation to an in-flight model request", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(async (_input, options: RunnableConfig) => {
        calls += 1;
        await delay(1000, undefined, { signal: options?.signal });

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const controller = new AbortController();

    const abortTimer = setTimeout(() => {
      controller.abort();
    }, 5);

    const pending = graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      {
        configurable: { thread_id: "request-model-cancellation" },
        signal: controller.signal,
      }
    );

    await expect(pending).rejects.toThrow("aborted");
    clearTimeout(abortTimer);

    expect(calls).toBe(1);
  });
});
