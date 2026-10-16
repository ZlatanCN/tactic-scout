import {
  PlayerProfileSchema,
  type PlayerProfile,
  type Position,
  type SupplementaryMetricKey,
  type SupplementaryPerformanceMetric,
} from "../domain/schemas.js";
import type { PlayerRepository } from "./player-repository.js";

const API_ORIGIN = "https://sdp-prem-prod.premier-league-prod.pulselive.com";
const COMPETITION_ID = "8";
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 60 * 1000;
const ACCESS_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const TRANSPORT_RETRY_DELAY_MS = 250;
const MAX_TRANSPORT_ATTEMPTS = 2;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const PAGE_LIMIT = 100;
const MAX_LEADERBOARD_PAGES = 12;
const MAX_PLAYER_RECORDS = PAGE_LIMIT * MAX_LEADERBOARD_PAGES;
const MAX_SQUAD_REQUESTS = 25;
const SQUAD_CONCURRENCY = 4;
const LEADERBOARD_CONCURRENCY = 3;
const MAX_SEASON_ID = 2100;
const LEADERBOARD_SORT_FIELDS = [
  "goals",
  "goal_assists",
  "key_passes_attempt_assists",
  "successful_dribbles",
  "tackles_won",
  "interceptions",
  "recoveries",
  "forward_passes",
  "aerial_duels_won",
] as const;
const MERGED_STAT_FIELDS = [
  "timePlayed",
  "appearances",
  "goals",
  "goalAssists",
  "keyPassesAttemptAssists",
  "successfulDribbles",
  "totalTackles",
  "tacklesWon",
  "interceptions",
  "recoveries",
  "forwardPasses",
  "aerialDuelsWon",
] as const;

interface CacheEntry {
  expiresAt: number;
  promise: Promise<PlayerProfile[]>;
}

interface MetricField {
  key: SupplementaryMetricKey;
  field: string;
  label: string;
  definition: string;
}

interface PlayerRow {
  playerId: string;
  name: string;
  team: string;
  teamId: string;
  position: Position;
  stats: Record<string, unknown>;
}

export type PremierLeagueProviderErrorCode =
  | "invalid_configuration"
  | "network"
  | "timeout"
  | "blocked"
  | "rate_limit"
  | "request_failed"
  | "redirect_rejected"
  | "response_too_large"
  | "invalid_response";

export class PremierLeagueProviderError extends Error {
  constructor(readonly code: PremierLeagueProviderErrorCode, message: string) {
    super(message);
    this.name = "PremierLeagueProviderError";
  }
}

export interface PremierLeagueRepositoryOptions {
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
  now?: () => Date;
  seasonId?: string;
}

