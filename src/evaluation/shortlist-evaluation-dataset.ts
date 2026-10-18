import { z } from "zod/v4";
import {
  BlindedReviewerPacketSchema,
  ShortlistFitGradeSchema,
  ShortlistReviewSubmissionSchema,
} from "../domain/shortlist-review.js";
import {
  ShortlistQualityDatasetSchema,
  type ShortlistQualityDataset,
} from "./shortlist-quality-evaluation.js";

const AnswerKeyCardSchema = z.object({
  cardId: z.string().trim().min(1),
  sourcePlayerIds: z.array(z.string().trim().min(1)).min(1),
  externalPlayerId: z.string().trim().min(1),
  playerName: z.string().trim().min(1),
  teamStints: z.array(z.object({
    team: z.string().trim().min(1),
    teamId: z.string().trim().min(1),
    competition: z.string().trim().min(1),
    season: z.string().trim().min(1),
  }).strict()),
  systemRanks: z.array(z.object({
    systemId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    rank: z.number().int().positive(),
  }).strict()),
}).strict();

const AnswerKeySchema = z.object({
  schemaVersion: z.literal(2),
  packetId: z.string().trim().min(1),
  queryId: z.string().trim().min(1),
  snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  systemRuns: z.array(z.object({ systemId: z.string().trim().min(1), runId: z.string().trim().min(1) }).strict()).optional(),
  cards: z.array(AnswerKeyCardSchema).min(1),
}).strict().superRefine((answerKey, context) => {
  const declaredRuns = new Set<string>();
  for (const [index, run] of (answerKey.systemRuns ?? []).entries()) {
    const key = `${run.systemId}\u0000${run.runId}`;
    if (declaredRuns.has(key)) context.addIssue({ code: "custom", path: ["systemRuns", index], message: "答案键包含重复系统运行。" });
    declaredRuns.add(key);
  }
  const cardIds = new Set<string>();
  const sourcePlayerIds = new Set<string>();
  const ranksBySystemRun = new Map<string, Set<number>>();
  for (const [cardIndex, card] of answerKey.cards.entries()) {
    if (cardIds.has(card.cardId)) {
      context.addIssue({ code: "custom", path: ["cards", cardIndex, "cardId"], message: `答案键包含重复匿名卡：${card.cardId}` });
    }
    cardIds.add(card.cardId);
    for (const [sourceIndex, sourcePlayerId] of card.sourcePlayerIds.entries()) {
      if (sourcePlayerIds.has(sourcePlayerId)) {
        context.addIssue({ code: "custom", path: ["cards", cardIndex, "sourcePlayerIds", sourceIndex], message: "答案键的来源球员 ID 对应多张匿名卡。" });
      }
      sourcePlayerIds.add(sourcePlayerId);
    }
    const cardSystemRuns = new Set<string>();
    for (const [rankIndex, rank] of card.systemRanks.entries()) {
      const systemRun = `${rank.systemId}\u0000${rank.runId}`;
      if (answerKey.systemRuns && !declaredRuns.has(systemRun)) context.addIssue({ code: "custom", path: ["cards", cardIndex, "systemRanks", rankIndex], message: "名次引用了未声明的系统运行。" });
      if (cardSystemRuns.has(systemRun)) {
        context.addIssue({ code: "custom", path: ["cards", cardIndex, "systemRanks", rankIndex], message: "答案键在同一卡片中包含重复系统运行。" });
      }
      cardSystemRuns.add(systemRun);
      const ranks = ranksBySystemRun.get(systemRun) ?? new Set<number>();
      if (ranks.has(rank.rank)) {
        context.addIssue({ code: "custom", path: ["cards", cardIndex, "systemRanks", rankIndex, "rank"], message: `系统运行 ${rank.systemId}/${rank.runId} 存在重复名次。` });
      }
      ranks.add(rank.rank);
      ranksBySystemRun.set(systemRun, ranks);
    }
  }
});

const AdjudicationSchema = z.object({
  cardId: z.string().trim().min(1),
  grade: ShortlistFitGradeSchema,
}).strict();

export interface CreateShortlistQualityDatasetInput {
  packet: unknown;
  submissions: unknown;
  adjudications: unknown;
  answerKey: unknown;
}

export interface ShortlistAdjudicationBundle {
  packet: z.infer<typeof BlindedReviewerPacketSchema>;
  submissions: z.infer<typeof ShortlistReviewSubmissionSchema>[];
}

function cardIdSet(packet: z.infer<typeof BlindedReviewerPacketSchema>): Set<string> {
  return new Set(packet.cards.map(({ cardId }) => cardId));
}

function assertExactCardCoverage(cardIds: Set<string>, ratings: string[], label: string): void {
  const uniqueRatings = new Set(ratings);
  if (uniqueRatings.size !== ratings.length) throw new Error(`${label}包含重复匿名卡。`);
  if (ratings.length !== cardIds.size || [...cardIds].some((cardId) => !uniqueRatings.has(cardId))) {
    throw new Error(`${label}未覆盖全部匿名卡。`);
  }
}

