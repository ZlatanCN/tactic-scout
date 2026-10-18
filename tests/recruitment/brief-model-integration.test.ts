import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { RecruitmentBriefModelSchema } from "../../src/recruitment/brief-interpreter.js";
import { RecruitmentBriefSchema } from "../../src/domain/recruitment-brief.js";
import { createRecruitmentBriefInterpreter } from "../../src/recruitment/brief-interpreter.js";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import { roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

test("real structured model adapter works directly and inside the streamed LangGraph", async () => {
  const brief = RecruitmentBriefSchema.parse({ task: "similarity", targetTeam: null, referencePlayer: { value: "切尔基", quote: "切尔基", basis: "explicit" }, referenceClues: [], referenceRecheck: null, positions: [], priorities: [], constraints: [], filters: { maxAge: null, minimumMinutes: 0, competition: null, season: null }, unresolved: [] });
  const requests: Array<{ stream: boolean }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ stream: body.stream === true });
    const content = JSON.stringify(brief), base = { id: "fixture", created: 1, model: "fixture-model" };
    if (body.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })}\n\n`);
      response.end("data: [DONE]\n\n");
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const keys = ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_STRUCTURED_OUTPUT_METHOD"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture-model";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
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
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
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
    positions: [],
    allowsAnyPosition: false,
    filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null },
    priorities: [],
    constraints: [],
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
    assert.equal(first.status, "completed");
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

test("the runtime model contract requires explicit empty identity-control fields while persisted briefs stay backward-compatible", () => {
  const legacyBrief = { task: "reinforcement", targetTeam: null, referencePlayer: null, positions: [], priorities: [], constraints: [],
    filters: { maxAge: null, minimumMinutes: 0, competition: null, season: null }, unresolved: [] };
  assert.equal(RecruitmentBriefSchema.safeParse(legacyBrief).success, true);
  assert.equal(RecruitmentBriefModelSchema.safeParse(legacyBrief).success, false);
  assert.equal(RecruitmentBriefModelSchema.safeParse({ ...legacyBrief, referenceClues: [], referenceRecheck: null }).success, true);
  assert.equal(RecruitmentBriefModelSchema.safeParse({ ...legacyBrief, referenceClues: [], referenceRecheck: { quote: "请重新核实" } }).success, false);
});
