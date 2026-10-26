import { z } from "zod/v4";

import type { PlayerSearchQuery } from "./contracts.js";
import type { FmReadResult } from "./football-manager.js";
import { fmReadResultSchema } from "./football-manager.js";
import type { PlayerSearch as SearchPlayer } from "./search-records.js";
import type { UnderstatReadResult } from "./understat.js";
import { understatReadResultSchema } from "./understat.js";

const comparisonSourceRecordSchema = z.object({
  provider: z.enum(["understat", "fm"]),
  sourceId: z.string(),
});

const comparisonPlayerSchema = z.object({
  canonicalIdentityId: z.string().nullable(),
  identityBasis: z
    .enum([
      "reep_registry",
      "source_record",
      "source_selection",
      "thread_candidate",
      "thread_confirmed",
    ])
    .optional(),
  playerName: z.string().min(2).max(100),
  sourceRecords: z.array(comparisonSourceRecordSchema),
});

const comparePlayerRecordsInputSchema = z.object({
  players: z.array(comparisonPlayerSchema).min(2),
  seasonStartYear: z.number().int().min(2000).max(2100).optional(),
});

const comparisonIdentityGroupsSchema = z.object({
  canonicalGroups: z.array(
    z.object({
      canonicalIdentityId: z.string(),
      records: z.array(
        z.object({
          identitySourceId: z.string(),
          provider: z.enum(["understat", "fm"]),
        })
      ),
    })
  ),
});

const comparisonSearchResultSchema = z.object({
  fm: fmReadResultSchema.optional(),
  identityGroups: comparisonIdentityGroupsSchema,
  query: z.array(comparisonSourceRecordSchema),
  understat: understatReadResultSchema.optional(),
});

type ComparisonPlayer = z.output<typeof comparisonPlayerSchema>;

type ComparePlayerRecordsInput = z.output<
  typeof comparePlayerRecordsInputSchema
>;

type PlayerComparisonData = {
  fm: FmReadResult | null;
  identityBasis: ComparisonPlayer["identityBasis"];
  playerName: string;
  understat: UnderstatReadResult | null;
};

const selectedSourceIds = (
  player: ComparisonPlayer,
  provider: "understat" | "fm"
): Set<string> =>
  new Set(
    player.sourceRecords.flatMap((record) =>
      record.provider === provider ? [record.sourceId] : []
    )
  );

const filterUnderstatRecords = (
  result: UnderstatReadResult | undefined,
  sourceIds: Set<string>
): UnderstatReadResult | null => {
  if (result === undefined || result.status !== "found") {
    return result ?? null;
  }

  const records = result.records.filter((record) =>
    sourceIds.has(record.sourcePlayerId)
  );

  return {
    records,
    status: records.length ? "found" : "not_found",
  };
};

const filterFmRecords = (
  result: FmReadResult | undefined,
  sourceIds: Set<string>
): FmReadResult | null => {
  if (result === undefined || result.status !== "found") {
    return result ?? null;
  }

  const records = result.records.filter((record) =>
    sourceIds.has(record.identitySourceId)
  );

  return {
    records,
    status: records.length ? "found" : "not_found",
  };
};

const sameSelectedIdentity = (
  first: ComparisonPlayer,
  second: ComparisonPlayer
): boolean => {
  if (
    first.canonicalIdentityId !== null &&
    first.canonicalIdentityId === second.canonicalIdentityId
  ) {
    return true;
  }

  const secondSourceKeys = new Set(
    second.sourceRecords.map(
      (record) => `${record.provider}:${record.sourceId}`
    )
  );

  return first.sourceRecords.some((record) =>
    secondSourceKeys.has(`${record.provider}:${record.sourceId}`)
  );
};

const uniqueComparisonPlayers = (
  players: ComparisonPlayer[]
): ComparisonPlayer[] => {
  const uniquePlayers: ComparisonPlayer[] = [];

  for (const player of players) {
    if (
      !uniquePlayers.some((selected) => sameSelectedIdentity(selected, player))
    ) {
      uniquePlayers.push(player);
    }
  }

  return uniquePlayers;
};

const understatRecords = (player: PlayerComparisonData) =>
  player.understat?.status === "found" ? player.understat.records : [];

const sharedUnderstatScopes = (players: PlayerComparisonData[]) => {
  const scopes = new Map<
    string,
    {
      competition: string;
      players: Map<number, ReturnType<typeof understatRecords>[number]>;
      season: string;
    }
  >();

  for (const [playerIndex, player] of players.entries()) {
    for (const record of understatRecords(player)) {
      const key = `${record.competition}\u0000${record.season}`;
      let scope = scopes.get(key);

      if (scope === undefined) {
        scope = {
          competition: record.competition,
          players: new Map(),
          season: record.season,
        };
        scopes.set(key, scope);
      }

      if (!scope.players.has(playerIndex)) {
        scope.players.set(playerIndex, record);
      }
    }
  }

  const sharedScopes = [];

  for (const scope of scopes.values()) {
    if (scope.players.size < 2) {
      continue;
    }

    sharedScopes.push({
      competition: scope.competition,
      players: players.map((player, index) => ({
        playerName: player.playerName,
        record: scope.players.get(index) ?? null,
      })),
      season: scope.season,
    });
  }

  return sharedScopes;
};

const comparePlayerRecords = async (
  input: ComparePlayerRecordsInput,
  search: SearchPlayer
): Promise<string> => {
  const selectedPlayers = uniqueComparisonPlayers(input.players);

  if (selectedPlayers.length < 2) {
    return JSON.stringify({
      playerCount: selectedPlayers.length,
      players: selectedPlayers.map((player) => ({
        identityBasis: player.identityBasis,
        playerName: player.playerName,
      })),
      status: "insufficient_distinct_players",
    });
  }

  const players = await Promise.all(
    selectedPlayers.map(async (player): Promise<PlayerComparisonData> => {
      const query: PlayerSearchQuery = {
        seasonStartYear: input.seasonStartYear,
        sourceRecords: player.sourceRecords,
      };

      const rawResult = await search(query);
      const result = comparisonSearchResultSchema.parse(JSON.parse(rawResult));

      return {
        fm: filterFmRecords(result.fm, selectedSourceIds(player, "fm")),
        identityBasis: player.identityBasis,
        playerName: player.playerName,
        understat: filterUnderstatRecords(
          result.understat,
          selectedSourceIds(player, "understat")
        ),
      };
    })
  );

  const scopes = sharedUnderstatScopes(players);

  const playersWithFmRecords = players.filter(
    (player) => player.fm?.status === "found"
  );

  const hasFmRecords = playersWithFmRecords.length > 0;
  const hasUnderstatRecords = scopes.length > 0;

  const hasComparableRecords =
    scopes.length > 0 || playersWithFmRecords.length >= 2;

  return JSON.stringify({
    coverage: {
      fmPlayerCount: playersWithFmRecords.length,
      hasFmRecords,
      hasUnderstatRecords,
      playerCount: selectedPlayers.length,
      sharedUnderstatScopeCount: scopes.length,
    },
    players,
    sharedUnderstatScopes: scopes,
    status: hasComparableRecords ? "ready" : "no_comparable_data",
  });
};

export { comparePlayerRecords, comparePlayerRecordsInputSchema };

export type { ComparePlayerRecordsInput, ComparisonPlayer };
