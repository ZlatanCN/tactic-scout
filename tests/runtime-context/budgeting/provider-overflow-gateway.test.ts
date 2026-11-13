import { setTimeout as delay } from "node:timers/promises";

import { MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { agentGraphTest } from "../../fixtures/agent-graph.js";
import {
  configureComparisonEvidenceTestEnvironment,
  comparisonEvidenceTest,
} from "../../fixtures/comparison-evidence.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";

configureComparisonEvidenceTestEnvironment();

const requestSchema = z.looseObject({
  max_completion_tokens: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  max_tokens: z.number().int().positive().optional(),
  messages: z.array(z.looseObject({ content: z.unknown(), role: z.string() })),
});

const comparisonProjectionSchema = z.object({
  selectedPlayers: z.array(z.object({ playerName: z.string() })),
});

const usageLogSchema = z.object({
  estimatedInputTokens: z.number().int().nonnegative(),
  providerInputTokens: z.number().int().nonnegative().nullable(),
  providerUsageStatus: z.enum(["reported", "unavailable"]),
});

describe("provider overflow recovery through a local ChatOpenAI gateway", () => {
  it("splits comparison requests and logs estimates separately from provider usage", async () => {
    const requests: z.output<typeof requestSchema>[] = [];
    const requestedParticipantCounts: number[] = [];
    const finishReasons: string[] = [];
    const usageLogs: string[] = [];
    const fetchErrors: string[] = [];

    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      try {
        await delay(0);
        const requestInit = z.object({ body: z.string() }).parse(init);
        const request = requestSchema.parse(JSON.parse(requestInit.body));
        requests.push(request);
        const humanContent = z.string().parse(request.messages.at(-1)?.content);
        const marker = "Comparison evidence projection JSON:\n";
        const [projectionJson] = humanContent.split(marker).slice(1);

        if (projectionJson === undefined) {
          requestedParticipantCounts.push(0);

          return Response.json(
            {
              error: {
                code: "context_length_exceeded",
                message: "The request exceeds the maximum context length.",
              },
            },
            { status: 400 }
          );
        }

        const projection = comparisonProjectionSchema.parse(
          JSON.parse(projectionJson)
        );

        requestedParticipantCounts.push(projection.selectedPlayers.length);

        if (projection.selectedPlayers.length > 1) {
          return Response.json(
            {
              error: {
                code: "context_length_exceeded",
                message: "The request exceeds the maximum context length.",
              },
            },
            { status: 400 }
          );
        }

        finishReasons.push("stop");

        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: {
                content: `${projection.selectedPlayers[0]?.playerName} was reviewed.`,
                role: "assistant",
              },
            },
          ],
          created: 1_700_000_000,
          id: `chatcmpl-comparison-${requests.length}`,
          model: "gpt-4o",
          object: "chat.completion",
          usage: {
            completion_tokens: 5,
            prompt_tokens: 40 + requests.length,
            total_tokens: 45 + requests.length,
          },
        });
      } catch (error) {
        fetchErrors.push(
          error instanceof Error ? error.message : String(error)
        );

        throw error;
      }
    });

    const model = new ChatOpenAI({
      apiKey: "test-key",
      configuration: { baseURL: "https://gateway.test/v1", fetch: fetcher },
      maxRetries: 0,
      maxTokens: 256,
      model: "overflow-recovery-test",
      temperature: 0,
    });

    vi.spyOn(model, "getNumTokens").mockImplementation(async (text) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    });

    vi.spyOn(console, "info").mockImplementation((message) => {
      const parsed = z.string().safeParse(message);

      if (
        parsed.success &&
        parsed.data.includes('"type":"model_context_usage"')
      ) {
        usageLogs.push(parsed.data);
      }
    });

    const { players, resultJson } = comparisonEvidenceTest.comparisonFixture();

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 6 },
      model,
      modelContextProfile: {
        ...comparisonEvidenceTest.comparisonEvidenceModelContextProfile,
        softTriggerFraction: 0.01,
        targetFraction: 0.001,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      tools: [],
    });

    const result = await graph.invoke(
      comparisonEvidenceTest.graphStateForSavedComparison(resultJson),
      { configurable: { thread_id: "comparison-provider-overflow-gateway" } }
    );

    const firstUsageLog = usageLogSchema.parse(
      JSON.parse(usageLogs[0] ?? "{}")
    );

    const estimateAndUsageDiffer =
      firstUsageLog.providerInputTokens !== null &&
      firstUsageLog.providerInputTokens !== firstUsageLog.estimatedInputTokens;

    const answer = z.string().parse(result.messages.at(-1)?.content);

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      fetchErrors,
      finishReasons: finishReasons.length,
      names: players.map(({ playerName }) => answer.includes(playerName)),
      outputCaps: requests.map(
        ({ max_completion_tokens, max_output_tokens, max_tokens }) =>
          max_tokens ?? max_completion_tokens ?? max_output_tokens ?? null
      ),
      physicalRequests: fetcher.mock.calls.length,
      requestedParticipantCounts,
      usage: {
        estimateAndUsageDiffer,
        estimatedInputTokens: firstUsageLog.estimatedInputTokens > 0,
        providerInputTokens: firstUsageLog.providerInputTokens !== null,
        status: firstUsageLog.providerUsageStatus,
      },
    }).toStrictEqual({
      allowanceCalls: 6,
      fetchErrors: [],
      finishReasons: 4,
      names: [true, true, true, true],
      outputCaps: [256, 256, 256, 256, 256, 256],
      physicalRequests: 6,
      requestedParticipantCounts: [2, 1, 1, 2, 1, 1],
      usage: {
        estimateAndUsageDiffer: true,
        estimatedInputTokens: true,
        providerInputTokens: true,
        status: "reported",
      },
    });
  });
});
