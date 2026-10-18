import { teamNamesMatch } from "../domain/team-names.js";
import { throwIfAborted } from "../domain/abort.js";
import { type DatasetMode, type DatasetSnapshotStatus } from "../domain/datasets.js";
import { type PlayerProfile } from "../domain/players.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import { isDetailedPosition } from "../domain/positions.js";
import { isUnderstatFinePositionSearch, understatCatalogPositionGroupsFor } from "../sources/understat/position-evidence.js";
import { type PlayerSearchFilter, type PlayerSearchPage, type PlayerSearchQuery, matchesPlayerSearch, searchLoadedPlayers } from "./search.js";
import type { UnderstatMatchInsight, UnderstatPlayerInsight, UnderstatPlayerSection, UnderstatTeamInsight } from "../sources/understat/research.js";

export interface PlayerRepository {
  readonly mode: DatasetMode;
  readonly sourceName: string;
  readonly supportsAbilityProfiles?: boolean;
  readonly supportsCompetitionExclusions?: boolean;
  findPlayersByNames?(names: readonly string[], signal?: AbortSignal): Promise<PlayerProfile[]>;
  /** Must not fetch a remote catalog. Used before external identity lookup. */
  findLocalPlayersByNames?(names: readonly string[], signal?: AbortSignal): Promise<PlayerProfile[]>;
  close?(): void;
  getDatasetStatus?(): Promise<DatasetSnapshotStatus>;
  loadPlayers?(refresh?: boolean, signal?: AbortSignal): Promise<PlayerProfile[]>;
  searchCandidates?(query: PlayerSearchQuery, signal?: AbortSignal): Promise<PlayerSearchPage>;
  inspectTeam?(teamName: string, signal?: AbortSignal): Promise<PlayerProfile[]>;
  getPlayersByIds?(playerIds: readonly string[], signal?: AbortSignal): Promise<PlayerProfile[]>;
  getComparisonPlayers?(players: readonly PlayerProfile[], signal?: AbortSignal): Promise<PlayerProfile[]>;
  inspectPlayer?(playerId: string, sections: readonly UnderstatPlayerSection[], signal?: AbortSignal): Promise<UnderstatPlayerInsight>;
  inspectCandidateGroup?(playerIds: readonly string[], sections: readonly UnderstatPlayerSection[], signal?: AbortSignal): Promise<UnderstatPlayerInsight[]>;
  inspectTeamDetails?(teamName: string, signal?: AbortSignal): Promise<UnderstatTeamInsight | null>;
  inspectMatch?(matchId: string, signal?: AbortSignal): Promise<UnderstatMatchInsight>;
}

export async function loadAllPlayers(repository: PlayerRepository, refresh = false, signal?: AbortSignal): Promise<PlayerProfile[]> {
  throwIfAborted(signal);
  if (!repository.loadPlayers) {
    throw new Error(`${repository.sourceName} supports scoped queries but does not expose a full-catalog load.`);
  }
  const players = await repository.loadPlayers(refresh, signal);
  throwIfAborted(signal);
  return players;
}

export function withLocalQueries(repository: PlayerRepository): PlayerRepository {
  return {
    mode: repository.mode,
    sourceName: repository.sourceName,
    supportsAbilityProfiles: repository.supportsAbilityProfiles,
    supportsCompetitionExclusions: repository.supportsCompetitionExclusions,
    ...(repository.findPlayersByNames ? { findPlayersByNames: (names: readonly string[], signal?: AbortSignal) => repository.findPlayersByNames!(names, signal) } : {}),
    ...(repository.findLocalPlayersByNames ? { findLocalPlayersByNames: (names: readonly string[], signal?: AbortSignal) => repository.findLocalPlayersByNames!(names, signal) } : {}),
    ...(repository.close ? { close: () => repository.close!() } : {}),
    ...(repository.loadPlayers ? { loadPlayers: (refresh?: boolean, signal?: AbortSignal) => repository.loadPlayers!(refresh, signal) } : {}),
    ...(repository.getDatasetStatus ? { getDatasetStatus: () => repository.getDatasetStatus!() } : {}),
    searchCandidates: async (query, signal) => {
      throwIfAborted(signal);
      const page = repository.searchCandidates
        ? await repository.searchCandidates(query, signal)
        : searchLoadedPlayers(await loadAllPlayers(repository, false, signal), query);
      throwIfAborted(signal);
      return page;
    },
    inspectTeam: (teamName, signal) => inspectTeamPlayers(repository, teamName, signal),
    getPlayersByIds: async (playerIds, signal) => {
      throwIfAborted(signal);
      if (repository.getPlayersByIds) return repository.getPlayersByIds(playerIds, signal);
      const wanted = new Set(playerIds);
      return (await loadAllPlayers(repository, false, signal)).filter((player) => wanted.has(player.playerId));
    },
    getComparisonPlayers: async (players, signal) => {
      throwIfAborted(signal);
      return repository.getComparisonPlayers
        ? repository.getComparisonPlayers(players, signal)
        : loadAllPlayers(repository, false, signal);
    },
    ...(repository.inspectPlayer ? { inspectPlayer: (playerId: string, sections: readonly UnderstatPlayerSection[], signal?: AbortSignal) => repository.inspectPlayer!(playerId, sections, signal) } : {}),
    ...(repository.inspectCandidateGroup ? { inspectCandidateGroup: (playerIds: readonly string[], sections: readonly UnderstatPlayerSection[], signal?: AbortSignal) => repository.inspectCandidateGroup!(playerIds, sections, signal) } : {}),
    ...(repository.inspectTeamDetails ? { inspectTeamDetails: (teamName: string, signal?: AbortSignal) => repository.inspectTeamDetails!(teamName, signal) } : {}),
    ...(repository.inspectMatch ? { inspectMatch: (matchId: string, signal?: AbortSignal) => repository.inspectMatch!(matchId, signal) } : {}),
  };
}

