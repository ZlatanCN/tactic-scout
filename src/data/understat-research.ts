import { teamNamesMatch } from "../domain/team-names.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import {
  SupplementaryCapabilityMetricDefinitions,
  type PlayerProfile,
  type SupplementaryPerformanceMetric,
} from "../domain/schemas.js";
import { UnderstatProviderError, type UnderstatDataGateway } from "./understat-data-gateway.js";

export const understatPlayerSections = ["positions", "history", "recent", "shotProfile", "shots"] as const;
export type UnderstatPlayerSection = typeof understatPlayerSections[number];

export interface UnderstatPlayerInsight {
  playerId: string;
  name: string;
  team: string;
  competition: string;
  season: string;
  sourcePlayerId: string;
  sourceUrl: string;
  retrievedAt: string;
  player: { id: string; name: string; favoritePosition: string | null };
  lastMatch: { league: string | null; team: string | null; season: string | null } | null;
  requestedSections: UnderstatPlayerSection[];
  availableSections: UnderstatPlayerSection[];
  positions?: Array<{
    season: string; code: string; minutes: number | null; games: number | null; goals: number | null; shots: number | null;
    xG: number | null; assists: number | null; xA: number | null; keyPasses: number | null; npxG: number | null;
    xGChain: number | null; xGBuildup: number | null;
  }>;
  history?: Array<{
    season: string;
    team: string | null;
    position: string | null;
    games: number | null;
    minutes: number | null;
    goals: number | null;
    shots: number | null;
    xG: number | null;
    assists: number | null;
    xA: number | null;
    keyPasses: number | null;
    npxG: number | null;
    xGChain: number | null;
    xGBuildup: number | null;
  }>;
  recent?: Array<{
    matchId: string;
    date: string | null;
    season: string | null;
    homeTeam: string | null;
    awayTeam: string | null;
    homeGoals: number | null;
    awayGoals: number | null;
    position: string | null;
    minutes: number | null;
    goals: number | null;
    shots: number | null;
    xG: number | null;
    assists: number | null;
    xA: number | null;
    keyPasses: number | null;
    npxG: number | null;
    xGChain: number | null;
    xGBuildup: number | null;
  }>;
  shotProfile?: Array<{
    season: string;
    dimension: "situation" | "shotZones" | "shotTypes";
    category: string;
    goals: number | null;
    shots: number | null;
    xG: number | null;
    assists: number | null;
    keyPasses: number | null;
    xA: number | null;
    npg: number | null;
    npxG: number | null;
    minutes: number | null;
  }>;
  shots?: Array<{
    matchId: string;
    date: string | null;
    minute: string | null;
    result: string | null;
    xG: number | null;
    sourceX: number | null;
    sourceY: number | null;
    situation: string | null;
    shotType: string | null;
    lastAction: string | null;
    assistedBy: string | null;
  }>;
  notes: string[];
}

export interface UnderstatTeamInsight {
  team: string;
  competition: string;
  season: string;
  sourceUrl: string;
  retrievedAt: string;
  recentMatches: Array<{
    matchId: string;
    date: string | null;
    status: string | null;
    homeTeam: string | null;
    awayTeam: string | null;
    homeGoals: number | null;
    awayGoals: number | null;
    homeXG: number | null;
    awayXG: number | null;
    result: string | null;
  }>;
  statistics: Array<{
    dimension: string;
    category: string;
    shots: number | null;
    goals: number | null;
    xG: number | null;
    againstShots: number | null;
    againstGoals: number | null;
    againstXG: number | null;
    attempts: number | null;
    time: number | null;
  }>;
  players: Array<{
    id: string;
    name: string;
    position: string | null;
    games: number | null;
    minutes: number | null;
    goals: number | null;
    xG: number | null;
    assists: number | null;
    xA: number | null;
    shots: number | null;
    keyPasses: number | null;
    xGChain: number | null;
    xGBuildup: number | null;
  }>;
  notes: string[];
}

