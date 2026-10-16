import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { MemorySaver } from "@langchain/langgraph";
import { createApp } from "../src/app.js";
import { MultiSourceCurrentPlayerRepository } from "../src/data/multi-source-provider.js";
import {
  createRecruitmentConversation,
  RecruitmentCaseStateExpiredError,
  RecruitmentModelTimeoutError,
  RecruitmentPlannerOutputError,
  unavailableRecruitmentConversation,
  type RecruitmentAction,
  type RecruitmentConversation,
  type RecruitmentPlanner,
  type RecruitmentTraceEvent,
} from "../src/agent/conversation.js";
import { createSinglePassInvestigationPlanner } from "../src/evals/fixed-investigation-planner.js";
import type { PlayerRepository, PlayerSearchFilter, PlayerSearchQuery } from "../src/data/provider.js";
import type { PlayerProfile } from "../src/domain/schemas.js";
import type { KnowledgeSearchResult } from "../src/knowledge/schemas.js";

const previousStatsBombProcessingPermission = process.env.TACTISCOUT_STATSBOMB_AI_PROCESSING_ALLOWED;
const previousModelEndpoint = process.env.OPENAI_BASE_URL;

before(() => {
  // These tests use injected fixture repositories and planners, not the user's configured provider data.
  process.env.TACTISCOUT_STATSBOMB_AI_PROCESSING_ALLOWED = "true";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
});

after(() => {
  if (previousStatsBombProcessingPermission === undefined) delete process.env.TACTISCOUT_STATSBOMB_AI_PROCESSING_ALLOWED;
  else process.env.TACTISCOUT_STATSBOMB_AI_PROCESSING_ALLOWED = previousStatsBombProcessingPermission;
  if (previousModelEndpoint === undefined) delete process.env.OPENAI_BASE_URL;
  else process.env.OPENAI_BASE_URL = previousModelEndpoint;
});

function roleConstraintPlayer(playerId: string, name: string, position: PlayerProfile["position"]): PlayerProfile {
  return {
    playerId,
    name,
    team: "Harbor City",
    age: 23,
    position,
    competition: "Open League",
    season: "2025/26",
    minutes: 1800,
    stats: { goals: 8, assists: 3, passesAttempted: 300, passesCompleted: 225, longPasses: 10, carries: 35, pressures: 120, tackles: 8, interceptions: 4, shotAssists: 16 },
    source: "StatsBomb Open Data",
  };
}

test("a recruitment case can pause for a user answer through the HTTP turn interface", async () => {
  const calls: Array<{ threadId: string; message: string; expectsExistingState?: boolean }> = [];
  const conversation: RecruitmentConversation = {
    async turn(input) {
      calls.push({ threadId: input.threadId, message: input.message, expectsExistingState: input.expectsExistingState });
      return {
        threadId: input.threadId,
        status: "needs_input",
        message: "优先找即战力，还是培养接班人？",
        question: {
          reason: "这会改变目标球员的年龄和出场样本取舍。",
        },
        report: null,
      };
    },
  };
  const app = createApp({ recruitmentConversation: conversation });
  const threadId = "case-bayern-kane-1";

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/recruitment/cases/${threadId}/turns`,
      payload: { message: "为拜仁寻找凯恩的替代者" },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      threadId,
      status: "needs_input",
      message: "优先找即战力，还是培养接班人？",
      question: { reason: "这会改变目标球员的年龄和出场样本取舍。" },
      report: null,
    });
    assert.deepEqual(calls, [{ threadId, message: "为拜仁寻找凯恩的替代者", expectsExistingState: false }]);
  } finally {
    await app.close();
  }
});

test("Understat cohort evidence enters the LangGraph case before candidate evaluation and reaches the report", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const candidates = [
    { ...roleConstraintPlayer("understat-forward-1", "Forward One", "ST"), source: "Understat", externalPlayerId: "101", season: "2026/27", sourceIdentity: { provider: "understat" as const, playerId: "EPL:101", competitionId: "EPL", seasonId: "2026", positionGroup: "ATT" as const, retrievedAt: "2026-10-15T00:00:00.000Z" }, availableStats: ["goals", "assists"] },
    { ...roleConstraintPlayer("understat-forward-2", "Forward Two", "ST"), source: "Understat", externalPlayerId: "102", season: "2026/27", sourceIdentity: { provider: "understat" as const, playerId: "EPL:102", competitionId: "EPL", seasonId: "2026", positionGroup: "ATT" as const, retrievedAt: "2026-10-15T00:00:00.000Z" }, availableStats: ["goals", "assists"] },
  ];
  const groupResearch = candidates.map((player, index) => ({
    playerId: player.playerId,
    name: player.name,
    team: player.team,
    competition: player.competition,
    season: player.season,
    sourcePlayerId: String(101 + index),
    sourceUrl: `https://understat.com/player/${101 + index}`,
    retrievedAt: "2026-10-15T00:00:00.000Z",
    player: { id: String(101 + index), name: player.name, favoritePosition: "ST" },
    lastMatch: null,
    requestedSections: ["positions", "history", "recent", "shotProfile"],
    availableSections: ["positions", "shotProfile"],
    positions: [{ season: "2026", code: "FW", minutes: 1200, games: 14, goals: index === 0 ? 8 : 4, shots: 30, xG: index === 0 ? 7 : 3, assists: 2, xA: 1.2, keyPasses: 12, npxG: 6.5, xGChain: 10, xGBuildup: 4 }],
    history: [],
    recent: [],
    shotProfile: [{ season: "2026", dimension: "situation", category: "Open Play", goals: 6, shots: 20, xG: 5.8, assists: 1, keyPasses: 9, xA: 1, npg: 6, npxG: 5.5, minutes: 1200 }],
    notes: ["位置为来源比赛记录，不代表固定职责。"],
  }));
  const actionQueue: RecruitmentAction[] = [
    { action: "search_candidates", targetTeam: null, position: "ST", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 20 },
    { action: "inspect_candidate_group", targetTeam: null, playerIds: candidates.map(({ playerId }) => playerId), sections: ["positions", "history", "recent", "shotProfile"] },
      { action: "finish", targetTeam: null, needSummary: "比较两名前锋的射门机会质量。", capabilityProfile: ["射门机会质量"], recommendations: [{ playerId: candidates[0]!.playerId, evidenceKeys: ["understatExpectedGoalsPer90"] }], limitationKeys: [] },
  ];
  const conversation = createRecruitmentConversation({
    experimentalDeterministicSearchMode: "bypassed",
    experimentalRetrievalMode: "on_demand",
    repository: {
      mode: "understat",
      sourceName: "Understat fixture",
      async loadPlayers() { return candidates; },
      async searchCandidates(query) {
        const players = candidates.filter((player) => player.position === query.position);
        return { players: players.slice(query.offset, query.offset + query.limit), totalRecords: players.length, offset: query.offset, nextOffset: null, appliedFilters: query.position ? ["position"] : [] };
      },
      async inspectCandidateGroup(playerIds) {
        assert.deepEqual(playerIds, candidates.map(({ playerId }) => playerId));
        return groupResearch;
      },
    },
    planner: { async decide() { const action = actionQueue.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => events.push(event),
  });

  const response = await conversation.turn({ threadId: "understat-cohort-case", message: "请找一名中锋，重点比较射门机会质量与非点球 xG" });

  assert.equal(response.status, "completed", `${response.message}; ${JSON.stringify(events)}`);
  assert.equal(response.report?.recommendations[0]?.understatResearch?.positions?.[0]?.xG, 7, JSON.stringify({ report: response.report, events }));
  assert.equal(response.report?.recommendations[0]?.understatResearch?.shotProfile?.[0]?.xG, 5.8);
  const xgEvidence = response.report?.recommendations[0]?.evidence.find(({ key }) => key === "understatExpectedGoalsPer90");
  assert.equal(xgEvidence?.value, 0.53, "position-split Understat detail must change the evaluator's observed metric");
  assert.match(xgEvidence?.sourceField ?? "", /groups\.position\[2026\]\[FW\]\.xG/);
  const toolNames = events.filter((event) => event.phase === "tool" && event.ok).map((event) => event.toolName);
  assert.ok(toolNames.indexOf("inspect_candidate_group") >= 0);
  assert.ok(toolNames.indexOf("inspect_candidate_group") < toolNames.indexOf("evaluate_candidates"), toolNames.join(" → "));
  const cohortTrace = events.find((event) => event.phase === "tool" && event.toolName === "inspect_candidate_group");
  assert.deepEqual(cohortTrace?.filters?.availableSectionCounts, ["positions=2/2", "history=0/2", "recent=0/2", "shotProfile=2/2"]);
});

test("a generic internal-research permission ask does not trigger a full Understat read", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const players = [roleConstraintPlayer("understat-generic-ask-1", "Forward One", "ST"), roleConstraintPlayer("understat-generic-ask-2", "Forward Two", "ST")];
  const actions: RecruitmentAction[] = [
    { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 },
    { action: "ask_user", question: "是否读取候选球员的内部详细数据？", reason: "补充信息可能有帮助。" },
    { action: "finish", targetTeam: "拜仁", needSummary: "现有来源指标已足以进行初步比较。", capabilityProfile: ["进球产出"], recommendations: [{ playerId: players[0]!.playerId, evidenceKeys: ["goals"] }], limitationKeys: [] },
  ];
  let detailReads = 0;
  const conversation = createRecruitmentConversation({
    experimentalUnderstatResearchMode: "adaptive",
    experimentalDeterministicSearchMode: "bypassed",
    experimentalRetrievalMode: "on_demand",
    repository: {
      mode: "understat",
      sourceName: "Understat fixture",
      async loadPlayers() { return players; },
      async searchCandidates(query) { return { players, totalRecords: players.length, offset: query.offset, nextOffset: null, appliedFilters: ["position"] }; },
      async inspectCandidateGroup() { detailReads += 1; return []; },
    },
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => events.push(event),
  });

  const response = await conversation.turn({ threadId: "understat-generic-research-ask", message: "为拜仁找一名前锋，重点比较进球产出" });

  assert.equal(response.status, "completed");
  assert.equal(detailReads, 0, "an unspecified request must not expand into every detail section");
  assert.equal(events.some((event) => event.phase === "decision" && event.action === "ask_user"), false);
  assert.ok(events.some((event) => event.phase === "tool" && event.toolName === "evaluate_candidates" && event.ok));
});

test("adaptive Understat evaluates discovered candidates before asking to switch sources for missing evidence", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const players = Array.from({ length: 12 }, (_, index) => roleConstraintPlayer(
    `understat-evidence-before-ask-${index + 1}`,
    `Forward ${index + 1}`,
    "ST",
  ));
  const actions: RecruitmentAction[] = [
    { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 },
    {
      action: "ask_user",
      question: "当前候选没有可用的进球数据，是否切换数据源？",
      reason: "需要先确认能否从其他来源获取证据。",
    },
    {
      action: "finish",
      targetTeam: "拜仁",
      needSummary: "先根据当前候选已经提供的进球数据完成初步比较。",
      capabilityProfile: ["进球产出"],
      recommendations: [{ playerId: players[0]!.playerId, evidenceKeys: ["goals"] }],
      limitationKeys: [],
    },
    {
      action: "finish",
      targetTeam: "拜仁",
      needSummary: "完成当前候选组的初步比较。",
      capabilityProfile: ["进球产出"],
      recommendations: [{ playerId: players[0]!.playerId, evidenceKeys: ["goals"] }],
      limitationKeys: [],
    },
  ];
  const conversation = createRecruitmentConversation({
    experimentalUnderstatResearchMode: "adaptive",
    experimentalDeterministicSearchMode: "bypassed",
    experimentalRetrievalMode: "on_demand",
    repository: {
      mode: "understat",
      sourceName: "Understat fixture",
      async loadPlayers() { return players; },
      async searchCandidates(query) {
        return { players: players.slice(query.offset, query.offset + query.limit), totalRecords: players.length, offset: query.offset, nextOffset: null, appliedFilters: ["position"] };
      },
    },
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => events.push(event),
  });

  const response = await conversation.turn({
    threadId: "understat-evidence-before-ask",
    message: "为拜仁找一名前锋，重点比较进球产出",
  });

  assert.equal(response.status, "completed", `${response.message}; ${JSON.stringify(events)}`);
  assert.ok(response.report?.recommendations.length);
  assert.equal(response.report?.evidenceCoverage.evaluatedCandidateCount, 12);
  assert.ok(events.some((event) => event.phase === "tool" && event.toolName === "evaluate_candidates" && event.ok));
  assert.equal(events.some((event) => event.phase === "decision" && event.action === "ask_user"), false);
  assert.ok(events.some((event) => event.phase === "decision"
    && event.proposedAction === "ask_user"
    && event.decisionSource === "policy"));
});

test("Understat research ablation strategies change tools inside the full LangGraph run", async () => {
  const candidates = [
    { ...roleConstraintPlayer("understat-ablation-1", "Forward One", "ST"), availableStats: ["goals", "assists"] },
    { ...roleConstraintPlayer("understat-ablation-2", "Forward Two", "ST"), availableStats: ["goals", "assists"] },
  ];
  const groupResearch = candidates.map((player, index) => ({
    playerId: player.playerId,
    name: player.name,
    team: player.team,
    competition: player.competition,
    season: player.season,
    sourcePlayerId: String(201 + index),
    sourceUrl: `https://understat.com/player/${201 + index}`,
    retrievedAt: "2026-10-15T00:00:00.000Z",
    player: { id: String(201 + index), name: player.name, favoritePosition: "ST" },
    lastMatch: null,
    requestedSections: ["positions", "history", "recent", "shotProfile"],
    availableSections: ["positions", "history", "recent", "shotProfile"],
    positions: [{ season: "2026", code: "FW", minutes: 1200, games: 14, goals: 8, shots: 30, xG: 7, assists: 2, xA: 1.2, keyPasses: 12, npxG: 6.5, xGChain: 10, xGBuildup: 4 }],
    history: [],
    recent: [],
    shotProfile: [],
    notes: [],
  }));
  const modes = ["catalog_only", "fixed_profile", "adaptive"] as const;

  for (const mode of modes) {
    const events: RecruitmentTraceEvent[] = [];
    const calledSections: string[][] = [];
    const conversation = createRecruitmentConversation({
      experimentalUnderstatResearchMode: mode,
      experimentalDeterministicSearchMode: "bypassed",
      experimentalRetrievalMode: "on_demand",
      repository: {
        mode: "understat",
        sourceName: "Understat fixture",
        async loadPlayers() { return candidates; },
        async searchCandidates(query) {
          return { players: candidates.slice(query.offset, query.offset + query.limit), totalRecords: candidates.length, offset: query.offset, nextOffset: null, appliedFilters: query.position ? ["position"] : [] };
        },
        async inspectCandidateGroup(playerIds, sections) {
          calledSections.push([...sections]);
          return groupResearch.filter(({ playerId }) => playerIds.includes(playerId));
        },
        async inspectPlayer(playerId, sections) {
          calledSections.push([...sections]);
          const research = groupResearch.find(({ playerId: candidateId }) => candidateId === playerId)!;
          return { ...research, availableSections: [...sections], shots: [] };
        },
      },
      planner: {
        async decide(input) {
          const toolNames = input.history.flatMap((entry) => entry.role === "tool" ? [entry.toolName] : []);
          if (!toolNames.includes("search_candidates")) return {
            action: "search_candidates",
            position: "ST",
            maxAge: null,
            minimumMinutes: 0,
            competition: null,
            season: null,
            offset: 0,
            limit: 20,
          };
          if (mode === "catalog_only" && !toolNames.includes("inspect_candidate_group")) return {
            action: "ask_user",
            question: "是否调用 inspect_candidate_group 查看这组候选的 xG 与射门资料？",
            reason: "这些内部数据可以进一步支持候选比较。",
          };
          if (mode === "adaptive" && !toolNames.includes("inspect_candidate_group")) return {
            action: "ask_user",
            question: "是否调用 inspect_candidate_group 查看这组候选的位置与历史赛季资料？",
            reason: "这些内部数据可以进一步支持候选比较。",
          };
          if (!toolNames.includes("evaluate_candidates")) return {
            action: "evaluate_candidates",
            playerIds: candidates.map(({ playerId }) => playerId),
          };
          if (mode === "adaptive" && !toolNames.includes("inspect_player")) return {
            action: "inspect_player",
            playerId: candidates[0]!.playerId,
            sections: ["shots"],
          };
          return {
            action: "finish",
            targetTeam: "拜仁",
            needSummary: "按相同首轮候选范围比较前锋表现。",
            capabilityProfile: ["进球产出"],
            recommendations: [{ playerId: candidates[0]!.playerId, evidenceKeys: ["goals"] }],
            limitationKeys: [],
          };
        },
      },
      knowledgeBase: { async search() { return []; } },
      observer: (event) => events.push(event),
    });

    const response = await conversation.turn({ threadId: `understat-ablation-${mode}`, message: "为拜仁找一名前锋，重点看进球和射门机会质量" });
    assert.equal(response.status, "completed", `${mode}: ${response.message}; report=${JSON.stringify(response.report)}; ${JSON.stringify(events)}`);
    const successfulToolNames = events.filter((event) => event.phase === "tool" && event.ok).map((event) => event.toolName);
    if (mode === "catalog_only") {
      assert.equal(successfulToolNames.includes("inspect_candidate_group"), false);
      assert.equal(successfulToolNames.includes("inspect_player"), false);
      assert.ok(successfulToolNames.includes("evaluate_candidates"));
      assert.equal(events.some((event) => event.phase === "decision" && event.action === "ask_user"), false, JSON.stringify(events));
      assert.ok(response.report!.recommendations.length > 0, JSON.stringify({ report: response.report, events }));
    } else if (mode === "fixed_profile") {
      assert.deepEqual(calledSections[0], ["positions", "history", "recent", "shotProfile"]);
      assert.ok(successfulToolNames.indexOf("inspect_candidate_group") < successfulToolNames.indexOf("evaluate_candidates"));
      assert.equal(successfulToolNames.includes("inspect_player"), false);
    } else {
      assert.deepEqual(calledSections, [["positions", "history"], ["shots"]]);
      assert.ok(successfulToolNames.indexOf("inspect_candidate_group") < successfulToolNames.indexOf("evaluate_candidates"));
      assert.ok(successfulToolNames.indexOf("evaluate_candidates") < successfulToolNames.indexOf("inspect_player"));
    }
  }
});

