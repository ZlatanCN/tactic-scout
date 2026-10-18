export interface NormalizedModelTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function reportedTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function firstReportedTokenCount(...values: unknown[]): number | undefined {
  return values.map(reportedTokenCount).find((value) => value !== undefined);
}

export function normalizeModelTokenUsage(response: unknown): NormalizedModelTokenUsage {
  const structuredResponse = record(response);
  const raw = record(structuredResponse?.raw) ?? structuredResponse;
  const responseMetadata = record(raw?.response_metadata);
  const providerUsage = record(responseMetadata?.usage);
  const usageMetadata = record(raw?.usage_metadata);
  const inputTokens = firstReportedTokenCount(providerUsage?.prompt_tokens, usageMetadata?.input_tokens);
  const outputTokens = firstReportedTokenCount(providerUsage?.completion_tokens, usageMetadata?.output_tokens);
  const totalTokens = firstReportedTokenCount(providerUsage?.total_tokens, usageMetadata?.total_tokens);

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

/** Read only visible text blocks; reasoning and other multimodal content are never JSON input. */
export function structuredModelText(content: unknown): string {
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.flatMap(part => part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("") : "";
  return text.trim().replace(/^```(?:json)?\s*([\s\S]*?)```$/i, "$1").trim();
}
