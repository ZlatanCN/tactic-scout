import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";
import { createRecruitmentConversation, type RecruitmentConversation, type RecruitmentPlanner } from "../../src/recruitment/conversation.js";
import {
  createRecruitmentTurnRuntime,
  type RecruitmentTurnGraph,
  type RecruitmentTurnGraphRun,
} from "../../src/recruitment/conversation-turn-runtime.js";
import { RecruitmentTurnCancelledError } from "../../src/recruitment/turn-cancellation.js";

const emptyProgress = async function* () {};

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 1500);
    }),
  ]).finally(() => clearTimeout(timer));
}

test("HTTP stop request stays active until the cancelled turn reaches terminal progress", async () => {
  const requestId = "7a2105a1-0e1a-4f76-9bb2-8c0ef1cc0bc2";
  let signalTurnStarted!: () => void;
  let signalAbortObserved!: () => void;
  let finishCancellation!: () => void;
  const turnStarted = new Promise<void>((resolve) => { signalTurnStarted = resolve; });
  const abortObserved = new Promise<void>((resolve) => { signalAbortObserved = resolve; });
  const cancellationGate = new Promise<void>((resolve) => { finishCancellation = resolve; });
  const conversation: RecruitmentConversation = {
    async turn({ signal }) {
      signalTurnStarted();
      return new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener("abort", () => {
          signalAbortObserved();
          void cancellationGate.then(() => reject(signal.reason));
        }, { once: true });
      });
    },
  };
  const app = createApp({ recruitmentConversation: conversation });
  const caseId = "cancel-http-turn";
  const turnUrl = `/api/v1/recruitment/cases/${caseId}/turns`;
  const cancelUrl = `${turnUrl}/${requestId}/cancel`;

  try {
    const pendingTurn = app.inject({
      method: "POST",
      url: turnUrl,
      payload: { requestId, message: "为拜仁寻找凯恩的替代者" },
    });
    await turnStarted;

    const cancelResponse = await app.inject({
      method: "POST",
      url: cancelUrl,
    });
    assert.equal(cancelResponse.statusCode, 200);
    assert.deepEqual(cancelResponse.json(), { status: "requested" });

    await abortObserved;
    const stoppingResponse = await app.inject({
      method: "GET",
      url: `/api/v1/recruitment/cases/${caseId}/progress?requestId=${requestId}`,
    });
    assert.equal(stoppingResponse.statusCode, 200);
    assert.equal(stoppingResponse.json().active, true);
    assert.equal(stoppingResponse.json().stage, "cancelling");
    assert.equal(stoppingResponse.json().events.at(-1).status, "started");
    assert.equal(stoppingResponse.json().events.filter((event: { stage: string }) => event.stage === "cancelling").length, 1);
    const repeatedCancel = await app.inject({ method: "POST", url: cancelUrl });
    assert.deepEqual(repeatedCancel.json(), { status: "requested" });

    finishCancellation();
    const turnResponse = await pendingTurn;
    const progressResponse = await app.inject({
      method: "GET",
      url: `/api/v1/recruitment/cases/${caseId}/progress?requestId=${requestId}`,
    });
    assert.equal(turnResponse.statusCode, 200);
    assert.equal(turnResponse.json().status, "cancelled");
    assert.equal(progressResponse.statusCode, 200);
    assert.equal(progressResponse.json().active, false);
    assert.equal(progressResponse.json().stage, "cancelled");
    assert.equal(progressResponse.json().events.at(-1).status, "cancelled");
    const terminalEvents = progressResponse.json().events as Array<{ sequence: number; stage: string; status: string }>;
    assert.deepEqual(terminalEvents.slice(-2).map((event) => `${event.stage}:${event.status}`), [
      "cancelling:started",
      "cancelled:cancelled",
    ]);
    assert.equal(new Set(terminalEvents.map((event) => event.sequence)).size, terminalEvents.length);
  } finally {
    await app.close();
  }
});

test("LangGraph runtime turns an aborted graph run into a cancelled terminal event", async () => {
  const controller = new AbortController();
  let signalPlannerStarted!: () => void;
  let signalPlanningProgress!: () => void;
  let plannerSignal: AbortSignal | undefined;
  const plannerStarted = new Promise<void>((resolve) => { signalPlannerStarted = resolve; });
  const planningProgress = new Promise<void>((resolve) => { signalPlanningProgress = resolve; });
  const planner: RecruitmentPlanner = {
    async decide({ signal }) {
      plannerSignal = signal;
      signalPlannerStarted();
      return new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  };
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "演示数据" },
    planner,
    knowledgeBase: { async search() { return []; } },
  });
  const progress: Array<{ stage: string; status: string }> = [];
  const pendingTurn = conversation.turn({
    threadId: "cancel-runtime-turn",
    message: "为巴萨找一名后卫",
    signal: controller.signal,
    onProgress: ({ stage, status }) => {
      progress.push({ stage, status });
      if (stage === "planning" && status === "started") signalPlanningProgress();
    },
  });

  await plannerStarted;
  await withTimeout(planningProgress, "planning progress while Planner is running");
  controller.abort(new RecruitmentTurnCancelledError());

  await assert.rejects(pendingTurn, RecruitmentTurnCancelledError);
  assert.equal(plannerSignal?.aborted, true, "the compiled graph must propagate cancellation to the Planner");
  assert.deepEqual(progress.at(-1), { stage: "cancelled", status: "cancelled" });
});

