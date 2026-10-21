import { ChatOpenAI } from "@langchain/openai";
import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";

export const DEFAULT_OPENAI_TIMEOUT_MS = 180_000;
export const DEFAULT_OPENAI_MAX_OUTPUT_TOKENS = 8_192;
export const DEFAULT_OPENAI_EXPANSION_TIMEOUT_MS = 60_000;
export const DEFAULT_OPENAI_EXPANSION_MAX_OUTPUT_TOKENS = 1_024;
export const DEFAULT_OPENAI_PLANNER_MAX_OUTPUT_TOKENS = 2_048;
export const DEFAULT_OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS = 2_048;
export const DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS = 1_024;
export const DEFAULT_CONTEXT_COMPACTION_RATIO = 0.9;

export type ModelRetryReason = "rate_limit" | "request_timeout" | "server_error" | "network_error";

export interface ModelRetryNotice {
  attempt: number;
  maxRetries: number;
  reason: ModelRetryReason;
}

export interface ModelAttemptBudget {
  attempts: number;
  retries: number;
  readonly maxAttempts: number;
  readonly maxRetries: number;
  readonly signal?: AbortSignal;
  readonly onRetry?: (notice: ModelRetryNotice) => void;
}

export const MAX_MODEL_ATTEMPTS_PER_OPERATION = 4;
export const MAX_AUTOMATIC_MODEL_RETRIES_PER_OPERATION = 1;

export function createModelAttemptBudget(input: {
  signal?: AbortSignal;
  onRetry?: (notice: ModelRetryNotice) => void;
} = {}): ModelAttemptBudget {
  return {
    attempts: 0,
    retries: 0,
    maxAttempts: MAX_MODEL_ATTEMPTS_PER_OPERATION,
    maxRetries: MAX_AUTOMATIC_MODEL_RETRIES_PER_OPERATION,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onRetry ? { onRetry: input.onRetry } : {}),
  };
}

export class ModelAttemptBudgetExceededError extends Error {
  constructor(readonly maxAttempts = MAX_MODEL_ATTEMPTS_PER_OPERATION) {
    super(`The model operation reached its ${maxAttempts}-request safety limit.`);
    this.name = "ModelAttemptBudgetExceededError";
  }
}

export function isTransientModelFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof ModelAttemptBudgetExceededError || transientNetworkError(current)) return true;
    if (typeof current !== "object") break;
    const record = current as { status?: unknown; cause?: unknown };
    if (typeof record.status === "number" && (record.status === 408 || record.status === 429 || record.status >= 500 && record.status <= 599)) return true;
    current = record.cause;
  }
  return false;
}

const modelAttemptContext = new AsyncLocalStorage<ModelAttemptBudget>();

/** Share one retry and four total provider requests across compaction and repair calls. */
export function invokeWithModelAttemptBudget<T>(
  budget: ModelAttemptBudget,
  operation: () => Promise<T>,
): Promise<T> {
  return modelAttemptContext.run(budget, async () => {
    try {
      return await operation();
    } catch (error) {
      if (budget.signal?.aborted || !isChatModelTimeout(error) || !consumeRetry(budget, "request_timeout")) throw error;
      await waitBeforeRetry(jitteredBackoffMs(), budget.signal);
      return operation();
    }
  });
}

export function modelContextWindowTokens(value = process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS): number | undefined {
  if (!value?.trim()) return undefined;
  const tokens = Number(value);
  if (!Number.isSafeInteger(tokens) || tokens < 4_096 || tokens > 258_000) {
    throw new Error("TACTISCOUT_CONTEXT_WINDOW_TOKENS must be an integer between 4096 and 258000.");
  }
  return tokens;
}

export function contextCompactionRatio(value = process.env.TACTISCOUT_CONTEXT_COMPACTION_RATIO): number {
  if (!value?.trim()) return DEFAULT_CONTEXT_COMPACTION_RATIO;
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio < 0.5 || ratio > 0.98) {
    throw new Error("TACTISCOUT_CONTEXT_COMPACTION_RATIO must be a number between 0.5 and 0.98.");
  }
  return ratio;
}

export function contextSafetyMarginTokens(value = process.env.TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS): number {
  if (!value?.trim()) return DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS;
  const tokens = Number(value);
  if (!Number.isSafeInteger(tokens) || tokens < 0 || tokens > 32_768) {
    throw new Error("TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS must be an integer between 0 and 32768.");
  }
  return tokens;
}

export type StructuredOutputMethod = "functionCalling" | "jsonSchema" | "jsonMode";

function isLocalOllamaEndpoint(value: string | undefined): boolean {
  try { return Boolean(value && isLoopbackModelEndpoint(value) && new URL(value).port === "11434"); } catch { return false; }
}

export function isLoopbackModelEndpoint(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "localhost"
      || hostname.endsWith(".localhost")
      || (isIP(hostname) === 4 && hostname.startsWith("127."))
      || (isIP(hostname) === 6 && hostname === "::1");
  } catch {
    return false;
  }
}

