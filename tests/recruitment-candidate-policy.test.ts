import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerProfile } from "../src/domain/schemas.js";
import { RecruitmentActionSchema } from "../src/agent/recruitment-actions.js";
import type { EvaluatedCandidate } from "../src/agent/recruitment-evidence-evaluator.js";
import type { ConversationHistoryEntry } from "../src/agent/planner-context.js";
import type { KnowledgeSearchResult } from "../src/knowledge/schemas.js";
import { applyRecruitmentCandidatePolicy } from "../src/agent/recruitment-candidate-policy.js";
import { createRecruitmentConversation } from "../src/agent/conversation.js";

const requestedHistory: ConversationHistoryEntry[] = [{
  role: "user",
  content: "为拜仁找一名英超 23 岁以下、至少 900 分钟的中锋，2024/25 赛季",
}];

function player(playerId: string, age: number, position: PlayerProfile["position"]): PlayerProfile {
  return {
    playerId,
    name: `Fixture ${playerId}`,
    team: "Harbor City",
    age,
    position,
    competition: "英超",
    season: "2024/25",
    minutes: 1200,
    stats: {
      goals: 8,
      assists: 2,
      passesAttempted: 200,
      passesCompleted: 140,
      longPasses: 8,
      carries: 30,
      pressures: 80,
      tackles: 3,
      interceptions: 2,
      shotAssists: 5,
      keyPasses: 4,
    },
    source: "Fixed candidate-policy fixture",
  };
}

function evaluated(candidate: PlayerProfile): EvaluatedCandidate {
  return { player: candidate, evidence: [] };
}

function reportResult(entityNames: string[]): KnowledgeSearchResult {
  return {
    id: "report-result",
    documentId: "report-document",
    corpus: "player_report",
    text: "Fixture report excerpt",
    title: "Fixture report",
    url: "https://example.test/report",
    sourceId: "fixture-source",
    sourceName: "Fixture source",
    publisher: "Fixture publisher",
    author: "Fixture author",
    publishedAt: null,
    license: "CC0",
    attribution: "Fixture attribution",
    entityIds: [],
    entityNames,
    competition: null,
    season: null,
    displayAllowed: true,
  };
}

test("candidate search proposals are clamped to explicit user constraints and the case team", () => {
  const candidate = player("eligible-forward", 22, "ST");
  const action = applyRecruitmentCandidatePolicy(RecruitmentActionSchema.parse({
    action: "search_candidates",
    targetTeam: "Borussia Dortmund",
    position: "CB",
    playerName: "Unobserved Name",
    maxAge: 35,
    minimumMinutes: 0,
    competition: "西甲",
    season: "2025/26",
    offset: 5,
    limit: 2,
  }), {
    targetTeam: "Bayern Munich",
    confirmedPosition: "ST",
    history: requestedHistory,
    discoveredPlayers: { [candidate.playerId]: candidate },
    evaluatedPlayers: {},
    retrievedKnowledge: {},
  });

  assert.equal(action.action, "search_candidates");
  if (action.action !== "search_candidates") return;
  assert.equal(action.targetTeam, "Bayern Munich");
  assert.equal(action.position, "ST");
  assert.equal(action.playerName, null);
  assert.equal(action.maxAge, 23);
  assert.equal(action.minimumMinutes, 900);
  assert.equal(action.competition, "英超");
  assert.equal(action.season, "2024/25");
  assert.equal(action.offset, 5);
  assert.equal(action.limit, 20);
});

