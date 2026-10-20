import assert from "node:assert/strict";
import test from "node:test";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import { groupCandidatesByExactIdentity } from "../../src/players/identity/candidate-groups.js";
import { createLocalKnowledgeBase } from "../../src/knowledge/index.js";
import { createRecruitmentEvidenceEvaluator } from "../../src/recruitment/recruitment-evidence-evaluator.js";
import { installRecruitmentConversationTestEnvironment, roleConstraintPlayer } from "./fixtures/recruitment-conversation.js";

const restoreEnvironment = installRecruitmentConversationTestEnvironment();

test("the same compiled recruitment graph can run with different injected repositories", async () => {
  try {
    const first = roleConstraintPlayer("runtime-context-a", "Runtime Context A", "ATT");
    const second = roleConstraintPlayer("runtime-context-b", "Runtime Context B", "ATT");
    const planner = {
      async decide() {
        return {
          action: "finish" as const,
          targetTeam: "Runtime Context",
          needSummary: "Read the injected candidate pool.",
          capabilityProfile: [],
          recommendations: [],
          limitationKeys: ["other" as const],
        };
      },
    };
    const conversation = createRecruitmentConversation({ planner });
    const runtimeFor = (repository: {
      mode: "demo";
      sourceName: string;
      loadPlayers(): Promise<ReturnType<typeof roleConstraintPlayer>[]>;
    }) => ({
      repository,
      planner,
      candidateIdentityGrouper: (records: Parameters<typeof groupCandidatesByExactIdentity>[0]) => groupCandidatesByExactIdentity(records),
      knowledgeBase: createLocalKnowledgeBase(),
      evidenceEvaluator: createRecruitmentEvidenceEvaluator(repository),
    });

    const a = await conversation.turn({
      threadId: "runtime-context-injected-graph",
      message: "Find a forward",
      runtimeContext: runtimeFor({
          mode: "demo",
          sourceName: "Context A",
          async loadPlayers() { return [first]; },
      }),
    });
    assert.equal(a.status, "completed");

    const b = await conversation.turn({
      threadId: "runtime-context-injected-graph",
      message: "Find a forward in the second context",
      runtimeContext: runtimeFor({
          mode: "demo",
          sourceName: "Context B",
          async loadPlayers() { return [second]; },
      }),
    });
    assert.equal(b.status, "completed");
  } finally {
    restoreEnvironment();
  }
});

test("missing runtime services fail before checkpoint, repository, or Planner access", async () => {
  let repositoryReads = 0;
  let plannerCalls = 0;
  const planner = {
    async decide() {
      plannerCalls += 1;
      throw new Error("the fallback Planner must not run");
    },
  };
  const conversation = createRecruitmentConversation({ planner });

  await assert.rejects(
    conversation.turn({
      threadId: "runtime-context-missing",
      message: "Find a forward",
      runtimeContext: {
        repository: {
          mode: "demo",
          sourceName: "Missing context fixture",
          async loadPlayers() { repositoryReads += 1; return []; },
        },
      },
    }),
    /runtime context|repository|planner/i,
  );
  assert.equal(repositoryReads, 0, "missing Planner context must fail before repository access");
  assert.equal(plannerCalls, 0, "the construction fallback Planner must not run without run context");
});
