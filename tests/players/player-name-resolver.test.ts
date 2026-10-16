import assert from "node:assert/strict";
import test from "node:test";
import { createTavilyBackedPlayerNameResolver, createWikidataPlayerNameResolver } from "../../src/players/identity/name-resolver.js";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import { type PlayerProfile } from "../../src/domain/players.js";

function entity(english = "Mohamed Salah", chinese = "萨拉赫", footballer = true, aliases: string[] = []) {
  return { labels: { en: { value: english }, zh: { value: chinese } }, aliases: { en: aliases.map(value => ({ value })) },
    claims: { P106: [{ mainsnak: { datavalue: { value: { id: footballer ? "Q937857" : "Q49757" } } } }],
      P569: [{ mainsnak: { datavalue: { value: { time: "+1992-06-15T00:00:00Z" } } } }] } };
}

test("multilingual lookup accepts exact simplified/traditional labels and normalizes Latin diacritics", async () => {
  let calls = 0;
  const resolve = createWikidataPlayerNameResolver({ fetchImpl: async input => {
    calls++; const url = new URL(String(input));
    return Response.json(url.searchParams.get("action") === "wbsearchentities"
      ? { search: [{ id: "Q1", match: { text: "萨拉赫" } }, { id: "Q1354960", match: { text: "萨拉赫" } }] }
      : { entities: { Q1: entity("Salach", "萨拉赫", false), Q1354960: {
        ...entity(), labels: { ...entity().labels, "zh-hant": { value: "薩拉赫" } },
      } } });
  } });
  const result = await resolve("萨拉赫");
  assert.equal(result.status, "resolved");
  if (result.status !== "resolved") throw new Error("expected resolved player");
  assert.equal(result.player.entityId, "Q1354960");
  assert.ok(result.player.names.includes("Mohamed Salah"));
  assert.ok(result.player.names.includes("薩拉赫"));
  assert.equal(result.player.sourceUrl, "https://www.wikidata.org/wiki/Q1354960");
  assert.equal((await resolve("薩拉赫")).status, "resolved");
  assert.equal((await resolve("Mohamed Sálah")).status, "resolved");
  assert.deepEqual(await resolve("萨拉赫"), result);
  assert.equal(calls, 12, "each distinct normalized mention uses three language searches and one entity read; repeated mentions are cached");
});

test("ambiguous football names, mismatched labels, and failed lookups do not invent an alias", async () => {
  for (const [index, entities] of [{ Q1: entity(), Q2: entity("Other Salah") }, { Q1: entity("Other", "别人"), Q2: entity("Other", "别人") }].entries()) {
    const resolve = createWikidataPlayerNameResolver({ fetchImpl: async input => Response.json(new URL(String(input)).searchParams.get("action") === "wbsearchentities"
      ? { search: [{ id: "Q1", match: { text: "萨拉赫" } }, { id: "Q2", match: { text: "萨拉赫" } }] } : { entities }) });
    assert.equal((await resolve("萨拉赫")).status, index === 0 ? "ambiguous" : "unresolved");
  }
  const unavailable = createWikidataPlayerNameResolver({ fetchImpl: async () => new Response(null, { status: 503 }) });
  assert.equal((await unavailable("萨拉赫")).status, "unavailable");
  const abort = new AbortController(); abort.abort();
  await assert.rejects(unavailable("萨拉赫", abort.signal));
});

test("exact nickname aliases resolve, while likely misspellings are suggestions that require user confirmation", async () => {
  const resolve = createWikidataPlayerNameResolver({ fetchImpl: async input => {
    const url = new URL(String(input));
    return Response.json(url.searchParams.get("action") === "wbsearchentities"
      ? { search: [{ id: "Q1354960", match: { text: "Mohamed Salah" } }] }
      : { entities: { Q1354960: entity("Mohamed Salah", "萨拉赫", true, ["埃及法老"]) } });
  } });

  const nickname = await resolve("埃及法老");
  assert.equal(nickname.status, "resolved");
  if (nickname.status !== "resolved") throw new Error("verified exact alias should resolve");
  assert.equal(nickname.player.match, "exact_alias");

  const latinTypo = await resolve("Mohamed Sallah");
  assert.equal(latinTypo.status, "needs_confirmation");
  if (latinTypo.status !== "needs_confirmation") throw new Error("typo should not auto-resolve");
  assert.equal(latinTypo.candidates[0]?.entityId, "Q1354960");

  const chineseTypo = await resolve("萨拉黑");
  assert.equal(chineseTypo.status, "needs_confirmation");
});

