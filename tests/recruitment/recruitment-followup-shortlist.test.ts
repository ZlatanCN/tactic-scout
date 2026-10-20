import assert from "node:assert/strict";
import test, { after } from "node:test";
import type { RecruitmentBrief } from "../../src/recruitment/brief.js";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import { installRecruitmentConversationTestEnvironment, roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

after(installRecruitmentConversationTestEnvironment());

test("shortlist context ablation: a comparison follow-up retains the prior visible candidates", async () => {
  const candidates = [1, 2, 3].map((index) => {
    const player = roleConstraintPlayer(`followup-${index}`, `Candidate ${index}`, "CB");
    return {
      ...player,
      stats: { ...player.stats, keyPasses: index * 3 },
      availableStats: ["keyPasses"],
    };
  });
  const briefFor = (latest: string): RecruitmentBrief => ({
    task: "reinforcement",
    targetTeam: { value: "拜仁", basis: "explicit", quote: "拜仁" },
    referencePlayer: null,
    selectedCandidateId: null,
    positions: ["CB"],
    allowsAnyPosition: false,
    priorities: [{ value: "关键传球", basis: "explicit", quote: latest.includes("关键传球") ? "关键传球" : "" }],
    constraints: [],
    filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null },
    unresolved: [],
  });

  async function run(mode: "bypassed" | "context_only" | "continuity") {
    const plannerInputs: Array<{ history: Array<{ role: string; toolName?: string; content: unknown }> }> = [];
    const visibleCandidates: Array<{ playerId: string; name: string; rank: number }> = [];
    const reviewEvents: unknown[] = [];
    const decisionEvents: Array<Extract<import("../../src/recruitment/conversation.js").RecruitmentTraceEvent, { phase: "decision" }>> = [];
    const toolActions: string[] = [];
    const conversation = createRecruitmentConversation({
      experimentalDeterministicSearchMode: "enabled",
      experimentalRetrievalMode: "on_demand",
      experimentalPreviousShortlistContextMode: mode === "bypassed" ? "bypassed" : "enabled",
      experimentalShortlistComparisonMode: mode === "continuity" ? "enabled" : "bypassed",
      briefInterpreter: { async interpret({ message, visibleCandidates: previousCandidates }) {
        if (message.includes("继续比较这三名候选")) visibleCandidates.push(...(previousCandidates ?? []));
        return briefFor(message);
      } },
      repository: {
        mode: "demo",
        sourceName: "Fixture",
        async loadPlayers() { return candidates; },
        async searchCandidates(query) {
          const players = query.position === "CB" ? candidates : [];
          return { players, offset: query.offset, totalRecords: players.length, nextOffset: null, appliedFilters: ["position"] };
        },
      },
      planner: { async decide(input) {
        plannerInputs.push(input as typeof plannerInputs[number]);
        const isFollowUp = input.history.some((entry) => entry.role === "user" && entry.content.includes("继续比较这三名候选"));
        const priorShortlistWasProvided = input.history.some((entry) => entry.role === "tool" && entry.toolName === "previous_shortlist");
        return {
          action: "finish",
          targetTeam: "拜仁",
          needSummary: "比较中卫的关键传球表现",
          capabilityProfile: ["关键传球"],
          recommendations: isFollowUp
            ? priorShortlistWasProvided
              ? [{ playerId: candidates[2]!.playerId, evidenceKeys: ["keyPasses" as const] }]
              : []
            : candidates.map((player) => ({ playerId: player.playerId, evidenceKeys: ["keyPasses" as const] })),
          limitationKeys: [],
        };
      } },
      knowledgeBase: { async search() { return []; } },
      observer(event) {
        if (event.phase === "review") reviewEvents.push(event);
        if (event.phase === "decision") decisionEvents.push(event);
        if (event.phase === "tool") toolActions.push(event.toolName);
      },
    });
    const threadId = `follow-up-shortlist-${mode}`;
    const first = await conversation.turn({ threadId, message: "为拜仁找中卫，重点比较关键传球" });
    assert.equal(first.status, "completed", first.message);
    assert.deepEqual(first.report?.recommendations.map(({ player }) => player.playerId), candidates.map(({ playerId }) => playerId));
    const second = await conversation.turn({
      threadId,
      message: "保留现在的考察重点，继续比较这三名候选的关键传球表现。",
      expectsExistingState: true,
    });
    assert.equal(second.status, "completed", second.message);
    return { first, second, plannerInputs, visibleCandidates, reviewEvents, decisionEvents, toolActions };
  }

  const continuity = await run("continuity");
  const contextOnly = await run("context_only");
  const control = await run("bypassed");
  const expectedIds = candidates.map(({ playerId }) => playerId);
  const expectedComparisonOrder = [...candidates].reverse().map(({ playerId }) => playerId);
  const continuityFollowUpInput = continuity.plannerInputs.at(-1)!;
  const controlFollowUpInput = control.plannerInputs.at(-1)!;

  assert.deepEqual(continuity.visibleCandidates.map(({ playerId }) => playerId), expectedIds);
  assert.deepEqual(contextOnly.visibleCandidates.map(({ playerId }) => playerId), expectedIds);
  assert.deepEqual(control.visibleCandidates.map(({ playerId }) => playerId), expectedIds);
  assert.deepEqual(continuity.second.report?.recommendations.map(({ player }) => player.playerId), expectedComparisonOrder,
    "the comparison set is ordered only by the shared requested key-pass metric");
  assert.deepEqual(contextOnly.second.report?.recommendations.map(({ player }) => player.playerId), [candidates[2]!.playerId],
    "Planner context alone does not guarantee the full comparison set");
  assert.deepEqual(control.second.report?.recommendations, [], "without prior shortlist context, this fixed planner cannot resolve ‘these three candidates’");
  assert.ok(continuityFollowUpInput.history.some((entry) => entry.role === "tool" && entry.toolName === "previous_shortlist"));
  assert.ok(!controlFollowUpInput.history.some((entry) => entry.role === "tool" && entry.toolName === "previous_shortlist"));
  assert.deepEqual(continuity.toolActions, contextOnly.toolActions, "deterministic shortlist completion adds no data-tool calls");
  assert.deepEqual(continuity.toolActions, control.toolActions, "the ablation does not change data collection");
  assert.ok(continuity.second.report?.needSummary.includes("不是综合能力或转会适配排名"));
  assert.ok(continuity.decisionEvents.some((event) => event.phase === "decision" && event.policyReasonCodes?.includes("shortlist_comparison_handled")));
  assert.ok(control.reviewEvents.some((event) => typeof event === "object" && event !== null && "outcome" in event && event.outcome === "passed"),
    "the previous reviewer accepts an empty shortlist without an exit rationale");
});

