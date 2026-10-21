import { understatCatalogPositionGroupsFor } from "../sources/understat/position-evidence.js";
import { competitionNamesMatch } from "../domain/competition-names.js";
import { type CapabilityMetricKey } from "../domain/capabilities.js";
import { type PlayerProfile } from "../domain/players.js";
import { type PlayerPosition, type Position } from "../domain/position-contracts.js";
import { observableMetricValue } from "../domain/performance-metrics.js";
import { playerPositionMatches, positionMatches, positionMatchesRetrieval } from "../domain/positions.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import { shouldExcludeForTargetTeam } from "../domain/team-names.js";
import type { FmSearchCriterion } from "../domain/recruitment-brief.js";

export interface PlayerSearchQuery {
  targetTeam?: string | null;
  referenceRoles?: { snapshotId: string; values: Record<string, number> };
  playerName: string | null;
  position: Position | null;
  positions?: readonly Position[];
  maxAge: number | null;
  minAge?: number | null;
  agePreference?: "younger" | "older" | null;
  minimumMinutes: number;
  fmCriteria?: readonly FmSearchCriterion[];
  competition: string | null;
  excludedCompetitions?: readonly string[];
  season: string | null;
  offset: number;
  limit: number;
  positionMatchMode?: "exact" | "family";
  catalogPositionGroups?: readonly Position[];
  includeUnknownPosition?: boolean;
  discoveryMetricGroups?: readonly (readonly CapabilityMetricKey[])[];
}

export interface PlayerSearchPage {
  players: PlayerProfile[];
  totalRecords: number | null;
  offset: number;
  nextOffset: number | null;
  appliedFilters: PlayerSearchFilter[];
  fmCriterionCoverage?: FmCriterionCoverage[];
  agePreferenceCoverage?: AgePreferenceCoverage;
  discovery?: { strategy: "metric_cohort_round_robin" | "cohort_sample"; metricKeys: CapabilityMetricKey[]; populationRecords: number };
}

export interface AgePreferenceCoverage {
  eligibleRecords: number;
  knownRecords: number;
}

export interface FmCriterionCoverage {
  key: string;
  field: FmSearchCriterion["field"];
  strength: FmSearchCriterion["strength"];
  eligibleRecords: number;
  knownRecords: number;
  satisfiedRecords: number;
}

export function fmCriterionKey(criterion: FmSearchCriterion): string {
  return JSON.stringify([criterion.field, criterion.attributeKey ?? null, criterion.operator, criterion.value, criterion.unit ?? null, criterion.strength]);
}

export type PlayerSearchFilter = "playerName" | "targetTeam" | "position" | "positionFamily" | "maxAge" | "minAge" | "minimumMinutes" | "competition" | "excludedCompetitions" | "season" | "fmCriteria";

function fmCriterionValue(player: PlayerProfile, criterion: FmSearchCriterion): number | null {
  const profile = player.abilityProfile;
  if (!profile) return null;
  switch (criterion.field) {
    case "heightCm": return profile.heightCm;
    case "potentialAbility": return profile.potentialAbility;
    case "currentAbility": return profile.currentAbility;
    case "fmAttribute": {
      const attribute = criterion.attributeKey ? profile.attributes[criterion.attributeKey] : undefined;
      return attribute?.raw ?? (attribute?.display === null || attribute?.display === undefined ? null : attribute.display * 5);
    }
  }
}

function criterionValueMatches(actual: number, criterion: FmSearchCriterion): boolean {
  if (criterion.value === null) return false;
  switch (criterion.operator) {
    case "lt": return actual < criterion.value;
    case "lte": return actual <= criterion.value;
    case "gt": return actual > criterion.value;
    case "gte": return actual >= criterion.value;
    case "prefer_high":
    case "prefer_low": return true;
  }
}

/** Missing FM data neither satisfies a hard rule nor triggers an exclusion. */
export function matchesFmSearchCriteria(player: PlayerProfile, criteria: readonly FmSearchCriterion[] = []): boolean {
  for (const criterion of criteria) {
    if (criterion.strength === "preferred") continue;
    const actual = fmCriterionValue(player, criterion);
    if (actual === null) {
      if (criterion.strength === "excluded") continue;
      return false;
    }
    const matches = criterionValueMatches(actual, criterion);
    if (criterion.strength === "excluded" ? matches : !matches) return false;
  }
  return true;
}

