import { MessagesZodState } from "@langchain/langgraph";
import { z } from "zod/v3";

import { faultCategoryValues } from "./fault-categories.js";
import {
  PlayerResolutionSchema,
  ReferenceCandidateSchema,
} from "./player-data/contracts.js";
import {
  TeamFmProfileCandidateSchema,
  TeamIdentitySchema,
  TeamRecommendationFiltersSchema,
  TeamRosterSnapshotSchema,
} from "./team-data/contracts.js";

const RequestConstraintSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const RecommendationRequestSchema = z.object({
  includePotential: z.boolean(),
  maxAge: z.number().int().nullable(),
  minimumCurrentAbility: z.number().int().nullable(),
  minimumPotentialAbility: z.number().int().nullable(),
  needsAgeClarification: z.boolean(),
  position: z.string().nullable(),
  resultLimit: z.number().int().nullable(),
});

const createInitialRecommendationRequest = () => ({
  includePotential: false,
  maxAge: null,
  minimumCurrentAbility: null,
  minimumPotentialAbility: null,
  needsAgeClarification: false,
  position: null,
  resultLimit: null,
});

const TeamRecommendationRequestSchema = TeamRecommendationFiltersSchema.extend({
  position: z.string().nullable(),
  referenceMode: z.enum(["squad", "named"]),
  roster: TeamRosterSnapshotSchema.nullable(),
  team: TeamIdentitySchema.nullable(),
  teamName: z.string().nullable(),
  teamSearchName: z.string().nullable(),
});

const createInitialTeamRecommendationRequest = () => ({
  includePotential: false,
  maxAge: null,
  minimumCurrentAbility: null,
  minimumPotentialAbility: null,
  position: null,
  referenceMode: "squad" as const,
  resultLimit: null,
  roster: null,
  team: null,
  teamName: null,
  teamSearchName: null,
});

const ConversationPlayerReferenceSchema = z.object({
  candidate: ReferenceCandidateSchema,
  referenceId: z.string(),
});

const ConversationPlayerAliasSchema = z.object({
  mention: z.string(),
  reference: ConversationPlayerReferenceSchema,
});

const ActiveComparisonSchema = z.object({
  constraints: z.array(RequestConstraintSchema),
  players: z.array(ConversationPlayerReferenceSchema),
  resultJson: z.string(),
});

const ActiveLookupSchema = z.object({
  player: ConversationPlayerReferenceSchema,
  resultJson: z.string(),
});

const ActiveRecommendationSchema = z.object({
  excludePlayers: z.array(ConversationPlayerReferenceSchema),
  includePotential: z.boolean(),
  maxAge: z.number().int().nullable(),
  minimumCurrentAbility: z.number().int().nullable(),
  minimumPotentialAbility: z.number().int().nullable(),
  position: z.string(),
  referencePlayers: z.array(ConversationPlayerReferenceSchema),
  resultJson: z.string(),
  resultLimit: z.number().int(),
  status: z.enum(["ready", "no_candidates"]),
});

const ActiveTeamRecommendationSchema = TeamRecommendationFiltersSchema.extend({
  position: z.string(),
  referenceMode: z.enum(["squad", "named"]),
  referencePlayers: z.array(ConversationPlayerReferenceSchema),
  resultJson: z.string(),
  resultLimit: z.number().int(),
  roster: TeamRosterSnapshotSchema,
  status: z.enum(["ready", "no_candidates"]),
  team: TeamIdentitySchema,
});

const createInitialConversationContext = () => ({
  activeComparison: { constraints: [], players: [], resultJson: "" },
  activeLookup: null,
  activeRecommendation: null,
  activeTeamRecommendation: null,
  focusPlayers: [],
  playerAliases: [],
});

const ConversationContextSchema = z.object({
  activeComparison: ActiveComparisonSchema.default(() => ({
    constraints: [],
    players: [],
    resultJson: "",
  })),
  activeLookup: ActiveLookupSchema.nullable().default(null),
  activeRecommendation: ActiveRecommendationSchema.nullable().default(null),
  activeTeamRecommendation:
    ActiveTeamRecommendationSchema.nullable().default(null),
  focusPlayers: z.array(ConversationPlayerReferenceSchema),
  playerAliases: z.array(ConversationPlayerAliasSchema).default([]),
});

