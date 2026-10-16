import assert from "node:assert/strict";
import test from "node:test";
import { configuredRecruitmentConversation, createRecruitmentConversation, type RecruitmentPlanner } from "../src/agent/conversation.js";
import { createSinglePassInvestigationPlanner } from "../src/evals/fixed-investigation-planner.js";
import { createCandidateComparison, createReferenceComparisonNotes, createReferencePlayerProfiles, resolveReplacementReferencePosition } from "../src/agent/recruitment-comparison.js";
import type { PlayerProfile } from "../src/domain/schemas.js";

const player = (id: string, name: string, goals: number): PlayerProfile => ({
  playerId: id, name, team: "Bayern Munich", age: null, position: "ST", competition: "德甲", season: "2026/27", minutes: 450,
  stats: { goals, assists: 2, passesAttempted: 0, passesCompleted: 0, longPasses: 0, carries: 0, pressures: 0, tackles: 0, interceptions: 0, shotAssists: 0 },
  availableStats: ["goals", "assists"], source: "Fixture",
});
const reference = player("reference", "Harry Kane", 5);
const candidates = [player("a", "Candidate A", 4), player("b", "Candidate B", 2)];

test("reference profile retains explicit zero but does not invent unavailable metrics", () => {
  const profile = createReferencePlayerProfiles([{ ...reference, stats: { ...reference.stats, assists: 0 } }], ["为拜仁寻找凯恩的替代者"])[0]!;
  assert.equal(profile.metrics.assists, 0);
  assert.equal(profile.metrics.goals, 1);
  assert.equal(profile.metrics.pressures, undefined);
});

test("reference position resolution uses exact player identity and the roster's observed role", () => {
  const reference = { ...player("reference-keeper", "Alex Keeper", 0), position: "GK" as const };
  const profilePosition = resolveReplacementReferencePosition({
    players: [reference],
    rosterContext: null,
    userMessages: ["Find Bayern a replacement for Alex Keeper"],
  });
  const rosterPosition = resolveReplacementReferencePosition({
    players: [],
    rosterContext: {
      status: "available",
      requestedTeam: "Bayern Munich",
      matchedTeams: [],
      team: null,
      players: [{ id: "keeper-1", name: "Alex Keeper", position: "Goalkeeper", url: "https://example.test/players/keeper-1" }],
      returnedCount: 1,
      resultLimit: 100,
      possiblyTruncated: false,
      retrievedAt: null,
      sourceUrl: "https://example.test",
      failureKind: null,
      notice: "Fixture roster",
    },
    userMessages: ["Find Bayern a replacement for Alex Keeper"],
  });

  assert.equal(profilePosition, "GK");
  assert.equal(rosterPosition, "GK");
});

test("reference comparisons require the same observed scope and a shared metric", () => {
  const profile = createReferencePlayerProfiles([reference], ["为拜仁寻找凯恩的替代者"])[0]!;
  const candidate = {
    player: candidates[0]!,
    evidence: [{ key: "goals" as const, label: "进球", value: 0.8, unit: "次/90", peerPercentile: null,
      peerGroupSize: 0, minutes: 450, competition: "德甲", season: "2026/27", source: "Fixture" }],
  };

  assert.equal(createReferenceComparisonNotes(candidate, [profile], ["goals"]).length, 1);
  assert.deepEqual(createReferenceComparisonNotes(candidate, [{ ...profile, season: "2025/26" }], ["goals"]), []);
  assert.deepEqual(createReferenceComparisonNotes(candidate, [{ ...profile, metrics: { assists: 0 } }], ["goals"]), []);
});

test("season-position aggregates remain visible but are excluded from reference and candidate ranges", () => {
  const evidence = {
    key: "understatExpectedGoalsPer90" as const,
    label: "Understat xG /90",
    value: 0.9,
    unit: "xG/90分钟",
    peerPercentile: null,
    peerGroupSize: 0,
    peerPercentileUnavailableReason: "competition_scope_unreported" as const,
    minutes: 1500,
    competition: "德甲",
    season: "2026/27",
    source: "Understat",
    sourceScope: "season_position_aggregate" as const,
    sourceField: "groups.position[2026][FW].xG",
  };
  const first = { player: candidates[0]!, evidence: [evidence] };
  const second = { player: candidates[1]!, evidence: [{ ...evidence, value: 1.2 }] };
  const profile = createReferencePlayerProfiles([{ ...reference, supplementaryMetrics: [{
    key: "understatExpectedGoalsPer90",
    definition: "fixture",
    value: 0.7,
    unit: "xG/90分钟",
    normalization: "per90",
    sourceField: "groups.position[2026][FW].xG",
    sampleMinutes: 1500,
    sampleMatches: 10,
  }] }], ["为拜仁寻找凯恩的替代者"])[0]!;

  assert.deepEqual(createReferenceComparisonNotes(first, [profile], [evidence.key]), []);
  const comparisons = createCandidateComparison([first, second], [evidence.key]);
  assert.ok(comparisons.every(({ comparisons: rows }) => rows.every((row) => (
    row.comparedCandidateCount === 0
      && row.observedMinimum === undefined
      && row.observedMaximum === undefined
  ))));
});

