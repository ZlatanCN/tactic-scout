import assert from "node:assert/strict";
import test from "node:test";
import { AIMessage } from "@langchain/core/messages";
import { KnowledgeSearchRequestSchema } from "../../src/knowledge/schemas.js";
import { validateRecruitmentBrief, type RecruitmentBrief } from "../../src/recruitment/brief.js";
import { createRecruitmentConversation, type RecruitmentPlanner, type RecruitmentTraceEvent } from "../../src/recruitment/conversation.js";
import { RecruitmentActionSchema } from "../../src/recruitment/recruitment-actions.js";
import { parseRecruitmentPlannerOutput, recruitmentPlannerToolManifest, RecruitmentToolProtocolError } from "../../src/recruitment/recruitment-tools.js";
import { roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

function call(name: string, args: Record<string, unknown>, id: string) {
  return new AIMessage({
    content: "",
    tool_calls: [{ name, args, id, type: "tool_call" }],
  });
}

const brief: RecruitmentBrief = {
  task: "reinforcement",
  targetTeam: { value: "巴萨", basis: "explicit", quote: "巴萨" },
  referencePlayer: null,
  referenceClues: [],
  referenceRecheck: null,
  selectedCandidateId: null,
  criteria: [
    { field: "position", operator: "in", value: ["ATT"], unit: null, attributeKey: null, strength: "required", basis: "explicit", quote: "前锋" },
    { field: "capability", operator: "match", value: "进球", unit: null, attributeKey: null, strength: "required", basis: "explicit", quote: "重点看进球" },
  ],
  unresolved: [],
};

function finishCall(id = "finish") {
  return call("finish", {
    targetTeam: "巴萨",
    needSummary: "根据当前比赛表现整理后续考察线索。",
    capabilityProfile: [],
    recommendations: [],
    limitationKeys: ["other"],
    reportObservations: [],
  }, id);
}

test("native tool protocol diagnostics expose only invalid argument paths", () => {
  assert.throws(() => parseRecruitmentPlannerOutput(call("search_candidates", {
    position: "MID",
    maxAge: 46,
  }, "invalid-search")), (error: unknown) => {
    assert.ok(error instanceof RecruitmentToolProtocolError);
    assert.equal(error.failure, "invalid_arguments");
    assert.deepEqual(error.issuePaths, ["maxAge"]);
    assert.deepEqual(error.issueCodes, ["maxAge:too_big:max=45"]);
    return true;
  });
});
test("native tool schemas keep target-team context server-owned", () => {
  const definitions = recruitmentPlannerToolManifest(RecruitmentActionSchema);
  for (const definition of definitions) {
    assert.equal(
      "targetTeam" in definition.function.parameters.properties,
      false,
      `${definition.function.name} must read targetTeam from graph state`,
    );
  }

  const finish = parseRecruitmentPlannerOutput(call("finish", {
    targetTeam: { value: "model-controlled" },
    needSummary: "根据当前比赛表现整理后续考察线索。",
    capabilityProfile: [],
    recommendations: [],
    limitationKeys: ["other"],
    reportObservations: [],
  }, "finish-server-team"), undefined, "巴萨").action;
  assert.equal(finish.action, "finish");
  if (finish.action === "finish") assert.equal(finish.targetTeam, "巴萨");
});

test("native report and candidate tools leave server-owned fields to case state", () => {
  const reportTool = recruitmentPlannerToolManifest(RecruitmentActionSchema)
    .find(definition => definition.function.name === "search_player_reports");
  assert.ok(reportTool);
  assert.equal("playerNames" in reportTool.function.parameters.properties, false);

  const reportAction = parseRecruitmentPlannerOutput(call("search_player_reports", {
    query: "补充候选人的报告观察",
  }, "report-without-names")).action;
  assert.equal(reportAction.action, "search_player_reports");
  if (reportAction.action === "search_player_reports") assert.deepEqual(reportAction.playerNames, []);

  const candidateAction = parseRecruitmentPlannerOutput(call("search_candidates", {
    position: "MID",
    positions: [],
    maxAge: null,
    offset: 0,
    limit: 20,
  }, "candidate-with-empty-positions")).action;
  assert.equal(candidateAction.action, "search_candidates");
  if (candidateAction.action === "search_candidates") assert.equal(candidateAction.positions, undefined);
});

test("native list-valued tool arguments normalize singleton inputs while preserving tool scope", () => {
  const inspection = parseRecruitmentPlannerOutput(call("inspect_candidate_group", {
    playerIds: "candidate-1",
    sections: "recent",
  }, "single-player-inspection")).action;
  assert.equal(inspection.action, "inspect_candidate_group");
  if (inspection.action === "inspect_candidate_group") {
    assert.deepEqual(inspection.playerIds, ["candidate-1"]);
    assert.deepEqual(inspection.sections, ["recent"]);
  }

  const groupInspection = parseRecruitmentPlannerOutput(call("inspect_candidate_group", {
    playerIds: ["candidate-1", "candidate-2"],
    sections: "recent",
  }, "candidate-group-inspection")).action;
  assert.equal(groupInspection.action, "inspect_candidate_group");
  if (groupInspection.action === "inspect_candidate_group") {
    assert.deepEqual(groupInspection.playerIds, ["candidate-1", "candidate-2"]);
    assert.deepEqual(groupInspection.sections, ["recent"]);
  }

  const evaluation = parseRecruitmentPlannerOutput(call("evaluate_candidates", {
    playerIds: "candidate-1",
  }, "single-candidate-evaluation")).action;
  assert.equal(evaluation.action, "evaluate_candidates");
  if (evaluation.action === "evaluate_candidates") assert.deepEqual(evaluation.playerIds, ["candidate-1"]);

});

test("unknown finish limitation labels fall back to the explicit generic limitation", () => {
  const finish = parseRecruitmentPlannerOutput(call("finish", {
    needSummary: "根据当前比赛表现整理后续考察线索。",
    capabilityProfile: [],
    recommendations: [],
    limitationKeys: ["budget", "transfer_feasibility"],
    reportObservations: [],
  }, "finish-unknown-limitation"), undefined, "巴萨").action;

  assert.equal(finish.action, "finish");
  if (finish.action === "finish") assert.deepEqual(finish.limitationKeys, ["budget", "other"]);
});

test("createRecruitmentConversation routes a native named candidate tool through the graph and finishes", async () => {
  const candidate = roleConstraintPlayer("native-tool-forward", "Native Tool Forward", "ATT");
  const queries: Array<{ position: string | null }> = [];
  const trace: RecruitmentTraceEvent[] = [];
  const decisions = [
    call("search_candidates", {
      position: "MID", playerName: null, maxAge: null,
      minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 20,
    }, "search-1"),
    call("finish", {
      needSummary: "根据当前比赛表现整理后续考察线索。",
      capabilityProfile: [], recommendations: [], limitationKeys: ["other"], reportObservations: [],
    }, "finish-server-team"),
  ];
  const planner = {
    async decide() {
      const next = decisions.shift();
      assert.ok(next, "the graph must complete using the scripted native tool calls");
      return next;
    },
  } as unknown as RecruitmentPlanner;
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret(input) { return validateRecruitmentBrief(brief, [...input.recentMessages, input.message]); } },
    repository: {
      mode: "demo",
      sourceName: "Synthetic tool-call fixture",
      async loadPlayers() { return [candidate]; },
      async searchCandidates(query) {
        queries.push({ position: query.position });
        return { players: [candidate], totalRecords: 1, nextOffset: null, offset: query.offset, appliedFilters: ["position"] };
      },
    },
    planner,
    experimentalRetrievalMode: "on_demand",
    experimentalReviewerMode: "bypassed",
    observer(event) { trace.push(event); },
  });

  const result = await conversation.turn({ threadId: "native-tool-call", message: "为巴萨找一个前锋，重点看进球" });

  assert.equal(result.status, "completed", result.message);
  assert.deepEqual(queries, [{ position: "ATT" }], "deterministic policy must correct an incompatible position before tool execution");
  assert.ok(trace.some(event => event.phase === "tool" && event.toolName === "search_candidates"));
  assert.ok(trace.some(event => event.phase === "tool" && event.toolName === "evaluate_candidates"), "discovered candidates must still be evaluated by the graph");
  assert.equal(decisions.length, 0);
});

