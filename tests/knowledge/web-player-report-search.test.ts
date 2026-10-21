import assert from "node:assert/strict";
import test from "node:test";
import { createRecruitmentConversation, type RecruitmentAction } from "../../src/recruitment/conversation.js";
import { type PlayerProfile } from "../../src/domain/players.js";
import { createWebSearchKnowledgeRepository } from "../../src/knowledge/web-player-report-search.js";
import type { KnowledgeSearchRequest } from "../../src/knowledge/schemas.js";

const request: KnowledgeSearchRequest = {
  corpus: "player_report",
  query: "接应与做球",
  playerNames: ["Jonas Vale"],
  capabilityGaps: ["进攻接应", "创造机会"],
  playerContexts: [{ playerName: "Jonas Vale", team: "Example FC", competition: "Open League", season: "2025/26" }],
  limit: 4,
};

const enabled = {
  apiKey: "test-key",
  allowedDomains: ["example.org"],
  aiProcessingAllowed: true,
  reportDisplayAllowed: true,
  localRetentionAllowed: true,
};

test("Web Search queries the requested capability gaps and only returns anchored player evidence", async () => {
  let sentRequest: { url: string; init?: RequestInit } | undefined;
  const local = { async search() { return []; } };
  const knowledge = createWebSearchKnowledgeRepository(local, {
    ...enabled,
    fetcher: async (input, init) => {
      sentRequest = { url: String(input), init };
      return Response.json({ results: [
        {
          title: "Jonas Vale at Example FC: link-up play analysis",
          url: "https://example.org/jonas-vale-analysis",
          content: "In the 2025/26 Open League season, Jonas Vale at Example FC receives with his back to goal and lays the ball off to create a chance.",
          published_date: "2025-12-01",
        },
        {
          title: "Jonas Vale at Rival FC: link-up play analysis",
          url: "https://example.org/jonas-vale-rival-analysis",
          content: "In the 2025/26 Open League, Jonas Vale at Rival FC links play and creates a chance.",
          published_date: "2025-12-01",
        },
        {
          title: "Jonas Vale creates chances for Example FC",
          url: "https://example.org/jonas-vale-chance-creation",
          content: "In the 2025/26 Open League, Jonas Vale at Example FC creates chances with a precise final ball.",
          published_date: "2025-12-01",
        },
        {
          title: "Jonas Vale scoring highlights",
          url: "https://example.org/jonas-vale-highlights",
          content: "A goal compilation for Jonas Vale.",
          published_date: null,
        },
        {
          title: "Another player: hold-up play",
          url: "https://unapproved.example/another-player",
          content: "A tactical note about another player.",
          published_date: null,
        },
      ] });
    },
  });

  const results = await knowledge.search(request);

  assert.equal(sentRequest?.url, "https://api.tavily.com/search");
  const body = JSON.parse(String(sentRequest?.init?.body)) as Record<string, unknown>;
  assert.match(String(body.query), /Jonas Vale/);
  assert.match(String(body.query), /Example FC/);
  assert.match(String(body.query), /2025\/26/);
  assert.match(String(body.query), /接应|link.up|hold.up/i);
  assert.deepEqual(body.include_domains, ["example.org"]);
  assert.equal(body.search_depth, "basic");
  assert.equal(body.max_results, 4);
  assert.equal(results.length, 2, "anchored partial-gap evidence should survive; wrong-team or unrelated results must not");
  assert.deepEqual(results[0]?.entityNames, ["Jonas Vale"]);
  assert.equal(results[0]?.displayAllowed, true);
  assert.deepEqual(results[0]?.matchedCapabilityGaps, ["进攻接应", "创造机会"]);
  assert.equal(results[0]?.season, "2025/26");
  assert.equal(results[0]?.competition, "Open League");
  assert.match(results[0]?.text ?? "", /lays the ball off/);
  assert.deepEqual(results[1]?.matchedCapabilityGaps, ["创造机会"]);
});

test("Web Search stays off unless processing, display, retention, key, and domain scope are all configured", async () => {
  let calls = 0;
  const knowledge = createWebSearchKnowledgeRepository({ async search() { return []; } }, {
    ...enabled,
    reportDisplayAllowed: false,
    fetcher: async () => { calls += 1; return Response.json({ results: [] }); },
  });

  assert.deepEqual(await knowledge.search(request), []);
  assert.equal(calls, 0);
});

