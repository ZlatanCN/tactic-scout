import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assignRagV2FactGroups,
  estimateRagV2PipelineGatewayCalls,
  type RagV2RankedEvidence,
  type RagV2EvidenceSpan,
  type RagV2QuestionPack,
} from "../../src/evaluation/rag-v2-evaluation.js";
import { RagV2EvaluationInterruptedError, ragV2EvaluationCaseId, runRagV2Evaluation, type RagV2ExecutionDependencies, type RagV2JudgeControlCase } from "../../src/evaluation/rag-v2-runner.js";

const passage = "A midfielder delays pressure before the pass.";
const sourceRevision = "a".repeat(64);
const sourceId = "scout-source";
const sourceSpan: RagV2EvidenceSpan = {
  documentRevisionId: sourceRevision,
  sectionId: "section-a",
  startOffset: 0,
  endOffset: passage.length,
  textHash: createHash("sha256").update(passage).digest("hex"),
  sourceId,
  articleId: "article-a",
};

function pack(): RagV2QuestionPack {
  const [question] = assignRagV2FactGroups([{
    id: "agent-q1",
    corpus: "methodology",
    query: "What does the passage say about a midfielder delaying pressure?",
    factGroupHint: "one-fact",
    expectedDisposition: "answerable",
    sourceArticleIds: ["article-a"],
    facts: [{ factId: "fact-a", statement: "A midfielder delays pressure before the pass.", supportPaths: [[sourceSpan]] }],
    scopeEvidence: [],
    abstentionBasis: [],
    subjects: [],
    sampleSeasons: [],
    provenance: {
      label: "synthetic_ai_checked",
      generatorModelId: "gateway/model",
      generatorPromptSha256: "a".repeat(64),
      verifierModelId: "gateway/model",
      verifierPromptSha256: "b".repeat(64),
      verifierResult: "passed",
      createdAt: "2026-10-22T00:00:00.000Z",
    },
    indexable: false,
  }]);
  return {
    schemaVersion: "rag-v2-question-pack-v5",
    packetId: "fixture-pack",
    createdAt: "2026-10-22T00:00:00.000Z",
    qrelsMappingVersion: "reference-evidence-span-v5",
    sourceSnapshotHash: "c".repeat(64),
    generationManifest: {
      modelId: "gateway/model",
      estimatedGatewayAttempts: 2,
      actualGatewayAttempts: 2,
      gatewayAttemptCap: 1_000,
      selectedSectionCount: 1,
      verifiedQuestionCount: 1,
      skippedSectionCount: 0,
      corpusWideAbsentDateCount: 0,
      seededQuestionCount: 0,
      programmaticCrossSourceQuestionCount: 0,
      programmaticQuestionCount: 0,
      pipelineCallBudget: estimateRagV2PipelineGatewayCalls({ selectedSectionCount: 1 }),
    },
    questions: [question!],
  };
}

function dependencies(input: { differentSse?: boolean } = {}): RagV2ExecutionDependencies & { calls: { app: string[]; fixedEvidence: RagV2RankedEvidence[][] } } {
  const calls = { app: [] as string[], fixedEvidence: [] as RagV2RankedEvidence[][] };
  const evidence = { id: "citation-a", ref: sourceSpan, text: passage, sourceId };
  return {
    calls,
    async retrieve() {
      return { status: "found", evidence: [{ ...evidence, rank: 1 }], gatewayAttempts: 0, durationMs: 4 };
    },
    async sourceTexts() {
      return new Map([[sourceRevision + "\nsection-a", passage]]);
    },
    async referenceEvidence() { return [evidence]; },
    async generateAnswer() {
      return { answer: passage, abstained: false, citedEvidenceIds: [evidence.id], gatewayAttempts: 1, inputTokens: 0, outputTokens: 0, durationMs: 1 };
    },
    async runApplication({ transport, fixedBaselineEvidence }) {
      calls.app.push(transport);
      if (fixedBaselineEvidence) calls.fixedEvidence.push(fixedBaselineEvidence);
      return {
        answer: transport === "sse" && input.differentSse ? "different response" : passage,
        abstained: false,
        citedEvidenceIds: [evidence.id],
        citedEvidence: [evidence],
        gatewayAttempts: transport === "json" ? 1 : 0,
        inputTokens: null,
        outputTokens: null,
        durationMs: 1,
        evidenceInvestigation: {
          initialQueryCount: 1,
          followupQueryCount: transport === "json" ? 1 : 0,
          finalOutcome: "found",
        },
        reportGeneration: {
          durationMs: 2,
          gatewayAttempts: 1,
          plannerFallback: null,
        },
        reportProjection: {
          durationMs: 1,
          citationCount: 1,
          recommendationCount: 0,
        },
        hardViolationCount: 0,
        status: "completed",
        phaseTrace: ["completed"],
        responseFingerprint: transport === "sse" && input.differentSse ? "different" : "same",
      };
    },
    async judge({ question }) {
      return { claimSupport: "supported", requiredFactsCovered: "yes", coveredFactIds: question.facts.map(({ factId }) => factId), refusalAppropriate: "yes", rationale: "Exact cited support." };
    },
  };
}

