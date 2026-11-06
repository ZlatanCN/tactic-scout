import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync } from "node:zlib";

import { z } from "zod/v4";

import type { CandidateSourceRecord } from "./contracts.js";
import {
  deduplicateSourceRecords,
  matchReferenceName,
  tokenSearchPatterns,
  tokenizePlayerName,
} from "./name-matching.js";
import {
  getPositionFeatureDefinition,
  isSupportedPosition,
} from "./position-features.js";
import type { SupportedPosition } from "./position-features.js";
import {
  createLocalDataError,
  isLocalDataFailure,
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
    records: z.array(fmSearchRecordSchema).min(1),
    status: z.literal("found"),
  }),
  z.object({
    records: z.array(fmSearchRecordSchema).length(0),
    status: z.literal("not_found"),
  }),
]);

type FmReadResult = z.output<typeof fmReadResultSchema>;

type FmProfile = z.output<typeof fmProfileSchema>;

const fmProfilesDefaultPath = ".data/fm/profiles-v2.sqlite";
const fmDatabaseMissingMessage = "FM 本地画像快照不存在。";
const fmDatabaseOpenErrorMessage = "FM 本地画像快照无法打开。";

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

const fmRecommendationProfileRowSchema = z.object({
  birth_date: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  payload: z.instanceof(Uint8Array),
  position_rating: z.number().nullable(),
  record_id: z.string(),
  unique_id: z.string().nullable(),
});

const fmRecommendationProfileSchema = z.looseObject({
  ability_current: sourceValueSchema,
  ability_potential: sourceValueSchema,
  birth_date: z.string().nullish(),
  common_name: z.string().nullish(),
  full_name: z.string().nullish(),
  name: z.string().nullish(),
  natural_positions: z.string().nullish(),
  unique_id: sourceValueSchema,
});

type FmRecommendationProfile = {
  attributes: Record<string, number | null>;
  birthDate: string | null;
  currentAbility: number | null;
  fmId: string;
  name: string;
  naturalPositions: string | null;
  positionRating: number | null;
  potentialAbility: number | null;
  sourceRecordId: string;
};

type FmRecommendationReadResult =
  | {
      excludedMissingFmIdCandidates: number;
      gameBuild: string;
      manifestSha256: string;
      position: SupportedPosition;
      profiles: FmRecommendationProfile[];
      references: FmRecommendationProfile[];
      snapshotDate: string;
      status: "ready";
    }
  | {
      position: string;
      reason: string;
      status: "unsupported_position";
    }
  | {
      reason: string;
      status: "unavailable";
    };

type FmRecommendationReferenceMetadata = {
  fmId: string;
  name: string;
  naturalPositions: string | null;
  sourceRecordId: string;
};

type FmRecommendationReferenceMetadataResult =
  | {
      manifestSha256: string;
      missingReferenceFmIds: string[];
      profiles: FmRecommendationReferenceMetadata[];
      snapshotDate: string;
      status: "ready";
    }
  | {
      reason: string;
      status: "unavailable";
    };

const fmRecommendationReferenceMetadataSchema = z.looseObject({
  common_name: z.string().nullish(),
  full_name: z.string().nullish(),
  name: z.string().nullish(),
  natural_positions: z.string().nullish(),
  unique_id: sourceValueSchema,
});

const readFmRecommendationReferenceMetadata = (
  referenceFmIds: string[]
): FmRecommendationReferenceMetadataResult => {
  const databasePath = resolveDataPath(
    process.env.TACTISCOUT_FM_PROFILES_PATH,
    fmProfilesDefaultPath
  );

  if (!existsSync(databasePath)) {
    return { reason: fmDatabaseMissingMessage, status: "unavailable" };
  }

  let database: DatabaseSync;

  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
  } catch (error) {
    if (error instanceof Error && isLocalDataFailure(error)) {
      return { reason: fmDatabaseOpenErrorMessage, status: "unavailable" };
    }

    throw error;
  }

  try {
    const manifestPayload = parseJson(
      String(
        database.prepare("SELECT payload FROM manifest WHERE id = 1").get()
          ?.payload ?? ""
      ),
      z.object({
        inGameDate: z.string(),
        sha256: z.string(),
      })
    );

    const profiles: FmRecommendationReferenceMetadata[] = [];
    const missingReferenceFmIds: string[] = [];

    const query = database.prepare(
      `SELECT birth_date, name, payload, record_id, unique_id
       FROM players WHERE unique_id = ? ORDER BY record_id LIMIT 1`
    );

    for (const fmId of new Set(referenceFmIds)) {
      const row = fmRecommendationProfileRowSchema
        .omit({ position_rating: true })
        .nullable()
        .optional()
        .parse(query.get(fmId));

      if (row === null || row === undefined) {
        missingReferenceFmIds.push(fmId);
      } else {
        const profile = parseJson(
          inflateRawSync(row.payload).toString("utf-8"),
          fmRecommendationReferenceMetadataSchema
        );

        const fmIdFromProfile = sourceValueToString(
          profile.unique_id,
          row.unique_id ?? ""
        );

        if (fmIdFromProfile.length === 0) {
          missingReferenceFmIds.push(fmId);
        } else {
          profiles.push({
            fmId: fmIdFromProfile,
            name: firstNonEmptyString(
              profile.common_name,
              profile.full_name,
              profile.name,
              row.name
            ),
            naturalPositions: nullableString(profile.natural_positions),
            sourceRecordId: row.record_id,
          });
        }
      }
    }

    return {
      manifestSha256: manifestPayload.sha256,
      missingReferenceFmIds,
      profiles,
      snapshotDate: manifestPayload.inGameDate,
      status: "ready",
    };
  } catch (error) {
    if (error instanceof Error && isLocalDataFailure(error)) {
      return { reason: "FM 本地身份位置资料无法读取。", status: "unavailable" };
    }

    throw error;
  } finally {
    database.close();
  }
};

