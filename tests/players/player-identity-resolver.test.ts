import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPlayerIdentityResolver } from "../../src/players/identity/player-identity-resolver.js";
import { NameEvidenceStore } from "../../src/players/identity/name-evidence-store.js";
import { normalizeSearchText } from "../../src/domain/text-matching.js";
import type { PlayerProfile } from "../../src/domain/players.js";
import type { PlayerNameResolver } from "../../src/players/identity/name-resolver.js";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import type { RecruitmentBrief } from "../../src/domain/recruitment-brief.js";

const player = (playerId: string, name: string, position: PlayerProfile["position"] = "AM"): PlayerProfile => ({
  playerId, name, position, team: "", competition: "", season: "", age: 23, birthDate: "2003-08-17", minutes: 0,
  source: "Fixture", stats: { goals: 0, assists: 0, passesAttempted: 0, passesCompleted: 0, longPasses: 0, carries: 0, pressures: 0, tackles: 0, interceptions: 0, shotAssists: 0, keyPasses: 0 },
});
const cherki = player("cherki", "Rayan Cherki");
const missing: PlayerNameResolver = async mention => ({ status: "unresolved", mention });
function repository(players: PlayerProfile[]) {
  return { async findLocalPlayersByNames(names: readonly string[]) {
    return players.filter(player => names.some(name => normalizeSearchText(name) === normalizeSearchText(player.name)));
  } };
}

test("a unique local name works with external identity services offline and does not invoke the model", async () => {
  const resolve = createPlayerIdentityResolver({ repository: repository([cherki]),
    external: async () => { throw new Error("external must not run"); }, variants: async () => { throw new Error("model must not run"); } });
  const result = await resolve("Rayan Cherki");
  assert.equal(result.status, "resolved");
  if (result.status !== "resolved") return;
  assert.equal(result.resolutionMethod, "local_exact");
  assert.deepEqual(result.player.recordIds, ["cherki"]);
  assert.match(result.player.entityId, /^local:[a-f0-9]{64}$/);
  assert.equal(result.player.sourceUrl, undefined);
});

test("a model variant is a confirmable lead, never an automatic Chinese alias", async () => {
  const resolve = createPlayerIdentityResolver({ repository: repository([cherki]), external: missing, variants: async () => ["Rayan Cherki"] });
  const result = await resolve("切耳基");
  assert.equal(result.status, "needs_confirmation");
  if (result.status !== "needs_confirmation") return;
  assert.equal(result.candidates[0]?.preferredName, "Rayan Cherki");
  assert.deepEqual(result.candidates[0]?.recordIds, ["cherki"]);
});

test("same names remain separate source records and explicit context only ranks choices", async () => {
  const people = [player("keeper", "Alex Silva", "GK"), player("midfielder", "Alex Silva", "CM")];
  const resolve = createPlayerIdentityResolver({ repository: repository(people), external: missing });
  const result = await resolve("Alex Silva", undefined, { clues: [{ kind: "position", value: "CM", quote: "踢中前卫的" }] });
  assert.equal(result.status, "ambiguous");
  if (result.status !== "ambiguous") return;
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates[0]?.recordIds, ["midfielder"]);
  assert.notEqual(result.candidates[0]?.entityId, result.candidates[1]?.entityId);
});

test("a conflicting or unverified clue never silently selects the only local record", async () => {
  const resolve = createPlayerIdentityResolver({ repository: repository([cherki]), external: missing });
  assert.equal((await resolve("Rayan Cherki", undefined, { clues: [{ kind: "position", value: "GK", quote: "门将" }] })).status, "needs_confirmation");
  assert.equal((await resolve("Rayan Cherki", undefined, { clues: [{ kind: "era", value: "1990年代", quote: "90年代踢球的" }] })).status, "needs_confirmation");
});

