import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";

import { z } from "zod/v4";

type EvaluationGatewayProxy = {
  baseUrlForRole: (role: EvaluationGatewayRole) => string;
  close: () => Promise<void>;
  deniedRequests: () => number;
  exchanges: () => EvaluationGatewayExchange[];
  failedRequests: () => number;
  metricsByRole: () => Record<
    EvaluationGatewayRole,
    EvaluationGatewayRoleMetrics
  >;
  modelRequests: () => number;
  deniedRequestsByRole: () => Record<EvaluationGatewayRole, number>;
  requestsByRole: () => Record<EvaluationGatewayRole, number>;
};

type EvaluationGatewayRole = "agent" | "calibration" | "judge";

type EvaluationGatewayRoleMetrics = {
  deniedRequests: number;
  dispatchedRequests: number;
  latency: {
    averageMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    requestsWithLatency: number;
  };
  modelIds: string[];
  tokenUsage: {
    completionTokensReported: number | null;
    promptTokensReported: number | null;
    responsesWithCompletionTokens: number;
    responsesWithPromptTokens: number;
    responsesWithTotalTokens: number;
    responsesWithUsage: number;
    responsesWithoutUsage: number;
    totalTokensReported: number | null;
  };
};

type EvaluationGatewayExchange = {
  durationMs: number;
  forwarded: boolean;
  model: string | null;
  requestBody: string;
  requestPath: string;
  role: EvaluationGatewayRole;
  responseBody: string | null;
  responseStatus: number | null;
  tokenUsage: {
    completionTokens: number | null;
    promptTokens: number | null;
    totalTokens: number | null;
  } | null;
};

const blockedHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const modelResponseMetadataSchema = z.object({
  model: z.string().optional(),
  usage: z
    .object({
      completion_tokens: z.number().int().nonnegative().optional(),
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      prompt_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const roundMilliseconds = (value: number): number =>
  Math.round(value * 10) / 10;

const percentile = (values: number[], proportion: number): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * proportion) - 1);
  const value = sorted[index];

  return value === undefined ? null : roundMilliseconds(value);
};

const roleMetrics = (
  role: EvaluationGatewayRole,
  exchanges: EvaluationGatewayExchange[],
  dispatchedRequests: number,
  deniedRequests: number
): EvaluationGatewayRoleMetrics => {
  const roleExchanges = exchanges.filter(
    (exchange) => exchange.forwarded && exchange.role === role
  );

  const modelIds = [
    ...new Set(
      roleExchanges.flatMap((exchange) =>
        exchange.model === null ? [] : [exchange.model]
      )
    ),
  ].toSorted();

  const usages = roleExchanges.flatMap((exchange) =>
    exchange.tokenUsage === null ? [] : [exchange.tokenUsage]
  );

  const promptUsages = usages.flatMap(({ promptTokens }) =>
    promptTokens === null ? [] : [promptTokens]
  );

  const completionUsages = usages.flatMap(({ completionTokens }) =>
    completionTokens === null ? [] : [completionTokens]
  );

  const totalUsages = usages.flatMap(({ totalTokens }) =>
    totalTokens === null ? [] : [totalTokens]
  );

  const durations = roleExchanges.map(({ durationMs }) => durationMs);

  return {
    deniedRequests,
    dispatchedRequests,
    latency: {
      averageMs:
        durations.length === 0
          ? null
          : roundMilliseconds(
              durations.reduce((sum, duration) => sum + duration, 0) /
                durations.length
            ),
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      requestsWithLatency: durations.length,
    },
    modelIds,
    tokenUsage: {
      completionTokensReported:
        completionUsages.length === 0
          ? null
          : completionUsages.reduce((sum, value) => sum + value, 0),
      promptTokensReported:
        promptUsages.length === 0
          ? null
          : promptUsages.reduce((sum, value) => sum + value, 0),
      responsesWithCompletionTokens: completionUsages.length,
      responsesWithPromptTokens: promptUsages.length,
      responsesWithTotalTokens: totalUsages.length,
      responsesWithUsage: usages.length,
      responsesWithoutUsage: Math.max(0, dispatchedRequests - usages.length),
      totalTokensReported:
        totalUsages.length === 0
          ? null
          : totalUsages.reduce((sum, value) => sum + value, 0),
    },
  };
};

const parsedResponseFromText = (content: string) => {
  try {
    const parsed = z.json().safeParse(JSON.parse(content));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const requestBody = async (request: IncomingMessage): Promise<string> => {
  request.setEncoding("utf-8");
  const chunks: string[] = [];

  for await (const chunk of request) {
    chunks.push(z.string().parse(chunk));
  }

  return chunks.join("");
};

const requestHeaders = (request: IncomingMessage): Headers => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (blockedHeaders.has(name) || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const part of value) {
        headers.append(name, part);
      }
    } else {
      headers.set(name, value);
    }
  }

  return headers;
};

