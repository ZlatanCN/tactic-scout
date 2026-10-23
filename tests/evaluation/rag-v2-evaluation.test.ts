import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assignRagV2FactGroups,
  combineRagV2Judgements,
  deterministicRagV2Verdict,
  createRagV2AcceptanceRecord,
  estimateRagV2PipelineGatewayCalls,
  estimateRagV2GatewayCalls,
  evaluateRagV2JudgeControls,
  evaluateRagV2RetrievalQuestion,
  RAG_V2_TARGETS,
  RagV2SemanticVerdictSchema,
  summarizeRagV2Quality,
  type RagV2EvidenceSpan,
  type RagV2QuestionDraft,
} from "../../src/evaluation/rag-v2-evaluation.js";

function span(sectionId: string, start: number, end: number, revision = "a", articleId = "doi:" + revision): RagV2EvidenceSpan {
  return {
    documentRevisionId: revision.repeat(64),
    sectionId,
    startOffset: start,
    endOffset: end,
    textHash: createHash("sha256").update("evidence").digest("hex"),
    sourceId: "source-" + revision,
    articleId,
  };
}

function draft(input: { id: string; hint: string; section?: string; range?: [number, number]; text?: string }): RagV2QuestionDraft {
  const source = input.text ?? "the role includes a late run into the box";
  const range = input.range ?? [0, 10];
  return {
    id: input.id,
    corpus: "methodology",
    query: "What movement is described in " + input.id + "?",
    factGroupHint: input.hint,
    expectedDisposition: "answerable",
    sourceArticleIds: ["doi:" + input.hint],
    facts: [{
      factId: input.id,
      statement: "A required supported fact.",
      supportPaths: [[{
        ...span("section-" + (input.section ?? input.hint), range[0], range[1], "a", "doi:" + input.hint),
        textHash: createHash("sha256").update(source.slice(range[0], range[1])).digest("hex"),
      }]],
    }],
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
  };
}

test("fact-group assignment keeps overlapping evidence together and uses a stable split", () => {
  const assigned = assignRagV2FactGroups([
    draft({ id: "q1", hint: "a", section: "same", range: [0, 10] }),
    draft({ id: "q2", hint: "different-hint", section: "same", range: [5, 12] }),
    draft({ id: "q3", hint: "c", range: [20, 30] }),
  ]);
  assert.equal(assigned[0]?.factGroupId, assigned[1]?.factGroupId);
  assert.equal(assigned[0]?.split, assigned[1]?.split);
  assert.notEqual(assigned[0]?.factGroupId, assigned[2]?.factGroupId);
  assert.deepEqual(assigned.map(({ split }) => split), assignRagV2FactGroups([
    draft({ id: "q1", hint: "a", section: "same", range: [0, 10] }),
    draft({ id: "q2", hint: "different-hint", section: "same", range: [5, 12] }),
    draft({ id: "q3", hint: "c", range: [20, 30] }),
  ]).map(({ split }) => split));
});

test("similar generic questions from independent source sections remain separate fact groups", () => {
  const first = { ...draft({ id: "independent-a", hint: "article-a", section: "section-a" }), query: "What movement does the paper describe?" };
  const second = { ...draft({ id: "independent-b", hint: "article-b", section: "section-b" }), query: "What movement does the paper describe in this section?" };
  const [left, right] = assignRagV2FactGroups([first, second]);
  assert.notEqual(left?.factGroupId, right?.factGroupId);
});

test("exact duplicate questions stay in one group even when their source intervals are separate", () => {
  const first = { ...draft({ id: "exact-a", hint: "article-a", section: "section-a" }), query: "What movement does the paper describe?" };
  const second = { ...draft({ id: "exact-b", hint: "article-b", section: "section-b" }), query: "What movement does the paper describe?" };
  const [left, right] = assignRagV2FactGroups([first, second]);
  assert.equal(left?.factGroupId, right?.factGroupId);
});

