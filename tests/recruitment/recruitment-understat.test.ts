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
    { action: "search_candidates", targetTeam: null, position: "ATT", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 20 },
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
        const players = candidates.filter((player) => query.position === "ATT" ? player.position === "ST" : player.position === query.position);
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

  const response = await conversation.turn({ threadId: "understat-cohort-case", message: "请按前锋大类找候选，重点比较射门机会质量与非点球 xG" });

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

test("a detailed Understat position query searches its family, verifies current-season tags, then recommends only supported candidates", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const candidates = [
    { ...roleConstraintPlayer("understat-cm-match", "Central Midfielder", "MID"), source: "Understat", externalPlayerId: "201", season: "2026/27", sourceIdentity: { provider: "understat" as const, playerId: "EPL:201", competitionId: "EPL", seasonId: "2026", positionGroup: "MID" as const, retrievedAt: "2026-10-16T00:00:00.000Z", isCurrentSeason: true } },
    { ...roleConstraintPlayer("understat-am-match", "Attacking Midfielder", "MID"), source: "Understat", externalPlayerId: "202", season: "2026/27", sourceIdentity: { provider: "understat" as const, playerId: "EPL:202", competitionId: "EPL", seasonId: "2026", positionGroup: "MID" as const, retrievedAt: "2026-10-16T00:00:00.000Z", isCurrentSeason: true } },
    { ...roleConstraintPlayer("understat-sub-only", "Substitute Only", "MID"), source: "Understat", externalPlayerId: "203", season: "2026/27", sourceIdentity: { provider: "understat" as const, playerId: "EPL:203", competitionId: "EPL", seasonId: "2026", positionGroup: "MID" as const, retrievedAt: "2026-10-16T00:00:00.000Z", isCurrentSeason: true } },
  ];
  const currentPositionRows = [
    [{ season: "2026", code: "MC", minutes: 900, games: 12, goals: 9, shots: 40, xG: 9, assists: 3, xA: 4, keyPasses: 22, npxG: 8, xGChain: 12, xGBuildup: 5 }],
    [{ season: "2026", code: "AMC", minutes: 900, games: 12, goals: 4, shots: 20, xG: 4, assists: 2, xA: 3, keyPasses: 30, npxG: 4, xGChain: 9, xGBuildup: 4 }],
    [{ season: "2026", code: "Sub", minutes: 450, games: 12, goals: 2, shots: 12, xG: 2, assists: 1, xA: 1, keyPasses: 5, npxG: 2, xGChain: 3, xGBuildup: 1 }],
  ];
  const research = candidates.map((player, index) => ({
    playerId: player.playerId,
    name: player.name,
    team: player.team,
    competition: player.competition,
    season: player.season,
    sourcePlayerId: player.externalPlayerId!,
    sourceUrl: `https://understat.com/player/${player.externalPlayerId}`,
    retrievedAt: "2026-10-16T00:00:00.000Z",
    player: { id: player.externalPlayerId!, name: player.name, favoritePosition: null },
    lastMatch: null,
    requestedSections: ["positions" as const],
    availableSections: ["positions" as const],
    positions: currentPositionRows[index]!,
    notes: ["位置标签表示赛季比赛记录，不代表完整战术职责。"],
  }));
  const actions: RecruitmentAction[] = [
    { action: "search_candidates", targetTeam: "拜仁", position: "CM", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 12 },
    { action: "finish", targetTeam: "拜仁", needSummary: "先比较有当前赛季中前卫位置记录的候选。", capabilityProfile: ["射门机会质量"], recommendations: [{ playerId: candidates[0]!.playerId, evidenceKeys: ["understatExpectedGoalsPer90"] }], limitationKeys: [] },
  ];
  const conversation = createRecruitmentConversation({
    experimentalDeterministicSearchMode: "bypassed",
    experimentalRetrievalMode: "on_demand",
    repository: {
      mode: "understat",
      sourceName: "Understat fixture",
      async loadPlayers() { return candidates; },
      async searchCandidates(query) {
        assert.equal(query.position, "CM");
        assert.equal(query.positionMatchMode, "family");
        return { players: candidates.slice(query.offset, query.offset + query.limit), totalRecords: candidates.length, offset: query.offset, nextOffset: null, appliedFilters: ["positionFamily"] };
      },
      async inspectCandidateGroup(playerIds, sections) {
        assert.deepEqual(playerIds, candidates.map(({ playerId }) => playerId));
        assert.deepEqual(sections, ["positions"]);
        return research;
      },
    },
    planner: { async decide() { const action = actions.shift(); assert.ok(action, JSON.stringify(events)); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => events.push(event),
  });

  const response = await conversation.turn({ threadId: "understat-cm-position-evidence", message: "为拜仁找一名中前卫，重点比较射门机会质量" });

  assert.equal(response.status, "completed", `${response.message}; ${JSON.stringify(events)}`);
  assert.deepEqual(response.report?.recommendations.map(({ player }) => player.playerId), [candidates[0]!.playerId]);
  assert.deepEqual(response.report?.recommendations[0]?.player.positionEvidence, {
    provider: "understat",
    targetPosition: "CM",
    status: "direct",
    sourceScope: "season_position_aggregate",
    season: "2026",
    sourceCodes: ["MC"],
    sampleMinutes: 900,
  });
  const xgEvidence = response.report?.recommendations[0]?.evidence.find(({ key }) => key === "understatExpectedGoalsPer90");
  assert.equal(xgEvidence?.value, 0.9, "specific-role xG should use the MC row, not the whole MID family");
  assert.match(xgEvidence?.sourceField ?? "", /groups\.position\[2026\]\[MC\]\.xG/);
  assert.equal(xgEvidence?.peerPercentile, null, "season-position aggregate values cannot claim same-competition percentiles");
  assert.equal(xgEvidence?.peerPercentileUnavailableReason, "competition_scope_unreported");
  assert.ok(response.report?.limitations.some((item) => item.includes("位置分组指标未提供赛事范围")));
  assert.ok(response.report?.limitations.some((item) => item.includes("位置标签按赛季与位置分组，未提供赛事拆分")));
  assert.deepEqual(response.report?.positionLeads?.map(({ player, status }) => [player.playerId, status]), [
    [candidates[1]!.playerId, "not_observed"],
    [candidates[2]!.playerId, "not_observed"],
  ]);
  assert.equal(events.some((event) => event.phase === "decision" && event.action === "ask_user"), false);
  const tools = events.filter((event) => event.phase === "tool" && event.ok).map((event) => event.toolName);
  assert.ok(tools.indexOf("inspect_candidate_group") >= 0);
  assert.ok(tools.indexOf("inspect_candidate_group") < tools.indexOf("evaluate_candidates"), tools.join(" → "));
});

test("Understat position investigation follows the exact next-page cursor and never asks to broaden when tags are absent", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const baseCandidates = Array.from({ length: 24 }, (_, index) => understatRoleCandidate(index + 1));
  const candidates = baseCandidates.map((player, index) => ({
    ...player,
    position: "UNKNOWN" as const,
    sourceIdentity: {
      ...player.sourceIdentity!,
      positionGroup: "MID" as const,
      positionGroups: index === 1 ? [] : ["DEF", "MID"] as const,
      sourcePositionLabels: index === 1 ? ["S"] : ["D", "M"],
    },
  }));
  const sourceCodes = candidates.map((_, index) => index === 20 ? "MC" : index === 21 ? "ML" : index % 2 ? "Sub" : "AMC");
  const offsets: number[] = [];
  const inspectedBatches: string[][] = [];
  const actions: RecruitmentAction[] = [
    { action: "search_candidates", targetTeam: "拜仁", position: "CM", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 20 },
    { action: "finish", targetTeam: "拜仁", needSummary: "按当前赛季位置记录比较中前卫候选。", capabilityProfile: ["射门机会质量"], recommendations: [{ playerId: candidates[20]!.playerId, evidenceKeys: ["understatExpectedGoalsPer90"] }], limitationKeys: [] },
    { action: "search_player_reports", targetTeam: "拜仁", query: "中前卫比赛观察", playerNames: [candidates[20]!.name], limit: 4 },
    { action: "finish", targetTeam: "拜仁", needSummary: "按当前赛季位置记录比较中前卫候选。", capabilityProfile: ["射门机会质量"], recommendations: [{ playerId: candidates[20]!.playerId, evidenceKeys: ["understatExpectedGoalsPer90"] }], limitationKeys: [] },
  ];
  const conversation = createRecruitmentConversation({
    experimentalDeterministicSearchMode: "bypassed",
    experimentalRetrievalMode: "on_demand",
    repository: {
      mode: "understat",
      sourceName: "Understat fixture",
      async loadPlayers() { return candidates; },
      async searchCandidates(query) {
        assert.equal(query.positionMatchMode, "family");
        assert.deepEqual(query.catalogPositionGroups, ["DEF", "MID"]);
        assert.equal(query.includeUnknownPosition, true);
        offsets.push(query.offset);
        assert.ok([12, 20].includes(query.limit), "the test should follow the production first-page or bounded follow-up page size");
        const page = candidates.slice(query.offset, query.offset + query.limit);
        return {
          players: page,
          totalRecords: candidates.length,
          offset: query.offset,
          nextOffset: query.offset + page.length < candidates.length ? query.offset + page.length : null,
          appliedFilters: ["positionFamily"],
        };
      },
      async inspectCandidateGroup(playerIds) {
        inspectedBatches.push([...playerIds]);
        return playerIds.map((playerId) => {
          const player = candidates.find(({ playerId: id }) => id === playerId)!;
          return understatRoleResearch(player, sourceCodes[candidates.indexOf(player)]!);
        });
      },
    },
    planner: { async decide() { const action = actions.shift(); assert.ok(action, JSON.stringify(events)); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => events.push(event),
  });

  const response = await conversation.turn({ threadId: "understat-cm-paged-role-evidence", message: "为拜仁找中前卫，重点比较射门机会质量" });

  assert.equal(response.status, "completed", `${response.message}; ${JSON.stringify(events)}`);
  assert.deepEqual(offsets, [0, 20], "the second role-discovery page must use the source's exact next-page cursor");
  assert.deepEqual(inspectedBatches, [
    candidates.slice(0, 12).map(({ playerId }) => playerId),
    candidates.slice(12, 20).map(({ playerId }) => playerId),
    candidates.slice(20).map(({ playerId }) => playerId),
  ]);
  assert.deepEqual(response.report?.recommendations.map(({ player }) => player.playerId), [candidates[20]!.playerId, candidates[21]!.playerId]);
  assert.equal(response.report?.recommendations[0]?.player.positionEvidence?.status, "direct");
  assert.equal(response.report?.recommendations[0]?.understatResearch?.positions?.[0]?.code, "MC");
  assert.equal(response.report?.recommendations[1]?.player.position, "UNKNOWN", "an adjacent source role must not be rewritten as the requested role");
  assert.equal(response.report?.recommendations[1]?.player.positionEvidence?.status, "compatible");
  assert.equal(events.some((event) => event.phase === "decision" && event.action === "ask_user"), false);
});

test("Understat fine-position ablation isolates family recall from current-season position verification", async () => {
  const frozenPlayers = [understatRoleCandidate(1), understatRoleCandidate(2), understatRoleCandidate(3)];
  const frozenCodes = ["MC", "AMC", "Sub"];
  const results: Record<string, { status: string; discovered: number; inspected: number; recommendations: number; askUser: number }> = {};

  for (const arm of ["strict_catalog", "family_only", "family_and_role_verification"] as const) {
    const events: RecruitmentTraceEvent[] = [];
    const actions: RecruitmentAction[] = [
      { action: "search_candidates", targetTeam: "拜仁", position: "CM", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 12 },
      { action: "finish", targetTeam: "拜仁", needSummary: "比较有中前卫位置证据的候选。", capabilityProfile: ["射门机会质量"], recommendations: [{ playerId: frozenPlayers[0]!.playerId, evidenceKeys: ["understatExpectedGoalsPer90"] }], limitationKeys: [] },
    ];
    let inspected = 0;
    const repository: PlayerRepository = {
      mode: "understat",
      sourceName: "Understat frozen fixture",
      async loadPlayers() { return frozenPlayers; },
      async searchCandidates(query) {
        if (arm === "strict_catalog") return { players: [], totalRecords: 0, offset: query.offset, nextOffset: null, appliedFilters: ["position"] };
        return { players: frozenPlayers, totalRecords: frozenPlayers.length, offset: query.offset, nextOffset: null, appliedFilters: ["positionFamily"] };
      },
      ...(arm === "family_and_role_verification" ? {
        async inspectCandidateGroup(playerIds: readonly string[]) {
          inspected += 1;
          return playerIds.map((playerId) => {
            const index = frozenPlayers.findIndex(({ playerId: id }) => id === playerId);
            return understatRoleResearch(frozenPlayers[index]!, frozenCodes[index]!);
          });
        },
      } : {}),
    };
    const conversation = createRecruitmentConversation({
      experimentalDeterministicSearchMode: "bypassed",
      experimentalRetrievalMode: "on_demand",
      repository,
      planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
      knowledgeBase: { async search() { return []; } },
      observer: (event) => events.push(event),
    });
    const response = await conversation.turn({ threadId: `understat-cm-ablation-${arm}`, message: "为拜仁找中前卫，重点比较射门机会质量" });
    results[arm] = {
      status: response.status,
      discovered: events.filter((event) => event.phase === "tool" && event.toolName === "search_candidates" && event.ok)
        .reduce((total, event) => total + (event.resultCount ?? 0), 0),
      inspected,
      recommendations: response.report?.recommendations.length ?? 0,
      askUser: events.filter((event) => event.phase === "decision" && event.action === "ask_user").length,
    };
  }

  assert.deepEqual(results, {
    strict_catalog: { status: "needs_input", discovered: 0, inspected: 0, recommendations: 0, askUser: 1 },
    family_only: { status: "completed", discovered: 3, inspected: 0, recommendations: 0, askUser: 0 },
    family_and_role_verification: { status: "completed", discovered: 3, inspected: 1, recommendations: 1, askUser: 0 },
  }, JSON.stringify(results));
  assert.equal(frozenPlayers.length, 3, "all arms use the same frozen candidate snapshot");
});

test("mosaic recalls broad-role records, verifies Understat details, and leaves ASA coarse positions unconfirmed", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const understatCandidate = understatRoleCandidate(61);
  const asaCandidate: PlayerProfile = {
    ...roleConstraintPlayer("asa-mls-midfielder", "ASA Midfielder", "MID"),
    source: "American Soccer Analysis",
    competition: "MLS",
    season: "2026",
    sourceIdentity: {
      provider: "american-soccer-analysis",
      playerId: "asa-player-61",
      competitionId: "mls",
      seasonId: "2026",
      positionGroup: "MID",
      retrievedAt: "2026-10-16T00:00:00.000Z",
      isCurrentSeason: true,
    },
    supplementaryMetrics: [],
  };
  const actions: RecruitmentAction[] = [
    { action: "search_candidates", targetTeam: "拜仁", position: "CM", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 12 },
    { action: "finish", targetTeam: "拜仁", needSummary: "按细分位置证据评估中前卫候选。", capabilityProfile: ["射门机会质量"], recommendations: [{ playerId: understatCandidate.playerId, evidenceKeys: ["goals"] }], limitationKeys: [] },
  ];
  const repository = new MultiSourceCurrentPlayerRepository({
    understat: {
      mode: "understat",
      sourceName: "Understat fixture",
      async loadPlayers() { return [understatCandidate]; },
      async inspectPlayer(playerId) {
        assert.equal(playerId, understatCandidate.playerId);
        return understatRoleResearch(understatCandidate, "MC");
      },
      async inspectCandidateGroup(playerIds) {
        return playerIds.map((playerId) => understatRoleResearch(understatCandidate, playerId === understatCandidate.playerId ? "MC" : "Sub"));
      },
    },
    asa: { mode: "asa", sourceName: "ASA fixture", async loadMenPlayers() { return [asaCandidate]; } },
  });
  const conversation = createRecruitmentConversation({
    experimentalDeterministicSearchMode: "bypassed",
    experimentalRetrievalMode: "on_demand",
    repository,
    planner: { async decide() { const action = actions.shift(); assert.ok(action, JSON.stringify(events)); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => events.push(event),
  });

  const response = await conversation.turn({ threadId: "mosaic-cm-position-evidence", message: "为拜仁找一名中前卫，重点比较射门机会质量" });

  assert.equal(response.status, "completed", `${response.message}; ${JSON.stringify(events)}`);
  assert.deepEqual(response.report?.recommendations.map(({ player }) => player.playerId), [understatCandidate.playerId]);
  assert.equal(response.report?.recommendations[0]?.player.positionEvidence?.status, "direct");
  assert.ok(response.report?.limitations.some((item) => item.includes("其他来源记录只有宽位置标签")));
  const successfulTools = events.filter((event) => event.phase === "tool" && event.ok).map((event) => event.toolName);
  assert.ok(successfulTools.includes("inspect_player"), successfulTools.join(" → "));
  assert.equal(events.some((event) => event.phase === "decision" && event.action === "ask_user"), false);
});

test("a coarse-only source recalls fine-position leads without treating them as matches or asking to broaden", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const broadMidfielder: PlayerProfile = {
    ...roleConstraintPlayer("statsbomb-mid-1", "Broad Midfielder", "MID"),
    source: "StatsBomb Open Data",
    sourceIdentity: {
      provider: "statsbomb-open-data",
      playerId: "1",
      competitionId: "open-league",
      seasonId: "2025/26",
      positionGroup: "MID",
      sourcePositionLabels: ["MID"],
      retrievedAt: "2026-10-16T00:00:00.000Z",
    },
  };
  const actions: RecruitmentAction[] = [
    { action: "search_candidates", targetTeam: "拜仁", position: "CM", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 12 },
    { action: "finish", targetTeam: "拜仁", needSummary: "按细分位置证据寻找中前卫。", capabilityProfile: ["进球产出"], recommendations: [], limitationKeys: [] },
  ];
  const conversation = createRecruitmentConversation({
    experimentalDeterministicSearchMode: "bypassed",
    experimentalRetrievalMode: "on_demand",
    repository: {
      mode: "statsbomb",
      sourceName: "StatsBomb fixture · 宽位置目录",
      async loadPlayers() { return [broadMidfielder]; },
    },
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer(event) { events.push(event); },
  });

  const response = await conversation.turn({ threadId: "coarse-source-fine-position", message: "为拜仁找一名中前卫，重点看进球产出" });

  assert.equal(response.status, "completed", `${response.message}; ${JSON.stringify(events)}`);
  assert.deepEqual(response.report?.recommendations, [], "a broad MID label is not proof of CM eligibility");
  assert.deepEqual(events.filter((event) => event.phase === "decision" && event.action === "ask_user"), []);
  const report = response.report as (NonNullable<typeof response.report> & {
    positionLeadCount?: number;
    positionLeads?: Array<{ player: PlayerProfile; status: string }>;
  }) | null;
  assert.equal(report?.positionLeadCount, 1);
  assert.deepEqual(report?.positionLeads?.map(({ player, status }) => [player.playerId, status]), [["statsbomb-mid-1", "broad_only"]]);
  assert.ok(events.some((event) => event.phase === "tool" && event.toolName === "search_candidates"
    && event.filters?.positionSearchScope === "family_retrieval"));
});

test("the full graph does not page a source that cannot resolve the requested side-specific position", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const fullbacks = Array.from({ length: 25 }, (_, index) => {
    const playerId = `skillcorner-fullback-${index + 1}`;
    return {
    ...roleConstraintPlayer(playerId, `Broad Fullback ${index + 1}`, "FB"),
    source: "SkillCorner Open Data",
    sourceIdentity: {
      provider: "skillcorner",
      playerId,
      competitionId: "open-league",
      seasonId: "2025/26",
      positionGroup: "Full Back",
      retrievedAt: "2026-10-16T00:00:00.000Z",
    },
    };
  });
  const actions: RecruitmentAction[] = [
    { action: "search_candidates", targetTeam: "拜仁", position: "LB", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 1 },
    { action: "finish", targetTeam: "拜仁", needSummary: "来源只提供全边卫位置线索。", capabilityProfile: ["进球产出"], recommendations: [], limitationKeys: [] },
  ];
  const conversation = createRecruitmentConversation({
    experimentalDeterministicSearchMode: "bypassed",
    experimentalRetrievalMode: "on_demand",
    repository: {
      mode: "skillcorner",
      sourceName: "SkillCorner fixture · 全边卫位置组",
      async loadPlayers() { return fullbacks; },
    },
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer(event) { events.push(event); },
  });

  const response = await conversation.turn({ threadId: "skillcorner-side-role-capability", message: "为拜仁找一名左后卫，重点看进球产出" });

  assert.equal(response.status, "completed", `${response.message}; ${JSON.stringify(events)}`);
  assert.deepEqual(response.report?.recommendations, []);
  const searchEvents = events.filter((event) => event.phase === "tool" && event.toolName === "search_candidates");
  assert.equal(searchEvents.length, 1, "do not consume more pages when this provider only reports Full Back");
  assert.equal(searchEvents[0]?.filters?.offset, 0);
  assert.ok(typeof searchEvents[0]?.filters?.nextOffset === "number", "leave the unconsumed source cursor visible");
  assert.ok(response.report?.positionLeadCount && response.report.positionLeadCount > 0);
  assert.ok(response.report?.positionLeads?.every(({ status }) => status === "broad_only"));
  assert.equal(events.some((event) => event.phase === "decision" && event.action === "ask_user"), false);
});

test("StatsBomb alternate-role evidence qualifies the observed role and discloses the role-specific sample", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const versatileDefender: PlayerProfile = {
    ...roleConstraintPlayer("statsbomb-versatile-1", "Versatile Defender", "LB"),
    source: "StatsBomb Open Data",
    sourceIdentity: {
      provider: "statsbomb-open-data",
      playerId: "1",
      competitionId: "open-league",
      seasonId: "2025/26",
      positionGroups: ["LB", "CB"],
      positionSamples: [{ position: "LB", minutes: 45 }, { position: "CB", minutes: 45 }],
      retrievedAt: "2026-10-16T00:00:00.000Z",
    },
  };
  const actions: RecruitmentAction[] = [
    { action: "search_candidates", targetTeam: "拜仁", position: "CB", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 12 },
    { action: "finish", targetTeam: "拜仁", needSummary: "按 StatsBomb 阵容位置证据评估中后卫。", capabilityProfile: ["进球产出"], recommendations: [{ playerId: versatileDefender.playerId, evidenceKeys: ["goals"] }], limitationKeys: [] },
  ];
  const conversation = createRecruitmentConversation({
    experimentalDeterministicSearchMode: "bypassed",
    experimentalRetrievalMode: "on_demand",
    repository: {
      mode: "statsbomb",
      sourceName: "StatsBomb fixture · 多位置样本",
      async loadPlayers() { return [versatileDefender]; },
    },
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer(event) { events.push(event); },
  });

  const response = await conversation.turn({ threadId: "statsbomb-alternate-position-evidence", message: "为拜仁找中后卫，重点看进球产出" });

  assert.equal(response.status, "completed", `${response.message}; ${JSON.stringify(events)}`);
  assert.deepEqual(response.report?.recommendations.map(({ player }) => player.playerId), [versatileDefender.playerId]);
  assert.equal(response.report?.recommendations[0]?.player.position, "LB", "the record's primary position is not rewritten");
  assert.equal(response.report?.recommendations[0]?.player.positionEvidence?.status, "direct");
  assert.equal(response.report?.recommendations[0]?.player.positionEvidence?.sampleMinutes, 45);
  assert.ok(response.report?.recommendations[0]?.tradeoffs.some((item) => item.includes("45 分钟") && item.includes("不保证只对应这个位置")));
  assert.equal(events.some((event) => event.phase === "decision" && event.action === "ask_user"), false);
});