test("replacement searches inherit the reference player's role instead of asking whether to keep it", async () => {
  const scenarios = [
    { message: "为拜仁寻找诺伊尔的替代者，重点看进球产出", referenceName: "Manuel Neuer", position: "GK" as const },
    { message: "为拜仁寻找凯恩的替代者，重点看进球产出", referenceName: "Harry Kane", position: "ST" as const },
    { message: "为拜仁寻找 Alex Keeper 的替代者，重点看进球产出", referenceName: "Alex Keeper", position: "GK" as const },
  ];
  for (const scenario of scenarios) {
    const events: RecruitmentTraceEvent[] = [];
    const reference = { ...roleConstraintPlayer(`reference-${scenario.referenceName}`, scenario.referenceName, scenario.position), team: "Bayern Munich" };
    const candidate = { ...roleConstraintPlayer(`candidate-${scenario.referenceName}`, `Candidate ${scenario.position}`, scenario.position), availableStats: ["goals", "assists"] };
    let plannerCalls = 0;
    const conversation = createRecruitmentConversation({
      experimentalDeterministicSearchMode: "bypassed",
      experimentalRetrievalMode: "on_demand",
      repository: {
        mode: "understat",
        sourceName: "Understat",
        async inspectTeam() { return [reference]; },
        async loadPlayers() { return [reference, candidate]; },
        async searchCandidates(query) {
          const players = query.position === scenario.position ? [candidate] : [];
          return { players, totalRecords: players.length, offset: query.offset, nextOffset: null, appliedFilters: query.position ? ["position"] : [] };
        },
      },
      planner: {
        async decide() {
          plannerCalls += 1;
          if (plannerCalls <= 2) return {
            action: "ask_user",
            question: "你希望替代者延续参考球员的场上角色，还是考虑不同的位置或职责？",
            reason: "确认位置会改变候选池。",
          };
          return {
            action: "finish",
            targetTeam: "Bayern Munich",
            needSummary: "按参考球员的同位置范围完成调查。",
            capabilityProfile: ["进球产出"],
            recommendations: [{ playerId: candidate.playerId, evidenceKeys: ["goals"] }],
            limitationKeys: [],
          };
        },
      },
      knowledgeBase: { async search() { return []; } },
      observer: (event) => { events.push(event); },
    });

    const response = await conversation.turn({
      threadId: `same-position-replacement-${scenario.referenceName}`,
      message: scenario.message,
    });

    assert.equal(response.status, "completed", `${scenario.referenceName}: ${response.message}; ${JSON.stringify(events)}`);
    assert.equal(response.report?.recommendations[0]?.player.playerId, candidate.playerId, JSON.stringify({ status: response.status, report: response.report, events }));
    const successfulCandidateSearches = events.filter((event) => event.phase === "tool"
      && event.toolName === "search_candidates" && event.ok);
    assert.equal(successfulCandidateSearches.length, 1);
    assert.equal(successfulCandidateSearches[0]?.phase === "tool" ? successfulCandidateSearches[0].filters.position : "unexpected", scenario.position);
    assert.equal(events.filter((event) => event.phase === "tool" && event.toolName === "evaluate_candidates").length, 1);
    assert.equal(events.filter((event) => event.phase === "decision" && event.action === "ask_user" && event.askPolicyOutcome === "allowed").length, 0,
      "a replacement request inherits its reference player's position without exposing a redundant preference question");
    assert.ok(events.some((event) => event.phase === "decision" && event.proposedAction === "ask_user" && event.policyBlocked),
      "the harness rejects the Planner's generic same-role-versus-different-role question");
    assert.ok(events.some((event) => event.phase === "tool" && event.toolName === "inspect_team" && event.resultCount > 0),
      "the repro must include a successful team-roster lookup");
  }
});

test("replacement searches accept a resolved football role even when the reference has no local player record", async () => {
  const scenarios = [
    { name: "Manuel Neuer", message: "为拜仁寻找 Manuel Neuer 的替代者", position: "GK" as const },
    { name: "Harry Kane", message: "为拜仁寻找凯恩的替代者", position: "ST" as const },
    { name: "Kevin De Bruyne", message: "为曼城寻找 Kevin De Bruyne 的接班人", position: "AM" as const },
  ];

  for (const scenario of scenarios) {
    const events: RecruitmentTraceEvent[] = [];
    const candidate = {
      ...roleConstraintPlayer(`inferred-${scenario.position}`, `Candidate ${scenario.position}`, scenario.position),
      availableStats: ["goals", "assists"],
    };
    let proposedTheGenericQuestion = false;
    let plannedTheRoleSearch = false;
    const conversation = createRecruitmentConversation({
      experimentalDeterministicSearchMode: "bypassed",
      experimentalRetrievalMode: "on_demand",
      repository: {
        mode: "understat",
        sourceName: "Understat fixture",
        async inspectTeam() { return []; },
        async loadPlayers() { return [candidate]; },
        async searchCandidates(query) {
          const players = query.position === scenario.position ? [candidate] : [];
          return { players, totalRecords: players.length, offset: query.offset, nextOffset: null, appliedFilters: query.position ? ["position"] : [] };
        },
      },
      planner: {
        async decide(input) {
          const history = input.history;
          if (input.decisionMode === "conclude" || input.decisionMode === "reorient") return {
            action: "finish",
            targetTeam: null,
            needSummary: "按参考球员的默认场上位置完成调查。",
            capabilityProfile: ["可观察比赛表现"],
            recommendations: [{ playerId: candidate.playerId, evidenceKeys: ["goals"] }],
            limitationKeys: [],
          };
          if (!proposedTheGenericQuestion) {
            proposedTheGenericQuestion = true;
            return {
              action: "ask_user",
              question: "你希望替代者延续参考球员的场上角色，还是考虑不同的位置或职责？",
              reason: "确认位置会改变候选池。",
            };
          }
          if (!history.some(({ role, toolName }) => role === "tool" && toolName === "search_methodology")) {
            return { action: "search_methodology", query: "参考位置的可观察比赛能力", limit: 4 };
          }
          if (!plannedTheRoleSearch) {
            plannedTheRoleSearch = true;
            return { action: "search_candidates", position: scenario.position, minimumMinutes: 0, limit: 20 };
          }
          return { action: "finish", targetTeam: null, needSummary: "已完成。", capabilityProfile: [], recommendations: [], limitationKeys: [] };
        },
      },
      knowledgeBase: { async search() { return []; } },
      observer: (event) => { events.push(event); },
    });

    const response = await conversation.turn({ threadId: `unlisted-reference-${scenario.name}`, message: scenario.message });

    assert.equal(response.status, "completed", `${scenario.name}: ${response.message}; ${JSON.stringify(events)}`);
    assert.equal(response.report?.recommendations[0]?.player.playerId, candidate.playerId);
    const successfulSearch = events.find((event) => event.phase === "tool" && event.toolName === "search_candidates" && event.ok);
    assert.equal(successfulSearch?.phase === "tool" ? successfulSearch.filters.position : null, scenario.position);
    assert.equal(events.filter((event) => event.phase === "decision" && event.action === "ask_user" && event.askPolicyOutcome === "allowed").length, 0,
      "a stable position resolved by the Planner should be used without making the user confirm it");
    assert.ok(events.some((event) => event.phase === "decision" && event.proposedAction === "ask_user" && event.policyBlocked),
      "the harness rejects the generic same-role-versus-different-role question");
  }
});

test("the full graph safely pauses on unresolved role ambiguity when the ask policy is disabled", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "中锋替代者的可观察比赛能力" },
    { action: "search_candidates", position: null, minimumMinutes: 0, limit: 20 },
  ];
  const player = roleConstraintPlayer("candidate-1", "Jonas Vale", "ST");
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "statsbomb",
      sourceName: "StatsBomb Open Data",
      async searchCandidates(query) {
        return { players: [player], totalRecords: 1, offset: query.offset, nextOffset: null, appliedFilters: [] };
      },
    },
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { events.push(event); },
    experimentalAskUserMode: "disabled",
  });

  const response = await conversation.turn({
    threadId: "ask-policy-disabled-role-gap",
    message: "为拜仁寻找 Alex Unknown 的替代者，重点看能接应和做球。",
  });

  assert.equal(response.status, "needs_input");
  assert.equal(response.report, null);
  assert.match(response.message, /已禁用 Agent 追问.*关键需求仍未解决.*暂停.*未生成候选名单/);
  assert.equal(events.filter((event) => event.phase === "tool" && event.ok).length, 1,
    "unresolved role is clarified before methodology or mixed-position candidate search");
  assert.ok(events.some((event) => event.phase === "decision"
    && event.action === "ask_user"
    && event.decisionSource === "policy"
    && event.askPolicyOutcome === "suppressed"));
});

test("the full graph runs the frozen single-page investigation before shared conclusion synthesis", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const methodologyQueries: string[] = [];
  const conclusionInputs: Array<Parameters<RecruitmentPlanner["decide"]>[0]> = [];
  const player = roleConstraintPlayer("fixed-plan-striker", "Jonas Vale", "ST");
  const planner = createSinglePassInvestigationPlanner({
    async decide(input) {
      conclusionInputs.push(input);
      assert.equal(input.decisionMode, "conclude");
      return {
        action: "finish",
        targetTeam: "拜仁",
        needSummary: "按中锋角色检索并核验了当前比赛数据。",
        capabilityProfile: ["进球产出：引用 goals 指标"],
        recommendations: [{ playerId: player.playerId, evidenceKeys: ["goals"] }],
        limitationKeys: ["other"],
      };
    },
  });
  const conversation = createRecruitmentConversation({
    experimentalReferenceProfileMode: "bypassed",
    repository: { mode: "demo", sourceName: "Fixture", async loadPlayers() { return [player]; } },
    planner,
    knowledgeBase: {
      async search(request) {
        if (request.corpus === "methodology") methodologyQueries.push(request.query);
        return [];
      },
    },
    observer: (event) => { events.push(event); },
  });

  const firstTurn = await conversation.turn({
    threadId: "single-pass-investigation-planner",
    message: "为拜仁寻找凯恩的中锋接班人，重点看进球产出。",
  });
  assert.equal(firstTurn.status, "completed");
  assert.equal(firstTurn.report?.recommendations[0]?.player.playerId, player.playerId);
  assert.deepEqual(events.filter((event) => event.phase === "tool").map((event) => event.toolName), [
    "inspect_team",
    "search_methodology",
    "search_candidates",
    "evaluate_candidates",
    "search_player_reports",
  ]);
  assert.equal(methodologyQueries.length, 1);
  assert.doesNotMatch(methodologyQueries[0]!, /拜仁|凯恩|Jonas Vale/);
  const candidateSearches = events.filter((event) => event.phase === "tool" && event.toolName === "search_candidates");
  assert.equal(candidateSearches.length, 1, "the graph waits for a concrete position rather than sampling mixed roles first");
  assert.equal(candidateSearches[0]?.phase === "tool" ? candidateSearches[0].filters.position : null, "ST");
  assert.equal(events.filter((event) => event.phase === "review" && event.outcome === "passed").length, 1);
  assert.ok(conclusionInputs.some((input) => input.constraints?.evaluatedCandidates.some(({ playerId }) => playerId === player.playerId)),
    "the shared conclusion model receives the evaluated candidate evidence before report completion");
});

test("the full graph suppresses a Planner ask action without exposing its generated question", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const checkpointer = new MemorySaver();
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "中场推进能力评估方法" },
    { action: "search_candidates", position: "MID", minimumMinutes: 0, limit: 20 },
    { action: "search_player_reports", query: "候选人的比赛观察", playerNames: ["Jonas Vale"] },
    {
      action: "ask_user",
      question: "你希望更重视推进还是控球？",
      reason: "这个偏好会改变候选评估方向。",
    },
  ];
  const player = roleConstraintPlayer("candidate-1", "Jonas Vale", "CM");
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "statsbomb",
      sourceName: "StatsBomb Open Data",
      async searchCandidates(query) {
        return { players: [player], totalRecords: 1, offset: query.offset, nextOffset: null, appliedFilters: [] };
      },
    },
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { events.push(event); },
    checkpointer,
    experimentalAskUserMode: "disabled",
  });

  const response = await conversation.turn({
    threadId: "ask-policy-disabled-planner-action",
    message: "为巴萨找一名中场，重点看推进。",
  });

  assert.equal(response.status, "needs_input");
  assert.equal(response.report, null);
  assert.match(response.message, /已禁用 Agent 追问.*关键需求仍未解决/);
  assert.doesNotMatch(response.message, /更重视推进还是控球/);
  const checkpoint = await checkpointer.getTuple({ configurable: { thread_id: "ask-policy-disabled-planner-action" } });
  assert.ok(checkpoint);
  assert.doesNotMatch(JSON.stringify(checkpoint.checkpoint.channel_values), /更重视推进还是控球/);
  assert.ok(events.some((event) => event.phase === "decision"
    && event.decisionSource === "planner"
    && event.proposedAction === "ask_user"
    && event.askPolicyOutcome === "suppressed"));
});

test("the full graph does not treat raw carry or long-pass counts as progression evidence", async () => {
  const player = roleConstraintPlayer("raw-progression-only", "Jonas Vale", "CM");
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Fixture", async loadPlayers() { return [player]; } },
    planner: createSinglePassInvestigationPlanner({
      async decide() {
        return {
          action: "finish",
          targetTeam: "巴萨",
          needSummary: "寻找具备推进能力的中场。",
          capabilityProfile: ["推进"],
          recommendations: [{ playerId: player.playerId, evidenceKeys: ["carries", "longPasses"] }],
          limitationKeys: ["other"],
        };
      },
    }),
    knowledgeBase: { async search() { return []; } },
  });

  const response = await conversation.turn({
    threadId: "raw-counts-are-not-progression",
    message: "为巴萨找一名重点看推进能力的中场。",
  });

  assert.equal(response.status, "completed");
  assert.deepEqual(response.report?.recommendations, []);
  assert.deepEqual(response.report?.requestedCapabilityCoverage.find(({ name }) => name === "推进"), {
    name: "推进",
    requestedMetricKeys: ["wyscoutProgressivePassesPer90", "wyscoutAccurateProgressivePassesPct", "lineBreakPassesCompletedPer30Tip"],
    observedMetricKeys: [],
    evaluatedCandidateCount: 1,
    candidatesWithEvidenceCount: 0,
    status: "missing",
  });
});

test("the full graph does not substitute progressive passing for carrying progression", async () => {
  const player: PlayerProfile = {
    ...roleConstraintPlayer("passing-is-not-carrying", "Jonas Vale", "CM"),
    supplementaryMetrics: [{
      key: "wyscoutProgressivePassesPer90",
      definition: "Derived from forward distance between pass start and end locations.",
      value: 4.2,
      unit: "次/90分钟",
      normalization: "per90",
      sourceField: "Wyscout pass-event coordinates",
      sampleMinutes: 1800,
      sampleMatches: 20,
    }],
  };
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Fixture", async loadPlayers() { return [player]; } },
    planner: createSinglePassInvestigationPlanner({
      async decide() {
        return {
          action: "finish",
          targetTeam: "巴萨",
          needSummary: "寻找具备带球推进能力的中场。",
          capabilityProfile: ["带球推进"],
          recommendations: [{ playerId: player.playerId, evidenceKeys: ["wyscoutProgressivePassesPer90"] }],
          limitationKeys: ["other"],
        };
      },
    }),
    knowledgeBase: { async search() { return []; } },
  });

  const response = await conversation.turn({
    threadId: "progressive-passing-is-not-carrying",
    message: "为巴萨找一名重点看带球推进能力的中场。",
  });

  assert.equal(response.status, "completed");
  assert.equal(response.report?.recommendations.length, 1);
  assert.match(response.report?.needSummary ?? "", /待考察线索.*尚未核实/);
  assert.ok(response.report?.recommendations[0]?.tradeoffs.some((item) => item.includes("带球推进")));
  assert.deepEqual(response.report?.requestedCapabilityCoverage.find(({ name }) => name === "带球推进"), {
    name: "带球推进",
    requestedMetricKeys: [],
    observedMetricKeys: [],
    evaluatedCandidateCount: 1,
    candidatesWithEvidenceCount: 0,
    status: "missing",
  });
});

test("a failed candidate query remains distinct from a successful zero-match search", async () => {
  const progressUpdates: Array<{ stage: string; status: "started" | "completed" | "waiting_for_user" | "notice" | "failed"; message: string; completedSteps: number }> = [];
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "中场推进评估方法" },
    { action: "search_candidates", position: "MID", minimumMinutes: 0, limit: 10 },
    {
      action: "finish",
      targetTeam: "Barcelona",
      needSummary: "因候选来源请求失败，暂时无法确认可用名单。",
      capabilityProfile: ["中场推进"],
      recommendations: [],
      limitationKeys: [],
    },
  ];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "sportmonks",
      sourceName: "Sportmonks",
      async searchCandidates() {
        throw Object.assign(new Error(`Sportmonks request failed before a response was received. Authorization: super-secret-token ${"x".repeat(1200)}`), { code: "network" });
      },
    },
    planner: {
      async decide(input) {
        if (input.history.at(-1)?.toolName === "search_candidates") {
          assert.match(input.history.at(-1)?.content ?? "", /Sportmonks request failed/);
          assert.doesNotMatch(input.history.at(-1)?.content ?? "", /super-secret-token/);
        }
        const action = actions.shift();
        assert.ok(action);
        return action;
      },
    },
    knowledgeBase: { async search() { return []; } },
  });

  const response = await conversation.turn({
    threadId: "candidate-query-failure",
    message: "为巴萨找一个能推进的中场",
    onProgress: (update) => { progressUpdates.push(update); },
  });

  assert.equal(response.status, "completed");
  assert.deepEqual(response.report?.recommendations, []);
  assert.match(response.message, /候选查询最近一次失败/);
  assert.match(response.message, /不代表没有匹配球员/);
  const failureLimitation = response.report?.limitations.find((item) => /最近一次候选查询失败/.test(item)) ?? "";
  assert.match(failureLimitation, /Sportmonks.*network.*request failed before a response was received/);
  assert.doesNotMatch(failureLimitation, /super-secret-token/);
  assert.ok(failureLimitation.length < 600, "reported provider errors must stay bounded");
  assert.ok(progressUpdates.some((update) => update.stage === "candidate_search" && update.status === "notice"));
});