test("same-scope report follow-ups reuse the validated brief and preserve the original shortlist", async () => {
  const candidates = [1, 2, 3, 4].map((index) => {
    const candidateBase = roleConstraintPlayer(`same-scope-report-followup-${index}`, `Report Follow-up Candidate ${index}`, "CB");
    return {
      ...candidateBase,
      stats: { ...candidateBase.stats, keyPasses: index * 6 },
      availableStats: ["keyPasses"],
    };
  });
  const brief: RecruitmentBrief = {
    task: "reinforcement",
    targetTeam: { value: "拜仁", basis: "explicit", quote: "拜仁" },
    referencePlayer: null,
    selectedCandidateId: null,
    positions: ["CB"],
    allowsAnyPosition: false,
    priorities: [{ value: "关键传球", basis: "explicit", quote: "重点看关键传球" }],
    constraints: [],
    filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null },
    unresolved: [],
  };
  let briefInterpretations = 0;
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret({ message }) {
      briefInterpretations += 1;
      if (message.includes("直接指标")) throw new Error("Simulated long-context brief validation failure");
      return brief;
    } },
    repository: {
      mode: "demo",
      sourceName: "Fixture",
      async loadPlayers() { return candidates; },
      async searchCandidates(query) {
        return { players: candidates, totalRecords: candidates.length, nextOffset: null, offset: query.offset, appliedFilters: ["position"] };
      },
    },
    planner: { async decide(input) {
      const userTurns = input.history.filter((entry) => entry.role === "user").length;
      const currentTurnHistory = input.history.slice(input.history.map((entry, index) => entry.role === "user" ? index : -1).filter(index => index >= 0).at(-1));
      const currentTools = new Set(currentTurnHistory.filter((entry) => entry.role === "tool").map((entry) => entry.toolName));
      if (userTurns === 1 && !currentTools.has("search_candidates")) {
        return { action: "search_candidates", targetTeam: "拜仁", position: "CB", minimumMinutes: 0, limit: 20 };
      }
      if (userTurns === 1 && !currentTools.has("evaluate_candidates")) {
        return { action: "evaluate_candidates", playerIds: candidates.map(({ playerId }) => playerId) };
      }
      return {
        action: "finish",
        targetTeam: "拜仁",
        needSummary: "按原有中卫需求整理关键传球证据。",
        capabilityProfile: ["关键传球"],
        recommendations: userTurns === 1
          ? candidates.slice(0, 3).map(({ playerId }) => ({ playerId, evidenceKeys: ["keyPasses" as const] }))
          : userTurns >= 4
            ? candidates.map(({ playerId }) => ({ playerId, evidenceKeys: ["keyPasses" as const] }))
            : candidates.slice(0, 1).map(({ playerId }) => ({ playerId, evidenceKeys: ["keyPasses" as const] })),
        limitationKeys: [],
      };
    } },
    knowledgeBase: { async search() { return []; } },
    experimentalReviewerMode: "bypassed",
  });

  const threadId = "same-scope-report-followup";
  const first = await conversation.turn({ threadId, message: "为拜仁找中卫，重点看关键传球" });
  assert.equal(first.status, "completed", first.message);
  assert.equal(first.report?.recommendations.length, 3);

  const followUp = await conversation.turn({
    threadId,
    message: "保持最初完整需求和全部筛选条件，不增不减。请分别说明向前传球与持球推进目前有哪些直接指标，不要把它们混成一个分数。",
    expectsExistingState: true,
  });

  assert.equal(followUp.status, "completed", followUp.message);
  assert.ok(followUp.report, "a same-scope report question must not discard the completed case report");
  assert.deepEqual(
    followUp.report?.recommendations.map(({ player }) => player.playerId),
    first.report?.recommendations.map(({ player }) => player.playerId),
    "a read-only report follow-up must retain the original shortlist even if the Planner returns only a subset",
  );
  assert.deepEqual(followUp.report?.requestedCapabilityCoverage, first.report?.requestedCapabilityCoverage);
  assert.equal(briefInterpretations, 1, "report-only follow-ups should reuse the current validated brief instead of reparsing it");

  const explicitRerank = await conversation.turn({
    threadId,
    message: "请重新排序，优先考虑关键传球表现，不改变位置及筛选条件。",
    expectsExistingState: true,
  });

  assert.equal(explicitRerank.status, "completed", explicitRerank.message);
  assert.equal(explicitRerank.report?.recommendations.length, 1, "an explicit rerank request should allow the Planner to produce a new shortlist");
  assert.equal(briefInterpretations, 2, "an explicit rerank request should be parsed instead of treated as a read-only report follow-up");

  const moreCandidates = await conversation.turn({
    threadId,
    message: "保持原筛选条件不变，再多找几名候选。",
    expectsExistingState: true,
  });

  assert.equal(moreCandidates.status, "completed", moreCandidates.message);
  assert.equal(moreCandidates.report?.recommendations.length, candidates.length,
    "an explicit request to find more candidates should allow the shortlist to expand");
  assert.equal(briefInterpretations, 3,
    "candidate expansion should be parsed as a new investigation request, not a read-only report follow-up");
});