test("evaluation and finish proposals exclude candidates outside user intent", () => {
  const eligible = player("eligible-forward", 22, "ST");
  const tooOld = player("too-old-forward", 25, "ST");
  const wrongPosition = player("wrong-position", 22, "CB");
  const tooFewMinutes = { ...player("too-few-minutes", 22, "ST"), minutes: 899 };
  const wrongCompetition = { ...player("wrong-competition", 22, "ST"), competition: "西甲" };
  const wrongSeason = { ...player("wrong-season", 22, "ST"), season: "2025/26" };
  const state = {
    targetTeam: "Bayern Munich",
    confirmedPosition: "ST",
    history: requestedHistory,
    discoveredPlayers: {
      [eligible.playerId]: eligible,
      [tooOld.playerId]: tooOld,
      [wrongPosition.playerId]: wrongPosition,
      [tooFewMinutes.playerId]: tooFewMinutes,
      [wrongCompetition.playerId]: wrongCompetition,
      [wrongSeason.playerId]: wrongSeason,
    },
    evaluatedPlayers: {
      [tooOld.playerId]: evaluated(tooOld),
      [wrongPosition.playerId]: evaluated(wrongPosition),
      [tooFewMinutes.playerId]: evaluated(tooFewMinutes),
      [wrongCompetition.playerId]: evaluated(wrongCompetition),
      [wrongSeason.playerId]: evaluated(wrongSeason),
    },
    retrievedKnowledge: {},
  };

  const evaluation = applyRecruitmentCandidatePolicy(RecruitmentActionSchema.parse({
    action: "evaluate_candidates",
    targetTeam: "Other Club",
    playerIds: [eligible.playerId, tooOld.playerId, wrongPosition.playerId, tooFewMinutes.playerId, wrongCompetition.playerId, wrongSeason.playerId],
  }), state);
  assert.equal(evaluation.action, "evaluate_candidates");
  if (evaluation.action !== "evaluate_candidates") return;
  assert.equal(evaluation.targetTeam, "Bayern Munich");
  assert.deepEqual(evaluation.playerIds, [eligible.playerId]);

  const duplicateEvaluation = applyRecruitmentCandidatePolicy(RecruitmentActionSchema.parse({
    action: "evaluate_candidates",
    playerIds: [eligible.playerId, "not-discovered"],
  }), {
    ...state,
    evaluatedPlayers: { [eligible.playerId]: evaluated(eligible) },
  });
  assert.equal(duplicateEvaluation.action, "evaluate_candidates");
  if (duplicateEvaluation.action !== "evaluate_candidates") return;
  assert.deepEqual(duplicateEvaluation.playerIds, [eligible.playerId]);

  const unsupportedEvaluation = applyRecruitmentCandidatePolicy(RecruitmentActionSchema.parse({
    action: "evaluate_candidates",
    playerIds: ["not-discovered"],
  }), state);
  assert.equal(unsupportedEvaluation.action, "search_candidates");
  if (unsupportedEvaluation.action !== "search_candidates") return;
  assert.equal(unsupportedEvaluation.targetTeam, "Bayern Munich");
  assert.equal(unsupportedEvaluation.position, "ST");
  assert.equal(unsupportedEvaluation.maxAge, 23);
  assert.equal(unsupportedEvaluation.minimumMinutes, 900);
  assert.equal(unsupportedEvaluation.competition, "英超");
  assert.equal(unsupportedEvaluation.season, "2024/25");
  assert.equal(unsupportedEvaluation.playerName, null);

  const finish = applyRecruitmentCandidatePolicy(RecruitmentActionSchema.parse({
    action: "finish",
    targetTeam: "Other Club",
    needSummary: "Fixture conclusion",
    capabilityProfile: ["进球产出"],
    recommendations: [
      { playerId: eligible.playerId, evidenceKeys: ["goals"] },
      { playerId: tooOld.playerId, evidenceKeys: ["goals"] },
      { playerId: tooFewMinutes.playerId, evidenceKeys: ["goals"] },
      { playerId: wrongCompetition.playerId, evidenceKeys: ["goals"] },
      { playerId: wrongSeason.playerId, evidenceKeys: ["goals"] },
    ],
    limitationKeys: ["other"],
    reportObservations: [
      { playerId: eligible.playerId, documentId: "report-1", summary: "Observed", linkedMetricKeys: [] },
      { playerId: tooOld.playerId, documentId: "report-2", summary: "Out of scope", linkedMetricKeys: [] },
      { playerId: tooFewMinutes.playerId, documentId: "report-3", summary: "Out of scope", linkedMetricKeys: [] },
      { playerId: wrongCompetition.playerId, documentId: "report-4", summary: "Out of scope", linkedMetricKeys: [] },
      { playerId: wrongSeason.playerId, documentId: "report-5", summary: "Out of scope", linkedMetricKeys: [] },
    ],
  }), {
    ...state,
    evaluatedPlayers: {
      [eligible.playerId]: evaluated(eligible),
      [tooOld.playerId]: evaluated(tooOld),
      [wrongPosition.playerId]: evaluated(wrongPosition),
      [tooFewMinutes.playerId]: evaluated(tooFewMinutes),
      [wrongCompetition.playerId]: evaluated(wrongCompetition),
      [wrongSeason.playerId]: evaluated(wrongSeason),
    },
  });
  assert.equal(finish.action, "finish");
  if (finish.action !== "finish") return;
  assert.equal(finish.targetTeam, "Bayern Munich");
  assert.deepEqual(finish.recommendations.map(({ playerId }) => playerId), [eligible.playerId]);
  assert.deepEqual(finish.reportObservations.map(({ playerId }) => playerId), [eligible.playerId]);
});

