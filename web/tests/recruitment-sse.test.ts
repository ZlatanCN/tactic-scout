import assert from "node:assert/strict";
import test from "node:test";
import {
  readRecruitmentEventStream,
  shouldFallbackRecruitmentStreamToJson,
} from "../src/features/recruitment/lib/recruitment-sse";
import { turnRecruitmentCaseStream } from "../src/features/recruitment/lib/api";
import { ApiContractError, ApiHttpError, ApiStreamError } from "../src/features/recruitment/lib/api-contract";

function streamResponse(blocks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(block));
      controller.close();
    },
  }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("the POST stream publishes progress before the final result", async () => {
  const requestId = "6e2fb89c-0b5b-471f-8406-c8f28147f22b";
  const progress = {
    requestId,
    active: true,
    stage: "planning",
    message: "正在规划调查步骤",
    completedSteps: 1,
    updatedAt: "2026-10-18T08:00:00.000Z",
    events: [{
      sequence: 1,
      occurrence: 1,
      stage: "planning",
      status: "started",
      message: "正在规划调查步骤",
      occurredAt: "2026-10-18T08:00:00.000Z",
    }],
  };
  const response = {
    threadId: "stream-client",
    status: "completed",
    message: "本轮调查完成。",
    question: null,
    report: null,
  };
  const received: string[] = [];

  const result = await readRecruitmentEventStream(streamResponse([
    `event: progress\ndata: ${JSON.stringify({ type: "progress", requestId, progress })}\n\n`,
    `event: result\ndata: ${JSON.stringify({ type: "result", requestId, response })}\n\n`,
  ]), {
    onProgress: (value) => received.push(value.stage),
  });

  assert.deepEqual(received, ["planning"]);
  assert.equal(result.status, "completed");
  assert.equal(result.threadId, "stream-client");
});

test("an interrupted POST stream rejects so the caller can recover the original request", async () => {
  const requestId = "6e2fb89c-0b5b-471f-8406-c8f28147f22b";
  const progress = {
    requestId,
    active: true,
    stage: "planning",
    message: "正在规划调查步骤",
    completedSteps: 1,
    updatedAt: "2026-10-18T08:00:00.000Z",
    events: [],
  };

  await assert.rejects(
    readRecruitmentEventStream(streamResponse([
      `event: progress\ndata: ${JSON.stringify({ type: "progress", requestId, progress })}\n\n`,
    ]), { onProgress: () => undefined }),
    /流式调查连接提前结束/,
  );
});

test("JSON fallback is limited to failures that happened before turn execution", () => {
  assert.equal(shouldFallbackRecruitmentStreamToJson(new ApiStreamError("流式调查连接没有响应内容。", "missing_body")), true);
  assert.equal(shouldFallbackRecruitmentStreamToJson(new ApiHttpError(404, "stream endpoint missing")), true);
  assert.equal(shouldFallbackRecruitmentStreamToJson(new TypeError("network interrupted")), false);
  assert.equal(shouldFallbackRecruitmentStreamToJson(new ApiStreamError("流式调查连接提前结束，本轮结果尚未确认。", "interrupted")), false);
  assert.equal(shouldFallbackRecruitmentStreamToJson(new ApiContractError("流式调查", new Error("shape mismatch"))), false);
  assert.equal(shouldFallbackRecruitmentStreamToJson(new ApiHttpError(503, "model unavailable")), false);
  assert.equal(shouldFallbackRecruitmentStreamToJson(new ApiHttpError(409, "case expired")), false);
  assert.equal(shouldFallbackRecruitmentStreamToJson(new Error("business failure")), false);
  assert.equal(shouldFallbackRecruitmentStreamToJson(new ApiHttpError(404, "stream endpoint missing"), { started: true }), false);
});

