import { z } from "zod/v4";

export const ShortlistFitGradeSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal("unknown"),
]);

const SampleSizeSchema = z.object({
  minutes: z.number().nonnegative().nullable(),
  matches: z.number().int().nonnegative().nullable(),
}).strict();

const ReviewMetricSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
  status: z.enum(["observed", "missing"]),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  definition: z.string().nullable(),
  sourceField: z.string().nullable(),
  sampleSize: z.object({
    minutes: z.number().nonnegative().nullable(),
    matches: z.number().int().nonnegative().nullable(),
  }).strict(),
}).strict();

const PerformanceCardSchema = z.object({
  basis: z.enum(["match_statistics", "ability_profile"]).optional(),
  position: z.string().nullable(),
  ageAtSeasonEnd: z.number().int().nonnegative().nullable(),
  competition: z.string().trim().min(1),
  season: z.string().trim().min(1),
  sampleSize: SampleSizeSchema,
  metrics: z.array(ReviewMetricSchema),
}).strict();

const AnonymousReviewCardSchema = z.object({
  cardId: z.string().trim().min(1),
  performances: z.array(PerformanceCardSchema).min(1),
}).strict();

export const BlindedReviewerPacketSchema = z.object({
  schemaVersion: z.literal(2),
  benchmarkId: z.literal("human-shortlist-fit-v1"),
  packetId: z.string().trim().min(1),
  roleBrief: z.string().trim().min(1),
  snapshot: z.object({
    source: z.string().trim().min(1),
    publisher: z.string().trim().min(1),
    attribution: z.string().trim().min(1),
    license: z.object({ name: z.string().trim().min(1), url: z.string().url().nullable() }).strict(),
    datasetId: z.string().trim().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    asOf: z.string().datetime(),
    derivationRuleset: z.string().trim().min(1),
    scope: z.string().trim().min(1),
  }).strict(),
  cards: z.array(AnonymousReviewCardSchema).min(1),
  reviewerInstructions: z.array(z.string().trim().min(1)),
}).strict().superRefine((packet, context) => {
  const cardIds = new Set<string>();
  for (const [index, card] of packet.cards.entries()) {
    if (cardIds.has(card.cardId)) {
      context.addIssue({ code: "custom", path: ["cards", index, "cardId"], message: `重复匿名卡 ID：${card.cardId}` });
    }
    cardIds.add(card.cardId);
  }
});

export type BlindedReviewerPacket = z.infer<typeof BlindedReviewerPacketSchema>;

const ReviewerIdSchema = z.string().trim().min(1).max(80);

export const ShortlistReviewSubmissionSchema = z.object({
  schemaVersion: z.literal(1),
  benchmarkId: z.literal("human-shortlist-fit-v1"),
  packetId: z.string().trim().min(1),
  reviewerId: ReviewerIdSchema,
  ratings: z.array(z.object({
    cardId: z.string().trim().min(1),
    rating: ShortlistFitGradeSchema,
  }).strict()).min(1),
}).strict().superRefine((submission, context) => {
  const cardIds = new Set<string>();
  for (const [index, rating] of submission.ratings.entries()) {
    if (cardIds.has(rating.cardId)) {
      context.addIssue({ code: "custom", path: ["ratings", index, "cardId"], message: `重复匿名卡评分：${rating.cardId}` });
    }
    cardIds.add(rating.cardId);
  }
});

export type ShortlistReviewGrade = z.infer<typeof ShortlistFitGradeSchema>;
export type ShortlistReviewSubmission = z.infer<typeof ShortlistReviewSubmissionSchema>;

const ShortlistReviewSessionSchema = z.object({
  schemaVersion: z.literal(1),
  packet: BlindedReviewerPacketSchema,
  reviewerId: ReviewerIdSchema,
  ratings: z.record(z.string(), ShortlistFitGradeSchema),
}).strict().superRefine((session, context) => {
  const cardIds = new Set(session.packet.cards.map(({ cardId }) => cardId));
  for (const cardId of Object.keys(session.ratings)) {
    if (!cardIds.has(cardId)) {
      context.addIssue({ code: "custom", path: ["ratings", cardId], message: `草稿评分不属于当前评审包：${cardId}` });
    }
  }
});

