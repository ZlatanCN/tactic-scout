import {
  PlayerProfileSchema,
  type PlayerProfile,
  type Position,
  type SupplementaryMetricKey,
  type SupplementaryPerformanceMetric,
} from "../domain/schemas.js";
import type { PlayerRepository } from "./player-repository.js";

const BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 60 * 1000;
const ACCESS_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const TRANSPORT_RETRY_DELAY_MS = 250;
const MAX_TRANSPORT_ATTEMPTS = 2;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

interface CacheEntry {
  expiresAt: number;
  promise: Promise<PlayerProfile[]>;
}

interface MetricField {
  key: SupplementaryMetricKey;
  field: string;
  label: string;
  definition: string;
  unit: string;
}

interface ProviderIdentifier {
  provider: string;
  namespace: string;
  externalId: string;
  sourceField: string;
}

const metricFields: readonly MetricField[] = [
  {
    key: "fplExpectedGoalsPer90",
    field: "expected_goals",
    label: "FPL xG",
    definition: "Fantasy Premier League 当前赛季 `expected_goals` 总量按来源分钟数归一到每 90 分钟；是来源 xG 模型对已获得射门机会的估计，不代表终结能力或未来进球保证。",
    unit: "xG/90分钟",
  },
  {
    key: "fplExpectedAssistsPer90",
    field: "expected_assists",
    label: "FPL xA",
    definition: "Fantasy Premier League 当前赛季 `expected_assists` 总量按来源分钟数归一到每 90 分钟；是来源对传球最终形成助攻机会的估计，不等同于关键传球数。",
    unit: "xA/90分钟",
  },
  {
    key: "fplExpectedGoalInvolvementsPer90",
    field: "expected_goal_involvements",
    label: "FPL xGI",
    definition: "Fantasy Premier League 当前赛季 `expected_goal_involvements` 总量按来源分钟数归一到每 90 分钟；这是来源提供的 xG 与 xA 综合字段，不代表完整进攻贡献。",
    unit: "xGI/90分钟",
  },
  {
    key: "fplTacklesPer90",
    field: "tackles",
    label: "FPL 抢断",
    definition: "Fantasy Premier League 当前赛季 `tackles` 总量按来源分钟数归一到每 90 分钟；保留来源动作定义，不等同于抢断成功率或全部防守贡献。",
    unit: "次/90分钟",
  },
  {
    key: "fplRecoveriesPer90",
    field: "recoveries",
    label: "FPL 球权恢复",
    definition: "Fantasy Premier League 当前赛季 `recoveries` 总量按来源分钟数归一到每 90 分钟；是来源记录的球权恢复动作次数，不揭示发生位置或球队压迫结构。",
    unit: "次/90分钟",
  },
  {
    key: "fplClearancesBlocksInterceptionsPer90",
    field: "clearances_blocks_interceptions",
    label: "FPL 解围、封堵与拦截",
    definition: "Fantasy Premier League 当前赛季 `clearances_blocks_interceptions` 合并总量按来源分钟数归一到每 90 分钟；来源未拆分三种动作，不能解释为单独拦截数。",
    unit: "次/90分钟",
  },
];

export type PremierLeagueFantasyProviderErrorCode =
  | "invalid_configuration"
  | "network"
  | "timeout"
  | "blocked"
  | "rate_limit"
  | "request_failed"
  | "redirect_rejected"
  | "response_too_large"
  | "invalid_response";

export class PremierLeagueFantasyProviderError extends Error {
  constructor(readonly code: PremierLeagueFantasyProviderErrorCode, message: string) {
    super(message);
    this.name = "PremierLeagueFantasyProviderError";
  }
}

export interface PremierLeagueFantasyRepositoryOptions {
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
  now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function seasonFromEvents(events: unknown): string {
  if (!Array.isArray(events)) throw new PremierLeagueFantasyProviderError("invalid_response", "Fantasy Premier League returned no valid season calendar.");
  const deadlines = events.flatMap((event) => {
    if (!isRecord(event) || typeof event.deadline_time !== "string") return [];
    const time = Date.parse(event.deadline_time);
    return Number.isFinite(time) ? [time] : [];
  });
  if (!deadlines.length) throw new PremierLeagueFantasyProviderError("invalid_response", "Fantasy Premier League returned no valid season start date.");
  const firstYear = new Date(Math.min(...deadlines)).getUTCFullYear();
  return `${firstYear}/${String(firstYear + 1).slice(-2)}`;
}

function ageFromBirthDate(value: unknown, now: Date): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) return null;
  let age = now.getUTCFullYear() - year;
  const hadBirthday = now.getUTCMonth() > month - 1 || (now.getUTCMonth() === month - 1 && now.getUTCDate() >= day);
  if (!hadBirthday) age -= 1;
  return age >= 15 && age <= 50 ? age : null;
}

