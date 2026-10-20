import assert from "node:assert/strict";
import test, { after } from "node:test";
import { RecruitmentBriefValidationError, validateRecruitmentBrief, type RecruitmentBrief } from "../../src/recruitment/brief.js";
import { candidateMatchesSearchIntent, resolveCandidateSearchIntent } from "../../src/recruitment/candidate-search-intent.js";
import { searchPlayerPage } from "../../src/players/repository.js";
import type { PlayerSearchQuery } from "../../src/players/search.js";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import { installRecruitmentConversationTestEnvironment, roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

after(installRecruitmentConversationTestEnvironment());
const makeBrief = (): RecruitmentBrief => ({ task: "similarity", targetTeam: null,
  referencePlayer: { value: "切尔基", quote: "切尔基", basis: "explicit" }, selectedCandidateId: null, positions: [], allowsAnyPosition: false, priorities: [],
  constraints: [], filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null }, unresolved: [] });

test("similarity intent inherits an observed reference position without requiring a team", () => {
  const intent = resolveCandidateSearchIntent({ brief: makeBrief(), userMessages: ["推荐类似切尔基的球员"], confirmedPosition: null, replacementReferencePosition: "AM" });
  assert.equal(intent.replacementRequest, true);
  assert.equal(intent.position, "AM");
  assert.ok(intent.replacementTargetNames.includes("切尔基"));
});

test("brief validation grounds an explicit numeric age filter in the user's exact quote", () => {
  const candidate = { ...makeBrief(), filters: { ...makeBrief().filters, maxAge: 23 } };

  const brief = validateRecruitmentBrief(candidate, ["推荐类似切尔基的球员，23 岁以下"]);

  assert.deepEqual(brief.constraints, [{
    kind: "age",
    strength: "required",
    requirement: { value: "23 岁以下", basis: "explicit", quote: "23 岁以下" },
  }]);
});

test("brief validation normalizes an explicit age ceiling to the value parsed from the user's words", () => {
  const candidate = {
    ...makeBrief(),
    filters: { ...makeBrief().filters, maxAge: 22 },
    constraints: [{
      kind: "age" as const,
      strength: "required" as const,
      requirement: { value: "23 岁以下", basis: "explicit" as const, quote: "23 岁以下" },
    }],
  };

  const brief = validateRecruitmentBrief(candidate, ["推荐类似切尔基的球员，23 岁以下"]);

  assert.equal(brief.filters.maxAge, 23);
  assert.equal(brief.constraints[0]?.requirement.quote, "23 岁以下");
});

test("brief validation replaces an older age constraint when the user changes the ceiling", () => {
  const prior = validateRecruitmentBrief({
    ...makeBrief(),
    task: "reinforcement",
    targetTeam: { value: "巴萨", basis: "explicit", quote: "巴萨" },
    referencePlayer: null,
    filters: { ...makeBrief().filters, maxAge: 23 },
  }, ["为巴萨找中卫，23 岁以下"]);
  const modelOutput = {
    ...prior,
    filters: { ...prior.filters, maxAge: 24 },
  };

  const brief = validateRecruitmentBrief(modelOutput, [
    "为巴萨找中卫，23 岁以下",
    "把年龄上限改为24 岁以下，继续找巴萨中卫。",
  ], [], prior);

  assert.equal(brief.filters.maxAge, 24);
  assert.deepEqual(brief.constraints.filter(item => item.kind === "age"), [{
    kind: "age",
    strength: "required",
    requirement: { value: "24 岁以下", basis: "explicit", quote: "24 岁以下" },
  }]);
});

test("brief validation removes a prior age constraint when the user makes age unrestricted", () => {
  const prior = validateRecruitmentBrief({
    ...makeBrief(),
    task: "reinforcement",
    targetTeam: { value: "巴萨", basis: "explicit", quote: "巴萨" },
    referencePlayer: null,
    filters: { ...makeBrief().filters, maxAge: 23 },
  }, ["为巴萨找中卫，23 岁以下"]);
  const modelOutput = { ...prior };

  const brief = validateRecruitmentBrief(modelOutput, [
    "为巴萨找中卫，23 岁以下",
    "年龄不限，继续找巴萨中卫。",
  ], [], prior);

  assert.equal(brief.filters.maxAge, null);
  assert.deepEqual(brief.constraints.filter(item => item.kind === "age"), []);
});

