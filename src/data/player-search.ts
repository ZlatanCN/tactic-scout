import type { CapabilityMetricKey, PlayerProfile, Position } from "../domain/schemas.js";
import { observableMetricValue } from "../domain/performance-metrics.js";
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
  discoveryMetricGroups?: readonly (readonly CapabilityMetricKey[])[];
}

export interface PlayerSearchPage {
  players: PlayerProfile[];
  totalRecords: number | null;
  offset: number;
  nextOffset: number | null;
  appliedFilters: PlayerSearchFilter[];
  discovery?: { strategy: "metric_cohort_round_robin" | "cohort_sample"; metricKeys: CapabilityMetricKey[]; populationRecords: number };
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
  const metricKeys = [...new Set((query.discoveryMetricGroups ?? []).flat())].sort()
    .filter(key => matching.some(player => observableMetricValue(player, key) !== undefined));
  const ordered = query.discoveryMetricGroups !== undefined ? orderDiscoveryCandidates(matching, query.discoveryMetricGroups) : matching;
  const page = ordered.slice(query.offset, query.offset + query.limit);
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
    ...(query.discoveryMetricGroups !== undefined ? { discovery: { strategy: metricKeys.length ? "metric_cohort_round_robin" as const : "cohort_sample" as const, metricKeys, populationRecords: matching.length } } : {}),
  };
}

/** Per-metric discovery lanes, never a weighted ability score or cross-league rank. */
function orderDiscoveryCandidates(players: readonly PlayerProfile[], metricGroups: readonly (readonly CapabilityMetricKey[])[]): PlayerProfile[] {
  const cohorts = new Map<string, PlayerProfile[]>();
  const stableId = (player: PlayerProfile) => `${player.sourceIdentity?.provider ?? player.source}\u0000${player.playerId}`;
  for (const player of players) {
    const cohort = JSON.stringify([player.sourceIdentity?.provider ?? player.source, player.competition, player.season, player.position]);
    const group = cohorts.get(cohort) ?? [];
    group.push(player);
    cohorts.set(cohort, group);
  }
  const lanes = [...cohorts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, cohort]) => {
    const capabilityLanes = metricGroups.map(keys => interleave(keys.map(key => cohort.flatMap(player => {
      const value = observableMetricValue(player, key);
      const supplementary = player.supplementaryMetrics?.find(metric => metric.key === key);
      const per90 = supplementary ? supplementary.normalization === "per90" : key !== "passCompletionPct";
      const sampleMinutes = supplementary ? supplementary.sampleMinutes : player.minutes;
      // Discovery uses accumulated observed output, not a noisy tiny-sample rate.
      // Other denominators (percent, shot, possession time) cannot be reconstructed from match minutes.
      const support = per90 && sampleMinutes !== null ? value === undefined ? 0 : value * sampleMinutes / 90
        : supplementary?.sampleAttempts ?? sampleMinutes ?? 0;
      return value === undefined || !Number.isFinite(value) ? [] : [{ player, value, support }];
    }).sort((a, b) => b.support - a.support || b.value - a.value || b.player.minutes - a.player.minutes || stableId(a.player).localeCompare(stableId(b.player)))
      .map(({ player }) => player))));
    const supported = interleave(capabilityLanes);
    const included = new Set(supported.map(player => player.playerId));
    return [...supported, ...cohort.filter(player => !included.has(player.playerId))
      .sort((a, b) => b.minutes - a.minutes || stableId(a).localeCompare(stableId(b)))];
  });
  return interleave(lanes);
}

/** Equal turns for cohorts, then requested capabilities, then their observable metrics. */
function interleave(lanes: readonly (readonly PlayerProfile[])[]): PlayerProfile[] {
  const selected = new Set<string>();
  const ordered: PlayerProfile[] = [];
  for (let index = 0; lanes.some(lane => index < lane.length); index++) {
    for (const lane of lanes) {
      const player = lane[index];
      if (player && !selected.has(player.playerId)) { selected.add(player.playerId); ordered.push(player); }
    }
  }
  return ordered;
}