function positionMap(value: unknown): Map<number, Position> {
  if (!Array.isArray(value)) throw new PremierLeagueFantasyProviderError("invalid_response", "Fantasy Premier League returned no position catalog.");
  const positions = new Map<number, Position>();
  const expected: Record<string, Position> = { GKP: "GK", DEF: "DEF", MID: "MID", FWD: "ATT" };
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = integer(item.id);
    const shortName = typeof item.singular_name_short === "string" ? item.singular_name_short : "";
    const position = expected[shortName];
    if (id !== undefined && position) positions.set(id, position);
  }
  if (Object.keys(expected).some((shortName) => ![...positions.values()].includes(expected[shortName]))) {
    throw new PremierLeagueFantasyProviderError("invalid_response", "Fantasy Premier League position catalog does not match the supported broad positions.");
  }
  return positions;
}

function teamMap(value: unknown): Map<number, string> {
  if (!Array.isArray(value)) throw new PremierLeagueFantasyProviderError("invalid_response", "Fantasy Premier League returned no club catalog.");
  const teams = new Map<number, string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = integer(item.id);
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (id !== undefined && name) teams.set(id, name);
  }
  if (!teams.size) throw new PremierLeagueFantasyProviderError("invalid_response", "Fantasy Premier League returned an empty club catalog.");
  return teams;
}

function metricValue(value: unknown, minutes: number): number | null | undefined {
  const total = nonNegativeNumber(value);
  if (total === undefined) return undefined;
  if (minutes <= 0) return null;
  return Math.round(total * 90 / minutes * 100) / 100;
}

function playerName(element: Record<string, unknown>): string | undefined {
  if (typeof element.web_name === "string" && element.web_name.trim()) return element.web_name.trim();
  const first = typeof element.first_name === "string" ? element.first_name.trim() : "";
  const second = typeof element.second_name === "string" ? element.second_name.trim() : "";
  return [first, second].filter(Boolean).join(" ") || undefined;
}

function optaNumericIdentifier(value: unknown): ProviderIdentifier[] {
  if (typeof value !== "string") return [];
  const match = /^p([1-9]\d*)$/.exec(value);
  if (!match) return [];
  return [{
    provider: "opta",
    namespace: "person_numeric",
    externalId: match[1]!,
    sourceField: "opta_code",
  }];
}

function parsePlayers(payload: unknown, retrievedAt: Date): PlayerProfile[] {
  if (!isRecord(payload) || !Array.isArray(payload.elements)) {
    throw new PremierLeagueFantasyProviderError("invalid_response", "Fantasy Premier League response is missing its player directory.");
  }
  const teams = teamMap(payload.teams);
  const positions = positionMap(payload.element_types);
  const season = seasonFromEvents(payload.events);
  const retrievedAtText = retrievedAt.toISOString();
  const output: PlayerProfile[] = [];
  const seenIds = new Set<number>();

  for (const value of payload.elements) {
    if (!isRecord(value)) continue;
    const id = integer(value.id);
    const teamId = integer(value.team);
    const position = positions.get(integer(value.element_type) ?? -1);
    const team = teamId === undefined ? undefined : teams.get(teamId);
    const name = playerName(value);
    if (id === undefined || id <= 0 || teamId === undefined || !team || !position || !name) continue;
    if (seenIds.has(id)) throw new PremierLeagueFantasyProviderError("invalid_response", "Fantasy Premier League player directory contains duplicate player IDs.");
    seenIds.add(id);

    const minutes = nonNegativeNumber(value.minutes) ?? 0;
    const goals = nonNegativeNumber(value.goals_scored);
    const assists = nonNegativeNumber(value.assists);
    const supplementaryMetrics: SupplementaryPerformanceMetric[] = metricFields.flatMap((field) => {
      const metric = metricValue(value[field.field], minutes);
      if (metric === undefined) return [];
      return [{
        key: field.key,
        definition: field.definition,
        value: metric,
        unit: field.unit,
        normalization: "per90" as const,
        sourceField: field.field,
        sampleMinutes: minutes,
        sampleMatches: null,
      }];
    });
    const age = ageFromBirthDate(value.birth_date, retrievedAt);
    const providerIdentifiers = optaNumericIdentifier(value.opta_code);
    output.push(PlayerProfileSchema.parse({
      playerId: `fpl:${id}:team:${teamId}:season:${season}`,
      externalPlayerId: String(id),
      name,
      team,
      age,
      ...(age === null ? {} : { ageSource: "Fantasy Premier League player birth date", ageVerifiedAt: retrievedAtText }),
      position,
      competition: "英超",
      season,
      minutes,
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
        keyPasses: 0,
      },
      availableStats: [
        ...(goals === undefined ? [] : ["goals" as const]),
        ...(assists === undefined ? [] : ["assists" as const]),
      ],
      supplementaryMetrics,
      sourceIdentity: {
        provider: "fantasy-premier-league",
        playerId: String(id),
        ...(providerIdentifiers.length > 0 ? { providerIdentifiers } : {}),
        teamId: String(teamId),
        competitionId: "premier-league",
        seasonId: season,
        positionGroup: position,
        retrievedAt: retrievedAtText,
        isCurrentSeason: true,
      },
      source: `Fantasy Premier League · ${season} 球员与赛季表现`,
    }));
  }
  if (!output.length) throw new PremierLeagueFantasyProviderError("invalid_response", "Fantasy Premier League player directory contained no players assigned to supported clubs and positions.");
  return output;
}

