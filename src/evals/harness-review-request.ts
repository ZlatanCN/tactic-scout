import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { BlindedReviewRequest } from "./blinded-review-packet.js";

const ReviewContextSchema = z.object({
  queryId: z.string().trim().min(1),
  roleBrief: z.string().trim().min(1),
  metricKeys: z.array(z.string().trim().min(1)).min(1),
  scenarioId: z.string().trim().min(1),
  runNumber: z.number().int().min(1),
}).strict();

const ToolEventSchema = z.object({
  phase: z.literal("tool"),
  toolName: z.string(),
  ok: z.boolean(),
  filters: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const EvaluationOutputSchema = z.object({
  datasetVersion: z.literal(2),
  model: z.string().trim().min(1),
  repository: z.object({
    mode: z.enum(["wyscout", "curated"]),
    source: z.string().trim().min(1),
  }).passthrough(),
  allPassed: z.literal(true),
  scenarios: z.array(z.object({
    id: z.string().trim().min(1),
    runs: z.array(z.object({
      threadId: z.string().trim().min(1),
      allPassed: z.literal(true),
      checks: z.record(z.string(), z.boolean()).refine((checks) => Object.keys(checks).length > 0),
      report: z.object({
        evaluatedCandidateCount: z.number().int().positive(),
        recommendations: z.array(z.object({ playerId: z.string().trim().min(1) })).min(1),
      }).passthrough(),
      trace: z.array(z.unknown()),
    }).passthrough()).min(1),
  }).passthrough()).min(1),
}).passthrough();

const SnapshotIdentitySchema = z.object({
  datasetId: z.string().trim().min(1),
  upstreamSource: z.object({ name: z.string().trim().min(1) }).passthrough(),
  records: z.array(z.object({ playerId: z.string().trim().min(1) }).passthrough()).min(1),
}).passthrough();

export interface CreateReviewRequestFromHarnessRunInput {
  evaluationJson: string;
  snapshotJson: string;
  context: unknown;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label}不是有效 JSON。`);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Build a review request from one passing local Harness run and its exact frozen Wyscout snapshot. */
export function createReviewRequestFromHarnessRun(
  input: CreateReviewRequestFromHarnessRunInput,
): BlindedReviewRequest {
  const contextResult = ReviewContextSchema.safeParse(input.context);
  if (!contextResult.success) {
    throw new Error(`盲评上下文格式无效：${contextResult.error.issues[0]?.message ?? "invalid context"}`);
  }
  const rawEvaluation = parseJson(input.evaluationJson, "Harness 结果");
  if (typeof rawEvaluation === "object" && rawEvaluation !== null
    && "datasetVersion" in rawEvaluation
    && rawEvaluation.datasetVersion !== 2) {
    throw new Error("Harness 结果版本过旧或不受支持；请重新运行当前 Harness。");
  }
  const outputResult = EvaluationOutputSchema.safeParse(rawEvaluation);
  if (!outputResult.success) {
    throw new Error(`Harness 结果不是当前可导出的完整运行：${outputResult.error.issues[0]?.message ?? "unsupported result"}`);
  }
  const snapshotResult = SnapshotIdentitySchema.safeParse(parseJson(input.snapshotJson, "冻结数据快照"));
  if (!snapshotResult.success) {
    throw new Error(`冻结数据快照格式无效：${snapshotResult.error.issues[0]?.message ?? "invalid snapshot"}`);
  }

  const context = contextResult.data;
  const output = outputResult.data;
  const scenario = output.scenarios.find(({ id }) => id === context.scenarioId);
  const run = scenario?.runs[context.runNumber - 1];
  if (!scenario || !run) throw new Error("指定的 Harness 场景或运行序号不存在。");
  if (Object.values(run.checks).some((passed) => !passed)) {
    throw new Error("Harness 运行包含未通过的检查，不能生成盲评请求。");
  }
  if (!run.checks.recommendationsWereEvaluated || !run.checks.evaluatedOnlyAfterCandidateDiscovery) {
    throw new Error("Harness 运行缺少候选评估与发现顺序校验，不能生成盲评请求。");
  }
  if (run.checks.recommendationsRespectRequestedPosition === false) {
    throw new Error("Harness 推荐位置与需求不一致，不能生成盲评请求。");
  }
  if (!output.repository.source.toLocaleLowerCase().includes("wyscout")) {
    throw new Error("Harness 数据源与 Wyscout 冻结快照不匹配。");
  }
  const snapshot = snapshotResult.data;
  if (!snapshot.datasetId.toLocaleLowerCase().includes("wyscout")
    || snapshot.upstreamSource.name.toLocaleLowerCase() !== "soccer match event dataset") {
    throw new Error("盲评请求只支持与 Wyscout Open Data 对应的冻结快照。");
  }

  const evaluatedPlayerIds = run.trace.flatMap((rawEvent) => {
    const eventResult = ToolEventSchema.safeParse(rawEvent);
    if (!eventResult.success || !eventResult.data.ok || eventResult.data.toolName !== "evaluate_candidates") return [];
    const playerIds = eventResult.data.filters?.evaluatedPlayerIds;
    return Array.isArray(playerIds) && playerIds.every((value) => typeof value === "string")
      ? playerIds
      : [];
  });
  const candidateIds = unique(evaluatedPlayerIds);
  if (candidateIds.length !== run.report.evaluatedCandidateCount) {
    throw new Error("Harness 报告中的评估人数与实际评估轨迹不一致。");
  }
  const candidateIdSet = new Set(candidateIds);
  const rankedCandidateIds = run.report.recommendations.map(({ playerId }) => playerId);
  if (new Set(rankedCandidateIds).size !== rankedCandidateIds.length
    || rankedCandidateIds.some((playerId) => !candidateIdSet.has(playerId))) {
    throw new Error("报告推荐引用了未评估或重复的候选，不能生成盲评请求。");
  }
  const snapshotPlayerIds = new Set(snapshot.records.map(({ playerId }) => playerId));
  if (candidateIds.some((playerId) => !snapshotPlayerIds.has(playerId))) {
    throw new Error("Harness 候选池不属于指定的冻结数据快照。");
  }
  const metricKeys = unique(context.metricKeys);
  if (metricKeys.length !== context.metricKeys.length) throw new Error("盲评上下文包含重复指标。");

  return {
    queryId: context.queryId,
    roleBrief: context.roleBrief,
    snapshotSha256: createHash("sha256").update(input.snapshotJson, "utf8").digest("hex"),
    candidateIds,
    metricKeys,
    systemRankings: [{
      systemId: `tactiscout:${output.repository.mode}:${output.model}`,
      runId: run.threadId,
      candidateIds: rankedCandidateIds,
    }],
  };
}
