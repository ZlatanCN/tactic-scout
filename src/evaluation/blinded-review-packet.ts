import { createHash, createHmac } from "node:crypto";
import { z } from "zod/v4";
import type { BlindedReviewerPacket } from "../domain/shortlist-review.js";
import { shortlistFitRubric } from "../domain/shortlist-fit-rubric.js";

export type { BlindedReviewerPacket } from "../domain/shortlist-review.js";

const SnapshotMetricSchema = z.object({
  key: z.string().trim().min(1),
  value: z.number().nullable(),
  unit: z.string(),
  type: z.enum(["event_aggregate", "event_derived_estimate"]),
  definition: z.string().trim().min(1),
  sourceField: z.string().trim().min(1),
  sampleMinutes: z.number().nonnegative().nullable(),
  sampleMatches: z.number().int().nonnegative().nullable(),
  normalization: z.string().optional(),
}).passthrough();

const SnapshotRecordSchema = z.object({
  playerId: z.string().trim().min(1),
  externalPlayerId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  team: z.string().trim().min(1),
  teamId: z.string().trim().min(1),
  competition: z.string().trim().min(1),
  competitionId: z.string().trim().min(1),
  season: z.string().trim().min(1),
  ageAtSeasonEnd: z.number().int().nonnegative().nullable(),
  position: z.string().trim().min(1).nullable(),
  minutes: z.number().nonnegative(),
  appearanceMatches: z.number().int().nonnegative(),
  metrics: z.array(SnapshotMetricSchema),
}).passthrough();

const SnapshotSchema = z.object({
  schemaVersion: z.number().int().positive(),
  datasetId: z.string().trim().min(1),
  builtAt: z.string().datetime(),
  attribution: z.string().trim().min(1),
  license: z.object({
    name: z.string().trim().min(1),
    url: z.string().url(),
  }).passthrough(),
  upstreamSource: z.object({
    name: z.string().trim().min(1),
    publisher: z.string().trim().min(1),
    paperUrl: z.string().url(),
    acquiredAt: z.string().trim().min(1),
    scope: z.string().trim().min(1),
  }).passthrough(),
  derivation: z.object({ ruleset: z.string().trim().min(1) }).passthrough(),
  records: z.array(SnapshotRecordSchema).min(1),
}).passthrough();

const SystemRankingSchema = z.object({
  systemId: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  candidateIds: z.array(z.string().trim().min(1)),
}).strict();

const ReviewRequestSchema = z.object({
  queryId: z.string().trim().min(1),
  roleBrief: z.string().trim().min(1),
  snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  candidateIds: z.array(z.string().trim().min(1)).min(1),
  metricKeys: z.array(z.string().trim().min(1)).min(1),
  systemRankings: z.array(SystemRankingSchema).min(1),
}).strict().superRefine((request, context) => {
  const candidateIds = new Set<string>();
  for (const [index, candidateId] of request.candidateIds.entries()) {
    if (candidateIds.has(candidateId)) {
      context.addIssue({ code: "custom", path: ["candidateIds", index], message: `重复候选 ID：${candidateId}` });
    }
    candidateIds.add(candidateId);
  }
  const metricKeys = new Set<string>();
  for (const [index, metricKey] of request.metricKeys.entries()) {
    if (metricKeys.has(metricKey)) {
      context.addIssue({ code: "custom", path: ["metricKeys", index], message: `重复指标：${metricKey}` });
    }
    metricKeys.add(metricKey);
  }
  const rankingIds = new Set<string>();
  for (const [rankingIndex, ranking] of request.systemRankings.entries()) {
    const rankingId = `${ranking.systemId}\u0000${ranking.runId}`;
    if (rankingIds.has(rankingId)) {
      context.addIssue({ code: "custom", path: ["systemRankings", rankingIndex], message: `重复系统运行：${ranking.systemId}/${ranking.runId}` });
    }
    rankingIds.add(rankingId);
    const rankedIds = new Set<string>();
    for (const [candidateIndex, candidateId] of ranking.candidateIds.entries()) {
      if (rankedIds.has(candidateId)) {
        context.addIssue({ code: "custom", path: ["systemRankings", rankingIndex, "candidateIds", candidateIndex], message: `系统排名包含重复候选：${candidateId}` });
      }
      rankedIds.add(candidateId);
      if (!candidateIds.has(candidateId)) {
        context.addIssue({ code: "custom", path: ["systemRankings", rankingIndex, "candidateIds", candidateIndex], message: `系统排名引用候选池之外的候选：${candidateId}` });
      }
    }
  }
});

export type BlindedReviewRequest = z.infer<typeof ReviewRequestSchema>;
type Snapshot = z.infer<typeof SnapshotSchema>;
type SnapshotRecord = Snapshot["records"][number];

export interface ExportBlindedReviewPacketsInput {
  snapshotJson: string;
  request: unknown;
  blindingSecret: string;
}