test("confirmation persists but never becomes a global unique alias, and new clues invalidate its scope", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "name-evidence-"));
  try {
    const storePath = path.join(directory, "names.sqlite");
    const resolve = createPlayerIdentityResolver({ repository: repository([cherki]), external: missing,
      variants: async () => ["Rayan Cherki"], store: new NameEvidenceStore(storePath) });
    const first = await resolve("切尔基");
    assert.equal(first.status, "needs_confirmation");
    if (first.status !== "needs_confirmation") return;
    resolve.rememberConfirmation?.("切尔基", first.candidates[0]!, { scopeId: "case-one" });
    const reopened = createPlayerIdentityResolver({ repository: repository([cherki]), external: missing, store: new NameEvidenceStore(storePath) });
    assert.equal((await reopened("切尔基", undefined, { scopeId: "case-one" })).status, "resolved");
    assert.equal((await reopened("切尔基", undefined, { scopeId: "case-two" })).status, "needs_confirmation");
    const offline = createPlayerIdentityResolver({ repository: repository([cherki]), external: async () => { throw new Error("cached hints must work offline"); }, store: new NameEvidenceStore(storePath) });
    assert.equal((await offline("切尔基", undefined, { scopeId: "case-three" })).status, "needs_confirmation");
    assert.equal((await reopened("切尔基", undefined, { scopeId: "case-one", clues: [{ kind: "position", value: "GK", quote: "门将" }] })).status, "needs_confirmation");
    assert.equal(storePath.includes(".data"), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("verified multilingual evidence can be reused, while one alias may retain multiple identities", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "verified-name-"));
  try {
    let now = 1_000_000;
    const store = new NameEvidenceStore(path.join(directory, "names.sqlite"), () => now);
    const candidate = { entityId: "Q64736321", sourceUrl: "https://www.wikidata.org/wiki/Q64736321", names: ["切尔基", "Rayan Cherki"], preferredName: "Rayan Cherki", match: "exact_alias" as const };
    store.remember("切尔基", candidate, "verified", "");
    const resolve = createPlayerIdentityResolver({ repository: repository([]), external: missing, store });
    assert.equal((await resolve("切尔基")).status, "resolved");
    store.remember("切尔基", { ...candidate, entityId: "Q999", sourceUrl: "https://www.wikidata.org/wiki/Q999" }, "verified", "");
    assert.equal((await resolve("切尔基")).status, "ambiguous");
    now += 31 * 86_400_000;
    assert.deepEqual(store.lookup("切尔基"), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("cancellation is propagated rather than converted to a missing name", async () => {
  const controller = new AbortController(); controller.abort();
  const resolve = createPlayerIdentityResolver({ repository: repository([cherki]), external: missing });
  await assert.rejects(resolve("Rayan Cherki", controller.signal));
});

test("a model outage is reported as unavailable rather than evidence of a missing player", async () => {
  const resolve = createPlayerIdentityResolver({ repository: repository([]), external: missing, variants: async () => { throw new Error("offline"); } });
  assert.equal((await resolve("一个外号")).status, "unavailable");
});

test("web names still recall local records while external entity verification is unavailable", async () => {
  const resolve = createPlayerIdentityResolver({ repository: repository([cherki]), external: async mention => ({ status: "unavailable", mention,
    source: "wikidata", retryable: true, nameLeads: [{ name: "Rayan Cherki", sourceUrls: ["https://club.example/player"] }] }),
    variants: async () => { throw new Error("a sufficient local choice must not call the model"); } });
  const result = await resolve("切尔基");
  assert.equal(result.status, "needs_confirmation");
  if (result.status === "needs_confirmation") assert.deepEqual(result.candidates[0]?.recordIds, ["cherki"]);
});

test("explicit recheck bypasses positive local shortcuts and never reaffirms the same identity automatically", async () => {
  let calls = 0;
  const resolve = createPlayerIdentityResolver({ repository: repository([cherki]), external: async mention => { calls++; return { status: "unresolved", mention }; } });
  assert.equal((await resolve("Rayan Cherki")).status, "resolved");
  const rechecked = await resolve("Rayan Cherki", undefined, { forceRecheck: true, queryHint: "不是这位，重新确认" });
  assert.equal(calls, 1);
  assert.equal(rechecked.status, "needs_confirmation");
});

test("rejected record choices cannot be recycled by model or web leads in the same case", async () => {
  const resolver = createPlayerIdentityResolver({ repository: repository([cherki]), external: missing, variants: async () => ["Rayan Cherki"] });
  const result = await resolver("切尔基", undefined, { forceRecheck: true, excludedRecordIds: ["cherki"] });
  assert.equal(result.status, "unresolved");
});

test("a historical namesake never inherits a younger local record with a conflicting birth date", async () => {
  const young = player("young", "Alex Silva");
  const resolve = createPlayerIdentityResolver({ repository: repository([young]), external: async mention => ({ status: "resolved", mention,
    player: { entityId: "Q123", sourceUrl: "https://www.wikidata.org/wiki/Q123", names: ["Alex Silva"], preferredName: "Alex Silva", birthDate: "1960-01-01", description: "1990年代的球员", match: "exact_label" }, resolutionMethod: "wikidata_exact" }) });
  const result = await resolve("Alex Silva", undefined, { clues: [{ kind: "era", value: "1990年代", quote: "1990年代的" }] });
  assert.equal(result.status, "resolved");
  if (result.status !== "resolved") return;
  assert.deepEqual(result.player.recordIds, []);
});

test("the full graph confirms a local record and excludes only that record, not a namesake", async () => {
  const other = player("namesake", "Rayan Cherki", "AM");
  const candidate = player("candidate", "Another Midfielder", "AM");
  const catalog = [cherki, other, candidate].map(p => ({ ...p, minutes: 1800, stats: { ...p.stats, goals: 5 } }));
  const repo = { ...repository(catalog), mode: "demo" as const, sourceName: "Fixture", async loadPlayers() { return catalog; } };
  const resolver = createPlayerIdentityResolver({ repository: repo, external: missing, variants: async () => ["Rayan Cherki"] });
  const brief: RecruitmentBrief = { task: "similarity", targetTeam: null, referencePlayer: { value: "切尔基", basis: "explicit", quote: "切尔基" },
    selectedCandidateId: null, positions: ["AM"], allowsAnyPosition: false, filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null }, priorities: [], constraints: [], unresolved: [] };
  const conversation = createRecruitmentConversation({ repository: repo, referenceNameResolver: resolver, briefInterpreter: { async interpret() { return brief; } },
    knowledgeBase: { async search() { return []; } }, experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
    planner: { async decide() { return { action: "finish", targetTeam: null, needSummary: "寻找相似球员", capabilityProfile: ["进球产出"],
      recommendations: catalog.map(p => ({ playerId: p.playerId, evidenceKeys: ["goals"] })), limitationKeys: [] }; } } });
  const first = await conversation.turn({ threadId: "local-identity", message: "推荐类似切尔基的球员" });
  assert.equal(first.status, "needs_input");
  assert.equal(first.question?.input?.kind, "player_identity");
  if (first.question?.input?.kind !== "player_identity") return;
  const option = first.question.input.candidates[0]!;
  assert.match(option.entityId, /^local:/);
  assert.equal(option.sourceUrl, undefined);
  const result = await conversation.turn({ threadId: "local-identity", message: "选择这个球员", expectsExistingState: true,
    playerIdentityAnswer: { questionId: first.question.input.questionId, entityId: option.entityId } });
  assert.equal(result.status, "completed");
  assert.equal(result.report?.referenceNameSource?.url, undefined);
  assert.deepEqual(result.report?.referenceProfiles.map(p => p.playerId), ["cherki"]);
  assert.ok(result.report?.recommendations.some(r => r.player.playerId === "namesake"));
  assert.ok(!result.report?.recommendations.some(r => r.player.playerId === "cherki"));
});

test("the full graph remembers rejected choices and clears those exclusions for a genuinely new reference", async () => {
  const catalog = [cherki, player("namesake", "Rayan Cherki"), player("another", "Another Midfielder")]
    .map(p => ({ ...p, minutes: 1800, stats: { ...p.stats, goals: 5 } }));
  const repo = { ...repository(catalog), mode: "demo" as const, sourceName: "Fixture", async loadPlayers() { return catalog; } };
  const resolver = createPlayerIdentityResolver({ repository: repo, external: missing, variants: async () => ["Rayan Cherki"] });
  const base: RecruitmentBrief = { task: "similarity", targetTeam: null, referencePlayer: { value: "切尔基", basis: "explicit", quote: "切尔基" }, selectedCandidateId: null,
    positions: ["AM"], allowsAnyPosition: false, filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null }, priorities: [], constraints: [], unresolved: [] };
  const conversation = createRecruitmentConversation({ repository: repo, referenceNameResolver: resolver,
    briefInterpreter: { async interpret(input) {
      if (input.message === "都不是") return { ...base, referenceRecheck: { quote: "都不是", reject: true } };
      if (input.message.includes("Another Midfielder")) return { ...base, referencePlayer: { value: "Another Midfielder", basis: "explicit", quote: "Another Midfielder" } };
      return base;
    } }, knowledgeBase: { async search() { return []; } }, experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
    planner: { async decide() { return { action: "finish", targetTeam: null, needSummary: "相似推荐", capabilityProfile: ["进球产出"], recommendations: catalog.map(p => ({ playerId: p.playerId, evidenceKeys: ["goals"] })), limitationKeys: [] }; } } });
  const first = await conversation.turn({ threadId: "reject-identity", message: "推荐类似切尔基的球员" });
  assert.equal(first.question?.input?.kind, "player_identity");
  const rejected = await conversation.turn({ threadId: "reject-identity", message: "都不是", expectsExistingState: true });
  assert.equal(rejected.status, "needs_input");
  assert.equal(rejected.question?.input, undefined, "do not recycle the rejected cards");
  const changed = await conversation.turn({ threadId: "reject-identity", message: "我说的是 Another Midfielder", expectsExistingState: true });
  assert.equal(changed.status, "completed");
  assert.equal(changed.report?.referenceNameSource?.resolvedName, "Another Midfielder");
  assert.ok(changed.report?.recommendations.some(candidate => candidate.player.playerId === "cherki"));
});

test("the structured reject-all action rechecks without asking the brief model to infer the control intent", async () => {
  const catalog = [cherki, player("another", "Another Midfielder")]
    .map(p => ({ ...p, minutes: 1800, stats: { ...p.stats, goals: 5 } }));
  const repo = { ...repository(catalog), mode: "demo" as const, sourceName: "Fixture", async loadPlayers() { return catalog; } };
  const resolverContexts: Array<{ forceRecheck?: boolean; excludedIds?: string[]; excludedRecordIds?: string[] }> = [];
  const resolver = createPlayerIdentityResolver({ repository: repo,
    external: async (mention, _signal, context) => { resolverContexts.push(context ?? {}); return { status: "unresolved", mention }; },
    variants: async () => ["Rayan Cherki"] });
  const base: RecruitmentBrief = { task: "similarity", targetTeam: null, referencePlayer: { value: "切尔基", basis: "explicit", quote: "切尔基" }, selectedCandidateId: null,
    positions: ["AM"], allowsAnyPosition: false, filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null }, priorities: [], constraints: [], unresolved: [] };
  let interpretationCalls = 0;
  const conversation = createRecruitmentConversation({ repository: repo, referenceNameResolver: resolver,
    briefInterpreter: { async interpret() { interpretationCalls++; return base; } },
    knowledgeBase: { async search() { return []; } }, experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
    planner: { async decide() { return { action: "finish", targetTeam: null, needSummary: "相似推荐", capabilityProfile: ["进球产出"], recommendations: catalog.map(p => ({ playerId: p.playerId, evidenceKeys: ["goals"] })), limitationKeys: [] }; } } });
  const first = await conversation.turn({ threadId: "structured-reject", message: "推荐类似切尔基的球员" });
  assert.equal(first.status, "needs_input");
  assert.equal(first.question?.input?.kind, "player_identity");
  if (first.question?.input?.kind !== "player_identity") return;
  const rejectedEntityId = first.question.input.candidates[0]!.entityId;
  const retried = await conversation.turn({ threadId: "structured-reject", message: "都不是，重新查找", expectsExistingState: true,
    playerIdentityAnswer: { questionId: first.question.input.questionId, rejectAll: true } });
  assert.equal(interpretationCalls, 1, "the already-understood request should not be sent through the brief model again");
  assert.equal(resolverContexts.length, 2);
  assert.equal(resolverContexts[1]?.forceRecheck, true);
  assert.ok(resolverContexts[1]?.excludedIds?.includes(rejectedEntityId));
  assert.ok(resolverContexts[1]?.excludedRecordIds?.includes("cherki"));
  assert.notEqual(retried.question?.input?.kind, "player_identity", "rejected choices must not be recycled");
});