test("a named candidate search requires a matching retrieved report entity", () => {
  const base = {
    targetTeam: "Bayern Munich",
    confirmedPosition: null,
    history: [{ role: "user" as const, content: "为拜仁寻找凯恩替代者" }],
    discoveredPlayers: {},
    evaluatedPlayers: {},
  };
  const proposed = RecruitmentActionSchema.parse({
    action: "search_candidates",
    playerName: "Kylian Mbappé",
    position: "ST",
    minimumMinutes: 0,
    limit: 5,
  });
  const withoutReport = applyRecruitmentCandidatePolicy(proposed, { ...base, retrievedKnowledge: {} });
  assert.equal(withoutReport.action, "search_candidates");
  if (withoutReport.action !== "search_candidates") return;
  assert.equal(withoutReport.playerName, null);

  const withReport = applyRecruitmentCandidatePolicy(proposed, {
    ...base,
    retrievedKnowledge: { excerpt: reportResult(["Kylian Mbappé"]) },
  });
  assert.equal(withReport.action, "search_candidates");
  if (withReport.action !== "search_candidates") return;
  assert.equal(withReport.playerName, "Kylian Mbappé");
});

test("the full LangGraph clamps an adversarial proposal before query, evaluation, and report", async () => {
  const candidate = player("eligible-forward", 22, "ST");
  const tooFewMinutes = { ...player("too-few-minutes", 22, "ST"), minutes: 800 };
  const wrongCompetition = { ...player("wrong-competition", 22, "ST"), competition: "西甲" };
  const wrongSeason = { ...player("wrong-season", 22, "ST"), season: "2025/26" };
  const repositoryRecords = [candidate, tooFewMinutes, wrongCompetition, wrongSeason];
  const candidateQueries: Array<{ position: string | null; maxAge: number | null; minimumMinutes: number; competition: string | null; season: string | null }> = [];
  const evaluatorReads: string[][] = [];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "Fixed candidate-policy fixture",
      async searchCandidates(query) {
        candidateQueries.push({
          position: query.position,
          maxAge: query.maxAge,
          minimumMinutes: query.minimumMinutes,
          competition: query.competition,
          season: query.season,
        });
        const players = query.minimumMinutes >= 900 && query.competition === "英超" && query.season === "2024/25"
          ? [candidate]
          : repositoryRecords;
        return {
          players,
          totalRecords: players.length,
          offset: query.offset,
          nextOffset: null,
          appliedFilters: ["position", "maxAge", "minimumMinutes", "competition", "season"],
        };
      },
      async getPlayersByIds(playerIds) {
        evaluatorReads.push([...playerIds]);
        return repositoryRecords.filter(({ playerId }) => playerIds.includes(playerId));
      },
      async getComparisonPlayers() { return repositoryRecords; },
    },
    planner: {
      async decide(input) {
        const latestUserIndex = input.history.map((entry) => entry.role === "user").lastIndexOf(true);
        const turnHistory = input.history.slice(latestUserIndex + 1);
        const tools = new Set(turnHistory.filter((entry) => entry.role === "tool").map((entry) => entry.toolName));
        const hasFilterClarification = input.history.some((entry) => entry.role === "user" && entry.content.includes("至少 900 分钟"));
        const hasClearedFilters = input.history.some((entry) => entry.role === "user" && entry.content.includes("年龄不限"));
        if (!tools.has("search_methodology")) return { action: "search_methodology", query: "中锋的可观察比赛能力证据" };
        if (!tools.has("search_candidates") && !hasClearedFilters) {
          return { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 20 };
        }
        if (!tools.has("evaluate_candidates") && !hasFilterClarification) {
          return { action: "evaluate_candidates", playerIds: repositoryRecords.map(({ playerId }) => playerId) };
        }
        if (!tools.has("search_player_reports")) {
          return {
            action: "search_player_reports",
            query: "候选人的球探报告",
            playerNames: repositoryRecords.map(({ name }) => name),
            limit: 4,
          };
        }
        return {
          action: "finish",
          targetTeam: "Other Club",
          needSummary: "寻找符合确认范围的中锋候选。",
          capabilityProfile: ["进球产出"],
          recommendations: repositoryRecords.map(({ playerId }) => ({ playerId, evidenceKeys: ["goals"] })),
          limitationKeys: ["other"],
        };
      },
    },
    knowledgeBase: { async search() { return []; } },
  });

  const initialResponse = await conversation.turn({
    threadId: "candidate-policy-adversarial-full-graph",
    message: "为拜仁找一名中锋",
  });

  assert.equal(initialResponse.status, "completed");
  assert.deepEqual(initialResponse.report?.recommendations.map(({ player }) => player.playerId), repositoryRecords.map(({ playerId }) => playerId));

  const clarifiedResponse = await conversation.turn({
    threadId: "candidate-policy-adversarial-full-graph",
    message: "补充：只考虑英超、至少 900 分钟，2024/25 赛季",
  });

  assert.equal(clarifiedResponse.status, "completed");

  const resetResponse = await conversation.turn({
    threadId: "candidate-policy-adversarial-full-graph",
    message: "年龄不限，最低出场分钟不限，联赛不限，赛季不限",
  });

  assert.equal(resetResponse.status, "completed");
  assert.deepEqual(candidateQueries, [
    { position: "ST", maxAge: null, minimumMinutes: 0, competition: null, season: null },
    { position: "ST", maxAge: null, minimumMinutes: 900, competition: "英超", season: "2024/25" },
    { position: "ST", maxAge: null, minimumMinutes: 0, competition: null, season: null },
  ]);
  assert.deepEqual(evaluatorReads, [repositoryRecords.map(({ playerId }) => playerId)]);
  assert.equal(clarifiedResponse.report?.targetTeam, "拜仁");
  assert.deepEqual(clarifiedResponse.report?.recommendations.map(({ player }) => player.playerId), [candidate.playerId]);
  assert.deepEqual(resetResponse.report?.recommendations.map(({ player }) => player.playerId), repositoryRecords.map(({ playerId }) => playerId));
});

