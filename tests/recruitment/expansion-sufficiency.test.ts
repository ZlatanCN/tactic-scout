import assert from "node:assert/strict";
import test from "node:test";
import { validateRecruitmentBrief, type RecruitmentBrief } from "../../src/recruitment/brief.js";
import { compileRecruitmentCriteria } from "../../src/recruitment/criterion-compiler.js";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import type { PlayerProfile } from "../../src/domain/players.js";
import { searchLoadedPlayers } from "../../src/players/search.js";
import { roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

function candidate(index: number, fit: number | null): PlayerProfile {
  const player = roleConstraintPlayer(`left-back-${index}`, `Left Back ${index}`, "LB");
  return {
    ...player,
    abilityProfile: {
      recordId: `record-${index}`,
      uniqueId: null,
      snapshotId: "fixture-snapshot",
      inGameDate: "2026-10-18",
      birthDate: null,
      aliases: [],
      heightCm: null,
      identityLink: { method: "source_record", evidence: `fixture-${index}` },
      positions: { LB: 18 },
      attributes: {},
      leftFoot: null,
      rightFoot: null,
      personality: {},
      traits: [],
      currentAbility: null,
      potentialAbility: null,
      roles: fit === null ? [] : [{
        role: "ball_playing_defender",
        label: "防守与出球",
        positionRating: 18,
        positionCompatible: true,
        fit,
        attributeCoverage: 1,
        searchPriority: fit,
        performanceMetricKeys: [],
        attributes: [],
      }],
    },
  };
}

test("a one-capability request with three independently evidenced players finishes without expansion planning", async () => {
  const message = "为巴萨找一名 left-back，重点看后场出球。";
  const players = Array.from({ length: 23 }, (_, index) => candidate(index, index < 3 ? 90 - index : null));
  const brief: RecruitmentBrief = {
    task: "reinforcement",
    targetTeam: { value: "巴萨", basis: "explicit", quote: "巴萨" },
    referencePlayer: null,
    referenceClues: [],
    referenceRecheck: null,
    selectedCandidateId: null,
    criteria: [
      { field: "position", operator: "in", value: ["LB"], unit: null, attributeKey: null,
        strength: "required", basis: "explicit", quote: "left-back" },
      { field: "capability", operator: "match", value: "后场出球", unit: null, attributeKey: null,
        strength: "required", basis: "explicit", quote: "后场出球" },
    ],
    unresolved: [],
  };
  const decisions: Array<{ action: string | null; decisionMode?: string; decisionSource?: string; policyReasonCodes?: string[] }> = [];
  let plannerCalls = 0;
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret(input) { return validateRecruitmentBrief(brief, [...input.recentMessages, input.message]); } },
    repository: {
      mode: "demo",
      sourceName: "Ability fixture",
      supportsAbilityProfiles: true,
      async loadPlayers() { return players; },
      async searchCandidates(query) { return searchLoadedPlayers(players, query); },
      async getPlayersByIds(ids) { return players.filter(player => ids.includes(player.playerId)); },
      async getComparisonPlayers() { return players; },
    },
    knowledgeBase: { async search() { return []; } },
    experimentalDeterministicSearchMode: "enabled",
    experimentalRetrievalMode: "on_demand",
    observer(event) {
      if (event.phase === "decision") decisions.push(event);
    },
    planner: { async decide(input) { plannerCalls++; throw new Error(`Unexpected Planner call: ${input.decisionSnapshot.caps.stage ?? "investigate"}.`); } },
  });

  const response = await conversation.turn({ threadId: "single-capability-expansion", message });

  assert.equal(response.status, "completed", response.message);
  assert.equal(compileRecruitmentCriteria(response.brief).positions[0], "LB", "the canonical brief keeps the explicit left-back condition");
  assert.equal(response.report?.recommendations.length, 3);
  assert.ok(response.report?.recommendations.every(({ focusEvidenceKeys }) => focusEvidenceKeys.includes("abilityBallPlayingDefender")));
  assert.equal(plannerCalls, 0);
  assert.ok(decisions.some(event => event.action === "finish"
    && event.decisionSource === "policy"
    && event.policyReasonCodes?.includes("evidence_sufficient_for_expansion")), JSON.stringify(decisions));
});
