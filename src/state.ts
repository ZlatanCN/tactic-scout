import { MessagesZodState } from "@langchain/langgraph";
import { z } from "zod/v3";

import {
  PlayerResolutionSchema,
  ReferenceCandidateSchema,
} from "./player-data/contracts.js";

const RequestKindSchema = z.enum([
  "player_lookup",
  "player_comparison",
  "player_recommendation",
  "team_recommendation",
  "other",
]);

const ComparisonActionSchema = z.enum(["replace", "add"]);

const ConversationPlayerReferenceSchema = z.object({
  candidate: ReferenceCandidateSchema,
  referenceId: z.string(),
});

const ConversationPlayerAliasSchema = z.object({
  mention: z.string(),
  reference: ConversationPlayerReferenceSchema,
});

const RequestConstraintSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const ActiveComparisonSchema = z.object({
  constraints: z.array(RequestConstraintSchema),
  players: z.array(ConversationPlayerReferenceSchema),
});

const createInitialActiveComparison = () => ({
  constraints: [],
  players: [],
});

const ConversationContextSchema = z.object({
  activeComparison: ActiveComparisonSchema.default(
    createInitialActiveComparison
  ),
  focusPlayers: z.array(ConversationPlayerReferenceSchema),
  playerAliases: z.array(ConversationPlayerAliasSchema).default([]),
});

const RequestPlayerSchema = z.object({
  attempts: z.number().int().nonnegative(),
  lookupName: z.string().nullable(),
  mention: z.string(),
  referenceScope: z
    .enum(["explicit", "prior_context", "same_turn", "ambiguous"])
    .default("explicit"),
  referenceTargetMention: z.string().nullable().default(null),
  resolution: PlayerResolutionSchema.nullable(),
});

const RequestStateSchema = z.object({
  activePlayerIndex: z.number().int().nonnegative().nullable(),
  clarificationMessage: z.string().nullable(),
  comparisonAction: ComparisonActionSchema.default("replace"),
  constraints: z.array(RequestConstraintSchema),
  kind: RequestKindSchema,
  players: z.array(RequestPlayerSchema),
  processedMessageId: z.string().nullable(),
  status: z.enum([
    "not_processed",
    "ready",
    "needs_confirmation",
    "clarification_exhausted",
  ]),
  teams: z.array(z.string()),
});

const createInitialRequestState = () => ({
  activePlayerIndex: null,
  clarificationMessage: null,
  comparisonAction: "replace" as const,
  constraints: [],
  kind: "other" as const,
  players: [],
  processedMessageId: null,
  status: "not_processed" as const,
  teams: [],
});

const createInitialConversationContext = () => ({
  activeComparison: createInitialActiveComparison(),
  focusPlayers: [],
  playerAliases: [],
});

const AgentState = MessagesZodState.extend({
  conversationContext: ConversationContextSchema.default(
    createInitialConversationContext
  ),
  request: RequestStateSchema.default(createInitialRequestState),
  requestAnswer: z.string().nullable().default(null),
});

type AgentStateType = z.infer<typeof AgentState>;

type ActiveComparison = z.infer<typeof ActiveComparisonSchema>;

type ConversationContext = z.infer<typeof ConversationContextSchema>;

type ConversationPlayerAlias = z.infer<typeof ConversationPlayerAliasSchema>;

type ConversationPlayerReference = z.infer<
  typeof ConversationPlayerReferenceSchema
>;

type RequestConstraint = z.infer<typeof RequestConstraintSchema>;

type RequestKind = z.infer<typeof RequestKindSchema>;

type ComparisonAction = z.infer<typeof ComparisonActionSchema>;

type RequestPlayerState = z.infer<typeof RequestPlayerSchema>;

type RequestState = z.infer<typeof RequestStateSchema>;

export {
  ActiveComparisonSchema,
  AgentState,
  ComparisonActionSchema,
  createInitialConversationContext,
  createInitialRequestState,
  RequestKindSchema,
};

export type {
  ActiveComparison,
  AgentStateType,
  ConversationContext,
  ConversationPlayerAlias,
  ConversationPlayerReference,
  ComparisonAction,
  RequestConstraint,
  RequestKind,
  RequestPlayerState,
  RequestState,
};

export type {
  PlayerResolutionState,
  ReferenceCandidate,
  ReferenceLookupResult,
} from "./player-data/contracts.js";