test("fact coverage treats support paths as OR, spans within a path as AND, and ignores whitespace", () => {
  const first = span("section-one", 0, 2);
  const second = span("section-one", 3, 5);
  const alternative = span("section-one", 6, 8);
  const question = {
    id: "q-facts",
    corpus: "methodology" as const,
    query: "What two passages support these facts?",
    factGroupId: "g",
    split: "development" as const,
    expectedDisposition: "answerable" as const,
    sourceArticleIds: ["article"],
    facts: [
      { factId: "f1", statement: "Either small passage is sufficient.", supportPaths: [[first], [alternative]] },
      { factId: "f2", statement: "Both separated spans are necessary.", supportPaths: [[first, second]] },
    ],
    scopeEvidence: [],
    abstentionBasis: [],
    subjects: [],
    sampleSeasons: [],
    provenance: { label: "synthetic_ai_checked" as const, generatorModelId: "m", generatorPromptSha256: "a".repeat(64), verifierModelId: "m", verifierPromptSha256: "b".repeat(64), verifierResult: "passed" as const, createdAt: "2026-10-22T00:00:00.000Z" },
    indexable: false as const,
  };
  const metrics = evaluateRagV2RetrievalQuestion({
    question,
    rankedEvidence: [
      { id: "r1", ref: { ...first, endOffset: 4 }, rank: 1, text: "a b ", sourceId: "source-a" },
      { id: "r2", ref: { ...second, startOffset: 4, endOffset: 5 }, rank: 2, text: "c", sourceId: "source-a" },
      { id: "r3", ref: alternative, rank: 3, text: "de", sourceId: "source-a" },
    ],
    sourceTexts: new Map([[question.facts[0]!.supportPaths[0]![0]!.documentRevisionId + "\nsection-one", "a b c defg"]]),
  });
  assert.equal(metrics.factCoverageAtK["1"], 0.5);
  assert.equal(metrics.factCoverageAtK["3"], 1);
  assert.equal(metrics.recallAtK["3"], 1);
  assert.equal(metrics.reciprocalRank, 1);
});

test("no-positive-evidence questions keep their denominator but return N/A retrieval metrics", () => {
  const question = {
    ...draft({ id: "negative", hint: "negative" }),
    expectedDisposition: "abstain" as const,
    corpusWideAbsentDate: "2099-12-31",
    facts: [],
    scopeEvidence: [span("section-negative", 0, 8, "a", "doi:negative")],
    abstentionBasis: ["The passage does not specify the exact match date."],
  };
  const metrics = evaluateRagV2RetrievalQuestion({ question, rankedEvidence: [], sourceTexts: new Map() });
  assert.equal(metrics.factCoverageAtK["6"], null);
  assert.equal(metrics.recallAtK["6"], null);
  assert.equal(metrics.hitAtK["6"], null);
  assert.equal(metrics.reciprocalRank, null);
});

test("same-model role disagreement stays unresolved and blocks the semantic gate", () => {
  const yes = RagV2SemanticVerdictSchema.parse({ claimSupport: "supported", requiredFactsCovered: "yes", coveredFactIds: ["fact-1"], refusalAppropriate: "yes", rationale: "Evidence matches." });
  const no = RagV2SemanticVerdictSchema.parse({ claimSupport: "unsupported", requiredFactsCovered: "no", coveredFactIds: [], refusalAppropriate: "yes", rationale: "The cited text does not support it." });
  const disagreement = combineRagV2Judgements({ expectedDisposition: "answerable", roleA: yes, roleB: no });
  assert.equal(disagreement.decision, "unresolved");
  const quality = summarizeRagV2Quality({
    questions: [{ questionId: "q", split: "validation", disposition: "answerable", semanticDecision: disagreement.decision, deterministicFactCoverage: 1, answerSupportRate: null, answerFactCoverage: 0, refusalHandling: null, hardViolationCount: 0 }],
    controls: [],
  });
  assert.equal(quality.unresolvedCount, 1);
  assert.equal(quality.qualityEligible, false);
});

