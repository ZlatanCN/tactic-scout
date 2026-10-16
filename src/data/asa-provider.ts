import {
  PlayerProfileSchema,
  SupplementaryCapabilityMetricDefinitions,
  type PlayerProfile,
  type Position,
  type SupplementaryMetricKey,
  type SupplementaryMetricNormalization,
  type SupplementaryPerformanceMetric,
} from "../domain/schemas.js";
import { positionMatches, positionMatchesRetrieval } from "../domain/positions.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import type { PlayerRepository, PlayerSearchFilter, PlayerSearchPage, PlayerSearchQuery } from "./player-repository.js";
import { throwIfAborted } from "../domain/abort.js";
import { SharedCancellableLoad } from "./shared-cancellable-load.js";

const API_ROOT = "https://app.americansocceranalysis.com/api/v1";
const ASA_COMPETITIONS = [
  { id: "mls", label: "美国职业足球大联盟（MLS）", aliases: ["mls", "major league soccer", "美国职业足球大联盟"] },
  { id: "uslc", label: "美国足球冠军联赛（USL Championship）", aliases: ["uslc", "usl championship", "美国足球冠军联赛"] },
  { id: "usl1", label: "美国足球甲级联赛（USL League One）", aliases: ["usl1", "usl league one", "美国足球甲级联赛"] },
] as const;
const ASA_COMPETITION_GROUPS = [
  { label: "ASA 北美男足赛事", aliases: ["asa 男足赛事", "asa men's competitions", "asa mens competitions", "男足赛事"], competitionIds: ["mls", "uslc", "usl1"] },
  { label: "USL", aliases: ["usl competitions"], competitionIds: ["uslc", "usl1"] },
] as const;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 60 * 1000;
const ACCESS_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const TRANSPORT_RETRY_DELAY_MS = 250;
const MAX_TRANSPORT_ATTEMPTS = 2;
const MAX_RESPONSE_BYTES = 15 * 1024 * 1024;
const MAX_API_ROWS = 1000;
const ENTITY_BATCH_SIZE = 200;

const actionMetricKeys = {
  Dribbling: "asaGoalsAddedDribblingPer90",
  Fouling: "asaGoalsAddedFoulingPer90",
  Interrupting: "asaGoalsAddedInterruptingPer90",
  Passing: "asaGoalsAddedPassingPer90",
  Receiving: "asaGoalsAddedReceivingPer90",
  Shooting: "asaGoalsAddedShootingPer90",
} as const satisfies Record<string, SupplementaryMetricKey>;

type ActionType = keyof typeof actionMetricKeys;

interface CacheEntry {
  expiresAt: number;
  load: SharedCancellableLoad<PlayerProfile[]>;
}

interface ASAStatRow {
  player_id: string;
  team_id: string;
  competition_id: string;
  season_name: string;
  general_position: string;
  minutes_played: number;
  [key: string]: unknown;
}

interface ASAGoalsAddedRow extends ASAStatRow {
  data: Array<{
    action_type: ActionType;
    goals_added_raw?: unknown;
    goals_added_above_avg?: unknown;
    count_actions?: unknown;
  }>;
}

interface ASAPlayerEntity {
  player_id: string;
  player_name: string;
  birth_date?: string | null;
  primary_general_position?: string | null;
}

export type ASAProviderErrorCode =
  | "invalid_configuration"
  | "network"
  | "timeout"
  | "blocked"
  | "rate_limit"
  | "request_failed"
  | "redirect_rejected"
  | "response_too_large"
  | "response_limit"
  | "invalid_response"
  | "unsupported_scope";

export class ASAProviderError extends Error {
  constructor(readonly code: ASAProviderErrorCode, message: string) {
    super(message);
    this.name = "ASAProviderError";
  }
}