const recommendationProfileFromRow = (
  row: z.output<typeof fmRecommendationProfileRowSchema>,
  position: SupportedPosition
): FmRecommendationProfile => {
  const profile = parseJson(
    inflateRawSync(row.payload).toString("utf-8"),
    fmRecommendationProfileSchema
  );

  const definition = getPositionFeatureDefinition(position);

  const attributes = Object.fromEntries(
    definition.features.map((feature) => [
      feature,
      numeric(sourceValueSchema.parse(profile[`raw_attributes_${feature}`])),
    ])
  );

  return {
    attributes,
    birthDate: nullableString(profile.birth_date ?? row.birth_date),
    currentAbility: numeric(profile.ability_current),
    fmId: sourceValueToString(profile.unique_id, row.unique_id ?? ""),
    name: firstNonEmptyString(
      profile.common_name,
      profile.full_name,
      profile.name,
      row.name
    ),
    naturalPositions: nullableString(profile.natural_positions),
    positionRating: row.position_rating,
    potentialAbility: numeric(profile.ability_potential),
    sourceRecordId: row.record_id,
  };
};

const readFmRecommendationProfiles = (
  position: string,
  referenceFmIds: string[]
): FmRecommendationReadResult => {
  if (!isSupportedPosition(position)) {
    return {
      position,
      reason: "该位置当前没有经过公式实验验证的 FM 属性映射。",
      status: "unsupported_position",
    };
  }

  const databasePath = resolveDataPath(
    process.env.TACTISCOUT_FM_PROFILES_PATH,
    fmProfilesDefaultPath
  );

  if (!existsSync(databasePath)) {
    return { reason: fmDatabaseMissingMessage, status: "unavailable" };
  }

  let database: DatabaseSync;

  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
  } catch (error) {
    if (error instanceof Error && isLocalDataFailure(error)) {
      return { reason: fmDatabaseOpenErrorMessage, status: "unavailable" };
    }

    throw error;
  }

  try {
    const manifestPayload = parseJson(
      String(
        database.prepare("SELECT payload FROM manifest WHERE id = 1").get()
          ?.payload ?? ""
      ),
      z.object({
        gameBuild: z.string(),
        inGameDate: z.string(),
        sha256: z.string(),
      })
    );

    const candidateRows = z.array(fmRecommendationProfileRowSchema).parse(
      database
        .prepare(
          `SELECT p.birth_date, p.name, p.payload, p.record_id,
                  p.unique_id, s.rating AS position_rating
           FROM positions s
           JOIN players p ON p.record_id = s.record_id
           WHERE s.position = ? AND s.rating >= 15
           ORDER BY p.unique_id, p.record_id`
        )
        .all(position)
    );

    const excludedMissingFmIdCandidates = z
      .number()
      .int()
      .nonnegative()
      .parse(
        database
          .prepare(
            `SELECT COUNT(*) AS count
           FROM positions s
           JOIN players p ON p.record_id = s.record_id
           WHERE s.position = ? AND s.rating >= 15
             AND (p.unique_id IS NULL OR p.unique_id = '')`
          )
          .get(position)?.count
      );

    const references = referenceFmIds.flatMap((fmId) => {
      const row = fmRecommendationProfileRowSchema
        .nullable()
        .optional()
        .parse(
          database
            .prepare(
              `SELECT p.birth_date, p.name, p.payload, p.record_id,
                    p.unique_id, s.rating AS position_rating
             FROM players p
             LEFT JOIN positions s
               ON s.record_id = p.record_id AND s.position = ?
             WHERE p.unique_id = ?
             ORDER BY p.record_id
             LIMIT 1`
            )
            .get(position, fmId)
        );

      return row === null || row === undefined
        ? []
        : [recommendationProfileFromRow(row, position)];
    });

    return {
      excludedMissingFmIdCandidates,
      gameBuild: manifestPayload.gameBuild,
      manifestSha256: manifestPayload.sha256,
      position,
      profiles: candidateRows.flatMap((row) =>
        row.unique_id === null || row.unique_id.length === 0
          ? []
          : [recommendationProfileFromRow(row, position)]
      ),
      references,
      snapshotDate: manifestPayload.inGameDate,
      status: "ready",
    };
  } catch (error) {
    if (!(error instanceof Error) || !isLocalDataFailure(error)) {
      throw error;
    }

    return {
      reason: "FM 本地画像快照包含无法读取的推荐字段。",
      status: "unavailable",
    };
  } finally {
    database.close();
  }
};

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