test("brief validation preserves every explicit capability omitted by the model summary", () => {
  const candidate = { ...makeBrief(), priorities: [
    { value: "前场压迫", basis: "explicit" as const, quote: "前场压迫" },
  ] };

  const brief = validateRecruitmentBrief(candidate, ["推荐类似切尔基的球员，重点看推进和前场压迫"]);
  const intent = resolveCandidateSearchIntent({ brief, userMessages: ["推荐类似切尔基的球员，重点看推进和前场压迫"], confirmedPosition: null });

  assert.ok(brief.priorities.some(({ value, basis }) => value === "推进" && basis === "explicit"));
  assert.ok(intent.discoveryMetricGroups.some((group) => group.includes("wyscoutProgressivePassesPer90")));
});

test("a structured brief is the source of requested capability discovery groups", () => {
  const brief = { ...makeBrief(), priorities: [
    { value: "创造机会", basis: "explicit" as const, quote: "给队友喂饼" },
    { value: "进球产出", basis: "inferred" as const, quote: "" },
  ] };
  const validatedBrief = validateRecruitmentBrief(brief, ["推荐类似切尔基的球员，给队友喂饼"]);

  const intent = resolveCandidateSearchIntent({
    brief: validatedBrief,
    userMessages: ["推荐类似切尔基的球员，给队友喂饼"],
    confirmedPosition: null,
  });

  assert.equal(intent.discoveryMetricGroups.length, 1);
  assert.ok(intent.discoveryMetricGroups[0]?.includes("shotAssists"));
  assert.ok(!intent.discoveryMetricGroups.some((group) => group.includes("goals")), "an inferred capability must not become a requested search dimension");
});

test("capability discovery falls back to the original request before a brief exists", () => {
  const intent = resolveCandidateSearchIntent({
    brief: null,
    userMessages: ["找一个能进球、也能给队友喂饼的前锋"],
    confirmedPosition: null,
  });

  assert.ok(intent.discoveryMetricGroups.some((group) => group.includes("goals")));
  assert.ok(intent.discoveryMetricGroups.some((group) => group.includes("shotAssists")));
});

test("an explicit fine position cannot be broadened by model output", () => {
  const brief = { ...makeBrief(), task: "reinforcement", referencePlayer: null, positions: ["MID"] };
  assert.deepEqual(validateRecruitmentBrief(brief, ["找一个能拿球推进的中前卫"]).positions, ["CM"]);
  assert.deepEqual(validateRecruitmentBrief({ ...brief, positions: ["FB"] }, ["找一位左后卫"]).positions, ["LB"]);
  assert.deepEqual(validateRecruitmentBrief({ ...brief, positions: ["WG"] }, ["找一位右边锋"]).positions, ["RW"]);
  const accepted = validateRecruitmentBrief({ ...brief, positions: ["CM", "DM"] }, ["中前卫或后腰都可以"]);
  assert.deepEqual(accepted.positions, ["CM", "DM"]);
});

test("unrestricted midfield subpositions stay within the midfield group even if the model says any position", () => {
  const message = "为巴萨找一名 23 岁以下的中场候选，CM、DM、AM 等子位置都可以，不限定具体子位置；重点看推进和前场压迫能力。";
  const modelBrief = {
    ...makeBrief(),
    task: "reinforcement" as const,
    targetTeam: { value: "巴萨", basis: "explicit" as const, quote: "巴萨" },
    referencePlayer: null,
    positions: [],
    allowsAnyPosition: true,
  };

  const brief = validateRecruitmentBrief(modelBrief, [message]);
  const intent = resolveCandidateSearchIntent({ brief, userMessages: [message], confirmedPosition: null });

  assert.deepEqual(brief.positions, ["MID"]);
  assert.equal(brief.allowsAnyPosition, false);
  assert.equal(intent.position, "MID");
  assert.equal(intent.allowsAnyPosition, false);
});

