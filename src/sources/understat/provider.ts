import { matchesPlayerSearch, searchLoadedPlayers } from "../../players/search.js";
import { SupplementaryCapabilityMetricDefinitions } from "../../domain/capabilities.js";
import { PlayerProfileSchema, type PlayerProfile, type SupplementaryMetricKey, type SupplementaryPerformanceMetric } from "../../domain/players.js";
import { type PlayerPosition, type Position } from "../../domain/position-contracts.js";
import type { PlayerRepository, PlayerSearchPage, PlayerSearchQuery } from "../../players/repository.js";
import { throwIfAborted } from "../../domain/abort.js";
import { SharedCancellableLoad } from "../shared/cancellable-load.js";
import {
  UnderstatDataGateway,
  type UnderstatSnapshotStore,
} from "./data-gateway.js";
import { UnderstatProviderError } from "./data-gateway.js";
export { UnderstatProviderError } from "./data-gateway.js";
import { isUnderstatFinePositionSearch, understatCatalogPositionGroupsFor } from "./position-evidence.js";
import {
  inspectUnderstatMatch,
  inspectUnderstatTeam,
  compactUnderstatPlayerInsightForCohort,
  projectUnderstatPlayerInsight,
  type UnderstatMatchInsight,
  type UnderstatPlayerInsight,
  type UnderstatPlayerSection,
  type UnderstatTeamInsight,
} from "./research.js";

const ORIGIN = "https://understat.com";

const COMPETITIONS = [
  { slug: "EPL", label: "英超" },
  { slug: "La_liga", label: "西甲" },
  { slug: "Bundesliga", label: "德甲" },
  { slug: "Serie_A", label: "意甲" },
  { slug: "Ligue_1", label: "法甲" },
] as const;
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 60 * 1000;
const ACCESS_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_PLAYERS_PER_COMPETITION = 2_000;

interface CacheEntry {
  expiresAt: number;
  load: SharedCancellableLoad<PlayerProfile[]>;
}

interface MetricField {
  key: SupplementaryMetricKey;
  field: string;
  normalization: "per90" | "perShot";
  unit: string;
}

interface UnderstatPlayerRow extends Record<string, unknown> {
  id: string;
  player_name: string;
  games: string;
  time: string;
  goals: string;
  xG: string;
  assists: string;
  xA: string;
  shots: string;
  key_passes: string;
  position: string;
  team_title: string;
  npg: string;
  npxG: string;
  xGChain: string;
  xGBuildup: string;
}

export interface UnderstatRepositoryOptions {
  fetchImpl?: typeof fetch;
  snapshotStore?: UnderstatSnapshotStore;
  cacheTtlMs?: number;
  now?: () => Date;
}

export interface UnderstatResearchRepository {
  inspectPlayer(playerId: string, sections: readonly UnderstatPlayerSection[], signal?: AbortSignal): Promise<UnderstatPlayerInsight>;
  inspectCandidateGroup(playerIds: readonly string[], sections: readonly UnderstatPlayerSection[], signal?: AbortSignal): Promise<UnderstatPlayerInsight[]>;
  inspectTeamDetails(teamName: string, signal?: AbortSignal): Promise<UnderstatTeamInsight | null>;
  inspectMatch(matchId: string, signal?: AbortSignal): Promise<UnderstatMatchInsight>;
}