test("the full graph still searches player reports when candidate club or season metadata is missing", async () => {
  const candidate = {
    ...roleConstraintPlayer("native-tool-context-gap", "Context Gap Forward", "ATT"),
    team: undefined as unknown as string,
    competition: "",
    season: "",
  };
  const reportSearchRequests: unknown[] = [];
  const trace: RecruitmentTraceEvent[] = [];
  const decisions = [
    call("search_candidates", {
      targetTeam: "巴萨", position: "ATT", playerName: null, maxAge: null,
      minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 20,
    }, "search-context-gap"),
    finishCall("finish-context-gap"),
    finishCall("finish-after-report-context-gap"),
  ];
  const planner = {
    async decide() {
      const next = decisions.shift();
      assert.ok(next, `the graph must complete using the scripted native tool calls: ${JSON.stringify(trace.map(event => event.phase === "decision" ? { phase: event.phase, action: event.action, decisionSource: event.decisionSource } : event.phase === "tool" ? { phase: event.phase, toolName: event.toolName, ok: event.ok } : event))}`);
      return next;
    },
  } as unknown as RecruitmentPlanner;
  const reportBrief = {
    ...brief,
    criteria: [
      ...brief.criteria.filter(criterion => criterion.field !== "capability"),
      { field: "capability" as const, operator: "match" as const, value: "高位压迫适配", unit: null, attributeKey: null, strength: "preferred" as const, basis: "explicit" as const, quote: "高位压迫适配" },
    ],
  };
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret(input) { return validateRecruitmentBrief(reportBrief, [...input.recentMessages, input.message]); } },
    repository: {
      mode: "demo",
      sourceName: "Synthetic tool-call fixture",
      async loadPlayers() { return [candidate]; },
      async searchCandidates(query) {
        return { players: [candidate], totalRecords: 1, nextOffset: null, offset: query.offset, appliedFilters: ["position"] };
      },
    },
    knowledgeBase: {
      async search(request) {
        if (request.corpus === "player_report") {
          reportSearchRequests.push(request);
          KnowledgeSearchRequestSchema.parse(request);
        }
        return [];
      },
    },
    planner,
    experimentalRetrievalMode: "on_demand",
    experimentalReviewerMode: "bypassed",
    observer(event) { trace.push(event); },
  });

  const result = await conversation.turn({ threadId: "native-tool-context-gap", message: "为巴萨找一个前锋，重点看高位压迫适配" });

  assert.equal(result.status, "completed", result.message);
  assert.equal(reportSearchRequests.length, 1, "the report search should still run by player name when optional context fields are unknown");
  const request = KnowledgeSearchRequestSchema.parse(reportSearchRequests[0]);
  assert.ok(request.playerNames.length > 0);
  assert.equal(request.playerContexts, undefined);
  assert.ok(trace.some(event => event.phase === "tool" && event.toolName === "search_player_reports" && event.ok));
});

