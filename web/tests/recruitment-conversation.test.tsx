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
      onSendMessage: noop, onUpdatePositions: noop, onCancelTurn: noop, onDraftChange: noop,
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

test("an interrupted structured position submission keeps an enabled recovery action beside the locked pitch", () => {
  const questionId = "00000000-0000-4000-8000-000000000050";
  const { html, buttons } = renderConversation({
    waitingForAnswer: true,
    status: "needs_input",
    messages: [{ id: "pitch-question", role: "assistant", content: "选择位置", questionReason: "确认招募位置", questionInput: { kind: "positions", questionId, highlightedPositions: ["LB", "LWB"], selectedPositions: [] } }],
    pendingTurnRequest: { requestId: "00000000-0000-4000-8000-000000000051", caseId: "case-recovery", message: "已选择位置", positionAnswer: { questionId, positions: ["LB", "LWB"] }, expectsExistingState: true, isReanalysis: false, outcomeUnknown: true, displayText: "已选择：左后卫、左翼卫" },
  });
  assert.match(html, /足球场位置/);
  const recovery = buttons.find(([, , content]) => content.includes("恢复本轮结果"));
  assert.ok(recovery);
  assert.doesNotMatch(recovery[1]!, /\sdisabled(?:=|\s|$)/);
  assert.match(html, /aria-label="左后卫 LB"[^>]*disabled/);
});

test("an uncertain reference identity presents explicit player choices before the user can continue", () => {
  const questionId = "00000000-0000-4000-8000-000000000070";
  const { html, buttons } = renderConversation({
    waitingForAnswer: true,
    status: "needs_input",
    turnUnresolved: false,
    pendingTurnRequest: null,
    messages: [{ id: "identity-question", role: "assistant", content: "基米希可能指下列球员，请确认。", questionReason: "姓名近似需要确认。", questionInput: {
      kind: "player_identity", questionId, mention: "基米西", candidates: [
        { entityId: "Q25369", name: "Joshua Kimmich", description: "德国足球运动员", sourceUrl: "https://www.wikidata.org/wiki/Q25369" },
        { entityId: "Q99999", name: "Other Kimmich", sourceUrl: "https://www.wikidata.org/wiki/Q99999" },
      ],
    } }],
  });
  assert.match(html, /确认参考球员/);
  assert.match(html, /原始提及：“基米西”/);
  assert.match(html, /Joshua Kimmich/);
  assert.match(html, /Other Kimmich/);
  assert.ok(buttons.filter(([, , content]) => content.includes("Kimmich")).length >= 2);
  assert.match(html, /都不是？在下方补充/);
});