test("paired identity ablation keeps exact multilingual coverage while typo recall only adds confirmable suggestions", async () => {
  const makeResolver = (enableTypoSuggestions: boolean) => createWikidataPlayerNameResolver({ enableTypoSuggestions,
    fetchImpl: async input => {
      const url = new URL(String(input));
      return Response.json(url.searchParams.get("action") === "wbsearchentities"
        ? { search: [{ id: "Q1354960", match: { text: "Mohamed Salah" } }] }
        : { entities: { Q1354960: entity("Mohamed Salah", "萨拉赫", true, ["埃及法老"]) } });
    } });
  const cases = ["萨拉赫", "Mohamed Salah", "萨拉黑", "Mohamed Sallah"];
  const withTypoRecall = await Promise.all(cases.map(name => makeResolver(true)(name)));
  const exactOnly = await Promise.all(cases.map(name => makeResolver(false)(name)));
  const count = (results: typeof withTypoRecall, status: "resolved" | "needs_confirmation") => results.filter(result => result.status === status).length;

  assert.equal(count(withTypoRecall.slice(0, 2), "resolved"), 2, "both exact labels stay resolvable with typo recall enabled");
  assert.equal(count(exactOnly.slice(0, 2), "resolved"), 2, "exact-only control keeps the same exact-name coverage");
  assert.equal(count(withTypoRecall.slice(2), "needs_confirmation"), 2, "fuzzy recall adds both known typo suggestions");
  assert.equal(count(exactOnly.slice(2), "needs_confirmation"), 0, "exact-only control does not suggest fuzzy matches");
  assert.equal(withTypoRecall.filter(result => result.status === "resolved" && result.player.match === "similar_name").length, 0,
    "the fuzzy arm never auto-confirms an approximate name");
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
      referenceNameResolver: enabled ? async mention => ({ status: "resolved", mention,
        player: { entityId: "Q1354960", sourceUrl: "https://www.wikidata.org/wiki/Q1354960", names: ["萨拉赫", "Mohamed Salah"], preferredName: "Mohamed Salah", match: "exact_alias" },
        resolutionMethod: "wikidata_exact" }) : undefined,
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

test("a confirmed historical reference without a current sample is disclosed as a data gap, not a nonexistent player", async () => {
  const candidate: PlayerProfile = { playerId: "candidate", name: "Other Forward", team: "Santos", age: 22, position: "ST",
    competition: "Fixture League", season: "2025/26", minutes: 1800, source: "Synthetic reference fixture",
    stats: { goals: 10, assists: 0, passesAttempted: 100, passesCompleted: 80, longPasses: 0, carries: 0, pressures: 0,
      tackles: 0, interceptions: 0, shotAssists: 0, keyPasses: 0 } };
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Synthetic reference fixture", async loadPlayers() { return [candidate]; } },
    referenceNameResolver: async mention => ({ status: "resolved", mention,
      player: { entityId: "Q123", sourceUrl: "https://www.wikidata.org/wiki/Q123", names: ["贝利", "Pelé"], preferredName: "Pelé", match: "exact_alias" },
      resolutionMethod: "wikidata_exact" }),
    knowledgeBase: { async search() { return []; } }, experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
    planner: { async decide() { return { action: "finish", targetTeam: "桑托斯", needSummary: "寻找接班线索。", capabilityProfile: ["进球产出"],
      recommendations: [{ playerId: "candidate", evidenceKeys: ["goals" as const] }], limitationKeys: [] }; } },
  });

  const result = await conversation.turn({ threadId: "historical-reference-without-sample",
    message: "为桑托斯寻找贝利的替代者，限定中锋，重点看进球产出。" });
  assert.equal(result.status, "completed");
  assert.equal(result.report?.referenceNameSource?.resolvedName, "Pelé");
  assert.equal(result.report?.referenceNameSource?.performanceRecordStatus, "not_observed_in_team_sample");
  assert.deepEqual(result.report?.referenceProfiles, []);
  assert.deepEqual(result.report?.recommendations.map(item => item.player.playerId), ["candidate"]);
});

