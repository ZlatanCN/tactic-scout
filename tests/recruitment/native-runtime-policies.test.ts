import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import { RecruitmentGraphNodeFailureError } from "../../src/recruitment/conversation-turn-runtime.js";
import { createRecruitmentCheckpointStore } from "../../src/recruitment/checkpoint-store.js";
import { installRecruitmentConversationTestEnvironment, roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

test("LangGraph retries only the typed idempotent read and records a redacted unavailable failure", async () => {
  const restoreEnvironment = installRecruitmentConversationTestEnvironment();
  let candidateReadAttempts = 0;
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "Retry fixture",
      async loadPlayers() { return []; },
      async searchCandidates() {
        candidateReadAttempts += 1;
        throw Object.assign(new Error("provider response contains PRIVATE_PROVIDER_DETAIL"), { code: "network" });
      },
    },
    planner: {
      async decide(input) {
        const completedTools = new Set(input.history.filter(entry => entry.role === "tool").map(entry => entry.toolName));
        if (!completedTools.has("search_methodology")) return { action: "search_methodology", query: "中场推进评估方法" };
        return { action: "search_candidates", position: "CM", minimumMinutes: 0, limit: 20 };
      },
    },
    knowledgeBase: { async search() { return []; } },
    experimentalRetrievalMode: "on_demand",
    experimentalReviewerMode: "bypassed",
  });

  try {
    await assert.rejects(
      conversation.turn({ threadId: "native-read-retry", message: "为巴萨找一名中场" }),
      error => error instanceof RecruitmentGraphNodeFailureError && /有限自动重试已结束/.test(error.message)
        && !error.message.includes("PRIVATE_PROVIDER_DETAIL"),
    );
    assert.equal(candidateReadAttempts, 2, "the graph should make the original read plus one bounded retry");
    assert.ok(conversation.inspectCaseRun);
    const inspection = await conversation.inspectCaseRun({ threadId: "native-read-retry" });
    assert.ok(inspection.checkpoints.some(checkpoint => checkpoint.safeSummary.failureKind === "unavailable"), JSON.stringify(inspection));
    assert.doesNotMatch(JSON.stringify(inspection), /PRIVATE_PROVIDER_DETAIL|中场推进评估方法|Bearer|api[_-]?key/i);
  } finally {
    restoreEnvironment();
  }
});

test("Planner failure is safely checkpointed and visible through the read-only run inspector", async () => {
  const restoreEnvironment = installRecruitmentConversationTestEnvironment();
  const secret = "PRIVATE_PROMPT_AND_VENDOR_PAYLOAD";
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "Fixture", async loadPlayers() { return []; } },
    planner: { async decide() { throw new Error(secret); } },
    knowledgeBase: { async search() { return []; } },
    experimentalRetrievalMode: "on_demand",
  });

  try {
    await assert.rejects(
      conversation.turn({ threadId: "native-planner-failure", message: "为巴萨找一名中场" }),
      error => error instanceof RecruitmentGraphNodeFailureError && !error.message.includes(secret),
    );
    assert.ok(conversation.inspectCaseRun);
    const inspection = await conversation.inspectCaseRun({ threadId: "native-planner-failure", limit: 100 });
    assert.ok(inspection.checkpoints.some(checkpoint => checkpoint.safeSummary.failureKind === "internal"), JSON.stringify(inspection));
    assert.doesNotMatch(JSON.stringify(inspection), /PRIVATE_PROMPT_AND_VENDOR_PAYLOAD|为巴萨找一名中场/);
  } finally {
    restoreEnvironment();
  }
});