test("grounding rejects fabricated explicit quotes, inferred hard constraints and ungrounded filters", () => {
  const brief = makeBrief();
  assert.deepEqual(validateRecruitmentBrief(brief, ["推荐类似切尔基的球员"]), brief);
  assert.throws(() => validateRecruitmentBrief(brief, ["推荐球员"]));
  assert.throws(() => validateRecruitmentBrief({ ...brief, filters: { ...brief.filters, maxAge: 23 } }, ["推荐类似切尔基的球员"]));
  assert.throws(() => validateRecruitmentBrief({ ...brief, constraints: [{ kind: "budget", strength: "required", requirement: { value: "2000万", basis: "inferred", quote: "" } }] }, ["便宜版切尔基"]));
  assert.throws(() => validateRecruitmentBrief({ ...brief, referencePlayer: { value: "Rayan Cherki", basis: "explicit", quote: "切尔基" } }, ["切尔基"]));
  assert.throws(() => validateRecruitmentBrief({ ...brief, filters: { ...brief.filters, maxAge: 55 }, constraints: [{ kind: "age", strength: "required", requirement: { value: "55岁以下", basis: "explicit", quote: "23岁以下" } }] }, ["切尔基 23岁以下"]));
});

test("ungrounded reference clues are discarded and target clubs cannot leak into player identity", () => {
  const previous = { ...makeBrief(), task: "replacement" as const,
    targetTeam: { value: "拜仁", basis: "explicit" as const, quote: "拜仁" },
    referencePlayer: { value: "罗德里", basis: "explicit" as const, quote: "罗德里" } };
  const message = "为拜仁找罗德里的替代者";
  assert.deepEqual(validateRecruitmentBrief({ ...previous,
    referenceClues: [{ kind: "position", value: "DM", quote: "罗德里" }] }, [message]).referenceClues, []);
  assert.deepEqual(validateRecruitmentBrief({ ...previous,
    referenceClues: [{ kind: "team", value: "拜仁", quote: message }] }, [message]).referenceClues, []);
  assert.deepEqual(validateRecruitmentBrief({ ...previous,
    referenceClues: [{ kind: "nationality", value: "巴西", quote: "罗德里" }] }, [message]).referenceClues, []);
  const supported = { ...makeBrief(), referencePlayer: { value: "巴西的罗纳尔多", basis: "explicit" as const, quote: "巴西的罗纳尔多" },
    referenceClues: [{ kind: "nationality" as const, value: "巴西", quote: "巴西的罗纳尔多" }] };
  assert.deepEqual(validateRecruitmentBrief(supported, ["推荐类似巴西的罗纳尔多的球员"]).referenceClues, supported.referenceClues);
});

test("positions inferred from a famous reference do not become user constraints", () => {
  const rodri = { ...makeBrief(), task: "replacement" as const,
    targetTeam: { value: "拜仁", basis: "explicit" as const, quote: "拜仁" },
    referencePlayer: { value: "罗德里", basis: "explicit" as const, quote: "罗德里" }, positions: ["CM" as const, "DM" as const] };
  const parsed = validateRecruitmentBrief(rodri, ["为拜仁找罗德里的替代者"]);
  assert.deepEqual(parsed.positions, []);
  assert.equal(validateRecruitmentBrief({ ...makeBrief(), allowsAnyPosition: true }, ["推荐类似切尔基的球员"]).allowsAnyPosition, false);
  const explicit = validateRecruitmentBrief({ ...rodri, positions: [] }, ["为拜仁找罗德里的替代者，要中前卫或后腰"]);
  assert.deepEqual(explicit.positions, ["CM", "DM"]);
});

test("an identity ambiguity uses verified options and resumes the same graph without requiring a club", async () => {
  let resolutions = 0;
  const reference = roleConstraintPlayer("reference", "Rayan Cherki", "AM");
  const candidate = roleConstraintPlayer("candidate", "Candidate", "AM");
  const entity = { entityId: "Q123", preferredName: reference.name, names: [reference.name, "切尔基"], match: "similar_name" as const, sourceUrl: "https://www.wikidata.org/wiki/Q123" };
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret() { return { ...makeBrief(), unresolved: [{ topic: "identity", question: "需要工具确认身份", impact: "先核查" }] }; } },
    referenceNameResolver: async mention => { resolutions++; return { status: "needs_confirmation", mention, candidates: [entity] }; },
    repository: { mode: "demo", sourceName: "Fixture", async findPlayersByNames() { return [reference]; }, async loadPlayers() { return [reference, candidate]; } },
    experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
    knowledgeBase: { async search() { return []; } },
    planner: { async decide() { return { action: "finish", targetTeam: null, needSummary: "推荐", capabilityProfile: [], recommendations: [{ playerId: candidate.playerId, evidenceKeys: ["shotAssists"] }], limitationKeys: [] }; } },
  });
  const first = await conversation.turn({ threadId: "identity-resume", message: "推荐类似切尔基的球员" });
  assert.equal(first.status, "needs_input");
  assert.equal(first.question?.input?.kind, "player_identity");
  const question = first.question!.input!;
  assert.equal(question.kind, "player_identity");
  const second = await conversation.turn({ threadId: "identity-resume", message: "选择参考球员", playerIdentityAnswer: { questionId: question.questionId, entityId: "Q123" }, expectsExistingState: true });
  assert.equal(second.status, "completed", second.message);
  assert.ok(second.report?.recommendations.length);
  assert.equal(resolutions, 1, "confirmed identity is reused, rather than searched again");
});