test("createRecruitmentConversation routes native ask_user and finish calls as graph control flow", async () => {
  const trace: RecruitmentTraceEvent[] = [];
  const players = Array.from({ length: 25 }, (_, index) => ({
    ...roleConstraintPlayer(`native-control-${index + 1}`, `Native Control Forward ${index + 1}`, "ATT"),
    source: "Wyscout Open Data",
    season: "2017/18",
  }));
  const decisions = [
    call("search_candidates", {
      targetTeam: "巴萨", position: "ATT", playerName: null, maxAge: null,
      minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 10,
    }, "search-2"),
    call("ask_user", { question: "你希望优先关注禁区内争顶能力吗？", reason: "这会改变后续可观察的能力维度。", targetTeam: "巴萨" }, "ask-1"),
    finishCall("finish-2"),
  ];
  const planner = {
    async decide() {
      const next = decisions.shift();
      assert.ok(next, "the graph must complete using the scripted native control calls");
      return next;
    },
  } as unknown as RecruitmentPlanner;
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret(input) { return validateRecruitmentBrief(brief, [...input.recentMessages, input.message]); } },
    repository: {
      mode: "wyscout",
      sourceName: "Synthetic tool-call fixture",
      async loadPlayers() { return players; },
      async searchCandidates(query) {
        const matching = players.filter(player => !query.position || player.position === query.position);
        const page = matching.slice(query.offset, query.offset + Math.min(query.limit, 10));
        return {
          players: page,
          totalRecords: matching.length,
          nextOffset: query.offset + page.length < matching.length ? query.offset + page.length : null,
          offset: query.offset,
          appliedFilters: ["position"],
        };
      },
    },
    planner,
    knowledgeBase: { async search() { return []; } },
    experimentalRetrievalMode: "on_demand",
    experimentalReviewerMode: "bypassed",
    experimentalExpansionSufficiencyMode: "bypassed",
    observer(event) { trace.push(event); },
  });

  const first = await conversation.turn({ threadId: "native-control-call", message: "为巴萨找一个前锋，重点看进球" });
  assert.equal(first.status, "needs_input", first.message);
  assert.equal(first.message, "你希望优先关注禁区内争顶能力吗？");
  assert.ok(!trace.some(event => event.phase === "tool" && (event.toolName as string) === "ask_user"), "ask_user must route to the wait node, not execute as a data tool");

  const second = await conversation.turn({ threadId: "native-control-call", message: "暂时不限制，继续按进球表现找", expectsExistingState: true });
  assert.equal(second.status, "completed", second.message);
  assert.ok(!trace.some(event => event.phase === "tool" && (event.toolName as string) === "finish"), "finish must route to review/report, not execute as a data tool");
  assert.equal(decisions.length, 0);
});
