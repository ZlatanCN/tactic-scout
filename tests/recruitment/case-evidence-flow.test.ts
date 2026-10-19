import assert from "node:assert/strict";
import test from "node:test";
import { validateRecruitmentBrief, type RecruitmentBrief } from "../../src/recruitment/brief.js";
import { createRecruitmentConversation, type RecruitmentAction, type RecruitmentPlanner } from "../../src/recruitment/conversation.js";
import { roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

test("the full LangGraph conclusion loop exposes evidence refs, reads only selected evidence, then resumes conclusion", async () => {
  const candidate = roleConstraintPlayer("evidence-reader", "Evidence Reader", "CB");
  const brief: RecruitmentBrief = {
    task: "reinforcement",
    targetTeam: { value: "巴萨", basis: "explicit", quote: "巴萨" },
    referencePlayer: null,
    referenceClues: [],
    referenceRecheck: null,
    selectedCandidateId: null,
    positions: ["CB"],
    allowsAnyPosition: false,
    filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null },
    priorities: [],
    constraints: [],
    unresolved: [],
  };
  const actions: RecruitmentAction[] = [];
  const plannerCalls: Array<Parameters<RecruitmentPlanner["decide"]>[0]> = [];
  const trace: Array<Record<string, unknown>> = [];
  let evidenceRead = false;
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret(input) { return validateRecruitmentBrief(brief, [...input.recentMessages, input.message]); } },
    repository: {
      mode: "demo", sourceName: "Fixture",
      async loadPlayers() { return [candidate]; },
      async searchCandidates(query) { return { players: [candidate], totalRecords: 1, nextOffset: null, offset: query.offset, appliedFilters: ["position"] }; },
    },
    experimentalDeterministicSearchMode: "enabled",
    experimentalRetrievalMode: "on_demand",
    experimentalContextManagementMode: "unified",
    planner: {
      async decide(input) {
        plannerCalls.push(input);
        if (input.decisionMode !== "conclude" && input.decisionMode !== "reorient") return { action: "finish", targetTeam: "巴萨", needSummary: "完成", capabilityProfile: [], recommendations: [], limitationKeys: [] };
        const progress = input.caseProgress as { evidenceDirectory?: Array<{ ref: string; kind: string }> } | undefined;
        const directory = progress?.evidenceDirectory ?? [];
        if (!evidenceRead) {
          assert.ok(input.availableActions?.includes("read_case_evidence"));
          const metricRef = directory.find(item => item.kind === "player_metrics")?.ref;
          assert.ok(metricRef, "conclusion context should provide an evidence ref");
          return { action: "read_case_evidence", targetTeam: "巴萨", refs: [metricRef], fields: ["body"], cursor: null, limit: 1800 };
        }
        const read = input.history.find(entry => entry.role === "tool" && entry.toolName === "read_case_evidence");
        assert.ok(read);
        const readPayload = JSON.parse(read.content) as { results: Array<{ status: string; content: string }> };
        assert.equal(readPayload.results[0]?.status, "ok");
        assert.match(readPayload.results[0]?.content ?? "", /"playerId":"evidence-reader"/);
        return { action: "finish", targetTeam: "巴萨", needSummary: "证据已核对", capabilityProfile: [], recommendations: [], limitationKeys: [] };
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer(event) {
      trace.push(event as unknown as Record<string, unknown>);
      if (event.phase === "tool" && event.toolName === "read_case_evidence") evidenceRead = true;
    },
  });

  const response = await conversation.turn({ threadId: "case-evidence-flow", message: "为巴萨找一名中卫" });

  assert.equal(response.status, "completed");
  assert.equal(evidenceRead, true, JSON.stringify({ plannerModes: plannerCalls.map(call => ({ mode: call.decisionMode, actions: call.availableActions, progress: call.caseProgress })), trace, response: { message: response.message, brief: response.brief, report: response.report?.needSummary } }));
  assert.ok(plannerCalls.length >= 2);
});
