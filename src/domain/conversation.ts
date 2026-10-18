import { RecruitmentBriefSchema } from "./recruitment-brief.js";
import { z } from "zod/v4";
import { PlayerIdentityQuestionSchema, PositionSelectionQuestionSchema } from "./position-contracts.js";
import { RecruitmentReportSchema } from "./reports.js";

export const TeamRosterContextStatusSchema = z.enum([
  "available",
  "not_configured",
  "partial",
  "empty",
  "not_found",
  "ambiguous",
  "unavailable",
]);

export type TeamRosterContextStatus = z.infer<typeof TeamRosterContextStatusSchema>;

export const TeamRosterFailureKindSchema = z.enum([
  "disabled",
  "missing_api_key",
  "paid_plan_required",
  "cancelled",
  "ephemeral_replay",
  "timeout",
  "rate_limited",
  "network",
  "http",
  "invalid_response",
]);

export const TeamRosterContextSchema = z.object({
  status: TeamRosterContextStatusSchema,
  requestedTeam: z.string().min(1),
  matchedTeams: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url(),
  })).max(5),
  team: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url(),
  }).nullable(),
  players: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    position: z.string().nullable(),
    dateOfBirth: z.string().nullable().optional(),
    nationality: z.string().nullable().optional(),
    url: z.string().url(),
  })).max(100),
  returnedCount: z.number().int().nonnegative(),
  resultLimit: z.number().int().min(1).max(100),
  possiblyTruncated: z.boolean(),
  retrievedAt: z.string().datetime().nullable(),
  sourceUrl: z.string().url(),
  failureKind: TeamRosterFailureKindSchema.nullable(),
  notice: z.string().min(1),
});

export type TeamRosterContext = z.infer<typeof TeamRosterContextSchema>;

export const RecruitmentProgressStageSchema = z.enum([
  "understanding",
  "reference_identity",
  "starting",
  "planning",
  "methodology",
  "team_sample",
  "player_detail",
  "match_detail",
  "candidate_search",
  "player_evaluation",
  "external_signal",
  "historical_archive",
  "report_search",
  "synthesizing",
  "review",
  "team_roster_context",
  "asking_user",
  "completed",
  "cancelling",
  "cancelled",
  "failed",
]);

export type RecruitmentProgressStage = z.infer<typeof RecruitmentProgressStageSchema>;

export const RecruitmentProgressEventStatusSchema = z.enum([
  "started",
  "completed",
  "waiting_for_user",
  "notice",
  "cancelled",
  "failed",
]);

export type RecruitmentProgressEventStatus = z.infer<typeof RecruitmentProgressEventStatusSchema>;

export const RecruitmentGraphProgressUpdateSchema = z.object({
  type: z.literal("tactiscout/recruitment-progress"),
  stage: RecruitmentProgressStageSchema,
  status: RecruitmentProgressEventStatusSchema,
  message: z.string().min(1),
  completedSteps: z.number().int().nonnegative(),
});

export type RecruitmentGraphProgressUpdate = z.infer<typeof RecruitmentGraphProgressUpdateSchema>;

export const RecruitmentProgressEventSchema = z.object({
  sequence: z.number().int().positive(),
  occurrence: z.number().int().positive(),
  stage: RecruitmentProgressStageSchema,
  status: RecruitmentProgressEventStatusSchema,
  message: z.string().min(1),
  occurredAt: z.string().datetime(),
});

export type RecruitmentProgressEvent = z.infer<typeof RecruitmentProgressEventSchema>;

export const ConversationTurnResponseSchema = z.object({
  threadId: z.string().min(1),
  status: z.enum(["needs_input", "completed", "cancelled"]),
  message: z.string().min(1),
  question: z.object({ reason: z.string().min(1), input: z.union([PositionSelectionQuestionSchema, PlayerIdentityQuestionSchema]).optional() }).nullable(),
  report: RecruitmentReportSchema.nullable(),
  brief: RecruitmentBriefSchema.nullable().optional(),
  retryMessage: z.string().min(1).optional(),
  teamRosterContext: TeamRosterContextSchema.optional(),
  progressEvents: z.array(RecruitmentProgressEventSchema).max(24).optional(),
});

export type ConversationTurnResponse = z.infer<typeof ConversationTurnResponseSchema>;

export const RecruitmentTurnCancellationResponseSchema = z.object({
  status: z.enum(["requested", "already_settled"]),
});

export type RecruitmentTurnCancellationResponse = z.infer<typeof RecruitmentTurnCancellationResponseSchema>;

export const RecruitmentProgressSchema = z.object({
  requestId: z.string().uuid().optional(),
  active: z.boolean(),
  stage: RecruitmentProgressStageSchema,
  message: z.string().min(1),
  completedSteps: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  events: z.array(RecruitmentProgressEventSchema).max(24).default([]),
});

export type RecruitmentProgress = z.infer<typeof RecruitmentProgressSchema>;
