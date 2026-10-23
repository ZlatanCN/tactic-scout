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
        return { players: [player], totalRecords: 1, offset: query.offset, nextOffset: null, appliedFilters: query.position ? ["position"] : [] };
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

test("the evaluation-only frozen single-page planner searches the verbatim question before conclusion synthesis", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const methodologyQueries: string[] = [];
  const conclusionInputs: Array<Parameters<RecruitmentPlanner["decide"]>[0]> = [];
  const player = roleConstraintPlayer("fixed-plan-striker", "Jonas Vale", "ST");
  const planner = createSinglePassInvestigationPlanner({
    async decide(input) {
      conclusionInputs.push(input);
      assert.equal(input.decisionSnapshot.caps.stage, "conclude");
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
  assert.equal(methodologyQueries[0], "为拜仁寻找凯恩的中锋接班人，重点看进球产出。");
  const candidateSearches = events.filter((event) => event.phase === "tool" && event.toolName === "search_candidates");
  assert.equal(candidateSearches.length, 1, "the graph waits for a concrete position rather than sampling mixed roles first");
  assert.equal(candidateSearches[0]?.phase === "tool" ? candidateSearches[0].filters.position : null, "ST");
  assert.equal(events.filter((event) => event.phase === "review" && event.outcome === "passed").length, 1);
  assert.ok(conclusionInputs.some((input) => input.decisionSnapshot.constraints?.evaluatedCandidates.some(({ playerId }) => playerId === player.playerId)),
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
        return { players: [player], totalRecords: 1, offset: query.offset, nextOffset: null, appliedFilters: query.position ? ["position"] : [] };
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
  const graphEvents: RecruitmentTraceEvent[] = [];
  const planner: RecruitmentPlanner = {
    async decide(input) {
      const tools = input.decisionSnapshot.history.filter((entry) => entry.role === "tool").map((entry) => entry.toolName);
      if (input.decisionSnapshot.caps.stage === "conclude" || input.decisionSnapshot.caps.stage === "reorient") {
        const hasAnswer = input.decisionSnapshot.history.some((entry) => entry.role === "user" && entry.content.includes("未来两三年接班"));
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
  const app = createApp({ recruitmentConversation: createRecruitmentConversation({
    repository, planner, knowledgeBase, observer: (event) => graphEvents.push(event),
  }) });
  const threadId = "case-bayern-kane-resume";

  try {
    const firstTurn = await app.inject({
      method: "POST",
      url: `/api/v1/recruitment/cases/${threadId}/turns/stream`,
      headers: { accept: "text/event-stream" },
      payload: { requestId: "b845e006-0fe5-4afb-9bfd-f5759b95bf61", message: "为拜仁寻找凯恩的替代者" },
    });

    assert.equal(firstTurn.statusCode, 200);
    const firstEvents = firstTurn.payload.split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; response?: any });
    const firstResponse = firstEvents.find((event) => event.type === "result")?.response;
    assert.equal(firstResponse?.status, "needs_input");
    assert.match(firstResponse?.message ?? "", /即战力|培养空间/);
    assert.doesNotMatch(firstResponse?.message ?? "", /延续.*角色.*还是.*不同.*位置/);
    assert.ok(firstEvents.some((event) => event.type === "candidates"), "candidate previews are delivered over SSE");

    const resumedTurn = await app.inject({
      method: "POST",
      url: `/api/v1/recruitment/cases/${threadId}/turns/stream`,
      headers: { accept: "text/event-stream" },
      payload: {
        requestId: "4c0d237b-907e-4877-9190-59a48d063a9d",
        expectsExistingState: true,
        message: "未来两三年接班，但希望有主力潜质",
      },
    });

    assert.equal(resumedTurn.statusCode, 200);
    const resumedEvents = resumedTurn.payload.split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; progress?: { stage: string }; response?: any });
    const body = resumedEvents.find((event) => event.type === "result")?.response;
    assert.equal(body.status, "completed");
    assert.ok(resumedEvents.some((event) => event.type === "progress" && event.progress?.stage === "review"),
      "the final SSE turn reports the evidence review stage");
    assert.ok(graphEvents.some((event) => event.phase === "review" && event.outcome === "passed"),
      "the final shortlist passes the Reviewer");
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
      methodologyOutcome: "found",
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
      playerReportOutcome: "unavailable",
      playerReportSearchFailed: true,
      playerReportChunksRetrieved: 0,
    });
    const observedTools = graphEvents.filter((event) => event.phase === "tool" && event.ok).map((event) => event.toolName);
    assert.ok(observedTools.indexOf("search_methodology") < observedTools.indexOf("search_candidates"));
    assert.ok(observedTools.indexOf("evaluate_candidates") < observedTools.indexOf("search_player_reports"));
    assert.deepEqual(body.report.searchScopes, [{
      excludedTargetTeam: "拜仁",
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