test("ASA network failure finishes with an explicit source error instead of looping through unrelated tools", async () => {
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "边锋创造机会的评估方法" },
    { action: "search_candidates", position: null, minimumMinutes: 0, limit: 20 },
  ];
  let plannerCalls = 0;
  const events: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "asa",
      sourceName: "American Soccer Analysis · 北美五项当前赛季表现",
      async searchCandidates() {
        throw Object.assign(new Error("ASA could not be reached after bounded transport retries."), { code: "network" });
      },
    },
    planner: {
      async decide() {
        plannerCalls += 1;
        const action = actions.shift();
        assert.ok(action);
        return action;
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { events.push(event); },
  });

  const response = await conversation.turn({ threadId: "asa-network-failure", message: "为洛杉矶FC找一名边锋" });

  assert.equal(response.status, "completed");
  assert.equal(plannerCalls, 2, "after ASA's bounded transport retry, the graph must not ask the model to search unrelated data");
  assert.deepEqual(response.report?.recommendations, []);
  assert.match(response.message, /候选查询最近一次失败/);
  assert.match(response.message, /不代表没有匹配球员/);
  assert.ok(response.report?.limitations.some((item) => /最近一次候选查询失败.*network/.test(item)));
  assert.ok(events.some((event) => event.phase === "decision" && event.action === "finish" && event.decisionSource === "policy"));
});

test("the LangGraph trace carries one privacy-safe model-usage event per Planner model response", async () => {
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "中场推进的评估方法" },
    { action: "search_candidates", position: "MID", minimumMinutes: 0, limit: 20 },
  ];
  const events: RecruitmentTraceEvent[] = [];
  const plannerModes: string[] = [];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "asa",
      sourceName: "Fixture ASA",
      async searchCandidates() {
        throw Object.assign(new Error("Fixture source is offline."), { code: "network" });
      },
    },
    planner: {
      async decide(input) {
        const callPhase = input.decisionMode ?? "investigate";
        plannerModes.push(callPhase);
        input.onTokenUsage?.({
          callPhase,
          outcome: "response",
          inputTokens: 0,
          outputTokens: 5,
          totalTokens: 5,
        });
        const action = actions.shift();
        assert.ok(action);
        return action;
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { events.push(event); },
  });

  const response = await conversation.turn({
    threadId: "planner-usage-trace",
    message: "为巴萨找一名中场，重点看推进。",
  });

  assert.equal(response.status, "completed");
  const usageEvents = events.filter((event) => event.phase === "model_usage");
  assert.equal(usageEvents.length, plannerModes.length);
  assert.deepEqual(usageEvents.map((event) => event.phase === "model_usage" ? event.callPhase : null), plannerModes);
  assert.ok(usageEvents.every((event) => event.phase === "model_usage"
    && event.outcome === "response"
    && event.inputTokens === 0
    && event.outputTokens === 5
    && event.totalTokens === 5));
  assert.doesNotMatch(JSON.stringify(usageEvents), /中场|推进|Fixture|query|prompt|completion/i);
});

test("candidate-source failure stops before the Planner can repeat search or evaluate without candidates", async () => {
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "前锋进球与创造机会的评估方法" },
    { action: "search_candidates", position: "ATT", minimumMinutes: 0, limit: 20 },
  ];
  let plannerCalls = 0;
  const events: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "understat",
      sourceName: "Injected Understat fixture",
      async searchCandidates() {
        throw Object.assign(new Error("Injected candidate source could not be reached after bounded transport retries."), { code: "network" });
      },
    },
    planner: {
      async decide() {
        plannerCalls += 1;
        const action = actions.shift();
        assert.ok(action);
        return action;
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { events.push(event); },
  });

  const response = await conversation.turn({ threadId: "candidate-source-failure", message: "为阿森纳找一名进球和创造机会突出的前锋" });

  assert.equal(response.status, "completed");
  assert.equal(plannerCalls, 2, "the graph closes the source-failure path without another LLM decision");
  assert.deepEqual(response.report?.recommendations, []);
  assert.match(response.message, /候选查询最近一次失败/);
  assert.match(response.message, /无法确认/);
  assert.match(response.message, /不代表没有匹配球员/);
  assert.match(response.report?.needSummary ?? "", /无法确认匹配结果/);
  assert.ok(response.report?.limitations.some((item) => /最近一次候选查询失败.*network/.test(item)));
  assert.ok(events.some((event) => event.phase === "decision" && event.action === "finish" && event.decisionSource === "policy"));
  assert.equal(events.filter((event) => event.phase === "tool" && event.toolName === "evaluate_candidates").length, 0);
});

test("a later successful candidate query clears the unresolved source failure", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "中场推进评估方法" },
    { action: "search_candidates", position: "MID", minimumMinutes: 0, limit: 10 },
    { action: "search_candidates", position: "MID", minimumMinutes: 0, limit: 10 },
    {
      action: "finish",
      targetTeam: "Barcelona",
      needSummary: "成功查询后没有找到当前条件匹配的候选人。",
      capabilityProfile: ["中场推进"],
      recommendations: [],
      limitationKeys: [],
    },
  ];
  let searchCount = 0;
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "sportmonks",
      sourceName: "Sportmonks",
      async searchCandidates() {
        searchCount += 1;
        if (searchCount === 1) throw Object.assign(new Error("temporary network failure"), { code: "network" });
        return { players: [], totalRecords: 0, offset: 0, nextOffset: null, appliedFilters: ["position"] };
      },
    },
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { events.push(event); },
  });

  const response = await conversation.turn({ threadId: "candidate-query-recovered", message: "为巴萨找一个能推进的中场" });

  assert.equal(response.status, "completed");
  assert.equal(searchCount, 2);
  assert.match(response.message, /当前证据不足/, JSON.stringify(response));
  assert.equal(response.report?.limitations.some((item) => /最近一次候选查询失败/.test(item)), false);
  assert.equal(response.report?.needSummary, "成功查询后没有找到当前条件匹配的候选人。");
  assert.deepEqual(events.filter((event) => event.phase === "tool" && event.toolName === "search_candidates").map((event) => event.ok), [false, true]);
});

test("a repeated turn request ID returns the same run and progress instead of rerunning the case", async () => {
  const requestId = "c7a8aa3e-8d48-4f47-bc84-930f5fd8600a";
  let calls = 0;
  let completeTurn!: (response: Awaited<ReturnType<RecruitmentConversation["turn"]>>) => void;
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const pendingTurn = new Promise<Awaited<ReturnType<RecruitmentConversation["turn"]>>>((resolve) => { completeTurn = resolve; });
  const conversation: RecruitmentConversation = {
    async turn(input) {
      calls += 1;
      signalStarted();
      return pendingTurn;
    },
  };
  const app = createApp({ recruitmentConversation: conversation });
  const url = "/api/v1/recruitment/cases/idempotent-turn/turns";
  const payload = { requestId, message: "为巴萨找一名后卫" };

  try {
    const firstRun = app.inject({ method: "POST", url, payload });
    await started;
    const retry = app.inject({ method: "POST", url, payload });
    completeTurn({
      threadId: "idempotent-turn",
      status: "completed",
      message: "本轮调查完成。",
      question: null,
      report: null,
    });

    const [firstResponse, retryResponse] = await Promise.all([firstRun, retry]);
    assert.equal(firstResponse.statusCode, 200);
    assert.deepEqual(retryResponse.json(), firstResponse.json());
    assert.equal(calls, 1);
    assert.equal(firstResponse.json().progressEvents[0].stage, "starting");

    const replay = await app.inject({ method: "POST", url, payload });
    assert.deepEqual(replay.json(), firstResponse.json());
    assert.equal(calls, 1);

    const conflict = await app.inject({
      method: "POST",
      url,
      payload: { requestId, message: "另一条不同需求" },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(calls, 1);
  } finally {
    await app.close();
  }
});

test("the HTTP interface explains when a saved case checkpoint expired after a server restart", async () => {
  const conversation: RecruitmentConversation = {
    async turn() { throw new RecruitmentCaseStateExpiredError(); },
  };
  const app = createApp({ recruitmentConversation: conversation });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/case-after-restart/turns",
      payload: { message: "继续找人", expectsExistingState: true },
    });

    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /找不到此案件的内部调查状态/);
    assert.match(response.json().error, /浏览器中已有报告/);
  } finally {
    await app.close();
  }
});

test("the HTTP interface clearly reports when no model service is configured", async () => {
  const app = createApp({ recruitmentConversation: unavailableRecruitmentConversation() });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/new-case/turns",
      payload: { message: "为拜仁寻找凯恩的替代者" },
    });

    assert.equal(response.statusCode, 503);
    assert.match(response.json().error, /尚未配置模型服务/);
  } finally {
    await app.close();
  }
});

test("the HTTP interface reports a bounded model wait as a gateway timeout", async () => {
  const app = createApp({
    recruitmentConversation: {
      async turn() { throw new RecruitmentModelTimeoutError(180_000); },
    },
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/model-timeout/turns",
      payload: { message: "为巴萨找一名中场" },
    });

    assert.equal(response.statusCode, 504);
    assert.match(response.json().error, /超过 180 秒/);
  } finally {
    await app.close();
  }
});

test("knowledge status uses the knowledge base injected into the application", async () => {
  let statusReads = 0;
  const knowledgeBase = {
    async search() { return []; },
    async status() {
      statusReads += 1;
      return {
        indexedChunks: 42,
        methodologyChunks: 40,
        playerReportChunks: 2,
        registeredSources: 7,
        ingestiblePlayerReportSources: 3,
        embeddingModel: "test-embedding",
        indexPath: "/test/knowledge-index",
      };
    },
  };
  const app = createApp({ knowledgeBase, recruitmentConversation: unavailableRecruitmentConversation() });

  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/knowledge/status" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().indexedChunks, 42);
    assert.equal(response.json().indexPath, "/test/knowledge-index");
    assert.equal(statusReads, 1);
  } finally {
    await app.close();
  }
});

test("a recruitment case investigates, pauses for a material choice, resumes, and recommends with evidence", async () => {
  const playerRecords: PlayerProfile[] = [
    {
      playerId: "striker-a", name: "Jonas Vale", team: "Harbor City", age: 23, position: "ST",
      competition: "Open League", season: "2024/25", minutes: 2100,
      stats: { goals: 12, assists: 4, passesAttempted: 420, passesCompleted: 315, longPasses: 8, carries: 33, pressures: 160, tackles: 4, interceptions: 2, shotAssists: 18 },
      sourceIdentity: { provider: "statsbomb-open-data", playerId: "striker-a", competitionId: "open-league-1", seasonId: "2024", positionGroup: "ATT", retrievedAt: "2026-10-10T00:00:00.000Z" },
      source: "StatsBomb Open Data",
    },
    {
      playerId: "striker-b", name: "Marco Silva", team: "Eastvale", age: 25, position: "ST",
      competition: "Open League", season: "2024/25", minutes: 1800,
      stats: { goals: 8, assists: 7, passesAttempted: 510, passesCompleted: 408, longPasses: 14, carries: 48, pressures: 210, tackles: 7, interceptions: 5, shotAssists: 26 },
      sourceIdentity: { provider: "statsbomb-open-data", playerId: "striker-b", competitionId: "open-league-1", seasonId: "2024", positionGroup: "ATT", retrievedAt: "2026-10-10T00:00:00.000Z" },
      source: "StatsBomb Open Data",
    },
  ];
  const comparisonOnlyPlayers: PlayerProfile[] = [
    { ...roleConstraintPlayer("comparison-other-position", "Mika Stone", "CB"), competition: "Open League", season: "2024/25" },
    { ...roleConstraintPlayer("comparison-other-competition", "Rui Vale", "ST"), competition: "Other League", season: "2024/25" },
    { ...roleConstraintPlayer("comparison-other-season", "Noah Vale", "ST"), competition: "Open League", season: "2025/26" },
    {
      ...roleConstraintPlayer("comparison-other-provider", "Theo Cross", "ST"),
      competition: "Open League",
      season: "2024/25",
      source: "Another provider with an overlapping display label",
      sourceIdentity: {
        provider: "another-provider",
        playerId: "other-provider-player-1",
        competitionId: "open-league-1",
        seasonId: "2024",
        positionGroup: "ATT",
        retrievedAt: "2026-10-10T00:00:00.000Z",
      },
    },
  ];
  const repository: PlayerRepository = {
    mode: "statsbomb",
    sourceName: "StatsBomb Open Data",
    async loadPlayers() { return [...playerRecords, ...comparisonOnlyPlayers]; },
    async searchCandidates(query) {
      return {
        players: playerRecords,
        totalRecords: playerRecords.length,
        offset: query.offset,
        nextOffset: null,
        appliedFilters: query.position ? ["position"] : [],
      };
    },
  };
  const methodologyResult: KnowledgeSearchResult = {
    id: "method-chunk-1",
    documentId: "method-doc-1",
    corpus: "methodology",
    text: "球探画像应转成可观察比赛行为，并结合情境解释指标。",
    title: "表现分析方法摘要",
    url: "https://example.test/methods",
    sourceId: "methods-source",
    sourceName: "Example methods source",
    publisher: "Example publisher",
    author: "TactiScout",
    publishedAt: null,
    license: "CC0",
    attribution: "TactiScout authored note",
    entityIds: [],
    entityNames: [],
    competition: null,
    season: null,
    displayAllowed: true,
  };
  const knowledgeBase = {
    async search(input: { corpus: "methodology" | "player_report" }) {
      return input.corpus === "methodology" ? [methodologyResult] : [];
    },
    async status() {
      return {
        indexedChunks: 1,
        methodologyChunks: 1,
        playerReportChunks: 0,
        registeredSources: 1,
        ingestiblePlayerReportSources: 0,
        embeddingModel: "test-embedding",
        indexPath: "/test/knowledge-index",
      };
    },
  };
  const observedToolOrders: string[][] = [];
  const planner: RecruitmentPlanner = {
    async decide(input) {
      const tools = input.history.filter((entry) => entry.role === "tool").map((entry) => entry.toolName);
      observedToolOrders.push(tools.filter((toolName): toolName is string => Boolean(toolName)));
      if (input.decisionMode === "conclude" || input.decisionMode === "reorient") {
        const hasAnswer = input.history.some((entry) => entry.role === "user" && entry.content.includes("未来两三年接班"));
        return hasAnswer ? {
          action: "finish",
          targetTeam: "Bayern Munich",
          needSummary: "寻找能承担中锋终结任务的凯恩接班人。",
          capabilityProfile: ["禁区终结", "前场压迫"],
          recommendations: [{ playerId: "striker-a", evidenceKeys: ["goals", "passCompletionPct"] }],
          limitationKeys: [],
        } : {
          action: "ask_user",
          question: "你更看重即战力，还是培养空间？",
          reason: "这会改变候选人的出场经验与未来发展取舍。",
        };
      }
      if (!tools.includes("search_methodology")) return { action: "search_methodology", query: "中锋接替者的可观察能力维度" };
      if (!tools.includes("search_candidates")) return { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 };
      return { action: "finish", targetTeam: "Bayern Munich", needSummary: "继续核验已有的中锋候选。", capabilityProfile: ["禁区终结"], recommendations: [], limitationKeys: [] };
    },
  };
  const app = createApp({ recruitmentConversation: createRecruitmentConversation({ repository, planner, knowledgeBase }) });
  const threadId = "case-bayern-kane-resume";

  try {
    const firstTurn = await app.inject({
      method: "POST",
      url: `/api/v1/recruitment/cases/${threadId}/turns`,
      payload: { message: "为拜仁寻找凯恩的替代者" },
    });

    assert.equal(firstTurn.statusCode, 200);
    assert.equal(firstTurn.json().status, "needs_input");
    assert.match(firstTurn.json().message, /即战力|培养空间/);
    assert.doesNotMatch(firstTurn.json().message, /延续.*角色.*还是.*不同.*位置/);

    const resumedTurn = await app.inject({
      method: "POST",
      url: `/api/v1/recruitment/cases/${threadId}/turns`,
      payload: { message: "未来两三年接班，但希望有主力潜质" },
    });

    assert.equal(resumedTurn.statusCode, 200);
    const body = resumedTurn.json();
    assert.equal(body.status, "completed");
    assert.equal(body.report.recommendations[0].player.name, "Jonas Vale");
    assert.deepEqual(body.report.recommendations[0].focusEvidenceKeys, ["goals", "passCompletionPct"]);
    assert.equal(body.report.recommendations[0].evidence.length, 8);
    assert.ok(body.report.recommendations[0].evidence.every((item: {
      peerGroupSize: number;
      peerPercentile: number | null;
      peerPercentileUnavailableReason?: string;
    }) => item.peerGroupSize === 2
      && item.peerPercentile === null
      && item.peerPercentileUnavailableReason === "insufficient_peer_group"));
    assert.deepEqual(body.report.evidenceCoverage, {
      evidenceAvailability: "available",
      evaluatedCandidateCount: 2,
      evaluatedSourceRecordCount: 2,
      availableMetricValues: 16,
      expectedMetricValues: 18,
      lowSampleCandidates: 0,
      limitedPeerGroupCandidates: 2,
    });
    assert.deepEqual(body.report.knowledgeCoverage, {
      methodologyChunksRetrieved: 1,
      methodologySearchFailed: false,
      methodologySources: [{
        title: "表现分析方法摘要",
        url: "https://example.test/methods",
        author: "TactiScout",
        publisher: "Example publisher",
        publishedAt: null,
        license: "CC0",
        attribution: "TactiScout authored note",
      }],
      playerReportSearchPerformed: true,
      playerReportSearchFailed: false,
      playerReportChunksRetrieved: 0,
    });
    const lastObservedTools = observedToolOrders.at(-1) ?? [];
    assert.ok(lastObservedTools.indexOf("search_methodology") < lastObservedTools.indexOf("search_candidates"));
    assert.ok(lastObservedTools.indexOf("evaluate_candidates") < lastObservedTools.indexOf("search_player_reports"));
    assert.deepEqual(body.report.searchScopes, [{
      position: "ST",
      maxAge: null,
      minimumMinutes: 0,
      competition: null,
      season: null,
      source: "agent_interpreted",
    }]);
    assert.match(body.report.recommendations[0].rationale, /进球/);
    assert.match(body.report.recommendations[0].rationale, /不代表已验证适合转会/);
    assert.match(body.message, /不是经过验证的综合能力排名/);
    assert.ok(body.report.recommendations[0].tradeoffs.some((item: string) => /不能替代完整比赛录像/.test(item)));
    assert.ok(body.report.limitations.some((item: string) => /当前完整阵容/.test(item)));
  } finally {
    await app.close();
  }
});

