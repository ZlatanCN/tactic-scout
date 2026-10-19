import assert from "node:assert/strict";
import test from "node:test";
import { validateRecruitmentBrief, type RecruitmentBrief } from "../../src/recruitment/brief.js";
import { createRecruitmentConversation, type RecruitmentAction, type RecruitmentPlanner } from "../../src/recruitment/conversation.js";
import { roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

test("the full LangGraph independently gates evidence references and reads only selected evidence", async () => {
  const modes = ["legacy", "projection", "evidence", "unified"] as const;
  for (const mode of modes) {
    const evidenceEnabled = mode === "evidence" || mode === "unified";
    const candidate = roleConstraintPlayer(`evidence-reader-${mode}`, "Evidence Reader", "CB");
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
    const plannerCalls: Array<Parameters<RecruitmentPlanner["decide"]>[0]> = [];
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
      experimentalContextManagementMode: mode,
      planner: {
        async decide(input) {
          plannerCalls.push(input);
          if (input.decisionMode !== "conclude" && input.decisionMode !== "reorient") {
            return { action: "finish", targetTeam: "巴萨", needSummary: "完成", capabilityProfile: [], recommendations: [], limitationKeys: [] };
          }
          assert.equal(input.availableActions?.includes("read_case_evidence"), evidenceEnabled, `${mode} must expose only its assigned evidence feature`);
          if (!evidenceEnabled || evidenceRead) {
            return { action: "finish", targetTeam: "巴萨", needSummary: "完成", capabilityProfile: [], recommendations: [], limitationKeys: [] };
          }
          const progress = input.caseProgress as { evidenceDirectory?: Array<{ ref: string; kind: string }> } | undefined;
          const directory = progress?.evidenceDirectory ?? [];
          const metricRef = directory.find(item => item.kind === "player_metrics")?.ref;
          assert.ok(metricRef, `${mode} conclusion context should provide an evidence ref`);
          return { action: "read_case_evidence", targetTeam: "巴萨", refs: [metricRef], fields: ["body"], cursor: null, limit: 1_800 };
        },
      },
      knowledgeBase: { async search() { return []; } },
      observer(event) {
        if (event.phase === "tool" && event.toolName === "read_case_evidence") evidenceRead = true;
      },
    });

    const response = await conversation.turn({ threadId: `case-evidence-flow-${mode}`, message: "为巴萨找一名中卫" });

    assert.equal(response.status, "completed", `${mode}: ${response.message}`);
    assert.equal(evidenceRead, evidenceEnabled, `${mode} evidence read should match its feature flag`);
    if (evidenceEnabled) {
      const read = plannerCalls.at(-1)?.history.find(entry => entry.role === "tool" && entry.toolName === "read_case_evidence");
      assert.ok(read);
      const payload = JSON.parse(read.content) as { results: Array<{ status: string; content: string }> };
      assert.equal(payload.results[0]?.status, "ok");
      assert.match(payload.results[0]?.content ?? "", new RegExp(`\\"playerId\\":\\"${candidate.playerId}\\"`));
    }
  }
});
