import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

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

const readUnderstat = (
  input: PlayerSearchQuery,
  normalizedName: string
): UnderstatReadResult => {
  const databasePath = resolveDataPath(
    process.env.TACTISCOUT_UNDERSTAT_DB_PATH,
    ".data/understat/understat.sqlite"
  );

  if (!existsSync(databasePath)) {
    return { reason: "Understat 本地快照不存在。", status: "unavailable" };
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });

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

    let latestYear = input.seasonStartYear ?? 0;

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

    const records: z.output<typeof understatSearchRecordSchema>[] = [];
    const season = `${latestYear}/${String(latestYear + 1).slice(-2)}`;

    for (const row of rows) {
      if (row.season_start_year !== latestYear) {
        continue;
      }

      const payload = parseJson(row.payload_json, understatPayloadSchema);

      for (const unparsedPlayer of payload.players ?? []) {
        const result = understatPlayerSchema.safeParse(unparsedPlayer);

        if (result.success) {
          const player = result.data;
          const playerName = player.player_name ?? "";

          if (normalizePlayerName(playerName).includes(normalizedName)) {
            records.push({
              assists: numeric(player.assists),
              competition: row.resource_id,
              expectedAssists: numeric(player.xA),
              expectedGoals: numeric(player.xG),
              goals: numeric(player.goals),
              keyPasses: numeric(player.key_passes),
              minutes: numeric(player.time),
              nonPenaltyExpectedGoals: numeric(player.npxG),
              player: playerName,
              position: player.position ?? "",
              season,
              shots: numeric(player.shots),
              source: "Understat",
              sourcePlayerId: sourceValueToString(player.id),
              team: player.team_title ?? "",
            });
          }
        }
      }
    }

    const limitedRecords = records
      .toSorted((left, right) => (right.minutes ?? 0) - (left.minutes ?? 0))
      .slice(0, input.limit);

    return {
      records: limitedRecords,
      status: limitedRecords.length > 0 ? "found" : "not_found",
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
    ".data/understat/understat.sqlite"
  );

  if (!existsSync(databasePath)) {
    return [];
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });

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
        const result = understatPlayerSchema.safeParse(unparsedPlayer);

        if (result.success) {
          const player = result.data;
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
    }

    return deduplicateSourceRecords(records);
  } finally {
    database.close();
  }
};

export { readUnderstat, readUnderstatReferenceRecords };

export type { UnderstatReadResult };
