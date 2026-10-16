import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createRecruitmentPlanner } from "../../src/recruitment/recruitment-planner.js";

test("real Planner HTTP output contract bounds the limitation array that exhausted the local context", async () => {
  const names = ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_STRUCTURED_OUTPUT_METHOD"] as const;
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  let wire: { max_tokens: number; response_format: { json_schema: { schema: { anyOf: Array<{
    properties: { action: { const: string }; limitationKeys?: { maxItems?: number } };
  }> } } } } | undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    wire = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: "fixture", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        action: "finish", targetTeam: "Bayern", needSummary: "有限样本的后续考察线索。", capabilityProfile: [],
        recommendations: [{ playerId: "candidate", evidenceKeys: ["goals"] }], limitationKeys: ["injury"], reportObservations: [],
      }) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    process.env.OPENAI_API_KEY = "fixture-not-a-secret";
    process.env.OPENAI_MODEL = "fixture";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
    const result = await createRecruitmentPlanner().decide({ history: [], dataMode: "demo", dataSource: "Fixture",
      targetTeam: "Bayern", decisionMode: "expand", confirmedPosition: "ATT",
      constraints: { targetTeam: "Bayern", evaluatedCandidates: [{ playerId: "candidate", evidenceKeys: ["goals"] }], reportObservations: [], requestedCapabilityCoverage: [] },
      expansionConstraints: { targetTeam: "Bayern", position: "ATT", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, nextOffset: 20 },
    });
    assert.equal(result.action, "finish");
    assert.ok(wire);
    const finishSchema = wire.response_format.json_schema.schema.anyOf.find(arm => arm.properties.action.const === "finish");
    assert.equal(finishSchema?.properties.limitationKeys?.maxItems, 10, "wire schema must prevent unbounded limitation-key repetition");
    assert.equal(wire.max_tokens, 1024, "fix must not hide the failure by increasing output budget");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
  }
});