const control: RagV2JudgeControlCase = {
  controlId: "positive-control",
  expected: "positive",
  query: "What happened?",
  answer: passage,
  abstained: false,
  citedEvidence: [{ id: "citation-a", text: passage, ref: sourceSpan, sourceId, articleId: "article-a" }],
  requiredFacts: [passage],
  expectedDisposition: "answerable",
  sourceArticleIds: ["article-a"],
};

test("full application evaluation exercises JSON and SSE and marks the run as an automatic estimate", async () => {
  const deps = dependencies();
  const run = await runRagV2Evaluation({
    packet: pack(),
    workflow: "agent",
    split: "development",
    rankingMode: "hybrid",
    dependencies: {
      ...deps,
      async runControl() { return { controlId: control.controlId, expected: "positive", actual: "pass" }; },
    },
    judgeControls: [control],
  });
  assert.deepEqual(deps.calls.app, ["json", "sse"]);
  assert.equal(run.questions[0]?.agent?.sseParity, true);
  assert.equal(run.questions[0]?.decision.semanticDecision, "pass");
  assert.equal(run.completeValidationSet, false);
  assert.equal(run.label, "automatic_estimate");
  assert.deepEqual(run.questions[0]?.agent?.answer.evidenceInvestigation, {
    initialQueryCount: 1,
    followupQueryCount: 1,
    finalOutcome: "found",
  });
  assert.deepEqual(run.questions[0]?.agent?.answer.reportGeneration, {
    durationMs: 2,
    gatewayAttempts: 1,
    plannerFallback: null,
  });
  assert.deepEqual(run.questions[0]?.agent?.answer.reportProjection, {
    durationMs: 1,
    citationCount: 1,
    recommendationCount: 0,
  });
  assert.equal(run.actualGatewayAttempts, 5);
});

test("an interrupted application phase reports dispatched attempts for the next preflight", async () => {
  const deps = dependencies();
  const failed = Object.assign(new Error("HTTP 502"), { gatewayAttempts: 3 });
  await assert.rejects(runRagV2Evaluation({
    packet: pack(),
    workflow: "agent",
    split: "development",
    rankingMode: "hybrid",
    sseParityCount: 0,
    dependencies: { ...deps, async runApplication() { throw failed; } },
    judgeControls: [control],
  }), (error: unknown) => error instanceof RagV2EvaluationInterruptedError
    && error.failedQuestionId === "agent-q1"
    && error.completedQuestionCount === 0
    && error.actualGatewayAttempts === 3);
});

test("a judge transport failure reports a conservative cumulative attempt count", async () => {
  const deps = dependencies();
  await assert.rejects(runRagV2Evaluation({
    packet: pack(),
    workflow: "agent",
    split: "development",
    rankingMode: "hybrid",
    sseParityCount: 0,
    dependencies: { ...deps, async judge() { throw new Error("gateway EOF"); } },
    judgeControls: [control],
  }), (error: unknown) => error instanceof RagV2EvaluationInterruptedError
    && error.failedQuestionId === "agent-q1"
    && error.completedQuestionCount === 0
    && error.actualGatewayAttempts === 3);
});

test("application checkpoint IDs isolate repeated evaluation runs while staying stable inside a run", () => {
  const first = ragV2EvaluationCaseId("run-one", "question-a", "json");
  assert.equal(first, ragV2EvaluationCaseId("run-one", "question-a", "json"));
  assert.notEqual(first, ragV2EvaluationCaseId("run-two", "question-a", "json"));
  assert.notEqual(first, ragV2EvaluationCaseId("run-one", "question-a", "sse"));
});

test("fixed single-pass baseline answers from the same hybrid evidence retrieved for the question", async () => {
  const deps = dependencies();
  const run = await runRagV2Evaluation({
    packet: pack(),
    workflow: "full",
    split: "development",
    rankingMode: "hybrid",
    investigationStrategy: "fixed_single_pass",
    dependencies: {
      ...deps,
      async runControl() { return { controlId: control.controlId, expected: "positive", actual: "pass" }; },
    },
    judgeControls: [control],
  });
  assert.deepEqual(deps.calls.app, ["json"]);
  assert.deepEqual(deps.calls.fixedEvidence[0]?.map(({ id }) => id), run.questions[0]?.retrievedEvidence.map(({ id }) => id));
  assert.equal(run.questions[0]?.agent?.sseParity, null);
  assert.equal(run.questions[0]?.oracle, undefined);
  assert.equal(run.questions[0]?.decision.semanticDecision, "pass");
});

