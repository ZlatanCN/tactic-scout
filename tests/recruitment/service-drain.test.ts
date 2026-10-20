import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RunControl } from "@langchain/langgraph";
import Fastify from "fastify";
import { ConversationTurnRequestSchema } from "../../src/domain/requirements.js";
import { createApp } from "../../src/app.js";
import { RecruitmentTurnCoordinator } from "../../src/recruitment/turn-coordinator.js";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import { createRecruitmentCheckpointStore } from "../../src/recruitment/checkpoint-store.js";
import { SQLiteBaseStore } from "../../src/recruitment/preferences/sqlite-base-store.js";
import { RecruitmentServiceDrainingError } from "../../src/recruitment/conversation-turn-runtime.js";
import { RecruitmentTurnService as RecruitmentTurnServiceClass, RecruitmentServiceDrainingStateError } from "../../src/app/recruitment-turn-service.js";
import { registerRecruitmentTurnRoute } from "../../src/app/routes/recruitment-turn.js";
import { registerRecruitmentProgressRoutes } from "../../src/app/routes/recruitment-progress.js";
import type { RecruitmentConversation } from "../../src/recruitment/conversation.js";
import type { ConversationTurnResponse, RecruitmentProgress } from "../../src/domain/conversation.js";
import type { RecruitmentProgressEmitter } from "../../src/app/routes/recruitment-types.js";
import { RecruitmentTurnCancelledError } from "../../src/recruitment/turn-cancellation.js";
import { createTheSportsDbRosterEnrichment } from "../../src/sources/thesportsdb/roster.js";
import { roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

function timeout<T>(promise: Promise<T>, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), 5000); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("RunControl drain checkpoints a full-graph turn and resumes after SQLite close/reopen without repeating the read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tactiscout-drained-resume-"));
  const checkpointPath = join(directory, "cases.sqlite");
  let store = createRecruitmentCheckpointStore(checkpointPath);
  const player = roleConstraintPlayer("drain-resume-player", "Drain Resume Player", "LB");
  let searchCount = 0;
  let searchStarted!: () => void;
  let releaseSearch!: () => void;
  const searchStart = new Promise<void>((resolve) => { searchStarted = resolve; });
  const searchGate = new Promise<void>((resolve) => { releaseSearch = resolve; });
  let blockNextSearch = false;
  const repository = {
    mode: "demo" as const,
    sourceName: "Drain resume fixture",
    async loadPlayers() { return [player]; },
    async searchCandidates(query: { offset: number; position: string | null }) {
      searchCount += 1;
      if (blockNextSearch) {
        blockNextSearch = false;
        searchStarted();
        await searchGate;
      }
      return { players: [player], totalRecords: 1, offset: query.offset, nextOffset: null, appliedFilters: query.position ? ["position" as const] : [] };
    },
  };
  const knowledgeBase = { async search() { return []; } };
  const planner = {
    async decide(input: Parameters<NonNullable<Parameters<typeof createRecruitmentConversation>[0]["planner"]>["decide"]>[0]) {
      const currentTools = input.history.filter((entry) => entry.role === "tool").map((entry) => entry.toolName);
      if (input.decisionSnapshot.case.confirmedPositions.length > 0) return {
        action: "finish" as const, targetTeam: "Barcelona", needSummary: "Resumed after service drain.",
        capabilityProfile: ["duels"], recommendations: [], limitationKeys: ["other" as const],
      };
      if (!currentTools.includes("search_methodology")) return { action: "search_methodology" as const, query: "左后卫对抗评估" };
      return { action: "search_candidates" as const, position: input.decisionSnapshot.case.confirmedPosition, minimumMinutes: 0, limit: 20 };
    },
  };
  const buildConversation = () => createRecruitmentConversation({
    repository, planner, knowledgeBase, checkpointer: store.checkpointer,
    experimentalRetrievalMode: "on_demand", experimentalReviewerMode: "bypassed",
    experimentalExpansionSufficiencyMode: "bypassed",
  });

  try {
    let conversation = buildConversation();
    const paused = await conversation.turn({ threadId: "service-drain-case", message: "为巴萨寻找提升防守的球员，重点看抢断。" });
    assert.equal(paused.status, "needs_input");
    assert.equal(paused.question?.input?.kind, "positions");
    assert.equal(searchCount, 1);
    blockNextSearch = true;
    const runControl = new RunControl();
    const active = conversation.turn({
      threadId: "service-drain-case", message: "", expectsExistingState: true,
      positionAnswer: { questionId: paused.question!.input!.questionId, positions: ["LB"] },
      runControl,
    });
    await timeout(searchStart, "candidate search to begin");
    runControl.requestDrain("service_shutdown");
    releaseSearch();
    await assert.rejects(active, RecruitmentServiceDrainingError);
    assert.equal(searchCount, 2, "the started candidate read is a distinct position scope and should only run once");
    const beforeClose = await conversation.inspectCaseRun!({ threadId: "service-drain-case", limit: 100 });
    assert.ok(beforeClose.checkpoints.some((checkpoint) => checkpoint.safeSummary.action === "search_candidates"));
    store.close();

    store = createRecruitmentCheckpointStore(checkpointPath);
    conversation = buildConversation();
    const recovered = await conversation.turn({ threadId: "service-drain-case", message: "resume saved work", expectsExistingState: true });
    assert.equal(recovered.status, "completed", recovered.message);
    assert.equal(searchCount, 2);
    const afterRecovery = await conversation.inspectCaseRun!({ threadId: "service-drain-case", limit: 100 });
    assert.equal(afterRecovery.checkpoints.at(-1)?.interrupted, false);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Fastify preClose drains an active graph before closing SQLite stores, then the app can resume it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tactiscout-app-drain-"));
  const checkpointPath = join(directory, "cases.sqlite");
  const preferencePath = join(directory, "preferences.sqlite");
  let store = createRecruitmentCheckpointStore(checkpointPath);
  let preferences = new SQLiteBaseStore(preferencePath);
  let checkpointOpen = true;
  let preferencesOpen = true;
  let app: ReturnType<typeof createApp> | undefined;
  const player = roleConstraintPlayer("app-drain-player", "App Drain Player", "LB");
  let searchCount = 0;
  let searchStarted!: () => void;
  let releaseSearch!: () => void;
  const searchStart = new Promise<void>((resolve) => { searchStarted = resolve; });
  const searchGate = new Promise<void>((resolve) => { releaseSearch = resolve; });
  let blockNextSearch = false;
  const repository = {
    mode: "demo" as const,
    sourceName: "App shutdown fixture",
    async loadPlayers() { return [player]; },
    async searchCandidates(query: { offset: number; position: string | null }) {
      searchCount += 1;
      if (blockNextSearch) {
        blockNextSearch = false;
        searchStarted();
        await searchGate;
      }
      return { players: [player], totalRecords: 1, offset: query.offset, nextOffset: null, appliedFilters: query.position ? ["position" as const] : [] };
    },
  };
  const planner = {
    async decide(input: Parameters<NonNullable<Parameters<typeof createRecruitmentConversation>[0]["planner"]>["decide"]>[0]) {
      const currentTools = input.history.filter((entry) => entry.role === "tool").map((entry) => entry.toolName);
      if (input.decisionSnapshot.case.confirmedPositions.length > 0) return {
        action: "finish" as const, targetTeam: "Barcelona", needSummary: "Resumed after Fastify shutdown.",
        capabilityProfile: ["duels"], recommendations: [], limitationKeys: ["other" as const],
      };
      if (!currentTools.includes("search_methodology")) return { action: "search_methodology" as const, query: "左后卫对抗评估" };
      return { action: "search_candidates" as const, position: input.decisionSnapshot.case.confirmedPosition, minimumMinutes: 0, limit: 20 };
    },
  };
  const buildApp = () => createApp({
    playerRepository: repository,
    recruitmentConversation: createRecruitmentConversation({
      repository,
      planner,
      knowledgeBase: { async search() { return []; } },
      checkpointer: store.checkpointer,
      store: preferences,
      experimentalRetrievalMode: "on_demand",
      experimentalReviewerMode: "bypassed",
      experimentalExpansionSufficiencyMode: "bypassed",
    }),
    preferenceStore: preferences,
  });

  try {
    app = buildApp();
    const paused = await app.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/app-drain-case/turns",
      payload: { message: "为巴萨寻找提升防守的球员，重点看抢断。" },
    });
    assert.equal(paused.statusCode, 200);
    const pausedResponse = paused.json() as Awaited<ReturnType<ReturnType<typeof createRecruitmentConversation>["turn"]>>;
    assert.equal(pausedResponse.status, "needs_input");
    assert.equal(searchCount, 1);
    blockNextSearch = true;
    const activeTurn = app.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/app-drain-case/turns",
      payload: {
        expectsExistingState: true,
        message: "",
        positionAnswer: { questionId: pausedResponse.question!.input!.questionId, positions: ["LB"] },
      },
    });
    await timeout(searchStart, "Fastify app candidate query to start");
    const closing = app.close();
    await delay(20);
    releaseSearch();
    const response = await timeout(activeTurn, "Fastify active turn to drain");
    await timeout(closing, "Fastify app to close after drain");
    app = undefined;
    preferencesOpen = false;
    assert.equal(response.statusCode, 503);
    assert.equal(searchCount, 2);

    store.close();
    checkpointOpen = false;
    store = createRecruitmentCheckpointStore(checkpointPath);
    checkpointOpen = true;
    preferences = new SQLiteBaseStore(preferencePath);
    preferencesOpen = true;
    app = buildApp();
    const recovered = await app.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/app-drain-case/turns",
      payload: { expectsExistingState: true, message: "继续已保存的案件" },
    });
    assert.equal(recovered.statusCode, 200, recovered.body);
    assert.equal(recovered.json().status, "completed");
    assert.equal(searchCount, 2, "Fastify close/reopen must resume without repeating the checkpointed candidate query");
    await app.close();
    app = undefined;
    preferencesOpen = false;
  } finally {
    releaseSearch();
    if (app) await app.close().catch(() => undefined);
    if (checkpointOpen) store.close();
    if (preferencesOpen) await preferences.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("service drain is distinct from cancellation, rejects new turns, and waits for the active run", async () => {
  const fastify = Fastify({ logger: false });
  await fastify.ready();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let controls: RunControl | undefined;
  const conversation = {
    async turn(input: { runControl?: RunControl; onProgress?: (value: { stage: "service_draining"; status: "notice"; message: string; completedSteps: number }) => void }) {
      controls = input.runControl;
      entered();
      await timeout(new Promise<void>((resolve, reject) => {
        const timer = setInterval(() => {
          if (input.runControl?.drainRequested) {
            clearInterval(timer);
            input.onProgress?.({ stage: "service_draining", status: "notice", message: "checkpoint saved for restart", completedSteps: 1 });
            reject(new RecruitmentServiceDrainingError());
          }
        }, 5);
      }), "service drain request");
      throw new Error("unreachable");
    },
  } as unknown as import("../../src/recruitment/conversation.js").RecruitmentConversation;
  const service = new RecruitmentTurnServiceClass({
    recruitmentConversation: conversation,
    recruitmentTurnCoordinator: new RecruitmentTurnCoordinator(),
    recruitmentProgressByCase: new Map(),
    recruitmentProgressEmitters: new Map(),
    teamRosterEnrichment: createTheSportsDbRosterEnrichment({ apiKey: "", fetchEnabled: false }),
    teamRosterEnrichmentConfigured: false,
  });
  const logger = fastify.log;
  const run = service.execute({ caseId: "active-case", request: ConversationTurnRequestSchema.parse({ message: "Find a midfielder", requestId: randomUUID() }), logger });
  await timeout(started, "active turn to start");
  const drain = service.drain(1000);
  assert.equal(controls?.drainRequested, true);
  await assert.rejects(
    service.execute({ caseId: "new-case", request: ConversationTurnRequestSchema.parse({ message: "Find a forward" }), logger }),
    RecruitmentServiceDrainingStateError,
  );
  await assert.rejects(run, RecruitmentServiceDrainingError);
  assert.deepEqual(await drain, { status: "drained", activeTurns: 0 });
  await fastify.close();
});

test("drain timeout reports the remaining active turn and leaves it able to settle", async () => {
  const fastify = Fastify({ logger: false });
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const conversation = {
    async turn(input: { threadId: string }) {
      entered();
      await gate;
      return { threadId: input.threadId, status: "completed" as const, message: "已完成", question: null, report: null };
    },
  } as unknown as import("../../src/recruitment/conversation.js").RecruitmentConversation;
  const service = new RecruitmentTurnServiceClass({
    recruitmentConversation: conversation,
    recruitmentTurnCoordinator: new RecruitmentTurnCoordinator(),
    recruitmentProgressByCase: new Map(),
    recruitmentProgressEmitters: new Map(),
    teamRosterEnrichment: createTheSportsDbRosterEnrichment({ apiKey: "", fetchEnabled: false }),
    teamRosterEnrichmentConfigured: false,
  });
  const run = service.execute({ caseId: "drain-timeout-case", request: ConversationTurnRequestSchema.parse({ message: "进行一轮调查" }), logger: fastify.log });
  try {
    await timeout(started, "timeout fixture turn to start");
    assert.deepEqual(await service.drain(1), { status: "timeout", activeTurns: 1 });
    await assert.rejects(
      service.execute({ caseId: "new-after-timeout", request: ConversationTurnRequestSchema.parse({ message: "新调查" }), logger: fastify.log }),
      RecruitmentServiceDrainingStateError,
    );
  } finally {
    release();
  }
  assert.equal((await run).status, "completed");
  await fastify.close();
});

test("HTTP/SSE reports service drain separately from user cancellation", async () => {
  async function createRouteHarness(recruitmentConversation: RecruitmentConversation) {
    const fastify = Fastify({ logger: false });
    const recruitmentTurnCoordinator = new RecruitmentTurnCoordinator<ConversationTurnResponse>();
    const recruitmentProgressByCase = new Map<string, RecruitmentProgress>();
    const recruitmentProgressEmitters = new Map<string, RecruitmentProgressEmitter>();
    const teamRosterEnrichment = createTheSportsDbRosterEnrichment({ apiKey: "", fetchEnabled: false });
    const recruitmentTurnService = new RecruitmentTurnServiceClass({
      recruitmentConversation,
      recruitmentTurnCoordinator,
      recruitmentProgressByCase,
      recruitmentProgressEmitters,
      teamRosterEnrichment,
      teamRosterEnrichmentConfigured: false,
    });
    const context = {
      recruitmentConversation,
      recruitmentTurnCoordinator,
      recruitmentTurnService,
      recruitmentProgressByCase,
      recruitmentProgressEmitters,
      teamRosterEnrichment,
      teamRosterEnrichmentConfigured: false,
    };
    registerRecruitmentProgressRoutes(fastify, context);
    registerRecruitmentTurnRoute(fastify, context);
    await fastify.ready();
    return { fastify, recruitmentTurnService };
  }

  let drainStarted!: () => void;
  const drainTurnStarted = new Promise<void>((resolve) => { drainStarted = resolve; });
  const drainingConversation: RecruitmentConversation = {
    async turn(input) {
      drainStarted();
      return new Promise((_resolve, reject) => {
        const timer = setInterval(() => {
          if (!input.runControl?.drainRequested) return;
          clearInterval(timer);
          input.onProgress?.({ stage: "service_draining", status: "notice", message: "案件 checkpoint 已保存，可在服务重启后继续", completedSteps: 1 });
          reject(new RecruitmentServiceDrainingError());
        }, 5);
      });
    },
  };
  const drainHarness = await createRouteHarness(drainingConversation);
  const drainRequestId = randomUUID();
  try {
    const stream = drainHarness.fastify.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/draining-sse/turns/stream",
      headers: { accept: "text/event-stream" },
      payload: { requestId: drainRequestId, message: "继续保存中的案件" },
    });
    await timeout(drainTurnStarted, "HTTP/SSE drain turn to start");
    const drain = drainHarness.recruitmentTurnService.drain(1000);
    const streamed = await timeout(stream, "HTTP/SSE drain stream to close");
    assert.equal((await drain).status, "drained");
    assert.equal(streamed.statusCode, 200);
    const drainEvents = streamed.payload.split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; progress?: { stage: string }; statusCode?: number });
    assert.ok(drainEvents.some((event) => event.type === "progress" && event.progress?.stage === "service_draining"));
    assert.ok(drainEvents.some((event) => event.type === "error" && event.statusCode === 503));
    assert.ok(drainEvents.every((event) => !(event.type === "progress" && event.progress?.stage === "cancelled")));
  } finally {
    await drainHarness.fastify.close();
  }

  let cancelStarted!: () => void;
  const cancelTurnStarted = new Promise<void>((resolve) => { cancelStarted = resolve; });
  const cancellableConversation: RecruitmentConversation = {
    async turn(input) {
      cancelStarted();
      return new Promise((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => reject(input.signal?.reason ?? new RecruitmentTurnCancelledError()), { once: true });
      });
    },
  };
  const cancelHarness = await createRouteHarness(cancellableConversation);
  const cancelRequestId = randomUUID();
  try {
    const stream = cancelHarness.fastify.inject({
      method: "POST",
      url: "/api/v1/recruitment/cases/cancel-sse/turns/stream",
      headers: { accept: "text/event-stream" },
      payload: { requestId: cancelRequestId, message: "开始并取消调查" },
    });
    await timeout(cancelTurnStarted, "HTTP/SSE cancellable turn to start");
    const cancellation = await cancelHarness.fastify.inject({
      method: "POST",
      url: `/api/v1/recruitment/cases/cancel-sse/turns/${cancelRequestId}/cancel`,
    });
    assert.equal(cancellation.statusCode, 200);
    assert.deepEqual(cancellation.json(), { status: "requested" });
    const streamed = await timeout(stream, "HTTP/SSE cancellation stream to close");
    const cancelEvents = streamed.payload.split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; progress?: { stage: string }; response?: { status: string }; statusCode?: number });
    assert.ok(cancelEvents.some((event) => event.type === "progress" && event.progress?.stage === "cancelling"));
    assert.ok(cancelEvents.some((event) => event.type === "result" && event.response?.status === "cancelled"));
    assert.ok(cancelEvents.every((event) => event.type !== "error" && !(event.type === "progress" && event.progress?.stage === "service_draining")));
  } finally {
    await cancelHarness.fastify.close();
  }
});