test("deterministic checks reject unsupported numbers and dates even when both judges are uncertain", () => {
  const unsupportedNumber = deterministicRagV2Verdict({
    expectedDisposition: "answerable",
    answer: "The study used 987654321 folds.",
    abstained: false,
    citedEvidence: [{ text: "The study used five folds." }],
  });
  assert.equal(unsupportedNumber.violation, true);
  assert.match(unsupportedNumber.reason ?? "", /987654321/u);

  const unsupportedDate = deterministicRagV2Verdict({
    expectedDisposition: "answerable",
    answer: "The study ran in 2099-12-31.",
    abstained: false,
    citedEvidence: [{ text: "The study used five folds." }],
  });
  assert.equal(unsupportedDate.violation, true);
  assert.match(unsupportedDate.reason ?? "", /2099-12-31/u);

  const supported = deterministicRagV2Verdict({
    expectedDisposition: "answerable",
    answer: "The study used 5 folds.",
    abstained: false,
    citedEvidence: [{ text: "The study used 5 folds." }],
  });
  assert.equal(supported.violation, false);
});

test("a cited passage that fully contains the required fact cannot be passed as an empty refusal", () => {
  const verdict = deterministicRagV2Verdict({
    expectedDisposition: "answerable",
    answer: "The source does not answer this.",
    abstained: true,
    citedEvidence: [{ text: "The study used five folds." }],
    requiredFacts: ["The study used five folds."],
  });
  assert.equal(verdict.disposition, "answer");
  assert.equal(verdict.violation, false);
});

test("automatic judge controls require enough positive and negative controls with no false passes", () => {
  const controls = [
    ...Array.from({ length: RAG_V2_TARGETS.minimumPositiveJudgeControls }, (_, index) => ({ controlId: "p" + index, expected: "positive" as const, actual: "pass" as const })),
    ...Array.from({ length: RAG_V2_TARGETS.minimumNegativeJudgeControls }, (_, index) => ({ controlId: "n" + index, expected: "negative" as const, actual: "fail" as const })),
  ];
  assert.equal(evaluateRagV2JudgeControls(controls).reliable, true);
  assert.equal(evaluateRagV2JudgeControls([...controls, { controlId: "false-pass", expected: "negative", actual: "pass" }]).reliable, false);
});

test("call preflight refuses full workflows above 1300 calls without shrinking the question set", () => {
  const estimate = estimateRagV2GatewayCalls({ questionCount: 180, workflow: "full" });
  assert.equal(RAG_V2_TARGETS.maximumFullGatewayCalls, 1_300);
  assert.equal(estimate.expectedGatewayAttempts > 1_300, true);
  assert.equal(estimate.withinCap, false);
  const authorizedFullCap = estimateRagV2GatewayCalls({
    questionCount: 1,
    workflow: "retrieval",
    requestedCallCap: 1_300,
  });
  assert.equal(authorizedFullCap.maximumGatewayAttempts, 1_300);
  assert.equal(authorizedFullCap.withinCap, true);
});

