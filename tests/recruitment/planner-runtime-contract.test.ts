import assert from "node:assert/strict";
import test from "node:test";
import { createRecruitmentPlanner } from "../../src/recruitment/recruitment-planner.js";

test("Planner model request is constrained to runtime actions and does not mandate fixed retrieval order", async () => {
  const originalFetch = globalThis.fetch;
  const envKeys = ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_REASONING_EFFORT"] as const;
  const previousEnvironment = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let requestBody: Record<string, unknown> | undefined;
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_MODEL = "qwen3.5:9b";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.OPENAI_REASONING_EFFORT = "none";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1,
      model: "qwen3.5:9b",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({
        action: "finish",
        targetTeam: null,
        needSummary: "已完成本轮调查。",
        capabilityProfile: [],
        recommendations: [],
        limitationKeys: [],
        reportObservations: [],
      }) }, finish_reason: "stop" }],
    });
  }) as typeof fetch;

  try {
    const planner = createRecruitmentPlanner();
    const input = {
      history: [],
      dataMode: "understat" as const,
      dataSource: "Fixture",
      targetTeam: null,
      decisionMode: "investigate" as const,
      confirmedPosition: null,
      availableActions: ["search_candidates", "ask_user", "finish"],
    } as Parameters<typeof planner.decide>[0] & { availableActions: readonly string[] };
    await planner.decide(input);

    const messages = requestBody?.messages as Array<{ role?: string; content?: string }> | undefined;
    const systemMessage = messages?.find((message) => message.role === "system")?.content ?? "";
    const humanMessage = messages?.find((message) => message.role === "user")?.content ?? "";
    const outputSchema = JSON.stringify(requestBody?.response_format);

    assert.match(systemMessage, /本次可用 action.*search_candidates.*ask_user.*finish/);
    assert.match(humanMessage, /availableActions/);
    assert.doesNotMatch(systemMessage, /先检索角色\/战术方法资料/);
    assert.match(outputSchema, /search_candidates/);
    assert.doesNotMatch(outputSchema, /inspect_match|inspect_player|search_player_reports/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