const RecommendationPlayerRoleSchema = z.enum([
  "reference",
  "exclude",
  "ambiguous",
]);

const RequestPlayerSchema = z.object({
  attempts: z.number().int().nonnegative(),
  lookupName: z.string().nullable(),
  mention: z.string(),
  recommendationRole: RecommendationPlayerRoleSchema.default("reference"),
  referenceScope: z
    .enum(["explicit", "prior_context", "same_turn", "ambiguous"])
    .default("explicit"),
  referenceTargetMention: z.string().nullable().default(null),
  resolution: PlayerResolutionSchema.nullable(),
});

const requestFields = {
  constraints: z.array(RequestConstraintSchema),
  players: z.array(RequestPlayerSchema),
  processedMessageId: z.string().nullable(),
  teams: z.array(z.string()),
};

const RequestStateSchema = z.discriminatedUnion("kind", [
  z.object({ ...requestFields, kind: z.literal("player_lookup") }),
  z.object({
    ...requestFields,
    comparisonAction: z.enum(["replace", "add", "refine"]),
    kind: z.literal("player_comparison"),
  }),
  z.object({
    ...requestFields,
    kind: z.literal("player_recommendation"),
    recommendation: RecommendationRequestSchema,
    recommendationAction: z.enum(["replace", "add", "refine"]),
  }),
  z.object({
    ...requestFields,
    kind: z.literal("team_recommendation"),
    teamRecommendation: TeamRecommendationRequestSchema,
    teamRecommendationAction: z.enum(["replace", "refine"]),
  }),
  z.object({ ...requestFields, kind: z.literal("other") }),
]);

const WorkflowDraftSchema = z.object({
  comparisonAction: z.enum(["replace", "add", "refine"]).nullable(),
  constraints: z.array(RequestConstraintSchema),
  operation: z.enum(["explain", "refine"]),
  players: z.array(
    z.object({
      lookupName: z.string().nullable(),
      mention: z.string(),
      recommendationRole: RecommendationPlayerRoleSchema,
      referenceScope: z.enum([
        "explicit",
        "prior_context",
        "same_turn",
        "ambiguous",
      ]),
      referenceTargetMention: z.string().nullable(),
    })
  ),
  processedMessageId: z.string().nullable(),
  recommendation: RecommendationRequestSchema.partial(),
  recommendationAction: z.enum(["replace", "add", "refine"]).nullable(),
  teamSearchName: z.string().nullable(),
  teams: z.array(z.string()),
  text: z.string(),
});

const createInitialRequestState = () => ({
  constraints: [],
  kind: "other" as const,
  players: [],
  processedMessageId: null,
  teams: [],
});

const PendingClarificationSchema = z.discriminatedUnion("kind", [
  z.object({
    answer: z.string().nullable(),
    kind: z.literal("identity"),
    playerIndex: z.number().int().nonnegative(),
    question: z.string(),
  }),
  z.object({
    answer: z.string().nullable(),
    kind: z.literal("position"),
    options: z.array(z.string()),
    question: z.string(),
  }),
  z.object({
    answer: z.string().nullable(),
    kind: z.literal("fm_profile"),
    options: z.array(z.string()),
    playerIndex: z.number().int().nonnegative(),
    question: z.string(),
  }),
  z.object({
    answer: z.string().nullable(),
    kind: z.literal("age"),
    question: z.string(),
  }),
  z.object({
    answer: z.string().nullable(),
    kind: z.literal("recommendation_role"),
    playerIndex: z.number().int().nonnegative(),
    question: z.string(),
  }),
  z.object({
    answer: z.string().nullable(),
    kind: z.literal("season"),
    question: z.string(),
  }),
  z.object({
    answer: z.string().nullable(),
    candidates: z.array(TeamIdentitySchema),
    kind: z.literal("team"),
    question: z.string(),
  }),
  z.object({
    answer: z.string().nullable(),
    kind: z.literal("team_position"),
    options: z.array(z.string()),
    question: z.string(),
  }),
  z.object({
    answer: z.string().nullable(),
    candidates: z.array(TeamFmProfileCandidateSchema),
    kind: z.literal("team_roster_profile"),
    question: z.string(),
    rosterIndex: z.number().int().nonnegative(),
  }),
  z.object({
    answer: z.string().nullable(),
    draft: WorkflowDraftSchema,
    kind: z.literal("workflow"),
    options: z.array(
      z.enum([
        "player_lookup",
        "player_comparison",
        "player_recommendation",
        "team_recommendation",
      ])
    ),
    question: z.string(),
  }),
]);

