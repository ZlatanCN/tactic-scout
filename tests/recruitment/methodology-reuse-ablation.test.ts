import assert from "node:assert/strict";
import test from "node:test";
import { createRecruitmentConversation, type RecruitmentAction, type RecruitmentTraceEvent } from "../../src/recruitment/conversation.js";
import type { KnowledgeSearchResult } from "../../src/knowledge/schemas.js";
import { roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

const finish: RecruitmentAction = { action: "finish", targetTeam: null, needSummary: "资料不足，继续考察。", capabilityProfile: [], recommendations: [], limitationKeys: [] };
const query: RecruitmentAction = { action: "search_methodology", query: "前锋评估方法", limit: 4 };
const search: RecruitmentAction = { action: "search_candidates", position: "ATT", minimumMinutes: 0, limit: 10 };

function fixture(actions: RecruitmentAction[], mode: "enabled" | "bypassed", failFirst = false, documents: KnowledgeSearchResult[] = []) {
  let calls = 0;
  const trace: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Synthetic evaluation fixture", async loadPlayers() { return []; } },
    planner: { async decide() { const next = actions.shift(); assert.ok(next, "graph must complete within scripted actions"); return next; } },
    knowledgeBase: { async search() { calls++; if (failFirst && calls === 1) throw new Error("temporary fixture failure"); return documents; } },
    experimentalMethodologyReuseMode: mode,
    observer: event => trace.push(event),
  });
  return { conversation, trace, calls: () => calls };
}

test("whole-graph paired ablation reuses successful zero-hit methodology without changing the report", async () => {
  const results = [];
  for (const mode of ["enabled", "bypassed"] as const) {
    const run = fixture([query, query, search, finish], mode);
    const result = await run.conversation.turn({ threadId: mode, message: "寻找前锋候选，重点看进球" });
    assert.equal(result.status, "completed");
    results.push({ report: result.report, calls: run.calls(), trace: run.trace });
  }
  assert.deepEqual(results.map(run => run.calls), [1, 2]);
  assert.deepEqual(results[0]!.report, results[1]!.report);
  assert.equal(results[0]!.trace.filter(event => event.phase === "tool_reuse").length, 1);
  assert.equal(results[1]!.trace.filter(event => event.phase === "tool_reuse").length, 0);
  assert.ok(results.every(run => run.trace.some(event => event.phase === "tool" && event.toolName === "search_candidates")), "both arms must continue to real candidate discovery");
});

test("successful methodology reuse preserves retrieved provenance in the full report", async () => {
  const document: KnowledgeSearchResult = {
    id: "fixture-chunk", documentId: "fixture-document", corpus: "methodology", text: "指标必须保留赛事与赛季范围。",
    title: "Synthetic methodology", url: "https://example.test/methodology", sourceId: "fixture-source", sourceName: "Synthetic source",
    publisher: "Fixture", author: "Fixture", publishedAt: null, license: "CC0", attribution: "Synthetic evaluation fixture",
    entityIds: [], entityNames: [], competition: null, season: null, displayAllowed: true,
  };
  const reports = [];
  for (const mode of ["enabled", "bypassed"] as const) {
    const run = fixture([query, query, search, finish], mode, false, [document]);
    const result = await run.conversation.turn({ threadId: `provenance-${mode}`, message: "寻找前锋候选" });
    assert.equal(result.status, "completed");
    assert.equal(result.report?.knowledgeCoverage.methodologyChunksRetrieved, 1);
    assert.ok(result.report?.knowledgeCoverage.methodologySources.some(source => source.url === document.url));
    reports.push(result.report);
  }
  assert.deepEqual(reports[0], reports[1]);
});

test("a failed methodology query can retry the identical request", async () => {
  const run = fixture([query, query, search, finish], "enabled", true);
  assert.equal((await run.conversation.turn({ threadId: "retry", message: "寻找前锋候选" })).status, "completed");
  assert.equal(run.calls(), 2);
  assert.equal(run.trace.filter(event => event.phase === "tool_reuse").length, 0);
});

test("different methodology queries and limits remain distinct investigations", async () => {
  for (const changed of [{ ...query, limit: 8 }, { ...query, query: "前锋接应方法" }]) {
    const run = fixture([query, changed, search, finish], "enabled");
    assert.equal((await run.conversation.turn({ threadId: "changed", message: "寻找前锋候选" })).status, "completed");
    assert.equal(run.calls(), 2);
  }
});

test("checkpoint resume clears same-turn reuse so a new user answer can refresh evidence", async () => {
  const run = fixture([query, { action: "ask_user", question: "偏好哪种前锋能力？", reason: "回答会改变调查重点。" }, query, search, finish], "enabled");
  const first = await run.conversation.turn({ threadId: "resume", message: "寻找前锋候选" });
  assert.equal(first.status, "needs_input");
  const second = await run.conversation.turn({ threadId: "resume", message: "重点看进球产出", expectsExistingState: true });
  assert.equal(second.status, "completed");
  assert.equal(run.calls(), 2);
  assert.equal(run.trace.filter(event => event.phase === "tool_reuse").length, 0);
});

