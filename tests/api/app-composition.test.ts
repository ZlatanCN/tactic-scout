import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MemorySaver } from "@langchain/langgraph";
import { createApp } from "../../src/app.js";
import { createChatModel } from "../../src/recruitment/chat-model.js";
import { unavailableRecruitmentConversation } from "../../src/recruitment/conversation.js";
import type { PlayerRepository, PlayerSearchPage, PlayerSearchQuery } from "../../src/sources/registry.js";

test("context health reports the active window and compaction policy without model credentials", async () => {
  const keys = ["OPENAI_API_KEY", "OPENAI_MODEL", "TACTISCOUT_CONTEXT_WINDOW_TOKENS", "TACTISCOUT_CONTEXT_COMPACTION_RATIO", "TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS", "OPENAI_MAX_OUTPUT_TOKENS"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.OPENAI_API_KEY = "never-return-this-value";
  process.env.OPENAI_MODEL = "group/free";
  process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS = "258000";
  process.env.TACTISCOUT_CONTEXT_COMPACTION_RATIO = "0.9";
  process.env.TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS = "1024";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "8192";
  const app = createApp({ recruitmentConversation: unavailableRecruitmentConversation() });

  try {
    const response = await app.inject({ method: "GET", url: "/health/context" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      configuredModel: "group/free",
      configuredContextWindowTokens: 258000,
      compactionRatio: 0.9,
      defaultOutputBudgetTokens: 8192,
      safetyMarginTokens: 1024,
    });
    assert.doesNotMatch(response.body, /never-return-this-value|OPENAI_API_KEY/);
  } finally {
    await app.close();
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("the retired one-shot scouting route points to natural-language recruitment cases without reading players", async () => {
  let playerReads = 0;
  let knowledgeStatusReads = 0;
  const playerRepository: PlayerRepository = {
    mode: "statsbomb",
    sourceName: "Injected StatsBomb fixture",
    async loadPlayers() {
      playerReads += 1;
      return [];
    },
  };
  const knowledgeBase = {
    async search() { return []; },
    async ingest() { return { documentId: "injected-document", chunkCount: 1 }; },
    async removeDocument() { return 0; },
    async status() {
      knowledgeStatusReads += 1;
      return {
        indexedChunks: 0,
        methodologyChunks: 0,
        playerReportChunks: 0,
        registeredSources: 5,
        ingestiblePlayerReportSources: 2,
        embeddingModel: "injected-embedding",
        indexPath: "/injected/knowledge-index",
      };
    },
  };
  const app = createApp({
    playerRepository,
    knowledgeBase,
    recruitmentConversation: unavailableRecruitmentConversation(),
  });

  try {
    const dataset = await app.inject({ method: "GET", url: "/api/v1/dataset" });
    assert.deepEqual(dataset.json(), { mode: "statsbomb", source: "Injected StatsBomb fixture" });

    const knowledgeStatus = await app.inject({ method: "GET", url: "/api/v1/knowledge/status" });
    assert.equal(knowledgeStatus.json().registeredSources, 5);
    assert.equal(knowledgeStatus.json().indexPath, "/injected/knowledge-index");
    assert.equal(knowledgeStatusReads, 1);

    const scouting = await app.inject({
      method: "POST",
      url: "/api/v1/scout",
      payload: {
        targetTeam: "Barcelona",
        position: "CM",
        inPossessionRoles: ["progression"],
        outOfPossessionRoles: [],
        topK: 3,
        includeUnknownAge: false,
      },
    });
    assert.equal(scouting.statusCode, 410);
    assert.deepEqual(scouting.json(), {
      error: "旧版一次性球探接口已停用，请改用自然语言招募案件。",
      replacement: {
        method: "POST",
        path: "/api/v1/recruitment/cases/:caseId/turns",
      },
    });
    assert.equal(playerReads, 0);
  } finally {
    await app.close();
  }
});

test("FBref turns stop before reading players or calling the Planner, even with local Ollama configured", async () => {
  let playerReads = 0;
  let plannerCalls = 0;
  let checkpointReads = 0;
  const checkpointer = new MemorySaver();
  const getTuple = checkpointer.getTuple.bind(checkpointer);
  checkpointer.getTuple = async (config) => {
    checkpointReads += 1;
    return getTuple(config);
  };
  const playerRepository: PlayerRepository = {
    mode: "fbref",
    sourceName: "Injected FBref fixture",
    async loadPlayers() {
      playerReads += 1;
      return [];
    },
    async searchCandidates(query: PlayerSearchQuery): Promise<PlayerSearchPage> {
      playerReads += 1;
      return { players: [], totalRecords: 0, offset: query.offset, nextOffset: null, appliedFilters: [] };
    },
  };
  const app = createApp({
    playerRepository,
    checkpointer,
    recruitmentPlanner: { async decide() { plannerCalls += 1; throw new Error("Planner must not run for FBref data"); } },
    knowledgeBase: {
      async search() { return []; },
      async ingest() { return { documentId: "injected-document", chunkCount: 1 }; },
      async removeDocument() { return 0; },
      async status() {
        return {
          indexedChunks: 0,
          methodologyChunks: 0,
          playerReportChunks: 0,
          registeredSources: 0,
          ingestiblePlayerReportSources: 0,
          embeddingModel: "injected-embedding",
          indexPath: "/injected/knowledge-index",
        };
      },
    },
  });
  const previousFbrefPermission = process.env.TACTISCOUT_FBREF_AI_PROCESSING_ALLOWED;
  const previousModelEndpoint = process.env.OPENAI_BASE_URL;
  process.env.TACTISCOUT_FBREF_AI_PROCESSING_ALLOWED = "true";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/fbref-source-policy/turns",
      payload: { message: "为拜仁寻找凯恩的替代者" },
    });

    assert.equal(response.statusCode, 503);
    assert.match(response.json().error, /FBref/);
    assert.match(response.json().error, /许可|授权/);
    assert.equal(checkpointReads, 0);
    assert.equal(playerReads, 0);
    assert.equal(plannerCalls, 0);
  } finally {
    try {
      await app.close();
    } finally {
      if (previousFbrefPermission === undefined) delete process.env.TACTISCOUT_FBREF_AI_PROCESSING_ALLOWED;
      else process.env.TACTISCOUT_FBREF_AI_PROCESSING_ALLOWED = previousFbrefPermission;
      if (previousModelEndpoint === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = previousModelEndpoint;
    }
  }
});

test("FPL turns stop before reading players or calling the Planner, even with local Ollama configured", async () => {
  let playerReads = 0;
  let plannerCalls = 0;
  let checkpointReads = 0;
  const checkpointer = new MemorySaver();
  const getTuple = checkpointer.getTuple.bind(checkpointer);
  checkpointer.getTuple = async (config) => {
    checkpointReads += 1;
    return getTuple(config);
  };
  const playerRepository: PlayerRepository = {
    mode: "fpl",
    sourceName: "Injected FPL fixture",
    async loadPlayers() {
      playerReads += 1;
      return [];
    },
    async searchCandidates(query: PlayerSearchQuery): Promise<PlayerSearchPage> {
      playerReads += 1;
      return { players: [], totalRecords: 0, offset: query.offset, nextOffset: null, appliedFilters: [] };
    },
  };
  const app = createApp({
    playerRepository,
    checkpointer,
    recruitmentPlanner: { async decide() { plannerCalls += 1; throw new Error("Planner must not run for FPL data"); } },
    knowledgeBase: {
      async search() { return []; },
      async ingest() { return { documentId: "injected-document", chunkCount: 1 }; },
      async removeDocument() { return 0; },
      async status() {
        return {
          indexedChunks: 0,
          methodologyChunks: 0,
          playerReportChunks: 0,
          registeredSources: 0,
          ingestiblePlayerReportSources: 0,
          embeddingModel: "injected-embedding",
          indexPath: "/injected/knowledge-index",
        };
      },
    },
  });
  const previousModelEndpoint = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/fpl-source-policy/turns",
      payload: { message: "为拜仁寻找凯恩的替代者" },
    });

    assert.equal(response.statusCode, 503);
    assert.match(response.json().error, /FPL/);
    assert.match(response.json().error, /自动|停用|不可/);
    assert.equal(checkpointReads, 0);
    assert.equal(playerReads, 0);
    assert.equal(plannerCalls, 0);
  } finally {
    try {
      await app.close();
    } finally {
      if (previousModelEndpoint === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = previousModelEndpoint;
    }
  }
});