const metricFields: readonly MetricField[] = [
  {
    key: "premierLeagueGoalsPer90",
    field: "goals",
    label: "Premier League 进球 /90",
    definition: "Premier League 当前赛季来源统计字段 `goals`，按 `timePlayed` 分钟归一到每 90 分钟；只表示已记录进球产出，不表示终结能力或未来进球预测。",
  },
  {
    key: "premierLeagueAssistsPer90",
    field: "goalAssists",
    label: "Premier League 助攻 /90",
    definition: "Premier League 当前赛季来源统计字段 `goalAssists`，按 `timePlayed` 分钟归一到每 90 分钟；只表示已记录助攻，不代表机会创造质量。",
  },
  {
    key: "premierLeagueKeyPassesPer90",
    field: "keyPassesAttemptAssists",
    label: "Premier League 关键传球 /90",
    definition: "Premier League 当前赛季来源字段 `keyPassesAttemptAssists`，按 `timePlayed` 分钟归一到每 90 分钟；按官方球员统计页面的 Key Passes 类别报告，不代表机会质量或完整创造力。",
  },
  {
    key: "premierLeagueSuccessfulDribblesPer90",
    field: "successfulDribbles",
    label: "Premier League 成功盘带 /90",
    definition: "Premier League 当前赛季来源字段 `successfulDribbles`，按 `timePlayed` 分钟归一到每 90 分钟；表示成功盘带次数，不说明推进距离、方向或推进后的场地价值。",
  },
  {
    key: "premierLeagueTotalTacklesPer90",
    field: "totalTackles",
    label: "Premier League 抢断动作 /90",
    definition: "Premier League 当前赛季来源字段 `totalTackles`，按 `timePlayed` 分钟归一到每 90 分钟；保留来源抢断动作口径，不等同于全部防守参与或抢断成功率。",
  },
  {
    key: "premierLeagueTacklesWonPer90",
    field: "tacklesWon",
    label: "Premier League 成功抢断 /90",
    definition: "Premier League 当前赛季来源字段 `tacklesWon`，按 `timePlayed` 分钟归一到每 90 分钟；保留来源成功抢断定义，不等同于整体对抗成功率。",
  },
  {
    key: "premierLeagueInterceptionsPer90",
    field: "interceptions",
    label: "Premier League 拦截 /90",
    definition: "Premier League 当前赛季来源字段 `interceptions`，按 `timePlayed` 分钟归一到每 90 分钟；表示记录到的拦截次数，不揭示防线位置或压迫协同。",
  },
  {
    key: "premierLeagueRecoveriesPer90",
    field: "recoveries",
    label: "Premier League 球权恢复 /90",
    definition: "Premier League 当前赛季来源字段 `recoveries`，按 `timePlayed` 分钟归一到每 90 分钟；表示来源记录的球权恢复次数，不揭示发生区域或压迫结构。",
  },
  {
    key: "premierLeagueForwardPassesPer90",
    field: "forwardPasses",
    label: "Premier League 向前传球 /90",
    definition: "Premier League 当前赛季来源字段 `forwardPasses`，按 `timePlayed` 分钟归一到每 90 分钟；仅表示向前传球次数，不等同于渐进传球、穿透防线或推进价值。",
  },
  {
    key: "premierLeagueAerialDuelsWonPer90",
    field: "aerialDuelsWon",
    label: "Premier League 空中对抗胜出 /90",
    definition: "Premier League 当前赛季来源字段 `aerialDuelsWon`，按 `timePlayed` 分钟归一到每 90 分钟；表示空中对抗胜出次数，不等同于争顶成功率。",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() && value.length <= 80) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function currentSeasonId(now: Date): string {
  const year = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  if (year < 1992 || year > MAX_SEASON_ID) {
    throw new PremierLeagueProviderError("invalid_configuration", "The current Premier League season could not be derived from the configured date.");
  }
  return String(year);
}

function displaySeason(seasonId: string): string {
  const start = Number(seasonId);
  return `${start}/${String(start + 1).slice(-2)}`;
}

function position(value: unknown): Position | undefined {
  if (typeof value !== "string") return undefined;
  switch (value.trim().toLowerCase()) {
    case "goalkeeper": return "GK";
    case "defender": return "DEF";
    case "midfielder": return "MID";
    case "forward": return "ATT";
    default: return undefined;
  }
}

function birthDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
    ? value
    : undefined;
}

function ageFromBirthDate(value: string | undefined, now: Date): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  let age = now.getUTCFullYear() - year!;
  if (now.getUTCMonth() < month! - 1 || (now.getUTCMonth() === month! - 1 && now.getUTCDate() < day!)) age -= 1;
  return age >= 15 && age <= 50 ? age : null;
}

function teamPlayerKey(teamId: string, playerId: string): string {
  return `${teamId}:${playerId}`;
}

