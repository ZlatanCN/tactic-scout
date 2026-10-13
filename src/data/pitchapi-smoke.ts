type JsonRecord = Record<string, unknown>;

const API_BASE_URL = "https://api.pitchapi.dev";
const MAX_MATCHES_TO_SAMPLE = 3;
const REQUEST_TIMEOUT_MS = 10_000;

const STANDARD_FIELDS = [
  ["top_stats", "minutes_played"],
  ["top_stats", "goals"],
  ["top_stats", "assists"],
  ["top_stats", "expected_goals"],
  ["top_stats", "xg_and_xa"],
  ["attack", "touches"],
  ["attack", "dribbles"],
  ["attack", "passes_into_final_third"],
  ["defense", "tackles"],
  ["defense", "interceptions"],
  ["defense", "recoveries"],
  ["duels", "aerials_won"],
  ["duels", "ground_duels_won"],
] as const;

const ADVANCED_FIELDS = [
  ["", "minutes_played"],
  ["possession_value", "vaep_total"],
  ["possession_value", "xt_total"],
  ["passing", "progressive_passes"],
  ["passing", "pass_accuracy"],
  ["carrying", "progressive_carries"],
  ["carrying", "take_ons"],
  ["carrying", "take_ons_won"],
  ["creation", "xag"],
  ["creation", "xg_buildup"],
  ["defending", "tackles"],
  ["defending", "interceptions"],
  ["defending", "aerials_won"],
] as const;

const FIELD_ALLOWLIST = [
  ...STANDARD_FIELDS.map(([group, key]) => `standard.${group}.${key}`),
  ...ADVANCED_FIELDS.map(([group, key]) => `advanced.${group ? `${group}.` : ""}${key}`),
];

export interface PitchApiSmokeOptions {
  apiKey: string;
  leagueName?: string;
  countryCode?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface PitchApiFieldCoverage {
  field: string;
  rowsWithValue: number;
  rows: number;
}

export interface PitchApiSmokeResult {
  checkedAt: string;
  league: { name: string; countryCode: string };
  season: string;
  matchesAvailable: number;
  matchesSampled: number;
  matchesWithAdvancedPlayerStats: number;
  standardPlayerRows: number;
  advancedPlayerRows: number;
  requestsMade: number;
  outcome: "player_data_found" | "player_data_found_without_advanced" | "no_played_matches" | "no_player_stats";
  fieldCoverage: PitchApiFieldCoverage[];
}

export class PitchApiSmokeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PitchApiSmokeError";
  }
}

interface ApiReply {
  data: unknown;
  errorCode: string | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function requireRecordArray(value: unknown, description: string): JsonRecord[] {
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    throw new PitchApiSmokeError(`PitchAPI returned an unsupported ${description} response shape.`);
  }
  return value;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeNumericValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim() !== "" && Number.isFinite(Number(value));
  return false;
}

function hasStatValue(value: unknown): boolean {
  if (!isRecord(value)) return safeNumericValue(value);
  if ("stat" in value) {
    const stat = isRecord(value.stat) ? value.stat : {};
    if (!safeNumericValue(stat.value)) return false;
    if (stat.type === "fractionWithPercentage" || stat.type === "distanceWithPercentage") {
      return safeNumericValue(stat.total) && Number(stat.total) > 0;
    }
    return true;
  }
  return safeNumericValue(value.value);
}

function httpFailure(status: number): string {
  if (status === 401 || status === 403) return "PitchAPI rejected the configured API key or account access.";
  if (status === 429) return "PitchAPI rate limit was reached. The smoke does not retry requests.";
  return `PitchAPI returned HTTP ${status}.`;
}