test("local report evidence survives a Web Search outage", async () => {
  const localReport = {
    id: "local:jonas-report",
    documentId: "jonas-report",
    corpus: "player_report" as const,
    text: "Jonas Vale at Example FC links play by receiving with his back to goal and laying the ball off.",
    title: "Local scouting note",
    url: "https://example.org/local-jonas-report",
    sourceId: "local-scouting-notes",
    sourceName: "Local scouting notes",
    publisher: "TactiScout",
    author: "Scout",
    publishedAt: null,
    license: "User-authored",
    attribution: "Local scouting note.",
    entityIds: [],
    entityNames: ["Jonas Vale"],
    competition: null,
    season: null,
    displayAllowed: true,
  };
  const knowledge = createWebSearchKnowledgeRepository({
    async search() { return [localReport]; },
  }, {
    ...enabled,
    fetcher: async () => { throw new Error("Tavily is unavailable"); },
  });

  assert.deepEqual(await knowledge.search(request), [localReport]);
});

test("local and verified web reports both fit within the requested result limit", async () => {
  const localReports = [1, 2].map((index) => ({
    id: `local:report-${index}`,
    documentId: `local-report-${index}`,
    corpus: "player_report" as const,
    text: `Local scouting evidence ${index}.`,
    title: `Local report ${index}`,
    url: `https://example.org/local-report-${index}`,
    sourceId: "local-scouting-notes",
    sourceName: "Local scouting notes",
    publisher: "TactiScout",
    author: "Scout",
    publishedAt: null,
    license: "User-authored",
    attribution: "Local scouting note.",
    entityIds: [],
    entityNames: ["Jonas Vale"],
    competition: null,
    season: null,
    displayAllowed: true,
  }));
  const limitedRequest = { ...request, limit: 2 };
  const knowledge = createWebSearchKnowledgeRepository({
    async search() { return localReports; },
  }, {
    ...enabled,
    fetcher: async () => Response.json({ results: [1, 2].map((index) => ({
      title: `Jonas Vale at Example FC: link-up play report ${index}`,
      url: `https://example.org/web-report-${index}`,
      content: `In the 2025/26 Open League, Jonas Vale at Example FC links play and lays the ball off to create a chance. Report ${index}.`,
      published_date: "2025-12-01",
    })) }),
  });

  const results = await knowledge.search(limitedRequest);

  assert.equal(results.length, 2);
  assert.equal(results.filter(({ sourceId }) => sourceId === "local-scouting-notes").length, 1);
  assert.equal(results.filter(({ sourceId }) => sourceId.startsWith("web-search:")).length, 1);
});

test("a local report wins when Web Search returns the same URL", async () => {
  const localReport = {
    id: "local:jonas-report",
    documentId: "jonas-report",
    corpus: "player_report" as const,
    text: "Local scouting evidence about Jonas Vale.",
    title: "Local report",
    url: "https://example.org/jonas-report",
    sourceId: "local-scouting-notes",
    sourceName: "Local scouting notes",
    publisher: "TactiScout",
    author: "Scout",
    publishedAt: null,
    license: "User-authored",
    attribution: "Local scouting note.",
    entityIds: [],
    entityNames: ["Jonas Vale"],
    competition: null,
    season: null,
    displayAllowed: true,
  };
  const knowledge = createWebSearchKnowledgeRepository({ async search() { return [localReport]; } }, {
    ...enabled,
    fetcher: async () => Response.json({ results: [{
      title: "Jonas Vale scouting report",
      url: localReport.url,
      content: "Jonas Vale links play and creates chances for Example FC.",
      published_date: "2025-12-01",
    }] }),
  });

  const results = await knowledge.search({ ...request, limit: 5 });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.sourceId, "local-scouting-notes");
});

test("Web Search never follows redirects or accepts results outside the explicit domain scope", async () => {
  let redirectMode: RequestRedirect | undefined;
  const knowledge = createWebSearchKnowledgeRepository({ async search() { return []; } }, {
    ...enabled,
    fetcher: async (_input, init) => {
      redirectMode = init?.redirect;
      return Response.json({ results: [{
        title: "Jonas Vale at Example FC: link-up play analysis",
        url: "https://elsewhere.example/jonas-vale-analysis",
        content: "Jonas Vale at Example FC uses hold-up play in the 2025/26 Open League.",
        published_date: "2025-12-01",
      }] });
    },
  });

  assert.deepEqual(await knowledge.search(request), []);
  assert.equal(redirectMode, "error");
});

