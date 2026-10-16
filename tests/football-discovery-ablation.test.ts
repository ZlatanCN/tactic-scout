import assert from "node:assert/strict";
import test from "node:test";
import { createRecruitmentConversation } from "../src/agent/conversation.js";
import { searchLoadedPlayers, type PlayerSearchQuery } from "../src/data/player-search.js";
import { requestedCapabilityEvidenceAreas } from "../src/domain/recruitment-capabilities.js";
import type { PlayerProfile } from "../src/domain/schemas.js";

function fixture(i: number): PlayerProfile {
  return { playerId: `fixture-${i}`, name: `Synthetic ${i}`, age: 25, position: "ST", team: "Fixture Club",
    competition: "Fixture League", season: "2025/26", minutes: 1800, source: "Synthetic discovery fixture",
    stats: { goals: i === 59 ? 30 : 4, assists: i === 58 ? 20 : 0, passesAttempted: 100, passesCompleted: 80,
      longPasses: 0, carries: 0, pressures: 0, tackles: 0, interceptions: 0, shotAssists: 0, keyPasses: 0 } };
}
const pool = Array.from({ length: 60 }, (_, i) => fixture(i));
const query: PlayerSearchQuery = { playerName: null, position: "ST", maxAge: null, minimumMinutes: 0,
  competition: null, season: null, offset: 0, limit: 20, discoveryMetricGroups: [["goals"], ["assists"]] };

test("finishing and link-up synonyms preserve unknown technical abilities rather than inventing output requirements", () => {
  assert.deepEqual(requestedCapabilityEvidenceAreas(["重点看终结"]), requestedCapabilityEvidenceAreas(["重点看射门终结能力"]));
  assert.deepEqual(requestedCapabilityEvidenceAreas(["重点看做球"]), requestedCapabilityEvidenceAreas(["重点看接应"]));
  assert.ok(requestedCapabilityEvidenceAreas(["进球产出和创造机会"]).every(area => area.metricKeys.length > 0));
  assert.ok(requestedCapabilityEvidenceAreas(["能接应、做球和终结"]).every(area => area.metricKeys.length === 0));
  assert.deepEqual(requestedCapabilityEvidenceAreas(["参与施压"]).map(area => area.metricKeys), [["pressures"]]);
  assert.deepEqual(requestedCapabilityEvidenceAreas(["适合高位压迫"]).map(area => area.metricKeys), [[]]);
});

test("snapshot discovery uses per-metric lanes, preserves missing records, and pages without duplicates", () => {
  const missing = { ...fixture(60), availableStats: [] };
  const input = [...pool, missing];
  const first = searchLoadedPlayers(input, query);
  assert.ok(first.players.some(p => p.playerId === "fixture-59"));
  assert.ok(first.players.some(p => p.playerId === "fixture-58"));
  const all = [...first.players];
  let next = first.nextOffset;
  while (next !== null) {
    const page = searchLoadedPlayers([...input].reverse(), { ...query, offset: next });
    all.push(...page.players); next = page.nextOffset;
  }
  assert.equal(new Set(all.map(p => p.playerId)).size, input.length);
  assert.equal(all.length, input.length);
  assert.ok(all.some(p => p.playerId === missing.playerId));
  const constrained = searchLoadedPlayers([...input, { ...fixture(61), age: 35 }], { ...query, maxAge: 26, limit: 100 });
  assert.ok(constrained.players.every(p => p.age !== null && p.age <= 26));
});

test("discovery keeps distinct competitions and metrics represented without comparing their values", () => {
  const otherLeague = pool.map(p => ({ ...p, playerId: `other-${p.playerId}`, competition: "Other League", stats: { ...p.stats, goals: 1000 } }));
  const page = searchLoadedPlayers([...pool, ...otherLeague], { ...query, limit: 4 });
  assert.deepEqual(new Set(page.players.map(p => p.competition)), new Set(["Fixture League", "Other League"]));
  assert.ok(page.players.some(p => p.playerId === "fixture-59"));
  assert.ok(page.players.some(p => p.playerId === "fixture-58"));
});

test("many equivalent metric fields cannot crowd a whole competition out of the first page", () => {
  const input = Array.from({ length: 5 }, (_, group) => pool.map(player => ({ ...player,
    playerId: `league-${group}-${player.playerId}`, competition: `League ${group}` })) ).flat();
  const page = searchLoadedPlayers(input, { ...query, limit: 5,
    discoveryMetricGroups: [["goals"], ["assists", "shotAssists", "keyPasses", "longPasses", "carries"]] });
  assert.equal(new Set(page.players.map(player => player.competition)).size, 5);
});

