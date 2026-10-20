import { ChatOpenAI } from "@langchain/openai";
import { isIP } from "node:net";

export const DEFAULT_OPENAI_TIMEOUT_MS = 180_000;
export const DEFAULT_OPENAI_MAX_OUTPUT_TOKENS = 8_192;
export const DEFAULT_OPENAI_EXPANSION_TIMEOUT_MS = 60_000;
export const DEFAULT_OPENAI_EXPANSION_MAX_OUTPUT_TOKENS = 1_024;
export const DEFAULT_OPENAI_PLANNER_MAX_OUTPUT_TOKENS = 2_048;
export const DEFAULT_OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS = 2_048;
export const DEFAULT_CONTEXT_SOFT_INPUT_BUDGET_TOKENS = 8_192;
export const DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS = 1_024;

export function modelContextWindowTokens(value = process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS): number | undefined {
  if (!value?.trim()) return undefined;
  const tokens = Number(value);
  if (!Number.isSafeInteger(tokens) || tokens < 4_096 || tokens > 258_000) {
    throw new Error("TACTISCOUT_CONTEXT_WINDOW_TOKENS must be an integer between 4096 and 258000.");
  }
  return tokens;
}

export function contextSoftInputBudgetTokens(value = process.env.TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS): number {
  if (!value?.trim()) return DEFAULT_CONTEXT_SOFT_INPUT_BUDGET_TOKENS;
  const tokens = Number(value);
  if (!Number.isSafeInteger(tokens) || tokens < 1_024 || tokens > 131_072) {
    throw new Error("TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS must be an integer between 1024 and 131072.");
  }
  return tokens;
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

export function createChatModel(
  apiKey: string,
  modelName: string,
  options: { maxOutputTokens?: number; timeoutMs?: number } = {},
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
    ...(baseURL ? {
      configuration: {
        baseURL,
        fetch: fetchWithRateLimitRetry,
        ...(isLoopbackModelEndpoint(baseURL) ? { fetchOptions: { redirect: "manual" as const } } : {}),
      },
    } : {}),
    ...(reasoningEffort ? { modelKwargs: { reasoning_effort: reasoningEffort } } : {}),
  });
}

async function fetchWithRateLimitRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response = await fetch(input, init);
  for (let attempt = 0; attempt < 2 && response.status === 429; attempt += 1) {
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delayMs = Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0 && retryAfterSeconds <= 10
      ? retryAfterSeconds * 1_000
      : 1_000 * (attempt + 1);
    await response.body?.cancel().catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    response = await fetch(input, init);
  }
  return response;
}