function mapRows(rows: PlayerRow[], season: string, retrievedAt: Date, agesByIdentity: Map<string, string>): PlayerProfile[] {
  const retrievedAtText = retrievedAt.toISOString();
  const output: PlayerProfile[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const stats = row.stats;
    const { playerId, teamId, team: teamName, name, position: positionGroup } = row;
    const minutes = nonNegativeNumber(stats.timePlayed) ?? 0;
    if (seen.has(playerId)) {
      throw new PremierLeagueProviderError("invalid_response", "Premier League leaderboard contains a duplicate player ID.");
    }
    seen.add(playerId);

    const age = ageFromBirthDate(agesByIdentity.get(teamPlayerKey(teamId, playerId)), retrievedAt);
    const sourceStats: Record<string, number | undefined> = {};
    for (const key of ["goals", "goalAssists", "keyPassesAttemptAssists", "totalTackles", "interceptions"] as const) {
      sourceStats[key] = nonNegativeNumber(stats[key]);
    }
    const supplementaryMetrics: SupplementaryPerformanceMetric[] = metricFields.flatMap((field) => {
      const total = nonNegativeNumber(stats[field.field]);
      if (total === undefined) return [];
      return [{
        key: field.key,
        definition: field.definition,
        value: minutes > 0 ? Math.round(total * 90 / minutes * 100) / 100 : null,
        unit: "次/90分钟",
        normalization: "per90" as const,
        sourceField: field.field,
        sampleMinutes: minutes,
        sampleMatches: nonNegativeNumber(stats.appearances) === undefined ? null : Math.floor(stats.appearances as number),
      }];
    });
    const availableStats = [
      ...(sourceStats.goals === undefined ? [] : ["goals" as const]),
      ...(sourceStats.goalAssists === undefined ? [] : ["assists" as const]),
      ...(sourceStats.keyPassesAttemptAssists === undefined ? [] : ["keyPasses" as const]),
      ...(sourceStats.totalTackles === undefined ? [] : ["tackles" as const]),
      ...(sourceStats.interceptions === undefined ? [] : ["interceptions" as const]),
    ];
    output.push(PlayerProfileSchema.parse({
      playerId: `premier-league:${playerId}:season:${season}`,
      externalPlayerId: playerId,
      name,
      team: teamName,
      age,
      ...(age === null ? {} : { ageSource: "Premier League same-season squad birth date", ageVerifiedAt: retrievedAtText }),
      position: positionGroup,
      competition: "英超",
      season,
      minutes,
      ...(nonNegativeNumber(stats.appearances) === undefined ? {} : { appearanceMatchCount: Math.floor(stats.appearances as number) }),
      stats: {
        goals: sourceStats.goals ?? 0,
        assists: sourceStats.goalAssists ?? 0,
        passesAttempted: 0,
        passesCompleted: 0,
        longPasses: 0,
        carries: 0,
        pressures: 0,
        tackles: sourceStats.totalTackles ?? 0,
        interceptions: sourceStats.interceptions ?? 0,
        shotAssists: 0,
        keyPasses: sourceStats.keyPassesAttemptAssists ?? 0,
      },
      availableStats,
      supplementaryMetrics,
      sourceIdentity: {
        provider: "premier-league-pulselive",
        playerId,
        teamId,
        competitionId: "premier-league",
        seasonId: season,
        positionGroup,
        retrievedAt: retrievedAtText,
        isCurrentSeason: true,
      },
      source: `Premier League 当前赛季比赛统计 · ${season}`,
    }));
  }
  if (output.length === 0) {
    throw new PremierLeagueProviderError("invalid_response", "Premier League leaderboard contained no supported player performance records.");
  }
  return output;
}

function sanitiseTransportError(error: unknown): PremierLeagueProviderError {
  const redirect = error instanceof TypeError && /redirect/i.test(error.message);
  const timeout = error instanceof Error && error.name === "TimeoutError";
  return new PremierLeagueProviderError(redirect ? "redirect_rejected" : timeout ? "timeout" : "network", redirect
    ? "Premier League redirected the request; redirects are disabled."
    : timeout ? "Premier League did not return a complete response before the request timeout."
      : "Premier League could not be reached; no proxy or alternate host was tried.");
}