test("an interpreter failure does not fall through to a guessed search or an empty-market claim", async () => {
  let reads = 0;
  const stages: string[] = [];
  const traces: Array<Record<string, unknown>> = [];
  const networkFailure = Object.assign(new Error("secret transport details"), { code: "ECONNREFUSED" });
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret() { throw new Error("secret validation details", { cause: networkFailure }); } },
    repository: { mode: "demo", sourceName: "Fixture", async loadPlayers() { reads++; return []; } },
    planner: { async decide() { throw new Error("must not plan a guessed task"); } },
    knowledgeBase: { async search() { return []; } },
    observer: event => traces.push(event),
  });
  const response = await conversation.turn({ threadId: "failed-understanding", message: "推荐类似切尔基的球员", onProgress: event => stages.push(event.stage) });
  assert.match(response.message, /重试|补充/);
  assert.doesNotMatch(response.message, /没有符合|没有候选/);
  assert.equal(reads, 0);
  assert.equal(response.report, null);
  assert.equal(response.retryMessage, "推荐类似切尔基的球员");
  assert.equal(stages.at(-1), "failed");
  assert.deepEqual(traces.find(event => event.phase === "brief_failure"), {
    phase: "brief_failure",
    failureKind: "Error",
    failureCode: "ECONNREFUSED",
  });
  assert.doesNotMatch(JSON.stringify(traces), /secret validation details|secret transport details/);
});

test("brief validation failures expose a safe reason code without raw validation text", async () => {
  const traces: Array<Record<string, unknown>> = [];
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret() { throw new RecruitmentBriefValidationError("PRIVATE_QUOTE_DO_NOT_EXPORT", "quote_not_verbatim"); } },
    repository: { mode: "demo", sourceName: "Fixture", async loadPlayers() { return []; } },
    planner: { async decide() { throw new Error("must not plan an invalid brief"); } },
    knowledgeBase: { async search() { return []; } },
    observer: event => traces.push(event),
  });

  await conversation.turn({ threadId: "brief-safe-validation-code", message: "推荐类似切尔基的球员" });

  assert.deepEqual(traces.find(event => event.phase === "brief_failure"), {
    phase: "brief_failure",
    failureKind: "RecruitmentBriefValidationError",
    validationCode: "quote_not_verbatim",
  });
  assert.doesNotMatch(JSON.stringify(traces), /PRIVATE_QUOTE_DO_NOT_EXPORT/);
});

test("structured removal overrides an older explicit age limit", () => {
  const intent = resolveCandidateSearchIntent({ brief: makeBrief(), userMessages: ["23岁以下，类似切尔基", "取消年龄限制"], confirmedPosition: null });
  assert.equal(intent.maxAge, null);
});

test("a new reinforcement task clears an earlier reference and an earlier any-position instruction", () => {
  const brief = { ...makeBrief(), task: "reinforcement" as const, referencePlayer: null, positions: ["CB" as const] };
  const intent = resolveCandidateSearchIntent({ brief, userMessages: ["找凯恩的替代者，位置不限", "换个任务，找中卫"], confirmedPosition: null });
  assert.equal(intent.replacementRequest, false);
  assert.equal(intent.allowsAnyPosition, false);
  assert.equal(intent.position, "CB");
  assert.deepEqual(intent.replacementTargetNames, []);
});

test("explicit any-position preference overrides automatic reference position recall", () => {
  const brief = { ...makeBrief(), allowsAnyPosition: true };
  const intent = resolveCandidateSearchIntent({ brief, userMessages: ["位置不限"], referencePositions: ["AM", "RW"], confirmedPosition: null });
  assert.equal(intent.position, null);
  assert.ok(!intent.positions?.length);
});

test("a generic defender request is not silently narrowed to centre back", () => {
  const brief = { ...makeBrief(), task: "reinforcement", referencePlayer: null, positions: ["CB"] };
  assert.deepEqual(validateRecruitmentBrief(brief, ["我想为巴萨找一个新的后卫"]).positions, ["DEF"]);
});

