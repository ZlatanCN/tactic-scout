import { setTimeout as delay } from "node:timers/promises";

import { HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import type { RunnableConfig } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver, NodeTimeoutError } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

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

  it("keeps real ChatOpenAI SDK retries inside the graph's physical request budget", async () => {
    const requestSchema = z.looseObject({
      tools: z.array(
        z.looseObject({
          function: z.looseObject({ name: z.string() }),
        })
      ),
    });

    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      await delay(0);
      const requestInit = z.object({ body: z.string() }).parse(init);
      const request = requestSchema.parse(JSON.parse(requestInit.body));
      const functionName = request.tools[0]?.function.name;

      if (functionName === undefined) {
        throw new Error(
          "The request did not include the structured-output tool."
        );
      }

      if (fetcher.mock.calls.length === 1) {
        return Response.json(
          { error: { message: "temporary upstream error" } },
          { status: 503 }
        );
      }

      return Response.json({
        choices: [
          {
            finish_reason: "tool_calls",
            index: 0,
            message: {
              content: null,
              role: "assistant",
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({
                      constraints: [],
                      kind: "other",
                      players: [],
                      teams: [],
                    }),
                    name: functionName,
                  },
                  id: "structured-request-1",
                  type: "function",
                },
              ],
            },
          },
        ],
        created: 1_700_000_000,
        id: "chatcmpl-fault-test",
        model: "fault-test",
        object: "chat.completion",
        usage: {
          completion_tokens: 1,
          prompt_tokens: 1,
          total_tokens: 2,
        },
      });
    });

    const model = new ChatOpenAI({
      apiKey: "test-key",
      configuration: {
        baseURL: "https://gateway.test/v1",
        fetch: fetcher,
      },
      maxRetries: 0,
      model: "fault-test",
      temperature: 0,
    });

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "chat-openai-physical-budget" } }
    );

    expect({
      kind: result.request.kind,
      physicalRequests: fetcher.mock.calls.length,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      kind: "other",
      physicalRequests: 2,
      response:
        "当前版本支持查询、比较和推荐球员资料。请说明你要完成哪一种任务。",
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

  it("does not restart a model node after a timeout following an internal 429 retry", async () => {
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

        throw new NodeTimeoutError({
          elapsed: 60_000,
          kind: "run",
          node: "understand_request",
          runTimeout: 60_000,
        });
      })
    );

    const graph = createAgent({
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
      response:
        "请求理解模型暂时不可用，因此没有执行这条新请求。之前已完成的结果仍保留。",
    });
  });

  it("uses the final physical request after a short-429 retry has a transient failure", async () => {
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

    const graph = createAgent({
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

  it("does not retry a model 429 with a non-standard quota code", async () => {
    const model = fakeModel();
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

    const graph = createAgent({
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
      response:
        "模型服务额度已用完。本次请求没有完成，已确认的数据和之前的结果仍保留。",
    });
  });

  it("does not retry a model 429 without positive remaining-quota evidence", async () => {
    const model = fakeModel();
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

    const graph = createAgent({
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
      response:
        "模型服务正在限流。本次请求没有完成，已确认的数据和之前的结果仍保留。",
    });
  });

  it("does not wait beyond the model rate-limit wait bound", async () => {
    const model = fakeModel();
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

    const graph = createAgent({
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
      response:
        "模型服务正在限流。本次请求没有完成，已确认的数据和之前的结果仍保留。",
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

  it("ignores late model responses and caps timed-out physical requests at three", async () => {
    const timeoutSpy = mockShortModelTimeout();

    const model = fakeModel();
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
