import { z } from "zod/v4";

export const MemoryOwnerIdSchema = z.string().uuid();

export const RecruitmentPreferenceKeySchema = z.enum(["analysis_focus", "preferred_competition"]);
export type RecruitmentPreferenceKey = z.infer<typeof RecruitmentPreferenceKeySchema>;

export const RecruitmentPreferenceValueSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("analysis_focus"), value: z.enum(["defensive_actions", "progression", "chance_creation", "duels"]) }).strict(),
  z.object({ key: z.literal("preferred_competition"), value: z.enum(["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1"]) }).strict(),
]);

const StoredPreferenceMetadata = {
  confirmedAt: z.string().datetime(),
  source: z.literal("explicit_user_confirmation"),
  appliesWhen: z.string().min(1).max(180),
};

export const RecruitmentPreferenceSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("analysis_focus"), value: z.enum(["defensive_actions", "progression", "chance_creation", "duels"]), ...StoredPreferenceMetadata }).strict(),
  z.object({ key: z.literal("preferred_competition"), value: z.enum(["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1"]), ...StoredPreferenceMetadata }).strict(),
]);
export type RecruitmentPreference = z.infer<typeof RecruitmentPreferenceSchema>;

export const RecruitmentPreferenceWriteSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("analysis_focus"), value: z.enum(["defensive_actions", "progression", "chance_creation", "duels"]), explicitlyApproved: z.literal(true) }).strict(),
  z.object({ key: z.literal("preferred_competition"), value: z.enum(["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1"]), explicitlyApproved: z.literal(true) }).strict(),
]);
export type RecruitmentPreferenceWrite = z.infer<typeof RecruitmentPreferenceWriteSchema>;

export const RecruitmentPreferenceListSchema = z.array(RecruitmentPreferenceSchema).max(2);

export const RecruitmentPreferenceInputErrorSchema = z.object({ error: z.string().min(1) });

export function preferenceNamespace(memoryOwnerId: string): string[] {
  return ["users", MemoryOwnerIdSchema.parse(memoryOwnerId), "preferences"];
}
