import { MessagesZodState } from "@langchain/langgraph";
import { z } from "zod/v3";

const RequestKindSchema = z.enum([
  "player_lookup",
  "player_comparison",
  "player_recommendation",
  "team_recommendation",
  "other",
]);

const ReferenceSourceRecordSchema = z.object({
  provider: z.enum(["understat", "fm"]),
  sourceId: z.string(),
  name: z.string(),
  team: z.string().nullable(),
  competition: z.string().nullable(),
  season: z.string().nullable(),
});

const ReferenceCandidateSchema = z.object({
  candidateId: z.string(),
  name: z.string(),
  canonicalIdentityId: z.string().nullable(),
  identityVerified: z.boolean(),
  exactNameMatch: z.boolean(),
  records: z.array(ReferenceSourceRecordSchema),
});

const PlayerResolutionSchema = z.object({
  status: z.enum([
    "resolved",
    "needs_confirmation",
    "not_found",
    "registry_unavailable",
  ]),
  mention: z.string().nullable(),
  selectedCandidateId: z.string().nullable(),
  canonicalIdentityId: z.string().nullable(),
  selectedName: z.string().nullable(),
  candidates: z.array(ReferenceCandidateSchema),
  candidateCount: z.number().int().nonnegative(),
  candidatesTruncated: z.boolean(),
  clarificationMessage: z.string().nullable(),
});

const ConversationPlayerReferenceSchema = z.object({
  referenceId: z.string(),
  candidate: ReferenceCandidateSchema,
});

const ConversationPlayerAliasSchema = z.object({
  mention: z.string(),
  reference: ConversationPlayerReferenceSchema,
});

const ConversationContextSchema = z.object({
  focusPlayers: z.array(ConversationPlayerReferenceSchema),
  playerAliases: z.array(ConversationPlayerAliasSchema).default([]),
});

const RequestPlayerSchema = z.object({
  mention: z.string(),
  lookupName: z.string().nullable(),
  referenceScope: z.enum([
    "explicit",
    "prior_context",
    "same_turn",
    "ambiguous",
  ]).default("explicit"),
  referenceTargetMention: z.string().nullable().default(null),
  resolution: PlayerResolutionSchema.nullable(),
  attempts: z.number().int().nonnegative(),
});

const RequestConstraintSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const RequestStateSchema = z.object({
  status: z.enum([
    "not_processed",
    "ready",
    "needs_confirmation",
    "clarification_exhausted",
  ]),
  kind: RequestKindSchema,
  players: z.array(RequestPlayerSchema),
  teams: z.array(z.string()),
  constraints: z.array(RequestConstraintSchema),
  processedMessageId: z.string().nullable(),
  activePlayerIndex: z.number().int().nonnegative().nullable(),
  clarificationMessage: z.string().nullable(),
});

const createInitialRequestState = () => ({
  status: "not_processed" as const,
  kind: "other" as const,
  players: [],
  teams: [],
  constraints: [],
  processedMessageId: null,
  activePlayerIndex: null,
  clarificationMessage: null,
});

const createInitialConversationContext = () => ({
  focusPlayers: [],
  playerAliases: [],
});

const AgentState = MessagesZodState.extend({
  request: RequestStateSchema.default(createInitialRequestState),
  requestAnswer: z.string().nullable().default(null),
  conversationContext: ConversationContextSchema.default(createInitialConversationContext),
});

type AgentStateType = z.infer<typeof AgentState>;
type ConversationContext = z.infer<typeof ConversationContextSchema>;
type ConversationPlayerAlias = z.infer<typeof ConversationPlayerAliasSchema>;
type ConversationPlayerReference = z.infer<typeof ConversationPlayerReferenceSchema>;
type PlayerResolutionState = z.infer<typeof PlayerResolutionSchema>;
type ReferenceCandidate = z.infer<typeof ReferenceCandidateSchema>;
type RequestConstraint = z.infer<typeof RequestConstraintSchema>;
type RequestKind = z.infer<typeof RequestKindSchema>;
type RequestPlayerState = z.infer<typeof RequestPlayerSchema>;
type RequestState = z.infer<typeof RequestStateSchema>;
type ReferenceLookupResult = Pick<
  PlayerResolutionState,
  | "status"
  | "mention"
  | "selectedCandidateId"
  | "canonicalIdentityId"
  | "selectedName"
  | "candidates"
  | "candidateCount"
  | "candidatesTruncated"
  | "clarificationMessage"
>;

export {
  AgentState,
  RequestKindSchema,
  createInitialConversationContext,
  createInitialRequestState,
};
export type {
  AgentStateType,
  ConversationContext,
  ConversationPlayerAlias,
  ConversationPlayerReference,
  PlayerResolutionState,
  ReferenceCandidate,
  ReferenceLookupResult,
  RequestConstraint,
  RequestKind,
  RequestPlayerState,
  RequestState,
};
