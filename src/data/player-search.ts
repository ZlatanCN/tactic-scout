import type { PlayerProfile, Position } from "../domain/schemas.js";
import { positionMatches } from "../domain/positions.js";
import { normalizeSearchText } from "../domain/text-matching.js";

export interface PlayerSearchQuery {
  playerName: string | null;
  position: Position | null;
  maxAge: number | null;
  minimumMinutes: number;
  competition: string | null;
  season: string | null;
  offset: number;
  limit: number;
}

export interface PlayerSearchPage {
  players: PlayerProfile[];
  totalRecords: number | null;
  offset: number;
  nextOffset: number | null;
  appliedFilters: PlayerSearchFilter[];
}

export type PlayerSearchFilter = "playerName" | "position" | "maxAge" | "minimumMinutes" | "competition" | "season";

export function matchesPlayerSearch(player: PlayerProfile, query: PlayerSearchQuery): boolean {
  if (query.playerName && !normalizeSearchText(player.name).includes(normalizeSearchText(query.playerName))) return false;
  if (query.position && !positionMatches(player.position, query.position)) return false;
  if (player.minutes < query.minimumMinutes) return false;
  if (query.maxAge !== null && (player.age === null || player.age > query.maxAge)) return false;
  if (query.competition && !normalizeSearchText(player.competition).includes(normalizeSearchText(query.competition))) return false;
  if (query.season && !normalizeSearchText(player.season).includes(normalizeSearchText(query.season))) return false;
  return true;
}

export function searchLoadedPlayers(players: readonly PlayerProfile[], query: PlayerSearchQuery): PlayerSearchPage {
  const matching = players.filter((player) => matchesPlayerSearch(player, query));
  const page = matching.slice(query.offset, query.offset + query.limit);
  const appliedFilters: PlayerSearchFilter[] = [];
  if (query.playerName) appliedFilters.push("playerName");
  if (query.position) appliedFilters.push("position");
  if (query.maxAge !== null) appliedFilters.push("maxAge");
  if (query.minimumMinutes > 0) appliedFilters.push("minimumMinutes");
  if (query.competition) appliedFilters.push("competition");
  if (query.season) appliedFilters.push("season");
  return {
    players: page,
    totalRecords: matching.length,
    offset: query.offset,
    nextOffset: query.offset + page.length < matching.length ? query.offset + page.length : null,
    appliedFilters,
  };
}
