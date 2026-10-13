import { lstat, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatasetModeSchema } from "../domain/schemas.js";

export interface IdentityFreeHarnessSummary {
  schemaVersion: 1;
  generatedAt: string;
  datasetVersion: number | null;
  model: string | null;
  dataMode: string | null;
  runCount: number;
  allPassed: boolean;
  checks: { passed: number; total: number; failed: number };
  elapsedMs: { p50: number; p95: number };
  planner: {
    requestAttempts: number;
    modelRequests: number;
    inputTokens: TokenMetricSummary;
    outputTokens: TokenMetricSummary;
    totalTokens: TokenMetricSummary;
  };
  tools: { calls: number; matchedRecordsAcrossToolCalls: number; returnedResultsAcrossToolCalls: number; progressEvents: number };
  reports: {
    completed: number;
    evaluatedCandidateCountAcrossRuns: number;
    availableMetricValuesAcrossRuns: number;
    expectedMetricValuesAcrossRuns: number;
    lowSampleCandidateCountAcrossRuns: number;
    recommendationCountAcrossRuns: number;
    methodologyChunkCountAcrossRuns: number;
  };
}

interface TokenMetricSummary {
  status: "complete" | "partial" | "unavailable";
  total: number | null;
  requestsWithUsage: number;
  requestCount: number;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function numberOrZero(value: unknown): number {
  return number(value) ?? 0;
}

function nearestRank(values: number[], percentile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]!;
}

function aggregateTokenMetric(runs: JsonRecord[], name: "inputTokens" | "outputTokens" | "totalTokens"): TokenMetricSummary {
  const metricRecords = runs.flatMap((run) => {
    const usage = record(run.modelUsage);
    const metric = record(usage?.[name]);
    return [{ metric, modelUsage: usage }];
  });
  const requestCount = metricRecords.reduce((sum, value) => sum + numberOrZero(value.modelUsage?.requestCount), 0);
  const requestsWithUsage = metricRecords.reduce((sum, value) => sum + numberOrZero(value.metric?.requestsWithUsage), 0);
  const status = requestCount === 0 || requestsWithUsage === 0
    ? "unavailable"
    : requestsWithUsage === requestCount ? "complete" : "partial";
  const totals = metricRecords.map(({ metric }) => number(metric?.total));
  return {
    status,
    total: status === "complete" && totals.every((total): total is number => total !== null)
      ? totals.reduce((sum, total) => sum + total, 0)
      : null,
    requestsWithUsage,
    requestCount,
  };
}

function countChecks(run: JsonRecord): { passed: number; total: number } {
  const checks = record(run.checks);
  if (!checks || Object.keys(checks).length === 0 || Object.values(checks).some((value) => typeof value !== "boolean")) {
    throw new Error("普通 Harness 运行缺少有效检查结果，无法生成安全摘要。");
  }
  const values = Object.values(checks);
  return { passed: values.filter(Boolean).length, total: values.length };
}

function extractOrdinaryRuns(input: unknown): { root: JsonRecord; runs: JsonRecord[] } {
  const root = record(input);
  const scenarios = root?.scenarios;
  if (!root || (root.experiment !== undefined && root.experiment !== null) || !Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error("去标识化摘要目前只支持普通 Harness 运行。");
  }

  const runs: JsonRecord[] = [];
  for (const scenarioValue of scenarios) {
    const scenario = record(scenarioValue);
    if (!scenario || !Array.isArray(scenario.runs) || !scenario.runs.length || "arms" in scenario || "pairedRuns" in scenario) {
      throw new Error("去标识化摘要目前只支持普通 Harness 运行。");
    }
    for (const runValue of scenario.runs) {
      const run = record(runValue);
      if (!run) throw new Error("普通 Harness 运行结构无效，无法生成安全摘要。");
      runs.push(run);
    }
  }
  if (!runs.length) throw new Error("普通 Harness 运行没有结果，无法生成安全摘要。");
  return { root, runs };
}

