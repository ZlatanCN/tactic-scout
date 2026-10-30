import { once } from "node:events";
import { createServer } from "node:http";

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { createEvaluationGatewayProxy } from "../evals/gateway-proxy.js";

const createFakeUpstream = async (responses: unknown[]) => {
  const server = createServer((_request, response) => {
    const body = responses.shift();

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body ?? {}));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = z
    .object({ port: z.number().int().positive() })
    .parse(server.address());

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: async () => {
      await server[Symbol.asyncDispose]();
    },
  };
};

const postModelRequest = async (baseUrl: string) =>
  await fetch(`${baseUrl}/responses`, {
    body: JSON.stringify({ input: [], model: "fixture-model" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

describe("evaluation gateway telemetry", () => {
  it("records Responses and Chat Completions usage, missing usage, and calibration role", async () => {
    const upstream = await createFakeUpstream([
      {
        model: "responses-model",
        usage: { input_tokens: 0, output_tokens: 4, total_tokens: 4 },
      },
      {
        model: "chat-model",
        usage: { completion_tokens: 2, prompt_tokens: 7, total_tokens: 9 },
      },
      { model: "calibration-model" },
    ]);

    const proxy = await createEvaluationGatewayProxy(upstream.baseUrl, 3);

    try {
      await postModelRequest(proxy.baseUrlForRole("agent"));
      await postModelRequest(proxy.baseUrlForRole("judge"));
      await postModelRequest(proxy.baseUrlForRole("calibration"));

      const metrics = proxy.metricsByRole();

      expect({
        calibrationRequests: proxy.requestsByRole().calibration,
        exchanges: proxy.exchanges().map(({ role, tokenUsage }) => ({
          role,
          tokenUsage,
        })),
        metrics: {
          agent: {
            dispatchedRequests: metrics.agent.dispatchedRequests,
            modelIds: metrics.agent.modelIds,
            requestsWithLatency: metrics.agent.latency.requestsWithLatency,
            tokenUsage: metrics.agent.tokenUsage,
          },
          calibration: {
            dispatchedRequests: metrics.calibration.dispatchedRequests,
            modelIds: metrics.calibration.modelIds,
            requestsWithLatency:
              metrics.calibration.latency.requestsWithLatency,
            tokenUsage: metrics.calibration.tokenUsage,
          },
          judge: {
            dispatchedRequests: metrics.judge.dispatchedRequests,
            modelIds: metrics.judge.modelIds,
            requestsWithLatency: metrics.judge.latency.requestsWithLatency,
            tokenUsage: metrics.judge.tokenUsage,
          },
        },
        requests: proxy.requestsByRole(),
      }).toStrictEqual({
        calibrationRequests: 1,
        exchanges: [
          {
            role: "agent",
            tokenUsage: {
              completionTokens: 4,
              promptTokens: 0,
              totalTokens: 4,
            },
          },
          {
            role: "judge",
            tokenUsage: {
              completionTokens: 2,
              promptTokens: 7,
              totalTokens: 9,
            },
          },
          { role: "calibration", tokenUsage: null },
        ],
        metrics: {
          agent: {
            dispatchedRequests: 1,
            modelIds: ["responses-model"],
            requestsWithLatency: 1,
            tokenUsage: {
              completionTokensReported: 4,
              promptTokensReported: 0,
              responsesWithCompletionTokens: 1,
              responsesWithPromptTokens: 1,
              responsesWithTotalTokens: 1,
              responsesWithUsage: 1,
              responsesWithoutUsage: 0,
              totalTokensReported: 4,
            },
          },
          calibration: {
            dispatchedRequests: 1,
            modelIds: ["calibration-model"],
            requestsWithLatency: 1,
            tokenUsage: {
              completionTokensReported: null,
              promptTokensReported: null,
              responsesWithCompletionTokens: 0,
              responsesWithPromptTokens: 0,
              responsesWithTotalTokens: 0,
              responsesWithUsage: 0,
              responsesWithoutUsage: 1,
              totalTokensReported: null,
            },
          },
          judge: {
            dispatchedRequests: 1,
            modelIds: ["chat-model"],
            requestsWithLatency: 1,
            tokenUsage: {
              completionTokensReported: 2,
              promptTokensReported: 7,
              responsesWithCompletionTokens: 1,
              responsesWithPromptTokens: 1,
              responsesWithTotalTokens: 1,
              responsesWithUsage: 1,
              responsesWithoutUsage: 0,
              totalTokensReported: 9,
            },
          },
        },
        requests: { agent: 1, calibration: 1, judge: 1 },
      });
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });
});
