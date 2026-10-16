import assert from "node:assert/strict";
import test from "node:test";
import { loadActiveRecruitmentSession, saveActiveRecruitmentSession, type ActiveRecruitmentSession } from "../src/active-session";

function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; }
const questionId = "00000000-0000-4000-8000-000000000002";
const base: ActiveRecruitmentSession = {
  threadId: "case-pitch", messages: [{ id: "question", role: "assistant", content: "选择位置", questionReason: "需要确认补强区域", questionInput: { kind: "positions", questionId, highlightedPositions: ["LB", "LWB"], selectedPositions: [] } }],
  report: null, reportAt: null, status: "needs_input", originalBrief: "为巴萨找后卫", planName: "", activePlanId: null, hasConversationState: true, pendingTurnRequest: null,
};

test("refresh restores the same pending position question without creating a new case", () => {
  const store = storage(); saveActiveRecruitmentSession(base, store);
  assert.deepEqual(loadActiveRecruitmentSession(store), base);
});

test("refresh preserves the structured request ID and requires outcome recovery instead of a second submission", () => {
  const store = storage();
  saveActiveRecruitmentSession({ ...base, pendingTurnRequest: { requestId: "00000000-0000-4000-8000-000000000003", caseId: "case-pitch", message: "已选择位置", expectsExistingState: true, positionAnswer: { questionId, positions: ["LB", "LWB"] }, isReanalysis: false, outcomeUnknown: false, displayText: "已选择：左后卫、左翼卫" } }, store);
  const restored = loadActiveRecruitmentSession(store);
  assert.equal(restored?.pendingTurnRequest?.requestId, "00000000-0000-4000-8000-000000000003");
  assert.deepEqual(restored?.pendingTurnRequest?.positionAnswer?.positions, ["LB", "LWB"]);
  assert.equal(restored?.pendingTurnRequest?.outcomeUnknown, true);
});

test("unreadable browser session does not prevent starting a new investigation", () => {
  assert.equal(loadActiveRecruitmentSession({ getItem() { throw new Error("storage disabled"); } }), null);
  assert.equal(loadActiveRecruitmentSession({ getItem() { return "{}"; } }), null);
});