const TurnOutcomeSchema = z.union([
  z.object({
    kind: z.literal("player_lookup"),
    resultJson: z.string(),
    source: z.literal("executed"),
    status: z.enum(["answer_ready", "data_ready"]),
  }),
  z.object({
    kind: z.literal("player_lookup"),
    resultJson: z.string(),
    source: z.literal("saved"),
    status: z.literal("lookup_follow_up"),
  }),
  z.object({
    kind: z.literal("player_lookup"),
    resultJson: z.null(),
    status: z.enum([
      "answer_ready",
      "data_unavailable",
      "identity_data_unavailable",
      "lookup_search_limit",
      "lookup_tool_unavailable",
      "no_confirmed_source_records",
      "saved_result_unavailable",
      "tool_error",
    ]),
  }),
  z.object({
    kind: z.literal("player_comparison"),
    resultJson: z.string(),
    source: z.enum(["executed", "saved"]),
    status: z.enum(["ready", "no_comparable_data"]),
  }),
  z.object({
    kind: z.literal("player_comparison"),
    resultJson: z.string().nullable(),
    status: z.enum([
      "comparison_tool_unavailable",
      "data_unavailable",
      "identity_data_unavailable",
      "insufficient_distinct_players",
      "invalid_task_state",
      "saved_result_unavailable",
      "season_clarification_required",
      "unsupported_constraints",
      "tool_error",
    ]),
  }),
  z.object({
    kind: z.literal("player_recommendation"),
    resultJson: z.string(),
    source: z.enum(["executed", "saved"]),
    status: z.enum(["ready", "no_candidates"]),
  }),
  z.object({
    kind: z.literal("player_recommendation"),
    resultJson: z.string().nullable(),
    status: z.enum([
      "data_unavailable",
      "excluded_profile_missing",
      "identity_data_unavailable",
      "insufficient_reference_data",
      "invalid_constraint",
      "invalid_task_state",
      "position_required",
      "recommendation_tool_unavailable",
      "reference_not_position_capable",
      "reference_profile_ambiguous",
      "reference_profile_missing",
      "reference_required",
      "saved_result_unavailable",
      "unsupported_constraints",
      "unsupported_position",
      "tool_error",
    ]),
  }),
  z.object({
    kind: z.literal("team_recommendation"),
    resultJson: z.string(),
    source: z.enum(["executed", "saved"]),
    status: z.enum(["ready", "no_candidates"]),
  }),
  z.object({
    kind: z.literal("team_recommendation"),
    resultJson: z.string().nullable(),
    status: z.enum([
      "data_unavailable",
      "excluded_profile_missing",
      "identity_data_unavailable",
      "insufficient_reference_data",
      "invalid_constraint",
      "invalid_task_state",
      "one_team_required",
      "position_required",
      "recommendation_tool_unavailable",
      "reference_not_position_capable",
      "reference_profile_ambiguous",
      "reference_profile_missing",
      "reference_required",
      "saved_result_unavailable",
      "team_identity_error",
      "team_not_found",
      "team_position_unavailable",
      "team_provider_error",
      "team_recommendation_tool_unavailable",
      "team_required",
      "team_roster_empty",
      "team_roster_member_unmapped",
      "unsupported_constraints",
      "unsupported_position",
      "tool_error",
    ]),
  }),
]);

const FaultToleranceSchema = z.object({
  apiOperation: z.enum(["team_search", "team_roster"]).nullable(),
  apiRateLimitRetried: z.boolean(),
  apiRequestsUsed: z.number().int().nonnegative(),
  apiRetryAfterMs: z.number().int().nonnegative().nullable(),
  failure: z
    .object({
      category: z.enum(faultCategoryValues),
      node: z.enum([
        "understand_request",
        "lookup_player",
        "answer",
        "resolve_team",
        "resolve_team_roster",
        "fetch_team_roster",
      ]),
    })
    .nullable(),
  lookupLimitReached: z.boolean(),
  lookupSearchExecutions: z.number().int().nonnegative(),
  lookupToolCallIds: z.array(z.string()),
  lookupToolStartedAt: z.number().nullable(),
});