test("the full graph keeps an explicit English fine position when the model omits it", async () => {
  const candidate = roleConstraintPlayer("english-left-back", "Left Back Candidate", "LB");
  const modelBrief = { ...makeBrief(), task: "reinforcement" as const, referencePlayer: null, positions: [] };
  const searches: PlayerSearchQuery[] = [];
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret(input) {
      return validateRecruitmentBrief(modelBrief, [...input.recentMessages, input.message]);
    } },
    repository: {
      mode: "demo",
      sourceName: "Fixture",
      async loadPlayers() { return [candidate]; },
      async searchCandidates(query) {
        searches.push(query);
        return { players: [candidate], totalRecords: 1, nextOffset: null, offset: query.offset, appliedFilters: ["position"] };
      },
    },
    experimentalDeterministicSearchMode: "enabled",
    experimentalRetrievalMode: "on_demand",
    knowledgeBase: { async search() { return []; } },
    planner: { async decide() {
      return { action: "finish", targetTeam: null, needSummary: "寻找左后卫", capabilityProfile: [],
        recommendations: [{ playerId: candidate.playerId, evidenceKeys: ["tacklesInterceptions"] }], limitationKeys: [] };
    } },
  });

  const response = await conversation.turn({ threadId: "english-left-back", message: "Please find a left-back." });

  assert.deepEqual(response.brief?.positions, ["LB"]);
  assert.ok(searches.length > 0, "the graph must actually run candidate search");
  assert.ok(searches.every(query => query.position === "LB" || query.positions?.length === 1 && query.positions[0] === "LB"),
    `every search must stay scoped to left-back; got ${JSON.stringify(searches.map(({ position, positions }) => ({ position, positions })))}`);
});

test("the full graph uses normalized capability intent for search, review, and report coverage", async () => {
  const candidate = roleConstraintPlayer("chance-creator", "Chance Creator", "ST");
  const message = "给拜仁找个中锋，要能给队友喂饼";
  const searches: PlayerSearchQuery[] = [];
  const plannerRequests: Array<Record<string, unknown>> = [];
  const trace: Array<Record<string, unknown>> = [];
  const modelBrief = { ...makeBrief(), task: "reinforcement" as const,
    targetTeam: { value: "拜仁", basis: "explicit" as const, quote: "拜仁" },
    referencePlayer: null,
    positions: ["ST" as const],
    priorities: [{ value: "创造机会", basis: "explicit" as const, quote: "给队友喂饼" }],
  };
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret(input) {
      return validateRecruitmentBrief(modelBrief, [...input.recentMessages, input.message]);
    } },
    repository: {
      mode: "demo",
      sourceName: "Fixture",
      async loadPlayers() { return [candidate]; },
      async searchCandidates(query) {
        searches.push(query);
        return { players: [candidate], totalRecords: 1, nextOffset: null, offset: query.offset, appliedFilters: ["position"] };
      },
    },
    experimentalDeterministicSearchMode: "enabled",
    experimentalRetrievalMode: "on_demand",
    knowledgeBase: { async search() { return []; } },
    observer: event => trace.push(event as unknown as Record<string, unknown>),
    planner: { async decide(input) {
      plannerRequests.push(input as unknown as Record<string, unknown>);
      return { action: "finish", targetTeam: "拜仁", needSummary: "寻找能创造机会的中锋", capabilityProfile: [],
        recommendations: [{ playerId: candidate.playerId, evidenceKeys: ["goals"] }], limitationKeys: [] };
    } },
  });

  const response = await conversation.turn({ threadId: "normalized-capability-intent", message });

  assert.equal(response.status, "completed", response.message);
  assert.equal(plannerRequests[0]?.decisionMode, "reorient");
  assert.deepEqual(plannerRequests[0]?.availableActions, ["search_candidates", "ask_user", "finish"]);
  assert.ok(trace.some(event => event.phase === "tool" && event.toolName === "search_candidates"));
  assert.ok(trace.some(event => event.phase === "tool" && event.toolName === "evaluate_candidates"));
  assert.ok(!trace.some(event => event.phase === "tool" && event.toolName === "search_methodology"), "on-demand retrieval should not run a fixed methodology lookup for an observable capability");
  assert.ok(searches.some((query) => query.discoveryMetricGroups?.some((group) => group.includes("shotAssists"))));
  assert.equal(response.report?.requestedCapabilityCoverage.find(({ name }) => name === "创造机会")?.status, "observed");
  assert.ok(response.report?.recommendations[0]?.focusEvidenceKeys.some((key) => key === "shotAssists" || key === "keyPasses" || key === "assists"));
});