function fmPreferenceDirection(criterion: FmSearchCriterion): "high" | "low" {
  return criterion.operator === "prefer_low" || criterion.operator === "lt" || criterion.operator === "lte" ? "low" : "high";
}

export function matchesPlayerSearch(player: PlayerProfile, query: PlayerSearchQuery): boolean {
  if (shouldExcludeForTargetTeam(player, query.targetTeam)) return false;
  if (query.playerName && ![player.name, ...(player.abilityProfile?.aliases ?? [])].some((name) => normalizeSearchText(name).includes(normalizeSearchText(query.playerName!)))) return false;
  if (query.positions?.length && !query.positions.some((position) => playerPositionMatches(player, position) || positionMatchesRetrieval(
    player.position, position, player.sourceIdentity?.positionGroups,
    player.sourceIdentity?.provider === "understat" ? understatCatalogPositionGroupsFor(position) : [],
    player.sourceIdentity?.provider === "understat",
  ))) return false;
  if (!query.positions?.length && query.position && !playerPositionMatches(player, query.position) && !(query.positionMatchMode === "family"
    ? positionMatchesRetrieval(player.position, query.position, player.sourceIdentity?.positionGroups,
      query.catalogPositionGroups, query.includeUnknownPosition)
    : matchesPositionFromCatalog(player.position, query.position, player.sourceIdentity?.positionGroups))) return false;
  if (player.minutes < query.minimumMinutes) return false;
  if (query.maxAge !== null && (player.age === null || player.age > query.maxAge)) return false;
  if (query.minAge != null && (player.age === null || player.age < query.minAge)) return false;
  if (!matchesFmSearchCriteria(player, query.fmCriteria)) return false;
  if (query.competition && !competitionNamesMatch(player.competition, query.competition)) return false;
  if (query.excludedCompetitions?.length && (!player.competition || query.excludedCompetitions.some(competition => competitionNamesMatch(player.competition, competition)))) return false;
  if (query.season && !normalizeSearchText(player.season).includes(normalizeSearchText(query.season))) return false;
  return true;
}

function matchesPositionFromCatalog(actual: PlayerPosition, requested: Position, catalogGroups: readonly Position[] = []): boolean {
  if (actual !== "UNKNOWN" && positionMatches(actual, requested)) return true;
  return catalogGroups.some((group) => positionMatches(group, requested));
}

