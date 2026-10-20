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
          if (input.decisionSnapshot.caps.stage === "conclude" || input.decisionSnapshot.caps.stage === "reorient") return {
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
        if (input.decisionSnapshot.caps.stage === "conclude" || input.decisionSnapshot.caps.stage === "reorient") return {
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
        plannerInputs.push({ confirmedPosition: input.decisionSnapshot.case.confirmedPosition });
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
        if (input.decisionSnapshot.caps.stage === "conclude" || input.decisionSnapshot.caps.stage === "reorient") return {
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
        if (input.decisionSnapshot.caps.stage === "conclude" || input.decisionSnapshot.caps.stage === "reorient") return {
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
      async decide(input) {
      const { history, decisionSnapshot } = input;
      const decisionMode = decisionSnapshot.caps.stage;
      const expansionConstraints = decisionSnapshot.search.expansionConstraints;
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
        if (input.decisionSnapshot.case.positionBroadeningApproved) approvedBroadeningPlannerCalls.push(input.decisionSnapshot.case.positionBroadeningApproved);
        const action = actions.shift();
        assert.ok(action, `missing planner action ${plannerCalls}: ${JSON.stringify({ confirmedPosition: input.decisionSnapshot.case.confirmedPosition, lastTool: input.history.at(-1)?.toolName })}`);
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

test("pitch multi-position confirmation shares Understat research and retains independent role evidence", async () => {
  const flexible = understatRoleCandidate(801);
  const defensive = understatRoleCandidate(802);
  const unrelated = understatRoleCandidate(803);
  const unknown = understatRoleCandidate(804);
  const players = [flexible, defensive, unrelated, unknown];
  let detailReads = 0;
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "understat", sourceName: "Frozen Understat position fixture", async loadPlayers() { return players; },
      async inspectCandidateGroup(ids) {
        detailReads++;
        return ids.map((id) => {
          const player = players.find((item) => item.playerId === id)!;
          if (id === unknown.playerId) return { ...understatRoleResearch(player, "MC"), positions: [], availableSections: [] };
          if (id === flexible.playerId) {
            const research = understatRoleResearch(player, "MC", 900);
            return { ...research, positions: [...research.positions, ...understatRoleResearch(player, "DMC", 450).positions] };
          }
          return understatRoleResearch(player, id === defensive.playerId ? "DMC" : "AMC");
        });
      },
    },
    planner: { async decide(input) {
      if (input.decisionSnapshot.constraints) return {
        action: "finish", targetTeam: input.decisionSnapshot.case.targetTeam, needSummary: "按所选位置寻找进球表现线索", capabilityProfile: ["进球"],
        recommendations: input.decisionSnapshot.constraints.evaluatedCandidates.map(({ playerId }) => ({ playerId, evidenceKeys: ["goals"] })), limitationKeys: [],
      };
      if (!input.history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology")) return { action: "search_methodology", query: "进球表现" };
      if (input.history.some((entry) => entry.role === "tool" && entry.toolName === "search_candidates")
        && !input.history.some((entry) => entry.role === "tool" && entry.toolName === "inspect_candidate_group")) return { action: "inspect_candidate_group", playerIds: players.map(({ playerId }) => playerId), sections: ["positions"] };
      return { action: "search_candidates", position: null, minimumMinutes: 0, limit: 12 };
    } },
    knowledgeBase: { async search() { return []; } },
  });
  const first = await conversation.turn({ threadId: "pitch-understat-union", message: "为巴萨寻找能够增加进球的球员" });
  assert.equal(first.status, "needs_input");
  assert.ok(first.question?.input);
  const response = await conversation.turn({ threadId: "pitch-understat-union", message: "", expectsExistingState: true,
    positionAnswer: { questionId: first.question.input.questionId, positions: ["CM", "DM"] } });
  assert.equal(response.status, "completed");
  assert.deepEqual(response.report?.recommendations.map(({ player }) => player.playerId).sort(), [flexible.playerId, defensive.playerId].sort());
  const candidate = response.report?.recommendations.find(({ player }) => player.playerId === flexible.playerId);
  assert.deepEqual(candidate?.matchedPositions, ["CM", "DM"]);
  assert.equal(candidate?.player.positionEvidenceByPosition?.CM?.sampleMinutes, 900);
  assert.equal(candidate?.player.positionEvidenceByPosition?.DM?.sampleMinutes, 450);
  assert.equal(detailReads, 1, "one source detail read verifies both selected roles");
  assert.ok(response.report?.positionLeads?.some(({ player }) => player.playerId === unknown.playerId));
});
