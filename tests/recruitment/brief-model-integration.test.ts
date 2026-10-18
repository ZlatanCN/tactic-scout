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
    assert.deepEqual(requests, [{ stream: false }, { stream: true }], "valid streamed text must not trigger a second model call");
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
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