test("the decision limit produces a bounded no-evidence report instead of looping", async () => {
  const repository: PlayerRepository = {
    mode: "demo",
    sourceName: "Demo data",
    async loadPlayers() { return []; },
  };
  const plannedActions: RecruitmentAction[] = [
    { action: "search_methodology", query: "候选人评估" },
    { action: "inspect_team", teamName: "Barcelona" },
    { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 5 },
    { action: "evaluate_candidates", playerIds: ["not-in-dataset"] },
    { action: "search_player_reports", query: "未评估候选人", playerNames: ["Not Evaluated"] },
    { action: "search_methodology", query: "球员能力证据" },
    { action: "inspect_team", teamName: "Barcelona" },
    { action: "search_candidates", position: "CM", minimumMinutes: 0, limit: 5 },
    { action: "evaluate_candidates", playerIds: ["not-in-dataset"] },
    { action: "search_player_reports", query: "未评估候选人", playerNames: ["Not Evaluated"] },
    { action: "search_candidates", position: "CB", minimumMinutes: 0, limit: 5 },
    { action: "search_candidates", position: "GK", minimumMinutes: 0, limit: 5 },
    { action: "search_methodology", query: "超过工具预算后的方法" },
    { action: "inspect_team", teamName: "Barcelona" },
    { action: "evaluate_candidates", playerIds: ["not-in-dataset"] },
    { action: "search_player_reports", query: "未评估候选人", playerNames: ["Not Evaluated"] },
  ];
  let decisionCount = 0;
  const planner: RecruitmentPlanner = {
    async decide() {
      decisionCount += 1;
      const action = plannedActions.shift();
      assert.ok(action);
      return action;
    },
  };
  const app = createApp({ recruitmentConversation: createRecruitmentConversation({ repository, planner }) });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/decision-limit/turns",
      payload: { message: "帮我看看适合的候选人" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(decisionCount, 16);
    assert.deepEqual(response.json().report.recommendations, []);
    assert.ok(response.json().report.limitations.some((item: string) => /安全步数上限/.test(item)));
  } finally {
    await app.close();
  }
});

test("independent tool budgets stop repeated methodology searches while preserving later investigation steps", async () => {
  const player: PlayerProfile = {
    playerId: "budget-player", name: "Budget Player", team: "Harbor City", age: 23, position: "ST",
    competition: "Open League", season: "2025/26", minutes: 1800,
    stats: { goals: 4, assists: 1, passesAttempted: 100, passesCompleted: 70, longPasses: 3, carries: 12, pressures: 30, tackles: 2, interceptions: 1, shotAssists: 5 },
    source: "StatsBomb Open Data",
  };
  const repository: PlayerRepository = {
    mode: "statsbomb",
    sourceName: "StatsBomb Open Data",
    async loadPlayers() { return [player]; },
  };
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "前锋表现方法一" },
    { action: "search_methodology", query: "前锋表现方法二" },
    { action: "search_methodology", query: "超过上限的方法搜索" },
    { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 },
    { action: "evaluate_candidates", playerIds: [player.playerId] },
    { action: "search_player_reports", query: "球员报告", playerNames: [player.name] },
    { action: "finish", targetTeam: null, needSummary: "完成调查。", capabilityProfile: [], recommendations: [], limitationKeys: [] },
  ];
  let methodologyCalls = 0;
  const planner: RecruitmentPlanner = {
    async decide() {
      const action = actions.shift();
      assert.ok(action, "budget feedback should let the agent move on to later tool types");
      return action;
    },
  };
  const conversation = createRecruitmentConversation({
    repository,
    planner,
    knowledgeBase: {
      async search({ corpus }) {
        if (corpus === "methodology") methodologyCalls += 1;
        return [];
      },
    },
  });

  const response = await conversation.turn({ threadId: "independent-tool-budgets", message: "帮我找中锋" });

  assert.equal(response.status, "completed");
  assert.equal(methodologyCalls, 2);
  assert.equal(actions.length, 0);
  assert.equal(response.report?.knowledgeCoverage.playerReportSearchPerformed, true);
});

test("the optional trace records action timing and actual tool scopes without model reasoning", async () => {
  const player: PlayerProfile = {
    playerId: "trace-player", name: "Trace Player", team: "Harbor City", age: 22, position: "CM",
    competition: "Open League", season: "2025/26", minutes: 1200,
    stats: { goals: 2, assists: 1, passesAttempted: 200, passesCompleted: 160, longPasses: 12, carries: 30, pressures: 100, tackles: 8, interceptions: 4, shotAssists: 9 },
    source: "StatsBomb Open Data",
  };
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "推进和压迫表现", limit: 3 },
    { action: "search_candidates", position: "CM", maxAge: 23, minimumMinutes: 0, competition: null, season: null, limit: 5 },
    { action: "evaluate_candidates", playerIds: [player.playerId] },
    { action: "search_player_reports", query: "Trace Player 球员报告", playerNames: [player.name], limit: 2 },
    { action: "finish", targetTeam: "Barcelona", needSummary: "寻找年轻中场。", capabilityProfile: ["推进", "前场压迫"], recommendations: [], limitationKeys: [] },
  ];
  const events: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return [player]; } },
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { events.push(event); },
  });

  const response = await conversation.turn({ threadId: "trace-public-seam", message: "为巴萨找 23 岁以下中场" });

  assert.equal(response.status, "completed");
  const decisions = events.filter((event): event is Extract<RecruitmentTraceEvent, { phase: "decision" }> => event.phase === "decision");
  assert.deepEqual(decisions.map((event) => event.action), [
    "search_methodology", "search_candidates", "evaluate_candidates", "search_player_reports",
    "evaluate_candidates", "search_player_reports", "finish",
  ]);
  assert.deepEqual(decisions.map((event) => event.decisionSource), [
    "planner", "planner", "policy", "policy", "planner", "planner", "planner",
  ], "the trace distinguishes deterministic batch/report steps from later Planner proposals");
  const candidateSearch = events.find((event) => event.phase === "tool" && event.toolName === "search_candidates");
  assert.ok(candidateSearch && candidateSearch.phase === "tool");
  assert.equal(candidateSearch.toolName, "search_candidates");
  assert.equal(candidateSearch.ok, true);
  assert.ok(candidateSearch.elapsedMs >= 0);
  assert.deepEqual(candidateSearch.filters, {
    position: "MID",
    maxAge: 23,
    minimumMinutes: 0,
    competition: null,
    season: null,
    requestedOffset: 0,
    offset: 0,
    limit: 20,
    playerNameFilterUsed: false,
    discoveryStrategy: "cohort_sample",
    discoveryMetricKeys: [],
    nextOffset: null,
    candidateIds: [player.playerId],
  });
  assert.equal(candidateSearch.resultCount, 1);
  assert.equal(candidateSearch.matchingRecordCount, 1);
  const candidateEvaluation = events.find((event) => event.phase === "tool" && event.toolName === "evaluate_candidates");
  assert.ok(candidateEvaluation && candidateEvaluation.phase === "tool");
  assert.deepEqual(candidateEvaluation.filters, {
    requestedPlayerCount: 1,
    evidenceAvailability: "available",
    evaluatedPlayerIds: [player.playerId],
    evaluatedMetricKeys: ["goals", "assists", "shotAssists", "carries", "longPasses", "passCompletionPct", "pressures", "tacklesInterceptions"],
    evaluatedMetricValueCount: 8,
  });
  assert.ok(events.every((event) => !("reasoning" in event) && !("content" in event)));
});

test("repeating a candidate search continues at the next page and traces requested and effective offsets", async () => {
  const first = roleConstraintPlayer("cursor-first", "Cursor First", "CM");
  const second = roleConstraintPlayer("cursor-second", "Cursor Second", "CM");
  const otherPosition = roleConstraintPlayer("cursor-defender", "Cursor Defender", "DEF");
  const search = {
    action: "search_candidates" as const,
    position: "CM" as const,
    maxAge: 23,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 1,
  };
  const defenderSearch = { ...search, position: "DEF" as const, offset: 1 };
  const finish: RecruitmentAction = {
    action: "finish",
    targetTeam: "Barcelona",
    needSummary: "为巴萨比较后卫候选人的比赛证据。",
    capabilityProfile: ["后卫比赛表现"],
    recommendations: [{ playerId: otherPosition.playerId, evidenceKeys: ["goals"] }],
    limitationKeys: [],
  };
  const events: RecruitmentTraceEvent[] = [];
  const players = [first, second, otherPosition];
  let candidateSearchDecisions = 0;
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "wyscout",
      sourceName: "Wyscout Open Data",
      async loadPlayers() { return players; },
      async searchCandidates(query: PlayerSearchQuery) {
        const matchingPlayers = players.filter((player) => (
          (!query.playerName || player.name.includes(query.playerName))
          && (!query.position || player.position === query.position)
          && (query.maxAge === null || (player.age !== null && player.age <= query.maxAge))
          && player.minutes >= query.minimumMinutes
          && (!query.competition || player.competition === query.competition)
          && (!query.season || player.season === query.season)
        ));
        const page = matchingPlayers.slice(query.offset, query.offset + 1);
        const appliedFilters: PlayerSearchFilter[] = [
          ...(query.playerName ? ["playerName" as const] : []),
          ...(query.position ? ["position" as const] : []),
          ...(query.maxAge !== null ? ["maxAge" as const] : []),
          ...(query.minimumMinutes > 0 ? ["minimumMinutes" as const] : []),
          ...(query.competition ? ["competition" as const] : []),
          ...(query.season ? ["season" as const] : []),
        ];
        return {
          players: page,
          totalRecords: matchingPlayers.length,
          offset: query.offset,
          nextOffset: query.offset + page.length < matchingPlayers.length ? query.offset + page.length : null,
          appliedFilters,
        };
      },
    },
    planner: {
      async decide({ history, decisionMode }) {
        if (decisionMode === "conclude") return finish;
        const pages = history.filter((entry) => entry.role === "tool" && entry.toolName === "search_candidates").length;
        const lastTool = history.at(-1);
        if (decisionMode === "expand") {
          candidateSearchDecisions += 1;
          return search;
        }
        if (decisionMode === "reorient" && candidateSearchDecisions === 1 && pages === 2) {
          return defenderSearch;
        }
        if (!history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology")) {
          return { action: "search_methodology", query: "中场能力评估方法" };
        }
        if (pages === 0 || pages === 1) return search;
        if (pages === 2) return defenderSearch;
        if (lastTool?.role === "tool" && lastTool.toolName === "evaluate_candidates") {
          return { action: "search_player_reports", query: "Cursor Defender 球员报告", playerNames: [otherPosition.name] };
        }
        if (lastTool?.role === "tool" && lastTool.toolName === "search_player_reports") return finish;
        assert.fail("the investigation should reach evidence evaluation and a report");
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { events.push(event); },
  });

  const response = await conversation.turn({ threadId: "candidate-cursor-public-seam", message: "为巴萨找一名 23 岁以下球员，位置不限。" });

  assert.equal(response.status, "completed");
  const searches = events.filter((event) => event.phase === "tool" && event.toolName === "search_candidates");
  assert.deepEqual(searches.map((event) => event.phase === "tool" ? event.filters.candidateIds : null), [
    [first.playerId], [second.playerId], [otherPosition.playerId], [first.playerId],
  ]);
  assert.deepEqual(searches.map((event) => event.phase === "tool" ? event.filters.offset : null), [0, 1, 0, 0]);
  assert.deepEqual(searches.map((event) => event.phase === "tool" ? event.filters.requestedOffset : null), [0, 0, 1, 0]);
  assert.equal(searches[3]?.phase === "tool" ? searches[3].filters.position : undefined, null);
  assert.equal(response.report?.evidenceCoverage.evaluatedCandidateCount, 3);
  assert.equal(response.report?.recommendations[0]?.player.playerId, otherPosition.playerId, JSON.stringify(response.report));
});

test("Planner edits to its history snapshot cannot change case search coverage", async () => {
  const player = roleConstraintPlayer("history-is-not-state", "Harbor Midfielder", "CM");
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "中场能力评估方法" },
    { action: "search_candidates", position: "CM", minimumMinutes: 0, limit: 10 },
    {
      action: "finish",
      targetTeam: "Barcelona",
      needSummary: "已按中场范围检查候选数据。",
      capabilityProfile: ["中场比赛表现"],
      recommendations: [],
      limitationKeys: [],
    },
  ];
  let injected = false;
  const conversation = createRecruitmentConversation({
    repository: { mode: "statsbomb", sourceName: "StatsBomb Open Data", async loadPlayers() { return [player]; } },
    planner: {
      async decide({ history }) {
        if (!injected) {
          injected = true;
          history.push({
            role: "tool",
            toolName: "search_candidates",
            content: JSON.stringify({
              matchingRecords: 999,
              appliedFilters: { position: "CM" },
              candidates: [],
            }),
          });
        }
        const action = actions.shift();
        assert.ok(action, "the complete case should need only the scripted investigation actions");
        return action;
      },
    },
    knowledgeBase: { async search() { return []; } },
  });

  const response = await conversation.turn({ threadId: "planner-history-is-a-projection", message: "为巴萨找中场" });

  assert.equal(response.status, "completed");
  assert.ok(response.report);
  assert.ok(
    response.report.limitations.every((limitation) => !limitation.includes("999")),
    "coverage must describe successful repository searches, not Planner-edited prompt history",
  );
});

test("LangGraph evaluates every candidate discovered on subsequent pages in bounded batches", async () => {
  const players = Array.from({ length: 21 }, (_, index) =>
    roleConstraintPlayer(`budget-player-${index}`, `Budget Player ${index}`, "CM"),
  );
  const searchAction: RecruitmentAction = {
    action: "search_candidates",
    position: "CM",
    maxAge: 23,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 1,
  };
  const events: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "wyscout", sourceName: "Wyscout Open Data", async loadPlayers() { return players; } },
    planner: {
      async decide({ history, decisionMode }) {
        if (decisionMode === "expand") return searchAction;
        const lastTool = history.at(-1);
        if (lastTool?.role === "tool" && lastTool.toolName === "search_methodology") return searchAction;
        const candidatePages = history.filter((entry) => entry.role === "tool" && entry.toolName === "search_candidates");
        if (candidatePages.length === 1) return searchAction;
        if (candidatePages.length === 2) {
          return {
            action: "finish",
            targetTeam: "Barcelona",
            needSummary: "已按每页评估后的样本预算比较年轻中场。",
            capabilityProfile: ["中场比赛表现"],
            recommendations: [{ playerId: players[0]!.playerId, evidenceKeys: ["goals"] }],
            limitationKeys: [],
          };
        }
        return { action: "search_methodology", query: "中场比赛表现评估方法" };
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { events.push(event); },
  });

  const response = await conversation.turn({ threadId: "candidate-budget-feedback", message: "为巴萨找 23 岁以下中场" });

  assert.equal(response.status, "completed");
  const searches = events.filter((event) => event.phase === "tool" && event.toolName === "search_candidates");
  const evaluations = events.filter((event) => event.phase === "tool" && event.toolName === "evaluate_candidates");
  assert.deepEqual(searches.map((event) => event.phase === "tool" ? event.filters.offset : null), [0, 20]);
  assert.deepEqual(searches.map((event) => event.phase === "tool" ? event.resultCount : null), [20, 1]);
  assert.deepEqual(evaluations.map((event) => event.phase === "tool" ? event.resultCount : null), [10, 10, 1]);
  assert.equal(events.filter((event) => event.phase === "tool" && event.toolName === "search_player_reports").length, 3);
  assert.equal(response.report?.evidenceCoverage.evaluatedCandidateCount, 21);
  assert.ok(
    response.report?.limitations.every((limitation) => !/当前筛选命中 21 条候选记录/.test(limitation)),
    "coverage must union source records across both pages before describing the observed sample",
  );
  assert.equal(response.report?.recommendations[0]?.player.playerId, players[0]!.playerId);
});