test("same-scope follow-up keeps methodology evidence available without searching it again", async () => {
  const candidates = [
    roleConstraintPlayer("context-continuity-cm-1", "Context Continuity CM One", "CM"),
    roleConstraintPlayer("context-continuity-cm-2", "Context Continuity CM Two", "CM"),
  ];
  const methodology: KnowledgeSearchResult = {
    id: "context-continuity-methodology",
    documentId: "context-continuity-methodology-doc",
    corpus: "methodology",
    text: "中场推进应分别观察向前传球与持球推进。",
    title: "Midfield progression methodology",
    url: "https://example.test/context-continuity-methodology",
    sourceId: "context-continuity-methodology-source",
    sourceName: "Synthetic methodology source",
    publisher: "Fixture",
    author: "Fixture",
    publishedAt: null,
    license: "CC0",
    attribution: "Synthetic evaluation fixture",
    entityIds: [],
    entityNames: [],
    competition: null,
    season: null,
    displayAllowed: true,
  };
  let methodologySearches = 0;
  const candidatePageOffsets: number[] = [];
  const decisions: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "Synthetic context continuity fixture",
      async loadPlayers() { return candidates; },
      async searchCandidates(query) {
        candidatePageOffsets.push(query.offset);
        const player = candidates[query.offset];
        const players = player ? [player] : [];
        return {
          players,
          totalRecords: candidates.length,
          offset: query.offset,
          nextOffset: query.offset + players.length < candidates.length ? query.offset + players.length : null,
          appliedFilters: ["position"],
        };
      },
    },
    planner: {
      async decide(input) {
        const lastUserIndex = input.history.reduce((last, entry, index) => entry.role === "user" ? index : last, -1);
        const currentTurnTools = new Set(input.history.slice(lastUserIndex + 1)
          .filter(entry => entry.role === "tool")
          .map(entry => entry.toolName));
        const userTurnCount = input.history.filter(entry => entry.role === "user").length;

        if (userTurnCount > 1 && !currentTurnTools.has("search_candidates")) {
          return currentTurnTools.has("investigation_policy")
            ? { action: "search_methodology", query: "中场推进方法", limit: 4 }
            : { action: "search_candidates", position: "CM", minimumMinutes: 0, limit: 20 };
        }
        if (!currentTurnTools.has("search_methodology")) {
          return { action: "search_methodology", query: "中场推进方法", limit: 4 };
        }
        if (!currentTurnTools.has("search_candidates")) {
          return { action: "search_candidates", position: "CM", minimumMinutes: 0, limit: 20 };
        }
        const playerId = userTurnCount > 1 ? candidates[1]!.playerId : candidates[0]!.playerId;
        if (!currentTurnTools.has("evaluate_candidates")) {
          return { action: "evaluate_candidates", playerIds: [playerId] };
        }
        if (!currentTurnTools.has("search_player_reports")) {
          return { action: "search_player_reports", playerNames: [candidates[userTurnCount > 1 ? 1 : 0]!.name], limit: 4 };
        }
        return {
          action: "finish",
          targetTeam: "巴萨",
          needSummary: "沿用同一案件中已经核验的方法资料，继续查看下一页候选。",
          capabilityProfile: ["中场推进"],
          recommendations: [],
          limitationKeys: [],
        };
      },
    },
    knowledgeBase: {
      async search(query) {
        if (query.corpus === "methodology") {
          methodologySearches += 1;
          return [methodology];
        }
        return [];
      },
    },
    experimentalRetrievalMode: "fixed",
    observer(event) { if (event.phase === "decision") decisions.push(event); },
  });

  const first = await conversation.turn({ threadId: "context-continuity", message: "为巴萨找中场，重点看推进能力" });
  assert.equal(first.status, "completed", first.message);
  assert.equal(first.report?.knowledgeCoverage.methodologyChunksRetrieved, 1);

  const second = await conversation.turn({
    threadId: "context-continuity",
    message: "继续沿用当前范围，查看下一页候选",
    expectsExistingState: true,
  });

  assert.equal(second.status, "completed", second.message);
  assert.deepEqual(candidatePageOffsets, [0, 1], JSON.stringify({
    message: second.message,
    status: second.status,
    methodologySearches,
    decisions: decisions.map(event => event.phase === "decision" ? {
      action: event.action,
      policyBlocked: event.policyBlocked,
      policyReasonCodes: event.policyReasonCodes,
    } : null),
  }));
  assert.equal(methodologySearches, 1, "the unchanged case should reuse its verified methodology result");
  assert.equal(second.report?.knowledgeCoverage.methodologyChunksRetrieved, 1, "the same-scope report should retain its methodology evidence");
});

test("different blocked tool requests are not mistaken for the identical no-progress action", async () => {
  const actions: RecruitmentAction[] = [
    { ...query, query: "前锋方法一" }, { ...query, query: "前锋方法二" },
    { ...query, query: "超额方法三" }, { ...query, query: "超额方法四" }, search, finish,
  ];
  const run = fixture(actions, "enabled");
  const result = await run.conversation.turn({ threadId: "distinct-blocked", message: "寻找前锋候选" });
  assert.equal(result.status, "completed");
  assert.equal(actions.length, 0, "different requests must allow the Planner to reach candidate discovery");
  assert.equal(run.calls(), 2, "independent tool budget must still hold");
  assert.ok(run.trace.some(event => event.phase === "tool" && event.toolName === "search_candidates"));
  assert.ok(!result.report?.limitations.some(item => /连续重复.*动作/.test(item)));
});
