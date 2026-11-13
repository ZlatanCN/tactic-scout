import { z } from "zod/v4";

import {
  createExternalFaultError,
  externalFaultFrom,
  isTransientNetworkCode,
  logFaultEvent,
  maxExternalRequests,
  maxRateLimitWaitMs,
  modelRequestTimeoutMs,
  remainingRequests,
  retryAfterMs,
  waitForRetryDelay,
} from "./fault-tolerance.js";
import type { FaultCategory } from "./fault-tolerance.js";
import {
  createModelContextError,
  isProviderContextOverflow,
} from "./model-context.js";

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
  activeTimeUsedMs: () => number;
  canMakeRequest: () => boolean;
  lastRequestDurationMs: () => number | undefined;
  logRepair: () => void;
  remainingRequests: () => number;
  invoke: <Value>(
    request: (signal?: AbortSignal) => Promise<Value>,
    options?: { allowRateLimitRetry?: boolean }
  ) => Promise<Value>;
  requestsUsed: () => number;
  remainingActiveTimeMs: () => number;
};

type ModelRequestBudgetOptions = {
  maximumRequests?: number;
  maximumActiveTimeMs?: number;
  previousRequestsUsed?: number;
  retryTransientFailuresInternally?: boolean;
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
  if (isTransientNetworkCode(code)) {
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
  node: string,
  maximumRequests = maxExternalRequests,
  budgetOptions: ModelRequestBudgetOptions = {}
): ModelRequestBudget => {
  const requestLimit = Math.min(
    maximumRequests,
    budgetOptions.maximumRequests ?? maximumRequests
  );

  let requests = Math.min(
    requestLimit,
    Math.max(
      0,
      (runtime.executionInfo?.nodeAttempt ?? 1) - 1,
      budgetOptions.previousRequestsUsed ?? 0
    )
  );

  let latestDurationMs: number | undefined;
  let activeTimeUsedMs = 0;

  const remainingActiveTimeMs = (): number =>
    Math.max(
      0,
      (budgetOptions.maximumActiveTimeMs ?? Number.POSITIVE_INFINITY) -
        activeTimeUsedMs
    );

  const callOnce = async <Value>(
    request: (signal?: AbortSignal) => Promise<Value>
  ): Promise<ModelCall<Value>> => {
    const activeTimeRemaining = remainingActiveTimeMs();

    if (activeTimeRemaining <= 0) {
      return {
        durationMs: 0,
        failure: {
          category: "context_limit",
          message: "The context-processing time allowance is exhausted.",
          retryable: false,
        },
      };
    }

    requests += 1;
    const startedAt = Date.now();

    const timeoutSignal = AbortSignal.timeout(
      Math.min(modelRequestTimeoutMs, activeTimeRemaining)
    );

    const recordDuration = (): number => {
      latestDurationMs = Math.max(0, Date.now() - startedAt);
      activeTimeUsedMs += latestDurationMs;

      return latestDurationMs;
    };

    const signal =
      runtime.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([runtime.signal, timeoutSignal]);

    try {
      const value = await request(signal);
      const durationMs = recordDuration();

      if (runtime.signal !== undefined && runtime.signal.aborted) {
        throw (
          runtime.signal.reason ??
          new DOMException("The operation was aborted.", "AbortError")
        );
      }

      if (timeoutSignal.aborted) {
        return {
          durationMs,
          failure: {
            category: "timeout",
            message: failureMessage("timeout"),
            retryable: true,
          },
        };
      }

      return { value };
    } catch (error) {
      const durationMs = recordDuration();

      if (runtime.signal !== undefined && runtime.signal.aborted) {
        throw error;
      }

      if (timeoutSignal.aborted) {
        return {
          durationMs,
          failure: {
            category: "timeout",
            message: failureMessage("timeout"),
            retryable: true,
          },
        };
      }

      if (!(error instanceof Error)) {
        throw error;
      }

      if (isProviderContextOverflow(error)) {
        throw createModelContextError(
          "provider_overflow",
          activeTimeUsedMs,
          requests
        );
      }

      const failure = modelFailureFromError(error);

      if (failure === null) {
        throw error;
      }

      return { durationMs, failure };
    }
  };

  const waitForActiveRetryDelay = async (
    requestedMs: number
  ): Promise<void> => {
    const waitDurationMs = Math.max(
      0,
      Math.min(requestedMs, remainingActiveTimeMs())
    );

    const waitStartedAt = Date.now();

    try {
      await waitForRetryDelay(waitDurationMs, runtime.signal);
    } finally {
      activeTimeUsedMs += Math.max(0, Date.now() - waitStartedAt);
    }
  };

  const retryTransientFailures = async <Value>(
    request: (signal?: AbortSignal) => Promise<Value>,
    initialFailure: ModelCall<Value>
  ): Promise<Value> => {
    let lastFailure = initialFailure;

    for (
      let retriesRemaining = requestLimit - requests;
      retriesRemaining > 0 &&
      !("value" in lastFailure) &&
      lastFailure.failure.retryable &&
      remainingActiveTimeMs() > 0;
      retriesRemaining -= 1
    ) {
      logFaultEvent({
        attempt: requests,
        category: lastFailure.failure.category,
        durationMs: lastFailure.durationMs,
        event: "retry",
        node,
        runId: runtime.executionInfo?.runId,
        threadId: runtime.executionInfo?.threadId,
      });

      // eslint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop -- Retries share the preceding response and remaining budget.
      await waitForActiveRetryDelay(Math.floor(250 + Math.random() * 1000));
      // eslint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop -- The next model response determines the following retry.
      lastFailure = await callOnce(request);
    }

    if ("value" in lastFailure) {
      return lastFailure.value;
    }

    throw createExternalFaultError({
      category: lastFailure.failure.category,
      durationMs: activeTimeUsedMs,
      message: lastFailure.failure.message,
      node,
      provider: "model",
      providerCode: lastFailure.failure.providerCode,
      requestsUsed: requests,
      retryable: false,
      runId: runtime.executionInfo?.runId,
      threadId: runtime.executionInfo?.threadId,
    });
  };

  const finishRateLimitRetry = async <Value>(
    request: (signal?: AbortSignal) => Promise<Value>,
    retry: ModelCall<Value>
  ): Promise<Value> => {
    if ("value" in retry) {
      return retry.value;
    }

    if (retry.failure.retryable && requests < requestLimit) {
      logFaultEvent({
        attempt: requests,
        category: retry.failure.category,
        durationMs: retry.durationMs,
        event: "retry",
        node,
        runId: runtime.executionInfo?.runId,
        threadId: runtime.executionInfo?.threadId,
      });

      const waitDurationMs = Math.floor(250 + Math.random() * 1000);
      await waitForActiveRetryDelay(waitDurationMs);

      const finalAttempt = await callOnce(request);

      if ("value" in finalAttempt) {
        return finalAttempt.value;
      }

      if (budgetOptions.retryTransientFailuresInternally === true) {
        return await retryTransientFailures(request, finalAttempt);
      }

      throw createExternalFaultError({
        category: finalAttempt.failure.category,
        durationMs: finalAttempt.durationMs,
        message: finalAttempt.failure.message,
        node,
        provider: "model",
        providerCode: finalAttempt.failure.providerCode,
        requestsUsed: requests,
        retryable: false,
        runId: runtime.executionInfo?.runId,
        threadId: runtime.executionInfo?.threadId,
      });
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
  };

  const requestBudgetExhaustion = (): Error | null => {
    if (remainingActiveTimeMs() <= 0) {
      return createExternalFaultError({
        category: "context_limit",
        message: "The context-processing time allowance is exhausted.",
        node,
        provider: "model",
        requestsUsed: requests,
        retryable: false,
        runId: runtime.executionInfo?.runId,
        threadId: runtime.executionInfo?.threadId,
      });
    }

    if (requests >= requestLimit) {
      return createExternalFaultError({
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

    return null;
  };

  const invoke = async <Value>(
    request: (signal?: AbortSignal) => Promise<Value>,
    options: { allowRateLimitRetry?: boolean } = {}
  ): Promise<Value> => {
    const exhaustion = requestBudgetExhaustion();

    if (exhaustion !== null) {
      throw exhaustion;
    }

    const first = await callOnce(request);

    if ("value" in first) {
      return first.value;
    }

    const { rateLimit } = first.failure;

    const hasRetryableRateLimit =
      first.failure.category === "rate_limit" &&
      rateLimit !== undefined &&
      rateLimit.retryAfterMs <= maxRateLimitWaitMs;

    const canRetryRateLimit =
      options.allowRateLimitRetry !== false &&
      hasRetryableRateLimit &&
      requests < requestLimit;

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
      await waitForActiveRetryDelay(rateLimit.retryAfterMs);

      return await finishRateLimitRetry(request, await callOnce(request));
    }

    if (
      budgetOptions.retryTransientFailuresInternally === true &&
      first.failure.retryable
    ) {
      return await retryTransientFailures(request, first);
    }

    throw createExternalFaultError({
      category: first.failure.category,
      durationMs: first.durationMs,
      message: first.failure.message,
      node,
      provider: "model",
      providerCode: first.failure.providerCode,
      requestsUsed: requests,
      retryable: first.failure.retryable && requests < requestLimit,
      runId: runtime.executionInfo?.runId,
      threadId: runtime.executionInfo?.threadId,
    });
  };

  return {
    activeTimeUsedMs: () => activeTimeUsedMs,
    canMakeRequest: () =>
      requests < requestLimit && remainingActiveTimeMs() > 0,
    invoke,
    lastRequestDurationMs: () => latestDurationMs,
    logRepair: () => {
      logFaultEvent({
        attempt: requests,
        category: "invalid_response",
        durationMs: latestDurationMs,
        event: "repair",
        node,
        runId: runtime.executionInfo?.runId,
        threadId: runtime.executionInfo?.threadId,
      });
    },
    remainingActiveTimeMs,
    remainingRequests: () =>
      remainingActiveTimeMs() > 0 ? Math.max(0, requestLimit - requests) : 0,
    requestsUsed: () => requests,
  };
};

const isRequestOutputValidationError = (error: Error): boolean =>
  error.name === "OutputParserException" ||
  error.name === "ZodError" ||
  error.message.startsWith("Failed to parse");

const modelFailureCategory = (error: Error): FaultCategory | null =>
  externalFaultFrom(error)?.category ??
  modelFailureFromError(error)?.category ??
  null;

export {
  createModelRequestBudget,
  isRequestOutputValidationError,
  modelFailureCategory,
};

export type { ModelRequestBudget, ModelRequestBudgetOptions, ModelRuntime };
