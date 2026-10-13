import assert from "node:assert/strict";
import test from "node:test";
import { isTurnUnresolved, resolveTurnRequest } from "../web/src/turn-requests.js";

test("a turn remains unresolved while executing or awaiting an unknown outcome", () => {
  assert.equal(isTurnUnresolved(true, null), true);
  assert.equal(isTurnUnresolved(false, {
    caseId: "case-1",
    requestId: "request-1",
    message: "调查",
    expectsExistingState: false,
    isReanalysis: true,
    outcomeUnknown: true,
    displayText: "重新分析",
  }), true);
  assert.equal(isTurnUnresolved(false, null), false);
});

test("a fresh reanalysis request keeps its new case ID and gets one request ID", () => {
  const result = resolveTurnRequest({
    requested: {
      caseId: "fresh-case",
      message: "全新调查",
      expectsExistingState: false,
      isReanalysis: true,
      displayText: "重新分析当前需求",
    },
    pending: null,
    createRequestId: () => "request-1",
  });

  assert.equal(result.blockedByUnknownOutcome, false);
  assert.deepEqual(result.request, {
    caseId: "fresh-case",
    message: "全新调查",
    expectsExistingState: false,
    isReanalysis: true,
    displayText: "重新分析当前需求",
    requestId: "request-1",
    outcomeUnknown: false,
  });
});

test("an unknown reanalysis retry reuses its original case and request IDs", () => {
  let generatedIds = 0;
  const result = resolveTurnRequest({
    requested: {
      caseId: "accidentally-new-case",
      message: "全新调查",
      expectsExistingState: false,
      isReanalysis: true,
      displayText: "重新分析当前需求",
    },
    pending: {
      caseId: "original-fresh-case",
      requestId: "original-request",
      message: "全新调查",
      expectsExistingState: false,
      isReanalysis: true,
      outcomeUnknown: true,
      displayText: "重新分析当前需求",
    },
    createRequestId: () => {
      generatedIds += 1;
      return "should-not-be-used";
    },
  });

  assert.equal(generatedIds, 0);
  assert.equal(result.blockedByUnknownOutcome, false);
  assert.equal(result.request?.caseId, "original-fresh-case");
  assert.equal(result.request?.requestId, "original-request");
  assert.equal(result.request?.outcomeUnknown, false);
});

test("a different turn is blocked while the previous request outcome is unknown", () => {
  const result = resolveTurnRequest({
    requested: {
      caseId: "case-1",
      message: "修改年龄条件",
      expectsExistingState: true,
      isReanalysis: false,
      displayText: "修改年龄条件",
    },
    pending: {
      caseId: "fresh-case",
      requestId: "request-1",
      message: "全新调查",
      expectsExistingState: false,
      isReanalysis: true,
      outcomeUnknown: true,
      displayText: "重新分析当前需求",
    },
    createRequestId: () => "request-2",
  });

  assert.equal(result.request, null);
  assert.equal(result.blockedByUnknownOutcome, true);
});
