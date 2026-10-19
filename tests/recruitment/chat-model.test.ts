import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod/v4";
import {
  createChatModel,
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_EXPANSION_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_EXPANSION_TIMEOUT_MS,
  openAIExpansionMaxOutputTokens,
  openAIConclusionMaxOutputTokens,
  openAIExpansionRequestTimeoutMs,
  openAIMaxOutputTokens,
  structuredOutputMethod,
} from "../../src/recruitment/chat-model.js";

test("structured output auto mode uses JSON Schema for the standard local Ollama endpoint", () => {
  assert.equal(structuredOutputMethod("http://127.0.0.1:11434/v1/"), "jsonSchema");
  assert.equal(structuredOutputMethod("http://localhost:11434/v1"), "jsonSchema");
  assert.equal(structuredOutputMethod("http://[::1]:11434/v1"), "jsonSchema");
});

test("structured output auto mode keeps function calling for other OpenAI-compatible services", () => {
  assert.equal(structuredOutputMethod("https://api.openai.com/v1"), "functionCalling");
  assert.equal(structuredOutputMethod(undefined), "functionCalling");
});

test("structured output method can be explicitly selected for other compatible endpoints", () => {
  assert.equal(structuredOutputMethod("https://api.example.test/v1", "jsonSchema"), "jsonSchema");
  assert.equal(structuredOutputMethod("http://127.0.0.1:11434/v1", "functionCalling"), "functionCalling");
  assert.throws(() => structuredOutputMethod(undefined, "unsupported"), /OPENAI_STRUCTURED_OUTPUT_METHOD/);
});

test("planner response token budget leaves room for a complete evidence-backed report action", () => {
  assert.equal(DEFAULT_OPENAI_MAX_OUTPUT_TOKENS, 8_192);
  assert.equal(openAIMaxOutputTokens(""), 8_192);
  assert.equal(openAIMaxOutputTokens("8192"), 8_192);
  assert.throws(() => openAIMaxOutputTokens("128"), /OPENAI_MAX_OUTPUT_TOKENS/);
});

test("conclusion reports use a stage-specific output budget", () => {
  assert.equal(DEFAULT_OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS, 4_096);
  assert.equal(openAIConclusionMaxOutputTokens("", "8192"), 4_096);
  assert.equal(openAIConclusionMaxOutputTokens("2048", "8192"), 2_048);
  assert.equal(openAIConclusionMaxOutputTokens("8192", "4096"), 4_096);
  assert.throws(() => openAIConclusionMaxOutputTokens("128", "8192"), /OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS/);
});

test("candidate expansion decisions use a bounded output budget", () => {
  assert.equal(DEFAULT_OPENAI_EXPANSION_MAX_OUTPUT_TOKENS, 1_024);
  assert.equal(openAIExpansionMaxOutputTokens("", "8192"), 1_024);
  assert.equal(openAIExpansionMaxOutputTokens("2048", "8192"), 2_048);
  assert.equal(openAIExpansionMaxOutputTokens("512", "8192"), 512);
  assert.equal(openAIExpansionMaxOutputTokens("2048", "512"), 512);
  assert.throws(() => openAIExpansionMaxOutputTokens("128"), /OPENAI_EXPANSION_MAX_OUTPUT_TOKENS/);
});

test("candidate expansion decisions use a bounded timeout within the general model timeout", () => {
  assert.equal(DEFAULT_OPENAI_EXPANSION_TIMEOUT_MS, 60_000);
  assert.equal(openAIExpansionRequestTimeoutMs("", ""), 60_000);
  assert.equal(openAIExpansionRequestTimeoutMs("45000", "180000"), 45_000);
  assert.equal(openAIExpansionRequestTimeoutMs("60000", "45000"), 45_000);
  assert.throws(() => openAIExpansionRequestTimeoutMs("500"), /OPENAI_EXPANSION_TIMEOUT_MS/);
});

test("LangChain sends the expansion token cap and Ollama reasoning setting in the request", async () => {
  const originalFetch = globalThis.fetch;
  const previousReasoningEffort = process.env.OPENAI_REASONING_EFFORT;
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  let requestBody: Record<string, unknown> | undefined;
  process.env.OPENAI_REASONING_EFFORT = "none";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1,
      model: "qwen3.5:9b",
      choices: [{ index: 0, message: { role: "assistant", content: '{"action":"finish"}' }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const model = createChatModel("ollama", "qwen3.5:9b", { maxOutputTokens: 1_024 });
    await model.withStructuredOutput(z.object({ action: z.string() }), {
      name: "recruitment_action",
      method: "jsonSchema",
      includeRaw: true,
    }).invoke([["system", "Choose an action."], ["human", "Return finish."]]);

    assert.equal(requestBody?.max_tokens, 1_024);
    assert.equal(requestBody?.reasoning_effort, "none");
    assert.equal(requestBody?.presence_penalty, 0);
    assert.equal(requestBody?.frequency_penalty, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousBaseUrl;
    if (previousReasoningEffort === undefined) delete process.env.OPENAI_REASONING_EFFORT;
    else process.env.OPENAI_REASONING_EFFORT = previousReasoningEffort;
  }
});
