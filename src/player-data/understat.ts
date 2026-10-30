import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { z } from "zod/v4";

import type { CandidateSourceRecord } from "./contracts.js";
import {
  deduplicateSourceRecords,
  matchReferenceName,
} from "./name-matching.js";
import {
  createLocalDataError,
  isLocalDataFailure,
  numeric,
  parseJson,
  resolveDataPath,
  sourceValueSchema,
  sourceValueToString,
} from "./shared.js";

const understatSnapshotRowSchema = z.object({
  payload_json: z.string(),
  resource_id: z.string(),
  season_start_year: z.number(),
});

const understatPlayerSchema = z.object({
  assists: sourceValueSchema,
  goals: sourceValueSchema,
  id: sourceValueSchema,
  key_passes: sourceValueSchema,
  npxG: sourceValueSchema,
  player_name: z.string().nullish(),
  position: z.string().nullish(),
  shots: sourceValueSchema,
  team_title: z.string().nullish(),
  time: sourceValueSchema,
  xA: sourceValueSchema,
  xG: sourceValueSchema,
});

const understatPayloadSchema = z.object({
  players: z.array(z.unknown()).optional(),
});

const understatSearchRecordSchema = z.object({
  assists: z.number().nullable(),
  competition: z.string(),
  expectedAssists: z.number().nullable(),
  expectedGoals: z.number().nullable(),
  goals: z.number().nullable(),
  keyPasses: z.number().nullable(),
  minutes: z.number().nullable(),
  nonPenaltyExpectedGoals: z.number().nullable(),
  player: z.string(),
  position: z.string(),
  season: z.string(),
  shots: z.number().nullable(),
  source: z.literal("Understat"),
  sourcePlayerId: z.string(),
  team: z.string(),
});

const unavailableSearchResultSchema = z.object({
  reason: z.string(),
  status: z.literal("unavailable"),
});

const understatReadResultSchema = z.discriminatedUnion("status", [
  unavailableSearchResultSchema,
  z.object({
    records: z.array(understatSearchRecordSchema),
    status: z.enum(["found", "not_found"]),
  }),
]);

type UnderstatReadResult = z.output<typeof understatReadResultSchema>;

const understatDatabaseDefaultPath = ".data/understat/understat.sqlite";

const recordsFromSnapshotRow = (
  row: z.output<typeof understatSnapshotRowSchema>,
  selectedIds: Set<string>,
  season: string
): z.output<typeof understatSearchRecordSchema>[] => {
  const payload = parseJson(row.payload_json, understatPayloadSchema);

  return (payload.players ?? []).flatMap((unparsedPlayer) => {
    const player = understatPlayerSchema.parse(unparsedPlayer);
    const sourcePlayerId = sourceValueToString(player.id);

    return selectedIds.has(sourcePlayerId)
      ? [
          {
            assists: numeric(player.assists),
            competition: row.resource_id,
            expectedAssists: numeric(player.xA),
            expectedGoals: numeric(player.xG),
            goals: numeric(player.goals),
            keyPasses: numeric(player.key_passes),
            minutes: numeric(player.time),
            nonPenaltyExpectedGoals: numeric(player.npxG),
            player: player.player_name ?? "",
            position: player.position ?? "",
            season,
            shots: numeric(player.shots),
            source: "Understat" as const,
            sourcePlayerId,
            team: player.team_title ?? "",
          },
        ]
      : [];
  });
};