test("an unsupported number fails deterministically even when both semantic judges claim support", async () => {
  const deps = dependencies();
  const run = await runRagV2Evaluation({
    packet: pack(),
    workflow: "agent",
    split: "development",
    rankingMode: "hybrid",
    sseParityCount: 0,
    dependencies: {
      ...deps,
      async runApplication() {
        return {
          answer: "A midfielder delays pressure 987654321 times before the pass.",
          abstained: false,
          citedEvidenceIds: ["citation-a"],
          citedEvidence: [{ id: "citation-a", ref: sourceSpan, text: passage, sourceId, articleId: "article-a" }],
          gatewayAttempts: 1,
          inputTokens: null,
          outputTokens: null,
          durationMs: 1,
          hardViolationCount: 0,
          status: "completed",
          phaseTrace: ["completed"],
        };
      },
      async runControl() { return { controlId: control.controlId, expected: "positive", actual: "pass" }; },
    },
    judgeControls: [control],
  });

  assert.equal(run.questions[0]?.decision.semanticDecision, "fail");
});

test("token manifest counts only the application calls that reported both token fields", async () => {
  const deps = dependencies();
  const run = await runRagV2Evaluation({
    packet: pack(),
    workflow: "agent",
    split: "development",
    rankingMode: "hybrid",
    sseParityCount: 0,
    dependencies: {
      ...deps,
      async runApplication() {
        return {
          answer: passage,
          abstained: false,
          citedEvidenceIds: ["citation-a"],
          citedEvidence: [{ id: "citation-a", ref: sourceSpan, text: passage, sourceId, articleId: "article-a" }],
          gatewayAttempts: 3,
          fullyReportedGatewayAttempts: 1,
          inputTokens: 300,
          outputTokens: 30,
          durationMs: 1,
          hardViolationCount: 0,
          status: "completed",
          phaseTrace: ["completed"],
        };
      },
      async runControl() { return { controlId: control.controlId, expected: "positive", actual: "pass" }; },
    },
    judgeControls: [control],
  });

  assert.equal(run.actualGatewayAttempts, 7);
  assert.equal(run.tokenUsageManifest.fullyReportedCallCount, 1);
  assert.equal(run.tokenUsageManifest.callsWithoutCompleteTokenUsage, 6);
});

test("fixed baseline reuses a signed control evaluation without repeating its gateway calls", async () => {
  const deps = dependencies();
  const precomputed = [{ controlId: control.controlId, expected: control.expected, actual: "pass" as const }];
  const controlEvaluationSha256 = createHash("sha256").update(JSON.stringify(precomputed)).digest("hex");
  let controlCalls = 0;
  const run = await runRagV2Evaluation({
    packet: pack(),
    workflow: "full",
    split: "development",
    rankingMode: "hybrid",
    investigationStrategy: "fixed_single_pass",
    dependencies: {
      ...deps,
      async runControl() {
        controlCalls += 1;
        return { controlId: control.controlId, expected: control.expected, actual: "pass" };
      },
    },
    judgeControls: [control],
    precomputedJudgeControls: precomputed,
    controlEvaluationSha256,
    controlEvaluationSourceRunId: "source-run",
  });

  assert.equal(controlCalls, 0);
  assert.equal(run.actualGatewayAttempts, 3);
  assert.equal(run.preflight.controlCount, 0);
  assert.equal(run.judgeControls.length, 1);
  assert.equal(run.controlEvaluationGatewayAttempts, 0);
  assert.equal(run.controlEvaluationSourceRunId, "source-run");
  assert.equal(run.controlEvaluationSha256, controlEvaluationSha256);
});

test("reused unresolved judge controls remain unreliable and block quality qualification", async () => {
  const deps = dependencies();
  const precomputed = [{ controlId: control.controlId, expected: control.expected, actual: "unresolved" as const }];
  const controlEvaluationSha256 = createHash("sha256").update(JSON.stringify(precomputed)).digest("hex");
  const run = await runRagV2Evaluation({
    packet: pack(),
    workflow: "full",
    split: "development",
    rankingMode: "hybrid",
    investigationStrategy: "fixed_single_pass",
    dependencies: deps,
    judgeControls: [control],
    precomputedJudgeControls: precomputed,
    controlEvaluationSha256,
    controlEvaluationSourceRunId: "unreliable-control-source-run",
  });
  assert.equal(run.controlEvaluationGatewayAttempts, 0);
  assert.equal(run.qualitySummary.judgeControls.reliable, false);
  assert.equal(run.qualitySummary.qualityEligible, false);
});