export function structuredOutputMethod(
  baseURL = process.env.OPENAI_BASE_URL,
  configuredMethod = process.env.OPENAI_STRUCTURED_OUTPUT_METHOD,
): StructuredOutputMethod {
  const configured = configuredMethod?.trim();
  if (configured && configured !== "auto") {
    if (configured === "functionCalling" || configured === "jsonSchema" || configured === "jsonMode") return configured;
    throw new Error("OPENAI_STRUCTURED_OUTPUT_METHOD must be auto, functionCalling, jsonSchema, or jsonMode.");
  }

  if (baseURL?.trim()) {
    try {
      const endpoint = new URL(baseURL);
      const hostname = endpoint.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      if (endpoint.port === "11434" && ["localhost", "127.0.0.1", "::1"].includes(hostname)) {
        return "jsonSchema";
      }
    } catch {
      // Let the API client report malformed URLs without guessing a provider-specific format.
    }
  }
  return "functionCalling";
}

export function openAIRequestTimeoutMs(value = process.env.OPENAI_TIMEOUT_MS): number {
  if (!value?.trim()) return DEFAULT_OPENAI_TIMEOUT_MS;
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
    throw new Error("OPENAI_TIMEOUT_MS must be an integer between 1000 and 600000 milliseconds.");
  }
  return timeoutMs;
}

export function openAIExpansionRequestTimeoutMs(
  value = process.env.OPENAI_EXPANSION_TIMEOUT_MS,
  generalTimeout = process.env.OPENAI_TIMEOUT_MS,
): number {
  const timeoutMs = value?.trim() ? Number(value) : DEFAULT_OPENAI_EXPANSION_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > DEFAULT_OPENAI_TIMEOUT_MS) {
    throw new Error(`OPENAI_EXPANSION_TIMEOUT_MS must be an integer between 1000 and ${DEFAULT_OPENAI_TIMEOUT_MS} milliseconds.`);
  }
  return Math.min(timeoutMs, openAIRequestTimeoutMs(generalTimeout));
}

export function openAIMaxOutputTokens(value = process.env.OPENAI_MAX_OUTPUT_TOKENS): number {
  if (!value?.trim()) return DEFAULT_OPENAI_MAX_OUTPUT_TOKENS;
  const maxOutputTokens = Number(value);
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 32_768) {
    throw new Error("OPENAI_MAX_OUTPUT_TOKENS must be an integer between 256 and 32768.");
  }
  return maxOutputTokens;
}

function boundedStageOutputTokens(
  value: string | undefined,
  envName: string,
  defaultBudget: number,
  generalBudget: string | undefined,
): number {
  const maxOutputTokens = value?.trim() ? Number(value) : defaultBudget;
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > DEFAULT_OPENAI_MAX_OUTPUT_TOKENS) {
    throw new Error(`${envName} must be an integer between 256 and ${DEFAULT_OPENAI_MAX_OUTPUT_TOKENS}.`);
  }
  return Math.min(maxOutputTokens, openAIMaxOutputTokens(generalBudget));
}

export function openAIConclusionMaxOutputTokens(
  value = process.env.OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS,
  generalBudget = process.env.OPENAI_MAX_OUTPUT_TOKENS,
): number {
  return boundedStageOutputTokens(value, "OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS", DEFAULT_OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS, generalBudget);
}

export function openAIExpansionMaxOutputTokens(
  value = process.env.OPENAI_EXPANSION_MAX_OUTPUT_TOKENS,
  generalBudget = process.env.OPENAI_MAX_OUTPUT_TOKENS,
): number {
  return boundedStageOutputTokens(value, "OPENAI_EXPANSION_MAX_OUTPUT_TOKENS", DEFAULT_OPENAI_EXPANSION_MAX_OUTPUT_TOKENS, generalBudget);
}

export function openAIPlannerMaxOutputTokens(
  value = process.env.OPENAI_PLANNER_MAX_OUTPUT_TOKENS,
  generalBudget = process.env.OPENAI_MAX_OUTPUT_TOKENS,
): number {
  return boundedStageOutputTokens(value, "OPENAI_PLANNER_MAX_OUTPUT_TOKENS", DEFAULT_OPENAI_PLANNER_MAX_OUTPUT_TOKENS, generalBudget);
}

export function isChatModelTimeout(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error && /timeout|timed out|deadline exceeded|aborted/i.test(`${current.name} ${current.message}`)) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/** Identify only provider errors that explicitly describe a context/input limit. */
export function isProviderContextOverflow(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === "string") {
      if (contextOverflowMessage.test(current)) return true;
      current = undefined;
      continue;
    }
    if (typeof current !== "object") break;
    const record = current as { name?: unknown; message?: unknown; code?: unknown; type?: unknown; param?: unknown; cause?: unknown; error?: unknown };
    const detail = [record.name, record.message, record.code, record.type, record.param]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    if (contextOverflowMessage.test(detail)) return true;
    current = record.cause ?? record.error;
  }
  return false;
}