const responseHeaders = (response: Response): Record<string, string> =>
  Object.fromEntries(
    [...response.headers.entries()].filter(
      ([name]) => !blockedHeaders.has(name)
    )
  );

const replyWithError = (
  response: ServerResponse,
  status: number,
  code: string,
  message: string
): void => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      error: { code, message, type: "evaluation_proxy_error" },
    })
  );
};

const redactSecrets = (value: string, secrets: string[]): string => {
  let redacted = value;

  for (const secret of secrets) {
    if (secret.length > 0) {
      redacted = redacted.replaceAll(secret, "[REDACTED]");
    }
  }

  return redacted;
};

const createEvaluationGatewayProxy = async (
  upstreamBaseUrl: string,
  maxModelRequests: number,
  redactedSecrets: string[] = []
): Promise<EvaluationGatewayProxy> => {
  const upstream = new URL(upstreamBaseUrl);

  const upstreamPath = upstream.pathname.endsWith("/")
    ? upstream.pathname.slice(0, -1)
    : upstream.pathname;

  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
    throw new Error("The configured model gateway URL must use HTTP or HTTPS.");
  }

  let modelRequests = 0;
  let deniedRequests = 0;
  let failedRequests = 0;

  const roleCounts: Record<EvaluationGatewayRole, number> = {
    agent: 0,
    calibration: 0,
    judge: 0,
  };

  const deniedRoleCounts: Record<EvaluationGatewayRole, number> = {
    agent: 0,
    calibration: 0,
    judge: 0,
  };

  const exchanges: EvaluationGatewayExchange[] = [];

  const metricsByRole = (): Record<
    EvaluationGatewayRole,
    EvaluationGatewayRoleMetrics
  > => ({
    agent: roleMetrics(
      "agent",
      exchanges,
      roleCounts.agent,
      deniedRoleCounts.agent
    ),
    calibration: roleMetrics(
      "calibration",
      exchanges,
      roleCounts.calibration,
      deniedRoleCounts.calibration
    ),
    judge: roleMetrics(
      "judge",
      exchanges,
      roleCounts.judge,
      deniedRoleCounts.judge
    ),
  });

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    const incomingPath = new URL(request.url ?? "/", "http://localhost");

    const role = (["agent", "judge", "calibration"] as const).find((item) =>
      incomingPath.pathname.startsWith(`/${item}${upstreamPath}/`)
    );

    if (role === undefined) {
      replyWithError(
        response,
        404,
        "evaluation_role_not_found",
        "The evaluation request role is not configured."
      );

      return;
    }

    const forwardedPath = incomingPath.pathname.slice(role.length + 1);

    if (!forwardedPath.startsWith(`${upstreamPath}/`)) {
      replyWithError(
        response,
        404,
        "evaluation_route_not_found",
        "The evaluation gateway route is not configured."
      );

      return;
    }

    let sanitizedRequestBody = "";
    let upstreamStartedAt: number | null = null;

    try {
      const body = await requestBody(request);
      sanitizedRequestBody = redactSecrets(body, redactedSecrets);

      if (modelRequests >= maxModelRequests) {
        deniedRequests += 1;
        deniedRoleCounts[role] += 1;

        const responseBody = JSON.stringify({
          error: {
            code: "evaluation_budget_exhausted",
            message:
              "The evaluation-wide model request allowance is exhausted.",
            type: "rate_limit_error",
          },
        });

        exchanges.push({
          durationMs: 0,
          forwarded: false,
          model: null,
          requestBody: sanitizedRequestBody,
          requestPath: forwardedPath + incomingPath.search,
          responseBody: redactSecrets(responseBody, redactedSecrets),
          responseStatus: 429,
          role,
          tokenUsage: null,
        });
        replyWithError(
          response,
          429,
          "evaluation_budget_exhausted",
          "The evaluation-wide model request allowance is exhausted."
        );

        return;
      }

      modelRequests += 1;
      roleCounts[role] += 1;

      upstreamStartedAt = performance.now();

      const upstreamResponse = await fetch(
        upstream.origin + forwardedPath + incomingPath.search,
        {
          body: body.length > 0 ? body : undefined,
          headers: requestHeaders(request),
          method: request.method,
          redirect: "manual",
        }
      );

      const responseBody = new Uint8Array(await upstreamResponse.arrayBuffer());
      const responseText = new TextDecoder().decode(responseBody);

      const parsedMetadata = modelResponseMetadataSchema.safeParse(
        parsedResponseFromText(responseText)
      );

      const usage =
        parsedMetadata.success && parsedMetadata.data.usage !== undefined
          ? {
              completionTokens:
                parsedMetadata.data.usage.output_tokens ??
                parsedMetadata.data.usage.completion_tokens ??
                null,
              promptTokens:
                parsedMetadata.data.usage.input_tokens ??
                parsedMetadata.data.usage.prompt_tokens ??
                null,
              totalTokens: parsedMetadata.data.usage.total_tokens ?? null,
            }
          : null;

      exchanges.push({
        durationMs: performance.now() - upstreamStartedAt,
        forwarded: true,
        model: parsedMetadata.success
          ? (parsedMetadata.data.model ?? null)
          : null,
        requestBody: sanitizedRequestBody,
        requestPath: forwardedPath + incomingPath.search,
        responseBody: redactSecrets(responseText, redactedSecrets),
        responseStatus: upstreamResponse.status,
        role,
        tokenUsage:
          usage !== null && Object.values(usage).some((value) => value !== null)
            ? usage
            : null,
      });

      response.writeHead(
        upstreamResponse.status,
        responseHeaders(upstreamResponse)
      );
      response.end(responseBody);
    } catch {
      if (upstreamStartedAt !== null) {
        failedRequests += 1;
        exchanges.push({
          durationMs: performance.now() - upstreamStartedAt,
          forwarded: true,
          model: null,
          requestBody: sanitizedRequestBody,
          requestPath: forwardedPath + incomingPath.search,
          responseBody: null,
          responseStatus: null,
          role,
          tokenUsage: null,
        });
      }

      replyWithError(
        response,
        502,
        "evaluation_gateway_unavailable",
        "The configured model gateway did not return a response."
      );
    }
  };

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = z
    .object({ port: z.number().int().positive() })
    .parse(server.address());

  const baseUrlForRole = (role: EvaluationGatewayRole): string =>
    `http://127.0.0.1:${address.port}/${role}${upstreamPath}`;

  return {
    baseUrlForRole,
    close: async () => {
      await server[Symbol.asyncDispose]();
    },
    deniedRequests: () => deniedRequests,
    deniedRequestsByRole: () => ({ ...deniedRoleCounts }),
    exchanges: () => structuredClone(exchanges),
    failedRequests: () => failedRequests,
    metricsByRole,
    modelRequests: () => modelRequests,
    requestsByRole: () => ({ ...roleCounts }),
  };
};

export { createEvaluationGatewayProxy };

export type {
  EvaluationGatewayExchange,
  EvaluationGatewayProxy,
  EvaluationGatewayRole,
  EvaluationGatewayRoleMetrics,
};