test("LangGraph evaluates every eligible player from the current page before asking the Planner to finish", async () => {
  const players = Array.from({ length: 20 }, (_, index) => (
    roleConstraintPlayer(`page-player-${index}`, `Page Player ${index}`, "ST")
  ));
  const searchPage: RecruitmentAction = {
    action: "search_candidates",
    targetTeam: "拜仁",
    position: "ST",
    playerName: null,
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 20,
  };
  const events: RecruitmentTraceEvent[] = [];
  const evaluatedCountsAtConclusion: number[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return players; } },
    planner: {
      async decide({ history, decisionMode, constraints }) {
        const toolNames = history.filter((entry) => entry.role === "tool").map((entry) => entry.toolName);
        if (decisionMode === "conclude" || decisionMode === "reorient") {
          evaluatedCountsAtConclusion.push(constraints?.evaluatedCandidates.length ?? 0);
          return {
            action: "finish",
            targetTeam: "拜仁",
            needSummary: "已评估并比较当前检索页中的全部合格候选。",
            capabilityProfile: ["进球产出：引用实际 goals 指标"],
            recommendations: [{ playerId: players[0]!.playerId, evidenceKeys: ["goals"] }],
            limitationKeys: ["other"],
          };
        }
        if (!toolNames.includes("search_methodology")) {
          return { action: "search_methodology", query: "中锋进球产出评估方法" };
        }
        if (!toolNames.includes("search_candidates")) return searchPage;
        assert.fail(`unexpected Planner call before all candidates on the page were evaluated: ${JSON.stringify({ decisionMode, toolNames, events: events.map((event) => event.phase === "tool" ? { phase: event.phase, toolName: event.toolName, resultCount: event.resultCount, filters: event.filters } : { phase: event.phase, action: event.action }) })}`);
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { events.push(event); },
  });

  const response = await conversation.turn({
    threadId: "finish-after-current-page-evaluation",
    message: "为拜仁找一名中锋，重点看进球产出。",
  });

  assert.equal(response.status, "completed");
  assert.deepEqual(events.filter((event) => event.phase === "tool" && event.toolName === "evaluate_candidates")
    .map((event) => event.phase === "tool" ? event.resultCount : null), [10, 10]);
  const reportSearches = events.filter((event) => event.phase === "tool" && event.toolName === "search_player_reports");
  assert.equal(reportSearches.length, 2);
  const searchedPlayerIds = reportSearches.flatMap((event) => (
    event.phase === "tool" ? event.filters.searchedPlayerIds : []
  ));
  assert.deepEqual(reportSearches.map((event) => (
    event.phase === "tool" ? event.filters.searchedPlayerIds.length : 0
  )), [10, 10]);
  assert.deepEqual(new Set(searchedPlayerIds), new Set(players.map(({ playerId }) => playerId)));
  assert.deepEqual(evaluatedCountsAtConclusion, [20]);
  assert.equal(response.report?.evidenceCoverage.evaluatedCandidateCount, 20);
});

test("the Planner gets an expansion choice after a completed report search when another candidate page remains", async () => {
  const players = Array.from({ length: 21 }, (_, index) => (
    roleConstraintPlayer(`expand-player-${index}`, `Expand Player ${index}`, "CM")
  ));
  const searchPage: RecruitmentAction = {
    action: "search_candidates",
    position: "MID",
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 20,
  };
  const finish: RecruitmentAction = {
    action: "finish",
    targetTeam: "Barcelona",
    needSummary: "按已确认的中场范围完成有限样本比较。",
    capabilityProfile: ["中场比赛表现"],
    recommendations: [{ playerId: players[0]!.playerId, evidenceKeys: ["goals"] }],
    limitationKeys: [],
  };
  const events: RecruitmentTraceEvent[] = [];
  const decisionModes: Array<string | undefined> = [];
  const searchedReportBatches: string[][] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return players; } },
    planner: {
      async decide({ history, decisionMode, expansionConstraints, constraints, targetTeam }) {
        decisionModes.push(decisionMode);
        const lastTool = history.at(-1);
        const candidateSearchCount = history.filter((entry) => entry.role === "tool" && entry.toolName === "search_candidates").length;
        if (decisionMode === "expand") {
          assert.deepEqual(history.filter(({ role }) => role === "user").map(({ content }) => content), ["为巴萨找一名中场"]);
          assert.ok(history.every((entry) => entry.role === "user"
            || (entry.role === "assistant" && JSON.parse(entry.content).action === "ask_user")
            || (entry.role === "tool" && !["search_candidates", "evaluate_candidates"].includes(entry.toolName ?? ""))));
          assert.equal(expansionConstraints?.targetTeam, "巴萨");
          assert.equal(expansionConstraints?.nextOffset, 20);
          assert.equal(expansionConstraints?.position, "MID");
          assert.equal(constraints?.targetTeam, "巴萨");
          assert.ok((constraints?.evaluatedCandidates.length ?? 0) > 0);
          assert.equal(targetTeam, "巴萨");
          return { ...searchPage, offset: 20 };
        }
        if (!history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology")) {
          return { action: "search_methodology", query: "中场表现评估方法" };
        }
        if (decisionMode === "conclude" || decisionMode === "reorient") return finish;
        if (candidateSearchCount === 0) return searchPage;
        if (lastTool?.role === "tool" && lastTool.toolName === "search_player_reports"
          && candidateSearchCount === 1) {
          assert.equal(decisionMode, "expand", "a completed report lookup must not leave the model free to repeat it");
        }
        if (lastTool?.role === "tool" && lastTool.toolName === "evaluate_candidates") {
          return {
            action: "search_player_reports",
            query: "中场候选球员报告",
            playerNames: players.map(({ name }) => name).slice(0, 10),
          };
        }
        assert.fail(`unexpected Planner state: ${lastTool?.role === "tool" ? lastTool.toolName : "no tool result"}`);
      },
    },
    knowledgeBase: {
      async search(input) {
        if (input.corpus === "player_report") searchedReportBatches.push([...input.playerNames]);
        return [];
      },
    },
    observer: (event) => { events.push(event); },
  });

  const response = await conversation.turn({ threadId: "candidate-expansion-after-report", message: "为巴萨找一名中场" });

  assert.equal(response.status, "completed");
  assert.ok(decisionModes.includes("expand"));
  assert.ok(decisionModes.includes("reorient"));
  const searches = events.filter((event) => event.phase === "tool" && event.toolName === "search_candidates");
  assert.deepEqual(searches.map((event) => event.phase === "tool" ? event.filters.offset : null), [0, 20]);
  assert.equal(events.filter((event) => event.phase === "tool" && event.toolName === "search_player_reports").length, 3);
  assert.equal(searchedReportBatches.length, 3);
  const firstReportNames = new Set(searchedReportBatches[0]?.map((name) => name.toLocaleLowerCase()));
  assert.ok(searchedReportBatches[1]?.every((name) => !firstReportNames.has(name.toLocaleLowerCase())),
    "later report retrieval searches only newly evaluated players");
  assert.equal(response.report?.evidenceCoverage.evaluatedCandidateCount, 21);
  assert.deepEqual(events.filter((event) => event.phase === "tool" && event.toolName === "evaluate_candidates")
    .map((event) => event.phase === "tool" ? event.resultCount : null), [10, 10, 1]);
  assert.equal(response.report?.limitations.some((item) => /连续重复.*动作/.test(item)), false);
});

test("an expansion planner output limit follows the exact next page and still completes the LangGraph report", async () => {
  const players = Array.from({ length: 21 }, (_, index) => {
    const player = roleConstraintPlayer(`timeout-expand-${index}`, `Timeout Expand ${index}`, "ST");
    return { ...player, availableStats: ["goals" as const], stats: { ...player.stats, goals: 8 } };
  });
  const firstPage: RecruitmentAction = {
    action: "search_candidates",
    position: "ATT",
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 20,
  };
  const finish: RecruitmentAction = {
    action: "finish",
    targetTeam: "Barcelona",
    needSummary: "当前数据没有可用的渐进传球指标，已完成有限样本核验。",
    capabilityProfile: ["未观察到渐进传球数据，不能据此推荐该能力。"],
    recommendations: [],
    limitationKeys: ["other"],
  };
  const trace: RecruitmentTraceEvent[] = [];
  let expansionCalls = 0;
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return players; } },
    planner: {
      async decide({ history, decisionMode }) {
        const lastTool = history.at(-1);
        const candidateSearchCount = history.filter((entry) => entry.role === "tool" && entry.toolName === "search_candidates").length;
        if (decisionMode === "expand") {
          expansionCalls += 1;
          throw new RecruitmentPlannerOutputError({
            failure: "invalid_json",
            contentKind: "blocks",
            finishReason: "length",
            hasReasoningContent: false,
            toolCallCount: 0,
          }, "expand");
        }
        if (!history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology")) {
          return { action: "search_methodology", query: "前锋 xG 表现评估方法" };
        }
        if (decisionMode === "reorient") {
          throw new RecruitmentPlannerOutputError({
            failure: "empty_content",
            contentKind: "empty_text",
            finishReason: "length",
            hasReasoningContent: false,
            toolCallCount: 0,
          }, "reorient");
        }
        if (decisionMode === "conclude") return finish;
        if (candidateSearchCount === 0) return firstPage;
        if (lastTool?.role === "tool" && lastTool.toolName === "evaluate_candidates") {
          return {
            action: "search_player_reports",
            query: "前锋球员报告",
            playerNames: players.slice(Math.max(0, (candidateSearchCount - 1) * 10), candidateSearchCount * 10).map(({ name }) => name),
          };
        }
        assert.fail(`unexpected Planner state: ${lastTool?.role === "tool" ? lastTool.toolName : "no tool result"}`);
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { trace.push(event); },
  });

  const response = await conversation.turn({
    threadId: "expansion-timeout-fallback",
    message: "为巴萨找一名中锋，重点考察渐进传球。",
  });

  assert.equal(expansionCalls, 1);
  assert.equal(response.status, "completed");
  const searches = trace.filter((event) => event.phase === "tool" && event.toolName === "search_candidates");
  assert.deepEqual(searches.map((event) => event.phase === "tool" ? event.filters.offset : null), [0, 20]);
  assert.ok(trace.some((event) => event.phase === "decision" && event.plannerFallback === "expansion_output_limit"));
  assert.equal(response.report?.recommendations.length, 0);
  assert.ok(response.report?.requestedCapabilityCoverage.some(({ status }) => status === "missing" || status === "partial"));
  assert.ok(trace.some((event) => event.phase === "decision" && event.plannerFallback === "conclusion_output_limit"));
  assert.match(response.report?.needSummary ?? "", /输出达到长度上限/);
});

test("a blocked expansion question gets one model-directed recovery without asking again", async () => {
  const players = Array.from({ length: 21 }, (_, index) =>
    roleConstraintPlayer(`recovery-player-${index}`, `Recovery Player ${index}`, "CM"),
  );
  const searchPage: RecruitmentAction = {
    action: "search_candidates",
    position: "MID",
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 20,
  };
  const plannerModes: Array<string | undefined> = [];
  const trace: RecruitmentTraceEvent[] = [];
  let recoveryHistory: Parameters<RecruitmentPlanner["decide"]>[0]["history"] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return players; } },
    planner: {
      async decide(input) {
        plannerModes.push(input.decisionMode);
        if (input.decisionMode === "expand") {
          return {
            action: "ask_user",
            question: "是否接受跨联赛搜索？",
            reason: "跨联赛可能带来更多候选人。",
          };
        }
        if (input.decisionMode === "expand_recovery") {
          recoveryHistory = input.history;
          assert.equal(input.expansionConstraints?.nextOffset, 20);
          assert.ok(input.constraints?.evaluatedCandidates.length);
          assert.deepEqual(input.history.filter(({ role }) => role === "user").map(({ content }) => content), [
            "为巴萨找一名重点看进球表现的中场",
          ]);
          const eligible = input.constraints?.evaluatedCandidates.find(({ evidenceKeys }) => evidenceKeys.includes("goals"));
          assert.ok(eligible);
          return {
            action: "finish",
            targetTeam: "巴萨",
            needSummary: "按当前范围完成中场进球表现的首轮考察。",
            capabilityProfile: ["进球产出"],
            recommendations: [{ playerId: eligible.playerId, evidenceKeys: ["goals"] }],
            limitationKeys: [],
          };
        }
        if (!input.history.some(({ role, toolName }) => role === "tool" && toolName === "search_methodology")) {
          return { action: "search_methodology", query: "中场进球表现评估方法" };
        }
        if (!input.history.some(({ role, toolName }) => role === "tool" && toolName === "search_candidates")) return searchPage;
        assert.fail(`unexpected Planner mode: ${input.decisionMode}`);
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { trace.push(event); },
  });

  const response = await conversation.turn({
    threadId: "blocked-expansion-question-recovery",
    message: "为巴萨找一名重点看进球表现的中场",
  });

  assert.equal(response.status, "completed");
  assert.ok(plannerModes.includes("expand_recovery"));
  assert.ok(recoveryHistory.some(({ role, toolName }) => role === "tool" && toolName === "investigation_policy"));
  assert.ok(!recoveryHistory.some(({ role, toolName }) => role === "tool" && ["search_candidates", "evaluate_candidates"].includes(toolName ?? "")));
  assert.ok(trace.some((event) => event.phase === "decision" && event.action === "ask_user" && event.policyBlocked));
  assert.ok(response.report?.recommendations.some(({ evidence }) => evidence.some(({ key }) => key === "goals")));
  assert.equal(response.report?.limitations.some((item) => /连续重复.*动作/.test(item)), false);
});

test("an unsupported league question after approved position expansion continues the exact next page", async () => {
  const players = Array.from({ length: 21 }, (_, index) =>
    roleConstraintPlayer(`scope-player-${index}`, `Scope Player ${index}`, "RW"),
  );
  const decisions: Extract<RecruitmentTraceEvent, { phase: "decision" }>[] = [];
  const candidatePages: Extract<RecruitmentTraceEvent, { phase: "tool" }>[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return players; } },
    planner: {
      async decide(input) {
        if (input.decisionMode === "expand") {
          return {
            action: "ask_user",
            question: "是否接受跨联赛搜索？",
            reason: "跨联赛可能带来更多候选人。",
          };
        }
        if (input.decisionMode === "expand_recovery" || input.decisionMode === "conclude") {
          const candidate = input.constraints?.evaluatedCandidates.find(({ evidenceKeys }) => evidenceKeys.includes("goals"));
          assert.ok(candidate);
          return {
            action: "finish",
            targetTeam: "拜仁",
            needSummary: "按用户批准的前锋范围完成有限历史样本考察。",
            capabilityProfile: ["进球产出"],
            recommendations: [{ playerId: candidate.playerId, evidenceKeys: ["goals"] }],
            limitationKeys: [],
          };
        }
        if (!input.history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology")) {
          return { action: "search_methodology", query: "中锋进球与做球表现评估方法" };
        }
        return { action: "search_candidates", position: input.confirmedPosition ?? "ST", minimumMinutes: 0, limit: 20 };
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer(event) {
      if (event.phase === "decision") decisions.push(event);
      if (event.phase === "tool" && event.toolName === "search_candidates") candidatePages.push(event);
    },
  });
  const threadId = "approved-expansion-unsupported-scope-question";

  const firstTurn = await conversation.turn({
    threadId,
    message: "为拜仁寻找凯恩的中锋替代者，重点考察进球产出和做球。",
  });
  assert.equal(firstTurn.status, "needs_input");
  const resumedTurn = await conversation.turn({
    threadId,
    message: "可以扩大到其他前锋位置，暂时不增加年龄或预算限制。",
  });

  assert.equal(resumedTurn.status, "completed");
  const redirectedQuestion = decisions.find(({ action, proposedAction, decisionSource }) => (
    action === "search_candidates" && proposedAction === "ask_user" && decisionSource === "policy"
  ));
  assert.deepEqual(redirectedQuestion?.policyReasonCodes, ["unspecified_competition_scope"]);
  assert.equal(redirectedQuestion?.policyBlocked, false, "the invalid question is redirected before LangGraph spends a recovery Planner call");
  assert.equal(decisions.some(({ action, policyBlocked }) => action === "ask_user" && policyBlocked), false);
  assert.equal(JSON.stringify(decisions).includes("跨联赛"), false, "safe traces record policy reason codes, not Planner question text");
  assert.deepEqual(candidatePages.map(({ filters }) => filters.offset), [0, 0, 20]);
  assert.equal(decisions.some(({ action, proposedAction, decisionSource, policyBlocked }) => (
    action === "search_candidates"
    && proposedAction === "ask_user"
    && decisionSource === "policy"
    && !policyBlocked
  )), true);
});

test("a distinct material question remains available after approved position expansion", async () => {
  const players = Array.from({ length: 21 }, (_, index) =>
    roleConstraintPlayer(`material-question-player-${index}`, `Material Player ${index}`, "RW"),
  );
  const decisions: Extract<RecruitmentTraceEvent, { phase: "decision" }>[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return players; } },
    planner: {
      async decide(input) {
        if (input.decisionMode === "expand") {
          return {
            action: "ask_user",
            question: "更偏向能立即争取主力，还是作为轮换或未来接班人？",
            reason: "目标上场角色会改变候选画像的取舍。",
          };
        }
        if (!input.history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology")) {
          return { action: "search_methodology", query: "中锋进球与做球表现评估方法" };
        }
        return { action: "search_candidates", position: input.confirmedPosition ?? "ST", minimumMinutes: 0, limit: 20 };
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer(event) {
      if (event.phase === "decision") decisions.push(event);
    },
  });
  const threadId = "approved-expansion-material-question";

  const firstTurn = await conversation.turn({
    threadId,
    message: "为拜仁寻找凯恩的中锋替代者，重点考察进球产出和做球。",
  });
  assert.equal(firstTurn.status, "needs_input");
  const resumedTurn = await conversation.turn({
    threadId,
    message: "可以扩大到其他前锋位置，暂时不增加年龄或预算限制。",
  });

  assert.equal(resumedTurn.status, "needs_input");
  assert.match(resumedTurn.message, /立即争取主力/);
  assert.equal(resumedTurn.question?.reason, "目标上场角色会改变候选画像的取舍。");
  assert.equal(decisions.some(({ action, policyBlocked }) => action === "ask_user" && policyBlocked), false);
});