export interface ASARepositoryOptions {
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
  now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const parsed = numberValue(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
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

function mapPosition(value: unknown): Position | undefined {
  if (typeof value !== "string") return undefined;
  switch (value.trim().toUpperCase()) {
    case "GK": return "GK";
    case "CB": return "CB";
    case "FB": return "FB";
    case "W": return "WG";
    case "DM": return "DM";
    case "CM": return "CM";
    case "AM": return "AM";
    case "ST": return "ST";
    default: return undefined;
  }
}

function compositeId(competitionId: string, playerId: string, teamId: string, season: string): string {
  return `${competitionId}\u0000${playerId}\u0000${teamId}\u0000${season}`;
}

function addMetric(input: {
  key: SupplementaryMetricKey;
  value: number | undefined;
  minutes: number | undefined;
  unit: string;
  normalization: SupplementaryMetricNormalization;
  sourceField: string;
  sampleAttempts?: number | null;
  definition?: string;
  precision?: number;
}): SupplementaryPerformanceMetric | undefined {
  if (input.value === undefined) return undefined;
  const precision = input.precision ?? 2;
  const value = input.minutes === undefined || input.minutes <= 0
    ? null
    : input.normalization === "per90"
      ? Math.round(input.value * 90 / input.minutes * 10 ** precision) / 10 ** precision
      : input.value;
  const baseDefinition = input.definition
    ?? SupplementaryCapabilityMetricDefinitions.find((metric) => metric.key === input.key)?.definition;
  if (!baseDefinition) throw new ASAProviderError("invalid_response", `ASA metric ${input.key} has no canonical definition.`);
  return {
    key: input.key,
    definition: baseDefinition,
    value,
    unit: input.unit,
    normalization: input.normalization,
    sourceField: input.sourceField,
    sampleMinutes: input.minutes ?? null,
    sampleMatches: null,
    ...(input.sampleAttempts === undefined || input.sampleAttempts === null ? {} : { sampleAttempts: input.sampleAttempts }),
  };
}

function validateStatsRows(payload: unknown, competitionId: string, season: string, endpoint: string): Map<string, ASAStatRow> {
  if (!Array.isArray(payload)) throw new ASAProviderError("invalid_response", `ASA ${endpoint} returned no player-statistics array.`);
  if (payload.length >= MAX_API_ROWS) {
    throw new ASAProviderError("response_limit", `ASA ${endpoint} reached its ${MAX_API_ROWS}-row API limit; the full candidate scope cannot be verified.`);
  }
  const output = new Map<string, ASAStatRow>();
  for (const value of payload) {
    if (!isRecord(value)) throw new ASAProviderError("invalid_response", `ASA ${endpoint} returned a malformed player-statistics row.`);
    const playerId = stringId(value.player_id);
    const teamId = stringId(value.team_id);
    if (!playerId || !teamId || value.season_name !== season) {
      throw new ASAProviderError("invalid_response", `ASA ${endpoint} returned a row without the requested season and exact player/team IDs.`);
    }
    if (!mapPosition(value.general_position)) {
      throw new ASAProviderError("invalid_response", `ASA ${endpoint} returned an unsupported position group for ${competitionId}.`);
    }
    const minutes = nonNegativeNumber(value.minutes_played);
    if (minutes === undefined) throw new ASAProviderError("invalid_response", `ASA ${endpoint} returned invalid player minutes.`);
    const key = compositeId(competitionId, playerId, teamId, season);
    if (output.has(key)) throw new ASAProviderError("invalid_response", `ASA ${endpoint} returned a duplicate player/team/season row.`);
    output.set(key, {
      ...value,
      player_id: playerId,
      team_id: teamId,
      season_name: season,
      minutes_played: minutes,
      competition_id: competitionId,
    } as ASAStatRow);
  }
  return output;
}

function parsePlayerEntities(payload: unknown): Map<string, ASAPlayerEntity> {
  if (!Array.isArray(payload)) throw new ASAProviderError("invalid_response", "ASA player lookup returned no entity array.");
  const output = new Map<string, ASAPlayerEntity>();
  for (const value of payload) {
    if (!isRecord(value)) throw new ASAProviderError("invalid_response", "ASA player lookup returned a malformed entity.");
    const id = stringId(value.player_id);
    const name = typeof value.player_name === "string" ? value.player_name.trim() : "";
    if (!id || !name) continue;
    if (output.has(id)) throw new ASAProviderError("invalid_response", "ASA player lookup returned duplicate player IDs.");
    output.set(id, {
      player_id: id,
      player_name: name,
      birth_date: typeof value.birth_date === "string" ? value.birth_date : null,
      primary_general_position: typeof value.primary_general_position === "string" ? value.primary_general_position : null,
    });
  }
  return output;
}

function parseTeamEntities(payload: unknown): Map<string, string> {
  if (!Array.isArray(payload)) throw new ASAProviderError("invalid_response", "ASA team lookup returned no entity array.");
  const output = new Map<string, string>();
  for (const value of payload) {
    if (!isRecord(value)) throw new ASAProviderError("invalid_response", "ASA team lookup returned a malformed entity.");
    const id = stringId(value.team_id);
    const name = typeof value.team_name === "string" ? value.team_name.trim() : "";
    if (!id || !name) continue;
    if (output.has(id)) throw new ASAProviderError("invalid_response", "ASA team lookup returned duplicate team IDs.");
    output.set(id, name);
  }
  return output;
}

function metricsFor(input: {
  xgoals?: ASAStatRow;
  xpass?: ASAStatRow;
  goalsAdded?: ASAGoalsAddedRow;
}): SupplementaryPerformanceMetric[] {
  const metrics: Array<SupplementaryPerformanceMetric | undefined> = [];
  const xgoals = input.xgoals;
  if (xgoals) {
    const minutes = xgoals.minutes_played;
    const shots = nonNegativeNumber(xgoals.shots);
    const expectedGoals = nonNegativeNumber(xgoals.xgoals);
    metrics.push(addMetric({ key: "asaExpectedGoalsPer90", value: expectedGoals, minutes, unit: "xG/90分钟", normalization: "per90", sourceField: "xgoals" }));
    metrics.push(addMetric({ key: "asaExpectedAssistsPer90", value: nonNegativeNumber(xgoals.xassists), minutes, unit: "xA/90分钟", normalization: "per90", sourceField: "xassists" }));
    metrics.push(addMetric({ key: "asaExpectedGoalContributionsPer90", value: nonNegativeNumber(xgoals.xgoals_plus_xassists), minutes, unit: "xG+xA/90分钟", normalization: "per90", sourceField: "xgoals_plus_xassists" }));
    metrics.push(addMetric({ key: "asaShotsPer90", value: shots, minutes, unit: "次/90分钟", normalization: "per90", sourceField: "shots", sampleAttempts: shots ?? null }));
    metrics.push(addMetric({ key: "asaExpectedGoalsPerShot", value: expectedGoals !== undefined && shots !== undefined && shots > 0 ? expectedGoals / shots : undefined, minutes, unit: "xG/次射门", normalization: "perShot", sourceField: "xgoals ÷ shots", sampleAttempts: shots ?? null }));
  }
  const xpass = input.xpass;
  if (xpass) {
    const minutes = xpass.minutes_played;
    const attemptedPasses = nonNegativeNumber(xpass.attempted_passes);
    const passCompletion = numberValue(xpass.pass_completion_percentage);
    const xpassCompletion = numberValue(xpass.xpass_completion_percentage);
    metrics.push(addMetric({ key: "asaPassCompletionPct", value: passCompletion !== undefined && passCompletion >= 0 && passCompletion <= 100 ? passCompletion : undefined, minutes, unit: "%", normalization: "percentage", sourceField: "pass_completion_percentage", sampleAttempts: attemptedPasses ?? null }));
    metrics.push(addMetric({ key: "asaExpectedPassCompletionPct", value: xpassCompletion !== undefined && xpassCompletion >= 0 && xpassCompletion <= 100 ? xpassCompletion : undefined, minutes, unit: "%", normalization: "percentage", sourceField: "xpass_completion_percentage", sampleAttempts: attemptedPasses ?? null }));
    metrics.push(addMetric({ key: "asaPassesCompletedOverExpectedPer100", value: numberValue(xpass.passes_completed_over_expected_p100), minutes, unit: "次/100次传球", normalization: "per100", sourceField: "passes_completed_over_expected_p100", sampleAttempts: attemptedPasses ?? null }));
    metrics.push(addMetric({ key: "asaAverageVerticalPassDistanceYards", value: numberValue(xpass.avg_vertical_distance_yds), minutes, unit: "码/次传球", normalization: "perAttempt", sourceField: "avg_vertical_distance_yds", sampleAttempts: attemptedPasses ?? null }));
  }
  const goalsAdded = input.goalsAdded;
  if (goalsAdded) {
    if (!Array.isArray(goalsAdded.data)) throw new ASAProviderError("invalid_response", "ASA Goals Added row is missing its source action breakdown.");
    const actionRows = new Map<ActionType, Record<string, unknown>>();
    for (const action of goalsAdded.data) {
      if (!isRecord(action) || typeof action.action_type !== "string" || !(action.action_type in actionMetricKeys)) continue;
      const actionType = action.action_type as ActionType;
      if (actionRows.has(actionType)) throw new ASAProviderError("invalid_response", "ASA Goals Added row contains a duplicate action type.");
      actionRows.set(actionType, action);
      const actionValue = numberValue(action.goals_added_above_avg);
      const actionCount = nonNegativeNumber(action.count_actions);
      metrics.push(addMetric({
        key: actionMetricKeys[actionType],
        value: actionValue,
        minutes: goalsAdded.minutes_played,
        unit: "g+/90分钟",
        normalization: "per90",
        sourceField: `data[].goals_added_above_avg[action=${actionType}]`,
        precision: 4,
        ...(actionCount === undefined ? {} : { sampleAttempts: actionCount }),
      }));
    }
    const allActions = Object.keys(actionMetricKeys) as ActionType[];
    const values = allActions.map((action) => numberValue(actionRows.get(action)?.goals_added_above_avg));
    if (values.every((value): value is number => value !== undefined)) {
      const actions = allActions.map((action) => nonNegativeNumber(actionRows.get(action)?.count_actions));
      metrics.push(addMetric({
        key: "asaGoalsAddedTotalAboveAveragePer90",
        value: values.reduce((sum, value) => sum + value, 0),
        minutes: goalsAdded.minutes_played,
        unit: "g+/90分钟",
        normalization: "per90",
        sourceField: "sum(data[].goals_added_above_avg for six ASA action types)",
        precision: 4,
        ...(actions.every((count): count is number => count !== undefined) ? { sampleAttempts: actions.reduce((sum, count) => sum + count, 0) } : {}),
      }));
    }
  }
  return metrics.filter((metric): metric is SupplementaryPerformanceMetric => metric !== undefined);
}

function searchPlayers(players: readonly PlayerProfile[], query: PlayerSearchQuery): PlayerSearchPage {
  const normalizedName = query.playerName ? normalizeSearchText(query.playerName) : null;
  const normalizedSeason = query.season ? normalizeSearchText(query.season) : null;
  const matching = players.filter((player) => {
    if (normalizedName && !normalizeSearchText(player.name).includes(normalizedName)) return false;
    if (query.position && !(query.positionMatchMode === "family"
      ? positionMatchesRetrieval(player.position, query.position, player.sourceIdentity?.positionGroups)
      : positionMatches(player.position, query.position))) return false;
    if (player.minutes < query.minimumMinutes) return false;
    if (query.maxAge !== null && (player.age === null || player.age > query.maxAge)) return false;
    if (query.competition && !matchesCompetition(player, query.competition)) return false;
    if (normalizedSeason && normalizeSearchText(player.season) !== normalizedSeason) return false;
    return true;
  });
  const page = matching.slice(query.offset, query.offset + query.limit);
  const appliedFilters: PlayerSearchFilter[] = [];
  if (query.playerName) appliedFilters.push("playerName");
  if (query.position) appliedFilters.push(query.positionMatchMode === "family" ? "positionFamily" : "position");
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

function matchesCompetition(player: PlayerProfile, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  const exactGroup = ASA_COMPETITION_GROUPS.find(({ aliases, label }) => [label, ...aliases].some((value) => (
    normalizeSearchText(value) === normalizedQuery
  )));
  if (exactGroup) return exactGroup.competitionIds.some((competitionId) => competitionId === player.sourceIdentity?.competitionId);
  const exactCompetition = ASA_COMPETITIONS.find(({ aliases, label }) => [label, ...aliases].some((value) => (
    normalizeSearchText(value) === normalizedQuery
  )));
  if (exactCompetition) return exactCompetition.id === player.sourceIdentity?.competitionId;
  const competition = ASA_COMPETITIONS.find(({ aliases, label }) => [label, ...aliases].some((value) => {
    const normalized = normalizeSearchText(value);
    return normalized.includes(normalizedQuery);
  }));
  if (competition) return competition.id === player.sourceIdentity?.competitionId;
  const group = ASA_COMPETITION_GROUPS.find(({ aliases, label }) => [label, ...aliases].some((value) => {
    const normalized = normalizeSearchText(value);
    return normalized.includes(normalizedQuery);
  }));
  if (group) return group.competitionIds.some((competitionId) => competitionId === player.sourceIdentity?.competitionId);
  return normalizeSearchText(player.competition).includes(normalizedQuery);
}

async function requestJson(fetchImpl: typeof fetch, url: URL, signal?: AbortSignal): Promise<unknown> {
  throwIfAborted(signal);
  for (let attempt = 0; attempt < MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const response = await fetchImpl(url, {
        headers: { accept: "application/json", "user-agent": "TactiScout/0.1 local research prototype" },
        signal: requestSignal,
        redirect: "error",
      });
      if (response.status === 401 || response.status === 403) throw new ASAProviderError("blocked", `ASA denied the request with HTTP ${response.status}.`);
      if (response.status === 429) throw new ASAProviderError("rate_limit", "ASA rate-limited the request with HTTP 429. No retry was made.");
      if (!response.ok) throw new ASAProviderError("request_failed", `ASA returned HTTP ${response.status}.`);
      if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
        throw new ASAProviderError("invalid_response", "ASA did not return JSON.");
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        throw new ASAProviderError("response_too_large", "ASA response exceeded the configured size limit.");
      }
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
        const timeout = timeoutSignal.aborted || (error instanceof Error && error.name === "TimeoutError");
        throw new ASAProviderError(timeout ? "timeout" : "network", "ASA response body could not be read completely.");
      }
      throwIfAborted(signal);
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        throw new ASAProviderError("response_too_large", "ASA response exceeded the configured size limit.");
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ASAProviderError("invalid_response", "ASA returned malformed JSON.");
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
      const providerError = error instanceof ASAProviderError
        ? error
        : (() => {
          const redirect = error instanceof TypeError && /redirect/i.test(error.message);
          const timeout = timeoutSignal.aborted || (error instanceof Error && error.name === "TimeoutError");
          return new ASAProviderError(redirect ? "redirect_rejected" : timeout ? "timeout" : "network", redirect
          ? "ASA redirected the request; redirects are disabled."
          : timeout ? "ASA did not return a complete response before the request timeout."
            : "ASA could not be reached; no alternate endpoint or proxy was tried.");
        })();
      const retryable = providerError.code === "network" || providerError.code === "timeout";
      if (!retryable || attempt + 1 >= MAX_TRANSPORT_ATTEMPTS) throw providerError;
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: unknown) => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve();
        };
        const timeout = setTimeout(() => finish(), TRANSPORT_RETRY_DELAY_MS);
        const abort = () => {
          finish(signal?.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError"));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
      throwIfAborted(signal);
    }
  }
  throw new ASAProviderError("network", "ASA transport attempts were exhausted.");
}

