import { setTimeout as delay } from "node:timers/promises";

import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import {
  AgentState,
  agentStateSchemaVersion,
  createInitialRequestState,
} from "../../../src/state.js";
import { requestUnderstandingTest } from "../../fixtures/request-understanding.js";
import { comparisonResult } from "../../fixtures/workflow-results.js";

describe("request model budgets", () => {
  it("keeps real ChatOpenAI SDK retries inside the graph's physical request budget", async () => {
    const requestSchema = z.looseObject({
      max_tokens: z.number().int().positive(),
      tools: z.array(
        z.looseObject({
          function: z.looseObject({
            name: z.string(),
            parameters: z
              .looseObject({
                properties: z.record(z.string(), z.unknown()).optional(),
              })
              .optional(),
          }),
        })
      ),
    });

    const outputLimits: number[] = [];

    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      await delay(0);
      const requestInit = z.object({ body: z.string() }).parse(init);
      const request = requestSchema.parse(JSON.parse(requestInit.body));
      outputLimits.push(request.max_tokens);
      const functionName = request.tools[0]?.function.name;

      const schemaProperties = Object.keys(
        request.tools[0]?.function.parameters?.properties ?? {}
      );

      expect(schemaProperties).toStrictEqual(
        expect.arrayContaining(["constraints", "kind", "players", "teams"])
      );

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

    vi.spyOn(model, "getNumTokens").mockImplementation(async (text) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    });

    const graph = requestUnderstandingTest.createAgentWithRuntime({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: {
        maxInputTokens: 100_000,
        maxOutputTokens: 512,
      },
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "chat-openai-physical-budget" } }
    );

    expect({
      kind: result.request.kind,
      outputLimits,
      physicalRequests: fetcher.mock.calls.length,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      kind: "other",
      outputLimits: [512, 512],
      physicalRequests: 2,
      response:
        "当前版本支持查询、比较和推荐球员资料。请说明你要完成哪一种任务。",
    });
  }, 30_000);

  it("adds the finite output cap to a saved-result answer request", async () => {
    const requestSchema = z.looseObject({
      max_tokens: z.number().int().positive(),
      messages: z.array(z.looseObject({ content: z.unknown().optional() })),
    });

    const capturedRequests: z.output<typeof requestSchema>[] = [];

    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      await delay(0);
      const requestInit = z.object({ body: z.string() }).parse(init);
      capturedRequests.push(requestSchema.parse(JSON.parse(requestInit.body)));

      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            message: {
              content: "The saved comparison is ready to explain.",
              role: "assistant",
            },
          },
        ],
        created: 1_700_000_000,
        id: "chatcmpl-saved-answer",
        model: "gpt-4o",
        object: "chat.completion",
        usage: {
          completion_tokens: 5,
          prompt_tokens: 30,
          total_tokens: 35,
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
      model: "gpt-4o",
      temperature: 0,
    });

    vi.spyOn(model, "getNumTokens").mockImplementation(async (text) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    });

    const message = new HumanMessage({
      content: "Explain the saved comparison.",
      id: "saved-answer-output-cap",
    });

    const resultJson = comparisonResult(
      ["Player Alpha", "Player Beta"],
      "ready"
    );

    const state = AgentState.parse({
      messages: [message],
      outcome: {
        kind: "player_comparison",
        resultJson,
        source: "saved",
        status: "ready",
      },
      request: {
        ...createInitialRequestState(),
        processedMessageId: message.id,
      },
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const graph = requestUnderstandingTest.createAgentWithRuntime({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: {
        maxInputTokens: 100_000,
        maxOutputTokens: 384,
      },
    });

    const result = await graph.invoke(state, {
      configurable: { thread_id: "saved-answer-output-cap" },
    });

    expect({
      capturedRequests: capturedRequests.length,
      hasSavedEvidence: capturedRequests[0]?.messages.some(({ content }) => {
        const parsedContent = z.string().safeParse(content);

        return parsedContent.success && parsedContent.data.includes(resultJson);
      }),
      maxTokens: capturedRequests[0]?.max_tokens,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      capturedRequests: 1,
      hasSavedEvidence: true,
      maxTokens: 384,
      response: "The saved comparison is ready to explain.",
    });
  });

  it("caps Responses API output and includes the structured schema", async () => {
    const requestSchema = z.looseObject({
      max_output_tokens: z.number().int().positive(),
      tool_choice: z.unknown(),
      tools: z.array(
        z.looseObject({
          name: z.string(),
          parameters: z.looseObject({
            properties: z.record(z.string(), z.unknown()),
          }),
          type: z.literal("function"),
        })
      ),
    });

    const capturedRequests: z.output<typeof requestSchema>[] = [];

    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      await delay(0);
      const requestInit = z.object({ body: z.string() }).parse(init);
      capturedRequests.push(requestSchema.parse(JSON.parse(requestInit.body)));

      return Response.json({
        created_at: 1_700_000_000,
        error: null,
        id: "resp-structured-request",
        incomplete_details: null,
        instructions: null,
        metadata: null,
        model: "gpt-6-luna",
        object: "response",
        output: [
          {
            arguments: JSON.stringify({
              constraints: [],
              kind: "other",
              players: [],
              teams: [],
            }),
            call_id: "call-structured-request",
            id: "fc-structured-request",
            name: "extract",
            status: "completed",
            type: "function_call",
          },
        ],
        output_text: "",
        parallel_tool_calls: true,
        status: "completed",
        temperature: 0,
        tool_choice: { name: "extract", type: "function" },
        usage: {
          input_tokens: 12,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 8,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 20,
        },
      });
    });

    const model = new ChatOpenAI({
      apiKey: "test-key",
      configuration: { baseURL: "https://gateway.test/v1", fetch: fetcher },
      maxRetries: 0,
      model: "gpt-6-luna",
      temperature: 0,
      useResponsesApi: true,
    });

    vi.spyOn(model, "getNumTokens").mockImplementation(async (text) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    });

    const graph = requestUnderstandingTest.createAgentWithRuntime({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: {
        maxInputTokens: 100_000,
        maxOutputTokens: 512,
      },
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "responses-api-output-cap" } }
    );

    const [capturedRequest] = capturedRequests;

    if (capturedRequest === undefined) {
      throw new Error("The Responses API request was not captured.");
    }

    expect({
      kind: result.request.kind,
      maxOutputTokens: capturedRequest.max_output_tokens,
      response: result.messages.at(-1)?.content,
      structuredProperties: Object.keys(
        capturedRequest.tools[0]?.parameters.properties ?? {}
      ).toSorted(),
      toolChoice: capturedRequest.tool_choice,
      toolName: capturedRequest.tools[0]?.name,
    }).toStrictEqual({
      kind: "other",
      maxOutputTokens: 512,
      response:
        "当前版本支持查询、比较和推荐球员资料。请说明你要完成哪一种任务。",
      structuredProperties: [
        "comparisonAction",
        "constraints",
        "continuationAction",
        "kind",
        "playerMemoryManagement",
        "players",
        "recommendation",
        "recommendationAction",
        "teamSearchName",
        "teams",
      ],
      toolChoice: { name: "extract", type: "function" },
      toolName: "extract",
    });
  });
});