test("Premier League Pulselive turns stop before state, player, or Planner access even with Ollama configured", async () => {
  let playerReads = 0;
  let plannerCalls = 0;
  let checkpointReads = 0;
  const checkpointer = new MemorySaver();
  const getTuple = checkpointer.getTuple.bind(checkpointer);
  checkpointer.getTuple = async (config) => {
    checkpointReads += 1;
    return getTuple(config);
  };
  const playerRepository: PlayerRepository = {
    mode: "premier_league",
    sourceName: "Injected Premier League fixture",
    async loadPlayers() {
      playerReads += 1;
      return [];
    },
    async searchCandidates(query: PlayerSearchQuery): Promise<PlayerSearchPage> {
      playerReads += 1;
      return { players: [], totalRecords: 0, offset: query.offset, nextOffset: null, appliedFilters: [] };
    },
  };
  const app = createApp({
    playerRepository,
    checkpointer,
    recruitmentPlanner: { async decide() { plannerCalls += 1; throw new Error("Planner must not run for unapproved Pulselive data"); } },
    knowledgeBase: {
      async search() { return []; },
      async ingest() { return { documentId: "injected-document", chunkCount: 1 }; },
      async removeDocument() { return 0; },
      async status() {
        return {
          indexedChunks: 0,
          methodologyChunks: 0,
          playerReportChunks: 0,
          registeredSources: 0,
          ingestiblePlayerReportSources: 0,
          embeddingModel: "injected-embedding",
          indexPath: "/injected/knowledge-index",
        };
      },
    },
  });
  const previousModelEndpoint = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/premier-league-source-policy/turns",
      payload: { message: "为阿森纳寻找一名能推进的后卫" },
    });

    assert.equal(response.statusCode, 503);
    assert.match(response.json().error, /Premier League/i);
    assert.match(response.json().error, /书面|许可|授权/);
    assert.equal(checkpointReads, 0);
    assert.equal(playerReads, 0);
    assert.equal(plannerCalls, 0);
  } finally {
    try {
      await app.close();
    } finally {
      if (previousModelEndpoint === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = previousModelEndpoint;
    }
  }
});

