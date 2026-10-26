import { MessagesZodState } from "@langchain/langgraph";
import { z } from "zod/v3";

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
  activeComparison: { constraints: [], players: [] },
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
    comparisonAction: z.enum(["replace", "add"]),
    kind: z.literal("player_comparison"),
  }),
  z.object({
    ...requestFields,
    kind: z.literal("player_recommendation"),
    recommendation: RecommendationRequestSchema,
  }),
  z.object({
    ...requestFields,
    kind: z.literal("team_recommendation"),
    teamRecommendation: TeamRecommendationRequestSchema,
  }),
  z.object({ ...requestFields, kind: z.literal("other") }),
]);

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
]);

const TurnOutcomeSchema = z.object({
  kind: z.enum([
    "player_lookup",
    "player_comparison",
    "player_recommendation",
    "team_recommendation",
  ]),
  resultJson: z.string().nullable(),
  status: z.string(),
});

const FaultToleranceSchema = z.object({
  apiOperation: z.enum(["team_search", "team_roster"]).nullable(),
  apiRateLimitRetried: z.boolean(),
  apiRequestsUsed: z.number().int().nonnegative(),
  apiRetryAfterMs: z.number().int().nonnegative().nullable(),
  failure: z
    .object({
      category: z.enum([
        "network",
        "server",
        "timeout",
        "rate_limit",
        "quota",
        "authentication",
        "configuration",
        "invalid_response",
        "attempt_limit",
      ]),
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
  request: RequestStateSchema.default(createInitialRequestState),
});

type ActiveComparison = z.infer<typeof ActiveComparisonSchema>;

type ActiveLookup = z.infer<typeof ActiveLookupSchema>;

type ActiveRecommendation = z.infer<typeof ActiveRecommendationSchema>;

type ActiveTeamRecommendation = z.infer<typeof ActiveTeamRecommendationSchema>;

type AgentStateType = z.infer<typeof AgentState>;

type ConversationContext = z.infer<typeof ConversationContextSchema>;

type FaultToleranceState = z.infer<typeof FaultToleranceSchema>;

type ConversationPlayerAlias = z.infer<typeof ConversationPlayerAliasSchema>;

type ConversationPlayerReference = z.infer<
  typeof ConversationPlayerReferenceSchema
>;

type ComparisonAction = "replace" | "add";

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

type TurnOutcome = z.infer<typeof TurnOutcomeSchema>;

export {
  ActiveComparisonSchema,
  ActiveLookupSchema,
  ActiveRecommendationSchema,
  ActiveTeamRecommendationSchema,
  AgentState,
  RecommendationPlayerRoleSchema,
  RecommendationRequestSchema,
  createInitialRecommendationRequest,
  createInitialConversationContext,
  createInitialFaultToleranceState,
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
  RecommendationPlayerRole,
  RecommendationRequestState,
  RequestConstraint,
  RequestKind,
  RequestPlayerState,
  RequestState,
  TeamRecommendationRequestState,
  TurnOutcome,
};

export type {
  PlayerResolutionState,
  ReferenceCandidate,
  ReferenceLookupResult,
} from "./player-data/contracts.js";
