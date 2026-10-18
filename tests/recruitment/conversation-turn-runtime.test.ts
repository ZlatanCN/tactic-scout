import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecruitmentTurnRuntime,
  type RecruitmentTurnGraph,
  type RecruitmentTurnGraphRun,
  type RecruitmentTurnCheckpoint,
  type RecruitmentTurnState,
} from "../../src/recruitment/conversation-turn-runtime.js";

function graphRun(options: { candidates?: AsyncIterable<unknown> } = {}): RecruitmentTurnGraphRun {
  async function* progress() {
    yield {
      type: "tactiscout/recruitment-progress" as const,
      stage: "planning" as const,
      status: "started" as const,
      message: "正在规划调查步骤",
      completedSteps: 1,
    };
  }
  return {
    output: Promise.resolve(),
    extensions: {
      recruitmentProgress: progress(),
      ...(options.candidates ? { recruitmentCandidates: options.candidates as never } : {}),
    },
  };
}

function checkpoint(
  values: RecruitmentTurnState | undefined,
  interrupts: unknown[] = [],
): RecruitmentTurnCheckpoint {
  return { values, tasks: [{ interrupts }] };
}

function completedState(message = "报告已生成"): RecruitmentTurnState {
  return { pendingQuestion: null, responseMessage: message, report: null };
}

function runtime(graph: RecruitmentTurnGraph) {
  return createRecruitmentTurnRuntime({
    graph,
    assertTurnAllowed: () => undefined,
    createExpiredStateError: () => new Error("案件状态已失效"),
  });
}

test("turn runtime projects graph completion and terminal progress", async () => {
  let current = checkpoint(undefined, []);
  const turn = runtime({
    async getCheckpoint() { return current; },
    async run({ resume }) {
      assert.equal(resume, false);
      current = checkpoint(completedState());
      return graphRun();
    },
  });
  const progress: Array<{ stage: string; status: string; completedSteps: number }> = [];

  const response = await turn({
    threadId: "runtime-complete",
    message: "为拜仁找一名中场",
    onProgress: (event) => progress.push(event),
  });

  assert.equal(response.status, "completed");
  assert.equal(response.message, "报告已生成");
  assert.deepEqual(progress.map(({ stage, status }) => `${stage}:${status}`), [
    "planning:started",
    "completed:completed",
  ]);
  assert.equal(progress.at(-1)?.completedSteps, 1);
});

test("turn runtime pauses, then resumes the same checkpoint thread", async () => {
  let current = checkpoint(undefined, []);
  const resumeInputs: boolean[] = [];
  const turn = runtime({
    async getCheckpoint() { return current; },
    async run({ resume }) {
      resumeInputs.push(resume);
      current = resume
        ? checkpoint(completedState("续查完成"))
        : checkpoint({ pendingQuestion: { question: "请确认位置", reason: "位置会改变候选范围" }, responseMessage: "", report: null }, ["interrupt"]);
      return graphRun();
    },
  });

  const first = await turn({ threadId: "runtime-resume", message: "为拜仁找凯恩替代者" });
  assert.equal(first.status, "needs_input");
  assert.equal(first.message, "请确认位置");

  const resumed = await turn({ threadId: "runtime-resume", message: "中锋" });
  assert.equal(resumed.status, "completed");
  assert.deepEqual(resumeInputs, [false, true]);
});

test("turn runtime forwards candidate previews from the graph stream", async () => {
  let current = checkpoint(undefined, []);
  async function* candidates() {
    yield {
      type: "tactiscout/recruitment-candidates" as const,
      candidates: [{
        playerId: "u-1", name: "Player A", team: "Leverkusen", position: "ATT", age: 23, minutes: 900,
        source: "understat", competition: "德甲", season: "2026/27",
      }],
      completedSteps: 2,
    };
  }
  const turn = runtime({
    async getCheckpoint() { return current; },
    async run() {
      current = checkpoint(completedState());
      return graphRun({ candidates: candidates() });
    },
  });
  const received: Array<{ candidates: unknown[]; completedSteps: number }> = [];

  const response = await turn({
    threadId: "runtime-candidates",
    message: "为拜仁寻找凯恩的替代者",
    onCandidates: (event) => received.push(event),
  });

  assert.equal(response.status, "completed");
  assert.equal(received.length, 1);
  assert.equal((received[0]!.candidates[0] as { name: string }).name, "Player A");
  assert.equal(received[0]!.completedSteps, 2);
});

test("turn runtime rejects an expired saved case before invoking the graph", async () => {
  let runCount = 0;
  const turn = runtime({
    async getCheckpoint() { return checkpoint(undefined, []); },
    async run() { runCount += 1; return graphRun(); },
  });

  await assert.rejects(
    turn({ threadId: "runtime-expired", message: "继续", expectsExistingState: true }),
    /案件状态已失效/,
  );
  assert.equal(runCount, 0);
});

test("turn runtime publishes a failed terminal event and preserves graph errors", async () => {
  const failure = new Error("planner failed");
  const turn = runtime({
    async getCheckpoint() { return checkpoint(undefined, []); },
    async run() { throw failure; },
  });
  const progress: Array<{ stage: string; status: string }> = [];

  await assert.rejects(
    turn({ threadId: "runtime-error", message: "需求", onProgress: (event) => progress.push(event) }),
    failure,
  );
  assert.deepEqual(progress, [{
    stage: "failed",
    status: "failed",
    message: "本轮调查未能完成，查看错误提示后可重试",
    completedSteps: 0,
  }]);
});

test("turn runtime serializes checkpoint operations for the same thread", async () => {
  let current = checkpoint(undefined, []);
  let activeRuns = 0;
  let maximumActiveRuns = 0;
  let startedFirstRun!: () => void;
  let releaseFirstRun!: () => void;
  const firstRunStarted = new Promise<void>((resolve) => { startedFirstRun = resolve; });
  const firstRunGate = new Promise<void>((resolve) => { releaseFirstRun = resolve; });
  let runCount = 0;
  const turn = runtime({
    async getCheckpoint() { return current; },
    async run() {
      runCount += 1;
      activeRuns += 1;
      maximumActiveRuns = Math.max(maximumActiveRuns, activeRuns);
      if (runCount === 1) {
        startedFirstRun();
        await firstRunGate;
      }
      current = checkpoint(completedState());
      activeRuns -= 1;
      return graphRun();
    },
  });

  const first = turn({ threadId: "runtime-serialized", message: "第一轮" });
  await firstRunStarted;
  const second = turn({ threadId: "runtime-serialized", message: "第二轮" });
  await Promise.resolve();
  assert.equal(runCount, 1, "second turn must wait before reading or running the same graph thread");
  releaseFirstRun();
  await Promise.all([first, second]);
  assert.equal(runCount, 2);
  assert.equal(maximumActiveRuns, 1);
});