test("JSON and SSE response mismatch is a deterministic hard violation", async () => {
  const deps = dependencies({ differentSse: true });
  const run = await runRagV2Evaluation({
    packet: pack(),
    workflow: "agent",
    split: "development",
    rankingMode: "hybrid",
    dependencies: {
      ...deps,
      async runControl() { return { controlId: control.controlId, expected: "positive", actual: "pass" }; },
    },
    judgeControls: [control],
  });
  assert.equal(run.questions[0]?.agent?.sseParity, false);
  assert.equal(run.questions[0]?.decision.hardViolationCount, 1);
  assert.equal(run.qualitySummary.qualityEligible, false);
});

test("an application answer without its own citations cannot borrow evidence from the separate reader run", async () => {
  const deps = dependencies();
  const run = await runRagV2Evaluation({
    packet: pack(),
    workflow: "agent",
    split: "development",
    rankingMode: "hybrid",
    sseParityCount: 0,
    judgeControls: [control],
    dependencies: {
      ...deps,
      async runApplication() {
        return {
          answer: "A midfielder delays pressure before the pass.",
          abstained: false,
          citedEvidenceIds: [],
          citedEvidence: [],
          gatewayAttempts: 1,
          inputTokens: null,
          outputTokens: null,
          durationMs: 1,
          hardViolationCount: 0,
          status: "completed",
          phaseTrace: ["completed"],
        };
      },
    },
  });
  assert.equal(run.questions[0]?.retrievedEvidence.length, 1);
  assert.equal(run.questions[0]?.decision.semanticDecision, "fail");
  assert.equal(run.questions[0]?.decision.hardViolationCount, 1);
});

test("oracle evaluation checks current gateway permissions before sending reference passages", async () => {
  const deps = dependencies();
  let answerCalls = 0;
  await assert.rejects(runRagV2Evaluation({
    packet: pack(),
    workflow: "oracle",
    split: "development",
    rankingMode: "hybrid",
    judgeControls: [control],
    dependencies: {
      ...deps,
      async assertGatewayEvidenceAllowed() { throw new Error("source forbids gateway processing"); },
      async generateAnswer() {
        answerCalls += 1;
        return { answer: passage, abstained: false, citedEvidenceIds: [], gatewayAttempts: 0, inputTokens: null, outputTokens: null, durationMs: 0 };
      },
    },
  }), /source forbids gateway processing/u);
  assert.equal(answerCalls, 0);
});

test("evaluation validates every control reference before the first retrieval or model call", async () => {
  const deps = dependencies();
  let retrievalCalls = 0;
  deps.retrieve = async () => {
    retrievalCalls += 1;
    return { status: "found", evidence: [], gatewayAttempts: 0, durationMs: 0 };
  };
  await assert.rejects(runRagV2Evaluation({
    packet: pack(),
    workflow: "oracle",
    split: "development",
    rankingMode: "hybrid",
    judgeControls: [control],
    dependencies: {
      ...deps,
      async validateJudgeControl() { throw new Error("control reference does not resolve to its source text"); },
    },
  }), /control reference does not resolve/u);
  assert.equal(retrievalCalls, 0);
});

test("gateway call preflight rejects before invoking retrieval or the application", async () => {
  const deps = dependencies();
  await assert.rejects(runRagV2Evaluation({
    packet: pack(),
    workflow: "full",
    split: "development",
    rankingMode: "hybrid",
    dependencies: {
      ...deps,
      async runControl() { return { controlId: control.controlId, expected: "positive", actual: "pass" }; },
    },
    judgeControls: [control],
    maximumGatewayCalls: 1,
  }), /预检需要/u);
  assert.deepEqual(deps.calls.app, []);
});

test("source revision and exact span hashes are checked for the whole selected split before retrieval calls", async () => {
  const unverifiedPack = pack();
  unverifiedPack.questions[0]!.facts[0]!.supportPaths[0]![0]!.textHash = "d".repeat(64);
  const deps = dependencies();
  let retrievalCalls = 0;
  deps.retrieve = async (question) => {
    retrievalCalls += 1;
    return dependencies().retrieve(question);
  };
  await assert.rejects(runRagV2Evaluation({
    packet: unverifiedPack,
    workflow: "retrieval",
    split: "development",
    rankingMode: "hybrid",
    dependencies: deps,
  }), /原文区间核验失败/u);
  assert.equal(retrievalCalls, 0);
});