test("pipeline preflight budgets generation, ranking comparison, baseline, and adaptive validation together", () => {
  const estimate = estimateRagV2PipelineGatewayCalls({ selectedSectionCount: 50 });
  assert.equal(estimate.generationGatewayAttempts, 100);
  assert.equal(estimate.developmentQuestionEstimate, 60);
  assert.equal(estimate.validationQuestionEstimate, 40);
  assert.equal(estimate.fixedBaselineGatewayAttempts, 120);
  assert.equal(estimate.adaptiveCandidateGatewayAttempts, 292);
  assert.equal(estimate.oracleDiagnosticGatewayAttempts, 12);
  assert.equal(estimate.rankingComparisonGatewayAttempts, 12);
  assert.equal(estimate.totalEstimatedGatewayAttempts, 536);
  assert.equal(estimate.withinCap, true);
  const localOnlyComparison = estimateRagV2PipelineGatewayCalls({ selectedSectionCount: 50, includeGatewayRankingComparison: false });
  assert.equal(localOnlyComparison.rankingComparisonGatewayAttempts, 0);
  assert.equal(localOnlyComparison.totalEstimatedGatewayAttempts, 524);
  const afterPreviousAttempts = estimateRagV2PipelineGatewayCalls({
    selectedSectionCount: 50,
    includeGatewayRankingComparison: false,
    priorGatewayAttempts: 196,
  });
  assert.equal(afterPreviousAttempts.totalEstimatedGatewayAttempts, 720);
  assert.equal(afterPreviousAttempts.withinCap, true);
  const exactRemainingPlan = estimateRagV2PipelineGatewayCalls({
    selectedSectionCount: 41,
    priorGatewayAttempts: 296,
  });
  assert.equal(exactRemainingPlan.totalEstimatedGatewayAttempts, 742);
  assert.equal(exactRemainingPlan.withinCap, true);
  assert.equal(estimateRagV2PipelineGatewayCalls({ selectedSectionCount: 50, maximumGatewayAttempts: 530 }).withinCap, false);
});

test("acceptance records require complete matching-packet runs and a non-regressing candidate", () => {
  const hash = "a".repeat(64);
  const pins = {
    packetSha256: hash, sourceRegistrySha256: hash, evidenceSnapshotSha256: hash, indexGenerationId: "generation-1",
    embeddingModelId: "e5", rankingMode: "hybrid" as const, investigationStrategy: "adaptive_agent" as const, answerModelId: "gateway/model", controlPackSha256: hash, controlEvaluationSha256: hash,
    rankerModelId: "none", rankerRevision: null, rankerConfigSha256: hash,
    questionPromptSha256: hash, verifierPromptSha256: hash, answerPromptSha256: hash, judgePromptSha256: hash, appRevision: "0fd0958",
  };
  const controls = [
    ...Array.from({ length: 12 }, (_, index) => ({ controlId: "p" + index, expected: "positive" as const, actual: "pass" as const })),
    ...Array.from({ length: 12 }, (_, index) => ({ controlId: "n" + index, expected: "negative" as const, actual: "fail" as const })),
  ];
  const questionResults = [
    { questionId: "q", split: "validation" as const, disposition: "answerable" as const, semanticDecision: "pass" as const, deterministicFactCoverage: 0.25, answerSupportRate: 1, answerFactCoverage: 1, refusalHandling: null, hardViolationCount: 0 },
    { questionId: "abstain", split: "validation" as const, disposition: "abstain" as const, semanticDecision: "pass" as const, deterministicFactCoverage: null, answerSupportRate: null, answerFactCoverage: null, refusalHandling: 1, hardViolationCount: 0 },
  ];
  const summary = summarizeRagV2Quality({
    questions: questionResults,
    controls,
  });
  assert.equal(summary.requiredFactMacroCoverage, 1);
  assert.equal(summary.retrievalFactCoverageAt6Macro, 0.25);
  const complete = { runId: "run", artifactSha256: hash, packetSha256: hash, complete: true, timedOut: false, cancelled: false, gatewayAttempts: 80, questionResults, controls };
  const record = createRagV2AcceptanceRecord({
    pins, baselinePins: { ...pins, investigationStrategy: "fixed_single_pass" }, candidate: complete, baseline: { ...complete, runId: "baseline" },
    candidateSummary: summary, baselineSummary: summary,
    callEstimate: { questionCount: 1, controlCount: 24, workflow: "oracle", expectedGatewayAttempts: 80, maximumGatewayAttempts: 100, withinCap: true },
  });
  assert.equal(record.status, "accepted");
  const blocked = createRagV2AcceptanceRecord({
    pins, baselinePins: { ...pins, investigationStrategy: "fixed_single_pass" }, candidate: { ...complete, complete: false }, baseline: { ...complete, runId: "baseline" },
    candidateSummary: summary, baselineSummary: summary,
    callEstimate: { questionCount: 1, controlCount: 24, workflow: "oracle", expectedGatewayAttempts: 80, maximumGatewayAttempts: 100, withinCap: true },
  });
  assert.equal(blocked.status, "not_accepted");
  assert.ok(blocked.blockedReasons.includes("candidate_run_incomplete"));
});

