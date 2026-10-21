import assert from "node:assert/strict";
import test from "node:test";
import { RecruitmentBriefModelSchema } from "../../src/recruitment/brief-interpreter.js";
import { RecruitmentBriefSchema } from "../../src/domain/recruitment-brief.js";
import { createRecruitmentBriefInterpreter } from "../../src/recruitment/brief-interpreter.js";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import { roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

test("real structured model adapter works directly and inside the streamed LangGraph", async () => {
  const brief = RecruitmentBriefSchema.parse({ task: "similarity", targetTeam: null, referencePlayer: { value: "切尔基", quote: "切尔基", basis: "explicit" }, referenceClues: [], referenceRecheck: null, criteria: [], unresolved: [] });
  const requests: Array<{ stream: boolean }> = [];
  const originalFetch = globalThis.fetch;
  const keys = ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_STRUCTURED_OUTPUT_METHOD"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9999/v1";
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture-model";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ stream: body.stream === true });
    return Response.json({
      id: "fixture", object: "chat.completion", created: 1, model: "fixture-model",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(brief) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  }) as typeof fetch;
  try {
    const interpreter = createRecruitmentBriefInterpreter();
    assert.deepEqual(await interpreter.interpret({ message: "推荐类似切尔基的球员", previous: null, recentMessages: [] }), brief);
    const reference = roleConstraintPlayer("reference", "Rayan Cherki", "AM"), candidate = roleConstraintPlayer("candidate", "Candidate", "AM");
    const failures: unknown[] = [];
    const conversation = createRecruitmentConversation({ briefInterpreter: { async interpret(input) {
      try { return await interpreter.interpret(input); } catch (error) { failures.push(error); throw error; }
    } },
      repository: { mode: "demo", sourceName: "Fixture", async findPlayersByNames() { return [reference]; }, async loadPlayers() { return [reference, candidate]; } },
      referenceNameResolver: async mention => ({ status: "resolved", mention, resolutionMethod: "wikidata_exact", player: { entityId: "Q123", sourceUrl: "https://www.wikidata.org/wiki/Q123", names: [reference.name], preferredName: reference.name, match: "exact_label" } }),
      experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand", knowledgeBase: { async search() { return []; } },
      planner: { async decide() { return { action: "finish", targetTeam: null, needSummary: "寻找相似球员", capabilityProfile: [], recommendations: [{ playerId: candidate.playerId, evidenceKeys: ["shotAssists"] }], limitationKeys: [] }; } },
    });
    const result = await conversation.turn({ threadId: "real-brief-adapter", message: "推荐类似切尔基的球员" });
    assert.equal(failures.length, 0, JSON.stringify(failures));
    assert.equal(result.brief?.task, "similarity");
    assert.equal(result.report?.recommendations[0]?.player.playerId, candidate.playerId, JSON.stringify({ result, requests }));
    assert.deepEqual(requests, [{ stream: false }, { stream: false }], "a valid brief response must not trigger a second model call or token streaming");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});

test("context compaction from requirement understanding reaches the live graph progress stream", async () => {
  const brief = RecruitmentBriefSchema.parse({ task: "similarity", targetTeam: null,
    referencePlayer: { value: "切尔基", quote: "切尔基", basis: "explicit" }, referenceClues: [], referenceRecheck: null,
    criteria: [], unresolved: [] });
  const reference = roleConstraintPlayer("reference", "Rayan Cherki", "AM");
  const candidate = roleConstraintPlayer("candidate", "Candidate", "AM");
  const progress: Array<{ stage: string; status: string }> = [];
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret(input) {
      input.onContextCompaction?.("started");
      input.onContextCompaction?.("completed");
      return brief;
    } },
    repository: {
      mode: "demo",
      sourceName: "Fixture",
      async findPlayersByNames() { return [reference]; },
      async loadPlayers() { return [reference, candidate]; },
    },
    referenceNameResolver: async mention => ({ status: "resolved", mention, resolutionMethod: "wikidata_exact",
      player: { entityId: "Q123", sourceUrl: "https://www.wikidata.org/wiki/Q123", names: [reference.name], preferredName: reference.name, match: "exact_label" } }),
    experimentalDeterministicSearchMode: "enabled",
    experimentalRetrievalMode: "on_demand",
    knowledgeBase: { async search() { return []; } },
    planner: { async decide() { return {
      action: "finish", targetTeam: null, needSummary: "寻找相似球员", capabilityProfile: [],
      recommendations: [{ playerId: candidate.playerId, evidenceKeys: ["shotAssists"] }], limitationKeys: [],
    }; } },
  });

  const result = await conversation.turn({
    threadId: "context-compaction-progress",
    message: "推荐类似切尔基的球员",
    onProgress: update => progress.push({ stage: update.stage, status: update.status }),
  });

  assert.equal(result.status, "completed");
  assert.ok(progress.some(event => event.stage === "context_compaction" && event.status === "started"));
  assert.ok(progress.some(event => event.stage === "context_compaction" && event.status === "completed"));
});