test("a projected history cannot restore a rejected reference identity over the current brief", async () => {
  const catalog = [cherki, player("another", "Another Midfielder")]
    .map(p => ({ ...p, minutes: 1800, stats: { ...p.stats, goals: 5 } }));
  const repo = {
    ...repository(catalog),
    mode: "demo" as const,
    sourceName: "Fixture",
    supportsAbilityProfiles: false,
    async loadPlayers() { return catalog; },
    async searchCandidates(query: { offset: number }) {
      return { players: catalog, totalRecords: catalog.length, nextOffset: null, offset: query.offset, appliedFilters: ["position"] };
    },
    async getPlayersByIds(playerIds: readonly string[]) { return catalog.filter(p => playerIds.includes(p.playerId)); },
    async getComparisonPlayers() { return catalog; },
  };
  const resolverMentions: string[] = [];
  const resolver = createPlayerIdentityResolver({
    repository: repo,
    external: async mention => { resolverMentions.push(mention); return { status: "unresolved", mention }; },
    variants: async () => ["Rayan Cherki"],
  });
  const withReference: RecruitmentBrief = {
    task: "similarity", targetTeam: null, referencePlayer: { value: "切尔基", basis: "explicit", quote: "切尔基" },
    selectedCandidateId: null, positions: ["AM"], allowsAnyPosition: false,
    filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null },
    priorities: [], constraints: [], unresolved: [],
  };
  const currentBrief: RecruitmentBrief = {
    ...withReference, task: "reinforcement", referencePlayer: null,
  };
  const plannerCalls: Array<Parameters<import("../../src/recruitment/conversation.js").RecruitmentPlanner["decide"]>[0]> = [];
  const conversation = createRecruitmentConversation({
    repository: repo,
    referenceNameResolver: resolver,
    briefInterpreter: { async interpret(input) {
      if (input.message.startsWith("推荐类似切尔基")) return withReference;
      if (input.message.startsWith("都不是")) return { ...withReference, referenceRecheck: { quote: "都不是", reject: true } };
      return currentBrief;
    } },
    experimentalDeterministicSearchMode: "enabled",
    experimentalRetrievalMode: "on_demand",
    planner: {
      async decide(input: Parameters<import("../../src/recruitment/conversation.js").RecruitmentPlanner["decide"]>[0]) {
        plannerCalls.push(input);
        return { action: "finish" as const, targetTeam: null, needSummary: "按当前需求完成调查", capabilityProfile: [], recommendations: [], limitationKeys: [] };
      },
    },
    knowledgeBase: { async search() { return []; } },
  });

  const first = await conversation.turn({ threadId: "rejected-reference-after-projection", message: "推荐类似切尔基的球员。" });
  assert.equal(first.question?.input?.kind, "player_identity");
  if (first.question?.input?.kind !== "player_identity") return;
  const rejected = await conversation.turn({
    threadId: "rejected-reference-after-projection",
    message: "都不是，切尔基不是我要找的参考球员。",
    expectsExistingState: true,
    playerIdentityAnswer: { questionId: first.question.input.questionId, rejectAll: true },
  });
  assert.equal(rejected.question?.input, undefined);

  const changed = await conversation.turn({ threadId: "rejected-reference-after-projection", message: "取消参考球员，切尔基不是我要找的参考球员，按当前条件找一名进攻中场。", expectsExistingState: true });
  assert.equal(changed.status, "completed", changed.message);
  const followup = await conversation.turn({ threadId: "rejected-reference-after-projection", message: "继续调查，保持已确认条件", expectsExistingState: true });
  assert.equal(followup.status, "completed", followup.message);
  const anotherFollowup = await conversation.turn({ threadId: "rejected-reference-after-projection", message: "完成当前调查", expectsExistingState: true });
  assert.equal(anotherFollowup.status, "completed", anotherFollowup.message);
  const finalFollowup = await conversation.turn({ threadId: "rejected-reference-after-projection", message: "仍然不需要参考球员，完成报告", expectsExistingState: true });
  assert.equal(finalFollowup.status, "completed", finalFollowup.message);

  assert.equal(plannerCalls.at(-1)?.decisionSnapshot.case.brief?.referencePlayer, null,
    "the current structured brief must remain authoritative after older messages leave the projected history");
  assert.equal(finalFollowup.report?.referenceNameSource, null);
  assert.equal(resolverMentions.length, 2, "projected history must not trigger another resolution for the rejected reference");
});
