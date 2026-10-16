import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertIdentityFreeSummaryPathAvailable,
  createIdentityFreeHarnessSummary,
  writeIdentityFreeHarnessSummary,
} from "../../src/evaluation/harness-summary-export.js";

const generatedAt = "2026-10-12T00:00:00.000Z";

function harnessOutput() {
  const completeMetric = (total: number) => ({
    status: "complete",
    total,
    requestsWithUsage: 1,
    requestCount: 1,
  });
  return {
    datasetVersion: 3,
    model: "qwen3.5:9b",
    endpoint: "http://secret-endpoint.invalid/v1",
    apiKeyConfigured: true,
    repository: { mode: "understat", sourceName: "private-provider-name" },
    scenarios: [{
      id: "scenario-containing-player-name",
      runs: [{
        allPassed: true,
        checks: { firstCheck: true, secondCheck: true },
        elapsedMs: 321,
        plannerRequestAttempts: 2,
        modelUsage: {
          requestCount: 1,
          responseCount: 1,
          failedRequestCount: 0,
          inputTokens: completeMetric(100),
          outputTokens: completeMetric(25),
          totalTokens: completeMetric(125),
        },
        toolCallCount: 3,
        progressEventCount: 5,
        trace: [
          { phase: "tool", toolName: "search_candidates", matchingRecordCount: 650, resultCount: 20, playerId: "candidate-id-secret" },
          { phase: "model", prompt: "private prompt text" },
        ],
        progress: [{ message: "private progress text", playerName: "candidate-name-secret" }],
        report: {
          evaluatedCandidateCount: 10,
          evidenceCoverage: {
            evaluatedCandidateCount: 10,
            evaluatedSourceRecordCount: 10,
            availableMetricValues: 220,
            expectedMetricValues: 340,
            lowSampleCandidates: 10,
            limitedPeerGroupCandidates: 0,
            names: ["must not escape"],
          },
          recommendations: [{ playerId: "candidate-id-secret", name: "candidate-name-secret" }],
          methodologyChunksRetrieved: 2,
          prose: "private report prose",
          sourcePlayerIds: ["source-id-secret"],
        },
      }],
    }],
  };
}

test("the identity-free projection keeps aggregate evidence and drops identity-bearing fields", () => {
  const summary = createIdentityFreeHarnessSummary(harnessOutput(), generatedAt);

  assert.deepEqual(summary, {
    schemaVersion: 1,
    generatedAt,
    datasetVersion: 3,
    model: "qwen3.5:9b",
    dataMode: "understat",
    runCount: 1,
    allPassed: true,
    checks: { passed: 2, total: 2, failed: 0 },
    elapsedMs: { p50: 321, p95: 321 },
    planner: {
      requestAttempts: 2,
      modelRequests: 1,
      inputTokens: { status: "complete", total: 100, requestsWithUsage: 1, requestCount: 1 },
      outputTokens: { status: "complete", total: 25, requestsWithUsage: 1, requestCount: 1 },
      totalTokens: { status: "complete", total: 125, requestsWithUsage: 1, requestCount: 1 },
    },
    tools: { calls: 3, matchedRecordsAcrossToolCalls: 650, returnedResultsAcrossToolCalls: 20, progressEvents: 5 },
    reports: {
      completed: 1,
      evaluatedCandidateCountAcrossRuns: 10,
      availableMetricValuesAcrossRuns: 220,
      expectedMetricValuesAcrossRuns: 340,
      lowSampleCandidateCountAcrossRuns: 10,
      recommendationCountAcrossRuns: 1,
      methodologyChunkCountAcrossRuns: 2,
    },
  });

  const serialized = JSON.stringify(summary);
  for (const privateValue of [
    "scenario-containing-player-name",
    "secret-endpoint",
    "private-provider-name",
    "candidate-id-secret",
    "candidate-name-secret",
    "source-id-secret",
    "private prompt text",
    "private progress text",
    "private report prose",
  ]) {
    assert.equal(serialized.includes(privateValue), false, `summary leaked ${privateValue}`);
  }
});

test("the summary writer creates a private file and refuses to overwrite", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-summary-"));
  const outputPath = path.join(directory, "summary.json");
  const summary = createIdentityFreeHarnessSummary(harnessOutput(), generatedAt);
  try {
    await writeIdentityFreeHarnessSummary(outputPath, summary);
    const before = await readFile(outputPath, "utf8");
    assert.deepEqual(JSON.parse(before), summary);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);

    await assert.rejects(writeIdentityFreeHarnessSummary(outputPath, summary), /拒绝覆盖/);
    assert.equal(await readFile(outputPath, "utf8"), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("summary preflight treats a dangling symbolic link as an existing destination", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-summary-link-"));
  const outputPath = path.join(directory, "summary.json");
  try {
    await symlink(path.join(directory, "missing-target"), outputPath);
    await assert.rejects(assertIdentityFreeSummaryPathAvailable(outputPath), /拒绝覆盖/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the identity-free projection rejects experiment-shaped output", () => {
  const input = harnessOutput() as unknown as Record<string, unknown>;
  input.experiment = "some-ablation";

  assert.throws(() => createIdentityFreeHarnessSummary(input, generatedAt), /普通 Harness 运行/);
});

test("the summary does not serialize unrecognized repository labels", () => {
  const input = harnessOutput();
  input.repository.mode = "candidate-id-secret";

  const summary = createIdentityFreeHarnessSummary(input, generatedAt);

  assert.equal(summary.dataMode, null);
  assert.doesNotMatch(JSON.stringify(summary), /candidate-id-secret/);
});
