import assert from "node:assert/strict";
import test from "node:test";
import { positionSelectionFixture as fixture } from "../fixtures/position-selection.js";

test("HTTP pitch confirmation resumes the same graph with an any-position union and preserves non-position constraints", async () => {
  const { app, queries } = fixture();
  try {
    const first = await app.inject({ method: "POST", url: "/api/v1/recruitment/cases/pitch-union/turns", payload: { message: "为巴萨寻找提升防守的球员，年龄不超过25岁，至少900分钟，重点看抢断和拦截" } });
    assert.equal(first.statusCode, 200);
    const question = first.json();
    assert.equal(question.status, "needs_input");
    assert.equal(question.question.input.kind, "positions");
    const response = await app.inject({ method: "POST", url: "/api/v1/recruitment/cases/pitch-union/turns", payload: {
      expectsExistingState: true, positionAnswer: { questionId: question.question.input.questionId, positions: ["LB", "LWB"] },
    } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().status, "completed", response.body);
    assert.deepEqual(response.json().report.recommendations.map((item: { player: { playerId: string } }) => item.player.playerId).sort(), ["left-back", "wing-back"]);
    const union = queries.find((query) => query.positions?.length === 2);
    assert.ok(union, "the selected positions must reach the repository together");
    assert.equal(union.maxAge, 25);
    assert.equal(union.minimumMinutes, 900);
    assert.equal(union.position, null);
  } finally { await app.close(); }
});

test("stale position confirmation is rejected before another graph or model call", async () => {
  const { app, plannerCalls } = fixture();
  try {
    const before = plannerCalls();
    const response = await app.inject({ method: "POST", url: "/api/v1/recruitment/cases/pitch-stale/turns", payload: {
      positionAnswer: { questionId: "00000000-0000-4000-8000-000000000001", positions: ["LB"] },
    } });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(plannerCalls(), before);
  } finally { await app.close(); }
});

test("changing confirmed positions starts a new scoped investigation and does not reuse the previous shortlist", async () => {
  const { app } = fixture();
  const url = "/api/v1/recruitment/cases/pitch-edit/turns";
  try {
    const first = (await app.inject({ method: "POST", url, payload: { message: "为巴萨寻找提升防守的球员，年龄不超过25岁，至少900分钟，重点看抢断和拦截" } })).json();
    const confirmed = await app.inject({ method: "POST", url, payload: { positionAnswer: { questionId: first.question.input.questionId, positions: ["LB", "LWB"] } } });
    assert.equal(confirmed.json().status, "completed");
    const changed = await app.inject({ method: "POST", url, payload: { expectsExistingState: true, positionUpdate: ["RW"] } });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.deepEqual(changed.json().report.requestedPositions, ["RW"]);
    assert.deepEqual(changed.json().report.recommendations.map((item: { player: { playerId: string } }) => item.player.playerId), ["right-wing"]);
    assert.equal(changed.json().report.positionCoverage[0].searched, true);
  } finally { await app.close(); }
});

test("position confirmation request IDs preserve one outcome and reject a changed selection", async () => {
  const { app, plannerCalls } = fixture();
  const url = "/api/v1/recruitment/cases/pitch-idempotency/turns";
  try {
    const first = (await app.inject({ method: "POST", url, payload: { message: "为巴萨寻找提升防守的球员，重点看抢断和拦截" } })).json();
    const payload = { requestId: "00000000-0000-4000-8000-000000000020", positionAnswer: { questionId: first.question.input.questionId, positions: ["LB", "LWB"] } };
    const response = await app.inject({ method: "POST", url, payload });
    const calls = plannerCalls();
    const retry = await app.inject({ method: "POST", url, payload });
    assert.deepEqual(retry.json(), response.json());
    assert.equal(plannerCalls(), calls);
    const conflict = await app.inject({ method: "POST", url, payload: { ...payload, positionAnswer: { ...payload.positionAnswer, positions: ["RW"] } } });
    assert.equal(conflict.statusCode, 409);
    assert.equal(plannerCalls(), calls);
  } finally { await app.close(); }
});

test("an empty single-position question accepts a structured keep-current answer without another search", async () => {
  const { app, queries } = fixture();
  const url = "/api/v1/recruitment/cases/pitch-keep-current/turns";
  try {
    const first = await app.inject({ method: "POST", url, payload: { message: "为巴萨找中锋，年龄不超过25岁，至少900分钟，重点看抢断和拦截" } });
    assert.equal(first.json().status, "needs_input", first.body);
    assert.equal(first.json().question.input.allowKeepCurrent, true);
    const count = queries.length;
    const response = await app.inject({ method: "POST", url, payload: { positionAnswer: { questionId: first.json().question.input.questionId, positions: ["ST"], keepCurrent: true } } });
    assert.equal(response.json().status, "completed", response.body);
    assert.deepEqual(response.json().report.recommendations, []);
    assert.equal(queries.length, count);
  } finally { await app.close(); }
});