test("an undecided position is not converted into unrestricted acceptance", () => {
  const brief = { ...makeBrief(), task: "reinforcement", referencePlayer: null, positions: [], allowsAnyPosition: true };
  const result = validateRecruitmentBrief(brief, ["想找一位新球员补强，但还没确定补强哪个位置。"]);
  assert.equal(result.allowsAnyPosition, false);
  assert.equal(result.unresolved[0]?.topic, "position");
  assert.equal(validateRecruitmentBrief(brief, ["任何位置都可以"]).allowsAnyPosition, true);
});

test("league exclusion recognizes provider names before pagination and leaves unknown affiliations out", async () => {
  const brief = makeBrief();
  brief.filters.excludedCompetitions = ["EPL"];
  brief.constraints = [{ kind: "competition", strength: "required", requirement: { value: "排除英超", basis: "explicit", quote: "不要英超的" } }];
  validateRecruitmentBrief(brief, ["推荐类似切尔基的球员，不要英超的"]);
  const players = [
    { ...roleConstraintPlayer("english", "English", "AM"), competition: "英超" },
    { ...roleConstraintPlayer("german", "German", "AM"), competition: "德甲" },
    { ...roleConstraintPlayer("unknown", "Unknown", "AM"), competition: "" },
  ];
  const page = await searchPlayerPage({ mode: "demo", sourceName: "Fixture", async loadPlayers() { return players; } }, {
    position: "AM", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, excludedCompetitions: ["EPL"], offset: 0, limit: 1,
  });
  assert.deepEqual(page.players.map(player => player.playerId), ["german"]);
  assert.equal(page.totalRecords, 1);
  assert.equal(page.nextOffset, null);
  const intent = resolveCandidateSearchIntent({ brief, userMessages: ["不要英超的"], confirmedPosition: "AM" });
  assert.equal(candidateMatchesSearchIntent(players[0]!, intent), false);
  assert.equal(candidateMatchesSearchIntent(players[2]!, intent), false);
});

test("visible candidate pointers resolve from the actual order rather than trusting a model-selected id", () => {
  const candidates = [{ playerId: "one", name: "First", rank: 1 }, { playerId: "two", name: "Second", rank: 2 }, { playerId: "three", name: "Third", rank: 3 }];
  const brief = { ...makeBrief(), selectedCandidateId: "three", referencePlayer: { value: "Third", quote: "第三个", basis: "explicit" as const } };
  assert.equal(validateRecruitmentBrief(brief, ["第三个这种类型"], candidates).selectedCandidateId, "three");
  const normalized = validateRecruitmentBrief({ ...brief, referencePlayer: { ...brief.referencePlayer, quote: "Third" } }, ["第三个这种类型"], candidates);
  assert.equal(normalized.referencePlayer?.quote, "第三个这种类型");
  const corrected = validateRecruitmentBrief({ ...brief, selectedCandidateId: "two", referencePlayer: { ...brief.referencePlayer, value: "Second" } }, ["第三个这种类型"], candidates);
  assert.equal(corrected.selectedCandidateId, "three");
  assert.equal(corrected.referencePlayer?.value, "Third");
  assert.throws(() => validateRecruitmentBrief(brief, ["第三个这种类型"], []));
});

test("an unselected visible candidate cannot replace the prior reference during a continuation", () => {
  const candidates = [{ playerId: "one", name: "First", rank: 1 }, { playerId: "two", name: "Second", rank: 2 }];
  const previous = makeBrief();
  const continuation = "继续当前调查，保留已经看过的候选";
  const modelBrief = {
    ...previous,
    selectedCandidateId: "two",
    referencePlayer: { value: "Second", quote: continuation, basis: "explicit" as const },
  };

  const validated = validateRecruitmentBrief(modelBrief, ["推荐类似切尔基的球员", continuation], candidates, previous);

  assert.equal(validated.selectedCandidateId, null);
  assert.equal(validated.task, previous.task);
  assert.deepEqual(validated.referencePlayer, previous.referencePlayer);
});