test("an SSE application error keeps its HTTP status and message", async () => {
  const requestId = "6e2fb89c-0b5b-471f-8406-c8f28147f22b";

  await assert.rejects(
    readRecruitmentEventStream(streamResponse([
      `event: error\ndata: ${JSON.stringify({
        type: "error",
        requestId,
        statusCode: 503,
        message: "当前模型服务不可用。",
      })}\n\n`,
    ]), { onProgress: () => undefined }),
    (error: unknown) => error instanceof ApiHttpError
      && error.statusCode === 503
      && error.message === "当前模型服务不可用。",
  );
});

test("the POST stream sends the existing request ID and accepts application SSE events", async () => {
  const originalFetch = globalThis.fetch;
  const requestId = "c7a8aa3e-8d48-4f47-bc84-930f5fd8600a";
  let body: unknown;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as unknown;
    return streamResponse([
      `event: result\ndata: ${JSON.stringify({
        type: "result",
        requestId,
        response: {
          threadId: "stream-client",
          status: "completed",
          message: "本轮调查完成。",
          question: null,
          report: null,
        },
      })}\n\n`,
    ]);
  };
  try {
    const result = await turnRecruitmentCaseStream(
      "stream-client",
      "为拜仁寻找凯恩的替代者",
      false,
      requestId,
      undefined,
      undefined,
      undefined,
      { onProgress: () => undefined },
    );
    assert.deepEqual(body, {
      requestId,
      message: "为拜仁寻找凯恩的替代者",
      expectsExistingState: false,
    });
    assert.equal(result.status, "completed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the POST stream parses candidate preview events", async () => {
  const requestId = "6e2fb89c-0b5b-471f-8406-c8f28147f22b";
  const received: Array<{ name: string; minutes: number; completedSteps: number }> = [];

  const result = await readRecruitmentEventStream(streamResponse([
    `event: candidates\ndata: ${JSON.stringify({
      type: "candidates",
      requestId,
      completedSteps: 3,
      candidates: [{
        playerId: "u-1", name: "Player A", team: "Leverkusen", position: "ATT", age: 23, minutes: 900,
        source: "understat", competition: "德甲", season: "2026/27",
      }],
    })}\n\n`,
    `event: result\ndata: ${JSON.stringify({
      type: "result",
      requestId,
      response: { threadId: "stream-client", status: "completed", message: "本轮调查完成。", question: null, report: null },
    })}\n\n`,
  ]), {
    onProgress: () => undefined,
    onCandidates: (candidates, completedSteps) => {
      for (const candidate of candidates) received.push({ name: candidate.name, minutes: candidate.minutes, completedSteps });
    },
  });

  assert.deepEqual(received, [{ name: "Player A", minutes: 900, completedSteps: 3 }]);
  assert.equal(result.status, "completed");
});

test("a rejected stream endpoint stays eligible for JSON fallback", async () => {
  const originalFetch = globalThis.fetch;
  let headersReceived = false;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
  try {
    await assert.rejects(
      turnRecruitmentCaseStream(
        "stream-client",
        "为拜仁寻找凯恩的替代者",
        false,
        "c7a8aa3e-8d48-4f47-bc84-930f5fd8600a",
        undefined,
        undefined,
        undefined,
        {
          onProgress: () => undefined,
          onHeaders: () => { headersReceived = true; },
        },
      ),
      (error: unknown) => error instanceof ApiHttpError && error.statusCode === 404,
    );
    assert.equal(headersReceived, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an empty successful stream response remains eligible for JSON fallback", async () => {
  const originalFetch = globalThis.fetch;
  let headersReceived = false;
  globalThis.fetch = async () => new Response(null, { status: 200 });
  try {
    await assert.rejects(
      turnRecruitmentCaseStream(
        "stream-client",
        "为拜仁寻找凯恩的替代者",
        false,
        "c7a8aa3e-8d48-4f47-bc84-930f5fd8600a",
        undefined,
        undefined,
        undefined,
        {
          onProgress: () => undefined,
          onHeaders: () => { headersReceived = true; },
        },
      ),
      (error: unknown) => error instanceof ApiStreamError && error.kind === "missing_body",
    );
    assert.equal(headersReceived, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
