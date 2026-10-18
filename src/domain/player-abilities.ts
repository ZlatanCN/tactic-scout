import { z } from "zod/v4";
import { PositionSchema } from "./position-contracts.js";

export const AbilityMetricDefinitions = [
  { key: "abilityLinkForward", role: "link_forward", label: "接应做球" },
  { key: "abilityFinishing", role: "finisher", label: "禁区终结" },
  { key: "abilityWideForward", role: "wide_forward", label: "边路攻击" },
  { key: "abilityPlaymaking", role: "playmaker", label: "组织创造" },
  { key: "abilityCarrying", role: "ball_carrier", label: "持球推进" },
  { key: "abilityHolding", role: "holding_midfielder", label: "中场防守" },
  { key: "abilityBallPlayingDefender", role: "ball_playing_defender", label: "防守与出球" },
  { key: "abilityFullback", role: "overlapping_fullback", label: "边路往返" },
  { key: "abilityGoalkeeping", role: "goalkeeper", label: "门线保护" },
  { key: "abilitySweeperKeeper", role: "sweeper_keeper", label: "出击与出球" },
] as const;

export const AbilityMetricKeySchema = z.enum([
  "abilityLinkForward", "abilityFinishing", "abilityWideForward", "abilityPlaymaking", "abilityCarrying",
  "abilityHolding", "abilityBallPlayingDefender", "abilityFullback", "abilityGoalkeeping", "abilitySweeperKeeper",
]);

export const PlayerAbilityProfileSchema = z.object({
  recordId: z.string().min(1),
  uniqueId: z.string().nullable(),
  snapshotId: z.string().min(1),
  inGameDate: z.string(),
  birthDate: z.string().nullable(),
  aliases: z.array(z.string()),
  heightCm: z.number().nullable(),
  identityLink: z.object({
    method: z.enum(["source_record", "verified_bridge", "name_birthdate"]),
    evidence: z.string().min(1),
  }),
  positions: z.partialRecord(PositionSchema, z.number().min(1).max(20)),
  attributes: z.record(z.string(), z.object({ raw: z.number().min(1).max(100).nullable(), display: z.number().min(1).max(20).nullable() })),
  leftFoot: z.number().min(1).max(20).nullable(),
  rightFoot: z.number().min(1).max(20).nullable(),
  personality: z.record(z.string(), z.number().min(1).max(20).nullable()),
  traits: z.array(z.string()),
  currentAbility: z.number().int().min(1).max(200).nullable(),
  potentialAbility: z.number().int().min(1).max(200).nullable(),
  roles: z.array(z.object({
    role: z.string(), label: z.string(), positionRating: z.number().nullable(), positionCompatible: z.boolean(),
    fit: z.number().min(0).max(100).nullable(), attributeCoverage: z.number().min(0).max(1),
    searchPriority: z.number().min(0).max(100),
    performanceMetricKeys: z.array(z.string()).default([]),
    attributes: z.array(z.object({ key: z.string(), value: z.number().nullable(), displayValue: z.number().nullable() })),
  })),
});

export type PlayerAbilityProfile = z.infer<typeof PlayerAbilityProfileSchema>;

export const CandidateRoleFitSchema = z.object({
  role: z.string(), label: z.string(),
  abilityFit: z.number().min(0).max(100).nullable(),
  performanceFit: z.number().min(0).max(100).nullable(),
  combinedFit: z.number().min(0).max(100).nullable(),
  searchPriority: z.number().min(0).max(100).nullable(),
  evidenceCoverage: z.number().min(0).max(1),
});
export type CandidateRoleFit = z.infer<typeof CandidateRoleFitSchema>;

export function abilityMetricValue(profile: PlayerAbilityProfile | undefined, key: string): number | undefined {
  const definition = AbilityMetricDefinitions.find((definition) => definition.key === key);
  if (!definition || !profile) return undefined;
  const assessment = profile.roles.find((assessment) => assessment.role === definition.role && assessment.positionCompatible);
  return assessment?.fit ?? undefined;
}