test("acceptance requires the fixed hybrid baseline and rejects retrieval coverage regressions", () => {
  const hash = "f".repeat(64);
  const hybridPins = {
    packetSha256: hash, sourceRegistrySha256: hash, evidenceSnapshotSha256: hash, indexGenerationId: "generation-1",
    embeddingModelId: "e5", rankingMode: "hybrid" as const, investigationStrategy: "fixed_single_pass" as const, answerModelId: "gateway/model", controlPackSha256: hash, controlEvaluationSha256: hash,
    rankerModelId: "none", rankerRevision: null, rankerConfigSha256: hash,
    questionPromptSha256: hash, verifierPromptSha256: hash, answerPromptSha256: hash, judgePromptSha256: hash, appRevision: "revision-a",
  };
  const candidatePins = { ...hybridPins, rankingMode: "local_cross_encoder" as const, investigationStrategy: "adaptive_agent" as const, rankerModelId: "bge-reranker" };
  const controls = [
    ...Array.from({ length: 12 }, (_, index) => ({ controlId: "p" + index, expected: "positive" as const, actual: "pass" as const })),
    ...Array.from({ length: 12 }, (_, index) => ({ controlId: "n" + index, expected: "negative" as const, actual: "fail" as const })),
  ];
  const baselineResults = [
    { questionId: "q", split: "validation" as const, disposition: "answerable" as const, semanticDecision: "pass" as const, deterministicFactCoverage: 1, answerSupportRate: 1, answerFactCoverage: 1, refusalHandling: null, hardViolationCount: 0 },
  ];
  const candidateResults = [{ ...baselineResults[0]!, deterministicFactCoverage: 0.5 }];
  const baselineSummary = summarizeRagV2Quality({ questions: baselineResults, controls });
  const candidateSummary = summarizeRagV2Quality({ questions: candidateResults, controls });
  const complete = (questionResults: typeof baselineResults, runId: string) => ({
    runId, artifactSha256: hash, packetSha256: hash, complete: true, timedOut: false, cancelled: false,
    gatewayAttempts: 80, questionResults, controls,
  });
  const record = createRagV2AcceptanceRecord({
    pins: candidatePins,
    baselinePins: hybridPins,
    candidate: complete(candidateResults, "candidate"),
    baseline: complete(baselineResults, "baseline"),
    candidateSummary,
    baselineSummary,
    callEstimate: { questionCount: 1, controlCount: 24, workflow: "full", expectedGatewayAttempts: 80, maximumGatewayAttempts: 100, withinCap: true },
  });
  assert.equal(record.status, "not_accepted");
  assert.deepEqual(record.comparison.retrievalCoverageRegressions, ["q"]);

  const nonHybridBaseline = createRagV2AcceptanceRecord({
    pins: hybridPins,
    baselinePins: { ...hybridPins, rankingMode: "gateway_reranked" },
    candidate: complete(baselineResults, "candidate"),
    baseline: complete(baselineResults, "baseline"),
    candidateSummary: baselineSummary,
    baselineSummary,
    callEstimate: { questionCount: 1, controlCount: 24, workflow: "full", expectedGatewayAttempts: 80, maximumGatewayAttempts: 100, withinCap: true },
  });
  assert.ok(nonHybridBaseline.blockedReasons.includes("baseline_is_not_fixed_hybrid"));
});
