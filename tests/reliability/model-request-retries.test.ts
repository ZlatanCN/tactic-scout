import { setTimeout as delay } from "node:timers/promises";

import { HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import type { RunnableConfig } from "@langchain/core/runnables";
import { MemorySaver, NodeTimeoutError } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import type { ModelRequestBudget } from "../../src/model-requests.js";
import { createRequestUnderstandingExtractor } from "../../src/request-extraction.js";
import { createInitialConversationContext } from "../../src/state.js";
import { testModelContextConfiguration } from "../fixtures/model-context.js";
import { requestUnderstandingTest } from "../fixtures/request-understanding.js";

describe("request model retries and cancellation", () => {
  it("retries a transient request, then repairs one invalid structured response", async () => {
    const model = requestUnderstandingTest.fakeModel();
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

    const graph = requestUnderstandingTest.createAgent({
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
    const model = requestUnderstandingTest.fakeModel();
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

    const graph = requestUnderstandingTest.createAgent({
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
      response: "请求理解模型暂时不可用，因此没有执行这条新请求。",
    });
    expect(result).not.toHaveProperty("request");
  });

  it("reminds structured-output repair to include required request fields", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let repairFeedback = "";
    let requestsUsed = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from((messages: BaseMessage[]) => {
        const userMessage = z.string().parse(messages.at(-1)?.content);

        const input = z
          .looseObject({
            currentMessage: z.string(),
            validationFeedback: z.string().optional(),
          })
          .parse(JSON.parse(userMessage));

        if (input.validationFeedback === undefined) {
          throw Object.assign(new Error("Invalid structured request."), {
            name: "OutputParserException",
          });
        }

        repairFeedback = input.validationFeedback;

        return {
          constraints: [],
          continuationAction: "refine",
          kind: null,
          players: [],
          recommendation: { maxAge: 21 },
          recommendationAction: "refine",
          teams: [],
        };
      })
    );

    const budget: ModelRequestBudget = {
      canMakeRequest: () => true,
      invoke: async <Value>(
        request: (signal?: AbortSignal) => Promise<Value>
      ) => {
        requestsUsed += 1;

        return await request();
      },
      lastRequestDurationMs: () => 0,
      logRepair: () => {},
      requestsUsed: () => requestsUsed,
    };

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const result = await extractor(
      "把年龄上限设为 21 岁。",
      createInitialConversationContext(),
      budget
    );

    expect({
      hasRequiredFields: ["constraints", "kind", "players", "teams"].every(
        (field) => repairFeedback.includes(field)
      ),
      maxAge: result.recommendation?.maxAge,
      removesNullComparisonAction: repairFeedback.includes("comparisonAction"),
      requestsUsed,
    }).toStrictEqual({
      hasRequiredFields: true,
      maxAge: 21,
      removesNullComparisonAction: true,
      requestsUsed: 2,
    });
  });

  it("stops after a timed-out structured repair instead of restarting extraction", async () => {
    const timeoutSpy = requestUnderstandingTest.mockShortModelTimeout();

    const model = requestUnderstandingTest.fakeModel();
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

    const graph = requestUnderstandingTest.createAgent({
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
      response: "请求理解模型暂时不可用，因此没有执行这条新请求。",
    });
    expect(result).not.toHaveProperty("request");
  });

  it("retries a short model 429 only with delay and remaining-quota evidence", async () => {
    const model = requestUnderstandingTest.fakeModel();
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

    const graph = requestUnderstandingTest.createAgent({
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

  it("does not restart a model node after a timeout following an internal 429 retry", async () => {
    const model = requestUnderstandingTest.fakeModel();
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

        throw new NodeTimeoutError({
          elapsed: 60_000,
          kind: "run",
          node: "understand_request",
          runTimeout: 60_000,
        });
      })
    );

    const graph = requestUnderstandingTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-rate-timeout-budget" } }
    );

    expect({
      calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      calls: 2,
      response: "请求理解模型暂时不可用，因此没有执行这条新请求。",
    });
  });

  it("uses the final physical request after a short-429 retry has a transient failure", async () => {
    const model = requestUnderstandingTest.fakeModel();
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

        if (calls === 2) {
          throw Object.assign(new Error("temporary network failure"), {
            code: "ECONNRESET",
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

    const graph = requestUnderstandingTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-429-then-transient" } }
    );

    expect({ calls, kind: result.request.kind }).toStrictEqual({
      calls: 3,
      kind: "other",
    });
  });

  it("does not retry a model 429 that reports exhausted quota", async () => {
    const model = requestUnderstandingTest.fakeModel();
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

    const graph = requestUnderstandingTest.createAgent({
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
      response: "模型服务额度已用完，本次请求没有完成。",
    });
  });

  it("does not retry a model 429 with a non-standard quota code", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;
        throw Object.assign(new Error("organization quota exhausted"), {
          code: "organization_quota_exceeded",
          headers: new Headers({
            "retry-after": "0",
            "x-ratelimit-remaining-requests": "5",
          }),
          status: 429,
        });
      })
    );

    const graph = requestUnderstandingTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-organization-quota" } }
    );

    expect({
      calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      calls: 1,
      response: "模型服务额度已用完，本次请求没有完成。",
    });
  });

  it("does not retry a model 429 without positive remaining-quota evidence", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;
        throw Object.assign(new Error("rate limit without quota evidence"), {
          code: "rate_limit_exceeded",
          headers: new Headers({ "retry-after": "0" }),
          status: 429,
        });
      })
    );

    const graph = requestUnderstandingTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-429-no-quota-evidence" } }
    );

    expect({
      calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      calls: 1,
      response: "模型服务正在限流，本次请求没有完成。",
    });
  });

  it("does not wait beyond the model rate-limit wait bound", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;
        throw Object.assign(new Error("long rate limit"), {
          code: "rate_limit_exceeded",
          headers: new Headers({
            "retry-after": "20",
            "x-ratelimit-remaining-requests": "5",
          }),
          status: 429,
        });
      })
    );

    const graph = requestUnderstandingTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-long-rate-limit" } }
    );

    expect({
      calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      calls: 1,
      response: "模型服务正在限流，本次请求没有完成。",
    });
  });

  it("retries a recognized model-attempt timeout", async () => {
    const model = requestUnderstandingTest.fakeModel();
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

    const graph = requestUnderstandingTest.createAgent({
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

  it("ignores late model responses and caps timed-out physical requests at three", async () => {
    const timeoutSpy = requestUnderstandingTest.mockShortModelTimeout();

    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(async () => {
        calls += 1;
        await delay(20);

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = requestUnderstandingTest.createAgent({
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
      response: "请求理解模型暂时不可用，因此没有执行这条新请求。",
    });
  });

  it("propagates caller cancellation to an in-flight model request", async () => {
    const model = requestUnderstandingTest.fakeModel();
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

    const graph = requestUnderstandingTest.createAgent({
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
