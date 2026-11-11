import { setTimeout as delay } from "node:timers/promises";

import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";

describe("runtime model input budget", () => {
  afterEach(() => {
    vi.stubEnv(
      "TACTISCOUT_MODEL_CONTEXT_PROFILE",
      agentGraphTest.testModelContextProfileEnvironment
    );
  });

  it("sends a finite output cap and tool schema on lookup model calls", async () => {
    const requestSchema = z
      .object({
        max_tokens: z.number().int().positive(),
        tools: z.array(
          z
            .object({
              function: z
                .object({
                  name: z.string(),
                  parameters: z.object({ type: z.string() }).passthrough(),
                })
                .passthrough(),
            })
            .passthrough()
        ),
      })
      .passthrough();

    const capturedRequests: z.output<typeof requestSchema>[] = [];
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const message = "Look up Harry Kane.";

    const search = vi.fn<PlayerSearch>((input) =>
      JSON.stringify({
        fm: { records: [], status: "not_found" },
        identityGroups: {
          canonicalGroups: [],
          registryStatus: "not_needed",
          unlinkedRecords: [],
        },
        query: input.sourceRecords,
        requestedUnderstatSeasonStartYear: input.seasonStartYear ?? null,
        understat: { records: [], status: "not_found" },
      })
    );

    const [lookupTool] = agentGraphTest.createTools(search);

    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      await delay(0);
      const requestInit = z.object({ body: z.string() }).parse(init);
      const request = requestSchema.parse(JSON.parse(requestInit.body));
      capturedRequests.push(request);

      if (capturedRequests.length === 1) {
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
                      arguments: JSON.stringify({ sourceRecords: [] }),
                      name: "search_player_records",
                    },
                    id: "lookup-search-call",
                    type: "function",
                  },
                ],
              },
            },
          ],
          created: 1_700_000_000,
          id: "chatcmpl-lookup-tool-call",
          model: "gpt-4o",
          object: "chat.completion",
          usage: {
            completion_tokens: 1,
            prompt_tokens: 20,
            total_tokens: 21,
          },
        });
      }

      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            message: {
              content: "The selected player records were checked.",
              role: "assistant",
            },
          },
        ],
        created: 1_700_000_000,
        id: "chatcmpl-lookup-answer",
        model: "gpt-4o",
        object: "chat.completion",
        usage: { completion_tokens: 5, prompt_tokens: 25, total_tokens: 30 },
      });
    });

    const model = new ChatOpenAI({
      apiKey: "test-key",
      configuration: { baseURL: "https://gateway.test/v1", fetch: fetcher },
      maxRetries: 0,
      model: "gpt-4o",
      temperature: 0,
    });

    const graph = agentGraphTest.createAgentWithRuntime({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: {
        maxInputTokens: 100_000,
        maxOutputTokens: 512,
      },
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      playerReferenceValidator: () => ({ status: "current" }),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers("player_lookup", [
          kane.name,
        ]),
      }),
      tools: [lookupTool],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "lookup-output-cap-and-schema" } }
    );

    expect(result.messages.at(-1)?.content).toBe(
      "The selected player records were checked."
    );

    expect({
      failure: result.faultTolerance.failure,
      fetcherCalls: fetcher.mock.calls.length,
      maxTokens: capturedRequests.map(({ max_tokens }) => max_tokens),
      searchCalls: search.mock.calls.length,
      toolNames: capturedRequests.map(({ tools }) =>
        (tools ?? []).map((tool) => {
          const parsed = z
            .object({
              function: z.object({ name: z.string() }).passthrough(),
            })
            .passthrough()
            .safeParse(tool);

          return parsed.success ? parsed.data.function.name : "invalid";
        })
      ),
      toolParameterTypes: capturedRequests.map(({ tools }) =>
        tools.map(({ function: definition }) => definition.parameters.type)
      ),
    }).toStrictEqual({
      failure: null,
      fetcherCalls: 2,
      maxTokens: [512, 512],
      searchCalls: 1,
      toolNames: [["search_player_records"], ["search_player_records"]],
      toolParameterTypes: [["object"], ["object"]],
    });
  });
});