test("the compiled recruitment graph forwards turn cancellation to an active candidate search", async () => {
  const controller = new AbortController();
  let signalCandidateSearchStarted!: () => void;
  let signalCandidateSearchAborted!: () => void;
  let repositorySignal: AbortSignal | undefined;
  const candidateSearchStarted = new Promise<void>((resolve) => { signalCandidateSearchStarted = resolve; });
  const candidateSearchAborted = new Promise<void>((resolve) => { signalCandidateSearchAborted = resolve; });
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "Fictional TactiScout demo data",
      async searchCandidates(_query, signal?: AbortSignal) {
        repositorySignal = signal;
        signalCandidateSearchStarted();
        return new Promise((_resolve, reject) => {
          if (!signal) return;
          if (signal.aborted) {
            signalCandidateSearchAborted();
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => {
            signalCandidateSearchAborted();
            reject(signal.reason);
          }, { once: true });
        });
      },
    },
    planner: {
      async decide({ history }) {
        return history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology")
          ? { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 }
          : { action: "search_methodology", query: "中锋角色的可观察评估指标" };
      },
    },
    knowledgeBase: { async search() { return []; } },
  });
  const progress: Array<{ stage: string; status: string }> = [];
  const pendingTurn = conversation.turn({
    threadId: "cancel-active-candidate-search",
    message: "为拜仁找一名前锋",
    signal: controller.signal,
    onProgress: ({ stage, status }) => progress.push({ stage, status }),
  });

  await withTimeout(candidateSearchStarted, "candidate search to start");
  assert.ok(repositorySignal instanceof AbortSignal);
  controller.abort(new RecruitmentTurnCancelledError());
  await withTimeout(candidateSearchAborted, "candidate search to observe cancellation");
  assert.equal(repositorySignal?.aborted, true);
  await assert.rejects(pendingTurn, RecruitmentTurnCancelledError);
  assert.deepEqual(progress.at(-1), { stage: "cancelled", status: "cancelled" });
});

test("the compiled recruitment graph forwards turn cancellation to active team inspection", async () => {
  const controller = new AbortController();
  let inspectionStarted!: () => void;
  let inspectionAborted!: () => void;
  let repositorySignal: AbortSignal | undefined;
  let plannerCalls = 0;
  const started = new Promise<void>((resolve) => { inspectionStarted = resolve; });
  const aborted = new Promise<void>((resolve) => { inspectionAborted = resolve; });
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "Fictional TactiScout demo data",
      async inspectTeam(_teamName, signal) {
        repositorySignal = signal;
        inspectionStarted();
        return new Promise((_resolve, reject) => {
          if (!signal) return;
          signal.addEventListener("abort", () => {
            inspectionAborted();
            reject(signal.reason);
          }, { once: true });
        });
      },
    },
    planner: {
      async decide() {
        plannerCalls += 1;
        return { action: "inspect_team", teamName: "拜仁慕尼黑" };
      },
    },
    knowledgeBase: { async search() { return []; } },
  });
  const pendingTurn = conversation.turn({
    threadId: "cancel-active-team-inspection",
    message: "为拜仁慕尼黑寻找凯恩替代者",
    signal: controller.signal,
  });

  await withTimeout(started, "team inspection to start");
  assert.ok(repositorySignal instanceof AbortSignal);
  controller.abort(new RecruitmentTurnCancelledError());
  await withTimeout(aborted, "team inspection to observe cancellation");
  await assert.rejects(pendingTurn, RecruitmentTurnCancelledError);
  assert.equal(plannerCalls, 0, "automatic reference inspection must cancel without calling or restarting Planner");
});

