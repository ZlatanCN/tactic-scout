import assert from "node:assert/strict";
import test from "node:test";
import { emptyToolUseCounts, toolBudgets } from "../../src/recruitment/recruitment-actions.js";
import type { RecruitmentTraceEvent } from "../../src/recruitment/conversation/contracts.js";
import { availablePlannerActions } from "../../src/recruitment/conversation/planning-policy.js";
import { buildPlanningSnapshot } from "../../src/recruitment/conversation/planning-snapshot.js";
import type { CandidateSearchObservation, State } from "../../src/recruitment/conversation/state.js";
import type { PlayerProfile } from "../../src/domain/players.js";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import { installRecruitmentConversationTestEnvironment, roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

function plannerState(overrides: Partial<State> = {}): State {
  return {
    userMessage: "Find a young forward",
    history: [
      { role: "user", content: "Find a defender" },
      { role: "assistant", content: "Which defensive role matters most?" },
    ],
    brief: null,
    targetTeam: "Bayern",
    confirmedPosition: "ST",
    confirmedPositions: ["ST"],
    positionBroadeningApproved: false,
    confirmedPositionSearchObservationIndex: null,
    pendingQuestion: null,
    discoveredPlayers: {},
    evaluatedPlayers: {},
    candidateIdentityGroups: [],
    retrievedKnowledge: {},
    searchedReportPlayerNames: [],
    hasSearchedPlayerReports: false,
    hasSearchedMethodology: false,
    policyBlocked: false,
    policyBlockedRepeatCount: 0,
    toolUses: emptyToolUseCounts(),
    candidateSearchTurnStartIndex: 0,
    candidateSearchObservations: [],
    ...overrides,
  } as unknown as State;
}

function page(nextOffset: number | null, playerName: string | null = null): CandidateSearchObservation {
  return {
    request: {
      action: "search_candidates",
      targetTeam: "Bayern",
      position: "ST",
      positions: ["ST"],
      playerName,
      maxAge: 23,
      minimumMinutes: 900,
      competition: "Bundesliga",
      season: "2026/27",
      offset: 0,
      limit: 20,
    },
    appliedFilters: ["position", "maxAge", "minimumMinutes", "competition", "season"],
    actualOffset: 0,
    nextOffset,
    matchingRecordCount: 41,
    discoveredSourceRecordIds: ["record-a"],
    reportScope: "evaluated",
  };
}

test("the decision snapshot uses the current request and the exact latest page cursor", () => {
  const stalePage = page(60, "stale");
  const currentPage = page(20);
  const state = plannerState({
    candidateSearchTurnStartIndex: 1,
    candidateSearchObservations: [stalePage, currentPage],
    discoveredPlayers: {
      eligible: { playerId: "eligible" } as PlayerProfile,
      stale: { playerId: "stale" } as PlayerProfile,
    },
    evaluatedPlayers: {
      eligible: { player: { playerId: "eligible" } } as State["evaluatedPlayers"][string],
    },
  });

  const snapshot = buildPlanningSnapshot({
    state,
    repository: { mode: "demo", sourceName: "Fixture", async loadPlayers() { return []; } },
    decisionMode: "investigate",
    availableActions: ["search_candidates", "finish"],
    eligibleEvaluatedPlayers: { eligible: state.evaluatedPlayers.eligible },
    groupCandidateRecords: () => [],
    expansionConstraints: {
      targetTeam: "Bayern",
      nextOffset: 20,
      position: "ST",
      positions: ["ST"],
      playerName: null,
      maxAge: 23,
      minimumMinutes: 900,
      competition: "Bundesliga",
      season: "2026/27",
    },
  });

  assert.equal(snapshot.case.latestUserRequest, "Find a young forward");
  assert.equal(snapshot.search.nextOffset, 20);
  assert.equal(snapshot.search.request?.playerName, null);
  assert.deepEqual(snapshot.candidates.eligiblePlayerIds, ["eligible"]);
  assert.deepEqual(snapshot.candidates.evaluatedPlayerIds, ["eligible"]);
  assert.equal(snapshot.search.expansionConstraints?.nextOffset, 20);
});

test("mutating the decision snapshot cannot mutate canonical case facts", () => {
  const state = plannerState({
    brief: {
      task: "reinforcement",
      targetTeam: { value: "Bayern", basis: "explicit", quote: "Bayern" },
      referencePlayer: null,
      referenceClues: [],
      selectedCandidateId: null,
      criteria: [{
        field: "position", operator: "in", value: ["ST"], unit: null, attributeKey: null,
        strength: "required", basis: "explicit", quote: "striker",
      }],
      unresolved: [],
    } as unknown as State["brief"],
  });
  const snapshot = buildPlanningSnapshot({
    state,
    repository: { mode: "demo", sourceName: "Fixture", async loadPlayers() { return []; } },
    decisionMode: "investigate",
    availableActions: ["search_candidates", "finish"],
    eligibleEvaluatedPlayers: {},
    groupCandidateRecords: () => [],
  });

  assert.ok(snapshot.case.brief);
  (snapshot.case.brief as { targetTeam: string | null }).targetTeam = "Barcelona";
  (snapshot.case.confirmedPositions as string[]).push("CB");
  snapshot.budget.search_candidates = 99;

  assert.equal(state.brief?.targetTeam?.value, "Bayern");
  assert.deepEqual(state.confirmedPositions, ["ST"]);
  assert.equal(state.toolUses.search_candidates, 0);
});

test("planner actions follow repository capabilities and hard tool budgets", () => {
  const repository = {
    mode: "demo" as const,
    sourceName: "Fixture",
    async loadPlayers() { return []; },
    async inspectPlayer() { throw new Error("not used"); },
  };
  const toolUses = emptyToolUseCounts();
  toolUses.inspect_player = toolBudgets.inspect_player;
  const state = plannerState({ toolUses });

  assert.deepEqual(availablePlannerActions({
    state,
    repository,
    decisionMode: "investigate",
  }), ["inspect_team", "search_candidates", "search_methodology", "evaluate_candidates", "search_player_reports", "ask_user", "finish"]);

  toolUses.search_candidates = toolBudgets.search_candidates;
  assert.equal(availablePlannerActions({
    state,
    repository,
    decisionMode: "investigate",
  }).includes("search_candidates"), false);

  const exhaustedEvidenceActions = availablePlannerActions({
    state: plannerState({ ragResearchQueryCount: 5 }),
    repository,
    decisionMode: "investigate",
  });
  assert.equal(exhaustedEvidenceActions.includes("search_methodology"), false);
  assert.equal(exhaustedEvidenceActions.includes("search_player_reports"), false);
});

test("conclusion actions stay within the adopted Planner action set", () => {
  const repository = { mode: "demo" as const, sourceName: "Fixture", async loadPlayers() { return []; } };
  const noEvidence = plannerState();
  assert.deepEqual(availablePlannerActions({
    state: noEvidence,
    repository,
    decisionMode: "conclude",
  }), ["ask_user", "finish"]);
  assert.equal("read_case_evidence" in noEvidence.toolUses, false);
});

test("the full graph gives the Planner the latest decision snapshot without sharing mutable case facts", async () => {
  const restoreEnvironment = installRecruitmentConversationTestEnvironment();
  const players = Array.from({ length: 21 }, (_, index) => (
    roleConstraintPlayer(`snapshot-player-${index}`, `Snapshot Player ${index}`, "CM")
  ));
  const observedOffsets: number[] = [];
  let expansionDecisions = 0;
  try {
    const conversation = createRecruitmentConversation({
      repository: {
        mode: "demo",
        sourceName: "Snapshot fixture",
        async loadPlayers() { return players; },
      },
      planner: {
        async decide(input) {
          assert.ok(input.decisionSnapshot, "the Planner must receive the prepared decision snapshot");
          if (input.decisionSnapshot.caps.stage === "expand") {
            expansionDecisions += 1;
            observedOffsets.push(input.decisionSnapshot.search.nextOffset ?? -1);
            if (expansionDecisions === 1) {
              assert.equal(input.decisionSnapshot.search.nextOffset, 20);
              assert.equal(input.decisionSnapshot.candidates.eligiblePlayerIds.length, 20);
              input.decisionSnapshot.case.latestUserRequest = "mutated by Planner";
              input.decisionSnapshot.candidates.eligiblePlayerIds.length = 0;
              return {
                action: "search_candidates",
                position: "MID",
                minimumMinutes: 0,
                offset: 0,
                limit: 20,
              };
            }
            assert.deepEqual(
              input.decisionSnapshot.candidates.eligiblePlayerIds,
              Array.from({ length: 21 }, (_, index) => `snapshot-player-${index}`).sort((left, right) => (
                left.localeCompare(right, "en", { numeric: true })
              )),
            );
            return {
              action: "finish",
              targetTeam: "Barcelona",
              needSummary: "已检查当前证据。",
              capabilityProfile: [],
              recommendations: [],
              limitationKeys: ["other"],
            };
          }
          if (input.decisionSnapshot.caps.stage === "reorient") {
            assert.equal(input.decisionSnapshot.case.latestUserRequest, "为巴萨找一名中场");
            assert.deepEqual(
              input.decisionSnapshot.candidates.eligiblePlayerIds,
              players.map(({ playerId }) => playerId).sort((left, right) => (
                left.localeCompare(right, "en", { numeric: true })
              )),
            );
            return {
              action: "finish",
              targetTeam: "Barcelona",
              needSummary: "已检查当前证据。",
              capabilityProfile: [],
              recommendations: [],
              limitationKeys: ["other"],
            };
          }
          if (!input.history.some(entry => entry.role === "tool" && entry.toolName === "search_methodology")) {
            return {
              action: "search_methodology",
              targetTeam: "Barcelona",
              query: "中场位置的能力画像与可观察比赛表现评估方法",
              limit: 4,
            };
          }
          if (!input.history.some(entry => entry.role === "tool" && entry.toolName === "search_candidates")) {
            return { action: "search_candidates", position: "MID", minimumMinutes: 0, limit: 20 };
          }
          return {
            action: "finish",
            targetTeam: "Barcelona",
            needSummary: "已检查当前证据。",
            capabilityProfile: [],
            recommendations: [],
            limitationKeys: ["other"],
          };
        },
      },
      knowledgeBase: { async search() { return []; } },
      experimentalRetrievalMode: "on_demand",
      experimentalReviewerMode: "bypassed",
      experimentalExpansionSufficiencyMode: "bypassed",
    });

    const response = await conversation.turn({
      threadId: "decision-snapshot-full-graph",
      message: "为巴萨找一名中场",
    });

    assert.equal(response.status, "completed");
    assert.deepEqual(observedOffsets, [20]);
  } finally {
    restoreEnvironment();
  }
});

test("a material position clarification pauses and resumes the full graph", async () => {
  const restoreEnvironment = installRecruitmentConversationTestEnvironment();
  try {
    const trace: RecruitmentTraceEvent[] = [];
    const player = roleConstraintPlayer("snapshot-position-player", "Snapshot Player", "LB");
    let plannerCandidates = 0;
    const conversation = createRecruitmentConversation({
      repository: {
        mode: "demo",
        sourceName: "Clarification fixture",
        async loadPlayers() { return [player]; },
        async searchCandidates(query) {
          return { players: [player], totalRecords: 1, offset: query.offset, nextOffset: null, appliedFilters: [] };
        },
      },
      planner: {
        async decide(input) {
          plannerCandidates += 1;
          if (input.decisionSnapshot.constraints) return {
            action: "finish",
            targetTeam: input.decisionSnapshot.case.targetTeam,
            needSummary: "已按确认位置完成调查。",
            capabilityProfile: ["防守表现"],
            recommendations: [],
            limitationKeys: ["other"],
          };
          if (!input.history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology")) {
            return { action: "search_methodology", query: "防守表现" };
          }
          return { action: "search_candidates", position: null, minimumMinutes: 0, limit: 20 };
        },
      },
      knowledgeBase: { async search() { return []; } },
      observer(event) { trace.push(event); },
    });

    const response = await conversation.turn({
      threadId: "position-clarification-resume",
      message: "为巴萨寻找提升防守的球员，重点看抢断。",
    });

    assert.equal(response.status, "needs_input");
    assert.match(response.message, /场上位置/);
    assert.ok(response.question);
    assert.equal(response.question.input?.kind, "positions");
    assert.ok(trace.some((event) => event.phase === "decision"
      && event.decisionSource === "policy"
      && event.action === "ask_user"
      && event.askPolicyOutcome === "allowed"), JSON.stringify(trace));
    assert.equal(plannerCandidates, 2);
    assert.ok(conversation.inspectCaseRun);
    const pausedRun = await conversation.inspectCaseRun({ threadId: "position-clarification-resume", limit: 100 });
    assert.ok(pausedRun.checkpoints.some(checkpoint => checkpoint.interrupted), JSON.stringify(pausedRun));
    assert.ok(pausedRun.checkpoints.every(checkpoint => checkpoint.nextNodes.every(node => /^[a-z_]+$/.test(node))));
    assert.doesNotMatch(JSON.stringify(pausedRun), /为巴萨寻找提升防守|Snapshot Player|已确认位置完成调查/);

    const resumed = await conversation.turn({
      threadId: "position-clarification-resume",
      message: "",
      expectsExistingState: true,
      positionAnswer: {
        questionId: response.question.input!.questionId,
        positions: ["LB"],
      },
    });
    assert.equal(resumed.status, "completed", resumed.message);
    assert.deepEqual(resumed.report?.requestedPositions, ["LB"]);
    const completedRun = await conversation.inspectCaseRun({ threadId: "position-clarification-resume", limit: 1 });
    assert.equal(completedRun.checkpoints.length, 1);
    assert.equal(completedRun.checkpoints[0]?.interrupted, false);
    assert.ok(completedRun.checkpoints[0]?.step);
  } finally {
    restoreEnvironment();
  }
});