test("the full graph keeps its reference when a continuation does not select a shortlist candidate", async () => {
  const reference = roleConstraintPlayer("original-reference", "Rayan Cherki", "AM");
  const candidates = [1, 2, 3].map(index => roleConstraintPlayer(`candidate-${index}`, `Candidate ${index}`, "AM"));
  let continuationSelectionWasRemoved = false;
  const continuation = "继续当前调查，保留已经看过的候选";
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret(input) {
      if (!input.previous) return makeBrief();
      const selected = input.visibleCandidates?.[0];
      assert.ok(selected);
      const validated = validateRecruitmentBrief({
        ...input.previous,
        selectedCandidateId: selected.playerId,
        referencePlayer: { value: selected.name, quote: continuation, basis: "explicit" },
      }, [...input.recentMessages, input.message], input.visibleCandidates, input.previous);
      continuationSelectionWasRemoved = validated.selectedCandidateId === null;
      return validated;
    } },
    referenceNameResolver: async mention => ({ status: "resolved", mention, resolutionMethod: "wikidata_exact", player: {
      entityId: "Q123", preferredName: reference.name, names: [reference.name, "切尔基"], match: "exact_alias", sourceUrl: "https://www.wikidata.org/wiki/Q123",
    } }),
    repository: { mode: "demo", sourceName: "Fixture", async findPlayersByNames() { return [reference]; }, async loadPlayers() { return [reference, ...candidates]; } },
    experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
    knowledgeBase: { async search() { return []; } },
    planner: { async decide() { return { action: "finish", targetTeam: null, needSummary: "继续比较当前候选。", capabilityProfile: [],
      recommendations: candidates.map(player => ({ playerId: player.playerId, evidenceKeys: ["shotAssists"] })), limitationKeys: [] }; } },
  });

  const first = await conversation.turn({ threadId: "continue-shortlist-without-selection", message: "推荐类似切尔基的球员" });
  assert.equal(first.status, "completed", first.message);
  const second = await conversation.turn({ threadId: "continue-shortlist-without-selection", message: continuation, expectsExistingState: true });

  assert.equal(second.status, "completed", second.message);
  assert.equal(continuationSelectionWasRemoved, true);
  assert.equal(second.brief?.selectedCandidateId, null);
  assert.equal(second.brief?.referencePlayer?.value, "切尔基");
  assert.equal(second.brief?.task, "similarity");
});

test("full graph follows the third visible candidate as the next reference without another identity lookup", async () => {
  const reference = roleConstraintPlayer("original-reference", "Rayan Cherki", "AM");
  const candidates = [1, 2, 3].map(index => roleConstraintPlayer(`candidate-${index}`, `Candidate ${index}`, "AM"));
  let lookups = 0;
  let seenCandidates: readonly { playerId: string; name: string; rank: number }[] = [];
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret(input) {
      if (!input.previous) return makeBrief();
      seenCandidates = input.visibleCandidates ?? [];
      const third = seenCandidates.find(candidate => candidate.rank === 3)!;
      return validateRecruitmentBrief({ ...input.previous, selectedCandidateId: third.playerId,
        referencePlayer: { value: third.name, quote: "第三个", basis: "explicit" } }, [...input.recentMessages, input.message], input.visibleCandidates);
    } },
    referenceNameResolver: async mention => { lookups++; return { status: "resolved", mention, resolutionMethod: "wikidata_exact", player: {
      entityId: "Q123", preferredName: reference.name, names: [reference.name, "切尔基"], match: "exact_alias", sourceUrl: "https://www.wikidata.org/wiki/Q123",
    } }; },
    repository: { mode: "demo", sourceName: "Fixture", async findPlayersByNames() { return [reference]; }, async loadPlayers() { return [reference, ...candidates]; } },
    experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand", knowledgeBase: { async search() { return []; } },
    planner: { async decide() { return { action: "finish", targetTeam: null, needSummary: "相似候选", capabilityProfile: [],
      recommendations: candidates.map(player => ({ playerId: player.playerId, evidenceKeys: ["shotAssists"] })), limitationKeys: [] }; } },
  });
  const first = await conversation.turn({ threadId: "candidate-pointer", message: "推荐类似切尔基的球员" });
  assert.equal(first.report?.recommendations.length, 3);
  const actualThird = first.report!.recommendations[2]!.player;
  const second = await conversation.turn({ threadId: "candidate-pointer", message: "第三个这种类型再推荐几个", expectsExistingState: true });
  assert.equal(second.brief?.selectedCandidateId, actualThird.playerId);
  assert.equal(second.report?.referenceProfiles[0]?.name, actualThird.name);
  assert.ok(second.report?.recommendations.every(item => item.player.playerId !== actualThird.playerId));
  assert.equal(lookups, 1);
  assert.equal(seenCandidates.length, 3);
});