test("SQLite checkpoint survives close and reopen while a paused case resumes once", async () => {
  const restoreEnvironment = installRecruitmentConversationTestEnvironment();
  const directory = await mkdtemp(join(tmpdir(), "tactiscout-native-resume-"));
  const checkpointPath = join(directory, "case.sqlite");
  let methodologyReads = 0;
  const candidateSearchPositions: Array<string | null | undefined> = [];
  const player = roleConstraintPlayer("sqlite-resume-player", "SQLite Resume Player", "LB");
  const repository = {
    mode: "demo" as const,
    sourceName: "Persistent fixture",
    async loadPlayers() { return [player]; },
    async searchCandidates(query: { offset: number; position: string | null }) {
      candidateSearchPositions.push(query.position);
      return {
        players: [player],
        totalRecords: 1,
        offset: query.offset,
        nextOffset: null,
        appliedFilters: query.position ? ["position" as const] : [],
      };
    },
  };
  const knowledgeBase = {
    async search() { methodologyReads += 1; return []; },
  };
  const planner = {
    async decide(input: Parameters<NonNullable<Parameters<typeof createRecruitmentConversation>[0]["planner"]>["decide"]>[0]) {
      if (input.decisionSnapshot.case.confirmedPositions.length > 0) return {
        action: "finish" as const,
        targetTeam: "Barcelona",
        needSummary: "已完成持久化恢复后的调查。",
        capabilityProfile: ["防守表现"],
        recommendations: [],
        limitationKeys: ["other" as const],
      };
      if (!input.history.some(entry => entry.role === "tool" && entry.toolName === "search_methodology")) {
        return { action: "search_methodology" as const, query: "防守表现" };
      }
      return {
        action: "search_candidates" as const,
        position: input.decisionSnapshot.case.confirmedPosition,
        minimumMinutes: 0,
        limit: 20,
      };
    },
  };
  let firstStore: ReturnType<typeof createRecruitmentCheckpointStore> | undefined;
  let reopenedStore: ReturnType<typeof createRecruitmentCheckpointStore> | undefined;

  try {
    firstStore = createRecruitmentCheckpointStore(checkpointPath);
    const firstConversation = createRecruitmentConversation({
      repository,
      planner,
      knowledgeBase,
      checkpointer: firstStore.checkpointer,
      experimentalRetrievalMode: "on_demand",
      experimentalReviewerMode: "bypassed",
      experimentalExpansionSufficiencyMode: "bypassed",
    });
    const paused = await firstConversation.turn({
      threadId: "sqlite-paused-case",
      message: "为巴萨寻找提升防守的球员，重点看抢断。",
    });
    assert.equal(paused.status, "needs_input");
    assert.equal(methodologyReads, 1);
    assert.ok(paused.question?.input?.kind === "positions");
    firstStore.close();
    firstStore = undefined;

    reopenedStore = createRecruitmentCheckpointStore(checkpointPath);
    const resumedConversation = createRecruitmentConversation({
      repository,
      planner,
      knowledgeBase,
      checkpointer: reopenedStore.checkpointer,
      experimentalRetrievalMode: "on_demand",
      experimentalReviewerMode: "bypassed",
      experimentalExpansionSufficiencyMode: "bypassed",
    });
    const completed = await resumedConversation.turn({
      threadId: "sqlite-paused-case",
      message: "",
      expectsExistingState: true,
      positionAnswer: { questionId: paused.question!.input!.questionId, positions: ["LB"] },
    });

    assert.equal(completed.status, "completed", completed.message);
    assert.equal(completed.report?.requestedPositions[0], "LB");
    assert.equal(methodologyReads, 2, "selecting a new position starts a fresh methodology scope after restart");
    assert.deepEqual(candidateSearchPositions, [null, "LB"], "resume should perform one search for the newly confirmed scope");
    assert.ok(resumedConversation.inspectCaseRun);
    const inspection = await resumedConversation.inspectCaseRun({ threadId: "sqlite-paused-case", limit: 100 });
    assert.ok(inspection.checkpoints.some(checkpoint => checkpoint.interrupted));
    assert.equal(inspection.checkpoints.at(-1)?.interrupted, false);
    assert.equal(inspection.checkpoints.at(-1)?.safeSummary.action, "finish");
  } finally {
    firstStore?.close();
    reopenedStore?.close();
    restoreEnvironment();
    await rm(directory, { recursive: true, force: true });
  }
});