test("the deterministic batch and report steps finish before the Planner concludes", async () => {
  const player = roleConstraintPlayer("already-evaluated", "Already Evaluated", "CM");
  const events: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "wyscout", sourceName: "Wyscout Open Data", async loadPlayers() { return [player]; } },
    planner: {
      async decide({ history }) {
        const lastTool = history.at(-1);
        if (lastTool?.role === "tool" && lastTool.toolName === "investigation_policy") {
          evaluationFeedback = lastTool.content;
          return { action: "search_player_reports", query: "Already Evaluated 球员报告", playerNames: [player.name] };
        }
        if (lastTool?.role === "tool" && lastTool.toolName === "search_methodology") {
          return { action: "search_candidates", position: "CM", maxAge: 23, minimumMinutes: 0, limit: 10 };
        }
        if (lastTool?.role === "tool" && lastTool.toolName === "search_candidates") {
          return { action: "evaluate_candidates", playerIds: [player.playerId] };
        }
        if (lastTool?.role === "tool" && lastTool.toolName === "search_player_reports") {
          return {
            action: "finish",
            targetTeam: "Barcelona",
            needSummary: "基于已有的比赛证据完成候选评估。",
            capabilityProfile: ["中场比赛表现"],
            recommendations: [{ playerId: player.playerId, evidenceKeys: ["goals"] }],
            limitationKeys: [],
          };
        }
        return { action: "search_methodology", query: "中场比赛表现评估方法" };
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { events.push(event); },
  });

  const response = await conversation.turn({ threadId: "duplicate-evaluation-guard", message: "为巴萨找一名 23 岁以下中场" });

  assert.equal(response.status, "completed");
  const decisions = events.filter((event): event is Extract<RecruitmentTraceEvent, { phase: "decision" }> => event.phase === "decision");
  assert.deepEqual(decisions.map((event) => event.action), [
    "search_methodology", "search_candidates", "evaluate_candidates", "search_player_reports", "finish",
  ]);
  assert.deepEqual(decisions.map((event) => event.decisionSource), ["planner", "planner", "policy", "policy", "planner"]);
  assert.equal(events.filter((event) => event.phase === "tool" && event.toolName === "evaluate_candidates").length, 1);
  assert.equal(events.filter((event) => event.phase === "tool" && event.toolName === "search_player_reports").length, 1);
  assert.equal(response.report?.evidenceCoverage.evaluatedCandidateCount, 1);
});

test("candidate search cannot use an unverified reference-player name as a filter", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "中锋替代者的能力画像" },
    { action: "search_candidates", position: "ST", playerName: "Harry Kane", limit: 10 },
    { action: "ask_user", question: "你希望找即战力还是长期接班人？", reason: "两种目标会改变候选画像。" },
  ];
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return []; } },
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { events.push(event); },
  });

  await conversation.turn({ threadId: "private-name-trace", message: "为拜仁寻找凯恩的替代者" });

  const candidateSearch = events.find((event) => event.phase === "tool" && event.toolName === "search_candidates");
  assert.ok(candidateSearch && candidateSearch.phase === "tool");
  assert.equal(candidateSearch.filters.playerNameFilterUsed, false);
  assert.equal(JSON.stringify(events).includes("Harry Kane"), false);
});

test("team inspection only treats current Sportmonks roster samples as verified current rosters", async () => {
  const cases = [
    {
      mode: "sportmonks" as const,
      sourceName: "Sportmonks",
      isCurrentSeason: true,
      expectedVerified: true,
      note: /仅代表该来源.*名单覆盖/,
    },
    {
      mode: "sportmonks" as const,
      sourceName: "Sportmonks",
      isCurrentSeason: false,
      expectedVerified: false,
      note: /历史比赛阵容样本/,
    },
    {
      mode: "understat" as const,
      sourceName: "Understat",
      isCurrentSeason: true,
      expectedVerified: false,
      note: /Understat 当前赛季联赛页.*不是球队完整注册名单/,
    },
  ];

  for (const scenario of cases) {
    let inspectedTeam: Record<string, unknown> | undefined;
    const player = {
      ...roleConstraintPlayer(`team-${scenario.mode}-${scenario.isCurrentSeason}`, "Sample Player", "ST"),
      team: "Bayern Munich",
      sourceIdentity: {
        provider: scenario.mode,
        playerId: `source-${scenario.mode}-${scenario.isCurrentSeason}`,
        retrievedAt: "2026-10-12T00:00:00.000Z",
        isCurrentSeason: scenario.isCurrentSeason,
      },
    } satisfies PlayerProfile;
    const conversation = createRecruitmentConversation({
      repository: {
        mode: scenario.mode,
        sourceName: scenario.sourceName,
        async inspectTeam() { return [player]; },
      },
      planner: {
        async decide(input) {
          const entry = [...input.history].reverse().find((item) => item.role === "tool" && item.toolName === "inspect_team");
          if (!entry) return { action: "inspect_team", teamName: "Bayern Munich" };
          inspectedTeam = JSON.parse(entry.content) as Record<string, unknown>;
          return {
            action: "finish",
            targetTeam: "Bayern Munich",
            needSummary: "只检查了目标球队来源样本。",
            capabilityProfile: [],
            recommendations: [],
            limitationKeys: [],
          };
        },
      },
      knowledgeBase: { async search() { return []; } },
    });

    const response = await conversation.turn({
      threadId: `team-source-scope-${scenario.mode}-${scenario.isCurrentSeason}`,
      message: "检查拜仁的球队样本",
    });

    assert.equal(response.status, "completed");
    assert.ok(inspectedTeam, `Planner should receive the ${scenario.sourceName} team result`);
    assert.equal(inspectedTeam.currentRosterVerified, scenario.expectedVerified);
    assert.match(String(inspectedTeam.note), scenario.note);
  }
});

test("an explicit target team is never reused as a candidate player-name filter", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "进攻位置表现评估方法" },
    { action: "search_candidates", playerName: "洛杉矶FC", limit: 10 },
    {
      action: "finish",
      targetTeam: null,
      needSummary: "本轮候选数据不足。",
      capabilityProfile: [],
      recommendations: [],
      limitationKeys: [],
    },
  ];
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return []; } },
    planner: {
      async decide() {
        const action = actions.shift();
        assert.ok(action);
        return action;
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer(event) { events.push(event); },
  });

  const response = await conversation.turn({
    threadId: "target-team-is-not-player-filter",
    message: "为洛杉矶FC找一名球员",
  });

  assert.equal(response.status, "completed");
  assert.equal(response.report?.targetTeam, "洛杉矶FC");
  const candidateSearch = events.find((event) => event.phase === "tool" && event.toolName === "search_candidates");
  assert.ok(candidateSearch && candidateSearch.phase === "tool");
  assert.equal(candidateSearch.filters.playerNameFilterUsed, false);
});


test("the case stops a repeated policy-blocked action before spending the remaining model-call budget", async () => {
  const player: PlayerProfile = {
    playerId: "guard-player", name: "Guard Player", team: "Harbor City", age: 22, position: "CM",
    competition: "Open League", season: "2025/26", minutes: 1200,
    stats: { goals: 2, assists: 1, passesAttempted: 200, passesCompleted: 160, longPasses: 12, carries: 30, pressures: 100, tackles: 8, interceptions: 4, shotAssists: 9 },
    source: "StatsBomb Open Data",
  };
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "推进表现" },
    { action: "search_candidates", position: "CM", minimumMinutes: 0, limit: 5 },
    { action: "evaluate_candidates", playerIds: [player.playerId] },
    { action: "evaluate_candidates", playerIds: [player.playerId] },
  ];
  let plannerCalls = 0;
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return [player]; } },
    planner: {
      async decide() {
        plannerCalls += 1;
        const action = actions.shift();
        assert.ok(action);
        return action;
      },
    },
    knowledgeBase: { async search() { return []; } },
  });

  const response = await conversation.turn({ threadId: "repeated-policy-action", message: "为巴萨找一名中场" });

  assert.equal(response.status, "completed");
  assert.equal(plannerCalls, 4);
  assert.equal(actions.length, 0);
  assert.deepEqual(response.report?.recommendations, []);
  assert.ok(response.report?.limitations.some((item) => /连续重复.*动作/.test(item)));
});

test("final report text cannot assert an unverified current club or league from model memory", async () => {
  const player = roleConstraintPlayer("ungrounded-affiliation-player", "Jonas Vale", "ST");
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "中锋比赛表现的可观察评估维度" },
    { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 },
    { action: "evaluate_candidates", playerIds: [player.playerId] },
    { action: "search_player_reports", query: "Jonas Vale 球员报告", playerNames: [player.name] },
    {
      action: "finish",
      targetTeam: "Bayern Munich",
      needSummary: "凯恩效力于拜仁慕尼黑，因此需要寻找替代者。",
      capabilityProfile: ["中锋表现"],
      recommendations: [],
      limitationKeys: [],
    },
    {
      action: "finish",
      targetTeam: "Bayern Munich",
      needSummary: "为拜仁寻找具备中锋职责、适合在右路踢球的替代人选。",
      capabilityProfile: ["中锋比赛表现"],
      recommendations: [],
      limitationKeys: [],
    },
  ];
  const decisionEvents: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "statsbomb", sourceName: "StatsBomb Open Data", async loadPlayers() { return [player]; } },
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer(event) { if (event.phase === "decision") decisionEvents.push(event); },
  });

  const response = await conversation.turn({ threadId: "unverified-final-affiliation", message: "为拜仁寻找凯恩的中锋替代者" });

  assert.equal(response.status, "completed");
  assert.equal(response.report?.needSummary, "为拜仁寻找具备中锋职责、适合在右路踢球的替代人选。");
  assert.ok(decisionEvents.some((event) => event.phase === "decision" && event.action === "finish" && event.policyBlocked));
  assert.equal(actions.length, 0);
});

test("mosaic LangGraph report only contains supported ASA competition records", async () => {
  const players: PlayerProfile[] = [
    {
      ...roleConstraintPlayer("understat:50001", "Alex Example", "ST"),
      team: "Harbor City", age: null, minutes: 1200, source: "Understat",
      sourceIdentity: { provider: "understat", playerId: "50001", competitionId: "EPL", seasonId: "2026/27", positionGroup: "ATT", retrievedAt: "2026-10-09T10:00:00.000Z", isCurrentSeason: true },
    },
    {
      ...roleConstraintPlayer("asa:50001", "Alex Example", "ST"),
      team: "River Town", age: 24, minutes: 1100, source: "ASA", competition: "美国职业足球大联盟（MLS）", season: "2026",
      sourceIdentity: { provider: "american-soccer-analysis", playerId: "50001", competitionId: "mls", seasonId: "2026", positionGroup: "ATT", retrievedAt: "2026-10-09T10:00:00.000Z", isCurrentSeason: true },
    },
  ];
  const outOfScopePlayers: PlayerProfile[] = ["nwsl", "usls"].map((competitionId) => ({
    ...roleConstraintPlayer(`asa:${competitionId}:50002`, "Out Of Scope", "ST"),
    competition: competitionId,
    source: "ASA",
    sourceIdentity: { provider: "american-soccer-analysis", playerId: "50002", competitionId, seasonId: "2026", positionGroup: "ATT", retrievedAt: "2026-10-09T10:00:00.000Z", isCurrentSeason: true },
  }));
  const repository = new MultiSourceCurrentPlayerRepository({
    understat: { mode: "understat", sourceName: "Understat fixture", async loadPlayers() { return [players[0]!]; } },
    asa: { mode: "asa", sourceName: "ASA fixture", async loadMenPlayers() { return [players[1]!, ...outOfScopePlayers]; } },
  });
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "中锋进球产出评估" },
    { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 },
    { action: "evaluate_candidates", playerIds: players.map(({ playerId }) => playerId) },
    { action: "search_player_reports", query: "Alex Example 球员报告", playerNames: ["Alex Example"] },
    {
      action: "finish",
      targetTeam: "Barcelona",
      needSummary: "为巴萨寻找中锋，优先考察进球产出。",
      capabilityProfile: ["进球产出"],
      recommendations: [{ playerId: players[0]!.playerId, evidenceKeys: ["goals"] }],
      limitationKeys: [],
    },
  ];
  const conversation = createRecruitmentConversation({
    repository,
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
  });

  const response = await conversation.turn({
    threadId: "mosaic-records-vs-people",
    message: "为巴萨寻找凯恩的中锋替代者，重点考察进球产出。",
  });

  assert.equal(response.status, "completed");
  assert.equal(response.report?.evidenceCoverage.evaluatedCandidateCount, 2);
  assert.ok(response.report?.limitations.some((item) => /来源记录数，不等于.*去重.*人数/.test(item)));
  assert.ok(response.report?.limitations.some((item) => /Understat.*ASA.*跨来源身份映射/.test(item)));
  assert.ok(response.report?.datasetScope?.limitations.some((item) => item.includes("MLS、USL Championship、USL League One")));
  for (const limitation of response.report?.datasetScope?.limitations ?? []) {
    assert.ok(response.report?.limitations.includes(limitation), `report should carry the canonical source limitation: ${limitation}`);
  }
  assert.deepEqual(new Set(response.report?.datasetScope?.observedCoverage?.competitions), new Set(["Open League", "美国职业足球大联盟（MLS）"]));
  assert.equal(JSON.stringify(response.report).includes("Out Of Scope"), false);
  assert.equal(JSON.stringify(response.report).includes("USL Super League"), false);
  assert.equal(JSON.stringify(response.report).includes("NWSL"), false);
  assert.equal(actions.length, 0);
});

test("policy report retrieval covers every evaluated candidate before Planner synthesis", async () => {
  const players: PlayerProfile[] = [
    {
      playerId: "report-player-a", name: "Report Player A", team: "Harbor City", age: 22, position: "CM",
      competition: "Open League", season: "2025/26", minutes: 1200,
      stats: { goals: 2, assists: 1, passesAttempted: 200, passesCompleted: 160, longPasses: 12, carries: 30, pressures: 100, tackles: 8, interceptions: 4, shotAssists: 9 },
      source: "StatsBomb Open Data",
    },
    {
      playerId: "report-player-b", name: "Report Player B", team: "River Town", age: 21, position: "CM",
      competition: "Open League", season: "2025/26", minutes: 1100,
      stats: { goals: 1, assists: 2, passesAttempted: 180, passesCompleted: 144, longPasses: 9, carries: 26, pressures: 110, tackles: 10, interceptions: 6, shotAssists: 7 },
      source: "StatsBomb Open Data",
    },
  ];
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", targetTeam: "Barcelona", query: "中场推进" },
    { action: "search_candidates", position: "CM", minimumMinutes: 0, limit: 5 },
    { action: "finish", targetTeam: "Barcelona", needSummary: "完成。", capabilityProfile: [], recommendations: [], limitationKeys: [] },
  ];
  let actualReportNames: string[] = [];
  let reorientationHistory: Parameters<RecruitmentPlanner["decide"]>[0]["history"] = [];
  const decisionModes: Array<"investigate" | "expand" | "expand_recovery" | "reorient" | "conclude" | undefined> = [];
  let conclusionConstraints: Parameters<RecruitmentPlanner["decide"]>[0]["constraints"];
  const events: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return players; } },
    planner: {
      async decide(input) {
        decisionModes.push(input.decisionMode);
        if (input.decisionMode === "conclude" || input.decisionMode === "reorient") {
          conclusionConstraints = input.constraints;
          reorientationHistory = input.history;
        }
        const action = actions.shift();
        assert.ok(action);
        return action;
      },
    },
    knowledgeBase: {
      async search(input) {
        if (input.corpus === "player_report") actualReportNames = input.playerNames;
        return [];
      },
    },
    observer: (event) => { events.push(event); },
  });

  const response = await conversation.turn({
    threadId: "all-candidates-reports",
    message: "为巴萨找一个创造机会、能在压力下控球的中场",
  });

  assert.equal(response.status, "completed");
  assert.deepEqual(new Set(actualReportNames), new Set(players.map((player) => player.name)));
  assert.equal(decisionModes.at(-1), "reorient");
  const candidateSearch = reorientationHistory.find(({ role, toolName }) =>
    role === "tool" && toolName === "search_candidates",
  );
  assert.ok(candidateSearch);
  const searchResult = JSON.parse(candidateSearch.content) as {
    candidates: Array<Record<string, unknown>>;
    nextOffset: number | null;
  };
  assert.deepEqual(new Set(searchResult.candidates.map(player => player.name)), new Set(players.map(player => player.name)));
  assert.equal(searchResult.nextOffset, null);
  const evaluationEntry = reorientationHistory.find(({ role, toolName }) => role === "tool" && toolName === "evaluate_candidates");
  assert.ok(evaluationEntry);
  const evaluationSummary = JSON.parse(evaluationEntry.content) as {
    evaluations: Array<{ metrics: Array<{ key: string }> }>;
  };
  const requestedMetricKeys = new Set<string>(conclusionConstraints?.requestedCapabilityCoverage.flatMap(({ requestedMetricKeys: keys }) => keys));
  assert.ok(evaluationSummary.evaluations.every(({ metrics }) => metrics.every(({ key }) => requestedMetricKeys.has(key))));
  assert.ok(reorientationHistory.some(({ role, toolName }) => role === "tool" && toolName === "search_player_reports"));
  assert.equal(conclusionConstraints?.targetTeam, "巴萨");
  assert.deepEqual(new Set(conclusionConstraints?.evaluatedCandidates.map(({ playerId }) => playerId)), new Set(players.map((player) => player.playerId)));
  assert.ok(conclusionConstraints?.evaluatedCandidates.every(({ evidenceKeys }) => evidenceKeys.length === 8));
  assert.deepEqual(conclusionConstraints?.reportObservations, []);
  assert.deepEqual(conclusionConstraints?.requestedCapabilityCoverage.map(({ name, status, evaluatedCandidateCount, candidatesWithEvidenceCount }) => ({
    name, status, evaluatedCandidateCount, candidatesWithEvidenceCount,
  })), [
    { name: "创造机会", status: "observed", evaluatedCandidateCount: players.length, candidatesWithEvidenceCount: players.length },
    { name: "压力下控球", status: "missing", evaluatedCandidateCount: players.length, candidatesWithEvidenceCount: 0 },
  ]);
  assert.deepEqual(response.report?.requestedCapabilityCoverage, conclusionConstraints?.requestedCapabilityCoverage);
  assert.match(response.report?.limitations.join(" ") ?? "", /压力下控球.*相对应的可观测指标/);
  const reportTrace = events.find((event) => event.phase === "tool" && event.toolName === "search_player_reports");
  assert.ok(reportTrace && reportTrace.phase === "tool");
  assert.equal(reportTrace.filters.searchedPlayerCount, 2);
  assert.deepEqual(new Set(reportTrace.filters.searchedPlayerIds as string[]), new Set(players.map((player) => player.playerId)));
});

