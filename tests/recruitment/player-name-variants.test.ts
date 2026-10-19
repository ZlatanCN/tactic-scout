import assert from "node:assert/strict";
import test from "node:test";
import { RecruitmentContextCapacityError } from "../../src/recruitment/context.js";
import { createPlayerNameVariantGenerator } from "../../src/recruitment/player-name-variants.js";

test("player-name variant requests share the context budget and fail before sending an oversized prompt", async () => {
  const environmentKeys = ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "TACTISCOUT_CONTEXT_WINDOW_TOKENS", "TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS"] as const;
  const previous = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  const usages: Array<{ outcome: string; estimatedInputTokens?: number }> = [];
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture-model";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS = "4096";
  process.env.TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS = "4096";
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response(JSON.stringify({
      id: "chatcmpl-test", object: "chat.completion", created: 1, model: "fixture-model",
      choices: [{ index: 0, message: { role: "assistant", content: '{"names":[]}' }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const generator = createPlayerNameVariantGenerator(usage => usages.push(usage));
    assert.ok(generator);
    await assert.rejects(generator("中文外号", { clues: ["线索"] }), RecruitmentContextCapacityError);
    assert.equal(requestCount, 0);
    assert.equal(usages.at(-1)?.outcome, "failed");
    assert.ok((usages.at(-1)?.estimatedInputTokens ?? 0) > 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of environmentKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
