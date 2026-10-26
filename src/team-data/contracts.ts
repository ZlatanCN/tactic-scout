import { z } from "zod/v3";

const TeamIdentitySchema = z.object({
  country: z.string().nullable(),
  id: z.number().int().positive(),
  name: z.string().min(1),
});

const TeamFmProfileCandidateSchema = z.object({
  birthDate: z.string().nullable().optional(),
  currentAbility: z.number().nullable().optional(),
  fmId: z.string().min(1),
  name: z.string().min(1),
  naturalPositions: z.string().nullable().optional(),
  potentialAbility: z.number().nullable().optional(),
});

const TeamRosterMemberSchema = z.object({
  apiFootballPlayerId: z.number().int().positive(),
  fmCandidates: z.array(TeamFmProfileCandidateSchema),
  fmId: z.string().nullable(),
  mappingMethod: z.enum(["reep_bridge", "user_confirmation"]).nullable(),
  mappingStatus: z.enum(["pending", "resolved", "no_profile"]),
  name: z.string().min(1),
  position: z.string().nullable(),
});

const TeamRosterSnapshotSchema = z.object({
  members: z.array(TeamRosterMemberSchema),
  retrievedAt: z.string().datetime(),
  team: TeamIdentitySchema,
});

const TeamRecommendationFiltersSchema = z.object({
  includePotential: z.boolean(),
  maxAge: z.number().int().nullable(),
  minimumCurrentAbility: z.number().int().nullable(),
  minimumPotentialAbility: z.number().int().nullable(),
  resultLimit: z.number().int().nullable(),
});

type TeamFmProfileCandidate = z.infer<typeof TeamFmProfileCandidateSchema>;

type TeamIdentity = z.infer<typeof TeamIdentitySchema>;

type TeamRosterMember = z.infer<typeof TeamRosterMemberSchema>;

type TeamRosterSnapshot = z.infer<typeof TeamRosterSnapshotSchema>;

type TeamRecommendationFilters = z.infer<
  typeof TeamRecommendationFiltersSchema
>;

export {
  TeamFmProfileCandidateSchema,
  TeamIdentitySchema,
  TeamRecommendationFiltersSchema,
  TeamRosterMemberSchema,
  TeamRosterSnapshotSchema,
};

export type {
  TeamFmProfileCandidate,
  TeamIdentity,
  TeamRecommendationFilters,
  TeamRosterMember,
  TeamRosterSnapshot,
};