export function searchLoadedPlayers(players: readonly PlayerProfile[], query: PlayerSearchQuery): PlayerSearchPage {
  const fmEligible = query.fmCriteria?.length ? players.filter(player => matchesPlayerSearch(player, { ...query, fmCriteria: undefined })) : [];
  const matching = players.filter((player) => matchesPlayerSearch(player, query));
  const fmCriterionCoverage = query.fmCriteria?.length ? query.fmCriteria.map(criterion => {
    const known = fmEligible.flatMap(player => {
      const value = fmCriterionValue(player, criterion);
      return value === null ? [] : [{ player, value }];
    });
    const satisfiedRecords = known.filter(({ value }) => {
      if (criterion.strength === "preferred" && criterion.value === null) return true;
      const matches = criterionValueMatches(value, criterion);
      return criterion.strength === "excluded" ? !matches : matches;
    }).length;
    return { key: fmCriterionKey(criterion), field: criterion.field, strength: criterion.strength,
      eligibleRecords: fmEligible.length, knownRecords: known.length, satisfiedRecords };
  }) : undefined;
  const agePreferenceCoverage = query.agePreference ? {
    eligibleRecords: matching.length,
    knownRecords: matching.filter(player => player.age !== null).length,
  } : undefined;
  const metricKeys = [...new Set((query.discoveryMetricGroups ?? []).flat())].sort()
    .filter(key => matching.some(player => observableMetricValue(player, key) !== undefined));
  const hasFmPreferences = query.fmCriteria?.some(criterion => criterion.strength === "preferred") ?? false;
  const shouldOrderDiscovery = query.discoveryMetricGroups !== undefined || query.positions?.length || hasFmPreferences || query.agePreference;
  const ordered = !shouldOrderDiscovery ? matching : query.agePreference
    ? [
      ...orderDiscoveryCandidates(matching.filter(player => player.age !== null), query.discoveryMetricGroups ?? [], query.fmCriteria ?? [], query.agePreference),
      ...orderDiscoveryCandidates(matching.filter(player => player.age === null), query.discoveryMetricGroups ?? [], query.fmCriteria ?? []),
    ]
    : orderDiscoveryCandidates(matching, query.discoveryMetricGroups ?? [], query.fmCriteria ?? []);
  const page = ordered.slice(query.offset, query.offset + query.limit);
  const appliedFilters: PlayerSearchFilter[] = [];
  if (query.playerName) appliedFilters.push("playerName");
  if (query.targetTeam) appliedFilters.push("targetTeam");
  if (query.position || query.positions?.length) appliedFilters.push(query.positionMatchMode === "family" ? "positionFamily" : "position");
  if (query.maxAge !== null) appliedFilters.push("maxAge");
  if (query.minAge != null) appliedFilters.push("minAge");
  if (query.minimumMinutes > 0) appliedFilters.push("minimumMinutes");
  if (query.fmCriteria?.some(criterion => criterion.strength !== "preferred")) appliedFilters.push("fmCriteria");
  if (query.competition) appliedFilters.push("competition");
  if (query.excludedCompetitions?.length) appliedFilters.push("excludedCompetitions");
  if (query.season) appliedFilters.push("season");
  return {
    players: page,
    totalRecords: matching.length,
    offset: query.offset,
    nextOffset: query.offset + page.length < matching.length ? query.offset + page.length : null,
    appliedFilters,
    ...(fmCriterionCoverage ? { fmCriterionCoverage } : {}),
    ...(agePreferenceCoverage ? { agePreferenceCoverage } : {}),
    ...(query.discoveryMetricGroups !== undefined ? { discovery: { strategy: metricKeys.length ? "metric_cohort_round_robin" as const : "cohort_sample" as const, metricKeys, populationRecords: matching.length } } : {}),
  };
}

/** Per-metric discovery lanes, never a weighted ability score or cross-league rank. */
function orderDiscoveryCandidates(
  players: readonly PlayerProfile[],
  metricGroups: readonly (readonly CapabilityMetricKey[])[],
  fmCriteria: readonly FmSearchCriterion[] = [],
  agePreference?: "younger" | "older" | null,
): PlayerProfile[] {
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
      const per90 = !key.startsWith("ability") && (supplementary ? supplementary.normalization === "per90" : key !== "passCompletionPct");
      const sampleMinutes = supplementary ? supplementary.sampleMinutes : player.minutes;
      // Discovery uses accumulated observed output, not a noisy tiny-sample rate.
      // Other denominators (percent, shot, possession time) cannot be reconstructed from match minutes.
      const support = per90 && sampleMinutes !== null ? value === undefined ? 0 : value * sampleMinutes / 90
        : key.startsWith("ability") ? 1 : supplementary?.sampleAttempts ?? sampleMinutes ?? 0;
      return value === undefined || !Number.isFinite(value) ? [] : [{ player, value, support }];
    }).sort((a, b) => b.support - a.support || b.value - a.value || b.player.minutes - a.player.minutes || stableId(a.player).localeCompare(stableId(b.player)))
      .map(({ player }) => player))));
    const fmPreferenceLanes = fmCriteria.filter(criterion => criterion.strength === "preferred")
      .map(criterion => cohort.flatMap(player => {
        const value = fmCriterionValue(player, criterion);
        return value === null ? [] : [{ player, value }];
      }).sort((left, right) => (fmPreferenceDirection(criterion) === "high" ? right.value - left.value : left.value - right.value)
        || stableId(left.player).localeCompare(stableId(right.player))).map(({ player }) => player));
    const agePreferenceLanes = agePreference ? [cohort.filter(player => player.age !== null)
      .sort((left, right) => (agePreference === "younger" ? left.age! - right.age! : right.age! - left.age!)
        || stableId(left).localeCompare(stableId(right)))] : [];
    const supported = interleave([...agePreferenceLanes, ...capabilityLanes, ...fmPreferenceLanes]);
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