export type ShortlistReviewSession = z.infer<typeof ShortlistReviewSessionSchema>;

const ActiveReviewSessionSchema = z.object({
  packetId: z.string().trim().min(1),
  reviewerId: ReviewerIdSchema,
}).strict();

export interface ShortlistReviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CreateShortlistReviewSubmissionInput {
  packet: unknown;
  reviewerId: string;
  ratings: Record<string, unknown>;
}

function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "输入格式无效。";
}

export function parseBlindedReviewerPacket(packetJson: string): BlindedReviewerPacket {
  let value: unknown;
  try {
    value = JSON.parse(packetJson) as unknown;
  } catch {
    throw new Error("盲评文件不是有效 JSON。");
  }
  const parsed = BlindedReviewerPacketSchema.safeParse(value);
  if (!parsed.success) throw new Error(`评审包格式无效：${firstIssueMessage(parsed.error)}`);
  return parsed.data;
}

export function createShortlistReviewSubmission(input: CreateShortlistReviewSubmissionInput): ShortlistReviewSubmission {
  const packetResult = BlindedReviewerPacketSchema.safeParse(input.packet);
  if (!packetResult.success) throw new Error(`评审包格式无效：${firstIssueMessage(packetResult.error)}`);
  const packet = packetResult.data;
  const reviewerId = ReviewerIdSchema.safeParse(input.reviewerId);
  if (!reviewerId.success) throw new Error("评审代号必填，且不能超过 80 个字符；请勿填写姓名或邮箱。");
  const ratings = z.record(z.string(), ShortlistFitGradeSchema).safeParse(input.ratings);
  if (!ratings.success) throw new Error(`评分格式无效：${firstIssueMessage(ratings.error)}`);

  const cardIds = new Set(packet.cards.map(({ cardId }) => cardId));
  for (const cardId of Object.keys(ratings.data)) {
    if (!cardIds.has(cardId)) throw new Error(`评分卡片不属于当前评审包：${cardId}`);
  }
  const missingCard = packet.cards.find(({ cardId }) => !Object.hasOwn(ratings.data, cardId));
  if (missingCard) throw new Error(`每张卡片都需要评分（或选择“未知”）：${missingCard.cardId}`);

  const submission = ShortlistReviewSubmissionSchema.safeParse({
    schemaVersion: 1,
    benchmarkId: packet.benchmarkId,
    packetId: packet.packetId,
    reviewerId: reviewerId.data,
    ratings: packet.cards.map(({ cardId }) => ({ cardId, rating: ratings.data[cardId] })),
  });
  if (!submission.success) throw new Error(`评审结果无效：${firstIssueMessage(submission.error)}`);
  return submission.data;
}

const activeSessionKey = "tactiscout:shortlist-review:v1:active";

function sessionKey(packetId: string, reviewerId: string): string {
  return `tactiscout:shortlist-review:v1:${encodeURIComponent(packetId)}:${encodeURIComponent(reviewerId)}`;
}

function parseSession(value: unknown): ShortlistReviewSession {
  const parsed = ShortlistReviewSessionSchema.safeParse(value);
  if (!parsed.success) throw new Error(`本机盲评草稿格式无效：${firstIssueMessage(parsed.error)}`);
  return parsed.data;
}

function saveSession(storage: ShortlistReviewStorage, session: ShortlistReviewSession): void {
  storage.setItem(sessionKey(session.packet.packetId, session.reviewerId), JSON.stringify(session));
  storage.setItem(activeSessionKey, JSON.stringify({ packetId: session.packet.packetId, reviewerId: session.reviewerId }));
}

