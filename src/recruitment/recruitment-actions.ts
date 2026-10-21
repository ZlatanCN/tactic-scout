import { z } from "zod/v4";
import { CapabilityMetricKeySchema } from "../domain/capabilities.js";
import { PositionSchema } from "../domain/position-contracts.js";
import { FmSearchCriterionSchema } from "../domain/recruitment-brief.js";

export const FinishLimitationKeySchema = z.enum([
  "current_roster",
  "budget",
  "market_value",
  "contract",
  "injury",
  "physical",
  "potential",
  "registration",
  "work_permit",
  "other",
]);

export const MAX_RECOMMENDATIONS_PER_REPORT = 5;

export const FinishActionSchema = z.object({
  action: z.literal("finish"),
  targetTeam: z.string().nullable(),
  needSummary: z.string().min(1),
  capabilityProfile: z.array(z.string()).max(8),
  recommendations: z.array(z.object({
    playerId: z.string().min(1),
    evidenceKeys: z.array(CapabilityMetricKeySchema).min(1).describe("仅引用直接支持用户明确提出能力与角色的评估指标；不能用不相关指标凑足推荐依据。"),
  })).max(MAX_RECOMMENDATIONS_PER_REPORT),
  limitationKeys: z.array(FinishLimitationKeySchema).max(10),
  reportObservations: z.array(z.object({
    playerId: z.string().min(1),
    documentId: z.string().min(1),
    summary: z.string().trim().min(1).max(600),
    linkedMetricKeys: z.array(CapabilityMetricKeySchema).max(8),
  })).max(10).default([]),
});

export const AskUserActionSchema = z.object({
  action: z.literal("ask_user"),
  question: z.string().min(1),
  reason: z.string().min(1),
  positionSelection: z.object({ highlight: PositionSchema.nullable(), current: PositionSchema.optional() }).optional(),
});

const targetTeamContextField = { targetTeam: z.string().trim().min(1).nullable().optional() };

export const SearchCandidatesActionSchema = z.object({
  ...targetTeamContextField,
  action: z.literal("search_candidates"),
  position: PositionSchema.nullable().default(null),
  positions: z.array(PositionSchema).min(1).max(12).optional(),
  playerName: z.string().trim().min(1).nullable().default(null),
  maxAge: z.number().int().min(0).max(45).nullable().default(null),
  minAge: z.number().int().min(0).max(45).nullable().optional(),
  agePreference: z.enum(["younger", "older"]).nullable().optional(),
  minimumMinutes: z.number().int().min(0).max(5000).default(0),
  fmCriteria: z.array(FmSearchCriterionSchema).max(16).optional(),
  competition: z.string().nullable().default(null),
  excludedCompetitions: z.array(z.string().trim().min(1)).max(16).optional(),
  season: z.string().nullable().default(null),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(20).default(20),
});

export const RecruitmentActionSchema = z.discriminatedUnion("action", [
  z.object({
    ...targetTeamContextField,
    action: z.literal("inspect_team"),
    teamName: z.string().min(1).describe("The club mentioned by the user; inspect only the dataset sample."),
  }),
  z.object({
    ...targetTeamContextField,
    action: z.literal("inspect_player"),
    playerId: z.string().min(1),
    sections: z.array(z.enum(["positions", "history", "recent", "shotProfile", "shots"])).min(1).max(5)
      .default(["positions", "history", "recent", "shotProfile"]),
  }),
  z.object({
    ...targetTeamContextField,
    action: z.literal("inspect_candidate_group"),
    playerIds: z.array(z.string().min(1)).min(1).max(12),
    sections: z.array(z.enum(["positions", "history", "recent", "shotProfile"])).min(1).max(4)
      .default(["positions", "history", "recent", "shotProfile"]),
  }),
  z.object({
    ...targetTeamContextField,
    action: z.literal("inspect_match"),
    matchId: z.string().regex(/^[1-9]\d{0,14}$/),
  }),
  SearchCandidatesActionSchema,
  z.object({
    ...targetTeamContextField,
    action: z.literal("search_methodology"),
    query: z.string().trim().min(2).max(2000),
    limit: z.number().int().min(1).max(8).default(4),
  }),
  z.object({
    ...targetTeamContextField,
    action: z.literal("search_player_reports"),
    query: z.string().trim().min(2).max(2000),
  playerNames: z.array(z.string().trim().min(1)).max(10).default([]),
    limit: z.number().int().min(1).max(8).default(4),
  }),
  z.object({
    ...targetTeamContextField,
    action: z.literal("evaluate_candidates"),
    playerIds: z.array(z.string().min(1)).min(1).max(10),
  }),
  z.object({
    ...targetTeamContextField,
    ...AskUserActionSchema.shape,
  }),
  FinishActionSchema,
]);

export type RecruitmentAction = z.input<typeof RecruitmentActionSchema>;
export type ParsedRecruitmentAction = z.output<typeof RecruitmentActionSchema>;
export type FinishRecruitmentAction = z.output<typeof FinishActionSchema>;

export const toolBudgets = {
  inspect_team: 2,
  inspect_player: 3,
  inspect_candidate_group: 4,
  inspect_match: 2,
  search_methodology: 2,
  search_candidates: 4,
  evaluate_candidates: 3,
  search_player_reports: 3,
} as const;

export type ToolActionName = keyof typeof toolBudgets;
export type RecruitmentPlannerAction = ToolActionName | "ask_user" | "finish";
export type ToolUseCounts = Record<ToolActionName, number>;

export function emptyToolUseCounts(): ToolUseCounts {
  return { inspect_team: 0, inspect_player: 0, inspect_candidate_group: 0, inspect_match: 0, search_methodology: 0, search_candidates: 0, evaluate_candidates: 0, search_player_reports: 0 };
}

export function isToolAction(action: ParsedRecruitmentAction): action is Extract<ParsedRecruitmentAction, { action: ToolActionName }> {
  return action.action in toolBudgets;
}

export const emptyDecision = (targetTeam: string | null): FinishRecruitmentAction => FinishActionSchema.parse({
  action: "finish",
  targetTeam,
  needSummary: "当前案件的目标画像仍需更多调查。",
  capabilityProfile: [],
  recommendations: [],
  limitationKeys: ["other"],
});