test("the signal-on/off adapter ablation separates stopped source work from post-terminal work", async () => {
  let armNumber = 0;
  const runArm = async (forwardSignal: boolean) => {
    const controller = new AbortController();
    let signalSearchStarted!: () => void;
    let activeOperations = 0;
    let releaseUncooperativeSearch: (() => void) | undefined;
    const searchStarted = new Promise<void>((resolve) => { signalSearchStarted = resolve; });
    const conversation = createRecruitmentConversation({
      repository: {
        mode: "demo",
        sourceName: "Fixed cancellation fixture",
        async searchCandidates(query, signal) {
          activeOperations += 1;
          signalSearchStarted();
          return new Promise((_resolve, reject) => {
            const settle = (error?: unknown) => {
              activeOperations -= 1;
              if (error) reject(error);
            };
            releaseUncooperativeSearch = () => settle();
            if (forwardSignal && signal) {
              if (signal.aborted) settle(signal.reason);
              else signal.addEventListener("abort", () => settle(signal.reason), { once: true });
            }
          });
        },
      },
      planner: {
        async decide({ history }) {
          return history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology")
            ? { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 }
            : { action: "search_methodology", query: "中锋角色的可观察评估指标" };
        },
      },
      knowledgeBase: { async search() { return []; } },
    });
    const pendingTurn = conversation.turn({
      threadId: `cancel-signal-ablation-${++armNumber}`,
      message: "为拜仁找一名前锋",
      signal: controller.signal,
    });
    await withTimeout(searchStarted, "candidate search to start in ablation arm");
    const cancelStartedAt = performance.now();
    controller.abort(new RecruitmentTurnCancelledError());
    await assert.rejects(withTimeout(pendingTurn, "graph cancellation terminal"), RecruitmentTurnCancelledError);
    const terminalElapsedMs = performance.now() - cancelStartedAt;
    const activeAtTerminal = activeOperations;
    releaseUncooperativeSearch?.();
    return { activeAtTerminal, terminalElapsedMs };
  };

  const signalOn = await Promise.all(Array.from({ length: 3 }, () => runArm(true)));
  const signalOff = await Promise.all(Array.from({ length: 3 }, () => runArm(false)));
  assert.deepEqual(signalOn.map(({ activeAtTerminal }) => activeAtTerminal), [0, 0, 0]);
  assert.deepEqual(signalOff.map(({ activeAtTerminal }) => activeAtTerminal), [1, 1, 1]);
  assert.ok([...signalOn, ...signalOff].every(({ terminalElapsedMs }) => terminalElapsedMs >= 0));
});

test("the compiled recruitment graph forwards cancellation through active methodology retrieval", async () => {
  const controller = new AbortController();
  let signalRetrievalStarted!: () => void;
  let signalRetrievalAborted!: () => void;
  let retrievalSignal: AbortSignal | undefined;
  let plannerCalls = 0;
  const retrievalStarted = new Promise<void>((resolve) => { signalRetrievalStarted = resolve; });
  const retrievalAborted = new Promise<void>((resolve) => { signalRetrievalAborted = resolve; });
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Fictional TactiScout demo data" },
    planner: { async decide() { plannerCalls += 1; return { action: "search_methodology", query: "中锋角色的可观察评估指标" }; } },
    knowledgeBase: {
      async search(_request, options) {
        retrievalSignal = options?.signal;
        signalRetrievalStarted();
        return new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (!signal) return;
          signal.addEventListener("abort", () => {
            signalRetrievalAborted();
            reject(signal.reason);
          }, { once: true });
        });
      },
    },
  });
  const progress: Array<{ stage: string; status: string }> = [];
  const pendingTurn = conversation.turn({
    threadId: "cancel-active-methodology-retrieval",
    message: "为拜仁找一名前锋",
    signal: controller.signal,
    onProgress: ({ stage, status }) => progress.push({ stage, status }),
  });

  await withTimeout(retrievalStarted, "methodology retrieval to start");
  assert.ok(retrievalSignal instanceof AbortSignal);
  controller.abort(new RecruitmentTurnCancelledError());
  await withTimeout(retrievalAborted, "methodology retrieval to observe cancellation");
  await assert.rejects(pendingTurn, RecruitmentTurnCancelledError);
  assert.equal(plannerCalls, 1, "a cancelled RAG action must not re-enter Planner");
  assert.deepEqual(progress.at(-1), { stage: "cancelled", status: "cancelled" });
});