/** Local, provider-free workflow for importing, resuming, rating, and exporting one blind packet. */
export function createShortlistReviewWorkspace(storage: ShortlistReviewStorage) {
  return {
    open(packetJson: string, reviewerId: string): ShortlistReviewSession {
      const packet = parseBlindedReviewerPacket(packetJson);
      const parsedReviewerId = ReviewerIdSchema.safeParse(reviewerId);
      if (!parsedReviewerId.success) throw new Error("请填写评审代号（不要填写姓名或邮箱）。");
      const key = sessionKey(packet.packetId, parsedReviewerId.data);
      const existing = storage.getItem(key);
      if (existing) {
        const session = parseSession(JSON.parse(existing) as unknown);
        if (JSON.stringify(session.packet) !== JSON.stringify(packet)) {
          throw new Error("该评审包 ID 已关联另一份内容；为避免混合草稿，无法打开。");
        }
        saveSession(storage, session);
        return session;
      }

      const session: ShortlistReviewSession = {
        schemaVersion: 1,
        packet,
        reviewerId: parsedReviewerId.data,
        ratings: {},
      };
      saveSession(storage, session);
      return session;
    },

    loadActive(): ShortlistReviewSession | null {
      const active = storage.getItem(activeSessionKey);
      if (!active) return null;
      let value: unknown;
      try {
        value = JSON.parse(active) as unknown;
      } catch {
        throw new Error("本机盲评进度指针格式无效。");
      }
      const parsedActive = ActiveReviewSessionSchema.safeParse(value);
      if (!parsedActive.success) throw new Error(`本机盲评进度指针无效：${firstIssueMessage(parsedActive.error)}`);
      const saved = storage.getItem(sessionKey(parsedActive.data.packetId, parsedActive.data.reviewerId));
      if (!saved) return null;
      let sessionValue: unknown;
      try {
        sessionValue = JSON.parse(saved) as unknown;
      } catch {
        throw new Error("本机盲评草稿不是有效 JSON。");
      }
      const session = parseSession(sessionValue);
      if (session.packet.packetId !== parsedActive.data.packetId || session.reviewerId !== parsedActive.data.reviewerId) {
        throw new Error("本机盲评草稿与当前评审代号不匹配。");
      }
      return session;
    },

    rate(sessionInput: ShortlistReviewSession, cardId: string, rating: ShortlistReviewGrade): ShortlistReviewSession {
      const session = parseSession(sessionInput);
      if (!session.packet.cards.some((card) => card.cardId === cardId)) {
        throw new Error(`匿名卡不属于当前评审包：${cardId}`);
      }
      const parsedRating = ShortlistFitGradeSchema.safeParse(rating);
      if (!parsedRating.success) throw new Error("评分必须为 0–3 或“未知”。");
      const updated: ShortlistReviewSession = {
        ...session,
        ratings: { ...session.ratings, [cardId]: parsedRating.data },
      };
      saveSession(storage, updated);
      return updated;
    },

    deactivate(): void {
      storage.removeItem(activeSessionKey);
    },

    clear(sessionInput: ShortlistReviewSession): void {
      const session = parseSession(sessionInput);
      storage.removeItem(sessionKey(session.packet.packetId, session.reviewerId));
      const active = storage.getItem(activeSessionKey);
      if (!active) return;
      let value: unknown;
      try {
        value = JSON.parse(active) as unknown;
      } catch {
        storage.removeItem(activeSessionKey);
        return;
      }
      const parsedActive = ActiveReviewSessionSchema.safeParse(value);
      if (!parsedActive.success
        || (parsedActive.data.packetId === session.packet.packetId && parsedActive.data.reviewerId === session.reviewerId)) {
        storage.removeItem(activeSessionKey);
      }
    },

    createSubmission(sessionInput: ShortlistReviewSession): ShortlistReviewSubmission {
      const session = parseSession(sessionInput);
      return createShortlistReviewSubmission({
        packet: session.packet,
        reviewerId: session.reviewerId,
        ratings: session.ratings,
      });
    },
  };
}