test("a truncated brief honors the configured budget and same-case retry re-runs understanding", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_STRUCTURED_OUTPUT_METHOD", "OPENAI_MAX_OUTPUT_TOKENS", "OPENAI_REASONING_EFFORT"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "qwen3.5:9b";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "8192";
  process.env.OPENAI_REASONING_EFFORT = "none";

  const brief = {
    task: "reinforcement" as const,
    targetTeam: { value: "拜仁", basis: "explicit" as const, quote: "拜仁" },
    referencePlayer: null,
    referenceClues: [],
    referenceRecheck: null,
    selectedCandidateId: null,
    criteria: [],
    unresolved: [],
  };
  const requests: Array<{ max_tokens?: number; reasoning_effort?: string }> = [];
  let calls = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { max_tokens?: number; reasoning_effort?: string };
    requests.push(body);
    calls += 1;
    const truncated = calls === 1;
    return new Response(JSON.stringify({
      id: "fixture",
      object: "chat.completion",
      created: 1,
      model: "qwen3.5:9b",
      choices: [{
        index: 0,
        message: { role: "assistant", content: truncated ? '{"task":"reinforcement"' : JSON.stringify(brief) },
        finish_reason: truncated ? "length" : "stop",
      }],
      usage: { prompt_tokens: 5000, completion_tokens: truncated ? 2048 : 350, total_tokens: truncated ? 7048 : 5350 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    let playerReads = 0;
    let plannerCalls = 0;
    const trace: unknown[] = [];
    const conversation = createRecruitmentConversation({
      briefInterpreter: createRecruitmentBriefInterpreter(),
      repository: {
        mode: "demo",
        sourceName: "Fixture",
        async loadPlayers() { playerReads += 1; return []; },
        async searchCandidates() { playerReads += 1; return { players: [], offset: 0, totalRecords: 0, nextOffset: null, appliedFilters: [] }; },
      },
      planner: { async decide() {
        plannerCalls += 1;
        return { action: "finish", targetTeam: "拜仁", needSummary: "找中卫", capabilityProfile: [], recommendations: [], limitationKeys: [] };
      } },
      knowledgeBase: { async search() { return []; } },
      observer(event) { trace.push(event); },
    });
    const message = "我想给拜仁补强阵容，但位置还没定，先帮我明确需要的信息。";
    const first = await conversation.turn({ threadId: "brief-output-limit-retry", message });
    assert.equal(first.status, "failed");
    assert.equal(first.retryMessage, message);
    assert.match(first.message, /8192 个输出 token.*未能完成需求解析/);
    assert.equal(playerReads, 0, "an incomplete brief must stop before reading candidate data");
    assert.equal(plannerCalls, 0, "an incomplete brief must stop before planning the investigation");
    assert.ok(trace.some(event => typeof event === "object" && event !== null
      && "failureKind" in event && (event as { failureKind: unknown }).failureKind === "RecruitmentBriefOutputLimitError"
      && "outputLimitTokens" in event && (event as { outputLimitTokens: unknown }).outputLimitTokens === 8192));

    const retry = await conversation.turn({ threadId: "brief-output-limit-retry", message: first.retryMessage, expectsExistingState: true });
    assert.equal(retry.status, "needs_input", retry.message);
    assert.equal(retry.brief?.unresolved.some(item => item.topic === "position"), true);
    assert.equal(requests.length, 2, "retrying the same message must invoke brief understanding again");
    assert.deepEqual(requests.map(({ max_tokens, reasoning_effort }) => ({ max_tokens, reasoning_effort })), [
      { max_tokens: 8192, reasoning_effort: "none" },
      { max_tokens: 8192, reasoning_effort: "none" },
    ]);
    assert.equal(playerReads, 0);
    assert.equal(plannerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("brief understanding retries a provider context overflow after compacting old dialogue", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_STRUCTURED_OUTPUT_METHOD", "OPENAI_MAX_OUTPUT_TOKENS", "TACTISCOUT_CONTEXT_WINDOW_TOKENS", "TACTISCOUT_CONTEXT_COMPACTION_RATIO", "TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9999/v1";
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture-model";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "2048";
  process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS = "258000";
  process.env.TACTISCOUT_CONTEXT_COMPACTION_RATIO = "0.9";
  process.env.TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS = "1024";
  const brief = RecruitmentBriefSchema.parse({ task: "similarity", targetTeam: null,
    referencePlayer: { value: "切尔基", quote: "切尔基", basis: "explicit" }, referenceClues: [], referenceRecheck: null,
    criteria: [], unresolved: [] });
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    if (bodies.length === 1) return Response.json({ error: {
      message: "The request exceeds the model's context window.",
      type: "invalid_request_error", param: "messages", code: "context_length_exceeded",
    } }, { status: 400 });
    return Response.json({
      id: "fixture", object: "chat.completion", created: 1, model: "fixture-model",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(brief) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 },
    });
  }) as typeof fetch;

  try {
    const statuses: string[] = [];
    const message = "推荐类似切尔基的球员";
    const result = await createRecruitmentBriefInterpreter().interpret({
      message,
      previous: null,
      recentMessages: ["旧需求".repeat(500)],
      recentDialogue: [{ role: "user", content: "旧需求".repeat(500), eventId: "evt.fixture.user.1" }],
      validationMessages: ["旧需求".repeat(500), message],
      onContextCompaction: status => statuses.push(status),
    });
    assert.deepEqual(result, brief);
    assert.equal(bodies.length, 2);
    assert.deepEqual(statuses, ["started", "completed"]);
    const firstMessages = bodies[0]?.messages as Array<{ content?: unknown }>;
    const secondMessages = bodies[1]?.messages as Array<{ content?: unknown }>;
    assert.match(String(firstMessages[1]?.content ?? ""), /旧需求/);
    assert.doesNotMatch(String(secondMessages[1]?.content ?? ""), /旧需求/);
    assert.match(String(secondMessages[1]?.content ?? ""), /推荐类似切尔基的球员/);
    assert.deepEqual(JSON.parse(String(secondMessages[1]?.content).split("\n").slice(1).join("\n")).recentDialogue, []);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("the semantic brief requires criteria while the model contract requires identity-control fields", () => {
  const brief = { task: "reinforcement", targetTeam: null, referencePlayer: null, criteria: [], unresolved: [] };
  const preLedgerShape = { task: "reinforcement", targetTeam: null, referencePlayer: null, positions: [], priorities: [], constraints: [],
    filters: { ageLimit: null, minimumMinutes: 0, competition: null, season: null }, unresolved: [] };
  assert.equal(RecruitmentBriefSchema.safeParse(brief).success, true);
  assert.equal(RecruitmentBriefSchema.safeParse(preLedgerShape).success, false);
  assert.equal(RecruitmentBriefModelSchema.safeParse(brief).success, false);
  assert.equal(RecruitmentBriefModelSchema.safeParse({ ...brief, referenceClues: [], referenceRecheck: null }).success, true);
  assert.equal(RecruitmentBriefModelSchema.safeParse({ ...brief, referenceClues: [], referenceRecheck: { quote: "请重新核实" } }).success, false);
});
