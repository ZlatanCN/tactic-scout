import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod/v4";

type EvaluationGatewayProxy = {
  baseUrlForRole: (role: EvaluationGatewayRole) => string;
  close: () => Promise<void>;
  deniedRequests: () => number;
  exchanges: () => EvaluationGatewayExchange[];
  failedRequests: () => number;
  modelRequests: () => number;
  deniedRequestsByRole: () => Record<EvaluationGatewayRole, number>;
  requestsByRole: () => Record<EvaluationGatewayRole, number>;
};

type EvaluationGatewayRole = "agent" | "calibration" | "judge";

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
    completionTokens: number;
    promptTokens: number;
    totalTokens: number;
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
      completion_tokens: z.number().int().nonnegative(),
      prompt_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

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

    try {
      const body = await requestBody(request);

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
          requestBody: redactSecrets(body, redactedSecrets),
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

      const startedAt = Date.now();

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

      exchanges.push({
        durationMs: Date.now() - startedAt,
        forwarded: true,
        model: parsedMetadata.success
          ? (parsedMetadata.data.model ?? null)
          : null,
        requestBody: redactSecrets(body, redactedSecrets),
        requestPath: forwardedPath + incomingPath.search,
        responseBody: redactSecrets(responseText, redactedSecrets),
        responseStatus: upstreamResponse.status,
        role,
        tokenUsage:
          parsedMetadata.success && parsedMetadata.data.usage !== undefined
            ? {
                completionTokens: parsedMetadata.data.usage.completion_tokens,
                promptTokens: parsedMetadata.data.usage.prompt_tokens,
                totalTokens: parsedMetadata.data.usage.total_tokens,
              }
            : null,
      });

      response.writeHead(
        upstreamResponse.status,
        responseHeaders(upstreamResponse)
      );
      response.end(responseBody);
    } catch {
      failedRequests += 1;
      exchanges.push({
        durationMs: 0,
        forwarded: true,
        model: null,
        requestBody: "",
        requestPath: forwardedPath + incomingPath.search,
        responseBody: null,
        responseStatus: null,
        role,
        tokenUsage: null,
      });
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
    modelRequests: () => modelRequests,
    requestsByRole: () => ({ ...roleCounts }),
  };
};

export { createEvaluationGatewayProxy };

export type {
  EvaluationGatewayExchange,
  EvaluationGatewayProxy,
  EvaluationGatewayRole,
};