for (const arm of ["enabled", "reference-off", "comparison-off"] as const) {
  test(`complete graph independently projects reference and candidate comparison evidence: ${arm}`, async () => {
    const inputs: Array<Parameters<RecruitmentPlanner["decide"]>[0]> = [];
    const conversation = createRecruitmentConversation({
      repository: { mode: "demo", sourceName: "Fixture", loadPlayers: async () => [reference, ...candidates] },
      experimentalReferenceProfileMode: arm === "reference-off" ? "bypassed" : "enabled",
      experimentalCandidateComparisonMode: arm === "comparison-off" ? "bypassed" : "enabled",
      planner: createSinglePassInvestigationPlanner({ async decide(input) {
        inputs.push(input);
        return { action: "finish", targetTeam: "拜仁", needSummary: "比较已读取的进球产出，能力仍需复核", capabilityProfile: ["进球产出"], recommendations: candidates.map(candidate => ({ playerId: candidate.playerId, evidenceKeys: ["goals"] })), limitationKeys: [] };
      } }),
      knowledgeBase: { search: async () => [] },
    });
    const result = await conversation.turn({ threadId: arm, message: "为拜仁寻找凯恩的替代者，重点看进球产出" });
    assert.equal(result.status, "completed");
    assert.equal(result.report?.recommendations.length, 2);
    assert.ok(result.report?.recommendations.every(item => item.player.playerId !== reference.playerId));
    assert.equal(result.report?.referenceProfiles.length, arm === "reference-off" ? 0 : 1);
    const referenceGoals = result.report?.referenceProfiles[0]?.metrics.find(metric => metric.key === "goals");
    if (arm === "reference-off") assert.equal(referenceGoals, undefined);
    else assert.equal(referenceGoals?.value, 1);
    const input = inputs.at(-1)!;
    assert.equal(Object.hasOwn(input, "referenceProfiles"), false);
    assert.equal(Object.hasOwn(input, "candidateComparison"), false);
    const teamInspection = input.history.find(entry => entry.role === "tool" && entry.toolName === "inspect_team");
    assert.ok(teamInspection);
    assert.doesNotMatch(teamInspection.content, /referenceProfiles/);
    assert.equal(result.report?.recommendations[0]?.comparisonNotes.length, arm === "comparison-off" ? 0 : 1);
    assert.equal(result.report?.recommendations[0]?.referenceComparisonNotes.length, arm === "reference-off" ? 0 : 1);
    if (arm !== "reference-off") assert.match(result.report?.recommendations[0]?.referenceComparisonNotes[0] ?? "", /Harry Kane 1 次\/90/);
  });
}

test("review recovery retains a valid candidate when a repeated invalid evidence reference is exhausted", async () => {
  let calls = 0;
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Fixture", loadPlayers: async () => candidates },
    planner: createSinglePassInvestigationPlanner({ async decide() {
      calls++;
      return { action: "finish", targetTeam: "拜仁", needSummary: "寻找中锋", capabilityProfile: [], recommendations: [
        { playerId: "a", evidenceKeys: ["goals"] }, { playerId: "b", evidenceKeys: ["pressures"] },
      ], limitationKeys: [] };
    } }),
    knowledgeBase: { search: async () => [] },
  });
  const result = await conversation.turn({ threadId: "targeted-review-recovery", message: "为拜仁找一个中锋" });
  assert.equal(result.status, "completed");
  assert.equal(calls, 2, "one repair attempt only");
  assert.deepEqual(result.report?.recommendations.map(item => item.player.playerId), ["a"]);
  assert.match(result.report?.needSummary ?? "", /保留 1 名/);
});