async function fetchJson(fetchImpl: typeof fetch, url: URL): Promise<unknown> {
  for (let attempt = 0; attempt < MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept: "application/json", "user-agent": "TactiScout/0.1 local scouting prototype" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "error",
      });
      if (response.status === 401 || response.status === 403) {
        throw new PremierLeagueProviderError("blocked", `Premier League denied the request with HTTP ${response.status}.`);
      }
      if (response.status === 429) {
        throw new PremierLeagueProviderError("rate_limit", "Premier League rate-limited the request with HTTP 429. No retry was made.");
      }
      if (!response.ok) throw new PremierLeagueProviderError("request_failed", `Premier League returned HTTP ${response.status}.`);
      if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
        throw new PremierLeagueProviderError("invalid_response", "Premier League did not return JSON.");
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        throw new PremierLeagueProviderError("response_too_large", "Premier League response exceeded the configured size limit.");
      }
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        throw sanitiseTransportError(error);
      }
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        throw new PremierLeagueProviderError("response_too_large", "Premier League response exceeded the configured size limit.");
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new PremierLeagueProviderError("invalid_response", "Premier League returned malformed JSON.");
      }
    } catch (error) {
      const providerError = error instanceof PremierLeagueProviderError ? error : sanitiseTransportError(error);
      const retryable = providerError.code === "network" || providerError.code === "timeout";
      if (!retryable || attempt + 1 >= MAX_TRANSPORT_ATTEMPTS) throw providerError;
      await new Promise((resolve) => setTimeout(resolve, TRANSPORT_RETRY_DELAY_MS));
    }
  }
  throw new PremierLeagueProviderError("network", "Premier League transport attempts were exhausted.");
}

function nextPageUrl(value: unknown, current: URL): URL | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new PremierLeagueProviderError("invalid_response", "Premier League pagination cursor has an unsupported shape.");
  let cursorRoute: URL;
  try {
    cursorRoute = new URL(value, API_ORIGIN);
  } catch {
    throw new PremierLeagueProviderError("invalid_response", "Premier League pagination cursor is malformed.");
  }
  if (cursorRoute.origin !== API_ORIGIN || cursorRoute.username || cursorRoute.password || cursorRoute.hash || cursorRoute.search) {
    throw new PremierLeagueProviderError("invalid_response", "Premier League returned a pagination cursor outside the source host.");
  }
  const cursor = /^\/[A-Za-z0-9_-]{8,240}$/.test(cursorRoute.pathname) ? cursorRoute.pathname.slice(1) : "";
  if (!/^[A-Za-z0-9_-]{8,240}$/.test(cursor) || current.searchParams.get("_next") === cursor) {
    throw new PremierLeagueProviderError("invalid_response", "Premier League returned a malformed or repeating pagination cursor.");
  }
  const next = new URL(current);
  next.searchParams.set("_next", cursor);
  return next;
}

async function loadPagedData(fetchImpl: typeof fetch, firstPage: URL, sourceLabel: string): Promise<unknown[]> {
  let pageUrl: URL | undefined = new URL(firstPage);
  let pages = 0;
  let rows: unknown[] = [];
  const visited = new Set<string>([pageUrl.href]);
  while (pageUrl) {
    if (pages >= MAX_LEADERBOARD_PAGES) throw new PremierLeagueProviderError("invalid_response", `Premier League ${sourceLabel} exceeded its bounded pagination limit.`);
    pages += 1;
    const payload = await fetchJson(fetchImpl, pageUrl);
    if (!isRecord(payload) || !Array.isArray(payload.data) || !isRecord(payload.pagination)) {
      throw new PremierLeagueProviderError("invalid_response", `Premier League ${sourceLabel} response is missing its player page or pagination metadata.`);
    }
    rows = rows.concat(payload.data);
    if (rows.length > MAX_PLAYER_RECORDS) {
      throw new PremierLeagueProviderError("invalid_response", `Premier League ${sourceLabel} exceeded the configured player-record limit.`);
    }
    const next = nextPageUrl(payload.pagination._next, pageUrl);
    if (next && visited.has(next.href)) throw new PremierLeagueProviderError("invalid_response", `Premier League ${sourceLabel} returned a repeating pagination cursor.`);
    if (next) visited.add(next.href);
    pageUrl = next;
  }
  return rows;
}

