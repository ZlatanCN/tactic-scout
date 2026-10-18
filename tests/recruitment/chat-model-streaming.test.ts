import assert from "node:assert/strict";
import test from "node:test";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { structuredModelText } from "../../src/recruitment/model-output.js";
import { createChatModel } from "../../src/recruitment/chat-model.js";

test("structured model invocation inside the production graph event stream does not auto-stream tokens", async () => {
  const previousFetch = globalThis.fetch;
  let wire: { stream?: boolean; messages?: unknown[] } | undefined;
  globalThis.fetch = async (_url, init) => {
    wire = JSON.parse(String(init?.body));
    if (wire?.stream) {
      return new Response(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ id: "fixture", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
  };
  try {
    const state = Annotation.Root({ result: Annotation<string> });
    const model = createChatModel("fixture", "fixture");
    const graph = new StateGraph(state)
      .addNode("model", async () => ({ result: structuredModelText((await model.invoke("Only return OK")).content) }))
      .addEdge(START, "model").addEdge("model", END).compile();
    const run = await graph.streamEvents({ result: "" }, { version: "v3", streamMode: ["custom"] });
    assert.equal((await run.output).result, "OK");
    assert.ok(wire);
    assert.equal(wire.stream, false, "event streaming must not implicitly enable token streaming for structured actions");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