export interface UnderstatMatchInsight {
  matchId: string;
  sourceUrl: string;
  homeTeam: string | null;
  awayTeam: string | null;
  date: string | null;
  score: { home: number | null; away: number | null };
  rosters: Array<{
    team: "home" | "away";
    playerId: string | null;
    name: string | null;
    position: string | null;
    positionOrder: number | null;
    minutes: number | null;
    goals: number | null;
    ownGoals: number | null;
    shots: number | null;
    xG: number | null;
    assists: number | null;
    xA: number | null;
    keyPasses: number | null;
    yellowCards: number | null;
    redCards: number | null;
  }>;
  shots: Array<{
    team: "home" | "away";
    playerId: string | null;
    player: string | null;
    minute: string | null;
    result: string | null;
    xG: number | null;
    sourceX: number | null;
    sourceY: number | null;
    situation: string | null;
    shotType: string | null;
    lastAction: string | null;
    assistedBy: string | null;
  }>;
  notes: string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numeric(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown): number | null {
  const parsed = numeric(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function rowsByObject(value: unknown): Array<[string, unknown]> {
  const source = record(value);
  return source ? Object.entries(source) : [];
}

function seasonRows(payload: Record<string, unknown>): unknown[] {
  const groups = record(payload.groups);
  return list(groups?.season);
}

function readPositionEvidence(payload: Record<string, unknown>): UnderstatPlayerInsight["positions"] {
  const groups = record(payload.groups);
  const bySeason = record(groups?.position);
  if (!bySeason) return undefined;
  const positions = rowsByObject(bySeason).flatMap(([season, value]) => {
    return rowsByObject(value).flatMap(([code, rawRow]) => {
      const row = record(rawRow);
      if (!row) return [];
      return [{
        season,
        code,
        minutes: numeric(row.time),
        games: integer(row.games),
        goals: numeric(row.goals),
        shots: numeric(row.shots),
        xG: numeric(row.xG),
        assists: numeric(row.assists),
        xA: numeric(row.xA),
        keyPasses: numeric(row.key_passes),
        npxG: numeric(row.npxG),
        xGChain: numeric(row.xGChain),
        xGBuildup: numeric(row.xGBuildup),
      }];
    });
  });
  if (!positions.length) return undefined;
  return positions.sort((a, b) => b.season.localeCompare(a.season) || (b.minutes ?? -1) - (a.minutes ?? -1));
}

function mapSeason(rowValue: unknown): UnderstatPlayerInsight["history"] extends Array<infer T> | undefined ? T | null : never {
  const row = record(rowValue);
  if (!row) return null;
  return {
    season: String(row.season ?? "unknown"),
    team: text(row.team),
    position: text(row.position),
    games: integer(row.games),
    minutes: numeric(row.time),
    goals: numeric(row.goals),
    shots: numeric(row.shots),
    xG: numeric(row.xG),
    assists: numeric(row.assists),
    xA: numeric(row.xA),
    keyPasses: numeric(row.key_passes),
    npxG: numeric(row.npxG),
    xGChain: numeric(row.xGChain),
    xGBuildup: numeric(row.xGBuildup),
  };
}

function mapPlayerMatch(rowValue: unknown): UnderstatPlayerInsight["recent"] extends Array<infer T> | undefined ? T | null : never {
  const row = record(rowValue);
  if (!row || !text(row.id)) return null;
  return {
    matchId: String(row.id),
    date: text(row.date),
    season: text(row.season),
    homeTeam: text(row.h_team),
    awayTeam: text(row.a_team),
    homeGoals: numeric(row.h_goals),
    awayGoals: numeric(row.a_goals),
    position: text(row.position),
    minutes: numeric(row.time),
    goals: numeric(row.goals),
    shots: numeric(row.shots),
    xG: numeric(row.xG),
    assists: numeric(row.assists),
    xA: numeric(row.xA),
    keyPasses: numeric(row.key_passes),
    npxG: numeric(row.npxG),
    xGChain: numeric(row.xGChain),
    xGBuildup: numeric(row.xGBuildup),
  };
}

function mapShot(rowValue: unknown): UnderstatPlayerInsight["shots"] extends Array<infer T> | undefined ? T | null : never {
  const row = record(rowValue);
  if (!row || !text(row.match_id)) return null;
  return {
    matchId: String(row.match_id),
    date: text(row.date),
    minute: text(row.minute),
    result: text(row.result),
    xG: numeric(row.xG),
    sourceX: numeric(row.X),
    sourceY: numeric(row.Y),
    situation: text(row.situation),
    shotType: text(row.shotType),
    lastAction: text(row.lastAction),
    assistedBy: text(row.player_assisted),
  };
}

function readShotProfile(payload: Record<string, unknown>): UnderstatPlayerInsight["shotProfile"] {
  const groups = record(payload.groups);
  const dimensions = ["situation", "shotZones", "shotTypes"] as const;
  const rows = dimensions.flatMap((dimension) => rowsByObject(groups?.[dimension]).flatMap(([season, categories]) => {
    return rowsByObject(categories).flatMap(([category, rowValue]) => {
      const row = record(rowValue);
      if (!row) return [];
      return [{
        dimension,
        category,
        season,
        goals: numeric(row.goals),
        shots: numeric(row.shots),
        xG: numeric(row.xG),
        assists: numeric(row.assists),
        keyPasses: numeric(row.key_passes),
        xA: numeric(row.xA),
        npg: numeric(row.npg),
        npxG: numeric(row.npxG),
        minutes: numeric(row.time),
      }];
    });
  }));
  if (!rows.length) return undefined;
  const seasonOrder = new Map(seasonRows(payload).flatMap((value) => {
    const row = record(value);
    return row && typeof row.season === "number" ? [[String(row.season), row.season] as const] : [];
  }));
  return rows
    .sort((a, b) => (seasonOrder.get(b.season) ?? -1) - (seasonOrder.get(a.season) ?? -1) || a.dimension.localeCompare(b.dimension))
    .slice(0, 30)
    .map((row) => row);
}

export function projectUnderstatPlayerInsight(input: {
  profile: PlayerProfile;
  snapshot: { payload: unknown; retrievedAt: string };
  sections: readonly UnderstatPlayerSection[];
}): UnderstatPlayerInsight {
  const payload = record(input.snapshot.payload);
  if (!payload) throw new UnderstatProviderError("invalid_response", "Understat 球员详情结构无效。");
  const sourceId = input.profile.externalPlayerId;
  if (!sourceId || !/^[1-9]\d{0,14}$/.test(sourceId)) {
    throw new UnderstatProviderError("unsupported_scope", "这条来源记录没有可用于 Understat 详情查询的原生球员 ID。");
  }
  const player = record(payload.player);
  if (!player || String(player.id) !== sourceId) {
    throw new UnderstatProviderError("invalid_response", "Understat 球员详情 ID 与候选来源 ID 不匹配。");
  }
  const requested = new Set(input.sections);
  const requestedSections = understatPlayerSections.filter((section) => requested.has(section));
  const base: UnderstatPlayerInsight = {
    playerId: input.profile.playerId,
    name: input.profile.name,
    team: input.profile.team,
    competition: input.profile.competition,
    season: input.profile.season,
    sourcePlayerId: sourceId,
    sourceUrl: "https://understat.com/player/" + sourceId,
    retrievedAt: input.snapshot.retrievedAt,
    player: {
      id: sourceId,
      name: text(player.name) ?? input.profile.name,
      favoritePosition: text(player.favorite_position),
    },
    lastMatch: record(payload.lastMatch)
      ? {
        league: text(record(payload.lastMatch)!.league),
        team: text(record(payload.lastMatch)!.team),
        season: text(record(payload.lastMatch)!.season),
      }
      : null,
    requestedSections,
    availableSections: [],
    notes: [
      "Understat 的细位置是其比赛记录位置，不代表球队固定战术职责；Sub 表示替补。",
      "history 与 recent 保留来源累计口径；射门 xG、进球和助攻不能单独证明终结技术或完整创造能力。",
      "minMaxPlayerStats 的参照群体与单位尚未验证，因此不会作为百分位或排序依据。",
    ],
  };
  if (requested.has("positions")) {
    const positions = readPositionEvidence(payload);
    if (positions) base.positions = positions;
  }
  if (requested.has("history")) {
    const history = seasonRows(payload).map(mapSeason).filter((row): row is NonNullable<typeof row> => row !== null);
    if (history.length) base.history = history.sort((a, b) => b.season.localeCompare(a.season)).slice(0, 12);
  }
  if (requested.has("recent")) {
    const recent = list(payload.matches).map(mapPlayerMatch).filter((row): row is NonNullable<typeof row> => row !== null);
    if (recent.length) base.recent = recent.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 8);
  }
  if (requested.has("shotProfile")) {
    const shotProfile = readShotProfile(payload);
    if (shotProfile) base.shotProfile = shotProfile;
  }
  if (requested.has("shots")) {
    const shots = list(payload.shots).map(mapShot).filter((row): row is NonNullable<typeof row> => row !== null);
    if (shots.length) {
      const recent = shots.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (Number(b.minute) || 0) - (Number(a.minute) || 0)).slice(0, 25);
      base.shots = recent;
    }
  }
  base.availableSections = understatPlayerSections.filter((section) => {
    const evidence = base[section];
    return Array.isArray(evidence) && evidence.length > 0;
  });
  return base;
}

/** Keep cohort evidence broad enough to compare roles and shot context without flooding the graph. */
export function compactUnderstatPlayerInsightForCohort(insight: UnderstatPlayerInsight): UnderstatPlayerInsight {
  const limits = { positions: 8, history: 6, recent: 5, shotProfile: 15 } as const;
  const truncatedSections = Object.entries(limits)
    .filter(([key, limit]) => (insight[key as keyof typeof limits]?.length ?? 0) > limit)
    .map(([key]) => key);
  return {
    ...insight,
    ...(insight.positions ? { positions: insight.positions.slice(0, limits.positions) } : {}),
    ...(insight.history ? { history: insight.history.slice(0, limits.history) } : {}),
    ...(insight.recent ? { recent: insight.recent.slice(0, limits.recent) } : {}),
    ...(insight.shotProfile ? { shotProfile: insight.shotProfile.slice(0, limits.shotProfile) } : {}),
    notes: truncatedSections.length > 0
      ? [...insight.notes, `候选组比较为控制上下文长度，仅展示部分 ${truncatedSections.join("、")}；完整原始快照保存在本机，可对重点候选继续调查。`]
      : insight.notes,
  };
}

function positionCodeMatches(code: string, position: PlayerProfile["position"]): boolean {
  const normalized = code.toUpperCase().replace(/[^A-Z]/g, "");
  if (!normalized || normalized === "SUB") return false;
  switch (position) {
    case "GK": return normalized.startsWith("GK");
    case "DEF": case "CB": case "FB": case "LB": case "RB": case "LWB": case "RWB":
      return /^(D|CB|FB|WB)/.test(normalized);
    case "MID": case "DM": case "CM": case "AM":
      return /^(M|DMC|MC|AM|W)/.test(normalized);
    case "ATT": case "WG": case "LW": case "RW": case "ST":
      return /^(F|FW|ST|CF|SS|S)/.test(normalized);
  }
}

/** Project position-split season rows into the same measured metrics used by the evaluator. */
export function understatPositionMetricsForPlayer(
  profile: PlayerProfile,
  insight: UnderstatPlayerInsight,
): SupplementaryPerformanceMetric[] {
  if (profile.sourceIdentity?.provider !== "understat"
    || insight.playerId !== profile.playerId
    || !profile.externalPlayerId
    || insight.sourcePlayerId !== profile.externalPlayerId
    || !insight.availableSections.includes("positions")) return [];

  const season = profile.sourceIdentity.seasonId ?? profile.season.split("/", 1)[0];
  const rows = (insight.positions ?? []).filter((row) => row.season === season && positionCodeMatches(row.code, profile.position));
  if (rows.length === 0) return [];

  const sum = (field: "xG" | "npxG" | "xA" | "shots" | "keyPasses" | "xGChain" | "xGBuildup"): number | undefined => {
    const observed = rows.flatMap((row) => row[field] === null ? [] : [row[field]!]);
    return observed.length ? observed.reduce((total, value) => total + value, 0) : undefined;
  };
  const minutes = rows.flatMap((row) => row.minutes === null ? [] : [row.minutes]).reduce((total, value) => total + value, 0);
  const shots = sum("shots");
  const sourceCodes = [...new Set(rows.map(({ code }) => code))].sort().join("+");
  const definitions = new Map(SupplementaryCapabilityMetricDefinitions.map((item) => [item.key, item]));
  const fields = [
    { key: "understatExpectedGoalsPer90", field: "xG", normalization: "per90", unit: "xG/90分钟" },
    { key: "understatNonPenaltyExpectedGoalsPer90", field: "npxG", normalization: "per90", unit: "npxG/90分钟" },
    { key: "understatExpectedAssistsPer90", field: "xA", normalization: "per90", unit: "xA/90分钟" },
    { key: "understatExpectedGoalsPerShot", field: "xG", normalization: "perShot", unit: "xG/次射门" },
    { key: "understatShotsPer90", field: "shots", normalization: "per90", unit: "次/90分钟" },
    { key: "understatKeyPassesPer90", field: "keyPasses", normalization: "per90", unit: "次/90分钟" },
    { key: "understatXgChainPer90", field: "xGChain", normalization: "per90", unit: "xGChain/90分钟" },
    { key: "understatXgBuildupPer90", field: "xGBuildup", normalization: "per90", unit: "xGBuildup/90分钟" },
  ] as const;

  return fields.flatMap(({ key, field, normalization, unit }) => {
    const raw = sum(field);
    if (raw === undefined) return [];
    const definition = definitions.get(key);
    if (!definition) return [];
    const denominator = field === "xG" && normalization === "perShot" ? shots : minutes;
    const value = denominator === undefined || denominator <= 0
      ? null
      : Math.round((raw * (normalization === "perShot" ? 1 : 90)) / denominator * 100) / 100;
    return [{
      key,
      definition: definition.definition,
      value,
      unit,
      normalization,
      sourceField: `groups.position[${season}][${sourceCodes}].${field}`,
      sampleMinutes: minutes || null,
      sampleMatches: null,
      ...(field === "xG" && normalization === "perShot" && shots !== undefined
        ? { sampleAttempts: Math.round(shots), sampleAttemptsLabel: "次射门" }
        : {}),
    } satisfies SupplementaryPerformanceMetric];
  });
}

function competitionSlug(profile: PlayerProfile): string | null {
  return profile.sourceIdentity?.competitionId ?? null;
}

function understatTeamSlug(teamName: string): string {
  return teamName.trim().replace(/\s+/gu, "_");
}

function currentSeasonStartYear(profile: PlayerProfile): number | null {
  const start = profile.sourceIdentity?.seasonId;
  return start && /^\d{4}$/.test(start) ? Number(start) : null;
}

export async function inspectUnderstatTeam(
  gateway: UnderstatDataGateway,
  players: readonly PlayerProfile[],
  requestedTeam: string,
  signal?: AbortSignal,
): Promise<UnderstatTeamInsight | null> {
  const matching = players.filter((player) => teamNamesMatch(player.team, requestedTeam)
    || normalizeSearchText(player.team) === normalizeSearchText(requestedTeam));
  const identities = new Map(matching.map((player) => [
    JSON.stringify([player.team, player.sourceIdentity?.competitionId, player.sourceIdentity?.seasonId]),
    player,
  ]));
  if (identities.size === 0) return null;
  if (identities.size > 1) {
    throw new UnderstatProviderError("unsupported_scope", "Understat 当前赛季数据中存在多个同名球队记录，无法安全选择其中一个。");
  }
  const profile = [...identities.values()][0]!;
  const competition = competitionSlug(profile);
  const season = currentSeasonStartYear(profile);
  if (!competition || season === null) return null;
  const teamSlug = understatTeamSlug(profile.team);
  const snapshot = await gateway.get("team", teamSlug, season, { signal });
  const payload = record(snapshot.payload);
  if (!payload) throw new UnderstatProviderError("invalid_response", "Understat 球队详情结构无效。");
  const dates = list(payload.dates).flatMap((value) => {
    const row = record(value);
    if (!row || !text(row.id)) return [];
    const home = record(row.h);
    const away = record(row.a);
    const goals = record(row.goals);
    const xG = record(row.xG);
    return [{
      matchId: String(row.id),
      date: text(row.datetime),
      status: row.isResult === true ? "played" : "scheduled",
      homeTeam: text(home?.title),
      awayTeam: text(away?.title),
      homeGoals: numeric(goals?.h),
      awayGoals: numeric(goals?.a),
      homeXG: numeric(xG?.h),
      awayXG: numeric(xG?.a),
      result: text(row.result),
    }];
  }).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 8);
  const statistics = Object.entries(record(payload.statistics) ?? {}).flatMap(([dimension, value]) => {
    return rowsByObject(value).flatMap(([category, rowValue]) => {
      const row = record(rowValue);
      if (!row) return [];
      const against = record(row.against);
      return [{
        dimension,
        category,
        shots: numeric(row.shots),
        goals: numeric(row.goals),
        xG: numeric(row.xG),
        againstShots: numeric(against?.shots),
        againstGoals: numeric(against?.goals),
        againstXG: numeric(against?.xG),
        attempts: numeric(row.stat),
        time: numeric(row.time),
      }];
    });
  });
  const teamPlayers = list(payload.players).flatMap((value) => {
    const row = record(value);
    if (!row || !text(row.id) || !text(row.player_name)) return [];
    return [{
      id: String(row.id),
      name: String(row.player_name),
      position: text(row.position),
      games: integer(row.games),
      minutes: numeric(row.time),
      goals: numeric(row.goals),
      xG: numeric(row.xG),
      assists: numeric(row.assists),
      xA: numeric(row.xA),
      shots: numeric(row.shots),
      keyPasses: numeric(row.key_passes),
      xGChain: numeric(row.xGChain),
      xGBuildup: numeric(row.xGBuildup),
    }];
  }).sort((a, b) => (b.minutes ?? -1) - (a.minutes ?? -1)).slice(0, 25);
  return {
    team: profile.team,
    competition: profile.competition,
    season: profile.season,
    sourceUrl: "https://understat.com/team/" + encodeURIComponent(teamSlug) + "/" + season,
    retrievedAt: snapshot.retrievedAt,
    recentMatches: dates,
    statistics,
    players: teamPlayers,
    notes: [
      "球队统计是 Understat 对该队该赛季的进攻/防守事件拆分，不等于完整阵容或球员战术职责。",
      "攻防拆分保留来源口径；比赛进程和对手强弱未在这里控制，不折算成通用战术适配分。",
      "队伍球员列表是来源表现样本，不能证明当前注册状态。",
    ],
  };
}