async function requestJson(
  path: string,
  input: {
    apiKey: string;
    fetchImpl: typeof fetch;
    timeoutMs: number;
    onRequest: () => void;
    allowAnalyticsUnavailable?: boolean;
  },
): Promise<ApiReply> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  input.onRequest();
  try {
    const response = await input.fetchImpl(`${API_BASE_URL}${path}`, {
      headers: { "X-API-KEY": input.apiKey },
      signal: controller.signal,
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PitchApiSmokeError("PitchAPI returned invalid JSON.");
    }
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    const errorCode = nonEmptyString(error?.code);
    if (input.allowAnalyticsUnavailable && errorCode === "ANALYTICS_UNAVAILABLE") {
      return { data: null, errorCode };
    }
    if (!response.ok) throw new PitchApiSmokeError(httpFailure(response.status));
    if (error || !isRecord(body) || !("data" in body)) {
      throw new PitchApiSmokeError("PitchAPI returned an unsupported response shape.");
    }
    return { data: body.data, errorCode: null };
  } catch (error) {
    if (error instanceof PitchApiSmokeError) throw error;
    if (controller.signal.aborted) throw new PitchApiSmokeError("PitchAPI request timed out.");
    throw new PitchApiSmokeError("PitchAPI could not be reached.");
  } finally {
    clearTimeout(timeout);
  }
}

function exactLeague(leaguesValue: unknown, name: string, countryCode: string): { id: string; name: string; countryCode: string } {
  const data = isRecord(leaguesValue) ? leaguesValue : {};
  const found = records(data.leagues).filter((league) => league.name === name && league.country_code === countryCode);
  if (found.length === 0) throw new PitchApiSmokeError("No league matched the exact name and country code.");
  if (found.length > 1) throw new PitchApiSmokeError("More than one league matched the exact name and country code.");
  const selected = found[0];
  const id = nonEmptyString(selected?.id);
  if (!id) throw new PitchApiSmokeError("The matching league did not include a usable provider ID.");
  return { id, name, countryCode };
}

function metricHasValue(record: JsonRecord, path: readonly string[]): boolean {
  let value: unknown = record;
  for (const segment of path) {
    if (!isRecord(value)) return false;
    value = value[segment];
  }
  return hasStatValue(value);
}

function standardFieldPresent(row: JsonRecord, field: string): boolean {
  const [, groupName, key] = field.split(".");
  const group = records(row.stats).find((candidate) => candidate.key === groupName);
  const stats = isRecord(group?.stats) ? group.stats : {};
  const entry = Object.values(stats).find((candidate) => isRecord(candidate) && candidate.key === key);
  return hasStatValue(entry);
}

function fieldCoverage(standardRows: JsonRecord[], advancedRows: JsonRecord[]): PitchApiFieldCoverage[] {
  return FIELD_ALLOWLIST.map((field) => {
    const isStandard = field.startsWith("standard.");
    const sampleRows = isStandard ? standardRows : advancedRows;
    const path = field.split(".").slice(1);
    const rowsWithValue = sampleRows.reduce((count, row) => {
      const hasValue = isStandard ? standardFieldPresent(row, field) : metricHasValue(row, path);
      return count + (hasValue ? 1 : 0);
    }, 0);
    return { field, rowsWithValue, rows: sampleRows.length };
  });
}

function latestFinishedMatches(value: unknown): JsonRecord[] {
  const data = isRecord(value) ? value : {};
  return records(data.matches)
    .filter((match) => (match.status === "finished" || match.status === "played")
      && typeof match.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(match.date)
      && nonEmptyString(match.id) !== null)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .slice(0, MAX_MATCHES_TO_SAMPLE);
}

