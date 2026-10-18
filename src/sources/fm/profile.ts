export const FmAttributeKeys = [
  "crossing", "dribbling", "finishing", "heading", "long_shots", "marking", "off_the_ball",
  "passing", "penalty_taking", "tackling", "vision", "handling", "aerial_reach", "command_of_area",
  "communication", "kicking", "throwing", "anticipation", "decisions", "one_on_ones", "positioning",
  "reflexes", "first_touch", "technique", "flair", "corners", "teamwork", "work_rate", "long_throws",
  "eccentricity", "rushing_out", "punching", "acceleration", "free_kick_taking", "strength", "stamina",
  "pace", "jumping_reach", "leadership", "dirtiness", "balance", "bravery", "consistency", "aggression",
  "agility", "important_matches", "injury_proneness", "versatility", "natural_fitness", "determination",
  "composure", "concentration",
] as const;

export type FmAttributeKey = typeof FmAttributeKeys[number];
export const FmPositionKeys = ["gk", "sw", "dl", "dc", "dr", "dm", "ml", "mc", "mr", "aml", "amc", "amr", "stc", "wbl", "wbr"] as const;
export type FmPositionKey = typeof FmPositionKeys[number];
export const FmPersonalityKeys = ["adaptability", "ambition", "loyalty", "pressure", "professionalism", "sportsmanship", "temperament", "controversy"] as const;

export const FmRetainedFields = [
  "uid", "unique_id", "name", "first_name", "last_name", "common_name", "full_name", "legal_name",
  "birth_date", "nation_id", "second_nation_ids", "home_grown_nation_ids", "home_grown_club_uids",
  "home_grown_club_names", "height_cm", "ability_current", "ability_potential", "ability_potential_range_code",
  "reputation_home", "reputation_current", "reputation_world", "natural_positions", "accomplished_positions",
  ...FmPositionKeys.map((key) => `positions_${key}`),
  ...FmPersonalityKeys.map((key) => `personality_${key}`),
  ...FmAttributeKeys.flatMap((key) => [`attributes_${key}`, `raw_attributes_${key}`]),
  "left_foot", "right_foot", "raw_left_foot", "raw_right_foot", "traits", "traits_code",
] as const;

export interface FmSnapshotManifest {
  schemaVersion: 2;
  sha256: string;
  importedAt: string;
  inGameDate: string;
  gameBuild: string;
  databaseVersion: string;
  parserVersion: string;
  playerCount: number;
  retainedFieldCount: number;
  // The player CSV has no sex field; dataset-owner confirmation is recorded explicitly.
  genderScope: "unverified" | "male_confirmed";
  scopeAttestation: "dataset_owner" | null;
}

export interface FmPlayerProfile {
  recordId: string;
  uniqueId: string | null;
  name: string;
  aliases: string[];
  birthDate: string | null;
  nationId: string | null;
  heightCm: number | null;
  attributes: Record<FmAttributeKey, { raw: number | null; display: number | null }>;
  positions: Record<FmPositionKey, number | null>;
  retainedFields: Record<string, string | null>;
}

export function normalizeFmName(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function rating(value: string | undefined, maximum: number, field: string): number | null {
  if (!value?.trim()) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > maximum) throw new Error(`Invalid FM rating ${field}: ${value}`);
  // Zero denotes unavailable/unset in a 1-based rating scale.
  return number === 0 ? null : number;
}

export function parseFmPlayer(row: Record<string, string>): FmPlayerProfile {
  if (!row.uid?.trim() || !row.name?.trim()) throw new Error("FM player requires uid and name.");
  const attributes = Object.fromEntries(FmAttributeKeys.map((key) => [key, {
    raw: rating(row[`raw_attributes_${key}`], 100, `raw_attributes_${key}`),
    display: rating(row[`attributes_${key}`], 20, `attributes_${key}`),
  }])) as FmPlayerProfile["attributes"];
  const positions = Object.fromEntries(FmPositionKeys.map((key) => [key, rating(row[`positions_${key}`], 20, `positions_${key}`)])) as FmPlayerProfile["positions"];
  const birthDate = row.birth_date?.trim() || null;
  if (birthDate && (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || new Date(birthDate).toISOString().slice(0, 10) !== birthDate)) {
    throw new Error(`Invalid FM birth date: ${birthDate}`);
  }
  return {
    recordId: row.uid.trim(), uniqueId: row.unique_id?.trim() || null, name: row.name.trim(),
    aliases: [...new Set([row.name, row.first_name, row.last_name, row.common_name, row.full_name, row.legal_name].filter((name): name is string => !!name?.trim()).map((name) => name.trim()))],
    birthDate, nationId: row.nation_id?.trim() || null,
    heightCm: rating(row.height_cm, 250, "height_cm"), attributes, positions,
    retainedFields: Object.fromEntries(FmRetainedFields.map((key) => [key, row[key]?.trim() || null])),
  };
}
