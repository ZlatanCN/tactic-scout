type JsonRecord = Record<string, unknown>;

const API_BASE_URL = "https://api.soccersapi.com/v2.2";
const MAX_REQUESTS = 9;
const MAX_PLAYERS = 5;
const MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;

const METRICS = [
  ["minutes_played", "minutes played"],
  ["matches.played.total", "matches played"],
  ["matches.starting.total", "matches started"],
  ["goals.total", "goals"],
  ["assists.total", "assists"],
  ["shots.total", "shots"],
  ["shots.on_target.total", "shots on target"],
  ["shots.off_target.total", "shots off target"],
  ["shots.blocked.total", "shots blocked"],
] as const;

type MetricKey = typeof METRICS[number][0];

export interface SoccersApiSmokeOptions {
  apiKey: string;
  leagueName: string;
  countryCode: string;
  teamName?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  now?: () => Date;
}

export interface SoccersApiMetricCoverage {
  metric: MetricKey;
  label: string;
  rowsWithValue: number;
  rows: number;
}

export interface SoccersApiSquadFieldCoverage {
  field: "age" | "position" | "nationality";
  rowsWithValue: number;
  rows: number;
}

export interface SoccersApiSmokeResult {
  source: "SoccersAPI v2.2";
  checkedAt: string;
  league: { name: string; countryCode: string };
  season: { id: string; name: string | null };
  teamName: string;
  squadRows: number;
  playersSampled: number;
  playersWithStats: number;
  squadFieldCoverage: SoccersApiSquadFieldCoverage[];
  plan: string | null;
  requestsMade: number;
  requestsRemaining: number | null;
  metricCoverage: SoccersApiMetricCoverage[];
}

export class SoccersApiSmokeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoccersApiSmokeError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identifier(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

function numeric(value: unknown): boolean {
  return (typeof value === "number" && Number.isFinite(value))
    || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));
}

function safeHttpError(status: number): string {
  if (status === 401) return "SoccersAPI rejected the configured development key.";
  if (status === 403) return "SoccersAPI denied access to this league or operation for the configured plan.";
  if (status === 429) return "SoccersAPI request allowance was reached; the smoke does not retry.";
  if (status >= 300 && status < 400) return "SoccersAPI returned a redirect; redirects are rejected.";
  return `SoccersAPI returned HTTP ${status}; the response body was not printed.`;
}