test("unique corroborated Tavily and Wikidata evidence resolves, while ambiguous evidence pauses before candidate search", async () => {
  const player = (id: string, name: string): PlayerProfile => ({
    playerId: id, name, team: "Bayern Munich", age: 25, position: "CM", competition: "Fixture League", season: "2025/26", minutes: 1800,
    source: "Synthetic reference fixture", stats: { goals: 5, assists: 0, passesAttempted: 100, passesCompleted: 80,
      longPasses: 0, carries: 0, pressures: 0, tackles: 0, interceptions: 0, shotAssists: 0, keyPasses: 0 },
  });
  const players = [player("kimmich", "Joshua Kimmich"), player("candidate", "Other Midfielder")];
  const wikidata = createWikidataPlayerNameResolver({ fetchImpl: async input => {
    const url = new URL(String(input));
    if (url.searchParams.get("action") === "wbsearchentities") {
      const search = url.searchParams.get("search");
      const id = search === "Joshua Kimmich" ? "Q25369" : search === "Other Footballer" ? "Q99999" : null;
      return Response.json(id ? { search: [{ id, match: { text: search } }] } : { search: [] });
    }
    const id = url.searchParams.get("ids");
    return Response.json({ entities: id === "Q25369" ? { Q25369: entity("Joshua Kimmich", "基米希") }
      : { Q99999: entity("Other Footballer", "其他球员") } });
  } });
  let webSearchCalls = 0;
  const toolCalls = { withFallback: [] as string[], withoutFallback: [] as string[], ambiguous: [] as string[] };
  const searchFetcher = (ambiguous: boolean): typeof fetch => async (_input, init) => {
      webSearchCalls++;
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-key");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.match(String(body.query), /基米希/);
      assert.equal(body.include_answer, false);
      assert.equal(body.include_raw_content, false);
      return Response.json({ results: [
        { title: "Joshua Kimmich | FC Bayern", url: "https://fcbayern.com/en/teams/first-team/joshua-kimmich", content: "Joshua Kimmich is a footballer." },
        { title: "Joshua Kimmich - Wikipedia", url: "https://en.wikipedia.org/wiki/Joshua_Kimmich", content: "Joshua Kimmich is a German footballer." },
        ...(ambiguous ? [
          { title: "Other Footballer | Club Site", url: "https://club.example/other-player", content: "Other Footballer is a midfielder." },
          { title: "Other Footballer - Player Profile", url: "https://players.example/other-footballer", content: "Other Footballer is a midfielder." },
        ] : []),
      ] });
  };
  const referenceNameResolver = createTavilyBackedPlayerNameResolver({ apiKey: "fixture-key", primaryResolver: async mention => mention === "基米希"
    ? { status: "unresolved", mention } : wikidata(mention), fetcher: searchFetcher(false) });
  const ambiguousResolver = createTavilyBackedPlayerNameResolver({ apiKey: "fixture-key", primaryResolver: wikidata, fetcher: searchFetcher(true) });
  async function makeConversation(resolver: typeof referenceNameResolver, observedTools: string[]) {
    return createRecruitmentConversation({
      repository: { mode: "demo", sourceName: "Synthetic reference fixture", async loadPlayers() { return players; } },
      referenceNameResolver: resolver,
      knowledgeBase: { async search() { return []; } },
      experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
      observer: event => { if (event.phase === "tool") observedTools.push(event.toolName); },
      planner: { async decide() { return { action: "finish", targetTeam: "拜仁", needSummary: "寻找基米希替代者。", capabilityProfile: ["进球产出"],
        recommendations: players.map(p => ({ playerId: p.playerId, evidenceKeys: ["goals" as const] })), limitationKeys: [] }; } },
    });
  }

  const [withFallbackConversation, withoutFallbackConversation, ambiguousConversation] = await Promise.all([
    makeConversation(referenceNameResolver, toolCalls.withFallback),
    makeConversation(async mention => ({ status: "unresolved", mention }), toolCalls.withoutFallback),
    makeConversation(ambiguousResolver, toolCalls.ambiguous),
  ]);
  const [withFallback, withoutFallback, ambiguous] = await Promise.all([
    withFallbackConversation.turn({ threadId: "tavily-reference-enabled", message: "为拜仁寻找基米希的替代者，限定中前卫，重点看进球产出。" }),
    withoutFallbackConversation.turn({ threadId: "tavily-reference-bypassed", message: "为拜仁寻找基米希的替代者，限定中前卫，重点看进球产出。" }),
    ambiguousConversation.turn({ threadId: "tavily-reference-ambiguous", message: "为拜仁寻找基米希的替代者，限定中前卫，重点看进球产出。" }),
  ]);

  assert.equal(webSearchCalls, 2, "Tavily runs only for enabled fallbacks, never before exact lookup");
  assert.equal(withFallback.status, "completed", "one entity corroborated on two hosts and verified as a footballer is sufficient to continue");
  assert.equal(withoutFallback.status, "needs_input", "unresolved identity pauses instead of searching as if confirmed");
  assert.equal(ambiguous.status, "needs_input", "multiple web candidates are shown for confirmation before any candidate search");
  assert.equal(toolCalls.withFallback.includes("search_candidates"), true, "the unique corroborated identity allows candidate search");
  assert.equal(toolCalls.withoutFallback.includes("search_candidates"), false, "no web fallback keeps an unverified identity paused");
  assert.equal(toolCalls.ambiguous.includes("search_candidates"), false, "ambiguous identity must pause before candidate search");
  assert.equal(withoutFallback.question?.input, undefined, "a name with no verified candidates asks for more identifying context in plain language");
  assert.equal(ambiguous.question?.input?.kind, "player_identity");
  assert.equal(withoutFallback.report, null);
  assert.equal(ambiguous.report, null);
  assert.deepEqual(withFallback.report?.recommendations.map(item => item.player.playerId), ["candidate"]);
  assert.equal(withFallback.report?.referenceNameSource?.entityId, "Q25369");
  assert.equal(withFallback.report?.referenceNameSource?.resolutionMethod, "tavily_wikidata");
});

