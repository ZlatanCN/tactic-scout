import {
  PlayerProfileSchema,
  SupplementaryCapabilityMetricDefinitions,
  type PlayerProfile,
  type Position,
  type SupplementaryMetricKey,
  type SupplementaryPerformanceMetric,
} from "../domain/schemas.js";
import { positionMatches } from "../domain/positions.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import type { PlayerRepository, PlayerSearchPage, PlayerSearchQuery } from "./provider.js";
import { throwIfAborted, signalWithTimeout } from "../domain/abort.js";
import { SharedCancellableLoad } from "./shared-cancellable-load.js";

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
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
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

export type UnderstatProviderErrorCode =
  | "invalid_configuration"
  | "network"
  | "timeout"
  | "blocked"
  | "rate_limit"
  | "request_failed"
  | "redirect_rejected"
  | "unsupported_scope"
  | "response_too_large"
  | "invalid_response";

export class UnderstatProviderError extends Error {
  constructor(readonly code: UnderstatProviderErrorCode, message: string) {
    super(message);
    this.name = "UnderstatProviderError";
  }
}

export interface UnderstatRepositoryOptions {
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
  now?: () => Date;
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

function broadPosition(value: unknown): Position | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.trim().toUpperCase().split(/\s+/);
  if (parts.includes("GK")) return "GK";
  if (parts.includes("D")) return "DEF";
  if (parts.includes("M")) return "MID";
  if (parts.includes("F") || parts.includes("S")) return "ATT";
  return undefined;
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

async function boundedResponseText(response: Response, competitionLabel: string, signal?: AbortSignal): Promise<string> {
  if (!response.body) {
    throw new UnderstatProviderError("invalid_response", `Understat ${competitionLabel} 接口没有返回响应内容。`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const result = await reader.read();
      throwIfAborted(signal);
      if (result.done) break;
      byteLength += result.value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new UnderstatProviderError("response_too_large", `Understat ${competitionLabel} 响应超过大小上限。`);
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (error instanceof UnderstatProviderError) throw error;
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new UnderstatProviderError(timeout ? "timeout" : "network", `Understat ${competitionLabel} 响应读取${timeout ? "超时" : "失败"}。`);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
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
    const position = broadPosition(row.position);
    if (!id || !name || !team || !position) continue;
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
  fetchImpl: typeof fetch,
  competition: typeof COMPETITIONS[number],
  seasonStartYear: number,
  retrievedAt: Date,
  signal?: AbortSignal,
): Promise<PlayerProfile[]> {
  const pageUrl = `${ORIGIN}/league/${competition.slug}/${seasonStartYear}`;
  const endpoint = `${ORIGIN}/getLeagueData/${competition.slug}/${seasonStartYear}`;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        accept: "application/json",
        "x-requested-with": "XMLHttpRequest",
        referer: pageUrl,
      },
      signal: signalWithTimeout(signal, REQUEST_TIMEOUT_MS),
      redirect: "manual",
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new UnderstatProviderError(timeout ? "timeout" : "network", `Understat ${competition.label} 请求${timeout ? "超时" : "失败"}；没有尝试备用域名或代理。`);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new UnderstatProviderError("redirect_rejected", `Understat ${competition.label} 接口返回重定向，已停止请求。`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new UnderstatProviderError("blocked", `Understat ${competition.label} 接口拒绝访问（HTTP ${response.status}）。`);
  }
  if (response.status === 429) {
    throw new UnderstatProviderError("rate_limit", `Understat ${competition.label} 接口触发限流（HTTP 429）；本次未重试。`);
  }
  if (!response.ok) {
    throw new UnderstatProviderError("request_failed", `Understat ${competition.label} 接口返回 HTTP ${response.status}。`);
  }
  const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (!new Set(["application/json", "text/javascript", "application/javascript"]).has(contentType)) {
    throw new UnderstatProviderError("invalid_response", `Understat ${competition.label} 接口没有返回 JSON。`);
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new UnderstatProviderError("response_too_large", `Understat ${competition.label} 响应超过大小上限。`);
  }
  const text = await boundedResponseText(response, competition.label, signal);
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new UnderstatProviderError("invalid_response", `Understat ${competition.label} 返回了无法解析的 JSON。`);
  }
  return mapCompetitionPlayers(payload, competition, seasonStartYear, retrievedAt);
}

async function requestPlayers(fetchImpl: typeof fetch, now: () => Date, signal?: AbortSignal): Promise<PlayerProfile[]> {
  const retrievedAt = now();
  const seasonStartYear = currentSeasonStartYear(retrievedAt);
  const output: PlayerProfile[] = [];
  // Keep the five public page reads sequential and bounded to avoid a burst against the source.
  for (const competition of COMPETITIONS) {
    throwIfAborted(signal);
    output.push(...await requestCompetition(fetchImpl, competition, seasonStartYear, retrievedAt, signal));
  }
  return output;
}

export class UnderstatPlayerRepository implements PlayerRepository {
  readonly mode = "understat" as const;
  readonly sourceName = "Understat · 五大联赛当前赛季表现池";
  private cached?: CacheEntry;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly now: () => Date;

  constructor(options: UnderstatRepositoryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? (() => new Date());
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 0) {
      throw new UnderstatProviderError("invalid_configuration", "Understat 缓存时间必须是非负毫秒数。");
    }
  }

  loadPlayers(refresh = false, signal?: AbortSignal): Promise<PlayerProfile[]> {
    throwIfAborted(signal);
    const nowMs = this.now().getTime();
    // LangGraph may revisit the provider while reviewing the same case; keep a stable snapshot per process.
    void refresh;
    if (this.cached && this.cached.expiresAt > nowMs) return this.cached.load.subscribe(signal);
    const entry: CacheEntry = { expiresAt: nowMs + this.cacheTtlMs, load: new SharedCancellableLoad((requestSignal) => requestPlayers(this.fetchImpl, this.now, requestSignal)) };
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
    if (query.maxAge !== null) {
      throw new UnderstatProviderError("unsupported_scope", "Understat 未提供出生日期或年龄，无法执行年龄上限筛选；请先确认是否移除年龄条件，或改用可核验年龄的数据源。");
    }
    const players = await this.loadPlayers(false, signal);
    throwIfAborted(signal);
    const matching = players.filter((player) => {
      if (query.playerName && !normalizeSearchText(player.name).includes(normalizeSearchText(query.playerName))) return false;
      if (query.position && !positionMatches(player.position, query.position)) return false;
      if (player.minutes < query.minimumMinutes) return false;
      if (query.competition && !normalizeSearchText(player.competition).includes(normalizeSearchText(query.competition))) return false;
      if (query.season && !normalizeSearchText(player.season).includes(normalizeSearchText(query.season))) return false;
      return true;
    });
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
        if (player) interleaved.push(player);
      }
    }
    const playersOnPage = interleaved.slice(query.offset, query.offset + query.limit);
    const appliedFilters: PlayerSearchPage["appliedFilters"] = [];
    if (query.playerName) appliedFilters.push("playerName");
    if (query.position) appliedFilters.push("position");
    if (query.minimumMinutes > 0) appliedFilters.push("minimumMinutes");
    if (query.competition) appliedFilters.push("competition");
    if (query.season) appliedFilters.push("season");
    return {
      players: playersOnPage,
      totalRecords: interleaved.length,
      offset: query.offset,
      nextOffset: query.offset + playersOnPage.length < interleaved.length ? query.offset + playersOnPage.length : null,
      appliedFilters,
    };
  }
}
