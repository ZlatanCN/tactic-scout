import assert from "node:assert/strict";
import test from "node:test";
import { createWikidataPlayerNameResolver } from "../src/data/player-name-resolver.js";
import { createRecruitmentConversation } from "../src/agent/conversation.js";
import type { PlayerProfile } from "../src/domain/schemas.js";

function entity(english = "Mohamed Salah", chinese = "萨拉赫", footballer = true) {
  return { labels: { en: { value: english }, zh: { value: chinese } }, aliases: {},
    claims: { P106: [{ mainsnak: { datavalue: { value: { id: footballer ? "Q937857" : "Q49757" } } } }],
      P569: [{ mainsnak: { datavalue: { value: { time: "+1992-06-15T00:00:00Z" } } } }] } };
}

test("multilingual reference lookup verifies an exact label and football occupation rather than selecting the first result", async () => {
  let calls = 0;
  const resolve = createWikidataPlayerNameResolver({ fetchImpl: async input => {
    calls++; const url = new URL(String(input));
    return Response.json(url.searchParams.get("action") === "wbsearchentities"
      ? { search: [{ id: "Q1", match: { text: "萨拉赫" } }, { id: "Q1354960", match: { text: "萨拉赫" } }] }
      : { entities: { Q1: entity("Salach", "萨拉赫", false), Q1354960: entity() } });
  } });
  const result = await resolve("萨拉赫");
  assert.equal(result?.entityId, "Q1354960");
  assert.ok(result?.names.includes("Mohamed Salah"));
  assert.equal(result?.sourceUrl, "https://www.wikidata.org/wiki/Q1354960");
  assert.deepEqual(await resolve("萨拉赫"), result);
  assert.equal(calls, 2, "repeat requests reuse the resolved entity within this resolver");
});

test("ambiguous football names, mismatched labels, and failed lookups do not invent an alias", async () => {
  for (const entities of [{ Q1: entity(), Q2: entity("Other Salah") }, { Q1: entity("Other", "别人"), Q2: entity("Other", "别人") }]) {
    const resolve = createWikidataPlayerNameResolver({ fetchImpl: async input => Response.json(new URL(String(input)).searchParams.get("action") === "wbsearchentities"
      ? { search: [{ id: "Q1", match: { text: "萨拉赫" } }, { id: "Q2", match: { text: "萨拉赫" } }] } : { entities }) });
    assert.equal(await resolve("萨拉赫"), null);
  }
  const unavailable = createWikidataPlayerNameResolver({ fetchImpl: async () => new Response(null, { status: 503 }) });
  assert.equal(await unavailable("萨拉赫"), null);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(unavailable("萨拉赫", abort.signal));
});

test("paired whole-graph reference resolution excludes the same player across languages without excluding teammates", async () => {
  const player = (id: string, name: string, goals: number): PlayerProfile => ({
    playerId: id, name, team: "利物浦", age: 25, position: "RW", competition: "Fixture League", season: "2025/26", minutes: 1800,
    source: "Synthetic reference fixture", stats: { goals, assists: 0, passesAttempted: 100, passesCompleted: 80,
      longPasses: 0, carries: 0, pressures: 0, tackles: 0, interceptions: 0, shotAssists: 0, keyPasses: 0 } });
  const players = [player("reference", "Mohamed Salah", 30), player("candidate", "Other Forward", 10)];
  const reports = [];
  for (const enabled of [true, false]) {
    const conversation = createRecruitmentConversation({
      repository: { mode: "demo", sourceName: "Synthetic reference fixture", async loadPlayers() { return players; } },
      referenceNameResolver: enabled ? async () => ({ entityId: "Q1354960", sourceUrl: "https://www.wikidata.org/wiki/Q1354960", names: ["萨拉赫", "Mohamed Salah"] }) : undefined,
      knowledgeBase: { async search() { return []; } },
      experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
      planner: { async decide() { return { action: "finish", targetTeam: "利物浦", needSummary: "寻找右边锋接班人。", capabilityProfile: ["进球产出"],
        recommendations: players.map(p => ({ playerId: p.playerId, evidenceKeys: ["goals" as const] })), limitationKeys: [] }; } },
    });
    const result = await conversation.turn({ threadId: `reference-${enabled}`, message: "为利物浦寻找萨拉赫的替代者，限定右边锋，重点看进球产出。" });
    assert.equal(result.status, "completed"); reports.push(result.report);
  }
  assert.deepEqual(reports[0]?.recommendations.map(r => r.player.playerId), ["candidate"]);
  assert.ok(reports[1]?.recommendations.some(r => r.player.playerId === "reference"));
  assert.equal(reports[0]?.referenceProfiles?.[0]?.name, "Mohamed Salah");
});

test("changing the reference in the same case refreshes identity and inherits the new position", async () => {
  const base: PlayerProfile = { playerId: "salah", name: "Mohamed Salah", position: "RW", age: 25,
    team: "Fixture Club", competition: "Fixture League", season: "2025/26", minutes: 1800, source: "Synthetic reference fixture",
    stats: { goals: 5, assists: 0, passesAttempted: 100, passesCompleted: 80, longPasses: 0, carries: 0, pressures: 0,
      tackles: 0, interceptions: 0, shotAssists: 0, keyPasses: 0 } };
  const players: PlayerProfile[] = [base, { ...base, playerId: "wing", name: "Other Wing" },
    { ...base, playerId: "neuer", name: "Manuel Neuer", position: "GK" },
    { ...base, playerId: "keeper", name: "Other Keeper", position: "GK" }];
  const mentions: string[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Synthetic reference fixture", async loadPlayers() { return players; }, async inspectTeam() { return players; } },
    referenceNameResolver: async mention => { mentions.push(mention); return { entityId: mention === "萨拉赫" ? "Q1354960" : "Q107365",
      sourceUrl: `https://www.wikidata.org/wiki/${mention === "萨拉赫" ? "Q1354960" : "Q107365"}`,
      names: mention === "萨拉赫" ? ["萨拉赫", "Mohamed Salah"] : ["诺伊尔", "Manuel Neuer"] }; },
    knowledgeBase: { async search() { return []; } }, experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
    planner: { async decide() { return { action: "finish", targetTeam: "拜仁", needSummary: "按当前参考对象寻找接班线索。", capabilityProfile: [],
      recommendations: players.map(p => ({ playerId: p.playerId, evidenceKeys: ["goals" as const] })), limitationKeys: [] }; } },
  });
  const first = await conversation.turn({ threadId: "changing-reference", message: "为拜仁寻找萨拉赫的替代者，限定右边锋，重点看进球产出。" });
  assert.deepEqual(first.report?.recommendations.map(r => r.player.playerId), ["wing"]);
  const second = await conversation.turn({ threadId: "changing-reference", message: "改为找诺伊尔的替代者。", expectsExistingState: true });
  assert.deepEqual(mentions, ["萨拉赫", "诺伊尔"]);
  assert.ok(second.report?.recommendations.every(r => r.player.position === "GK"));
  assert.ok(second.report?.recommendations.every(r => r.player.playerId !== "neuer"));
  assert.equal(second.report?.referenceNameSource?.entityId, "Q107365");
  assert.ok(second.report?.requestedCapabilityCoverage.every(area => area.name !== "进球产出"));
});