const readUnderstatBySourceIds = (
  sourceIds: string[],
  seasonStartYear?: number
): UnderstatReadResult => {
  const databasePath = resolveDataPath(
    process.env.TACTISCOUT_UNDERSTAT_DB_PATH,
    understatDatabaseDefaultPath
  );

  if (!existsSync(databasePath)) {
    return { reason: "Understat 本地快照不存在。", status: "unavailable" };
  }

  let database: DatabaseSync;

  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
  } catch (error) {
    if (error instanceof Error && isLocalDataFailure(error)) {
      return { reason: "Understat 本地快照无法打开。", status: "unavailable" };
    }

    throw error;
  }

  try {
    const rows = z.array(understatSnapshotRowSchema).parse(
      database
        .prepare(
          `SELECT resource_id, season_start_year, payload_json
           FROM source_snapshots
           WHERE kind = 'league'
           ORDER BY season_start_year DESC, resource_id`
        )
        .all()
    );

    const selectedIds = new Set(sourceIds);

    let latestYear = seasonStartYear ?? 0;

    if (latestYear === 0) {
      for (const row of rows) {
        latestYear = Math.max(latestYear, row.season_start_year);
      }
    }

    if (latestYear === 0) {
      return {
        reason: "Understat 快照中没有联赛记录。",
        status: "unavailable",
      };
    }

    const season = `${latestYear}/${String(latestYear + 1).slice(-2)}`;

    const records = rows.flatMap((row) =>
      row.season_start_year === latestYear
        ? recordsFromSnapshotRow(row, selectedIds, season)
        : []
    );

    return {
      records: records.toSorted(
        (left, right) =>
          left.competition.localeCompare(right.competition) ||
          (right.minutes ?? 0) - (left.minutes ?? 0)
      ),
      status: records.length > 0 ? "found" : "not_found",
    };
  } catch (error) {
    if (!(error instanceof Error) || !isLocalDataFailure(error)) {
      throw error;
    }

    return {
      reason: "Understat 本地快照包含无法读取的球员资料。",
      status: "unavailable",
    };
  } finally {
    database.close();
  }
};

const readUnderstatReferenceRecords = (
  mention: string
): CandidateSourceRecord[] => {
  const databasePath = resolveDataPath(
    process.env.TACTISCOUT_UNDERSTAT_DB_PATH,
    understatDatabaseDefaultPath
  );

  if (!existsSync(databasePath)) {
    throw createLocalDataError("Understat 本地快照不存在。");
  }

  let database: DatabaseSync;

  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
  } catch (error) {
    if (error instanceof Error && isLocalDataFailure(error)) {
      throw createLocalDataError("Understat 本地快照无法打开。");
    }

    throw error;
  }

  try {
    const rows = z.array(understatSnapshotRowSchema).parse(
      database
        .prepare(
          `SELECT resource_id, season_start_year, payload_json
       FROM source_snapshots
       WHERE kind = 'league'
       ORDER BY season_start_year DESC, resource_id`
        )
        .all()
    );

    let latestYear = 0;

    for (const row of rows) {
      latestYear = Math.max(latestYear, row.season_start_year);
    }

    if (latestYear === 0) {
      return [];
    }

    const records: CandidateSourceRecord[] = [];
    const season = `${latestYear}/${String(latestYear + 1).slice(-2)}`;

    for (const row of rows) {
      if (row.season_start_year !== latestYear) {
        continue;
      }

      const payload = parseJson(row.payload_json, understatPayloadSchema);

      for (const unparsedPlayer of payload.players ?? []) {
        const player = understatPlayerSchema.parse(unparsedPlayer);
        const name = player.player_name ?? "";
        const match = matchReferenceName(mention, [name]);

        if (match.matches) {
          records.push({
            competition: row.resource_id,
            exactNameMatch: match.exact,
            name,
            provider: "understat",
            season,
            sourceId: sourceValueToString(player.id),
            team: player.team_title ?? "",
          });
        }
      }
    }

    return deduplicateSourceRecords(records);
  } catch (error) {
    if (error instanceof Error && isLocalDataFailure(error)) {
      throw createLocalDataError("Understat 本地身份搜索资料无法读取。");
    }

    throw error;
  } finally {
    database.close();
  }
};

export {
  readUnderstatBySourceIds,
  readUnderstatReferenceRecords,
  understatSearchRecordSchema,
  understatReadResultSchema,
};

export type { UnderstatReadResult };
