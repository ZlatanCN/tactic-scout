import assert from "node:assert/strict";
import test from "node:test";
import { createRecruitmentConversation, type RecruitmentAction, type RecruitmentPlanner } from "../../src/recruitment/conversation.js";
import type { PlayerRepository, PlayerSearchQuery } from "../../src/sources/registry.js";
import { type PlayerProfile } from "../../src/domain/players.js";

function attacker(index: number): PlayerProfile {
  return {
    playerId: `historical-forward-${index}`,
    name: `Historical Forward ${index}`,
    team: "Historical Club",
    age: 23,
    position: "ATT",
    competition: "Historical League",
    season: "2017/18",
    minutes: 1800,
    eventDataComplete: true,
    stats: {
      goals: 8,
      assists: 3,
      passesAttempted: 300,
      passesCompleted: 225,
      longPasses: 10,
      carries: 35,
      pressures: 120,
      tackles: 8,
      interceptions: 4,
      shotAssists: 16,
    },
    source: "TactiScout historical fixture",
  };
}

function searchAction(targetTeam: string | null, position: "ATT" | "ST"): RecruitmentAction {
  return {
    action: "search_candidates",
    targetTeam,
    position,
    playerName: null,
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 10,
  };
}

test("a Planner cannot re-ask permission to broaden a position or cite unreturned player reports", async () => {
  const players = Array.from({ length: 41 }, (_, index) => attacker(index + 1));
  const repository: PlayerRepository = {
    mode: "wyscout",
    sourceName: "TactiScout 自建球探数据集 · Wyscout 2017/18",
    async loadPlayers() { return players; },
    async searchCandidates(query: PlayerSearchQuery) {
      const matching = players.filter((player) => !query.position || player.position === query.position);
      const page = matching.slice(query.offset, query.offset + Math.min(query.limit, 10));
      return {
        players: page,
        totalRecords: matching.length,
        offset: query.offset,
        nextOffset: query.offset + page.length < matching.length ? query.offset + page.length : null,
        appliedFilters: query.position ? ["position"] : [],
      };
    },
  };
  const decisionModes: Array<{ mode: string | undefined; users: number; tools: string[] }> = [];
  const trace: Array<{ phase: string; action?: string; proposedAction?: string; decisionSource?: string; policyBlocked?: boolean; toolName?: string; resultCount?: number }> = [];
  const knowledgeQueries: string[] = [];
  const repeatedExpansionQuestion: RecruitmentAction = {
    action: "ask_user",
    targetTeam: "Bayern Munich",
    question: "当前搜索结果显示，在已获取的报告中没有完全符合的样本。您希望继续扩大搜索范围至其他前锋位置，还是基于 Son、Vardy、Aubameyang 的报告进行能力拆解？",
    reason: "请确认下一步调查方向。",
  };
  const distinctExpansionQuestion: RecruitmentAction = {
    action: "ask_user",
    targetTeam: "Arsenal",
    question: "你希望优先关注禁区内争顶能力吗？",
    reason: "这会改变后续可观察的能力维度。",
  };
  const finish: RecruitmentAction = {
    action: "finish",
    targetTeam: "Bayern Munich",
    needSummary: "已按用户同意的前锋范围完成有限样本调查；未检索到球员报告。",
    capabilityProfile: ["中锋接应、做球和终结"],
    recommendations: [],
    limitationKeys: ["other"],
  };
  const planner: RecruitmentPlanner = {
    async decide(input) {
      const latestUserTurn = input.history.filter((entry) => entry.role === "user").length;
      const tools = input.history.filter((entry) => entry.role === "tool").map((entry) => entry.toolName);
      decisionModes.push({ mode: input.decisionMode, users: latestUserTurn, tools });
      if (input.decisionMode === "reorient") return finish;
      if (input.decisionMode === "expand") {
        return /Arsenal|阿森纳/i.test(input.targetTeam ?? "") ? distinctExpansionQuestion : repeatedExpansionQuestion;
      }
      if (!tools.includes("search_methodology")) {
        return { action: "search_methodology", targetTeam: input.targetTeam, query: "前锋接应与终结评估方法" };
      }
      if (latestUserTurn === 1) return searchAction(input.targetTeam, "ATT");
      if (latestUserTurn === 2) return searchAction(input.targetTeam, "ST");
      if (latestUserTurn === 3) return searchAction(input.targetTeam, "ATT");
      assert.fail("the graph should use its scripted clarification and expansion decisions");
    },
  };
  const conversation = createRecruitmentConversation({
    repository,
    planner,
    knowledgeBase: {
      async search(query) { knowledgeQueries.push(query.corpus); return []; },
    },
    observer(event) {
      trace.push({
        phase: event.phase,
        ...(event.phase === "decision"
          ? { action: event.action, proposedAction: event.proposedAction, decisionSource: event.decisionSource, policyBlocked: event.policyBlocked }
          : { toolName: event.toolName, resultCount: event.resultCount }),
      });
    },
  });
  const threadId = "approved-position-expansion-question";
  let response = await conversation.turn({
    threadId,
    message: "为拜仁寻找凯恩的中锋替代者，重点看能接应、做球和终结的前锋。",
  });
  assert.equal(response.status, "needs_input");

  response = await conversation.turn({
    threadId,
    message: "可以扩大到其他前锋位置继续找，重点仍是能接应、做球和终结。",
    expectsExistingState: true,
  });

  assert.equal(response.status, "completed");
  assert.equal(response.report?.knowledgeCoverage.playerReportChunksRetrieved, 0);
  assert.ok(decisionModes.some(({ mode }) => mode === "expand"), JSON.stringify({ decisionModes, trace, knowledgeQueries, status: response.status, message: response.message }));
  assert.equal(decisionModes.some(({ mode }) => mode === "expand_recovery"), false);
  assert.equal(trace.some((event) => event.phase === "decision" && event.action === "ask_user" && event.policyBlocked), false);
  assert.ok(trace.some((event) => event.phase === "decision"
    && event.action === "search_candidates"
    && event.proposedAction === "ask_user"
    && event.decisionSource === "policy"));
  assert.doesNotMatch(response.message, /Son|Vardy|Aubameyang/);

  const secondThreadId = "material-expansion-question-remains-available";
  response = await conversation.turn({
    threadId: secondThreadId,
    message: "为阿森纳寻找凯恩的中锋替代者，重点看能接应、做球和终结的前锋。",
  });
  assert.equal(response.status, "needs_input");
  response = await conversation.turn({
    threadId: secondThreadId,
    message: "可以扩大到其他前锋位置继续找，重点仍是能接应、做球和终结。",
    expectsExistingState: true,
  });
  assert.equal(response.status, "needs_input");
  assert.equal(response.message, distinctExpansionQuestion.question);
});