test("a seventeen-minute rate outlier does not displace sustained observed output", () => {
  const tiny = { ...fixture(99), minutes: 17, stats: { ...fixture(99).stats, goals: 1, assists: 1 } };
  const page = searchLoadedPlayers([tiny, ...pool], { ...query, limit: 2 });
  assert.deepEqual(new Set(page.players.map(p => p.playerId)), new Set(["fixture-59", "fixture-58"]));
  const all = searchLoadedPlayers([tiny, ...pool], { ...query, limit: 100 });
  assert.ok(all.players.some(p => p.playerId === tiny.playerId), "sample reliability changes discovery order, not eligibility");
});

async function runGraph(ordered: PlayerProfile[], bypassDiscovery: boolean) {
  const evaluated = new Set<string>();
  let searches = 0;
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Synthetic discovery fixture",
      async loadPlayers() { return ordered; },
      async searchCandidates(q) { searches++; return searchLoadedPlayers(ordered, bypassDiscovery ? { ...q, discoveryMetricGroups: undefined } : q); },
      async getPlayersByIds(ids) { ids.forEach(id => evaluated.add(id)); return ordered.filter(p => ids.includes(p.playerId)); },
      async getComparisonPlayers() { return ordered; } },
    knowledgeBase: { async search() { return []; } },
    experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
    planner: { async decide() {
      const bestObserved = ordered.filter(p => evaluated.has(p.playerId)).sort((a,b) => b.stats.goals-a.stats.goals)[0];
      return { action: "finish", targetTeam: "拜仁", needSummary: "根据已观察进球产出给出考察线索。", capabilityProfile: ["进球产出"],
        recommendations: bestObserved ? [{ playerId: bestObserved.playerId, evidenceKeys: ["goals"] }] : [], limitationKeys: [] };
    } },
  });
  const result = await conversation.turn({ threadId: "fixed-discovery", message: "为拜仁找中锋，重点看进球产出，年龄不限。" });
  return { result, evaluated: evaluated.size, searches };
}

test("paired full-graph discovery intervention finds the planted high-output record across ten input permutations at equal budget", async () => {
  let enabledHits = 0; let controlHits = 0;
  for (let seed = 0; seed < 10; seed++) {
    const rotation = seed * 6;
    const ordered = [...pool.slice(rotation), ...pool.slice(0, rotation)];
    const enabled = await runGraph(ordered, false);
    const control = await runGraph(ordered, true);
    assert.equal(enabled.result.status, "completed");
    assert.equal(control.result.status, "completed");
    assert.equal(enabled.evaluated, control.evaluated);
    assert.equal(enabled.evaluated, 20);
    assert.equal(enabled.searches, control.searches);
    enabledHits += Number(enabled.result.report?.recommendations.some(r => r.player.playerId === "fixture-59"));
    controlHits += Number(control.result.report?.recommendations.some(r => r.player.playerId === "fixture-59"));
  }
  assert.equal(enabledHits, 10);
  assert.equal(controlHits, 3);
  // This is recall of a planted measurable output, not a label for football quality.
});

test("goalkeeper leads disclose unavailable specialist evidence and never use attacking zeros as support", async () => {
  const keeper: PlayerProfile = { ...fixture(0), playerId: "keeper", name: "Synthetic Keeper", position: "GK",
    stats: { ...fixture(0).stats, goals: 0, assists: 0 } };
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Synthetic keeper fixture", async loadPlayers() { return [keeper]; } },
    knowledgeBase: { async search() { return []; } }, experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
    planner: { async decide() { return { action: "finish", targetTeam: "拜仁", needSummary: "requestedCapabilityCoverage 为空，nextOffset 不能扩页。", capabilityProfile: [],
      recommendations: [{ playerId: keeper.playerId, evidenceKeys: ["goals"] }], limitationKeys: [] }; } },
  });
  const result = await conversation.turn({ threadId: "keeper-evidence-gap", message: "为拜仁找门将" });
  assert.equal(result.status, "completed");
  assert.ok(result.report?.requestedCapabilityCoverage.some(area => area.name === "门将专项能力" && area.status === "missing"));
  assert.doesNotMatch(result.report?.needSummary ?? "", /requestedCapabilityCoverage|nextOffset/);
  assert.equal(result.report?.recommendations.length, 1);
  assert.deepEqual(result.report?.recommendations[0]?.focusEvidenceKeys, []);
  assert.deepEqual(result.report?.recommendations[0]?.strengths, []);
  assert.deepEqual(result.report?.recommendations[0]?.comparisonNotes, []);
  assert.match(result.report?.recommendations[0]?.rationale ?? "", /目标能力尚未核实/);
});

test("an empty goalkeeper pool ends with a source limitation instead of asking for outfield players", async () => {
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Synthetic empty keeper fixture", async loadPlayers() { return []; } },
    knowledgeBase: { async search() { return []; } }, experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
    planner: { async decide() { assert.fail("known empty goalkeeper coverage requires no further model decision"); } },
  });
  const result = await conversation.turn({ threadId: "empty-keeper-pool", message: "为拜仁找门将" });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.report?.recommendations, []);
  assert.match(result.message, /门将/);
  assert.doesNotMatch(result.message, /扩大到其他位置/);
});