test("ambiguous identity pauses the graph and a user selection rechecks context before excluding that player", async () => {
  const makePlayer = (id: string, name: string): PlayerProfile => ({
    playerId: id, name, team: "Bayern Munich", age: 25, position: "CM", competition: "Fixture League", season: "2025/26", minutes: 1800,
    source: "Synthetic reference fixture", stats: { goals: 5, assists: 0, passesAttempted: 100, passesCompleted: 80,
      longPasses: 0, carries: 0, pressures: 0, tackles: 0, interceptions: 0, shotAssists: 0, keyPasses: 0 },
  });
  const players = [makePlayer("kimmich", "Joshua Kimmich"), makePlayer("other", "Other Midfielder")];
  const candidate = (entityId: string, preferredName: string) => ({ entityId,
    sourceUrl: `https://www.wikidata.org/wiki/${entityId}`, names: [preferredName], preferredName, match: "exact_alias" as const });
  let resolverCalls = 0;
  const resolver = async (mention: string) => {
    resolverCalls++;
    return { status: "ambiguous" as const, mention, candidates: [candidate("Q25369", "Joshua Kimmich"), candidate("Q99999", "Other Midfielder")] };
  };
  const toolCalls: string[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Synthetic reference fixture", async loadPlayers() { return players; }, async inspectTeam() { return players; } },
    referenceNameResolver: resolver,
    knowledgeBase: { async search() { return []; } },
    experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
    observer: event => { if (event.phase === "tool") toolCalls.push(event.toolName); },
    planner: { async decide() { return { action: "finish", targetTeam: "拜仁", needSummary: "寻找基米希的接班人。", capabilityProfile: ["进球产出"],
      recommendations: players.map(player => ({ playerId: player.playerId, evidenceKeys: ["goals" as const] })), limitationKeys: [] }; } },
  });

  const first = await conversation.turn({ threadId: "identity-confirmation", message: "为拜仁寻找基米希的替代者，限定中前卫，重点看进球产出。" });
  assert.equal(first.status, "needs_input");
  assert.equal(first.report, null);
  assert.equal(toolCalls.includes("search_candidates"), false, "an uncertain reference must pause before candidate search");
  assert.equal(first.question?.input?.kind, "player_identity");
  if (first.question?.input?.kind !== "player_identity") throw new Error("identity choices should be returned to the UI");

  const second = await conversation.turn({
    threadId: "identity-confirmation", message: "选择 Joshua Kimmich", expectsExistingState: true,
    playerIdentityAnswer: { questionId: first.question.input.questionId, entityId: "Q25369" },
  });

  assert.equal(second.status, "completed");
  assert.equal(resolverCalls, 1, "the selected, verified entity is reused instead of re-guessing after confirmation");
  assert.equal(toolCalls.filter(name => name === "inspect_team").length, 2, "team/reference context is inspected again after identity confirmation");
  assert.ok(toolCalls.includes("search_candidates"), "candidate investigation starts only after the identity is confirmed");
  assert.equal(second.report?.referenceNameSource?.entityId, "Q25369");
  assert.deepEqual(second.report?.recommendations.map(item => item.player.playerId), ["other"]);
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
    referenceNameResolver: async mention => { mentions.push(mention); const entityId = mention === "萨拉赫" ? "Q1354960" : "Q107365";
      const names = mention === "萨拉赫" ? ["萨拉赫", "Mohamed Salah"] : ["诺伊尔", "Manuel Neuer"];
      return { status: "resolved", mention, player: { entityId,
        sourceUrl: `https://www.wikidata.org/wiki/${entityId}`, names, preferredName: names[1]!, match: "exact_alias" }, resolutionMethod: "wikidata_exact" }; },
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
