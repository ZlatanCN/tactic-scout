import { z } from "zod/v4";
import { PlayerIdentityAnswerSchema, PositionSchema, PositionSelectionAnswerSchema } from "./position-contracts.js";

export const InPossessionRoleSchema = z.enum(["progression", "retention", "creation"]);

export type InPossessionRole = z.infer<typeof InPossessionRoleSchema>;

export const OutOfPossessionRoleSchema = z.enum(["pressing", "defensive_disruption"]);

export type OutOfPossessionRole = z.infer<typeof OutOfPossessionRoleSchema>;

export const RolePhaseSchema = z.enum(["in_possession", "out_of_possession"]);

export const ScoutInputSchema = z.object({
  targetTeam: z.string().trim().min(1).describe("Club the recommendation is for"),
  query: z.string().optional().describe("Original natural-language scouting brief"),
  position: PositionSchema,
  maxAge: z.number().int().min(15).max(45).optional(),
  inPossessionRoles: z.array(InPossessionRoleSchema).default([]),
  outOfPossessionRoles: z.array(OutOfPossessionRoleSchema).default([]),
  topK: z.number().int().min(1).max(10).default(5),
  includeUnknownAge: z.boolean().default(false),
}).refine(
  (value) => value.inPossessionRoles.length + value.outOfPossessionRoles.length > 0,
  { message: "至少选择一项有球或无球职责。" },
);

export type ScoutInput = z.infer<typeof ScoutInputSchema>;

export const RequirementsSchema = z.object({
  targetTeam: z.string().trim().min(1),
  position: PositionSchema,
  maxAge: z.number().int().min(15).max(45).optional(),
  inPossessionRoles: z.array(InPossessionRoleSchema).default([]),
  outOfPossessionRoles: z.array(OutOfPossessionRoleSchema).default([]),
  includeUnknownAge: z.boolean().default(false),
  topK: z.number().int().min(1).max(10).default(5),
}).refine(
  (value) => value.inPossessionRoles.length + value.outOfPossessionRoles.length > 0,
  { message: "至少选择一项有球或无球职责。" },
);

export type Requirements = z.infer<typeof RequirementsSchema>;

export const ConversationTurnRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  memoryOwnerId: z.string().uuid().optional(),
  message: z.string().trim().max(4000).default(""),
  positionAnswer: PositionSelectionAnswerSchema.optional(),
  positionUpdate: PositionSelectionAnswerSchema.shape.positions.optional(),
  playerIdentityAnswer: PlayerIdentityAnswerSchema.optional(),
  expectsExistingState: z.boolean().default(false),
}).refine((value) => value.message.length > 0 || value.positionAnswer !== undefined || value.positionUpdate !== undefined || value.playerIdentityAnswer !== undefined, "请提供消息或选择").refine((value) => !(value.positionAnswer && value.positionUpdate), "不能同时回答位置问题和修改位置").refine((value) => !(value.playerIdentityAnswer && (value.positionAnswer || value.positionUpdate)), "不能同时回答球员身份问题和位置问题");

export type ConversationTurnRequest = z.infer<typeof ConversationTurnRequestSchema>;