test("candidate evaluation propagates cancellation to its player and peer reads", async () => {
  const controller = new AbortController();
  const player = {
    playerId: "cancellable-forward",
    name: "Fixture Forward",
    team: "Harbor City",
    age: 22,
    position: "ST" as const,
    competition: "Open League",
    season: "2025/26",
    minutes: 1800,
    stats: { goals: 8, assists: 2, passesAttempted: 200, passesCompleted: 140, longPasses: 8, carries: 30, pressures: 80, tackles: 3, interceptions: 2, shotAssists: 5 },
    source: "Fixed evaluator fixture",
  };
  let signalCandidatesFound!: () => void;
  let signalPlayerReadStarted!: () => void;
  let signalPlayerReadAborted!: () => void;
  let playerReadSignal: AbortSignal | undefined;
  let plannerCalls = 0;
  let peerReads = 0;
  const candidatesFound = new Promise<void>((resolve) => { signalCandidatesFound = resolve; });
  const playerReadStarted = new Promise<void>((resolve) => { signalPlayerReadStarted = resolve; });
  const playerReadAborted = new Promise<void>((resolve) => { signalPlayerReadAborted = resolve; });
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "Fixed evaluator fixture",
      async searchCandidates(query) {
        signalCandidatesFound();
        return { players: [player], totalRecords: 1, offset: query.offset, nextOffset: null, appliedFilters: ["position"] };
      },
      async getPlayersByIds(_playerIds, signal) {
        playerReadSignal = signal;
        signalPlayerReadStarted();
        return new Promise((_resolve, reject) => {
          if (!signal) return;
          signal.addEventListener("abort", () => {
            signalPlayerReadAborted();
            reject(signal.reason);
          }, { once: true });
        });
      },
      async getComparisonPlayers() { peerReads += 1; return [player]; },
    },
    planner: {
      async decide({ history }) {
        plannerCalls += 1;
        return history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology")
          ? { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 10 }
          : { action: "search_methodology", query: "中锋角色的可观察评估指标" };
      },
    },
    knowledgeBase: { async search() { return []; } },
  });
  const pendingTurn = conversation.turn({
    threadId: "cancel-active-candidate-evaluation",
    message: "为拜仁找一名前锋",
    signal: controller.signal,
  });

  await withTimeout(candidatesFound, "candidate search to finish");
  await withTimeout(playerReadStarted, "evaluator player read to start");
  assert.ok(playerReadSignal instanceof AbortSignal);
  controller.abort(new RecruitmentTurnCancelledError());
  await withTimeout(playerReadAborted, "evaluator player read to observe cancellation");
  await assert.rejects(pendingTurn, RecruitmentTurnCancelledError);
  assert.equal(peerReads, 0, "evaluation must not start the comparison cohort read after its player read is cancelled");
  assert.equal(plannerCalls, 2, "a cancelled evaluation must not re-enter Planner");
});

test("cancelling a running turn releases the same-case queue for its next turn", async () => {
  const firstController = new AbortController();
  let signalFirstRunStarted!: () => void;
  let signalSecondRunStarted!: () => void;
  const firstRunStarted = new Promise<void>((resolve) => { signalFirstRunStarted = resolve; });
  const secondRunStarted = new Promise<void>((resolve) => { signalSecondRunStarted = resolve; });
  let runCount = 0;
  let activeRuns = 0;
  let maximumActiveRuns = 0;
  let checkpoint: { values: { pendingQuestion: null; responseMessage: string; report: null } | undefined; tasks: Array<{ interrupts: unknown[] }> } = {
    values: undefined,
    tasks: [],
  };
  const graph: RecruitmentTurnGraph = {
    async getCheckpoint() { return checkpoint; },
    async run({ signal }): Promise<RecruitmentTurnGraphRun> {
      runCount += 1;
      const thisRun = runCount;
      if (thisRun === 1) signalFirstRunStarted();
      else signalSecondRunStarted();

      const output = new Promise<void>((resolve, reject) => {
        activeRuns += 1;
        maximumActiveRuns = Math.max(maximumActiveRuns, activeRuns);
        if (thisRun === 1) {
          const finish = (error?: unknown) => {
            activeRuns -= 1;
            if (error) reject(error);
            else resolve();
          };
          if (signal?.aborted) finish(signal.reason);
          else signal?.addEventListener("abort", () => finish(signal.reason), { once: true });
          return;
        }

        checkpoint = {
          values: { pendingQuestion: null, responseMessage: "排队回合已完成", report: null },
          tasks: [],
        };
        activeRuns -= 1;
        resolve();
      });
      return { output, extensions: { recruitmentProgress: emptyProgress() } };
    },
  };
  const turn = createRecruitmentTurnRuntime({
    graph,
    assertTurnAllowed: () => undefined,
    createExpiredStateError: () => new Error("案件状态已失效"),
  });
  const first = turn({
    threadId: "cancel-queue-turn",
    message: "第一轮",
    signal: firstController.signal,
  });
  await firstRunStarted;
  const second = turn({ threadId: "cancel-queue-turn", message: "排队的第二轮" });

  firstController.abort(new RecruitmentTurnCancelledError());

  await assert.rejects(first, RecruitmentTurnCancelledError);
  await withTimeout(secondRunStarted, "queued graph run to start");
  const secondResponse = await withTimeout(second, "queued turn to complete");
  assert.equal(secondResponse.status, "completed");
  assert.equal(secondResponse.message, "排队回合已完成");
  assert.equal(runCount, 2);
  assert.equal(maximumActiveRuns, 1);
});