export interface BlindedReviewAnswerKey {
  schemaVersion: 2;
  packetId: string;
  queryId: string;
  snapshotSha256: string;
  cards: Array<{
    cardId: string;
    sourcePlayerIds: string[];
    externalPlayerId: string;
    playerName: string;
    teamStints: Array<{
      team: string;
      teamId: string;
      competition: string;
      season: string;
    }>;
    systemRanks: Array<{ systemId: string; runId: string; rank: number }>;
  }>;
}

export interface BlindedReviewPacketExport {
  reviewerPacket: BlindedReviewerPacket;
  answerKey: BlindedReviewAnswerKey;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cardIdFor(secret: string, queryId: string, candidateId: string): string {
  const digest = createHmac("sha256", secret).update(`${queryId}\u0000${candidateId}`, "utf8").digest("hex");
  return `card_${digest.slice(0, 16)}`;
}

function parseSnapshot(snapshotJson: string): Snapshot {
  let value: unknown;
  try {
    value = JSON.parse(snapshotJson) as unknown;
  } catch {
    throw new Error("冻结数据快照不是有效 JSON。");
  }
  const parsed = SnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error(`冻结数据快照格式无效：${parsed.error.issues[0]?.message ?? "invalid snapshot"}`);
  return parsed.data;
}

function metricDefinitions(snapshot: Snapshot): Map<string, SnapshotRecord["metrics"][number]> {
  const definitions = new Map<string, SnapshotRecord["metrics"][number]>();
  for (const record of snapshot.records) {
    for (const metric of record.metrics) {
      const existing = definitions.get(metric.key);
      if (existing && (existing.unit !== metric.unit
        || existing.type !== metric.type
        || existing.definition !== metric.definition
        || existing.sourceField !== metric.sourceField
        || existing.normalization !== metric.normalization)) {
        throw new Error(`快照中同一指标存在互相冲突的定义：${metric.key}`);
      }
      definitions.set(metric.key, existing ?? metric);
    }
  }
  return definitions;
}

function makeMetricCard(
  record: SnapshotRecord,
  key: string,
  definitions: Map<string, SnapshotRecord["metrics"][number]>,
): BlindedReviewerPacket["cards"][number]["performances"][number]["metrics"][number] {
  const observedMetric = record.metrics.find((candidate) => candidate.key === key);
  const metric = observedMetric ?? definitions.get(key);
  const metricValue = observedMetric?.value ?? null;
  return {
    key,
    status: metricValue === null ? "missing" : "observed",
    value: metricValue,
    unit: metric?.unit ?? null,
    definition: metric?.definition ?? null,
    sourceField: metric?.sourceField ?? null,
    sampleSize: {
      minutes: observedMetric?.sampleMinutes ?? null,
      matches: observedMetric?.sampleMatches ?? null,
    },
  };
}

function createPersonRankLookup(
  request: BlindedReviewRequest,
  recordsById: Map<string, SnapshotRecord>,
): Map<string, Array<{ systemId: string; runId: string; rank: number }>> {
  const ranks = new Map<string, Array<{ systemId: string; runId: string; rank: number }>>();
  for (const ranking of request.systemRankings) {
    const rankedExternalIds = new Set<string>();
    ranking.candidateIds.forEach((candidateId, index) => {
      const record = recordsById.get(candidateId);
      if (!record) throw new Error("系统排名中的候选不在冻结数据快照中：" + candidateId);
      if (rankedExternalIds.has(record.externalPlayerId)) {
        throw new Error("系统排名重复包含同一球员的多个球队记录。");
      }
      rankedExternalIds.add(record.externalPlayerId);
      const candidateRanks = ranks.get(record.externalPlayerId) ?? [];
      candidateRanks.push({ systemId: ranking.systemId, runId: ranking.runId, rank: index + 1 });
      ranks.set(record.externalPlayerId, candidateRanks);
    });
  }
  return ranks;
}

function groupSelectedRecords(records: SnapshotRecord[]): Array<{ externalPlayerId: string; records: SnapshotRecord[] }> {
  const groups = new Map<string, SnapshotRecord[]>();
  for (const record of records) {
    const group = groups.get(record.externalPlayerId) ?? [];
    group.push(record);
    groups.set(record.externalPlayerId, group);
  }
  return [...groups.entries()].map(([externalPlayerId, groupRecords]) => ({
    externalPlayerId,
    records: groupRecords.sort((left, right) => (
      left.competition.localeCompare(right.competition)
      || left.season.localeCompare(right.season)
      || left.teamId.localeCompare(right.teamId)
      || left.playerId.localeCompare(right.playerId)
    )),
  }));
}

/** Build the reviewer-facing evidence packet and the separately stored identity/rank key. */
export function exportBlindedReviewPackets(input: ExportBlindedReviewPacketsInput): BlindedReviewPacketExport {
  if (input.blindingSecret.trim().length < 32) throw new Error("盲评密钥至少需要 32 个字符。");
  const requestResult = ReviewRequestSchema.safeParse(input.request);
  if (!requestResult.success) throw new Error(`盲评请求格式无效：${requestResult.error.issues[0]?.message ?? "invalid request"}`);
  const request = requestResult.data;
  const actualSnapshotSha256 = sha256(input.snapshotJson);
  if (actualSnapshotSha256 !== request.snapshotSha256.toLowerCase()) {
    throw new Error("冻结数据快照的 SHA-256 与请求声明不匹配。");
  }
  const snapshot = parseSnapshot(input.snapshotJson);
  if (snapshot.license.name !== "CC BY 4.0"
    || snapshot.license.url !== "https://creativecommons.org/licenses/by/4.0/") {
    throw new Error("该导出器只接受许可证名称和链接均声明为 CC BY 4.0 的本地快照。");
  }

  const recordsById = new Map<string, SnapshotRecord>();
  const duplicateSourceIds = new Set<string>();
  for (const record of snapshot.records) {
    if (recordsById.has(record.playerId)) duplicateSourceIds.add(record.playerId);
    recordsById.set(record.playerId, record);
  }
  const selectedRecords = request.candidateIds.map((candidateId) => {
    if (duplicateSourceIds.has(candidateId)) throw new Error(`快照中存在重复候选身份：${candidateId}`);
    const record = recordsById.get(candidateId);
    if (!record) throw new Error(`冻结候选池中的球员不在快照中：${candidateId}`);
    return record;
  });
  const rankLookup = createPersonRankLookup(request, recordsById);
  const definitions = metricDefinitions(snapshot);
  const cardsWithKey = groupSelectedRecords(selectedRecords).map((group) => ({
    ...group,
    cardId: cardIdFor(input.blindingSecret, request.queryId, group.externalPlayerId),
  }));
  const cardIds = new Set<string>();
  for (const { cardId } of cardsWithKey) {
    if (cardIds.has(cardId)) throw new Error("匿名卡编号发生冲突，请重新导出。");
    cardIds.add(cardId);
  }
  cardsWithKey.sort((left, right) => left.cardId.localeCompare(right.cardId));
  const packetId = `packet_${sha256(`${request.queryId}\u0000${actualSnapshotSha256}`).slice(0, 16)}`;

  const reviewerPacket: BlindedReviewerPacket = {
    schemaVersion: 2,
    benchmarkId: "human-shortlist-fit-v1",
    packetId,
    roleBrief: request.roleBrief,
    snapshot: {
      source: snapshot.upstreamSource.name,
      publisher: snapshot.upstreamSource.publisher,
      attribution: snapshot.attribution,
      license: { name: snapshot.license.name, url: snapshot.license.url },
      datasetId: snapshot.datasetId,
      sha256: actualSnapshotSha256,
      asOf: snapshot.builtAt,
      derivationRuleset: snapshot.derivation.ruleset,
      scope: snapshot.upstreamSource.scope,
    },
    cards: cardsWithKey.map(({ records, cardId }) => ({
      cardId,
      performances: records.map((record) => ({
        position: record.position,
        ageAtSeasonEnd: record.ageAtSeasonEnd,
        competition: record.competition,
        season: record.season,
        sampleSize: { minutes: record.minutes, matches: record.appearanceMatches },
        metrics: request.metricKeys.map((key) => makeMetricCard(record, key, definitions)),
      })),
    })),
    reviewerInstructions: [
      "仅根据卡片中的来源证据评估冻结职责；不要推测缺失属性，也不要把缺失记为 0 分。",
      ...shortlistFitRubric.map(({ value, label, detail, anchor }) => `评分锚点：${value === "unknown" ? "unknown = 未知" : `${label} = ${detail}`}：${anchor}`),
      "0–3 是本项目用于固定需求的主观适配等级，尚未校准；请勿将统计值直接换算成分数。",
      "每张匿名卡对应一名球员；同一球员在多个球队或赛事的记录分开显示，不要合并指标或样本量。",
      "请勿尝试从匿名卡推断球员、俱乐部或系统排名；锁定全部评分后再与独立答案键合并。",
      "匿名卡是去标识化材料，不保证无法通过公开统计特征重新识别球员。",
    ],
  };
  const answerKey: BlindedReviewAnswerKey = {
    schemaVersion: 2,
    packetId,
    queryId: request.queryId,
    snapshotSha256: actualSnapshotSha256,
    cards: cardsWithKey.map(({ externalPlayerId, records, cardId }) => ({
      cardId,
      sourcePlayerIds: records.map(({ playerId }) => playerId).sort(),
      externalPlayerId,
      playerName: records[0]!.name,
      teamStints: records.map(({ team, teamId, competition, season }) => ({ team, teamId, competition, season })),
      systemRanks: rankLookup.get(externalPlayerId) ?? [],
    })),
  };
  return { reviewerPacket, answerKey };
}