test("the full LangGraph re-queries a changed broad-position scope before accepting a finish action", async () => {
  const eligible = player("eligible-forward", 22, "ST");
  const tooOld = player("too-old-forward", 25, "ST");
  const tooFewMinutes = { ...player("too-few-minutes", 22, "ST"), minutes: 800 };
  const repositoryRecords = [eligible, tooOld, tooFewMinutes];
  const candidateQueries: Array<{ position: string | null; maxAge: number | null; minimumMinutes: number; competition: string | null; season: string | null }> = [];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "Fixed broad-position intent fixture",
      async searchCandidates(query) {
        candidateQueries.push({
          position: query.position,
          maxAge: query.maxAge,
          minimumMinutes: query.minimumMinutes,
          competition: query.competition,
          season: query.season,
        });
        const players = query.maxAge === 23 && query.minimumMinutes === 900
          ? [eligible]
          : repositoryRecords;
        return {
          players,
          totalRecords: players.length,
          offset: query.offset,
          nextOffset: null,
          appliedFilters: ["position", "maxAge", "minimumMinutes"],
        };
      },
      async getPlayersByIds(playerIds) {
        return repositoryRecords.filter(({ playerId }) => playerIds.includes(playerId));
      },
      async getComparisonPlayers() { return repositoryRecords; },
    },
    planner: {
      async decide(input) {
        const latestUserIndex = input.history.map((entry) => entry.role === "user").lastIndexOf(true);
        const turnHistory = input.history.slice(latestUserIndex + 1);
        const tools = new Set(turnHistory.filter((entry) => entry.role === "tool").map((entry) => entry.toolName));
        const clarifiedScope = input.history.some((entry) => entry.role === "user" && entry.content.includes("23 岁以下"));
        if (!tools.has("search_methodology")) return { action: "search_methodology", query: "前锋的可观察比赛能力证据" };
        if (clarifiedScope) {
          return {
            action: "finish",
            targetTeam: "Other Club",
            needSummary: "寻找符合年龄和出场时间要求的前锋。",
            capabilityProfile: ["进球产出"],
            recommendations: [],
            limitationKeys: ["other"],
          };
        }
        if (!tools.has("search_candidates")) return { action: "search_candidates", position: null, minimumMinutes: 0, limit: 20 };
        if (!tools.has("search_player_reports")) {
          return { action: "search_player_reports", query: "候选人的球探报告", playerNames: repositoryRecords.map(({ name }) => name), limit: 4 };
        }
        return {
          action: "finish",
          targetTeam: "Other Club",
          needSummary: "寻找一名新的前锋。",
          capabilityProfile: ["进球产出"],
          recommendations: [],
          limitationKeys: ["other"],
        };
      },
    },
    knowledgeBase: { async search() { return []; } },
  });

  const initialResponse = await conversation.turn({
    threadId: "broad-position-scope-refresh",
    message: "为拜仁寻找一名前锋",
  });
  const clarifiedResponse = await conversation.turn({
    threadId: "broad-position-scope-refresh",
    message: "补充：只考虑 23 岁以下，至少 900 分钟",
  });

  assert.equal(initialResponse.status, "completed");
  assert.equal(clarifiedResponse.status, "completed");
  assert.deepEqual(candidateQueries, [
    { position: "ATT", maxAge: null, minimumMinutes: 0, competition: null, season: null },
    { position: "ATT", maxAge: 23, minimumMinutes: 900, competition: null, season: null },
  ]);
});

