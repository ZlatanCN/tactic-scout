import assert from "node:assert/strict";
import test from "node:test";
import { createRecruitmentPlanner } from "../../src/recruitment/recruitment-planner.js";
import { finishArguments, nativeCompletion, plannerInput } from "./fixtures/native-planner.js";

const envKeys = [
  "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_MAX_OUTPUT_TOKENS",
  "OPENAI_EXPANSION_MAX_OUTPUT_TOKENS", "OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS",
  "TACTISCOUT_CONTEXT_WINDOW_TOKENS", "TACTISCOUT_CONTEXT_COMPACTION_RATIO", "TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS",
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
  process.env.TACTISCOUT_CONTEXT_COMPACTION_RATIO = "0.9";
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

test("Planner compacts oversized navigation history and completes the same request", async () => {
  const previousEnvironment = saveEnvironment();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  let sentBody: Record<string, unknown> | undefined;
  let observedManifest: Record<string, unknown> | undefined;
  configurePlannerEnvironment();
  // The v2 report schema includes multi-source claims, so leave enough headroom
  // to test compaction-threshold behavior without crossing the verified window.
  process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS = "36000";
  process.env.TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS = "128";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestCount += 1;
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
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
      history: Array.from({ length: 36 }, (_, index) => ({
        role: index % 2 === 0 ? "user" as const : "assistant" as const,
        content: `固定历史片段 ${index}：${"必须保留的用户要求与调查事实。".repeat(45)}`,
        ...(index === 0 ? { eventId: "evt.abcdef0123456789.user.1" } : index === 34 ? { eventId: "evt.abcdef0123456789.user.18" } : {}),
      })),
    });
    assert.ok(planner.preflightContext);
    const manifest = await planner.preflightContext(input);
    assert.equal(manifest.exceedsVerifiedWindow, false);
    assert.equal(manifest.exceedsCompactionThreshold, true, JSON.stringify(manifest));
    const progress: string[] = [];
    const result = await planner.decide({ ...input,
      onContextCompaction: status => progress.push(status),
      onTokenUsage: usage => { if (usage.outcome === "response") observedManifest = usage.contextManifest as unknown as Record<string, unknown>; },
    });
    assert.equal(requestCount, 1);
    assert.equal(result.tool_calls?.[0]?.name, "finish");
    assert.deepEqual(progress, ["started", "completed"]);
    const messages = sentBody?.messages as Array<{ content?: unknown }> | undefined;
    const userMessage = String(messages?.at(-1)?.content ?? "");
    const payload = JSON.parse(userMessage.slice(userMessage.indexOf("\n") + 1)) as {
      decisionSnapshot?: { history?: Array<{ content?: string }>; case?: { latestUserRequest?: string } };
      history?: unknown;
    };
    assert.equal(payload.decisionSnapshot?.history?.length, 0);
    assert.equal(payload.decisionSnapshot?.case?.latestUserRequest, "为球队寻找合适的候选球员");
    assert.equal("history" in payload, false, "the same planner history must not be serialized twice");
    assert.doesNotMatch(userMessage, /固定历史片段 0/);
    assert.ok((observedManifest?.includedHistoryEventIds as string[]).includes("evt.abcdef0123456789.user.18"));
    assert.ok((observedManifest?.omittedHistoryEventIds as string[]).includes("evt.abcdef0123456789.user.1"));
    assert.equal(input.decisionSnapshot.history.length, 36, "per-request projection must not mutate checkpoint history");
    assert.match(input.decisionSnapshot.history[0]?.content ?? "", /固定历史片段 0/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previousEnvironment);
  }
});

test("Planner retries a provider context overflow with a compact request in the same turn", async () => {
  const previousEnvironment = saveEnvironment();
  const originalFetch = globalThis.fetch;
  const sentBodies: Array<Record<string, unknown>> = [];
  configurePlannerEnvironment();
  process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS = "258000";
  process.env.TACTISCOUT_CONTEXT_COMPACTION_RATIO = "0.9";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (sentBodies.length === 1) return Response.json({ error: {
      message: "This request exceeds the model's maximum context length.",
      type: "invalid_request_error",
      param: "messages",
      code: "context_length_exceeded",
    } }, { status: 400 });
    return nativeCompletion("search_methodology", { query: "中场推进能力的评估方法", limit: 4 });
  }) as typeof fetch;

  try {
    const planner = createRecruitmentPlanner();
    const input = plannerInput({
      history: [
        { role: "user", content: "很早之前的大段对话：" + "旧调查背景。".repeat(800) },
        { role: "assistant", content: JSON.stringify({ action: "search_methodology" }) },
        { role: "tool", toolName: "search_methodology", content: JSON.stringify({ results: ["旧方法资料"] }) },
        { role: "user", content: "继续查找符合当前条件的人选" },
      ],
    });
    const progress: string[] = [];
    const result = await planner.decide({ ...input, onContextCompaction: status => progress.push(status) });

    assert.equal(sentBodies.length, 2);
    assert.equal(result.tool_calls?.[0]?.name, "search_methodology");
    assert.deepEqual(progress, ["started", "completed"]);
    const secondMessages = sentBodies[1]?.messages as Array<{ content?: unknown }> | undefined;
    const secondUserMessage = String(secondMessages?.at(-1)?.content ?? "");
    const secondPayload = JSON.parse(secondUserMessage.slice(secondUserMessage.indexOf("\n") + 1)) as {
      decisionSnapshot?: { history?: Array<{ content?: string }> };
    };
    assert.equal(secondPayload.decisionSnapshot?.history?.length, 0);
    assert.doesNotMatch(secondUserMessage, /很早之前的大段对话/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previousEnvironment);
  }
});
