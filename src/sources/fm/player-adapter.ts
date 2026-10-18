import { PlayerProfileSchema, type PlayerProfile } from "../../domain/players.js";
import { PlayerAbilityProfileSchema, type PlayerAbilityProfile } from "../../domain/player-abilities.js";
import type { Position } from "../../domain/position-contracts.js";
import { FmPersonalityKeys, type FmPlayerProfile, type FmPositionKey, type FmSnapshotManifest } from "./profile.js";
import { assessFmRole, FmRoleTemplates, type FmRoleId } from "./role-fit.js";

export const FmPositionMapping: Record<FmPositionKey, Position> = {
  gk: "GK", sw: "CB", dl: "LB", dc: "CB", dr: "RB", dm: "DM", ml: "LW", mc: "CM", mr: "RW",
  aml: "LW", amc: "AM", amr: "RW", stc: "ST", wbl: "LWB", wbr: "RWB",
};

function numeric(fields: Record<string, string | null>, key: string): number | null {
  const value = fields[key];
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function displayedRating(fields: Record<string, string | null>, key: string): number | null {
  const value = numeric(fields, key);
  return value !== null && value >= 1 && value <= 20 ? value : null;
}

function overallRating(fields: Record<string, string | null>, key: string): number | null {
  const value = numeric(fields, key);
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 200 ? value : null;
}

export function toAbilityProfile(player: FmPlayerProfile, manifest: FmSnapshotManifest, identityLink: PlayerAbilityProfile["identityLink"]): PlayerAbilityProfile {
  const positions: Partial<Record<Position, number>> = {};
  for (const [key, position] of Object.entries(FmPositionMapping)) {
    const rating = player.positions[key as FmPositionKey];
    if (rating !== null) positions[position] = Math.max(rating, positions[position] ?? 0);
  }
  return PlayerAbilityProfileSchema.parse({
    recordId: player.recordId, uniqueId: player.uniqueId, snapshotId: manifest.sha256, inGameDate: manifest.inGameDate,
    birthDate: player.birthDate, aliases: player.aliases, heightCm: player.heightCm, identityLink,
    positions, attributes: player.attributes,
    leftFoot: displayedRating(player.retainedFields, "left_foot"), rightFoot: displayedRating(player.retainedFields, "right_foot"),
    personality: Object.fromEntries(FmPersonalityKeys.map((key) => [key, displayedRating(player.retainedFields, `personality_${key}`)])),
    traits: (player.retainedFields.traits ?? "").split(";").filter((trait) => trait && trait !== "unknown"),
    currentAbility: overallRating(player.retainedFields, "ability_current"), potentialAbility: overallRating(player.retainedFields, "ability_potential"),
    roles: (Object.keys(FmRoleTemplates) as FmRoleId[]).map((role) => ({ ...assessFmRole(player, role), performanceMetricKeys: [...FmRoleTemplates[role].performance] })),
  });
}

export function ageAtDate(birthDate: string | null, asOf: string): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate), reference = new Date(asOf);
  if (!Number.isFinite(reference.getTime()) || !Number.isFinite(birth.getTime()) || birth > reference) return null;
  let age = reference.getUTCFullYear() - birth.getUTCFullYear();
  if (reference.getUTCMonth() < birth.getUTCMonth() || (reference.getUTCMonth() === birth.getUTCMonth() && reference.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

export function toStandalonePlayer(player: FmPlayerProfile, manifest: FmSnapshotManifest, asOf: string): PlayerProfile {
  const abilityProfile = toAbilityProfile(player, manifest, { method: "source_record", evidence: `snapshot:${manifest.sha256}:${player.recordId}` });
  const position = Object.entries(abilityProfile.positions).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? "UNKNOWN";
  return PlayerProfileSchema.parse({
    playerId: `fm:${manifest.sha256.slice(0, 12)}:${player.recordId}`, name: player.name,
    ...(player.birthDate ? { birthDate: player.birthDate } : {}),
    team: "", age: ageAtDate(player.birthDate, asOf), ageSource: "birth_date", ageVerifiedAt: asOf,
    position, competition: "", season: "", minutes: 0, availableStats: [], stats: {}, eventDataComplete: false,
    source: "fm", abilityProfile,
    sourceIdentity: {
      provider: "fm", playerId: player.uniqueId ?? `snapshot:${manifest.sha256}:${player.recordId}`,
      positionGroups: Object.entries(abilityProfile.positions).filter(([, rating]) => rating! >= 15).map(([position]) => position),
      retrievedAt: manifest.importedAt, sourcePositionLabels: (player.retainedFields.natural_positions ?? "").split(";").filter(Boolean),
    },
  });
}