const readFmProfilesBySourceIds = (sourceIds: string[]): FmReadResult => {
  const databasePath = resolveDataPath(
    process.env.TACTISCOUT_FM_PROFILES_PATH,
    fmProfilesDefaultPath
  );

  if (!existsSync(databasePath)) {
    return { reason: fmDatabaseMissingMessage, status: "unavailable" };
  }

  let database: DatabaseSync;

  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
  } catch (error) {
    if (error instanceof Error && isLocalDataFailure(error)) {
      return { reason: fmDatabaseOpenErrorMessage, status: "unavailable" };
    }

    throw error;
  }

  try {
    const queryByUniqueId = database.prepare(
      "SELECT p.record_id, p.payload FROM players p WHERE p.unique_id = ? ORDER BY p.record_id"
    );

    const queryByRecordId = database.prepare(
      "SELECT p.record_id, p.payload FROM players p WHERE p.record_id = ? ORDER BY p.record_id"
    );

    const records = [...new Set(sourceIds)].flatMap((sourceId) => {
      const uniqueIdRows = z
        .array(fmProfileRowSchema)
        .parse(queryByUniqueId.all(sourceId));

      const rows =
        uniqueIdRows.length > 0
          ? uniqueIdRows
          : z.array(fmProfileRowSchema).parse(queryByRecordId.all(sourceId));

      return rows.map(({ record_id: recordId, payload }) => {
        const profile = parseJson(
          inflateRawSync(payload).toString("utf-8"),
          fmProfileSchema
        );

        return {
          attributes: selectedAttributes(profile),
          birthDate: nullableString(profile.birth_date),
          currentAbility: numeric(profile.ability_current),
          heightCm: numeric(profile.height_cm),
          identitySourceId: sourceValueToString(profile.unique_id, recordId),
          naturalPositions: nullableString(profile.natural_positions),
          player: firstNonEmptyString(
            profile.common_name,
            profile.full_name,
            profile.name
          ),
          potentialAbility: numeric(profile.ability_potential),
          source: "Football Manager" as const,
          sourceRecordId: recordId,
        };
      });
    });

    return { records, status: records.length > 0 ? "found" : "not_found" };
  } catch (error) {
    if (!(error instanceof Error) || !isLocalDataFailure(error)) {
      throw error;
    }

    return {
      reason: "FM 本地画像快照包含无法读取的球员资料。",
      status: "unavailable",
    };
  } finally {
    database.close();
  }
};

const readFmReferenceRecords = (mention: string): CandidateSourceRecord[] => {
  const databasePath = resolveDataPath(
    process.env.TACTISCOUT_FM_PROFILES_PATH,
    fmProfilesDefaultPath
  );

  if (!existsSync(databasePath)) {
    throw createLocalDataError(fmDatabaseMissingMessage);
  }

  let database: DatabaseSync;

  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
  } catch (error) {
    if (error instanceof Error && isLocalDataFailure(error)) {
      throw createLocalDataError(fmDatabaseOpenErrorMessage);
    }

    throw error;
  }

  try {
    const nameTokens = tokenizePlayerName(mention);

    if (nameTokens.length === 0) {
      return [];
    }

    const patternsByToken = nameTokens.map(tokenSearchPatterns);

    const namePredicates = patternsByToken
      .map(
        (patterns) =>
          `(${patterns.map(() => "(LOWER(a.name) LIKE ? OR LOWER(p.name) LIKE ?)").join(" OR ")})`
      )
      .join(" AND ");

    const namePatterns = patternsByToken.flatMap((patterns) =>
      patterns.flatMap((pattern) => [`%${pattern}%`, `%${pattern}%`])
    );

    const rows = z.array(fmProfileRowSchema).parse(
      database
        .prepare(
          `SELECT DISTINCT p.record_id, p.payload, a.name AS alias_name
       FROM players p
       LEFT JOIN aliases a ON a.record_id = p.record_id
       WHERE ${namePredicates}
       ORDER BY p.name
       LIMIT 1000`
        )
        .all(...namePatterns)
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
  } catch (error) {
    if (error instanceof Error && isLocalDataFailure(error)) {
      throw createLocalDataError("FM 本地身份搜索资料无法读取。");
    }

    throw error;
  } finally {
    database.close();
  }
};

export {
  fmReadResultSchema,
  readFmProfilesBySourceIds,
  readFmRecommendationProfiles,
  readFmRecommendationReferenceMetadata,
  readFmReferenceRecords,
};

export type {
  FmReadResult,
  FmRecommendationProfile,
  FmRecommendationReadResult,
  FmRecommendationReferenceMetadata,
  FmRecommendationReferenceMetadataResult,
};