test("the case preserves the named recruitment club across later actions that omit it", async () => {
  const player: PlayerProfile = {
    playerId: "team-context-player", name: "Team Context Player", team: "Harbor City", age: 22, position: "CM",
    competition: "Open League", season: "2025/26", minutes: 1200,
    stats: { goals: 2, assists: 1, passesAttempted: 200, passesCompleted: 160, longPasses: 12, carries: 30, pressures: 100, tackles: 8, interceptions: 4, shotAssists: 9 },
    source: "StatsBomb Open Data",
  };
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", targetTeam: "FC Barcelona", query: "中场推进" },
    { action: "search_candidates", position: "CM", minimumMinutes: 0, limit: 5 },
    { action: "evaluate_candidates", playerIds: [player.playerId] },
    { action: "search_player_reports", query: "球员报告", playerNames: [player.name] },
    { action: "finish", targetTeam: null, needSummary: "完成。", capabilityProfile: [], recommendations: [], limitationKeys: [] },
  ];
  const events: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return [player]; } },
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => { events.push(event); },
  });

  const response = await conversation.turn({ threadId: "preserved-target-team", message: "为巴萨找一名中场" });

  assert.equal(response.status, "completed");
  assert.equal(response.report?.targetTeam, "巴萨");
  assert.ok(events.filter((event) => event.phase === "decision").every((event) => event.targetTeam === "巴萨"));
});

test("missing event coverage and zero pass attempts are reported as unavailable evidence", async () => {
  async function investigate(player: PlayerProfile, id: string, recommendationKey?: "goals") {
    const actions: RecruitmentAction[] = [
      { action: "search_methodology", query: "中锋表现方法" },
      { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 },
      { action: "evaluate_candidates", playerIds: [player.playerId] },
      { action: "search_player_reports", query: "球员报告观察", playerNames: [player.name] },
      {
        action: "finish",
        targetTeam: null,
        needSummary: "基于当前比赛数据评估。",
        capabilityProfile: [],
        recommendations: recommendationKey ? [{ playerId: player.playerId, evidenceKeys: [recommendationKey] }] : [],
        limitationKeys: [],
      },
    ];
    let evaluations: unknown[] = [];
    const planner: RecruitmentPlanner = {
      async decide({ history }) {
        const evaluation = history.filter((entry) => entry.role === "tool" && entry.toolName === "evaluate_candidates").at(-1);
        if (evaluation) evaluations = (JSON.parse(evaluation.content) as { evaluations: Array<{ metrics: unknown[] }> }).evaluations[0]?.metrics ?? [];
        const action = actions.shift();
        assert.ok(action, "the investigation should finish within the decision budget");
        return action;
      },
    };
    const repository: PlayerRepository = {
      mode: "statsbomb",
      sourceName: "StatsBomb Open Data",
      async loadPlayers() { return [player]; },
    };
    const conversation = createRecruitmentConversation({ repository, planner, knowledgeBase: { async search() { return []; } } });
    const response = await conversation.turn({ threadId: id, message: "比较这个中锋" });
    return { response, evaluations };
  }

  const incomplete: PlayerProfile = {
    playerId: "missing-events", name: "Missing Events", team: "Harbor City", age: 23, position: "ST",
    competition: "Open League", season: "2025/26", minutes: 1800,
    stats: { goals: 0, assists: 0, passesAttempted: 0, passesCompleted: 0, longPasses: 0, carries: 0, pressures: 0, tackles: 0, interceptions: 0, shotAssists: 0 },
    eventDataComplete: false,
    source: "StatsBomb Open Data",
  };
  const noPasses: PlayerProfile = {
    ...incomplete,
    playerId: "no-passes",
    name: "No Pass Attempts",
    eventDataComplete: true,
    stats: { ...incomplete.stats, goals: 3 },
  };
  const unrecordedPassAttempts: PlayerProfile = {
    ...noPasses,
    playerId: "unrecorded-pass-attempts",
    name: "Unrecorded Pass Attempts",
    availableStats: ["goals"],
  };

  const incompleteResult = await investigate(incomplete, "incomplete-event-data");
  const noPassesResult = await investigate(noPasses, "no-pass-attempts", "goals");
  const unrecordedPassAttemptsResult = await investigate(unrecordedPassAttempts, "unrecorded-pass-attempts", "goals");

  assert.deepEqual(incompleteResult.evaluations, []);
  assert.equal(incompleteResult.response.report?.evidenceCoverage.availableMetricValues, 0);
  assert.equal(incompleteResult.response.report?.evidenceCoverage.expectedMetricValues, 9);
  assert.ok(incompleteResult.response.report?.limitations.some((item) => /缺少一场或多场比赛的事件文件/.test(item)));
  assert.equal(noPassesResult.evaluations.length, 7);
  assert.ok(!noPassesResult.evaluations.some((item) => (item as { key?: string }).key === "passCompletionPct"));
  assert.equal(noPassesResult.response.report?.evidenceCoverage.availableMetricValues, 7);
  assert.ok(noPassesResult.response.report?.limitations.some((item) => /没有传球尝试/.test(item)));
  assert.ok(!unrecordedPassAttemptsResult.response.report?.limitations.some((item) => /没有传球尝试/.test(item)));
});

test("an explicit replacement position avoids role clarification and filters out other positions", async () => {
  const striker = roleConstraintPlayer("role-st", "Jonas Vale", "ST");
  const centerBack = roleConstraintPlayer("role-cb", "Mika Stone", "CB");
  const events: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "statsbomb",
      sourceName: "StatsBomb Open Data",
      async loadPlayers() { return [striker, centerBack]; },
    },
    planner: {
      async decide(input) {
        if (input.decisionMode === "conclude" || input.decisionMode === "reorient") return {
          action: "finish",
          targetTeam: null,
          needSummary: "按用户指定的前锋位置完成比赛表现调查。",
          capabilityProfile: ["前锋比赛表现"],
          recommendations: [{ playerId: striker.playerId, evidenceKeys: ["goals"] }],
          limitationKeys: [],
        };
        if (!input.history.some(({ role, toolName }) => role === "tool" && toolName === "search_methodology")) {
          return { action: "search_methodology", query: "前锋能力画像与比赛表现评估" };
        }
        return { action: "search_candidates", position: null, minimumMinutes: 0, limit: 10 };
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer(event) { events.push(event); },
  });

  const response = await conversation.turn({ threadId: "explicit-forward-replacement", message: "为拜仁找一名前锋，作为凯恩的替代者" });

  assert.equal(response.status, "completed");
  assert.equal(response.report?.recommendations[0]?.player.playerId, striker.playerId);
  assert.deepEqual(events.filter((event) => event.phase === "tool" && event.toolName === "search_candidates")
    .map((event) => event.phase === "tool" ? event.filters.position : null), ["ATT"]);
  assert.ok(!events.some((event) => event.phase === "decision" && event.action === "ask_user" && event.askPolicyOutcome === "allowed"));
  assert.ok(!response.report?.recommendations.some(({ player }) => player.playerId === centerBack.playerId));
});

test("a broad attacking brief gets one evidence-first position question and resumes the same case", async () => {
  const winger = roleConstraintPlayer("broad-winger", "Sample Wide Forward", "WG");
  const striker = roleConstraintPlayer("broad-striker", "Sample Centre Forward", "ST");
  const players = [winger, striker];
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "进攻位置的表现评估方法" },
    { action: "search_candidates", position: null, minimumMinutes: 0, limit: 20 },
    { action: "search_candidates", position: "WG", minimumMinutes: 0, limit: 20 },
    {
      action: "finish",
      targetTeam: null,
      needSummary: "按用户确认的边锋角色完成首轮进攻表现比较。",
      capabilityProfile: ["边锋参与创造机会与进球"],
      recommendations: [{ playerId: winger.playerId, evidenceKeys: ["goals", "assists", "shotAssists"] }],
      limitationKeys: ["market_value", "contract"],
    },
  ];
  const plannerInputs: Array<{ confirmedPosition: string | null }> = [];
  const trace: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "statsbomb", sourceName: "Fixture current performance pool", async loadPlayers() { return players; } },
    planner: {
      async decide(input) {
        plannerInputs.push({ confirmedPosition: input.confirmedPosition });
        const action = actions.shift();
        assert.ok(action, "the case should continue from the same checkpoint with the scripted actions");
        return action;
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer(event) { trace.push(event); },
  });
  const threadId = "generic-role-clarification-resume";
  const firstTurn = await conversation.turn({ threadId, message: "为洛杉矶FC找一名能够增强进攻的球员。" });
  assert.equal(firstTurn.status, "needs_input");
  assert.match(firstTurn.message, /哪个场上位置/);
  assert.ok(trace.findIndex((event) => event.phase === "tool" && event.toolName === "evaluate_candidates")
    < trace.findIndex((event) => event.phase === "decision" && event.action === "ask_user"));
  assert.equal(plannerInputs[0]?.confirmedPosition, null);

  const resumedTurn = await conversation.turn({ threadId, message: "找边锋，优先参与创造机会和进球。" });
  assert.equal(resumedTurn.status, "completed");
  assert.equal(resumedTurn.threadId, threadId);
  assert.equal(resumedTurn.report?.targetTeam, "洛杉矶FC");
  assert.deepEqual(resumedTurn.report?.recommendations.map(({ player }) => player.playerId), [winger.playerId]);
  const candidateSearches = trace.filter((event): event is Extract<RecruitmentTraceEvent, { phase: "tool" }> => (
    event.phase === "tool" && event.toolName === "search_candidates"
  ));
  assert.deepEqual(candidateSearches.map(({ filters }) => filters.position), [null, "WG"]);
  assert.ok(plannerInputs.some(({ confirmedPosition }) => confirmedPosition === "WG"));
  assert.equal(actions.length, 0);
});

test("replacement searches use the reference role without inventing age or filtering on the reference name", async () => {
  const striker = roleConstraintPlayer("replacement-st", "Jonas Vale", "ST");
  const centerBack = roleConstraintPlayer("replacement-cb", "Mika Stone", "CB");
  const overAgeStriker = { ...roleConstraintPlayer("replacement-overage-st", "Older Vale", "ST"), age: 29 };
  const reference = { ...roleConstraintPlayer("reference-kane", "Harry Kane", "ST"), team: "拜仁", age: 20 };
  const players = [striker, centerBack, overAgeStriker, reference];
  const candidateSearches: Extract<RecruitmentTraceEvent, { phase: "tool" }>[] = [];
  const evaluationEvents: Extract<RecruitmentTraceEvent, { phase: "tool" }>[] = [];
  const asks: Extract<RecruitmentTraceEvent, { phase: "decision" }>[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "statsbomb", sourceName: "StatsBomb Open Data", async loadPlayers() { return players; } },
    planner: {
      async decide(input) {
        const tools = input.history.filter((entry) => entry.role === "tool").map((entry) => entry.toolName);
        if (input.decisionMode === "conclude" || input.decisionMode === "reorient") return {
          action: "finish",
          targetTeam: "拜仁",
          needSummary: "按凯恩的默认中锋角色完成调查。",
          capabilityProfile: ["中锋比赛表现"],
          recommendations: [{ playerId: striker.playerId, evidenceKeys: ["goals"] }],
          limitationKeys: [],
        };
        if (!tools.includes("search_methodology")) return { action: "search_methodology", query: "中锋接替者的可观察能力" };
        return { action: "search_candidates", position: null, playerName: "Harry Kane", maxAge: 35, minimumMinutes: 0, limit: 10 };
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer(event) {
      if (event.phase === "tool" && event.toolName === "search_candidates") candidateSearches.push(event);
      if (event.phase === "tool" && event.toolName === "evaluate_candidates") evaluationEvents.push(event);
      if (event.phase === "decision" && event.action === "ask_user") asks.push(event);
    },
  });
  const response = await conversation.turn({ threadId: "replacement-role-clarification", message: "为拜仁寻找凯恩的替代者" });
  assert.equal(response.status, "completed");
  assert.equal(response.report?.recommendations[0]?.player.playerId, striker.playerId);
  assert.equal(candidateSearches.length, 1);
  assert.equal(candidateSearches[0]?.filters.position, "ST");
  assert.equal(candidateSearches[0]?.filters.maxAge, null, "the reference player's age is not a user age limit");
  assert.equal(candidateSearches[0]?.filters.playerNameFilterUsed, false, "the reference name does not filter the successor pool");
  assert.ok(evaluationEvents.every((event) => !event.filters.evaluatedPlayerIds?.includes(reference.playerId)));
  assert.ok(evaluationEvents.some((event) => event.filters.evaluatedPlayerIds?.includes(overAgeStriker.playerId)), "without a user age limit, older same-role candidates remain eligible");
  assert.equal(asks.length, 0, "the matched reference position is inherited without an extra question");
});

test("an unresolved reference gets one specific position question before a candidate search", async () => {
  const centerBack = roleConstraintPlayer("replacement-confirmed-cb", "Mika Stone", "CB");
  let needsPosition = true;
  const events: RecruitmentTraceEvent[] = [];
  const candidateSearches: Extract<RecruitmentTraceEvent, { phase: "tool" }>[] = [];
  const conversation = createRecruitmentConversation({
    experimentalDeterministicSearchMode: "bypassed",
    experimentalRetrievalMode: "bypassed",
    repository: { mode: "statsbomb", sourceName: "StatsBomb Open Data", async loadPlayers() { return [centerBack]; } },
    planner: {
      async decide(input) {
        if (needsPosition) {
          needsPosition = false;
          return {
            action: "ask_user",
            question: "我无法从现有资料确认这名参考球员的位置。请告诉我他的场上位置，我会按同位置寻找接班人。",
            reason: "参考球员身份或位置无法从当前名单与比赛数据中核实。",
          };
        }
        if (input.decisionMode === "conclude" || input.decisionMode === "reorient") return {
          action: "finish",
          targetTeam: "拜仁",
          needSummary: "已按你指定的中后卫位置完成调查。",
          capabilityProfile: ["中后卫比赛表现"],
          recommendations: [],
          limitationKeys: [],
        };
        return { action: "finish", targetTeam: "拜仁", needSummary: "继续调查。", capabilityProfile: [], recommendations: [], limitationKeys: [] };
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer(event) {
      events.push(event);
      if (event.phase === "tool" && event.toolName === "search_candidates") candidateSearches.push(event);
    },
  });
  const threadId = "replacement-reuses-prior-search-count";

  const firstTurn = await conversation.turn({ threadId, message: "为拜仁寻找 Alex Unknown 的替代者" });
  assert.equal(firstTurn.status, "needs_input", JSON.stringify(events));
  assert.match(firstTurn.message, /告诉我他的场上位置/);
  assert.equal(candidateSearches.length, 0, "the agent asks for the missing role before searching an unverified position");

  const resumedTurn = await conversation.turn({ threadId, message: "我明确要找中后卫。" });

  assert.equal(resumedTurn.status, "completed");
  assert.equal(resumedTurn.report?.targetTeam, "拜仁");
  assert.equal(resumedTurn.report?.recommendations.length, 0);
  assert.equal(candidateSearches.length, 1, "the confirmed position is searched once; no mixed-position page needs replacement");
  assert.equal(candidateSearches[0]?.filters.position, "CB");
});

test("an unknown matching count keeps records usable for a position-resolved replacement search", async () => {
  const centerBack = roleConstraintPlayer("replacement-unknown-count-cb", "Mika Stone", "CB");
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "中后卫可观察能力维度" },
    { action: "search_candidates", position: "CB", minimumMinutes: 0, limit: 10 },
    {
      action: "finish",
      targetTeam: "拜仁",
      needSummary: "已按确认的中后卫角色完成调查。",
      capabilityProfile: ["中后卫比赛表现"],
      recommendations: [],
      limitationKeys: [],
    },
  ];
  const candidateSearches: Extract<RecruitmentTraceEvent, { phase: "tool" }>[] = [];
  const evaluations: Extract<RecruitmentTraceEvent, { phase: "tool" }>[] = [];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "statsbomb",
      sourceName: "StatsBomb Open Data",
      async loadPlayers() { return [centerBack]; },
      async searchCandidates(query) {
        return {
          players: query.position === "CB" ? [centerBack] : [],
          totalRecords: null,
          offset: query.offset,
          nextOffset: null,
          appliedFilters: query.position ? ["position"] : [],
        };
      },
    },
    planner: {
      async decide() {
        const action = actions.shift();
        assert.ok(action, "the recorded player should proceed to evaluation without a fabricated total count");
        return action;
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer(event) {
      if (event.phase === "tool" && event.toolName === "search_candidates") candidateSearches.push(event);
      if (event.phase === "tool" && event.toolName === "evaluate_candidates") evaluations.push(event);
    },
  });
  const threadId = "replacement-unknown-matching-count";

  const response = await conversation.turn({ threadId, message: "为拜仁寻找 Alex Unknown 的替代者，位置限定中后卫。" });

  assert.equal(response.status, "completed");
  assert.equal(candidateSearches.length, 1, "the explicit role is searched without needing a prior mixed-position page");
  assert.equal(candidateSearches[0]?.matchingRecordCount, undefined);
  assert.ok(evaluations.some((event) => event.filters.evaluatedPlayerIds?.includes(centerBack.playerId)));
  assert.ok(response.report?.limitations.every((limitation) => !/没有找到符合中后卫/.test(limitation)));
  assert.equal(actions.length, 0);
});

