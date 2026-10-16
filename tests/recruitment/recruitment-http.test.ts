import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  MemorySaver,
  createApp,
  MultiSourceCurrentPlayerRepository,
  createRecruitmentConversation,
  RecruitmentCaseStateExpiredError,
  RecruitmentModelTimeoutError,
  RecruitmentPlannerOutputError,
  unavailableRecruitmentConversation,
  RecruitmentAction,
  RecruitmentConversation,
  RecruitmentPlanner,
  RecruitmentTraceEvent,
  createSinglePassInvestigationPlanner,
  PlayerRepository,
  PlayerSearchFilter,
  PlayerSearchQuery,
  PlayerProfile,
  KnowledgeSearchResult,
  installRecruitmentConversationTestEnvironment,
  roleConstraintPlayer,
  understatRoleCandidate,
  understatRoleResearch,
} from "./fixtures/recruitment-conversation.js";

const restoreEnvironment = installRecruitmentConversationTestEnvironment();
after(restoreEnvironment);

test("a recruitment case can pause for a user answer through the HTTP turn interface", async () => {
  const calls: Array<{ threadId: string; message: string; expectsExistingState?: boolean }> = [];
  const conversation: RecruitmentConversation = {
    async turn(input) {
      calls.push({ threadId: input.threadId, message: input.message, expectsExistingState: input.expectsExistingState });
      return {
        threadId: input.threadId,
        status: "needs_input",
        message: "优先找即战力，还是培养接班人？",
        question: {
          reason: "这会改变目标球员的年龄和出场样本取舍。",
        },
        report: null,
      };
    },
  };
  const app = createApp({ recruitmentConversation: conversation });
  const threadId = "case-bayern-kane-1";

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/recruitment/cases/${threadId}/turns`,
      payload: { message: "为拜仁寻找凯恩的替代者" },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      threadId,
      status: "needs_input",
      message: "优先找即战力，还是培养接班人？",
      question: { reason: "这会改变目标球员的年龄和出场样本取舍。" },
      report: null,
    });
    assert.deepEqual(calls, [{ threadId, message: "为拜仁寻找凯恩的替代者", expectsExistingState: false }]);
  } finally {
    await app.close();
  }
});

test("a repeated turn request ID returns the same run and progress instead of rerunning the case", async () => {
  const requestId = "c7a8aa3e-8d48-4f47-bc84-930f5fd8600a";
  let calls = 0;
  let completeTurn!: (response: Awaited<ReturnType<RecruitmentConversation["turn"]>>) => void;
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const pendingTurn = new Promise<Awaited<ReturnType<RecruitmentConversation["turn"]>>>((resolve) => { completeTurn = resolve; });
  const conversation: RecruitmentConversation = {
    async turn(input) {
      calls += 1;
      signalStarted();
      return pendingTurn;
    },
  };
  const app = createApp({ recruitmentConversation: conversation });
  const url = "/api/v1/recruitment/cases/idempotent-turn/turns";
  const payload = { requestId, message: "为巴萨找一名后卫" };

  try {
    const firstRun = app.inject({ method: "POST", url, payload });
    await started;
    const retry = app.inject({ method: "POST", url, payload });
    completeTurn({
      threadId: "idempotent-turn",
      status: "completed",
      message: "本轮调查完成。",
      question: null,
      report: null,
    });

    const [firstResponse, retryResponse] = await Promise.all([firstRun, retry]);
    assert.equal(firstResponse.statusCode, 200);
    assert.deepEqual(retryResponse.json(), firstResponse.json());
    assert.equal(calls, 1);
    assert.equal(firstResponse.json().progressEvents[0].stage, "starting");

    const replay = await app.inject({ method: "POST", url, payload });
    assert.deepEqual(replay.json(), firstResponse.json());
    assert.equal(calls, 1);

    const conflict = await app.inject({
      method: "POST",
      url,
      payload: { requestId, message: "另一条不同需求" },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(calls, 1);
  } finally {
    await app.close();
  }
});

test("the HTTP interface explains when a saved case checkpoint expired after a server restart", async () => {
  const conversation: RecruitmentConversation = {
    async turn() { throw new RecruitmentCaseStateExpiredError(); },
  };
  const app = createApp({ recruitmentConversation: conversation });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/case-after-restart/turns",
      payload: { message: "继续找人", expectsExistingState: true },
    });

    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /找不到此案件的内部调查状态/);
    assert.match(response.json().error, /浏览器中已有报告/);
  } finally {
    await app.close();
  }
});

test("the HTTP interface clearly reports when no model service is configured", async () => {
  const app = createApp({ recruitmentConversation: unavailableRecruitmentConversation() });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/new-case/turns",
      payload: { message: "为拜仁寻找凯恩的替代者" },
    });

    assert.equal(response.statusCode, 503);
    assert.match(response.json().error, /尚未配置模型服务/);
  } finally {
    await app.close();
  }
});

test("the HTTP interface reports a bounded model wait as a gateway timeout", async () => {
  const app = createApp({
    recruitmentConversation: {
      async turn() { throw new RecruitmentModelTimeoutError(180_000); },
    },
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/model-timeout/turns",
      payload: { message: "为巴萨找一名中场" },
    });

    assert.equal(response.statusCode, 504);
    assert.match(response.json().error, /超过 180 秒/);
  } finally {
    await app.close();
  }
});

test("knowledge status uses the knowledge base injected into the application", async () => {
  let statusReads = 0;
  const knowledgeBase = {
    async search() { return []; },
    async status() {
      statusReads += 1;
      return {
        indexedChunks: 42,
        methodologyChunks: 40,
        playerReportChunks: 2,
        registeredSources: 7,
        ingestiblePlayerReportSources: 3,
        embeddingModel: "test-embedding",
        indexPath: "/test/knowledge-index",
      };
    },
  };
  const app = createApp({ knowledgeBase, recruitmentConversation: unavailableRecruitmentConversation() });

  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/knowledge/status" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().indexedChunks, 42);
    assert.equal(response.json().indexPath, "/test/knowledge-index");
    assert.equal(statusReads, 1);
  } finally {
    await app.close();
  }
});
