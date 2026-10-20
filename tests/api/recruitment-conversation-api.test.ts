import assert from "node:assert/strict";
import test from "node:test";
import { turnRecruitmentCase } from "../../web/src/features/recruitment/lib/api.js";

const responseBody = {
  threadId: "case-1",
  status: "needs_input" as const,
  message: "你更看重即战力还是培养空间？",
  question: { reason: "这会改变目标球员的年龄与样本取舍。" },
  report: null,
};

test("conversation API sends a turn to the case endpoint and parses the shared response", async (t) => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  assert.deepEqual(await turnRecruitmentCase("case/one", "回复年龄偏好"), responseBody);
  assert.equal(requestUrl, "/api/v1/recruitment/cases/case%2Fone/turns");
  assert.equal(requestInit?.method, "POST");
  const sentBody = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.deepEqual({ message: sentBody.message, expectsExistingState: sentBody.expectsExistingState }, { message: "回复年龄偏好", expectsExistingState: false });
  assert.match(String(sentBody.memoryOwnerId), /^[0-9a-f-]{36}$/);
});

test("conversation API preserves the existing checkpoint for a follow-up turn", async (t) => {
  let requestInit: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    requestInit = init;
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  await turnRecruitmentCase("existing-case", "补充预算偏好", true, "request-2");

  const sentBody = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.deepEqual({ requestId: sentBody.requestId, message: sentBody.message, expectsExistingState: sentBody.expectsExistingState }, {
    requestId: "request-2",
    message: "补充预算偏好",
    expectsExistingState: true,
  });
  assert.match(String(sentBody.memoryOwnerId), /^[0-9a-f-]{36}$/);
});

test("conversation API posts a question-bound player identity choice", async (t) => {
  let requestInit: RequestInit | undefined;
  const identityAnswer = { questionId: "00000000-0000-4000-8000-000000000123", entityId: "Q25369" };
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    requestInit = init;
    return new Response(JSON.stringify({ ...responseBody, question: null, status: "completed", message: "已确认并继续。" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  await turnRecruitmentCase("identity-case", "选择 Joshua Kimmich", true, "request-identity", undefined, undefined, identityAnswer);

  const sentBody = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.deepEqual({ requestId: sentBody.requestId, message: sentBody.message, expectsExistingState: sentBody.expectsExistingState, playerIdentityAnswer: sentBody.playerIdentityAnswer }, {
    requestId: "request-identity", message: "选择 Joshua Kimmich", expectsExistingState: true, playerIdentityAnswer: identityAnswer,
  });
  assert.match(String(sentBody.memoryOwnerId), /^[0-9a-f-]{36}$/);
});

test("conversation API rejects a response that violates the case contract", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ ...responseBody, status: "done" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));

  await assert.rejects(() => turnRecruitmentCase("case-1", "继续"), /服务端返回的数据格式不符合当前招募契约/);
});
