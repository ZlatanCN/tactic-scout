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
          contextChars: 128,
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
    && event.contextChars === 128
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
      ...roleConstraintPlayer("understat:50001", "Alex Example", "ST"), externalPlayerId: "50001",
      team: "Harbor City", age: null, minutes: 1200, source: "Understat",
      sourceIdentity: { provider: "understat", playerId: "50001", competitionId: "EPL", seasonId: "2026", positionGroup: "ATT", retrievedAt: "2026-10-09T10:00:00.000Z", isCurrentSeason: true },
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
    understat: {
      mode: "understat",
      sourceName: "Understat fixture",
      async loadPlayers() { return [players[0]!]; },
      async inspectPlayer(playerId) {
        assert.equal(playerId, players[0]!.playerId);
        return understatRoleResearch({ ...players[0]!, externalPlayerId: "50001" }, "FW");
      },
    },
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