test("shortlist continuation explains candidates without direct evidence for the requested comparison", async () => {
  const candidates = [1, 2, 3].map((index) => {
    const player = roleConstraintPlayer(`missing-metric-${index}`, `Metric Candidate ${index}`, "CB");
    const availableStats = index === 2 ? ["goals"] : ["goals", "keyPasses"];
    return {
      ...player,
      stats: { ...player.stats, goals: index * 2, keyPasses: index * 3 },
      availableStats,
    };
  });
  const conversation = createRecruitmentConversation({
    experimentalDeterministicSearchMode: "enabled",
    experimentalRetrievalMode: "on_demand",
    experimentalPreviousShortlistContextMode: "enabled",
    experimentalShortlistComparisonMode: "enabled",
    briefInterpreter: { async interpret({ message }) {
      const keyPassFocus = message.includes("关键传球");
      return {
        task: "reinforcement",
        targetTeam: { value: "拜仁", basis: "explicit", quote: "拜仁" },
        referencePlayer: null,
        selectedCandidateId: null,
        positions: ["CB"],
        allowsAnyPosition: false,
        priorities: [{ value: keyPassFocus ? "关键传球" : "进球产出", basis: "explicit", quote: keyPassFocus ? "关键传球" : "进球产出" }],
        constraints: [],
        filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null },
        unresolved: [],
      };
    } },
    repository: {
      mode: "demo",
      sourceName: "Fixture",
      async loadPlayers() { return candidates; },
      async searchCandidates(query) {
        const players = query.position === "CB" ? candidates : [];
        return { players, offset: query.offset, totalRecords: players.length, nextOffset: null, appliedFilters: ["position"] };
      },
    },
    planner: { async decide(input) {
      const followUp = input.history.some((entry) => entry.role === "user" && entry.content.includes("继续比较这三名候选"));
      return {
        action: "finish",
        targetTeam: "拜仁",
        needSummary: "按当前请求指标比较短名单",
        capabilityProfile: ["关键传球"],
        recommendations: followUp
          ? [{ playerId: candidates[2]!.playerId, evidenceKeys: ["keyPasses"] }]
          : candidates.map((player) => ({ playerId: player.playerId, evidenceKeys: ["goals"] })),
        limitationKeys: [],
      };
    } },
    knowledgeBase: { async search() { return []; } },
  });

  const threadId = "shortlist-missing-metric";
  const first = await conversation.turn({ threadId, message: "为拜仁找中卫，重点比较进球产出" });
  assert.equal(first.status, "completed", first.message);
  assert.equal(first.report?.recommendations.length, 3);
  const second = await conversation.turn({
    threadId,
    message: "改为重点比较关键传球，继续比较这三名候选。",
    expectsExistingState: true,
  });
  assert.equal(second.status, "completed", second.message);
  assert.deepEqual(second.report?.recommendations.map(({ player }) => player.playerId), [candidates[2]!.playerId, candidates[0]!.playerId]);
  assert.match(second.report?.needSummary ?? "", /另有 1 名缺少本轮请求指标的直接证据/);
  assert.ok(second.report?.recommendations.every(({ focusEvidenceKeys }) => focusEvidenceKeys.includes("keyPasses")));
});
