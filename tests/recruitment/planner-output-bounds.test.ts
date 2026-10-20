import assert from "node:assert/strict";
import test from "node:test";
import { createRecruitmentPlanner, RecruitmentModelTimeoutError } from "../../src/recruitment/recruitment-planner.js";
import { finishArguments, nativeCompletion, plannerInput } from "./fixtures/native-planner.js";

const keys = ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS", "OPENAI_TIMEOUT_MS"] as const;
function saveEnvironment() { return Object.fromEntries(keys.map(key => [key, process.env[key]])); }
function restoreEnvironment(previous: Record<string, string | undefined>) {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}
function configure() {
  process.env.OPENAI_API_KEY = "fixture-key";
  process.env.OPENAI_MODEL = "fixture-model";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9999/v1";
  process.env.OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS = "1024";
}

test("native Planner tool schema bounds finish fields without raising the output budget", async () => {
  const previous = saveEnvironment();
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  configure();
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return nativeCompletion("finish", finishArguments);
  }) as typeof fetch;
  try {
    const planner = createRecruitmentPlanner();
    await planner.decide(plannerInput({
      stage: "conclude",
      targetTeam: "Bayern",
      availableActions: ["finish", "ask_user"],
      constraints: { targetTeam: "Bayern", evaluatedCandidates: [], reportObservations: [], requestedCapabilityCoverage: [] },
    }));
    assert.ok(requestBody);
    const finishTool = (requestBody.tools as Array<{ function: { name: string; parameters: { properties: Record<string, { maxItems?: number }> } } }>)
      .find(item => item.function.name === "finish");
    assert.ok(finishTool);
    assert.equal(finishTool.function.parameters.properties.limitationKeys?.maxItems, 10);
    assert.equal(requestBody.max_tokens, 1024);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("Planner deadline includes a response body that stays open after HTTP headers", async () => {
  const previous = saveEnvironment();
  const originalFetch = globalThis.fetch;
  configure();
  process.env.OPENAI_TIMEOUT_MS = "1000";
  globalThis.fetch = (async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    await assert.rejects(
      createRecruitmentPlanner().decide(plannerInput({ stage: "conclude", targetTeam: "Bayern" })),
      (error: unknown) => error instanceof RecruitmentModelTimeoutError,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});