const metricFields: readonly MetricField[] = [
  { key: "understatExpectedGoalsPer90", field: "xG", normalization: "per90", unit: "xG/90分钟" },
  { key: "understatNonPenaltyExpectedGoalsPer90", field: "npxG", normalization: "per90", unit: "npxG/90分钟" },
  { key: "understatExpectedAssistsPer90", field: "xA", normalization: "per90", unit: "xA/90分钟" },
  { key: "understatExpectedGoalsPerShot", field: "xG", normalization: "perShot", unit: "xG/次射门" },
  { key: "understatShotsPer90", field: "shots", normalization: "per90", unit: "次/90分钟" },
  { key: "understatKeyPassesPer90", field: "key_passes", normalization: "per90", unit: "次/90分钟" },
  { key: "understatXgChainPer90", field: "xGChain", normalization: "per90", unit: "xGChain/90分钟" },
  { key: "understatXgBuildupPer90", field: "xGBuildup", normalization: "per90", unit: "xGBuildup/90分钟" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function sourceInteger(value: unknown): number | undefined {
  const parsed = sourceNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) ? parsed : undefined;
}

function currentSeasonStartYear(now: Date): number {
  const year = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  if (year < 1992 || year > 2100) {
    throw new UnderstatProviderError("invalid_configuration", "Understat 当前赛季无法从本机日期推导。");
  }
  return year;
}

function displaySeason(startYear: number): string {
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

function sourcePositionLabels(value: unknown): string[] {
  return typeof value === "string"
    ? [...new Set(value.trim().toUpperCase().split(/\s+/).filter(Boolean))]
    : [];
}

function sourcePositionGroups(labels: readonly string[]): Position[] {
  const groupByLabel: Record<string, Position> = { GK: "GK", D: "DEF", M: "MID", F: "ATT" };
  return [...new Set(labels.flatMap((label) => groupByLabel[label] ? [groupByLabel[label]!] : []))];
}

function broadPosition(groups: readonly Position[]): PlayerPosition {
  return groups.length === 1 ? groups[0]! : "UNKNOWN";
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function metricValue(field: MetricField, row: UnderstatPlayerRow, minutes: number, shots: number): number | null | undefined {
  const raw = sourceNumber(row[field.field]);
  if (raw === undefined) return undefined;
  if (field.normalization === "perShot") return shots > 0 ? rounded(raw / shots) : null;
  if (minutes <= 0) return null;
  return rounded(raw * 90 / minutes);
}

function mapCompetitionPlayers(
  payload: unknown,
  competition: typeof COMPETITIONS[number],
  seasonStartYear: number,
  retrievedAt: Date,
): PlayerProfile[] {
  if (!isRecord(payload) || !Array.isArray(payload.players) || payload.players.length > MAX_PLAYERS_PER_COMPETITION) {
    throw new UnderstatProviderError("invalid_response", `Understat ${competition.label} 返回的球员表格式或记录数量异常。`);
  }
  const season = displaySeason(seasonStartYear);
  const retrievedAtText = retrievedAt.toISOString();
  const output: PlayerProfile[] = [];
  const seenIds = new Set<string>();

  for (const candidate of payload.players) {
    if (!isRecord(candidate)) continue;
    const row = candidate as unknown as UnderstatPlayerRow;
    const id = typeof row.id === "string" && /^[1-9]\d{0,14}$/.test(row.id) ? row.id : undefined;
    const name = typeof row.player_name === "string" ? row.player_name.trim() : "";
    const team = typeof row.team_title === "string" ? row.team_title.trim() : "";
    const sourcePositionLabelsForPlayer = sourcePositionLabels(row.position);
    const sourcePositionGroupsForPlayer = sourcePositionGroups(sourcePositionLabelsForPlayer);
    const position = broadPosition(sourcePositionGroupsForPlayer);
    if (!id || !name || !team) continue;
    if (seenIds.has(id)) {
      throw new UnderstatProviderError("invalid_response", `Understat ${competition.label} 返回重复球员 ID，无法安全区分该记录。`);
    }
    seenIds.add(id);

    const minutes = sourceNumber(row.time) ?? 0;
    const matches = sourceInteger(row.games) ?? null;
    const goals = sourceNumber(row.goals);
    const assists = sourceNumber(row.assists);
    const keyPasses = sourceNumber(row.key_passes);
    const shots = sourceNumber(row.shots) ?? 0;
    const supplementaryMetrics: SupplementaryPerformanceMetric[] = metricFields.flatMap((field) => {
      const value = metricValue(field, row, minutes, shots);
      if (value === undefined) return [];
      const definition = SupplementaryCapabilityMetricDefinitions.find((metric) => metric.key === field.key);
      if (!definition) throw new UnderstatProviderError("invalid_configuration", `缺少 ${field.key} 的指标定义。`);
      return [{
        key: field.key,
        definition: definition.definition,
        value,
        unit: field.unit,
        normalization: field.normalization,
        sourceField: field.normalization === "perShot" ? "xG / shots" : field.field,
        sampleMinutes: minutes,
        sampleMatches: matches,
        ...(field.normalization === "perShot" ? { sampleAttempts: shots, sampleAttemptsLabel: "次射门" } : {}),
      }];
    });
    const providerId = `${competition.slug}:${id}`;
    const sourceUrl = `${ORIGIN}/league/${competition.slug}/${seasonStartYear}`;
    output.push(PlayerProfileSchema.parse({
      playerId: `understat:${competition.slug}:${id}:season:${seasonStartYear}`,
      externalPlayerId: id,
      name,
      team,
      age: null,
      position,
      competition: competition.label,
      season,
      minutes,
      ...(matches === null ? {} : { appearanceMatchCount: matches }),
      stats: {
        goals: goals ?? 0,
        assists: assists ?? 0,
        passesAttempted: 0,
        passesCompleted: 0,
        longPasses: 0,
        carries: 0,
        pressures: 0,
        tackles: 0,
        interceptions: 0,
        shotAssists: 0,
        keyPasses: keyPasses ?? 0,
      },
      availableStats: [
        ...(goals === undefined ? [] : ["goals" as const]),
        ...(assists === undefined ? [] : ["assists" as const]),
        ...(keyPasses === undefined ? [] : ["keyPasses" as const]),
      ],
      supplementaryMetrics,
      sourceIdentity: {
        provider: "understat",
        playerId: providerId,
        providerIdentifiers: [{
          provider: "understat",
          namespace: "player",
          externalId: id,
          sourceField: "id",
        }],
        competitionId: competition.slug,
        seasonId: String(seasonStartYear),
        positionGroup: position,
        positionGroups: sourcePositionGroupsForPlayer,
        sourcePositionLabels: sourcePositionLabelsForPlayer,
        retrievedAt: retrievedAtText,
        isCurrentSeason: true,
      },
      sourceUrl,
      source: `Understat ${competition.label} · ${season} 赛季统计`,
    }));
  }
  if (output.length === 0) {
    throw new UnderstatProviderError("invalid_response", `Understat ${competition.label} 没有返回可识别的球员表现记录。`);
  }
  return output;
}

async function requestCompetition(
  gateway: UnderstatDataGateway,
  competition: typeof COMPETITIONS[number],
  seasonStartYear: number,
  signal?: AbortSignal,
  refresh = false,
): Promise<PlayerProfile[]> {
  const snapshot = await gateway.get("league", competition.slug, seasonStartYear, { signal, refresh });
  return mapCompetitionPlayers(snapshot.payload, competition, seasonStartYear, new Date(snapshot.retrievedAt));
}

async function requestPlayers(gateway: UnderstatDataGateway, now: () => Date, signal?: AbortSignal, refresh = false): Promise<PlayerProfile[]> {
  const retrievedAt = now();
  const seasonStartYear = currentSeasonStartYear(retrievedAt);
  const output: PlayerProfile[] = [];
  // Keep the five public page reads sequential and bounded to avoid a burst against the source.
  for (const competition of COMPETITIONS) {
    throwIfAborted(signal);
    output.push(...await requestCompetition(gateway, competition, seasonStartYear, signal, refresh));
  }
  return output;
}

export class UnderstatPlayerRepository implements PlayerRepository, UnderstatResearchRepository {
  readonly mode = "understat" as const;
  readonly sourceName = "Understat · 五大联赛当前赛季表现池";
  private cached?: CacheEntry;
  private readonly gateway: UnderstatDataGateway;
  private readonly cacheTtlMs: number;
  private readonly now: () => Date;

  constructor(options: UnderstatRepositoryOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? (() => new Date());
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 0) {
      throw new UnderstatProviderError("invalid_configuration", "Understat 缓存时间必须是非负毫秒数。");
    }
    this.gateway = new UnderstatDataGateway({
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.snapshotStore ? { snapshotStore: options.snapshotStore } : {}),
      cacheTtlMs: this.cacheTtlMs,
      now: this.now,
    });
  }

  loadPlayers(refresh = false, signal?: AbortSignal): Promise<PlayerProfile[]> {
    throwIfAborted(signal);
    const nowMs = this.now().getTime();
    // LangGraph may revisit the provider while reviewing the same case; keep a stable snapshot per process.
    if (!refresh && this.cached && this.cached.expiresAt > nowMs) return this.cached.load.subscribe(signal);
    const entry: CacheEntry = { expiresAt: nowMs + this.cacheTtlMs, load: new SharedCancellableLoad((requestSignal) => requestPlayers(this.gateway, this.now, requestSignal, refresh)) };
    void entry.load.promise.catch((error: unknown) => {
      if (this.cached === entry) {
        if (entry.load.signal.aborted) {
          this.cached = undefined;
          return;
        }
        const restricted = error instanceof UnderstatProviderError
          && (error.code === "blocked" || error.code === "rate_limit");
        entry.expiresAt = this.now().getTime() + (restricted ? ACCESS_FAILURE_COOLDOWN_MS : FAILURE_COOLDOWN_MS);
      }
    });
    this.cached = entry;
    return entry.load.subscribe(signal);
  }

  async searchCandidates(query: PlayerSearchQuery, signal?: AbortSignal): Promise<PlayerSearchPage> {
    throwIfAborted(signal);
    const effectiveQuery = query.position && isUnderstatFinePositionSearch(query.position)
      ? {
        ...query,
        positionMatchMode: "family" as const,
        catalogPositionGroups: understatCatalogPositionGroupsFor(query.position),
        includeUnknownPosition: true,
      }
      : query;
    if (query.maxAge !== null) {
      throw new UnderstatProviderError("unsupported_scope", "Understat 未提供出生日期或年龄，无法执行年龄上限筛选；请先确认是否移除年龄条件，或改用可核验年龄的数据源。");
    }
    const players = await this.loadPlayers(false, signal);
    throwIfAborted(signal);
    const matching = players.filter((player) => matchesPlayerSearch(player, effectiveQuery));
    const byCompetition = new Map<string, PlayerProfile[]>();
    for (const player of matching) {
      const group = byCompetition.get(player.competition) ?? [];
      group.push(player);
      byCompetition.set(player.competition, group);
    }
    const leagueGroups = [...byCompetition.values()];
    const interleaved: PlayerProfile[] = [];
    const longestLeague = Math.max(0, ...leagueGroups.map((group) => group.length));
    for (let index = 0; index < longestLeague; index += 1) {
      for (const group of leagueGroups) {
        const player = group[index];
        if (player) interleaved.push(effectiveQuery.positionMatchMode === "family"
          && effectiveQuery.position && isUnderstatFinePositionSearch(effectiveQuery.position)
          ? { ...player, positionEvidence: {
            provider: "understat",
            targetPosition: effectiveQuery.position,
            status: "pending",
            sourceScope: "season_position_aggregate",
            season: player.sourceIdentity?.seasonId ?? player.season.split("/", 1)[0] ?? null,
            sourceCodes: [],
            sampleMinutes: null,
          } }
          : player);
      }
    }
    if (effectiveQuery.discoveryMetricGroups !== undefined) return searchLoadedPlayers(interleaved, effectiveQuery);
    const playersOnPage = interleaved.slice(effectiveQuery.offset, effectiveQuery.offset + effectiveQuery.limit);
    const appliedFilters: PlayerSearchPage["appliedFilters"] = [];
    if (effectiveQuery.playerName) appliedFilters.push("playerName");
    if (effectiveQuery.position) appliedFilters.push(effectiveQuery.positionMatchMode === "family" && isUnderstatFinePositionSearch(effectiveQuery.position)
      ? "positionFamily"
      : "position");
    if (effectiveQuery.minimumMinutes > 0) appliedFilters.push("minimumMinutes");
    if (effectiveQuery.competition) appliedFilters.push("competition");
    if (effectiveQuery.season) appliedFilters.push("season");
    return {
      players: playersOnPage,
      totalRecords: interleaved.length,
      offset: effectiveQuery.offset,
      nextOffset: effectiveQuery.offset + playersOnPage.length < interleaved.length ? effectiveQuery.offset + playersOnPage.length : null,
      appliedFilters,
    };
  }

  async inspectPlayer(playerId: string, sections: readonly UnderstatPlayerSection[], signal?: AbortSignal): Promise<UnderstatPlayerInsight> {
    throwIfAborted(signal);
    const players = await this.loadPlayers(false, signal);
    const profile = players.find((candidate) => candidate.playerId === playerId);
    if (!profile || !profile.externalPlayerId) {
      throw new UnderstatProviderError("unsupported_scope", "只能查询本轮 Understat 数据目录中已发现的球员来源 ID。");
    }
    const snapshot = await this.gateway.get("player", profile.externalPlayerId, null, { signal });
    throwIfAborted(signal);
    return projectUnderstatPlayerInsight({ profile, snapshot, sections });
  }

  async inspectCandidateGroup(playerIds: readonly string[], sections: readonly UnderstatPlayerSection[], signal?: AbortSignal): Promise<UnderstatPlayerInsight[]> {
    throwIfAborted(signal);
    if (playerIds.length < 1 || playerIds.length > 12 || new Set(playerIds).size !== playerIds.length) {
      throw new UnderstatProviderError("unsupported_scope", "候选组细查需要 1–12 名互不重复的已发现球员。");
    }
    const players = await this.loadPlayers(false, signal);
    throwIfAborted(signal);
    const profiles = playerIds.map((playerId) => {
      const profile = players.find((candidate) => candidate.playerId === playerId);
      if (!profile || !profile.externalPlayerId) {
        throw new UnderstatProviderError("unsupported_scope", "候选组只能包含已发现的 Understat 球员来源 ID。");
      }
      return profile;
    });
    const insights: UnderstatPlayerInsight[] = [];
    for (let start = 0; start < profiles.length; start += 4) {
      throwIfAborted(signal);
      const batch = profiles.slice(start, start + 4);
      const results = await Promise.all(batch.map(async (profile) => {
        const snapshot = await this.gateway.get("player", profile.externalPlayerId!, null, { signal });
        throwIfAborted(signal);
        return compactUnderstatPlayerInsightForCohort(projectUnderstatPlayerInsight({ profile, snapshot, sections }));
      }));
      insights.push(...results);
    }
    return insights;
  }

  async inspectTeamDetails(teamName: string, signal?: AbortSignal): Promise<UnderstatTeamInsight | null> {
    throwIfAborted(signal);
    const players = await this.loadPlayers(false, signal);
    throwIfAborted(signal);
    return inspectUnderstatTeam(this.gateway, players, teamName, signal);
  }

  async inspectMatch(matchId: string, signal?: AbortSignal): Promise<UnderstatMatchInsight> {
    throwIfAborted(signal);
    const result = await inspectUnderstatMatch(this.gateway, matchId, signal);
    throwIfAborted(signal);
    return result;
  }
}