test("Understat, ASA, and mosaic turns reject remote model endpoints before reading case or player data", async () => {
  const scenarios = [
    { mode: "understat" as const, sourceName: "Injected Understat fixture" },
    { mode: "asa" as const, sourceName: "Injected ASA fixture" },
    { mode: "mosaic" as const, sourceName: "Injected mosaic fixture" },
  ];
  const previousModelEndpoint = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = "https://api.example.com/v1";

  try {
    for (const scenario of scenarios) {
      let playerReads = 0;
      let plannerCalls = 0;
      let checkpointReads = 0;
      const checkpointer = new MemorySaver();
      const getTuple = checkpointer.getTuple.bind(checkpointer);
      checkpointer.getTuple = async (config) => {
        checkpointReads += 1;
        return getTuple(config);
      };
      const app = createApp({
        playerRepository: {
          mode: scenario.mode,
          sourceName: scenario.sourceName,
          async loadPlayers() { playerReads += 1; return []; },
          async searchCandidates(query) {
            playerReads += 1;
            return { players: [], totalRecords: 0, offset: query.offset, nextOffset: null, appliedFilters: [] };
          },
        },
        checkpointer,
        recruitmentPlanner: { async decide() { plannerCalls += 1; throw new Error("Planner must not run for remote model endpoints"); } },
        knowledgeBase: {
          async search() { return []; },
          async ingest() { return { documentId: "injected-document", chunkCount: 1 }; },
          async removeDocument() { return 0; },
          async status() {
            return {
              indexedChunks: 0,
              methodologyChunks: 0,
              playerReportChunks: 0,
              registeredSources: 0,
              ingestiblePlayerReportSources: 0,
              embeddingModel: "injected-embedding",
              indexPath: "/injected/knowledge-index",
            };
          },
        },
      });

      try {
        const response = await app.inject({
          method: "POST",
          url: `/api/v1/recruitment/cases/${scenario.mode}-remote-model-policy/turns`,
          payload: { message: "为拜仁寻找凯恩的替代者" },
        });

        assert.equal(response.statusCode, 503, scenario.mode);
        assert.match(response.json().error, /本机|回环/);
        assert.equal(checkpointReads, 0, scenario.mode);
        assert.equal(playerReads, 0, scenario.mode);
        assert.equal(plannerCalls, 0, scenario.mode);
      } finally {
        await app.close();
      }
    }
  } finally {
    if (previousModelEndpoint === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousModelEndpoint;
  }
});

test("Understat, ASA, and mosaic turns continue with a loopback model endpoint", async () => {
  const scenarios = [
    { mode: "understat" as const, sourceName: "Injected Understat fixture" },
    { mode: "asa" as const, sourceName: "Injected ASA fixture" },
    { mode: "mosaic" as const, sourceName: "Injected mosaic fixture" },
  ];
  const previousModelEndpoint = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";

  try {
    for (const scenario of scenarios) {
      let playerReads = 0;
      let plannerCalls = 0;
      const app = createApp({
        playerRepository: {
          mode: scenario.mode,
          sourceName: scenario.sourceName,
          async loadPlayers() { playerReads += 1; return []; },
          async searchCandidates(query) {
            playerReads += 1;
            return { players: [], totalRecords: 0, offset: query.offset, nextOffset: null, appliedFilters: [] };
          },
        },
        recruitmentPlanner: {
          async decide(input) {
            plannerCalls += 1;
            const hasCandidateSearch = input.history.some((entry) => entry.role === "tool" && entry.toolName === "search_candidates");
            if (hasCandidateSearch) {
              return {
                action: "finish",
                targetTeam: "拜仁",
                needSummary: "已完成一次本机模型处理的候选检索。",
                capabilityProfile: [],
                recommendations: [],
                limitationKeys: [],
              };
            }
            const hasMethodologySearch = input.history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology");
            if (!hasMethodologySearch) return { action: "search_methodology", query: "中锋进球表现的可观察指标" };
            return { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 20 };
          },
        },
        knowledgeBase: {
          async search() { return []; },
          async ingest() { return { documentId: "injected-document", chunkCount: 1 }; },
          async removeDocument() { return 0; },
          async status() {
            return {
              indexedChunks: 0,
              methodologyChunks: 0,
              playerReportChunks: 0,
              registeredSources: 0,
              ingestiblePlayerReportSources: 0,
              embeddingModel: "injected-embedding",
              indexPath: "/injected/knowledge-index",
            };
          },
        },
      });

      try {
        const response = await app.inject({
          method: "POST",
          url: `/api/v1/recruitment/cases/${scenario.mode}-loopback-model-policy/turns`,
          payload: { message: "为拜仁找一名中锋，重点看进球产出" },
        });

        assert.equal(response.statusCode, 200, scenario.mode);
        assert.equal(response.json().status, "completed", scenario.mode);
        assert.ok(playerReads > 0, scenario.mode);
        assert.ok(plannerCalls > 0, scenario.mode);
      } finally {
        await app.close();
      }
    }
  } finally {
    if (previousModelEndpoint === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousModelEndpoint;
  }
});

test("createChatModel refuses loopback redirects and accepts a direct response", async (t) => {
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  let redirect = true;
  const requests: Array<{ url: string; body: string }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), body: String(init?.body ?? "") });
    if (redirect) return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1:9998/v1/chat/completions" },
    });
    return Response.json({
      id: "chatcmpl-local-success",
      object: "chat.completion",
      created: 1,
      model: "fixture-model",
      choices: [{ index: 0, message: { role: "assistant", content: "fixture response" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });

  try {
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:9999/v1";
    const redirectModel = createChatModel("fixture-key", "fixture-model", { timeoutMs: 5_000 });
    await assert.rejects(redirectModel.invoke("redirect-safety-probe"), "a loopback 302 must be surfaced as an error");
    assert.equal(requests.length, 1);
    assert.match(requests[0]!.url, /^http:\/\/127\.0\.0\.1:9999\/v1\/chat\/completions$/);
    assert.match(requests[0]!.body, /redirect-safety-probe/);
    assert.doesNotMatch(JSON.stringify(requests), /127\.0\.0\.1:9998/, "the 302 target must never receive the model request");

    redirect = false;
    const directModel = createChatModel("fixture-key", "fixture-model", { timeoutMs: 5_000 });
    const response = await directModel.invoke("direct-response-probe");
    assert.equal(response.content, "fixture response");
  } finally {
    if (previousBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousBaseUrl;
  }
});

test("HTTP stop cancels an active repository query before Planner or report continuation", async () => {
  const requestId = randomUUID();
  const caseId = `cancel-http-active-repository-query-${randomUUID()}`;
  let repositorySignal: AbortSignal | undefined;
  let playerReads = 0;
  let plannerCalls = 0;
  let signalQueryStarted!: () => void;
  let signalQueryAborted!: () => void;
  const queryStarted = new Promise<void>((resolve) => { signalQueryStarted = resolve; });
  const queryAborted = new Promise<void>((resolve) => { signalQueryAborted = resolve; });
  const app = createApp({
    playerRepository: {
      mode: "demo",
      sourceName: "Fictional TactiScout demo data",
      async searchCandidates(query, signal) {
        playerReads += 1;
        repositorySignal = signal;
        signalQueryStarted();
        return new Promise((_resolve, reject) => {
          if (!signal) return;
          signal.addEventListener("abort", () => {
            signalQueryAborted();
            reject(signal.reason);
          }, { once: true });
        });
      },
    },
    recruitmentPlanner: {
      async decide({ history }) {
        plannerCalls += 1;
        return history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology")
          ? { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 20 }
          : { action: "search_methodology", query: "中锋角色的可观察评估指标" };
      },
    },
    knowledgeBase: {
      async search() { return []; },
      async ingest() { return { documentId: "injected-document", chunkCount: 1 }; },
      async removeDocument() { return 0; },
      async status() {
        return {
          indexedChunks: 0,
          methodologyChunks: 0,
          playerReportChunks: 0,
          registeredSources: 0,
          ingestiblePlayerReportSources: 0,
          embeddingModel: "injected-embedding",
          indexPath: "/injected/knowledge-index",
        };
      },
    },
  });

  try {
    const pendingTurn = app.inject({
      method: "POST",
      url: `/api/v1/recruitment/cases/${caseId}/turns`,
      payload: { requestId, message: "为拜仁找一名前锋" },
    });
    await queryStarted;
    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/v1/recruitment/cases/${caseId}/turns/${requestId}/cancel`,
    });
    assert.equal(cancelResponse.statusCode, 200);
    assert.deepEqual(cancelResponse.json(), { status: "requested" });

    await queryAborted;
    const turnResponse = await pendingTurn;
    assert.equal(turnResponse.statusCode, 200);
    assert.equal(turnResponse.json().status, "cancelled");
    assert.equal(turnResponse.json().report, null);
    assert.equal(repositorySignal?.aborted, true);
    assert.equal(playerReads, 1);
    assert.equal(plannerCalls, 2, "the cancelled repository query must not return to Planner");

    const progressResponse = await app.inject({
      method: "GET",
      url: `/api/v1/recruitment/cases/${caseId}/progress?requestId=${requestId}`,
    });
    assert.equal(progressResponse.statusCode, 200);
    assert.equal(progressResponse.json().active, false);
    assert.equal(progressResponse.json().stage, "cancelled");
  } finally {
    await app.close();
  }
});

test("the retired requirement parser directs messages to the natural-language recruitment case", async () => {
  const app = createApp({ recruitmentConversation: unavailableRecruitmentConversation() });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/requirements/parse",
      payload: {},
    });

    assert.equal(response.statusCode, 410);
    assert.deepEqual(response.json(), {
      error: "独立需求解析接口已停用，请直接通过自然语言招募案件开始调查。",
      replacement: {
        method: "POST",
        path: "/api/v1/recruitment/cases/:caseId/turns",
      },
    });
  } finally {
    await app.close();
  }
});
