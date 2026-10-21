import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod/v4";
import {
  createChatModel,
  contextCompactionRatio,
  DEFAULT_CONTEXT_COMPACTION_RATIO,
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_EXPANSION_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_PLANNER_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_EXPANSION_TIMEOUT_MS,
  openAIExpansionMaxOutputTokens,
  openAIConclusionMaxOutputTokens,
  openAIPlannerMaxOutputTokens,
  openAIExpansionRequestTimeoutMs,
  openAIMaxOutputTokens,
  isProviderContextOverflow,
  createModelAttemptBudget,
  invokeWithModelAttemptBudget,
  structuredOutputMethod,
} from "../../src/recruitment/chat-model.js";

test("context compaction uses a window-relative default and validates configuration", () => {
  assert.equal(DEFAULT_CONTEXT_COMPACTION_RATIO, 0.9);
  assert.equal(contextCompactionRatio(""), 0.9);
  assert.equal(contextCompactionRatio("0.85"), 0.85);
  assert.throws(() => contextCompactionRatio("0.2"), /TACTISCOUT_CONTEXT_COMPACTION_RATIO/);
});

test("provider context overflow detection ignores unrelated request failures", () => {
  assert.equal(isProviderContextOverflow({
    status: 400,
    code: "context_length_exceeded",
    message: "maximum context length exceeded",
  }), true);
  assert.equal(isProviderContextOverflow(new Error("The prompt is too long for this model's context window.")), true);
  assert.equal(isProviderContextOverflow(new Error("rate limit exceeded")), false);
  assert.equal(isProviderContextOverflow(new Error("request failed with status 400")), false);
});

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
  assert.equal(DEFAULT_OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS, 2_048);
  assert.equal(openAIConclusionMaxOutputTokens("", "8192"), 2_048);
  assert.equal(openAIConclusionMaxOutputTokens("2048", "8192"), 2_048);
  assert.equal(openAIConclusionMaxOutputTokens("8192", "4096"), 4_096);
  assert.throws(() => openAIConclusionMaxOutputTokens("128", "8192"), /OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS/);
});

test("investigation planner actions use a compact stage-specific output budget", () => {
  assert.equal(DEFAULT_OPENAI_PLANNER_MAX_OUTPUT_TOKENS, 2_048);
  assert.equal(openAIPlannerMaxOutputTokens("", "8192"), 2_048);
  assert.equal(openAIPlannerMaxOutputTokens("1024", "8192"), 1_024);
  assert.equal(openAIPlannerMaxOutputTokens("4096", "2048"), 2_048);
  assert.throws(() => openAIPlannerMaxOutputTokens("128", "8192"), /OPENAI_PLANNER_MAX_OUTPUT_TOKENS/);
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

test("the model client retries only transient rate-limit responses", async () => {
  const originalFetch = globalThis.fetch;
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  const requestUrls: string[] = [];
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrls.push(String(input));
    if (requestUrls.length === 1) {
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "0" },
      });
    }
    return new Response(JSON.stringify({
      id: "chatcmpl-after-rate-limit",
      object: "chat.completion",
      created: 1,
      model: "qwen3.5:9b",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const model = createChatModel("ollama", "qwen3.5:9b");
    const response = await model.invoke("ping");
    assert.equal(requestUrls.length, 2);
    assert.equal(response.content, "ok");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousBaseUrl;
  }
});

test("transient network and server errors share one retry across an entire model operation", async () => {
  const originalFetch = globalThis.fetch;
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  const notices: string[] = [];
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    if (requests.length === 1) return new Response("temporarily unavailable", { status: 503 });
    if (requests.length === 2) return Response.json({
      id: "chatcmpl-recovered", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    });
    return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
  }) as typeof fetch;

  try {
    const model = createChatModel("fixture", "fixture");
    const budget = createModelAttemptBudget({ onRetry: notice => notices.push(notice.reason) });
    await invokeWithModelAttemptBudget(budget, async () => {
      assert.equal((await model.invoke("first request")).content, "ok");
      await assert.rejects(model.invoke("second request"));
    });
    assert.equal(requests.length, 3, "a retry used by the first request must not be reset for a later request in the same operation");
    assert.deepEqual(notices, ["server_error"]);
    assert.equal(budget.attempts, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousBaseUrl;
  }
});

test("transient connection failures retry once and ordinary client errors do not retry", async () => {
  const originalFetch = globalThis.fetch;
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    if (requests === 1) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    return new Response("bad request", { status: 400 });
  }) as typeof fetch;

  try {
    const model = createChatModel("fixture", "fixture");
    await assert.rejects(model.invoke("ping"));
    assert.equal(requests, 2, "the connection reset is retried once, while the final HTTP 400 is not retried");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousBaseUrl;
  }
});

test("a model timeout retries once within the shared budget, but caller cancellation never retries", async () => {
  const originalFetch = globalThis.fetch;
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  const reasons: string[] = [];
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    if (requests === 1) throw new Error("request timed out");
    return Response.json({
      id: "chatcmpl-after-timeout", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    });
  }) as typeof fetch;

  try {
    const model = createChatModel("fixture", "fixture");
    const budget = createModelAttemptBudget({ onRetry: notice => reasons.push(notice.reason) });
    const response = await invokeWithModelAttemptBudget(budget, () => model.invoke("ping"));
    assert.equal(response.content, "ok");
    assert.equal(requests, 2);
    assert.deepEqual(reasons, ["request_timeout"]);

    const controller = new AbortController();
    controller.abort(new Error("user stopped this turn"));
    const cancelledBudget = createModelAttemptBudget({ signal: controller.signal, onRetry: notice => reasons.push(notice.reason) });
    let calls = 0;
    await assert.rejects(invokeWithModelAttemptBudget(cancelledBudget, async () => {
      calls += 1;
      throw new Error("request timed out");
    }));
    assert.equal(calls, 1, "an aborted turn does not start another model request");
    assert.deepEqual(reasons, ["request_timeout"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousBaseUrl;
  }
});
