import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  MemorySaver,
  createApp,
  MultiSourceCurrentPlayerRepository,
  createRecruitmentConversation,
  RecruitmentCaseStateExpiredError,
  RecruitmentModelTimeoutError,
  RecruitmentPlannerOutputError,
  unavailableRecruitmentConversation,
  RecruitmentAction,
  RecruitmentConversation,
  RecruitmentPlanner,
  RecruitmentTraceEvent,
  createSinglePassInvestigationPlanner,
  PlayerRepository,
  PlayerSearchFilter,
  PlayerSearchQuery,
  PlayerProfile,
  KnowledgeSearchResult,
  installRecruitmentConversationTestEnvironment,
  roleConstraintPlayer,
  understatRoleCandidate,
  understatRoleResearch,
} from "./fixtures/recruitment-conversation.js";

const restoreEnvironment = installRecruitmentConversationTestEnvironment();
after(restoreEnvironment);

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
