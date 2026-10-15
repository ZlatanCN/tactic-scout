import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecruitmentConversationPanel, type RecruitmentConversationView } from "../src/RecruitmentConversationPanel";

function renderConversation(overrides: Partial<RecruitmentConversationView>) {
  const view: RecruitmentConversationView = {
    threadId: "case-recovery", activePlanId: null, messages: [], report: null,
    status: "ready", isFreshCase: false, isActive: true, waitingForAnswer: false,
    turnUnresolved: true, loading: false, hasConversationState: false,
    pendingTurnRequest: {
      requestId: "same-request", caseId: "case-recovery", message: "为拜仁找前锋",
      expectsExistingState: false, isReanalysis: false, outcomeUnknown: true,
      displayText: "为拜仁找前锋",
    },
    progress: null, progressConnection: "stale", elapsedSeconds: 10,
    cancellingRequestId: null, draft: "为拜仁找前锋", teamContext: "", planName: "",
    userCount: 0, error: "连接中断，本轮结果尚未确认。", notice: null,
    ...overrides,
  };
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(RecruitmentConversationPanel, {
    view,
    actions: {
      onSendMessage: noop, onCancelTurn: noop, onDraftChange: noop,
      onTeamContextChange: noop, onPlanNameChange: noop,
    },
  }));
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  return { html, view, buttons };
}

for (const isReanalysis of [false, true]) {
  test(`an unknown ${isReanalysis ? "reanalysis" : "conversation"} outcome has an enabled recovery action while edits stay locked`, () => {
    const { html, buttons } = renderConversation({
      pendingTurnRequest: {
        requestId: "same-request", caseId: "case-recovery", message: "为拜仁找前锋",
        expectsExistingState: false, isReanalysis, outcomeUnknown: true,
        displayText: "为拜仁找前锋",
      },
    });
    const recovery = buttons.find((button) => button[2].includes("恢复本轮结果"));
    assert.ok(recovery, "the user must have a visible way to recover the pending request");
    assert.doesNotMatch(recovery[1], /\bdisabled(?:=|\s|$)/);
    assert.match(recovery[1], /type="button"/);
    assert.match(html, /<textarea\b[^>]*\bdisabled=""[^>]*>为拜仁找前锋<\/textarea>/);
  });
}

test("an executing request cannot be submitted again through the composer", () => {
  const { buttons } = renderConversation({ loading: true });
  const submit = buttons.find((button) => button[2].includes("调查中…"));
  assert.ok(submit);
  assert.match(submit[1], /\bdisabled=""/);
  assert.equal(buttons.some((button) => button[2].includes("恢复本轮结果")), false);
});
