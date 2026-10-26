import { setTimeout as delay } from "node:timers/promises";

import type { RetryPolicy } from "@langchain/langgraph";
import { isNodeTimeoutError } from "@langchain/langgraph";
import { z } from "zod/v4";

const maxExternalRequests = 3;
const modelTimeoutMs = 60_000;
const modelRequestTimeoutMs = modelTimeoutMs - 1000;
const apiTimeoutMs = 15_000;
const maxRateLimitWaitMs = 10_000;

const transientNetworkCodes = new Set([
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

const faultCategorySchema = z.enum([
  "network",
  "server",
  "timeout",
  "rate_limit",
  "quota",
  "authentication",
  "configuration",
  "invalid_response",
  "attempt_limit",
  "local_data",
]);

const faultLogEventSchema = z.enum([
  "retry",
  "repair",
  "exhausted",
  "rate_limit_retry",
]);

const externalFaultSchema = z.object({
  category: faultCategorySchema,
  durationMs: z.number().nonnegative().optional(),
  message: z.string(),
  node: z.string().optional(),
  provider: z.enum(["model", "api_football"]),
  providerCode: z.string().optional(),
  requestsUsed: z.number().int().nonnegative(),
  retryable: z.boolean(),
  runId: z.string().optional(),
  threadId: z.string().optional(),
});

type FaultCategory = z.infer<typeof faultCategorySchema>;

type ExternalFault = z.infer<typeof externalFaultSchema>;

type ExternalFaultError = Error & { fault: ExternalFault };

type FaultLogEvent = {
  attempt?: number | "unavailable";
  category: FaultCategory;
  durationMs?: number;
  event: z.infer<typeof faultLogEventSchema>;
  executionCount?: number;
  node: string;
  runId?: string;
  threadId?: string;
};

type FaultExecutionContext = {
  executionInfo?: { runId?: string; threadId?: string };
};

const createExternalFaultError = (fault: ExternalFault): ExternalFaultError =>
  Object.assign(new Error(fault.message), { fault });

const isTransientNetworkCode = (code: string | null): boolean =>
  code !== null && transientNetworkCodes.has(code);

const externalFaultFrom = (error: Error): ExternalFault | null => {
  const parsed = z.object({ fault: externalFaultSchema }).safeParse(error);

  return parsed.success ? parsed.data.fault : null;
};

const isExternalFaultError = (error: Error): error is ExternalFaultError =>
  externalFaultFrom(error) !== null;

const logFaultEvent = (event: FaultLogEvent): void => {
  try {
    console.info(
      JSON.stringify({
        component: "tactiscout",
        type: "fault",
        ...event,
        runId: event.runId ?? "unavailable",
        threadId: event.threadId ?? "unavailable",
      })
    );
  } catch {
    // Logging is best-effort and cannot replace the original outcome.
  }
};

const logLocalDataFailure = (
  node: string,
  runtime: FaultExecutionContext,
  durationMs: number,
  attempt?: number,
  executionCount?: number
): void => {
  logFaultEvent({
    attempt,
    category: "local_data",
    durationMs,
    event: "exhausted",
    executionCount,
    node,
    runId: runtime.executionInfo?.runId,
    threadId: runtime.executionInfo?.threadId,
  });
};

const createNodeRetryPolicy = (
  node: string,
  options: { retryNodeTimeout?: boolean } = {}
): RetryPolicy => ({
  backoffFactor: 2,
  initialInterval: 250,
  jitter: true,
  logWarning: false,
  maxAttempts: maxExternalRequests,
  maxInterval: 2000,
  retryOn: (error: Error) => {
    const fault = externalFaultFrom(error);
    const nodeTimedOut = isNodeTimeoutError(error);

    const retryableTimeout = nodeTimedOut && options.retryNodeTimeout !== false;

    const retryableFault =
      fault !== null &&
      fault.retryable &&
      fault.requestsUsed < maxExternalRequests;

    const retryable = retryableTimeout || retryableFault;

    if (retryable) {
      logFaultEvent({
        attempt:
          fault?.requestsUsed ?? (nodeTimedOut ? "unavailable" : undefined),
        category: fault?.category ?? "timeout",
        durationMs:
          fault?.durationMs ?? (nodeTimedOut ? error.elapsed : undefined),
        event: "retry",
        node: fault?.node ?? node,
        runId: fault?.runId,
        threadId: fault?.threadId,
      });
    }

    return retryable;
  },
});

const retryAfterMs = (headers: Headers, now = Date.now()): number | null => {
  const retryAfter = headers.get("retry-after");

  if (retryAfter === null) {
    return null;
  }

  const seconds = Number(retryAfter.trim());

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const timestamp = Date.parse(retryAfter);

  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
};

const remainingRequests = (headers: Headers): number | null => {
  const value =
    headers.get("x-ratelimit-requests-remaining") ??
    headers.get("x-ratelimit-remaining-requests");

  if (value === null || !/^\d+$/u.test(value.trim())) {
    return null;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : null;
};

const waitForRetryDelay = async (
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> => {
  if (signal === undefined) {
    await delay(milliseconds);

    return;
  }

  await delay(milliseconds, undefined, { signal });
};

const faultCategory = (error: Error): FaultCategory =>
  externalFaultFrom(error)?.category ??
  (isNodeTimeoutError(error) ? "timeout" : "network");

const faultMessage = (error: Error): string =>
  externalFaultFrom(error)?.message ?? "外部服务请求超时，本次任务没有完成。";

export {
  apiTimeoutMs,
  createExternalFaultError,
  createNodeRetryPolicy,
  externalFaultFrom,
  faultCategory,
  faultMessage,
  isExternalFaultError,
  isTransientNetworkCode,
  logFaultEvent,
  logLocalDataFailure,
  maxExternalRequests,
  maxRateLimitWaitMs,
  modelRequestTimeoutMs,
  modelTimeoutMs,
  remainingRequests,
  retryAfterMs,
  waitForRetryDelay,
};

export type { ExternalFault, FaultCategory, FaultExecutionContext };