test("whole graph does not use the legacy name-only Web Search report fallback", async () => {
  const player: PlayerProfile = {
    playerId: "milo-striker",
    name: "Milo Striker",
    team: "Example FC",
    age: 23,
    position: "ST",
    competition: "Open League",
    season: "2025/26",
    minutes: 1800,
    stats: {
      goals: 7,
      assists: 2,
      passesAttempted: 240,
      passesCompleted: 180,
      longPasses: 12,
      carries: 30,
      pressures: 80,
      tackles: 4,
      interceptions: 2,
      shotAssists: 6,
      keyPasses: 5,
    },
    source: "Fixed Web Search ablation fixture",
  };
  const article = "During the 2025/26 Open League, Milo Striker at Example FC links play by receiving with his back to goal, laying the ball off to create chances.";
  const response = Response.json({ results: [{
    title: "Milo Striker links play for Example FC",
    url: "https://example.org/milo-striker-scouting",
    content: article,
    published_date: "2025-12-01",
  }] });
  let externalRequests = 0;

  async function runArm(webSearchEnabled: boolean) {
    const actions: RecruitmentAction[] = [
      { action: "search_methodology", query: "中锋进攻接应和做球的观察标准" },
      { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 },
      { action: "evaluate_candidates", playerIds: [player.playerId] },
      { action: "search_player_reports", query: "进攻接应和做球", playerNames: [player.name], limit: 4 },
    ];
    const knowledgeBase = createWebSearchKnowledgeRepository({ async search() { return []; } }, {
      ...enabled,
      reportDisplayAllowed: webSearchEnabled,
      fetcher: async () => { externalRequests += 1; return response; },
    });
    const conversation = createRecruitmentConversation({
      repository: {
        mode: "demo",
        sourceName: "Fixed candidate snapshot",
        async loadPlayers() { return [player]; },
        async getPlayersByIds(ids) { return ids.includes(player.playerId) ? [player] : []; },
        async getComparisonPlayers() { return [player]; },
      },
      planner: {
        async decide(input) {
          const { history } = input;
          const toolNames = history.filter((entry) => entry.role === "tool").map((entry) => entry.toolName);
          const nextAction = actions.shift();
          if (nextAction) return nextAction;
          const reportEntry = history.filter((entry) => entry.role === "tool" && entry.toolName === "search_player_reports").at(-1);
          const reportResults = reportEntry ? (JSON.parse(reportEntry.content) as { results?: Array<{ documentId: string; sourceId: string }> }).results ?? [] : [];
          const webDocument = reportResults.find((result) => result.sourceId.startsWith("web-search:"));
          assert.ok(input.decisionSnapshot.candidates.evaluatedPlayerIds.includes(player.playerId),
            "the canonical decision snapshot carries candidate evaluation state when detailed tool history is projected out");
          return {
            action: "finish",
            targetTeam: "Bayern Munich",
            needSummary: "寻找能参与前场接应和配合的中锋。",
            capabilityProfile: ["进攻接应", "创造机会"],
            recommendations: [{ playerId: player.playerId, evidenceKeys: ["shotAssists"] }],
            reportObservations: webDocument ? [{
              playerId: player.playerId,
              documentId: webDocument.documentId,
              summary: "该来源在 2025/26 Open League 的描述中提到球员背身接球并回做创造机会。",
              linkedMetricKeys: [],
            }] : [],
            limitationKeys: [],
          };
        },
      },
      knowledgeBase,
      experimentalCandidatePolicyMode: "bypassed",
      experimentalRetrievalMode: "fixed",
    });
    return conversation.turn({ threadId: `web-report-ablation-${webSearchEnabled}`, message: "为拜仁找一名中锋，重点看进攻接应和做球。" });
  }

  const [control, enabledArm] = await Promise.all([runArm(false), runArm(true)]);

  assert.equal(control.status, "completed");
  assert.equal(enabledArm.status, "completed");
  assert.equal(externalRequests, 0, "player reports must come from the new evidence module, not the legacy Web Search adapter");
  assert.deepEqual(control.report?.requestedCapabilityCoverage, enabledArm.report?.requestedCapabilityCoverage);
  assert.equal(enabledArm.report?.requestedCapabilityCoverage.find(({ name }) => name === "进攻接应")?.status, "missing");
  assert.deepEqual(control.report?.recommendations.map(({ player }) => player.playerId), [player.playerId]);
  assert.deepEqual(enabledArm.report?.recommendations.map(({ player }) => player.playerId), [player.playerId]);
  assert.equal(control.report?.recommendations[0]?.reportObservations.length, 0);
  assert.equal(enabledArm.report?.recommendations[0]?.reportObservations.length, 0);
  assert.match(enabledArm.report?.limitations.join(" ") ?? "", /进攻接应.*无法评估/);
});