export async function inspectUnderstatMatch(
  gateway: UnderstatDataGateway,
  matchId: string,
  signal?: AbortSignal,
): Promise<UnderstatMatchInsight> {
  const snapshot = await gateway.get("match", matchId, null, { signal });
  const payload = record(snapshot.payload);
  if (!payload) throw new UnderstatProviderError("invalid_response", "Understat 比赛详情结构无效。");
  const rosters = (["h", "a"] as const).flatMap((team) => {
    const rows = record(payload.rosters)?.[team];
    return rowsByObject(rows).flatMap(([, value]) => {
      const row = record(value);
      if (!row) return [];
      return [{
        team: team === "h" ? "home" as const : "away" as const,
        playerId: text(row.player_id),
        name: text(row.player),
        position: text(row.position),
        positionOrder: integer(row.positionOrder),
        minutes: numeric(row.time),
        goals: numeric(row.goals),
        ownGoals: numeric(row.own_goals),
        shots: numeric(row.shots),
        xG: numeric(row.xG),
        assists: numeric(row.assists),
        xA: numeric(row.xA),
        keyPasses: numeric(row.key_passes),
        yellowCards: integer(row.yellow_card),
        redCards: integer(row.red_card),
      }];
    });
  }).sort((a, b) => (a.team === b.team ? (a.positionOrder ?? 999) - (b.positionOrder ?? 999) : a.team === "home" ? -1 : 1));
  const shots = (["h", "a"] as const).flatMap((team) => list(record(payload.shots)?.[team]).flatMap((value) => {
    const row = record(value);
    if (!row) return [];
    return [{
      team: team === "h" ? "home" as const : "away" as const,
      playerId: text(row.player_id),
      player: text(row.player),
      minute: text(row.minute),
      result: text(row.result),
      xG: numeric(row.xG),
      sourceX: numeric(row.X),
      sourceY: numeric(row.Y),
      situation: text(row.situation),
      shotType: text(row.shotType),
      lastAction: text(row.lastAction),
      assistedBy: text(row.player_assisted),
    }];
  })).slice(0, 80);
  const shotGroups = record(payload.shots);
  const firstShot = (list(shotGroups?.h).concat(list(shotGroups?.a)))
    .map(record)
    .find((row): row is Record<string, unknown> => row !== undefined);
  return {
    matchId,
    sourceUrl: "https://understat.com/match/" + matchId,
    homeTeam: text(firstShot?.h_team),
    awayTeam: text(firstShot?.a_team),
    date: text(firstShot?.date),
    score: { home: numeric(firstShot?.h_goals), away: numeric(firstShot?.a_goals) },
    rosters,
    shots,
    notes: [
      "名单与事件只覆盖此场比赛；不外推成赛季职责、稳定能力或球员当前效力。",
      "roster_in/roster_out 在 Understat 源记录中是名单记录关联字段，不在此转换成换人分钟。",
      "射门坐标保持来源字段值；该视图不推断球场方向或射门位置类型。",
    ],
  };
}