const PlayerMemoryStatusSchema = z.object({
  readFailed: z.boolean(),
  writeFailed: z.boolean(),
});

const createInitialFaultToleranceState = () => ({
  apiOperation: null,
  apiRateLimitRetried: false,
  apiRequestsUsed: 0,
  apiRetryAfterMs: null,
  failure: null,
  lookupLimitReached: false,
  lookupSearchExecutions: 0,
  lookupToolCallIds: [],
  lookupToolStartedAt: null,
});

const createInitialPlayerMemoryStatus = () => ({
  readFailed: false,
  writeFailed: false,
});

const AgentState = MessagesZodState.extend({
  conversationContext: ConversationContextSchema.default(
    createInitialConversationContext
  ),
  faultTolerance: FaultToleranceSchema.default(
    createInitialFaultToleranceState
  ),
  outcome: TurnOutcomeSchema.nullable().default(null),
  pendingClarification: PendingClarificationSchema.nullable().default(null),
  playerMemoryStatus: PlayerMemoryStatusSchema.default(
    createInitialPlayerMemoryStatus
  ),
  request: RequestStateSchema.default(createInitialRequestState),
});

type ActiveComparison = z.infer<typeof ActiveComparisonSchema>;

type ActiveLookup = z.infer<typeof ActiveLookupSchema>;

type ActiveRecommendation = z.infer<typeof ActiveRecommendationSchema>;

type ActiveTeamRecommendation = z.infer<typeof ActiveTeamRecommendationSchema>;

type AgentStateType = z.infer<typeof AgentState>;

type ConversationContext = z.infer<typeof ConversationContextSchema>;

type FaultToleranceState = z.infer<typeof FaultToleranceSchema>;

type PlayerMemoryStatus = z.infer<typeof PlayerMemoryStatusSchema>;

type ConversationPlayerAlias = z.infer<typeof ConversationPlayerAliasSchema>;

type ConversationPlayerReference = z.infer<
  typeof ConversationPlayerReferenceSchema
>;

type ComparisonAction = "replace" | "add" | "refine";

type RequestConstraint = z.infer<typeof RequestConstraintSchema>;

type RequestKind = z.infer<typeof RequestStateSchema>["kind"];

type RequestPlayerState = z.infer<typeof RequestPlayerSchema>;

type TeamRecommendationRequestState = z.infer<
  typeof TeamRecommendationRequestSchema
>;

type RecommendationPlayerRole = z.infer<typeof RecommendationPlayerRoleSchema>;

type RecommendationRequestState = z.infer<typeof RecommendationRequestSchema>;

type RequestState = z.infer<typeof RequestStateSchema>;

type PendingClarification = z.infer<typeof PendingClarificationSchema>;

type WorkflowDraft = z.infer<typeof WorkflowDraftSchema>;

type TurnOutcome = z.infer<typeof TurnOutcomeSchema>;

export {
  ActiveComparisonSchema,
  ActiveLookupSchema,
  ActiveRecommendationSchema,
  ActiveTeamRecommendationSchema,
  AgentState,
  RecommendationPlayerRoleSchema,
  RecommendationRequestSchema,
  TurnOutcomeSchema,
  createInitialRecommendationRequest,
  createInitialConversationContext,
  createInitialFaultToleranceState,
  createInitialPlayerMemoryStatus,
  createInitialRequestState,
  createInitialTeamRecommendationRequest,
};

export type {
  ActiveComparison,
  ActiveLookup,
  ActiveRecommendation,
  ActiveTeamRecommendation,
  AgentStateType,
  ComparisonAction,
  ConversationContext,
  FaultToleranceState,
  ConversationPlayerAlias,
  ConversationPlayerReference,
  PendingClarification,
  PlayerMemoryStatus,
  RecommendationPlayerRole,
  RecommendationRequestState,
  RequestConstraint,
  RequestKind,
  RequestPlayerState,
  RequestState,
  TeamRecommendationRequestState,
  TurnOutcome,
  WorkflowDraft,
};

export type {
  PlayerResolutionState,
  ReferenceCandidate,
  ReferenceLookupResult,
} from "./player-data/contracts.js";