export async function searchPlayerPage(repository: PlayerRepository, query: PlayerSearchQuery, signal?: AbortSignal): Promise<PlayerSearchPage> {
  throwIfAborted(signal);
  const isUnderstatCatalog = repository.mode === "understat" || repository.mode === "mosaic";
  const effectiveQuery = query.positions?.length || (query.position && isDetailedPosition(query.position))
    ? {
      ...query,
      positionMatchMode: "family" as const,
      ...(isUnderstatCatalog ? {
        catalogPositionGroups: query.position ? understatCatalogPositionGroupsFor(query.position) : [],
        includeUnknownPosition: true,
      } : {}),
    }
    : query;
  const page = effectiveQuery.excludedCompetitions?.length && !repository.supportsCompetitionExclusions
    ? searchLoadedPlayers(await loadAllPlayers(repository, false, signal), effectiveQuery)
    : repository.searchCandidates
    ? repository.searchCandidates(effectiveQuery, signal)
    : searchLoadedPlayers(await loadAllPlayers(repository, false, signal), effectiveQuery);
  const result = await page;
  throwIfAborted(signal);
  if (result.offset !== effectiveQuery.offset) {
    throw new Error(`Player source returned offset ${result.offset} for requested offset ${effectiveQuery.offset}.`);
  }
  if (result.players.length > effectiveQuery.limit) {
    throw new Error(`Player source returned ${result.players.length} records for a page limit of ${effectiveQuery.limit}.`);
  }
  if (result.totalRecords !== null && (!Number.isInteger(result.totalRecords) || result.totalRecords < 0)) {
    throw new Error("Player source returned an invalid matching-record count.");
  }
  if (new Set(result.players.map((player) => player.playerId)).size !== result.players.length) {
    throw new Error("Player source returned duplicate player IDs within one candidate page.");
  }
  const requiredFilters: PlayerSearchFilter[] = [];
  if (query.playerName) requiredFilters.push("playerName");
  if (query.position || query.positions?.length) requiredFilters.push("position");
  if (query.maxAge !== null) requiredFilters.push("maxAge");
  if (query.minimumMinutes > 0) requiredFilters.push("minimumMinutes");
  if (query.competition) requiredFilters.push("competition");
  if (query.season) requiredFilters.push("season");
  const unapplied = requiredFilters.filter((filter) => !(filter === "position" && effectiveQuery.positionMatchMode === "family"
    ? result.appliedFilters.includes("position") || result.appliedFilters.includes("positionFamily")
    : result.appliedFilters.includes(filter)));
  if (unapplied.length) {
    throw new Error(`Player source could not apply requested search filter${unapplied.length === 1 ? "" : "s"}: ${unapplied.join(", ")}.`);
  }
  if (result.players.some((player) => !matchesPlayerSearch(player, effectiveQuery))) {
    throw new Error("Player source returned a candidate that does not satisfy the requested search filters.");
  }
  const expectedNextOffset = effectiveQuery.offset + result.players.length;
  if (result.nextOffset !== null && (result.players.length === 0 || result.nextOffset !== expectedNextOffset)) {
    throw new Error("Player source returned a non-contiguous candidate-page cursor.");
  }
  if (result.totalRecords !== null && result.players.length > 0) {
    if (result.totalRecords < expectedNextOffset) {
      throw new Error("Player source returned fewer total records than this candidate page contains.");
    }
    const moreRecordsRemain = expectedNextOffset < result.totalRecords;
    if (moreRecordsRemain !== (result.nextOffset !== null)) {
      throw new Error("Player source returned a next-page cursor inconsistent with its matching-record count.");
    }
  }
  return result;
}

export async function inspectTeamPlayers(repository: PlayerRepository, teamName: string, signal?: AbortSignal): Promise<PlayerProfile[]> {
  throwIfAborted(signal);
  if (repository.inspectTeam) return repository.inspectTeam(teamName, signal);
  const key = normalizeSearchText(teamName);
  const players = await loadAllPlayers(repository, false, signal);
  throwIfAborted(signal);
  return players.filter((player) => {
    const team = normalizeSearchText(player.team);
    return teamNamesMatch(player.team, teamName) || (key.length >= 4 && team.includes(key)) || (team.length >= 4 && key.includes(team));
  });
}

export async function loadPlayersByIds(repository: PlayerRepository, playerIds: readonly string[], signal?: AbortSignal): Promise<PlayerProfile[]> {
  throwIfAborted(signal);
  if (repository.getPlayersByIds) return repository.getPlayersByIds(playerIds, signal);
  const wanted = new Set(playerIds);
  return (await loadAllPlayers(repository, false, signal)).filter((player) => wanted.has(player.playerId));
}

export async function loadComparisonPlayers(repository: PlayerRepository, players: readonly PlayerProfile[], signal?: AbortSignal): Promise<PlayerProfile[]> {
  throwIfAborted(signal);
  if (players.length === 0) return [];
  return repository.getComparisonPlayers
    ? repository.getComparisonPlayers(players, signal)
    : loadAllPlayers(repository, false, signal);
}

export type { PlayerSearchFilter, PlayerSearchPage, PlayerSearchQuery } from "./search.js";