/**
 * Joins complete independent blind ratings, adjudicated grades, and a separately held answer key.
 * Output candidate IDs remain anonymous card IDs; player and team identities are never propagated.
 */
export function createShortlistQualityDataset(input: CreateShortlistQualityDatasetInput): ShortlistQualityDataset {
  const { packet, submissions } = parseShortlistAdjudicationBundle({ packet: input.packet, submissions: input.submissions });
  const answerKey = AnswerKeySchema.parse(input.answerKey);
  const adjudications = z.array(AdjudicationSchema).min(1).parse(input.adjudications);

  if (answerKey.packetId !== packet.packetId) throw new Error("答案键与盲评包不匹配。");
  if (answerKey.snapshotSha256.toLowerCase() !== packet.snapshot.sha256.toLowerCase()) {
    throw new Error("答案键快照哈希与盲评包不匹配。");
  }
  const expectedCardIds = cardIdSet(packet);
  assertExactCardCoverage(expectedCardIds, answerKey.cards.map(({ cardId }) => cardId), "答案键");

  const ratings = submissions.flatMap((submission) => submission.ratings.map(({ cardId, rating }) => ({
    candidateId: cardId,
    reviewerId: submission.reviewerId,
    rating,
  })));

  const adjudicationsByCard = new Map<string, z.infer<typeof AdjudicationSchema>["grade"]>();
  for (const adjudication of adjudications) {
    if (!expectedCardIds.has(adjudication.cardId)) throw new Error(`裁决引用了当前评审包之外的卡片：${adjudication.cardId}`);
    if (adjudicationsByCard.has(adjudication.cardId)) throw new Error(`匿名卡存在重复裁决：${adjudication.cardId}`);
    adjudicationsByCard.set(adjudication.cardId, adjudication.grade);
  }
  if (adjudicationsByCard.size !== expectedCardIds.size) throw new Error("裁决必须覆盖全部匿名卡；证据不足时明确选择 unknown。");

  const rankings = new Map<string, Map<number, string>>();
  for (const run of answerKey.systemRuns ?? []) rankings.set(`${run.systemId}\u0000${run.runId}`, new Map());
  for (const card of answerKey.cards) {
    for (const rank of card.systemRanks) {
      const systemRun = `${rank.systemId}\u0000${rank.runId}`;
      const candidatesByRank = rankings.get(systemRun) ?? new Map<number, string>();
      candidatesByRank.set(rank.rank, card.cardId);
      rankings.set(systemRun, candidatesByRank);
    }
  }
  const systemRankings = [...rankings.entries()].map(([systemRun, candidatesByRank]) => {
    const [systemId, runId] = systemRun.split("\u0000");
    return {
      systemId: systemId!,
      runId: runId!,
      candidateIds: [...candidatesByRank.entries()].sort(([left], [right]) => left - right).map(([, cardId]) => cardId),
    };
  }).sort((left, right) => left.systemId.localeCompare(right.systemId) || left.runId.localeCompare(right.runId));

  return ShortlistQualityDatasetSchema.parse({
    schemaVersion: 1,
    benchmarkId: packet.benchmarkId,
    snapshots: [{
      ref: packet.packetId,
      provider: packet.snapshot.publisher,
      datasetId: packet.snapshot.datasetId,
      asOf: packet.snapshot.asOf,
      contentSha256: packet.snapshot.sha256,
      derivationRuleset: packet.snapshot.derivationRuleset,
    }],
    queries: [{
      queryId: answerKey.queryId,
      brief: packet.roleBrief,
      snapshotRefs: [packet.packetId],
      candidateIds: packet.cards.map(({ cardId }) => cardId),
      systemRankings,
      ratings,
      adjudications: packet.cards.map(({ cardId }) => ({
        candidateId: cardId,
        grade: adjudicationsByCard.get(cardId)!,
      })),
    }],
  });
}

/** Validate a complete blind bundle before exposing its evidence for human adjudication. */
export function parseShortlistAdjudicationBundle(input: { packet: unknown; submissions: unknown }): ShortlistAdjudicationBundle {
  const packet = BlindedReviewerPacketSchema.parse(input.packet);
  const submissions = z.array(ShortlistReviewSubmissionSchema).min(2, "至少需要两位不同评审者的完整评分。").parse(input.submissions);
  const expectedCardIds = cardIdSet(packet);
  const reviewerIds = new Set<string>();
  for (const submission of submissions) {
    if (submission.benchmarkId !== packet.benchmarkId || submission.packetId !== packet.packetId) {
      throw new Error("评分文件与盲评包不匹配。");
    }
    if (reviewerIds.has(submission.reviewerId)) throw new Error("评审代号必须互不相同。");
    reviewerIds.add(submission.reviewerId);
    assertExactCardCoverage(expectedCardIds, submission.ratings.map(({ cardId }) => cardId), `评审 ${submission.reviewerId}`);
  }
  return { packet, submissions };
}