function playerRowFromMetadata(metadata: unknown, stats: unknown): PlayerRow | undefined {
  if (!isRecord(metadata) || !isRecord(metadata.currentTeam) || !isRecord(stats)) return undefined;
  const team = metadata.currentTeam;
  const playerId = identifier(metadata.id)
    ?? (isRecord(metadata.id) ? identifier(metadata.id.playerId) : undefined);
  const teamId = identifier(team.id);
  const teamName = typeof team.name === "string" ? team.name.trim() : "";
  const name = typeof metadata.name === "string"
    ? metadata.name.trim()
    : isRecord(metadata.name)
      ? [metadata.name.firstName, metadata.name.lastName].flatMap((part) => typeof part === "string" ? [part.trim()] : []).filter(Boolean).join(" ")
      : "";
  const positionGroup = position(metadata.position);
  if (!playerId || !teamId || !teamName || !name || !positionGroup) return undefined;
  return { playerId, name, team: teamName, teamId, position: positionGroup, stats: { ...stats } };
}

async function loadPlayerDirectory(fetchImpl: typeof fetch, seasonId: string): Promise<PlayerRow[]> {
  const url = new URL(`/api/v1/competitions/${COMPETITION_ID}/seasons/${seasonId}/players`, API_ORIGIN);
  url.searchParams.set("_limit", String(PAGE_LIMIT));
  const records = await loadPagedData(fetchImpl, url, "player directory");
  const rows = records.flatMap((record): PlayerRow[] => {
    if (!isRecord(record)) return [];
    const row = playerRowFromMetadata(record, {});
    return row ? [row] : [];
  });
  const seen = new Set<string>();
  for (const row of rows) {
    const key = teamPlayerKey(row.teamId, row.playerId);
    if (seen.has(key)) throw new PremierLeagueProviderError("invalid_response", "Premier League player directory contains a duplicate player and team identity.");
    seen.add(key);
  }
  if (rows.length === 0) throw new PremierLeagueProviderError("invalid_response", "Premier League player directory contained no supported current-season players.");
  return rows;
}

async function loadLeaderboard(fetchImpl: typeof fetch, seasonId: string, sortField: typeof LEADERBOARD_SORT_FIELDS[number]): Promise<PlayerRow[]> {
  const url = new URL(`/api/v3/competitions/${COMPETITION_ID}/seasons/${seasonId}/players/stats/leaderboard`, API_ORIGIN);
  url.searchParams.set("_sort", `${sortField}:desc`);
  url.searchParams.set("_limit", String(PAGE_LIMIT));
  const records = await loadPagedData(fetchImpl, url, `${sortField} leaderboard`);
  return records.flatMap((record): PlayerRow[] => {
    if (!isRecord(record) || !isRecord(record.playerMetadata)) return [];
    const row = playerRowFromMetadata(record.playerMetadata, record.stats);
    return row ? [row] : [];
  });
}

async function loadAllLeaderboardRows(fetchImpl: typeof fetch, seasonId: string): Promise<PlayerRow[]> {
  const results: PlayerRow[][] = Array.from({ length: LEADERBOARD_SORT_FIELDS.length }, () => []);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(LEADERBOARD_CONCURRENCY, LEADERBOARD_SORT_FIELDS.length) }, async () => {
    while (nextIndex < LEADERBOARD_SORT_FIELDS.length) {
      const index = nextIndex++;
      results[index] = await loadLeaderboard(fetchImpl, seasonId, LEADERBOARD_SORT_FIELDS[index]!);
    }
  });
  await Promise.all(workers);
  return results.flat();
}

function mergeLeaderboardStats(directory: readonly PlayerRow[], statsRows: readonly PlayerRow[]): PlayerRow[] {
  const byIdentity = new Map(directory.map((row) => [teamPlayerKey(row.teamId, row.playerId), row]));
  for (const statRow of statsRows) {
    const target = byIdentity.get(teamPlayerKey(statRow.teamId, statRow.playerId));
    if (!target) continue;
    for (const field of MERGED_STAT_FIELDS) {
      const metric = nonNegativeNumber(statRow.stats[field]);
      if (metric !== undefined) target.stats[field] = metric;
    }
  }
  return [...byIdentity.values()];
}