test("report discloses an unread page when the matching total is unknown", async () => {
  const midfielder = roleConstraintPlayer("unknown-total-page-cm", "Mika Stone", "CM");
  const searchPage: RecruitmentAction = {
    action: "search_candidates",
    position: "MID",
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 20,
  };
  const finish: RecruitmentAction = {
    action: "finish",
    targetTeam: "巴萨",
    needSummary: "已依据当前读取的中场比赛表现整理结论。",
    capabilityProfile: ["中场比赛表现"],
    recommendations: [{ playerId: midfielder.playerId, evidenceKeys: ["goals"] }],
    limitationKeys: [],
  };
  const decisionModes: Array<string | undefined> = [];
  const searchOffsets: number[] = [];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "Demo candidate fixture",
      async loadPlayers() { return [midfielder]; },
      async searchCandidates(query) {
        searchOffsets.push(query.offset);
        return {
          players: query.position === "MID" ? [midfielder] : [],
          totalRecords: null,
          offset: query.offset,
          nextOffset: query.offset + 1,
          appliedFilters: query.position ? ["position" as PlayerSearchFilter] : [],
        };
      },
    },
    planner: {
      async decide({ history, decisionMode, expansionConstraints }) {
        decisionModes.push(decisionMode);
        const lastTool = history.at(-1);
        const candidateSearchCount = history.filter((entry) => entry.role === "tool" && entry.toolName === "search_candidates").length;
        if (decisionMode === "expand") {
          assert.equal(expansionConstraints?.nextOffset, 1);
          return finish;
        }
        if (decisionMode === "conclude" || decisionMode === "reorient") return finish;
        if (history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology")) {
          if (candidateSearchCount === 0) return searchPage;
          if (lastTool?.role === "tool" && lastTool.toolName === "evaluate_candidates") {
            return {
              action: "search_player_reports",
              query: "中场候选球员报告",
              playerNames: [midfielder.name],
            };
          }
        }
        return { action: "search_methodology", query: "中后卫可观察能力维度" };
      },
    },
    knowledgeBase: { async search() { return []; } },
  });

  const response = await conversation.turn({
    threadId: "unknown-count-incomplete-candidate-page",
    message: "为巴萨找一名中场",
  });

  assert.equal(response.status, "completed");
  assert.deepEqual(searchOffsets, [0], "the Planner concludes after the observed first page");
  assert.ok(decisionModes.includes("expand"));
  assert.ok(response.report?.limitations.some((limitation) => /匹配总数未知.*下一页.*尚未读完/.test(limitation)), JSON.stringify(response.report?.limitations));
});

test("a candidate name previously sent to report search is not trusted without a returned report entity", async () => {
  const striker = roleConstraintPlayer("report-name-gate-st", "Jonas Vale", "ST");
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "凯恩替代者的可观察能力维度" },
    { action: "search_candidates", position: null, minimumMinutes: 0, limit: 10 },
    { action: "search_methodology", query: "中锋进球表现的可观察指标" },
    { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 },
    { action: "evaluate_candidates", playerIds: [striker.playerId] },
    { action: "search_player_reports", query: "中锋球员报告", playerNames: [striker.name] },
    { action: "search_candidates", position: "ST", playerName: striker.name, minimumMinutes: 0, limit: 10 },
    {
      action: "finish",
      targetTeam: null,
      needSummary: "按用户确认的中锋角色和比赛数据完成考察线索。",
      capabilityProfile: ["中锋进球表现"],
      recommendations: [{ playerId: striker.playerId, evidenceKeys: ["goals"] }],
      limitationKeys: [],
    },
  ];
  const trace: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "statsbomb", sourceName: "StatsBomb Open Data", async loadPlayers() { return [striker]; } },
    planner: {
      async decide() {
        const action = actions.shift();
        assert.ok(action, "the scripted planner action should be available");
        return action;
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer(event) { trace.push(event); },
  });
  const threadId = "replacement-name-filter-needs-report-evidence";
  const firstTurn = await conversation.turn({ threadId, message: "为拜仁寻找凯恩的替代者" });
  assert.equal(firstTurn.status, "needs_input");

  const resumedTurn = await conversation.turn({ threadId, message: "按中锋职责继续，重点看进球。" });
  assert.equal(resumedTurn.status, "completed");
  assert.equal(resumedTurn.report?.recommendations[0]?.player.playerId, striker.playerId);
  const candidateSearches = trace.filter((event): event is Extract<RecruitmentTraceEvent, { phase: "tool" }> => (
    event.phase === "tool" && event.toolName === "search_candidates"
  ));
  assert.ok(candidateSearches.length > 0);
  assert.ok(candidateSearches.every(({ filters }) => filters.playerNameFilterUsed === false));
  assert.equal(actions.length, 0);
});

test("an empty confirmed-role search never falls back to previously discovered players from another position", async () => {
  const centerBack = roleConstraintPlayer("empty-role-cb", "Mika Stone", "CB");
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "前锋位置的表现评估方法" },
    { action: "search_candidates", position: null, minimumMinutes: 0, limit: 10 },
    { action: "evaluate_candidates", playerIds: [centerBack.playerId] },
    {
      action: "ask_user",
      question: "你希望寻找哪种具体位置？",
      reason: "具体位置会改变候选名单。",
    },
    { action: "search_candidates", position: "CB", minimumMinutes: 0, limit: 10 },
  ];
  const candidateSearches: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "statsbomb", sourceName: "StatsBomb Open Data", async loadPlayers() { return [centerBack]; } },
    planner: {
      async decide() {
        const action = actions.shift();
        assert.ok(action);
        return action;
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer(event) {
      if (event.phase === "tool" && event.toolName === "search_candidates") candidateSearches.push(event);
    },
  });
  const threadId = "empty-confirmed-role";

  const firstTurn = await conversation.turn({ threadId, message: "帮我找一名前锋" });
  assert.equal(firstTurn.status, "needs_input");
  const resumedTurn = await conversation.turn({ threadId, message: "我明确要找中锋，不考虑其他位置。" });

  assert.equal(resumedTurn.status, "completed");
  assert.deepEqual(resumedTurn.report?.recommendations, []);
  assert.ok(resumedTurn.report?.limitations.some((item) => /用户确认的位置（中锋）完成候选检索后，没有找到/.test(item)));
  assert.deepEqual(candidateSearches.map((event) => event.phase === "tool" ? event.filters.position : null), ["ATT", "ST"]);
  assert.equal(candidateSearches[1]?.phase === "tool" ? candidateSearches[1].matchingRecordCount : null, 0);
  assert.equal(actions.length, 0);
});

test("an empty confirmed-role search asks whether to broaden before asking the model for another action", async () => {
  const centerBack = roleConstraintPlayer("replacement-empty-st-cb", "Mika Stone", "CB");
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "中锋位置的表现评估方法" },
    { action: "search_candidates", position: null, minimumMinutes: 0, limit: 10 },
    { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 },
  ];
  const candidateSearches: Extract<RecruitmentTraceEvent, { phase: "tool" }>[] = [];
  let plannerCalls = 0;
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return [centerBack]; } },
    planner: {
      async decide() {
        plannerCalls += 1;
        const action = actions.shift();
        assert.ok(action, "an empty confirmed-role result should be handled without another model action");
        return action;
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer(event) {
      if (event.phase === "tool" && event.toolName === "search_candidates") candidateSearches.push(event);
    },
  });
  const threadId = "replacement-empty-confirmed-role";

  const firstTurn = await conversation.turn({ threadId, message: "为拜仁寻找凯恩的替代者" });
  assert.equal(firstTurn.status, "needs_input");

  const resumedTurn = await conversation.turn({ threadId, message: "按中锋职责，优先未来接班。" });

  assert.equal(resumedTurn.status, "needs_input");
  assert.match(resumedTurn.message, /没有找到符合中锋.*候选/);
  assert.match(resumedTurn.message, /扩大到其他位置/);
  assert.equal(plannerCalls, 3);
  assert.deepEqual(candidateSearches.map(({ filters }) => filters.position), ["ST"]);
  assert.equal(candidateSearches.at(-1)?.matchingRecordCount, 0);
  const keptRoleTurn = await conversation.turn({ threadId, message: "保留中锋范围并先结束本轮。" });
  assert.equal(keptRoleTurn.status, "completed");
  assert.deepEqual(keptRoleTurn.report?.recommendations, []);
  assert.ok(keptRoleTurn.report?.limitations.some((item) => /按用户确认的位置（中锋）完成候选检索后，没有找到/.test(item)));
  assert.equal(plannerCalls, 3, "the confirmed empty result and user's choice are handled without more model calls");
  assert.equal(actions.length, 0);
});

test("broadening an empty striker search to other forward positions keeps the position-family constraint", async () => {
  const attackers = Array.from({ length: 21 }, (_, index) => roleConstraintPlayer(
    `replacement-empty-st-rw-${index + 1}`,
    `Jonas Vale ${index + 1}`,
    "RW",
  ));
  const centerBack = roleConstraintPlayer("replacement-empty-st-cb-family", "Mika Stone", "CB");
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "凯恩接班人的可观察能力维度" },
    { action: "search_candidates", position: null, minimumMinutes: 0, limit: 10 },
    { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 },
    { action: "search_candidates", position: "ATT", minimumMinutes: 0, limit: 20 },
    { action: "evaluate_candidates", playerIds: attackers.slice(0, 10).map(({ playerId }) => playerId) },
    { action: "search_player_reports", query: "Jonas Vale 球员报告", playerNames: attackers.slice(0, 10).map(({ name }) => name) },
    {
      action: "ask_user",
      question: "你是否同意扩大到其他前锋位置？",
      reason: "需要再次确认是否扩大位置范围。",
    },
    {
      action: "finish",
      targetTeam: null,
      needSummary: "按用户同意扩大的前锋位置范围完成比较。",
      capabilityProfile: ["前锋表现"],
      recommendations: [{ playerId: attackers[0]!.playerId, evidenceKeys: ["goals"] }],
      limitationKeys: [],
    },
  ];
  const candidateSearches: Extract<RecruitmentTraceEvent, { phase: "tool" }>[] = [];
  const evaluationEvents: Extract<RecruitmentTraceEvent, { phase: "tool" }>[] = [];
  const decisionEvents: Extract<RecruitmentTraceEvent, { phase: "decision" }>[] = [];
  const approvedBroadeningPlannerCalls: boolean[] = [];
  let plannerCalls = 0;
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Demo", async loadPlayers() { return [centerBack, ...attackers]; } },
    planner: {
      async decide(input) {
        plannerCalls += 1;
        if (input.positionBroadeningApproved) approvedBroadeningPlannerCalls.push(input.positionBroadeningApproved);
        const action = actions.shift();
        assert.ok(action, `missing planner action ${plannerCalls}: ${JSON.stringify({ confirmedPosition: input.confirmedPosition, lastTool: input.history.at(-1)?.toolName })}`);
        return action;
      },
    },
    knowledgeBase: { async search() { return []; } },
    observer(event) {
      if (event.phase === "tool" && event.toolName === "search_candidates") candidateSearches.push(event);
      if (event.phase === "tool" && event.toolName === "evaluate_candidates") evaluationEvents.push(event);
      if (event.phase === "decision") decisionEvents.push(event);
    },
  });
  const threadId = "replacement-empty-st-broaden-forward-family";

  const firstTurn = await conversation.turn({ threadId, message: "为拜仁寻找凯恩的替代者" });
  assert.equal(firstTurn.status, "needs_input");
  assert.deepEqual(evaluationEvents, [], "the agent should confirm the replacement role before evaluating candidates from a broad first pass");
  const roleTurn = await conversation.turn({ threadId, message: "按中锋职责，优先未来接班。" });
  assert.equal(roleTurn.status, "needs_input");
  assert.deepEqual(evaluationEvents, [], "an empty confirmed-position search should be resolved before any out-of-position candidate is evaluated");
  assert.match(roleTurn.message, /扩大到其他位置/);
  const broadenedTurn = await conversation.turn({ threadId, message: "扩大到其他前锋位置继续找。" });

  assert.equal(broadenedTurn.status, "completed");
  assert.equal(broadenedTurn.report?.targetTeam, "拜仁");
  assert.deepEqual(candidateSearches.map(({ filters }) => filters.position), ["ST", "ATT", "ATT"]);
  assert.equal(candidateSearches.at(-2)?.filters.offset, 0);
  assert.equal(candidateSearches.at(-2)?.filters.nextOffset, 20);
  assert.equal(candidateSearches.at(-1)?.filters.offset, 20);
  const lastPageIds = candidateSearches.at(-1)?.filters.candidateIds as string[];
  const firstPageIds = candidateSearches.at(-2)?.filters.candidateIds as string[];
  assert.equal(lastPageIds.length, 1);
  assert.ok(lastPageIds.every(id => !firstPageIds.includes(id)));
  assert.ok(lastPageIds.every(id => evaluationEvents.at(-1)?.filters.evaluatedPlayerIds?.includes(id)));
  assert.deepEqual(new Set([...firstPageIds, ...lastPageIds]), new Set(attackers.map(player => player.playerId)));
  assert.deepEqual(broadenedTurn.report?.recommendations.map(({ player }) => player.playerId), [attackers[0]!.playerId]);
  assert.ok(broadenedTurn.report?.recommendations.every(({ player }) => player.position === "RW"));
  assert.ok(approvedBroadeningPlannerCalls.length > 0, "the Planner receives the user's confirmed position expansion");
  assert.equal(decisionEvents.some(({ action, policyBlocked }) => action === "ask_user" && policyBlocked), false);
  assert.ok(decisionEvents.some(({ action, proposedAction, decisionSource, policyBlocked }) => (
    action === "search_candidates" && proposedAction === "ask_user" && decisionSource === "policy" && !policyBlocked
  )), "a repeated expansion question should become the exact next-page search without a blocked planner retry");
  assert.equal(actions.length, 0);
});

test("Understat explains unavailable fine-grained positions before asking to broaden an empty striker search", async () => {
  let plannerCalls = 0;
  const broadForward = { ...roleConstraintPlayer("broad-forward", "Forward Sample", "ATT"), age: null };
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "中锋的进球产出指标" },
    { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 20 },
  ];
  const conversation = createRecruitmentConversation({
    repository: { mode: "understat", sourceName: "Understat", async loadPlayers() { return [broadForward]; } },
    planner: { async decide() { plannerCalls += 1; const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
  });
  const response = await conversation.turn({ threadId: "understat-position-granularity", message: "为拜仁找一名中锋，重点看进球产出，不限制年龄。" });
  assert.equal(response.status, "needs_input");
  assert.match(response.message, /只提供.*大类/);
  assert.match(response.message, /不能确认.*中锋/);
  assert.match(response.question?.reason ?? "", /不代表.*没有中锋/);
  assert.equal(response.report, null);
  assert.equal(plannerCalls, 2, "a source limitation must not trigger repeated model calls or unauthorized expansion");
});

test("Understat age limitations ask once and preserve the user's keep or remove choice", async () => {
  for (const keepAge of [true, false]) {
    const player = { ...roleConstraintPlayer("age-unknown-mid", "Midfield Sample", "MID"), age: null };
    const actions: RecruitmentAction[] = [
      { action: "search_methodology", query: "中场推进" },
      { action: "search_candidates", position: "MID", maxAge: 23, minimumMinutes: 0, limit: 10 },
      { action: "search_candidates", position: "MID", minimumMinutes: 0, limit: 10 },
      { action: "finish", targetTeam: "巴萨", needSummary: "没有可核验的推进指标。", capabilityProfile: [], recommendations: [], limitationKeys: [] },
    ];
    let calls = 0;
    let searches = 0;
    const conversation = createRecruitmentConversation({
      repository: {
        mode: "understat", sourceName: "Understat",
        async loadPlayers() { return [player]; },
        async searchCandidates(query) {
          searches++;
          if (query.maxAge !== null) throw Object.assign(new Error("Understat 未提供出生日期或年龄"), { code: "unsupported_scope" });
          return { players: [player], totalRecords: 1, offset: query.offset, nextOffset: null, appliedFilters: ["position"] };
        },
      },
      planner: { async decide() { calls++; const action = actions.shift(); assert.ok(action); return action; } },
      knowledgeBase: { async search() { return []; } },
    });
    const threadId = `understat-age-choice-${keepAge}`;
    const first = await conversation.turn({ threadId, message: "为巴萨找23岁以下、推进强的中场" });
    assert.equal(first.status, "needs_input");
    assert.match(first.message, /取消年龄限制/);
    assert.match(first.question?.reason ?? "", /不代表没有/);
    assert.equal(calls, 2, "known source limitations must not trigger more Planner retries");
    const resumed = await conversation.turn({ threadId, message: keepAge ? "保留年龄要求，结束本轮" : "取消年龄限制" });
    assert.equal(resumed.status, "completed");
    assert.deepEqual(resumed.report?.recommendations, []);
    assert.equal(searches, keepAge ? 1 : 2);
    if (keepAge) {
      assert.equal(calls, 2);
      assert.match(resumed.report?.needSummary ?? "", /保留.*23.*年龄/);
      assert.match(resumed.message, /保留.*年龄要求/);
    }
    else assert.equal(resumed.report?.evidenceCoverage.evaluatedCandidateCount, 1);
  }
});
