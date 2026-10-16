import { z } from "zod/v4";

export const PositionSchema = z.enum(["GK", "DEF", "CB", "FB", "LB", "RB", "LWB", "RWB", "MID", "DM", "CM", "AM", "ATT", "WG", "LW", "RW", "ST"]);

export type Position = z.infer<typeof PositionSchema>;

export const SelectablePositionSchema = z.enum(["GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "CM", "AM", "LW", "RW", "ST"]);

export type SelectablePosition = z.infer<typeof SelectablePositionSchema>;

export const PositionSelectionQuestionSchema = z.object({
  kind: z.literal("positions"),
  allowKeepCurrent: z.boolean().optional(),
  questionId: z.string().uuid(),
  highlightedPositions: z.array(SelectablePositionSchema),
  selectedPositions: z.array(SelectablePositionSchema),
});

export type PositionSelectionQuestion = z.infer<typeof PositionSelectionQuestionSchema>;

export const PlayerIdentityOptionSchema = z.object({
  entityId: z.string().regex(/^Q\d+$/),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  sourceUrl: z.string().regex(/^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/),
});

export type PlayerIdentityOption = z.infer<typeof PlayerIdentityOptionSchema>;

export const PlayerIdentityQuestionSchema = z.object({
  kind: z.literal("player_identity"),
  questionId: z.string().uuid(),
  mention: z.string().min(1),
  candidates: z.array(PlayerIdentityOptionSchema).min(1).max(5),
});

export type PlayerIdentityQuestion = z.infer<typeof PlayerIdentityQuestionSchema>;

export const PlayerIdentityAnswerSchema = z.object({
  questionId: z.string().uuid(),
  entityId: z.string().regex(/^Q\d+$/),
});

export type PlayerIdentityAnswer = z.infer<typeof PlayerIdentityAnswerSchema>;

export const PositionSelectionAnswerSchema = z.object({
  keepCurrent: z.literal(true).optional(),
  questionId: z.string().uuid(),
  positions: z.array(SelectablePositionSchema).min(1).max(12)
    .refine((positions) => new Set(positions).size === positions.length, "位置不能重复"),
});

export type PositionSelectionAnswer = z.infer<typeof PositionSelectionAnswerSchema>;

export const PlayerPositionSchema = z.union([PositionSchema, z.literal("UNKNOWN")]);

export type PlayerPosition = z.infer<typeof PlayerPositionSchema>;

export const PlayerPositionEvidenceSchema = z.object({
  provider: z.string().min(1),
  targetPosition: PositionSchema,
  status: z.enum(["pending", "direct", "compatible", "not_observed", "unavailable", "broad_only"]),
  sourceScope: z.enum(["season_position_aggregate"]).optional(),
  season: z.string().nullable(),
  sourceCodes: z.array(z.string()),
  sampleMinutes: z.number().nonnegative().nullable(),
});

export type PlayerPositionEvidence = z.infer<typeof PlayerPositionEvidenceSchema>;