async function squadBirthDates(fetchImpl: typeof fetch, seasonId: string, teamIds: readonly string[]): Promise<Map<string, string>> {
  if (teamIds.length > MAX_SQUAD_REQUESTS) {
    throw new PremierLeagueProviderError("invalid_response", "Premier League leaderboard referenced more teams than the squad enrichment limit.");
  }
  const birthDates = new Map<string, string>();
  let nextIndex = 0;
  let accessFailure: PremierLeagueProviderError | undefined;
  const workers = Array.from({ length: Math.min(SQUAD_CONCURRENCY, teamIds.length) }, async () => {
    while (nextIndex < teamIds.length && !accessFailure) {
      const teamId = teamIds[nextIndex++]!;
      const url = new URL(`/api/v2/competitions/${COMPETITION_ID}/seasons/${seasonId}/teams/${encodeURIComponent(teamId)}/squad`, API_ORIGIN);
      try {
        const payload = await fetchJson(fetchImpl, url);
        if (!isRecord(payload) || !Array.isArray(payload.players)) continue;
        const responseTeamId = isRecord(payload.team) ? identifier(payload.team.id) : identifier(payload.id);
        if (responseTeamId !== undefined && responseTeamId !== teamId) continue;
        for (const player of payload.players) {
          if (!isRecord(player)) continue;
          const playerId = identifier(player.id);
          const date = isRecord(player.dates) ? birthDate(player.dates.birth) : undefined;
          if (playerId && date) birthDates.set(teamPlayerKey(teamId, playerId), date);
        }
      } catch (error) {
        const providerError = error instanceof PremierLeagueProviderError ? error : sanitiseTransportError(error);
        if (providerError.code === "blocked" || providerError.code === "rate_limit") accessFailure = providerError;
      }
    }
  });
  await Promise.all(workers);
  if (accessFailure) throw accessFailure;
  return birthDates;
}

async function loadCurrentPlayers(fetchImpl: typeof fetch, seasonId: string, now: () => Date): Promise<PlayerProfile[]> {
  const directory = await loadPlayerDirectory(fetchImpl, seasonId);
  const leaderboardRows = await loadAllLeaderboardRows(fetchImpl, seasonId);
  const rows = mergeLeaderboardStats(directory, leaderboardRows);
  const teamIds = [...new Set(rows.map((row) => row.teamId))].sort();
  const birthDates = await squadBirthDates(fetchImpl, seasonId, teamIds);
  return mapRows(rows, displaySeason(seasonId), now(), birthDates);
}

export class PremierLeaguePlayerRepository implements PlayerRepository {
  readonly mode = "premier_league" as const;
  readonly sourceName = "Premier League 当前赛季比赛统计 · Pulselive";
  private cached?: CacheEntry;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly now: () => Date;
  private readonly seasonId: string;

  constructor(options: PremierLeagueRepositoryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? (() => new Date());
    const seasonId = options.seasonId ?? currentSeasonId(this.now());
    if (!/^\d{4}$/.test(seasonId) || Number(seasonId) < 1992 || Number(seasonId) > MAX_SEASON_ID) {
      throw new PremierLeagueProviderError("invalid_configuration", "Premier League season ID must be a supported four-digit season start year.");
    }
    this.seasonId = seasonId;
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 0) {
      throw new PremierLeagueProviderError("invalid_configuration", "Premier League cache lifetime must be a non-negative number of milliseconds.");
    }
  }

  loadPlayers(refresh = false): Promise<PlayerProfile[]> {
    const nowMs = this.now().getTime();
    if (!refresh && this.cached && this.cached.expiresAt > nowMs) return this.cached.promise;
    const entry: CacheEntry = { expiresAt: nowMs + this.cacheTtlMs, promise: Promise.resolve([]) };
    entry.promise = loadCurrentPlayers(this.fetchImpl, this.seasonId, this.now).catch((error: unknown) => {
      if (this.cached === entry) {
        const restricted = error instanceof PremierLeagueProviderError
          && (error.code === "blocked" || error.code === "rate_limit");
        entry.expiresAt = this.now().getTime() + (restricted ? ACCESS_FAILURE_COOLDOWN_MS : FAILURE_COOLDOWN_MS);
      }
      throw error;
    });
    this.cached = entry;
    return entry.promise;
  }
}