test("on-demand retrieval skips unnecessary RAG and search planning for a measurable need", async () => {
  const tools: string[] = [];
  let plannerCalls = 0;
  let retrievalCalls = 0;
  const conversation = createRecruitmentConversation({
    experimentalRetrievalMode: "on_demand",
    experimentalDeterministicSearchMode: "enabled",
    repository: { mode: "demo", sourceName: "Fixture", loadPlayers: async () => candidates },
    planner: { async decide(input) {
      plannerCalls++;
      assert.notEqual(input.decisionMode, "investigate");
      return { action: "finish", targetTeam: "拜仁", needSummary: "依据进球产出保留候选", capabilityProfile: ["进球产出"], recommendations: [{ playerId: "a", evidenceKeys: ["goals"] }], limitationKeys: [] };
    } },
    knowledgeBase: { search: async () => { retrievalCalls++; return []; } },
    observer: event => { if (event.phase === "tool") tools.push(event.toolName); },
  });
  const result = await conversation.turn({ threadId: "on-demand-measurable", message: "为拜仁找一个中锋，重点看进球产出" });
  assert.equal(result.status, "completed");
  assert.deepEqual(tools, ["search_candidates", "evaluate_candidates"]);
  assert.equal(plannerCalls, 1);
  assert.equal(retrievalCalls, 0);
  assert.equal(result.report?.knowledgeCoverage.playerReportSearchPerformed, false);
  assert.equal(result.report?.recommendations[0]?.player.playerId, "a");
});

test("on-demand RAG performs one bounded qualitative lookup for unobservable capabilities", async () => {
  const corpora: string[] = [];
  const conversation = createRecruitmentConversation({
    experimentalRetrievalMode: "on_demand", experimentalDeterministicSearchMode: "enabled",
    repository: { mode: "demo", sourceName: "Fixture", loadPlayers: async () => candidates },
    planner: createSinglePassInvestigationPlanner({ async decide() {
      return { action: "finish", targetTeam: "拜仁", needSummary: "接应和射术仍需核实", capabilityProfile: ["接应", "终结"], recommendations: [{ playerId: "a", evidenceKeys: ["goals"] }], limitationKeys: [] };
    } }),
    knowledgeBase: { search: async input => { corpora.push(input.corpus); return []; } },
  });
  const result = await conversation.turn({ threadId: "on-demand-unknown-capabilities", message: "为拜仁找前锋，重点看接应和终结" });
  assert.equal(result.status, "completed");
  assert.deepEqual(corpora, ["methodology", "player_report"]);
  assert.equal(result.report?.knowledgeCoverage.playerReportSearchPerformed, true);
  assert.ok(result.report?.recommendations[0]?.tradeoffs.some(item => item.includes("尚未") || item.includes("缺少")));
});

 test("configured production conversation uses on-demand retrieval and deterministic first search", async () => {
  let calls = 0;
  let searches = 0;
  const conversation = configuredRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Fixture", loadPlayers: async () => candidates },
    knowledgeBase: { search: async () => { searches++; return []; } },
    plannerFactory: () => ({ async decide(input) {
      calls++;
      assert.notEqual(input.decisionMode, "investigate");
      return { action: "finish", targetTeam: "拜仁", needSummary: "依据产出比较", capabilityProfile: ["进球产出"], recommendations: [{ playerId: "a", evidenceKeys: ["goals"] }], limitationKeys: [] };
    } }),
  });
  const result = await conversation.turn({ threadId: "production-default-policy", message: "为拜仁找中锋，重点看进球产出" });
  assert.equal(result.status, "completed");
  assert.equal(calls, 1);
  assert.equal(searches, 0);
  assert.equal(result.report?.recommendations.length, 1);
});

test("report projection does not expose a model placeholder as the need summary", async () => {
  const conversation = configuredRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Fixture", loadPlayers: async () => candidates },
    plannerFactory: () => ({ async decide() {
      return { action: "finish", targetTeam: "拜仁", needSummary: "false", capabilityProfile: ["进球产出"], recommendations: [{ playerId: "a", evidenceKeys: ["goals"] }], limitationKeys: [] };
    } }),
  });
  const request = "为拜仁找中锋，重点看进球产出";
  const result = await conversation.turn({ threadId: "placeholder-summary", message: request });

  assert.equal(result.status, "completed");
  assert.match(result.report?.needSummary ?? "", /为拜仁找中锋/);
  assert.doesNotMatch(result.report?.needSummary ?? "", /^(false|null|undefined)$/i);
});