export function createIdentityFreeHarnessSummary(
  input: unknown,
  generatedAt = new Date().toISOString(),
): IdentityFreeHarnessSummary {
  const { root, runs } = extractOrdinaryRuns(input);
  const elapsedTimes = runs.map((run) => number(run.elapsedMs));
  const checkCounts = runs.map(countChecks);
  if (elapsedTimes.some((elapsed): elapsed is null => elapsed === null)) {
    throw new Error("普通 Harness 运行缺少有效耗时，无法生成安全摘要。");
  }

  const passedChecks = checkCounts.reduce((sum, result) => sum + result.passed, 0);
  const totalChecks = checkCounts.reduce((sum, result) => sum + result.total, 0);
  const records = runs.flatMap((run) => Array.isArray(run.trace) ? run.trace : [])
    .map(record)
    .filter((event): event is JsonRecord => event?.phase === "tool");
  const reports = runs.map((run) => record(run.report));
  const repository = record(root.repository);
  const model = typeof root.model === "string" ? root.model : null;
  const dataMode = DatasetModeSchema.safeParse(repository?.mode);

  return {
    schemaVersion: 1,
    generatedAt,
    datasetVersion: number(root.datasetVersion),
    model,
    dataMode: dataMode.success ? dataMode.data : null,
    runCount: runs.length,
    allPassed: checkCounts.every(({ passed, total }) => passed === total),
    checks: { passed: passedChecks, total: totalChecks, failed: totalChecks - passedChecks },
    elapsedMs: { p50: nearestRank(elapsedTimes as number[], 0.5), p95: nearestRank(elapsedTimes as number[], 0.95) },
    planner: {
      requestAttempts: runs.reduce((sum, run) => sum + numberOrZero(run.plannerRequestAttempts), 0),
      modelRequests: runs.reduce((sum, run) => sum + numberOrZero(record(run.modelUsage)?.requestCount), 0),
      inputTokens: aggregateTokenMetric(runs, "inputTokens"),
      outputTokens: aggregateTokenMetric(runs, "outputTokens"),
      totalTokens: aggregateTokenMetric(runs, "totalTokens"),
    },
    tools: {
      calls: runs.reduce((sum, run) => sum + numberOrZero(run.toolCallCount), 0),
      matchedRecordsAcrossToolCalls: records.reduce((sum, event) => sum + numberOrZero(event.matchingRecordCount), 0),
      returnedResultsAcrossToolCalls: records.reduce((sum, event) => sum + numberOrZero(event.resultCount), 0),
      progressEvents: runs.reduce((sum, run) => sum + numberOrZero(run.progressEventCount), 0),
    },
    reports: {
      completed: reports.filter((report) => report !== null).length,
      evaluatedCandidateCountAcrossRuns: reports.reduce((sum, report) => sum + numberOrZero(report?.evaluatedCandidateCount), 0),
      availableMetricValuesAcrossRuns: reports.reduce((sum, report) => sum + numberOrZero(record(report?.evidenceCoverage)?.availableMetricValues), 0),
      expectedMetricValuesAcrossRuns: reports.reduce((sum, report) => sum + numberOrZero(record(report?.evidenceCoverage)?.expectedMetricValues), 0),
      lowSampleCandidateCountAcrossRuns: reports.reduce((sum, report) => sum + numberOrZero(record(report?.evidenceCoverage)?.lowSampleCandidates), 0),
      recommendationCountAcrossRuns: reports.reduce((sum, report) => sum + (Array.isArray(report?.recommendations) ? report.recommendations.length : 0), 0),
      methodologyChunkCountAcrossRuns: reports.reduce((sum, report) => sum + numberOrZero(report?.methodologyChunksRetrieved), 0),
    },
  };
}

export async function assertIdentityFreeSummaryPathAvailable(outputPath: string): Promise<void> {
  let targetExists = false;
  try {
    await lstat(outputPath);
    targetExists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("无法访问摘要输出路径。");
    }
  }
  if (targetExists) throw new Error("输出文件已存在，拒绝覆盖。请选择一个新路径。");

  try {
    if (!(await stat(path.dirname(outputPath))).isDirectory()) throw new Error("摘要输出目录无效。");
  } catch {
    throw new Error("摘要输出目录不存在或不可访问。");
  }
}

export async function writeIdentityFreeHarnessSummary(
  outputPath: string,
  summary: IdentityFreeHarnessSummary,
): Promise<void> {
  try {
    await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("输出文件已存在，拒绝覆盖。请选择一个新路径。");
    }
    throw new Error("无法创建摘要文件；请确认目标目录可写。", { cause: error });
  }
}
