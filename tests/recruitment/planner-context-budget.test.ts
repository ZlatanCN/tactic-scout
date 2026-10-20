import assert from "node:assert/strict";
import test from "node:test";
import { createRecruitmentPlanner } from "../../src/recruitment/recruitment-planner.js";
import { RecruitmentContextCapacityError } from "../../src/recruitment/context.js";
import { finishArguments, nativeCompletion, plannerInput } from "./fixtures/native-planner.js";

const envKeys = [
  "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_MAX_OUTPUT_TOKENS",
  "OPENAI_EXPANSION_MAX_OUTPUT_TOKENS", "OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS",
  "TACTISCOUT_CONTEXT_WINDOW_TOKENS", "TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS", "TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS",
] as const;

function saveEnvironment() {
  return Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
}

function restoreEnvironment(previous: Record<string, string | undefined>) {
  for (const key of envKeys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}

function configurePlannerEnvironment() {
  process.env.OPENAI_API_KEY = "fixture-key";
  process.env.OPENAI_MODEL = "fixture-model";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9999/v1";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "256";
  process.env.OPENAI_EXPANSION_MAX_OUTPUT_TOKENS = "256";
  process.env.OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS = "256";
  process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS = "16384";
  process.env.TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS = "12000";
  process.env.TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS = "256";
}

test("Planner preflight and decide share one DecisionSnapshot request and a native tool-call response", async () => {
  const previousEnvironment = saveEnvironment();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  let requestBody: Record<string, unknown> | undefined;
  configurePlannerEnvironment();
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestCount += 1;
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return nativeCompletion("search_methodology", { query: "中场推进能力的可观察评估方法", limit: 4 });
  }) as typeof fetch;

  try {
    const planner = createRecruitmentPlanner();
    const input = plannerInput({
      targetTeam: "Bayern",
      confirmedPosition: "CM",
      availableActions: ["search_methodology", "search_candidates", "finish"],
      history: [{ role: "user", content: "为 Bayern 找中场，重点看推进能力" }],
    });
    assert.ok(planner.preflightContext);
    const preflight = await planner.preflightContext(input);
    assert.equal(requestCount, 0, "preflight must not call the model");
    let observedManifest: Record<string, unknown> | undefined;
    const result = await planner.decide({ ...input, onTokenUsage: usage => { observedManifest = usage.contextManifest as unknown as Record<string, unknown>; } });

    assert.equal(requestCount, 1);
    assert.equal(result.tool_calls?.[0]?.name, "search_methodology");
    assert.ok(requestBody);
    const manifest = observedManifest as { requestFingerprint?: string; payloadFingerprint?: string; estimatedInputTokens?: number };
    assert.equal(manifest.requestFingerprint, preflight.requestFingerprint);
    assert.equal(manifest.payloadFingerprint, preflight.payloadFingerprint);
    assert.equal(manifest.estimatedInputTokens, preflight.estimatedInputTokens);
    const tools = requestBody.tools as Array<{ function: { name: string } }>;
    assert.ok(tools.some(item => item.function.name === "search_methodology"));
    assert.equal("response_format" in requestBody, false, "Planner actions use native tool calls");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previousEnvironment);
  }
});

test("Planner rejects an oversized required request before contacting the provider", async () => {
  const previousEnvironment = saveEnvironment();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  configurePlannerEnvironment();
  process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS = "4096";
  process.env.TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS = "3000";
  process.env.TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS = "128";
  globalThis.fetch = (async () => {
    requestCount += 1;
    return nativeCompletion("finish", finishArguments);
  }) as typeof fetch;

  try {
    const planner = createRecruitmentPlanner();
    const input = plannerInput({
      stage: "conclude",
      targetTeam: "Bayern",
      availableActions: ["finish", "ask_user"],
      constraints: {
        targetTeam: "Bayern",
        evaluatedCandidates: [],
        reportObservations: [],
        requestedCapabilityCoverage: [],
      },
      history: Array.from({ length: 45 }, (_, index) => ({
        role: index % 2 === 0 ? "user" as const : "assistant" as const,
        content: `固定历史片段 ${index}：${"必须保留的用户要求与调查事实。".repeat(80)}`,
      })),
    });
    assert.ok(planner.preflightContext);
    const manifest = await planner.preflightContext(input);
    assert.equal(manifest.exceedsVerifiedWindow, true);
    await assert.rejects(planner.decide(input), RecruitmentContextCapacityError);
    assert.equal(requestCount, 0, "an oversized request must fail before a provider call");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previousEnvironment);
  }
});