const contextOverflowMessage = /context[_ -]length[_ -]exceeded|maximum context(?: length)?|context window|too many tokens|input (?:is )?too (?:large|long)|prompt (?:is )?too (?:large|long)|request exceeds.{0,32}(?:token|context)|token.{0,32}(?:limit|maximum).{0,24}(?:exceed|too large)/i;

export function createChatModel(
  apiKey: string,
  modelName: string,
  options: { maxOutputTokens?: number; timeoutMs?: number; onRetry?: (notice: ModelRetryNotice) => void } = {},
): ChatOpenAI {
  const baseURL = process.env.OPENAI_BASE_URL?.trim();
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT?.trim();

  return new ChatOpenAI({
    apiKey,
    model: modelName,
    // Graph progress uses custom events; actions are consumed only after full validation.
    streaming: false,
    temperature: 0,
    ...(isLocalOllamaEndpoint(baseURL) ? { presencePenalty: 0, frequencyPenalty: 0 } : {}),
    timeout: options.timeoutMs ?? openAIRequestTimeoutMs(),
    maxTokens: options.maxOutputTokens ?? openAIMaxOutputTokens(),
    maxRetries: 0,
    configuration: {
      ...(baseURL ? { baseURL } : {}),
      fetch: (input, init) => fetchWithBoundedRetry(input, init, options.onRetry),
      ...(isLoopbackModelEndpoint(baseURL) ? { fetchOptions: { redirect: "manual" as const } } : {}),
    },
    ...(reasoningEffort ? { modelKwargs: { reasoning_effort: reasoningEffort } } : {}),
  });
}

const maximumRetryDelayMs = 5_000;

function retryAfterDelayMs(response: Response): number | null | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1_000
    : Date.parse(value) - Date.now();
  if (!Number.isFinite(delay) || delay < 0) return 0;
  return delay <= maximumRetryDelayMs ? delay : null;
}

function transientHttpReason(status: number): ModelRetryReason | null {
  if (status === 429) return "rate_limit";
  if (status === 408) return "request_timeout";
  if (status >= 500 && status <= 599) return "server_error";
  return null;
}

function transientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === "object") {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ERR_SOCKET_CLOSED)$/i.test(code)) return true;
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }
  return /^(?:TypeError: )?(?:fetch failed|network error|socket hang up|connection reset|connect timeout)$/i.test(error.message.trim());
}

function consumeRetry(budget: ModelAttemptBudget, reason: ModelRetryReason): boolean {
  if (budget.retries >= budget.maxRetries || budget.attempts >= budget.maxAttempts) return false;
  budget.retries += 1;
  budget.onRetry?.({ attempt: budget.retries, maxRetries: budget.maxRetries, reason });
  return true;
}

function requestBudget(fallbackSignal?: AbortSignal, onRetry?: (notice: ModelRetryNotice) => void): ModelAttemptBudget {
  const active = modelAttemptContext.getStore();
  if (active) return active;
  return createModelAttemptBudget({ ...(fallbackSignal ? { signal: fallbackSignal } : {}), ...(onRetry ? { onRetry } : {}) });
}

function reserveAttempt(budget: ModelAttemptBudget): void {
  if (budget.attempts >= budget.maxAttempts) throw new ModelAttemptBudgetExceededError(budget.maxAttempts);
  budget.attempts += 1;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("The request was aborted.");
  error.name = "AbortError";
  return error;
}

async function waitBeforeRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, delayMs);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal ? abortError(signal) : new Error("The request was aborted."));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function jitteredBackoffMs(): number {
  // One retry only: keep the delay short while spreading simultaneous retries.
  return Math.floor(Math.random() * 500);
}

async function fetchWithBoundedRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  onRetry?: (notice: ModelRetryNotice) => void,
): Promise<Response> {
  const signal = init?.signal ?? modelAttemptContext.getStore()?.signal;
  const budget = requestBudget(signal, onRetry);
  while (true) {
    if (signal?.aborted) throw abortError(signal);
    reserveAttempt(budget);
    let response: Response;
    try {
      response = await fetch(input instanceof Request ? input.clone() : input, init);
    } catch (error) {
      if (signal?.aborted || !transientNetworkError(error) || !consumeRetry(budget, "network_error")) throw error;
      await waitBeforeRetry(jitteredBackoffMs(), signal);
      continue;
    }
    const reason = transientHttpReason(response.status);
    if (!reason) return response;
    const retryAfter = retryAfterDelayMs(response);
    if (retryAfter === null || !consumeRetry(budget, reason)) return response;
    await response.body?.cancel().catch(() => undefined);
    await waitBeforeRetry(retryAfter ?? jitteredBackoffMs(), signal);
  }
}