test("the full LangGraph preserves negated age limits and re-queries a later positive league choice", async () => {
  const premierLeagueCandidate = player("premier-league-candidate", 22, "ST");
  const bundesligaCandidate = { ...player("bundesliga-candidate", 22, "ST"), competition: "德甲" };
  const overAgeBundesligaCandidate = { ...player("over-age-bundesliga-candidate", 25, "ST"), competition: "德甲" };
  const records = [premierLeagueCandidate, bundesligaCandidate, overAgeBundesligaCandidate];
  const candidateQueries: Array<{ position: string | null; maxAge: number | null; minimumMinutes: number; competition: string | null; season: string | null }> = [];
  const evaluatorReads: string[][] = [];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "Fixed league-switch fixture",
      async searchCandidates(query) {
        candidateQueries.push({
          position: query.position,
          maxAge: query.maxAge,
          minimumMinutes: query.minimumMinutes,
          competition: query.competition,
          season: query.season,
        });
        const players = query.competition === "德甲" ? [bundesligaCandidate] : [premierLeagueCandidate];
        return {
          players,
          totalRecords: players.length,
          offset: query.offset,
          nextOffset: null,
          appliedFilters: ["position", "maxAge", "competition"],
        };
      },
      async getPlayersByIds(playerIds) {
        evaluatorReads.push([...playerIds]);
        return records.filter(({ playerId }) => playerIds.includes(playerId));
      },
      async getComparisonPlayers() { return records; },
    },
    planner: {
      async decide(input) {
        const latestUserIndex = input.history.map((entry) => entry.role === "user").lastIndexOf(true);
        const turnHistory = input.history.slice(latestUserIndex + 1);
        const tools = new Set(turnHistory.filter((entry) => entry.role === "tool").map((entry) => entry.toolName));
        if (!tools.has("search_methodology")) return { action: "search_methodology", query: "中锋的可观察比赛能力证据" };
        if (!tools.has("search_candidates")) {
          return { action: "search_candidates", position: "CB", maxAge: null, competition: "英超", limit: 20 };
        }
        if (!tools.has("evaluate_candidates")) {
          return { action: "evaluate_candidates", playerIds: records.map(({ playerId }) => playerId) };
        }
        return {
          action: "finish",
          targetTeam: "Other Club",
          needSummary: "寻找符合条件的中锋候选。",
          capabilityProfile: ["进球产出"],
          recommendations: records.map(({ playerId }) => ({ playerId, evidenceKeys: ["goals"] })),
          limitationKeys: ["other"],
        };
      },
    },
    knowledgeBase: { async search() { return []; } },
  });

  const initialResponse = await conversation.turn({
    threadId: "negated-age-league-switch",
    message: "为拜仁找 23 岁以下的英超中锋",
  });
  const updatedResponse = await conversation.turn({
    threadId: "negated-age-league-switch",
    message: "不想取消年龄限制，不是英超，改看德甲",
  });
  const finalResponse = await conversation.turn({
    threadId: "negated-age-league-switch",
    message: "只看英超，不要德甲",
  });

  assert.equal(initialResponse.status, "completed");
  assert.equal(updatedResponse.status, "completed");
  assert.equal(finalResponse.status, "completed");
  assert.deepEqual(candidateQueries, [
    { position: "ST", maxAge: 23, minimumMinutes: 0, competition: "英超", season: null },
    { position: "ST", maxAge: 23, minimumMinutes: 0, competition: "德甲", season: null },
    { position: "ST", maxAge: 23, minimumMinutes: 0, competition: "英超", season: null },
  ]);
  assert.deepEqual(evaluatorReads, [
    [premierLeagueCandidate.playerId],
    [bundesligaCandidate.playerId],
  ]);
  assert.deepEqual(updatedResponse.report?.recommendations.map(({ player }) => player.playerId), [bundesligaCandidate.playerId]);
});