function readMetric(stats: JsonRecord, path: string): unknown {
  let current: unknown = stats;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function exactCountryCode(league: JsonRecord): string | null {
  const country = isRecord(league.country) ? league.country : null;
  const direct = nonEmptyString(league.cc);
  const nested = nonEmptyString(country?.cc);
  return (direct ?? nested)?.toUpperCase() ?? null;
}

function parseEnvelope(value: unknown): { data: unknown; meta: JsonRecord | null } {
  if (!isRecord(value) || !Object.hasOwn(value, "data")) {
    throw new SoccersApiSmokeError("SoccersAPI returned an unsupported response envelope.");
  }
  return { data: value.data, meta: isRecord(value.meta) ? value.meta : null };
}

function safePositiveInt(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function readBoundedBody(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new SoccersApiSmokeError("SoccersAPI response exceeded the one-megabyte smoke limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new SoccersApiSmokeError("SoccersAPI response exceeded the one-megabyte smoke limit.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function runSoccersApiSmoke(options: SoccersApiSmokeOptions): Promise<SoccersApiSmokeResult> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new SoccersApiSmokeError("Set SOCCERSAPI_API_KEY in the local API environment before running this smoke.");
  const leagueName = options.leagueName.trim();
  const countryCode = options.countryCode.trim().toUpperCase();
  if (!leagueName || !/^[A-Z]{2,3}$/.test(countryCode)) {
    throw new SoccersApiSmokeError("A league name and a two- or three-letter country code are required.");
  }
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new SoccersApiSmokeError("The request timeout must be between 1 and 30000 milliseconds.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  let requestsMade = 0;
  let plan: string | null = null;
  let requestsRemaining: number | null = null;

  const request = async (path: string): Promise<unknown> => {
    if (requestsMade >= MAX_REQUESTS) throw new SoccersApiSmokeError("The smoke reached its nine-request limit.");
    requestsMade += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${API_BASE_URL}${path}`, {
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new SoccersApiSmokeError(safeHttpError(response.status));
      const text = await readBoundedBody(response);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new SoccersApiSmokeError("SoccersAPI returned invalid JSON.");
      }
      const envelope = parseEnvelope(parsed);
      const responsePlan = nonEmptyString(envelope.meta?.plan);
      if (responsePlan) plan = responsePlan;
      const remaining = safePositiveInt(envelope.meta?.requests_left);
      if (remaining !== null) requestsRemaining = remaining;
      return envelope.data;
    } catch (error) {
      if (error instanceof SoccersApiSmokeError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new SoccersApiSmokeError("SoccersAPI request timed out; the smoke does not retry.");
      }
      if (error instanceof TypeError) {
        throw new SoccersApiSmokeError("SoccersAPI request failed or was redirected; the smoke does not retry.");
      }
      throw new SoccersApiSmokeError("SoccersAPI request failed; no upstream error details were printed.");
    } finally {
      clearTimeout(timeout);
    }
  };

  const leagueList = await request("/leagues/?t=list&page=1");
  if (!Array.isArray(leagueList) || leagueList.some((item) => !isRecord(item))) {
    throw new SoccersApiSmokeError("SoccersAPI returned an unsupported account league list.");
  }
  const matchingLeagues = leagueList.filter((item) => (
    nonEmptyString(item.name)?.toLocaleLowerCase() === leagueName.toLocaleLowerCase()
    && exactCountryCode(item) === countryCode
  )) as JsonRecord[];
  if (matchingLeagues.length !== 1) {
    throw new SoccersApiSmokeError(matchingLeagues.length === 0
      ? "The exact league and country were not present in the configured account's league list."
      : "The exact league and country matched more than one account league; the smoke will not guess.");
  }
  const league = matchingLeagues[0]!;
  const leagueId = identifier(league.id);
  if (!leagueId) throw new SoccersApiSmokeError("SoccersAPI league metadata did not include a valid league ID.");

  const leagueInfoValue = await request(`/leagues/?t=info&id=${encodeURIComponent(leagueId)}`);
  if (!isRecord(leagueInfoValue)) throw new SoccersApiSmokeError("SoccersAPI returned an unsupported league profile.");
  const infoId = identifier(leagueInfoValue.id);
  if (infoId !== leagueId) throw new SoccersApiSmokeError("SoccersAPI league profile did not match the resolved league ID.");
  const seasonId = identifier(leagueInfoValue.id_current_season);
  if (!seasonId) throw new SoccersApiSmokeError("SoccersAPI did not mark a current season for the selected league.");
  const seasons = Array.isArray(leagueInfoValue.seasons) ? leagueInfoValue.seasons.filter(isRecord) : [];
  const currentSeasons = seasons.filter((season) => String(season.is_current) === "1");
  if (currentSeasons.length > 1 || (currentSeasons.length === 1 && identifier(currentSeasons[0]!.id) !== seasonId)) {
    throw new SoccersApiSmokeError("SoccersAPI current-season fields disagreed; the smoke will not infer a season.");
  }
  const seasonName = currentSeasons.length === 1 ? nonEmptyString(currentSeasons[0]!.name) : null;

  const teamsValue = await request(`/teams/?t=byseason&season_id=${encodeURIComponent(seasonId)}`);
  if (!Array.isArray(teamsValue) || teamsValue.some((item) => !isRecord(item))) {
    throw new SoccersApiSmokeError("SoccersAPI returned an unsupported current-season team list.");
  }
  const teams = teamsValue.filter((team) => identifier(team.id) && nonEmptyString(team.name));
  const wantedTeamName = options.teamName?.trim();
  const matchingTeams = wantedTeamName
    ? teams.filter((team) => nonEmptyString(team.name)?.toLocaleLowerCase() === wantedTeamName.toLocaleLowerCase())
    : [...teams].sort((left, right) => nonEmptyString(left.name)!.localeCompare(nonEmptyString(right.name)!));
  if (matchingTeams.length === 0) throw new SoccersApiSmokeError("No exact current-season team matched the smoke request.");
  if (wantedTeamName && matchingTeams.length > 1) {
    throw new SoccersApiSmokeError("The exact team name matched more than one current-season team; the smoke will not guess.");
  }
  const team = matchingTeams[0]!;
  const teamId = identifier(team.id)!;
  const resolvedTeamName = nonEmptyString(team.name)!;

  const squadValue = await request(`/teams/?t=squad&id=${encodeURIComponent(teamId)}&season_id=${encodeURIComponent(seasonId)}`);
  if (!isRecord(squadValue) || !Array.isArray(squadValue.squad) || squadValue.squad.some((row) => !isRecord(row))) {
    throw new SoccersApiSmokeError("SoccersAPI returned an unsupported season-squad response.");
  }
  const squad = squadValue.squad as JsonRecord[];
  const playerIds = [...new Set(squad.flatMap((row) => {
    const player = isRecord(row.player) ? row.player : null;
    const id = identifier(player?.id);
    return id ? [id] : [];
  }))].slice(0, MAX_PLAYERS);
  const sampledRows: JsonRecord[] = [];
  for (const playerId of playerIds) {
    const playerStatsValue = await request(`/stats/?t=player&id=${encodeURIComponent(playerId)}&season_id=${encodeURIComponent(seasonId)}`);
    if (playerStatsValue === null) continue;
    if (!isRecord(playerStatsValue)) throw new SoccersApiSmokeError("SoccersAPI returned an unsupported player-stat response.");
    const statsId = identifier(playerStatsValue.id);
    if (statsId !== null && statsId !== playerId) {
      throw new SoccersApiSmokeError("SoccersAPI player-stat identity did not match the requested source player ID.");
    }
    sampledRows.push(playerStatsValue);
  }

  const metricCoverage = METRICS.map(([metric, label]) => ({
    metric,
    label,
    rowsWithValue: sampledRows.filter((row) => numeric(readMetric(row, metric))).length,
    rows: sampledRows.length,
  }));
  const squadFieldChecks: Array<{ field: SoccersApiSquadFieldCoverage["field"]; hasValue: (row: JsonRecord) => boolean }> = [
    { field: "age", hasValue: (row) => isRecord(row.player) && numeric(row.player.age) },
    { field: "position", hasValue: (row) => nonEmptyString(row.position) !== null },
    {
      field: "nationality",
      hasValue: (row) => isRecord(row.player)
        && isRecord(row.player.country)
        && nonEmptyString(row.player.country.name) !== null,
    },
  ];

  return {
    source: "SoccersAPI v2.2",
    checkedAt: (options.now ?? (() => new Date()))().toISOString(),
    league: { name: nonEmptyString(league.name)!, countryCode },
    season: { id: seasonId, name: seasonName },
    teamName: resolvedTeamName,
    squadRows: squad.length,
    playersSampled: playerIds.length,
    playersWithStats: sampledRows.length,
    squadFieldCoverage: squadFieldChecks.map(({ field, hasValue }) => ({
      field,
      rowsWithValue: squad.filter(hasValue).length,
      rows: squad.length,
    })),
    plan,
    requestsMade,
    requestsRemaining,
    metricCoverage,
  };
}
