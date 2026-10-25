import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync } from "node:zlib";

import { z } from "zod/v4";

import type { CandidateSourceRecord, PlayerSearchQuery } from "./contracts.js";
import {
  deduplicateSourceRecords,
  matchReferenceName,
} from "./name-matching.js";
import {
  normalizePlayerName,
  numeric,
  parseJson,
  resolveDataPath,
  sourceValueSchema,
  sourceValueToString,
} from "./shared.js";

const fmProfileRowSchema = z.object({
  alias_name: z.string().nullable().optional(),
  payload: z.instanceof(Uint8Array),
  record_id: z.string(),
});

const unavailableSearchResultSchema = z.object({
  reason: z.string(),
  status: z.literal("unavailable"),
});

const fmProfileSchema = z.object({
  ability_current: sourceValueSchema,
  ability_potential: sourceValueSchema,
  birth_date: z.string().nullish(),
  common_name: z.string().nullish(),
  full_name: z.string().nullish(),
  height_cm: sourceValueSchema,
  name: z.string().nullish(),
  natural_positions: z.string().nullish(),
  raw_attributes_acceleration: sourceValueSchema,
  raw_attributes_decisions: sourceValueSchema,
  raw_attributes_finishing: sourceValueSchema,
  raw_attributes_first_touch: sourceValueSchema,
  raw_attributes_off_the_ball: sourceValueSchema,
  raw_attributes_pace: sourceValueSchema,
  raw_attributes_passing: sourceValueSchema,
  raw_attributes_strength: sourceValueSchema,
  raw_attributes_technique: sourceValueSchema,
  raw_attributes_vision: sourceValueSchema,
  unique_id: sourceValueSchema,
});

const fmAttributeSchema = z.object({
  accelerationRaw: z.number().nullable(),
  decisionsRaw: z.number().nullable(),
  finishingRaw: z.number().nullable(),
  first_touchRaw: z.number().nullable(),
  off_the_ballRaw: z.number().nullable(),
  paceRaw: z.number().nullable(),
  passingRaw: z.number().nullable(),
  strengthRaw: z.number().nullable(),
  techniqueRaw: z.number().nullable(),
  visionRaw: z.number().nullable(),
});

const fmSearchRecordSchema = z.object({
  attributes: fmAttributeSchema,
  birthDate: z.string().nullable(),
  currentAbility: z.number().nullable(),
  heightCm: z.number().nullable(),
  identitySourceId: z.string(),
  naturalPositions: z.string().nullable(),
  player: z.string(),
  potentialAbility: z.number().nullable(),
  source: z.literal("Football Manager"),
  sourceRecordId: z.string(),
});

const fmReadResultSchema = z.discriminatedUnion("status", [
  unavailableSearchResultSchema,
  z.object({
    records: z.array(fmSearchRecordSchema),
    status: z.enum(["found", "not_found"]),
  }),
]);

type FmReadResult = z.output<typeof fmReadResultSchema>;

type FmProfile = z.output<typeof fmProfileSchema>;

const selectedAttributes = (profile: FmProfile) => ({
  accelerationRaw: numeric(profile.raw_attributes_acceleration),
  decisionsRaw: numeric(profile.raw_attributes_decisions),
  finishingRaw: numeric(profile.raw_attributes_finishing),
  first_touchRaw: numeric(profile.raw_attributes_first_touch),
  off_the_ballRaw: numeric(profile.raw_attributes_off_the_ball),
  paceRaw: numeric(profile.raw_attributes_pace),
  passingRaw: numeric(profile.raw_attributes_passing),
  strengthRaw: numeric(profile.raw_attributes_strength),
  techniqueRaw: numeric(profile.raw_attributes_technique),
  visionRaw: numeric(profile.raw_attributes_vision),
});

const nullableString = (value: string | null | undefined): string | null =>
  value !== null && value !== undefined && value.length > 0 ? value : null;

const firstNonEmptyString = (
  ...values: (string | null | undefined)[]
): string => {
  for (const value of values) {
    if (value !== null && value !== undefined && value.length > 0) {
      return value;
    }
  }

  return "";
};

const readFmProfiles = (
  input: PlayerSearchQuery,
  normalizedName: string
): FmReadResult => {
  const databasePath = resolveDataPath(
    process.env.TACTISCOUT_FM_PROFILES_PATH,
    ".data/fm/profiles-v2.sqlite"
  );

  if (!existsSync(databasePath)) {
    return { reason: "FM 本地画像快照不存在。", status: "unavailable" };
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });

  try {
    const pattern = `%${normalizedName}%`;

    const rows = z.array(fmProfileRowSchema).parse(
      database
        .prepare(
          `SELECT DISTINCT p.record_id, p.payload
       FROM players p
       LEFT JOIN aliases a ON a.record_id = p.record_id
       WHERE a.name LIKE ? OR LOWER(p.name) LIKE ?
       ORDER BY p.name
       LIMIT ?`
        )
        .all(pattern, `%${input.playerName.toLocaleLowerCase()}%`, input.limit)
    );

    const source = "Football Manager" as const;

    const records = rows.map(({ record_id, payload }) => {
      const profile = parseJson(
        inflateRawSync(payload).toString("utf-8"),
        fmProfileSchema
      );

      return {
        attributes: selectedAttributes(profile),
        birthDate: nullableString(profile.birth_date),
        currentAbility: numeric(profile.ability_current),
        heightCm: numeric(profile.height_cm),
        identitySourceId: sourceValueToString(profile.unique_id, record_id),
        naturalPositions: nullableString(profile.natural_positions),
        player: firstNonEmptyString(
          profile.common_name,
          profile.full_name,
          profile.name
        ),
        potentialAbility: numeric(profile.ability_potential),
        source,
        sourceRecordId: record_id,
      };
    });

    return { records, status: records.length > 0 ? "found" : "not_found" };
  } finally {
    database.close();
  }
};

const readFmReferenceRecords = (mention: string): CandidateSourceRecord[] => {
  const databasePath = resolveDataPath(
    process.env.TACTISCOUT_FM_PROFILES_PATH,
    ".data/fm/profiles-v2.sqlite"
  );

  if (!existsSync(databasePath)) {
    return [];
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });

  try {
    const pattern = `%${normalizePlayerName(mention)}%`;

    const rows = z.array(fmProfileRowSchema).parse(
      database
        .prepare(
          `SELECT DISTINCT p.record_id, p.payload, a.name AS alias_name
       FROM players p
       LEFT JOIN aliases a ON a.record_id = p.record_id
       WHERE a.name LIKE ? OR LOWER(p.name) LIKE ?
       ORDER BY p.name
       LIMIT 1000`
        )
        .all(pattern, `%${mention.toLocaleLowerCase()}%`)
    );

    const records: CandidateSourceRecord[] = [];

    for (const { record_id, payload, alias_name } of rows) {
      const profile = parseJson(
        inflateRawSync(payload).toString("utf-8"),
        fmProfileSchema
      );

      const name = firstNonEmptyString(
        profile.common_name,
        profile.full_name,
        profile.name
      );

      const names = [name, nullableString(alias_name) ?? ""];
      const match = matchReferenceName(mention, names);

      if (!match.matches) {
        continue;
      }

      records.push({
        competition: null,
        exactNameMatch: match.exact,
        name,
        provider: "fm",
        season: null,
        sourceId: sourceValueToString(profile.unique_id, record_id),
        team: null,
      });
    }

    return deduplicateSourceRecords(records);
  } finally {
    database.close();
  }
};

export { fmReadResultSchema, readFmProfiles, readFmReferenceRecords };

export type { FmReadResult };