function urlFor(competitionId: string, path: string, params: Record<string, string> = {}): URL {
  const url = new URL(`${API_ROOT}/${competitionId}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function requestStats(fetchImpl: typeof fetch, competitionId: string, endpoint: string, season: string, signal?: AbortSignal): Promise<Map<string, ASAStatRow>> {
  const payload = await requestJson(fetchImpl, urlFor(competitionId, `/players/${endpoint}`, {
    season_name: season,
    split_by_seasons: "true",
    split_by_teams: "true",
    minimum_minutes: "0",
  }), signal);
  return validateStatsRows(payload, competitionId, season, endpoint);
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

async function requestPlayerDirectory(fetchImpl: typeof fetch, competitionId: string, ids: readonly string[], signal?: AbortSignal): Promise<Map<string, ASAPlayerEntity>> {
  const output = new Map<string, ASAPlayerEntity>();
  for (const batch of chunks(ids, ENTITY_BATCH_SIZE)) {
    throwIfAborted(signal);
    const payload = await requestJson(fetchImpl, urlFor(competitionId, "/players", { player_id: batch.join(",") }), signal);
    const entities = parsePlayerEntities(payload);
    for (const [id, entity] of entities) {
      const scopedId = `${competitionId}\u0000${id}`;
      if (output.has(scopedId)) throw new ASAProviderError("invalid_response", "ASA player lookup returned duplicate IDs across batches.");
      output.set(scopedId, entity);
    }
  }
  const missing = ids.filter((id) => !output.has(`${competitionId}\u0000${id}`));
  if (missing.length) throw new ASAProviderError("invalid_response", `ASA did not resolve ${missing.length} requested player IDs in its player directory.`);
  return output;
}

async function requestTeamDirectory(fetchImpl: typeof fetch, competitionId: string, ids: readonly string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const output = new Map<string, string>();
  for (const batch of chunks(ids, ENTITY_BATCH_SIZE)) {
    throwIfAborted(signal);
    const payload = await requestJson(fetchImpl, urlFor(competitionId, "/teams", { team_id: batch.join(",") }), signal);
    const entities = parseTeamEntities(payload);
    for (const [id, name] of entities) {
      const scopedId = `${competitionId}\u0000${id}`;
      if (output.has(scopedId)) throw new ASAProviderError("invalid_response", "ASA team lookup returned duplicate IDs across batches.");
      output.set(scopedId, name);
    }
  }
  return output;
}

function numericField(row: ASAStatRow | undefined, key: string): number | undefined {
  return row ? numberValue(row[key]) : undefined;
}

function buildProfiles(input: {
  competitionId: string;
  competitionLabel: string;
  season: string;
  retrievedAt: Date;
  xgoals: Map<string, ASAStatRow>;
  xpass: Map<string, ASAStatRow>;
  goalsAdded: Map<string, ASAStatRow>;
  playerDirectory: Map<string, ASAPlayerEntity>;
  teamDirectory: Map<string, string>;
}): PlayerProfile[] {
  const rowKeys = new Set([...input.xgoals.keys(), ...input.xpass.keys(), ...input.goalsAdded.keys()]);
  const retrievedAtText = input.retrievedAt.toISOString();
  const profiles = [...rowKeys].flatMap((key) => {
    const xgoals = input.xgoals.get(key);
    const xpass = input.xpass.get(key);
    const goalsAddedRow = input.goalsAdded.get(key) as ASAGoalsAddedRow | undefined;
    const seed = xgoals ?? xpass ?? goalsAddedRow;
    if (!seed) return [];
    const player = input.playerDirectory.get(`${input.competitionId}\u0000${seed.player_id}`);
    if (!player) throw new ASAProviderError("invalid_response", "ASA statistical record has no exact player-entity match.");
    const position = mapPosition(seed.general_position);
    if (!position || [xgoals, xpass, goalsAddedRow].some((row) => row && row.general_position !== seed.general_position)) {
      throw new ASAProviderError("invalid_response", "ASA statistical endpoints disagree on the player's position group.");
    }
    const team = input.teamDirectory.get(`${input.competitionId}\u0000${seed.team_id}`);
    const age = ageFromBirthDate(player.birth_date, input.retrievedAt);
    const metrics = metricsFor({
      ...(xgoals ? { xgoals } : {}),
      ...(xpass ? { xpass } : {}),
      ...(goalsAddedRow ? { goalsAdded: goalsAddedRow } : {}),
    });
    const goals = numericField(xgoals, "goals");
    const assists = numericField(xgoals, "primary_assists");
    const keyPasses = numericField(xgoals, "key_passes");
    const games = nonNegativeNumber(xpass?.count_games);
    const playerId = `asa:${input.competitionId}:${seed.player_id}:team:${seed.team_id}:season:${input.season}`;
    return [PlayerProfileSchema.parse({
      playerId,
      externalPlayerId: seed.player_id,
      name: player.player_name,
      team: team ?? "球队未解析",
      age,
      ...(age === null ? {} : { ageSource: "American Soccer Analysis player birth date", ageVerifiedAt: retrievedAtText }),
      position,
      competition: input.competitionLabel,
      season: input.season,
      minutes: xgoals?.minutes_played ?? xpass?.minutes_played ?? goalsAddedRow?.minutes_played ?? 0,
      ...(games === undefined ? {} : { appearanceMatchCount: Math.round(games) }),
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
      supplementaryMetrics: metrics,
      sourceIdentity: {
        provider: "american-soccer-analysis",
        playerId: seed.player_id,
        teamId: seed.team_id,
        competitionId: input.competitionId,
        seasonId: input.season,
        positionGroup: seed.general_position,
        retrievedAt: retrievedAtText,
        isCurrentSeason: input.season === String(input.retrievedAt.getUTCFullYear()),
      },
      source: `American Soccer Analysis · ${input.competitionId.toUpperCase()} ${input.season} 球员表现${team ? "" : "（球队 ID 未能映射）"}`,
    })];
  });
  if (!profiles.length) throw new ASAProviderError("invalid_response", `ASA returned no usable player records for the current ${input.competitionId} season.`);
  if (new Set(profiles.map((player) => player.playerId)).size !== profiles.length) {
    throw new ASAProviderError("invalid_response", "ASA player profile construction produced duplicate player/team/season identities.");
  }
  return profiles.sort((a, b) => a.playerId.localeCompare(b.playerId));
}

async function loadCompetitionPlayers(fetchImpl: typeof fetch, competition: typeof ASA_COMPETITIONS[number], season: string, retrievedAt: Date, signal?: AbortSignal): Promise<PlayerProfile[]> {
  throwIfAborted(signal);
  const competitionId = competition.id;
  const [goalsAddedRows, xgoalRows, xpassRows] = await Promise.all([
    requestStats(fetchImpl, competitionId, "goals-added", season, signal),
    requestStats(fetchImpl, competitionId, "xgoals", season, signal),
    requestStats(fetchImpl, competitionId, "xpass", season, signal),
  ]);
  throwIfAborted(signal);
  const playerIds = [...new Set([...xgoalRows.values(), ...xpassRows.values(), ...goalsAddedRows.values()].map((row) => row.player_id))].sort();
  const teamIds = [...new Set([...xgoalRows.values(), ...xpassRows.values(), ...goalsAddedRows.values()].map((row) => row.team_id))].sort();
  const [playerDirectory, teamDirectory] = await Promise.all([
    requestPlayerDirectory(fetchImpl, competitionId, playerIds, signal),
    requestTeamDirectory(fetchImpl, competitionId, teamIds, signal),
  ]);
  throwIfAborted(signal);
  return buildProfiles({
    competitionId,
    competitionLabel: competition.label,
    season,
    retrievedAt,
    xgoals: xgoalRows,
    xpass: xpassRows,
    goalsAdded: goalsAddedRows,
    playerDirectory,
    teamDirectory,
  });
}

function competitionIdsForScope(scope: string | null): string[] {
  const normalizedScope = normalizeSearchText(scope ?? "ASA 北美男足赛事");
  const exactGroup = ASA_COMPETITION_GROUPS.find(({ aliases, label }) => [label, ...aliases].some((value) => (
    normalizeSearchText(value) === normalizedScope
  )));
  if (exactGroup) return [...exactGroup.competitionIds];
  const exactCompetition = ASA_COMPETITIONS.find(({ aliases, label }) => [label, ...aliases].some((value) => (
    normalizeSearchText(value) === normalizedScope
  )));
  if (exactCompetition) return [exactCompetition.id];
  const group = ASA_COMPETITION_GROUPS.find(({ aliases, label }) => [label, ...aliases].some((value) => {
    const normalized = normalizeSearchText(value);
    return normalized.includes(normalizedScope);
  }));
  if (group) return [...group.competitionIds];
  const competition = ASA_COMPETITIONS.find(({ aliases, label }) => [label, ...aliases].some((value) => {
    const normalized = normalizeSearchText(value);
    return normalized.includes(normalizedScope);
  }));
  if (competition) return [competition.id];
  throw new ASAProviderError("unsupported_scope", "ASA 当前只支持 MLS、USL Championship 与 USL League One。");
}

function competitionIdFromPlayerId(playerId: string): string | undefined {
  const match = /^asa:([^:]+):/.exec(playerId);
  const competitionId = match?.[1];
  return competitionId && ASA_COMPETITIONS.some(({ id }) => id === competitionId) ? competitionId : undefined;
}

export class AmericanSoccerAnalysisPlayerRepository implements PlayerRepository {
  readonly mode = "asa" as const;
  readonly sourceName = "American Soccer Analysis · 北美三项男足当前赛季表现";
  private readonly competitionCache = new Map<string, CacheEntry>();
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly now: () => Date;

  constructor(options: ASARepositoryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? (() => new Date());
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 0) {
      throw new ASAProviderError("invalid_configuration", "ASA cache lifetime must be a non-negative number of milliseconds.");
    }
  }

  private loadCompetition(competitionId: string, retrievedAt: Date, signal?: AbortSignal): Promise<PlayerProfile[]> {
    throwIfAborted(signal);
    const competition = ASA_COMPETITIONS.find(({ id }) => id === competitionId);
    if (!competition) throw new ASAProviderError("unsupported_scope", "ASA 请求包含不支持的赛事。");
    const now = this.now();
    const season = String(retrievedAt.getUTCFullYear());
    const cacheKey = `${competition.id}:${season}`;
    const cached = this.competitionCache.get(cacheKey);
    if (cached && cached.expiresAt > now.getTime()) return cached.load.subscribe(signal);

    const entry: CacheEntry = { expiresAt: now.getTime() + this.cacheTtlMs, load: new SharedCancellableLoad((requestSignal) => loadCompetitionPlayers(this.fetchImpl, competition, season, retrievedAt, requestSignal)) };
    void entry.load.promise.catch((error: unknown) => {
      if (this.competitionCache.get(cacheKey) === entry) {
        if (entry.load.signal.aborted) {
          this.competitionCache.delete(cacheKey);
          return;
        }
        const restricted = error instanceof ASAProviderError && (error.code === "blocked" || error.code === "rate_limit");
        entry.expiresAt = this.now().getTime() + (restricted ? ACCESS_FAILURE_COOLDOWN_MS : FAILURE_COOLDOWN_MS);
      }
    });
    this.competitionCache.set(cacheKey, entry);
    return entry.load.subscribe(signal);
  }

  private async loadCompetitions(competitionIds: readonly string[], retrievedAt = this.now(), signal?: AbortSignal): Promise<PlayerProfile[]> {
    const players: PlayerProfile[] = [];
    for (const competitionId of [...new Set(competitionIds)]) {
      throwIfAborted(signal);
      players.push(...await this.loadCompetition(competitionId, retrievedAt, signal));
    }
    return players.sort((a, b) => a.playerId.localeCompare(b.playerId));
  }

  loadPlayers(refresh = false, signal?: AbortSignal): Promise<PlayerProfile[]> {
    throwIfAborted(signal);
    if (refresh) this.competitionCache.clear();
    return this.loadCompetitions(ASA_COMPETITIONS.map(({ id }) => id), this.now(), signal);
  }

  loadMenPlayers(refresh = false, signal?: AbortSignal): Promise<PlayerProfile[]> {
    throwIfAborted(signal);
    if (refresh) this.competitionCache.clear();
    return this.loadCompetitions(ASA_COMPETITIONS.map(({ id }) => id), this.now(), signal);
  }

  async getPlayersByIds(playerIds: readonly string[], signal?: AbortSignal): Promise<PlayerProfile[]> {
    throwIfAborted(signal);
    const wanted = new Set(playerIds);
    if (wanted.size === 0) return [];
    const competitionIds = [...new Set(playerIds.flatMap((playerId) => {
      const competitionId = competitionIdFromPlayerId(playerId);
      return competitionId ? [competitionId] : [];
    }))];
    if (competitionIds.length === 0) return [];
    return (await this.loadCompetitions(competitionIds, this.now(), signal)).filter((player) => wanted.has(player.playerId));
  }

  async getComparisonPlayers(players: readonly PlayerProfile[], signal?: AbortSignal): Promise<PlayerProfile[]> {
    throwIfAborted(signal);
    const competitionIds = [...new Set(players.flatMap((player) => {
      const competitionId = player.sourceIdentity?.competitionId ?? competitionIdFromPlayerId(player.playerId);
      return competitionId && ASA_COMPETITIONS.some(({ id }) => id === competitionId) ? [competitionId] : [];
    }))];
    return this.loadCompetitions(competitionIds, this.now(), signal);
  }

  async searchCandidates(query: PlayerSearchQuery, signal?: AbortSignal): Promise<PlayerSearchPage> {
    throwIfAborted(signal);
    const retrievedAt = this.now();
    const season = String(retrievedAt.getUTCFullYear());
    const competition = query.competition ?? "ASA 男足赛事";
    const competitionIds = competitionIdsForScope(competition);
    if (query.season && normalizeSearchText(query.season) !== normalizeSearchText(season)) {
      throw new ASAProviderError("unsupported_scope", `ASA 当前数据模式只查询 ${season} ASA 赛季，不能将未读取的赛季报告为空候选。`);
    }
    return searchPlayers(await this.loadCompetitions(competitionIds, retrievedAt, signal), { ...query, competition });
  }
}
