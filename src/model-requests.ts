import { z } from "zod/v4";

import {
  createExternalFaultError,
  externalFaultFrom,
  logFaultEvent,
  maxExternalRequests,
  maxRateLimitWaitMs,
  remainingRequests,
  retryAfterMs,
  waitForRetryDelay,
} from "./fault-tolerance.js";
import type { FaultCategory } from "./fault-tolerance.js";

const headersSchema = z.union([
  z.instanceof(Headers),
  z.record(z.string(), z.string()),
]);

const modelErrorDetailsSchema = z.looseObject({
  cause: z.looseObject({ code: z.string().optional() }).optional(),
  code: z.string().nullable().optional(),
  error: z.looseObject({ code: z.string().optional() }).optional(),
  headers: headersSchema.optional(),
  name: z.string().optional(),
  response: z
    .looseObject({
      headers: headersSchema.optional(),
      status: z.number().int().nullable().optional(),
    })
    .optional(),
  status: z.number().int().nullable().optional(),
});

const networkErrorCodes = new Set([
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

type ModelFailure = {
  category: FaultCategory;
  message: string;
  providerCode?: string;
  rateLimit?: { remainingRequests: number; retryAfterMs: number };
  retryable: boolean;
};

type ModelCall<Value> =
  | { durationMs: number; failure: ModelFailure }
  | { value: Value };

type ModelRequestBudget = {
  canMakeRequest: () => boolean;
  invoke: <Value>(
    request: (signal?: AbortSignal) => Promise<Value>,
    options?: { allowRateLimitRetry?: boolean }
  ) => Promise<Value>;
  requestsUsed: () => number;
};

type ModelRuntime = {
  executionInfo?: {
    nodeAttempt?: number;
    runId?: string;
    threadId?: string;
  };
  signal?: AbortSignal;
};

const headersFrom = (
  source: z.output<typeof headersSchema> | undefined
): Headers => {
  if (source instanceof Headers) {
    return source;
  }

  const headers = new Headers();

  for (const [name, value] of Object.entries(source ?? {})) {
    headers.set(name, value);
  }

  return headers;
};

const failureMessage = (category: FaultCategory): string => {
  if (category === "authentication" || category === "configuration") {
    return "模型服务凭据或配置无效。";
  }

  if (category === "quota") {
    return "模型服务额度已用完。";
  }

  if (category === "rate_limit") {
    return "模型服务正在限流，本次没有重试。";
  }

  if (category === "invalid_response") {
    return "模型没有返回符合要求的结构化结果。";
  }

  return "模型服务暂时不可用，本次请求没有完成。";
};

const safeProviderCode = (code: string | null): string | undefined =>
  code !== null && /^[a-z0-9_-]{1,64}$/iu.test(code) ? code : undefined;

const quotaFailure = (code: string | null): ModelFailure | null =>
  code === "insufficient_quota" || code === "billing_hard_limit_reached"
    ? {
        category: "quota",
        message: failureMessage("quota"),
        providerCode: safeProviderCode(code),
        retryable: false,
      }
    : null;

const httpFailure = (
  status: number | null,
  code: string | null,
  headers: Headers
): ModelFailure | null => {
  if (status === 401 || status === 403) {
    return {
      category: "authentication",
      message: failureMessage("authentication"),
      providerCode: safeProviderCode(code),
      retryable: false,
    };
  }

  if (status === 429) {
    const left = remainingRequests(headers);
    const wait = retryAfterMs(headers);

    const rateLimit =
      left !== null && left > 0 && wait !== null
        ? { remainingRequests: left, retryAfterMs: wait }
        : undefined;

    const category =
      code !== null && code.includes("quota") ? "quota" : "rate_limit";

    return {
      category,
      message: failureMessage(category),
      providerCode: safeProviderCode(code),
      rateLimit,
      retryable: false,
    };
  }

  if (status !== null && status >= 500 && status <= 599) {
    return {
      category: "server",
      message: failureMessage("server"),
      providerCode: safeProviderCode(code),
      retryable: true,
    };
  }

  return status !== null && status >= 400 && status < 500
    ? {
        category: "configuration",
        message: failureMessage("configuration"),
        providerCode: safeProviderCode(code),
        retryable: false,
      }
    : null;
};

const transportFailure = (
  code: string | null,
  name: string | undefined
): ModelFailure | null => {
  if (code !== null && networkErrorCodes.has(code)) {
    const category = code === "ETIMEDOUT" ? "timeout" : "network";

    return {
      category,
      message: failureMessage(category),
      retryable: true,
    };
  }

  return name === "TimeoutError"
    ? {
        category: "timeout",
        message: failureMessage("timeout"),
        retryable: true,
      }
    : null;
};

const modelFailureFromError = (error: Error): ModelFailure | null => {
  const parsed = modelErrorDetailsSchema.safeParse(error);

  if (!parsed.success) {
    return null;
  }

  const details = parsed.data;

  const code =
    details.code ?? details.error?.code ?? details.cause?.code ?? null;

  const headers = headersFrom(details.headers ?? details.response?.headers);

  return (
    quotaFailure(code) ??
    httpFailure(
      details.status ?? details.response?.status ?? null,
      code,
      headers
    ) ??
    transportFailure(code, details.name)
  );
};

const createModelRequestBudget = (
  runtime: ModelRuntime,
  node: string
): ModelRequestBudget => {
  let requests = Math.max(0, (runtime.executionInfo?.nodeAttempt ?? 1) - 1);

  const callOnce = async <Value>(
    request: (signal?: AbortSignal) => Promise<Value>
  ): Promise<ModelCall<Value>> => {
    requests += 1;
    const startedAt = Date.now();

    try {
      return { value: await request(runtime.signal) };
    } catch (error) {
      if (
        (runtime.signal !== undefined && runtime.signal.aborted) ||
        !(error instanceof Error)
      ) {
        throw error;
      }

      const failure = modelFailureFromError(error);

      if (failure === null) {
        throw error;
      }

      return { durationMs: Date.now() - startedAt, failure };
    }
  };

  const invoke = async <Value>(
    request: (signal?: AbortSignal) => Promise<Value>,
    options: { allowRateLimitRetry?: boolean } = {}
  ): Promise<Value> => {
    if (requests >= maxExternalRequests) {
      throw createExternalFaultError({
        category: "attempt_limit",
        message: failureMessage("attempt_limit"),
        node,
        provider: "model",
        requestsUsed: requests,
        retryable: false,
        runId: runtime.executionInfo?.runId,
        threadId: runtime.executionInfo?.threadId,
      });
    }

    const first = await callOnce(request);

    if ("value" in first) {
      return first.value;
    }

    const { rateLimit } = first.failure;

    const canRetryRateLimit =
      options.allowRateLimitRetry !== false &&
      rateLimit !== undefined &&
      rateLimit.retryAfterMs <= maxRateLimitWaitMs &&
      requests < maxExternalRequests;

    if (canRetryRateLimit && rateLimit !== undefined) {
      logFaultEvent({
        attempt: requests,
        category: "rate_limit",
        durationMs: first.durationMs,
        event: "rate_limit_retry",
        node,
        runId: runtime.executionInfo?.runId,
        threadId: runtime.executionInfo?.threadId,
      });
      await waitForRetryDelay(rateLimit.retryAfterMs, runtime.signal);

      const retry = await callOnce(request);

      if ("value" in retry) {
        return retry.value;
      }

      throw createExternalFaultError({
        category: retry.failure.category,
        durationMs: retry.durationMs,
        message: retry.failure.message,
        node,
        provider: "model",
        providerCode: retry.failure.providerCode,
        requestsUsed: requests,
        retryable: false,
        runId: runtime.executionInfo?.runId,
        threadId: runtime.executionInfo?.threadId,
      });
    }

    throw createExternalFaultError({
      category: first.failure.category,
      durationMs: first.durationMs,
      message: first.failure.message,
      node,
      provider: "model",
      providerCode: first.failure.providerCode,
      requestsUsed: requests,
      retryable: first.failure.retryable && requests < maxExternalRequests,
      runId: runtime.executionInfo?.runId,
      threadId: runtime.executionInfo?.threadId,
    });
  };

  return {
    canMakeRequest: () => requests < maxExternalRequests,
    invoke,
    requestsUsed: () => requests,
  };
};

const isRequestOutputValidationError = (error: Error): boolean =>
  error.name === "OutputParserException" ||
  error.name === "ZodError" ||
  error.message.startsWith("Failed to parse");

const modelFailureCategory = (error: Error): FaultCategory | null =>
  externalFaultFrom(error)?.category ?? null;

export {
  createModelRequestBudget,
  isRequestOutputValidationError,
  modelFailureCategory,
};

export type { ModelRequestBudget };