test("full graph resolves a team-free reference, searches its position and excludes the reference", async () => {
  const reference = roleConstraintPlayer("reference", "Rayan Cherki", "AM");
  const candidate = roleConstraintPlayer("candidate", "Creative Midfielder", "AM");
  const searches: unknown[] = [];
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret() { return makeBrief(); } },
    referenceNameResolver: async mention => ({ status: "resolved", mention, resolutionMethod: "wikidata_exact", player: {
      entityId: "Q123", preferredName: reference.name, names: [reference.name, "切尔基"], match: "exact_alias", sourceUrl: "https://www.wikidata.org/wiki/Q123",
    } }),
    repository: { mode: "demo", sourceName: "Fixture", async findPlayersByNames() { return [reference]; },
      async loadPlayers() { return [reference, candidate]; }, async searchCandidates(query) {
        searches.push(query); return { players: [reference, candidate], offset: query.offset, totalRecords: 2, nextOffset: null, appliedFilters: ["position"] };
      } },
    experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
    knowledgeBase: { async search() { return []; } },
    planner: { async decide() { return { action: "finish", targetTeam: null, needSummary: "寻找类似球员", capabilityProfile: [],
      recommendations: [{ playerId: candidate.playerId, evidenceKeys: ["shotAssists"] }], limitationKeys: [] }; } },
  });
  const response = await conversation.turn({ threadId: "team-free-similarity", message: "推荐类似切尔基的球员" });
  assert.equal(response.status, "completed", response.message);
  assert.equal(response.brief?.task, "similarity");
  assert.equal(response.report?.targetTeam, null);
  assert.ok(searches.length > 0);
  assert.ok(response.report?.recommendations.some(item => item.player.playerId === candidate.playerId));
  assert.ok(response.report?.recommendations.every(item => item.player.playerId !== reference.playerId));
});

test("reference position union uses one consistent query scope instead of repeatedly searching its first position", async () => {
  const reference = { ...roleConstraintPlayer("reference-union", "Rayan Cherki", "AM"), abilityProfile: {
    recordId: "r", uniqueId: null, snapshotId: "fixture", inGameDate: "2025-11-23", birthDate: null, aliases: ["Rayan Cherki"], heightCm: null,
    identityLink: { method: "source_record" as const, evidence: "fixture" }, positions: { AM: 20, RW: 20 }, attributes: {},
    leftFoot: null, rightFoot: null, personality: {}, traits: [], currentAbility: null, potentialAbility: null, roles: [],
  } };
  const candidate = roleConstraintPlayer("union-candidate", "Candidate", "AM");
  const queries: Array<{ position: unknown; positions?: readonly unknown[] }> = [];
  const conversation = createRecruitmentConversation({
    briefInterpreter: { async interpret() { return makeBrief(); } },
    referenceNameResolver: async mention => ({ status: "resolved", mention, resolutionMethod: "wikidata_exact", player: { entityId: "Q123", preferredName: reference.name, names: [reference.name], sourceUrl: "https://www.wikidata.org/wiki/Q123", match: "exact_label" } }),
    repository: { mode: "demo", sourceName: "Fixture", supportsAbilityProfiles: true, async findPlayersByNames() { return [reference]; }, async loadPlayers() { return [reference, candidate]; },
      async searchCandidates(query) { queries.push(query); return { players: [reference, candidate], totalRecords: 2, nextOffset: null, offset: query.offset, appliedFilters: ["position"] }; } },
    experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand", knowledgeBase: { async search() { return []; } },
    planner: { async decide() { return { action: "finish", targetTeam: null, needSummary: "相似球员", capabilityProfile: [], recommendations: [{ playerId: candidate.playerId, evidenceKeys: ["shotAssists"] }], limitationKeys: [] }; } },
  });
  const response = await conversation.turn({ threadId: "reference-position-union", message: "推荐类似切尔基的球员" });
  assert.equal(response.report?.recommendations[0]?.player.playerId, candidate.playerId, response.message);
  assert.equal(queries.length, 1);
  assert.equal(queries[0]!.position, null);
  assert.deepEqual(queries[0]!.positions, ["AM", "RW"]);
});