test("an adjacent Understat role survives as a separate lead when no direct tag is found", async () => {
  const events: RecruitmentTraceEvent[] = [];
  const candidates = [understatRoleCandidate(31), understatRoleCandidate(32)];
  const actions: RecruitmentAction[] = [
    { action: "search_candidates", targetTeam: "拜仁", position: "CM", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 20 },
    { action: "finish", targetTeam: "拜仁", needSummary: "只有相邻中场位置记录，不构成中前卫确认。", capabilityProfile: ["射门机会质量"], recommendations: [], limitationKeys: [] },
    { action: "search_player_reports", targetTeam: "拜仁", query: "相邻位置球员比赛观察", playerNames: [candidates[0]!.name], limit: 4 },
    { action: "finish", targetTeam: "拜仁", needSummary: "只有相邻中场位置记录，不构成中前卫确认。", capabilityProfile: ["射门机会质量"], recommendations: [], limitationKeys: [] },
  ];
  const conversation = createRecruitmentConversation({
    experimentalDeterministicSearchMode: "bypassed",
    experimentalRetrievalMode: "on_demand",
    repository: {
      mode: "understat",
      sourceName: "Understat fixture",
      async loadPlayers() { return candidates; },
      async searchCandidates(query) {
        return { players: candidates, totalRecords: candidates.length, offset: query.offset, nextOffset: null, appliedFilters: ["positionFamily"] };
      },
      async inspectCandidateGroup(playerIds) {
        return playerIds.map((playerId) => {
          const index = candidates.findIndex(({ playerId: id }) => id === playerId);
          return understatRoleResearch(candidates[index]!, index === 0 ? "ML" : "Sub");
        });
      },
    },
    planner: { async decide() { const action = actions.shift(); assert.ok(action); return action; } },
    knowledgeBase: { async search() { return []; } },
    observer: (event) => events.push(event),
  });

  const response = await conversation.turn({ threadId: "understat-cm-adjacent-lead", message: "为拜仁找中前卫，重点比较射门机会质量" });

  assert.equal(response.status, "completed", `${response.message}; ${JSON.stringify(events)}`);
  assert.deepEqual(response.report?.recommendations.map(({ player }) => player.playerId), [candidates[0]!.playerId]);
  assert.equal(response.report?.recommendations[0]?.player.position, "MID");
  assert.equal(response.report?.recommendations[0]?.player.positionEvidence?.status, "compatible");
  assert.equal(events.some((event) => event.phase === "decision" && event.action === "ask_user"), false);
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
          const progress = input.caseProgress as { currentTurnCandidatePages?: unknown[] };
          if (!progress.currentTurnCandidatePages?.length) return {
            action: "search_candidates",
            position: "ST",
            maxAge: null,
            minimumMinutes: 0,
            competition: null,
            season: null,
            offset: 0,
            limit: 20,
          };
          if (mode === "catalog_only") return input.decisionSnapshot.candidates.evaluatedPlayerIds.length
            ? {
              action: "finish",
              targetTeam: "拜仁",
              needSummary: "按相同首轮候选范围比较前锋表现。",
              capabilityProfile: ["进球产出"],
              recommendations: [{ playerId: candidates[0]!.playerId, evidenceKeys: ["goals"] }],
              limitationKeys: [],
            }
            : {
              action: "evaluate_candidates",
              playerIds: candidates.map(({ playerId }) => playerId),
            };
          if (mode === "adaptive" && calledSections.length === 0) return {
            action: "ask_user",
            question: "是否调用 inspect_candidate_group 查看这组候选的位置与历史赛季资料？",
            reason: "这些内部数据可以进一步支持候选比较。",
          };
          if (mode === "adaptive" && calledSections.length === 1 && input.decisionSnapshot.candidates.evaluatedPlayerIds.length) return {
            action: "inspect_player",
            playerId: candidates[0]!.playerId,
            sections: ["shots"],
          };
          if (!input.decisionSnapshot.candidates.evaluatedPlayerIds.length) return {
            action: "evaluate_candidates",
            playerIds: candidates.map(({ playerId }) => playerId),
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

test("Understat reports unavailable fine-grained position evidence without asking to broaden an empty striker search", async () => {
  let plannerCalls = 0;
  const broadForward: PlayerProfile = {
    ...roleConstraintPlayer("broad-forward", "Forward Sample", "ATT"),
    age: null,
    source: "Understat",
    externalPlayerId: "broad-forward-id",
    sourceIdentity: {
      provider: "understat",
      playerId: "EPL:broad-forward-id",
      competitionId: "EPL",
      seasonId: "2026",
      positionGroup: "ATT",
      positionGroups: ["ATT"],
      retrievedAt: "2026-10-16T00:00:00.000Z",
    },
  };
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
  assert.equal(response.status, "completed");
  assert.match(response.message, /当前数据接口无法核验.*中锋/);
  assert.ok(response.report?.limitations.some((limitation) => /细查未返回或尚未核实/.test(limitation)));
  assert.ok(response.report?.limitations.every((limitation) => !/本轮未覆盖全部可检索记录/.test(limitation)), "a missing detail endpoint must not be described as an unread candidate page");
  assert.equal(response.question, null, "source granularity is reported as a limitation, not delegated to the user as a scope decision");
  assert.equal(plannerCalls, 2, "a source limitation must not trigger repeated model calls or unauthorized expansion");
});
