import assert from "node:assert/strict";
import test from "node:test";
import { createRagV2PipelinePreflight, validateRagV2PipelinePreflight } from "../../src/evaluation/rag-v2-pipeline-preflight.js";

const questions = [
  { id: "cross", split: "development", corpus: "methodology", expectedDisposition: "answerable", sourceArticleIds: ["a", "b"] },
  { id: "player", split: "development", corpus: "player_report", expectedDisposition: "answerable", sourceArticleIds: ["p"] },
  { id: "partial", split: "development", corpus: "methodology", expectedDisposition: "partial", sourceArticleIds: ["c"] },
  { id: "abstain", split: "development", corpus: "methodology", expectedDisposition: "abstain", sourceArticleIds: ["d"] },
  { id: "dev-5", split: "development", corpus: "methodology", expectedDisposition: "answerable", sourceArticleIds: ["e"] },
  { id: "dev-6", split: "development", corpus: "methodology", expectedDisposition: "answerable", sourceArticleIds: ["f"] },
  { id: "dev-7", split: "development", corpus: "methodology", expectedDisposition: "answerable", sourceArticleIds: ["g"] },
  { id: "dev-8", split: "development", corpus: "methodology", expectedDisposition: "answerable", sourceArticleIds: ["h"] },
  { id: "val-1", split: "validation", corpus: "methodology", expectedDisposition: "answerable", sourceArticleIds: ["i"] },
  { id: "val-2", split: "validation", corpus: "methodology", expectedDisposition: "partial", sourceArticleIds: ["j"] },
  { id: "val-3", split: "validation", corpus: "player_report", expectedDisposition: "answerable", sourceArticleIds: ["k"] },
  { id: "val-4", split: "validation", corpus: "methodology", expectedDisposition: "abstain", sourceArticleIds: ["l"] },
  { id: "val-5", split: "validation", corpus: "methodology", expectedDisposition: "answerable", sourceArticleIds: ["m"] },
  { id: "val-6", split: "validation", corpus: "methodology", expectedDisposition: "answerable", sourceArticleIds: ["n"] },
];

test("full preflight pins phases and a representative Oracle sample under the shared call budget", () => {
  const plan = createRagV2PipelinePreflight({
    packetSha256: "a".repeat(64),
    sourceSnapshotHash: "b".repeat(64),
    controlPackSha256: "c".repeat(64),
    priorGatewayAttempts: 296,
    generationReservedAttempts: 82,
    generationActualAttempts: 80,
    questions,
    controlCount: 24,
    createdAt: new Date("2026-10-22T00:00:00.000Z"),
  });
  assert.deepEqual(plan.oracleQuestionIds, ["cross", "player", "partial", "abstain"]);
  assert.deepEqual(plan.phaseGatewayAttemptCaps, { comparison: 8, baseline: 18, candidate: 88, oracle: 12 });
  assert.equal(plan.totalReservedGatewayAttempts, 504);
  assert.equal(plan.withinCap, true);
  assert.equal(validateRagV2PipelinePreflight(plan).planSha256, plan.planSha256);
  assert.throws(() => validateRagV2PipelinePreflight({ ...plan, totalReservedGatewayAttempts: 507 }), /签名不匹配/u);
});

test("full preflight rejects plans that exceed the configured cap without dropping questions", () => {
  const plan = createRagV2PipelinePreflight({
    packetSha256: "a".repeat(64),
    sourceSnapshotHash: "b".repeat(64),
    controlPackSha256: "c".repeat(64),
    priorGatewayAttempts: 1_200,
    generationReservedAttempts: 82,
    generationActualAttempts: 82,
    questions,
    controlCount: 24,
  });
  assert.equal(plan.withinCap, false);
  assert.equal(plan.validationQuestionIds.length, 6);
});

test("resume preflight charges conservative prior usage and exact completed-comparison calls", () => {
  const plan = createRagV2PipelinePreflight({
    packetSha256: "a".repeat(64),
    sourceSnapshotHash: "b".repeat(64),
    controlPackSha256: "c".repeat(64),
    priorGatewayAttempts: 568,
    generationReservedAttempts: 6,
    generationActualAttempts: 6,
    questions,
    controlCount: 24,
    candidateApplicationAttemptsPerQuestion: 3,
    candidateSseParityCount: 0,
    oracleSampleSize: 3,
    comparisonAttemptCap: 7,
    maximumGatewayAttempts: 1_000,
  });
  assert.equal(plan.priorGatewayAttempts, 568);
  assert.equal(plan.rankingComparisonQuestionIds.length, 8);
  assert.equal(plan.phaseGatewayAttemptCaps.comparison, 7);
  assert.equal(plan.phaseGatewayAttemptCaps.candidate, 78);
  assert.equal(plan.phaseGatewayAttemptCaps.oracle, 9);
  assert.equal(plan.totalReservedGatewayAttempts, 686);
  assert.equal(plan.withinCap, true);
  assert.equal(plan.candidateApplicationAttemptsPerQuestion, 3);
  assert.equal(plan.candidateSseParityCount, 0);
});

test("the authorized 1300-call cap admits the unchanged complete frozen phases", () => {
  const plan = createRagV2PipelinePreflight({
    packetSha256: "a".repeat(64),
    sourceSnapshotHash: "b".repeat(64),
    controlPackSha256: "c".repeat(64),
    priorGatewayAttempts: 577,
    generationReservedAttempts: 6,
    generationActualAttempts: 6,
    questions,
    controlCount: 24,
    candidateApplicationAttemptsPerQuestion: 3,
    candidateSseParityCount: 0,
    oracleSampleSize: 1,
    comparisonAttemptCap: 7,
    maximumGatewayAttempts: 1_300,
  });
  assert.equal(plan.maximumGatewayAttempts, 1_300);
  assert.equal(plan.totalReservedGatewayAttempts, 689);
  assert.equal(plan.withinCap, true);
});