async function requestPlayers(fetchImpl: typeof fetch, now: () => Date): Promise<PlayerProfile[]> {
  for (let attempt = 0; attempt < MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(BOOTSTRAP_URL, {
        headers: { accept: "application/json", "user-agent": "TactiScout/0.1 local research prototype" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "error",
      });
      if (response.status === 403 || response.status === 401) {
        throw new PremierLeagueFantasyProviderError("blocked", `Fantasy Premier League denied the player request with HTTP ${response.status}.`);
      }
      if (response.status === 429) {
        throw new PremierLeagueFantasyProviderError("rate_limit", "Fantasy Premier League rate-limited the player request with HTTP 429. No retry was made.");
      }
      if (!response.ok) throw new PremierLeagueFantasyProviderError("request_failed", `Fantasy Premier League returned HTTP ${response.status}.`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw new PremierLeagueFantasyProviderError("invalid_response", "Fantasy Premier League did not return JSON.");
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        throw new PremierLeagueFantasyProviderError("response_too_large", "Fantasy Premier League player response exceeded the configured size limit.");
      }
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        const timeout = error instanceof Error && error.name === "TimeoutError";
        throw new PremierLeagueFantasyProviderError(timeout ? "timeout" : "network", "Fantasy Premier League response could not be read.");
      }
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        throw new PremierLeagueFantasyProviderError("response_too_large", "Fantasy Premier League player response exceeded the configured size limit.");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new PremierLeagueFantasyProviderError("invalid_response", "Fantasy Premier League returned malformed JSON.");
      }
      return parsePlayers(payload, now());
    } catch (error) {
      const providerError = error instanceof PremierLeagueFantasyProviderError
        ? error
        : (() => {
          const redirect = error instanceof TypeError && /redirect/i.test(error.message);
          const timeout = error instanceof Error && error.name === "TimeoutError";
          return new PremierLeagueFantasyProviderError(redirect ? "redirect_rejected" : timeout ? "timeout" : "network", redirect
            ? "Fantasy Premier League redirected the player request; redirects are disabled."
            : timeout ? "Fantasy Premier League did not return a complete response before the request timeout."
              : "Fantasy Premier League could not be reached; no alternate endpoint or proxy was tried.");
        })();
      const retryable = providerError.code === "network" || providerError.code === "timeout";
      if (!retryable || attempt + 1 >= MAX_TRANSPORT_ATTEMPTS) throw providerError;
      await new Promise((resolve) => setTimeout(resolve, TRANSPORT_RETRY_DELAY_MS));
    }
  }
  throw new PremierLeagueFantasyProviderError("network", "Fantasy Premier League transport attempts were exhausted.");
}

export class PremierLeagueFantasyPlayerRepository implements PlayerRepository {
  readonly mode = "fpl" as const;
  readonly sourceName = "Fantasy Premier League · 英超当前赛季表现";
  private cached?: CacheEntry;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly now: () => Date;

  constructor(options: PremierLeagueFantasyRepositoryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? (() => new Date());
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 0) {
      throw new PremierLeagueFantasyProviderError("invalid_configuration", "FPL cache lifetime must be a non-negative number of milliseconds.");
    }
  }

  loadPlayers(refresh = false): Promise<PlayerProfile[]> {
    const nowMs = this.now().getTime();
    // The graph can revisit the data tool while reviewing a case. Reuse the
    // same bounded snapshot so planner turns do not create repeated requests.
    void refresh;
    if (this.cached && this.cached.expiresAt > nowMs) return this.cached.promise;
    const entry: CacheEntry = { expiresAt: nowMs + this.cacheTtlMs, promise: Promise.resolve([]) };
    entry.promise = requestPlayers(this.fetchImpl, this.now).catch((error: unknown) => {
      if (this.cached === entry) {
        const restricted = error instanceof PremierLeagueFantasyProviderError
          && (error.code === "blocked" || error.code === "rate_limit");
        entry.expiresAt = this.now().getTime() + (restricted ? ACCESS_FAILURE_COOLDOWN_MS : FAILURE_COOLDOWN_MS);
      }
      throw error;
    });
    this.cached = entry;
    return entry.promise;
  }
}