export async function runPitchApiSmoke(options: PitchApiSmokeOptions): Promise<PitchApiSmokeResult> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new PitchApiSmokeError("Set PITCHAPI_API_KEY locally before running this smoke.");
  const leagueName = (options.leagueName ?? "Premier League").trim();
  const countryCode = (options.countryCode ?? "ENG").trim().toUpperCase();
  if (!leagueName || !countryCode) throw new PitchApiSmokeError("Set an exact league name and country code.");
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new PitchApiSmokeError("Request timeout must be a positive number of milliseconds.");
  const fetchImpl = options.fetchImpl ?? fetch;
  let requestsMade = 0;
  const request = (path: string, allowAnalyticsUnavailable = false) => requestJson(path, {
    apiKey,
    fetchImpl,
    timeoutMs,
    onRequest: () => { requestsMade += 1; },
    allowAnalyticsUnavailable,
  });

  const leaguesReply = await request("/v1/leagues");
  const selectedLeague = exactLeague(leaguesReply.data, leagueName, countryCode);
  const leagueReply = await request(`/v1/leagues/${encodeURIComponent(selectedLeague.id)}`);
  const leagueData = isRecord(leagueReply.data) ? leagueReply.data : {};
  if (nonEmptyString(leagueData.id) !== selectedLeague.id
    || (nonEmptyString(leagueData.name) !== null && leagueData.name !== selectedLeague.name)
    || (nonEmptyString(leagueData.country_code) !== null && leagueData.country_code !== selectedLeague.countryCode)) {
    throw new PitchApiSmokeError("PitchAPI returned metadata for a different league.");
  }
  const season = nonEmptyString(leagueData.season);
  if (!season) throw new PitchApiSmokeError("PitchAPI did not identify the league's current season.");

  const matchQuery = new URLSearchParams({ season, status: "played" });
  const matchesReply = await request(`/v1/leagues/${encodeURIComponent(selectedLeague.id)}/matches?${matchQuery}`);
  const matchListData = isRecord(matchesReply.data) ? matchesReply.data : {};
  const leagueMatchData = isRecord(matchListData.league) ? matchListData.league : {};
  if (nonEmptyString(leagueMatchData.id) !== selectedLeague.id || nonEmptyString(leagueMatchData.season) !== season) {
    throw new PitchApiSmokeError("PitchAPI returned a match list for a different or unknown season.");
  }
  const listedMatches = requireRecordArray(matchListData.matches, "league matches");
  const allFinishedMatches = listedMatches
    .filter((match) => (match.status === "finished" || match.status === "played")
      && typeof match.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(match.date)
      && nonEmptyString(match.id) !== null);
  const matches = latestFinishedMatches(matchListData);
  const standardRows: JsonRecord[] = [];
  const advancedRows: JsonRecord[] = [];
  let matchesWithAdvancedPlayerStats = 0;

  for (const match of matches) {
    const matchId = nonEmptyString(match.id);
    if (!matchId) continue;
    const encodedMatchId = encodeURIComponent(matchId);
    const standardReply = await request(`/v1/matches/${encodedMatchId}/players`);
    standardRows.push(...requireRecordArray(standardReply.data, "standard player stats"));
    const advancedReply = await request(`/v1/matches/${encodedMatchId}/advanced/players`, true);
    if (advancedReply.errorCode === "ANALYTICS_UNAVAILABLE") continue;
    const advancedData = isRecord(advancedReply.data) ? advancedReply.data : {};
    if (nonEmptyString(advancedData.match_id) !== matchId) {
      throw new PitchApiSmokeError("PitchAPI returned advanced stats for a different match.");
    }
    const rows = requireRecordArray(advancedData.players, "advanced player stats");
    advancedRows.push(...rows);
    if (rows.length > 0) matchesWithAdvancedPlayerStats += 1;
  }

  const now = (options.now ?? (() => new Date()))();
  if (Number.isNaN(now.getTime())) throw new PitchApiSmokeError("Smoke clock returned an invalid time.");
  const outcome = matches.length === 0
    ? "no_played_matches"
    : standardRows.length === 0 && advancedRows.length === 0
      ? "no_player_stats"
      : advancedRows.length > 0
        ? "player_data_found"
        : "player_data_found_without_advanced";
  return {
    checkedAt: now.toISOString(),
    league: { name: selectedLeague.name, countryCode: selectedLeague.countryCode },
    season,
    matchesAvailable: allFinishedMatches.length,
    matchesSampled: matches.length,
    matchesWithAdvancedPlayerStats,
    standardPlayerRows: standardRows.length,
    advancedPlayerRows: advancedRows.length,
    requestsMade,
    outcome,
    fieldCoverage: standardRows.length + advancedRows.length === 0 ? [] : fieldCoverage(standardRows, advancedRows),
  };
}
