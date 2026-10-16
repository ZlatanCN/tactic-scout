import type { PlayerProfile } from "../domain/schemas.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import type { PlayerRepository } from "./player-repository.js";
import { matchesPlayerSearch, searchLoadedPlayers, type PlayerSearchFilter, type PlayerSearchPage, type PlayerSearchQuery } from "./player-search.js";
import { throwIfAborted } from "../domain/abort.js";

const supportedAsaCompetitionIds = new Set(["mls", "uslc", "usl1"]);

interface MultiSourceRepositories {
  understat: PlayerRepository;
  asa: Pick<PlayerRepository, "mode" | "sourceName"> & { loadMenPlayers(refresh?: boolean, signal?: AbortSignal): Promise<PlayerProfile[]> };
}

export type MultiSourceProviderErrorCode = "unsupported_scope" | "source_error" | "invalid_configuration" | "network" | "timeout" | "blocked" | "rate_limit" | "request_failed" | "redirect_rejected" | "response_too_large" | "invalid_response";

export class MultiSourceProviderError extends Error {
  constructor(readonly code: MultiSourceProviderErrorCode, message: string) {
    super(message);
    this.name = "MultiSourceProviderError";
  }
}

function providerErrorCode(error: unknown): MultiSourceProviderErrorCode {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[a-z0-9_-]{1,40}$/i.test(code)) return code as MultiSourceProviderErrorCode;
  }
  return "source_error";
}

function sourceCompetitionKey(player: PlayerProfile): string | null {
  const identity = player.sourceIdentity;
  if (!identity?.provider || !identity.competitionId || !identity.seasonId || !identity.positionGroup) return null;
  return [identity.provider, identity.competitionId, identity.seasonId, identity.positionGroup].join("\u0000");
}

function interleaveCompetitions(players: readonly PlayerProfile[]): PlayerProfile[] {
  const groups = new Map<string, PlayerProfile[]>();
  for (const player of players) {
    const key = [player.sourceIdentity?.provider ?? "unknown", player.sourceIdentity?.competitionId ?? player.competition, player.season].join("\u0000");
    const group = groups.get(key) ?? [];
    group.push(player);
    groups.set(key, group);
  }
  const orderedGroups = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => group);
  const interleaved: PlayerProfile[] = [];
  const longest = Math.max(0, ...orderedGroups.map((group) => group.length));
  for (let index = 0; index < longest; index += 1) {
    for (const group of orderedGroups) {
      const player = group[index];
      if (player) interleaved.push(player);
    }
  }
  return interleaved;
}

function matchesTeam(player: PlayerProfile, teamName: string): boolean {
  const query = normalizeSearchText(teamName);
  const team = normalizeSearchText(player.team);
  return team === query || (query.length >= 4 && team.includes(query)) || (team.length >= 4 && query.includes(team));
}

function isUnsupportedAsaScope(competition: string | null): boolean {
  if (!competition) return false;
  const normalized = normalizeSearchText(competition);
  return normalized.startsWith("usl") && !isAsaMenScope(competition);
}

function isAsaMenScope(competition: string | null): boolean {
  if (!competition) return false;
  const normalized = normalizeSearchText(competition);
  return normalized === "usl" || [
    "asa 北美男足赛事", "asa 男足赛事", "asa men's competitions", "asa mens competitions",
    "asa men", "asa 男足", "mls", "major league soccer", "uslc", "usl championship",
    "usl1", "usl league one", "美国职业足球大联盟", "美国足球冠军联赛", "美国足球甲级联赛",
  ].some((alias) => normalized === normalizeSearchText(alias));
}

/**
 * Composes two existing current-season sources behind one repository interface.
 * Queries are all-or-nothing: a failed source never looks like a complete pool.
 * Raw records retain their provider identity and are never joined by names.
 */
export class MultiSourceCurrentPlayerRepository implements PlayerRepository {
  readonly mode = "mosaic" as const;
  readonly sourceName = "Understat 五大联赛 + ASA 北美三项男足赛事 · 多来源当前赛季表现池";

  constructor(private readonly repositories: MultiSourceRepositories) {}

  async loadPlayers(refresh = false, signal?: AbortSignal): Promise<PlayerProfile[]> {
    throwIfAborted(signal);
    const loadSource = async (sourceName: string, loader: () => Promise<PlayerProfile[]>): Promise<PlayerProfile[]> => {
      try {
        return await loader();
      } catch (error) {
        if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
        const code = providerErrorCode(error);
        const detail = error instanceof Error ? error.message : "未知来源错误";
        throw new MultiSourceProviderError(code, `${sourceName} 未能读取；本轮多来源候选池不完整。${detail}`);
      }
    };

    const [understatPlayers, asaPlayers] = await Promise.all([
      loadSource("Understat", () => {
        if (!this.repositories.understat.loadPlayers) throw new Error(`${this.repositories.understat.sourceName} does not expose a full player catalog.`);
        return this.repositories.understat.loadPlayers(refresh, signal);
      }),
      loadSource("ASA", () => this.repositories.asa.loadMenPlayers(refresh, signal)),
    ]);
    throwIfAborted(signal);
    const players = [
      ...understatPlayers,
      ...asaPlayers.filter((player) => supportedAsaCompetitionIds.has(player.sourceIdentity?.competitionId ?? "")),
    ];
    const identifiers = new Set<string>();
    for (const player of players) {
      throwIfAborted(signal);
      if (identifiers.has(player.playerId)) {
        throw new MultiSourceProviderError("invalid_response", `多来源仓库遇到重复的原生球员记录 ID：${player.playerId}`);
      }
      identifiers.add(player.playerId);
    }
    return interleaveCompetitions(players);
  }

  async searchCandidates(query: PlayerSearchQuery, signal?: AbortSignal): Promise<PlayerSearchPage> {
    throwIfAborted(signal);
    if (isUnsupportedAsaScope(query.competition)) {
      throw new MultiSourceProviderError("unsupported_scope", "该赛事不属于当前多来源候选范围；ASA 仅支持 MLS、USL Championship 与 USL League One。");
    }
    if (query.maxAge !== null && !isAsaMenScope(query.competition)) {
      throw new MultiSourceProviderError(
        "unsupported_scope",
        "多来源当前赛季表现池中的 Understat 记录没有年龄字段；若要保留年龄上限，请明确限定到 ASA 的 MLS/USL 男足赛事，或先确认是否取消年龄上限。不能把未知年龄当成符合条件。",
      );
    }
    const players = await this.loadPlayers(false, signal);
    throwIfAborted(signal);
    const orderedPlayers = interleaveCompetitions(players.filter((player) => matchesPlayerSearch(player, query)));
    const page = searchLoadedPlayers(orderedPlayers, {
      ...query,
      playerName: null,
      position: null,
      maxAge: null,
      minimumMinutes: 0,
      competition: null,
      season: null,
    });
    const appliedFilters: PlayerSearchFilter[] = [];
    if (query.playerName) appliedFilters.push("playerName");
    if (query.position) appliedFilters.push("position");
    if (query.minimumMinutes > 0) appliedFilters.push("minimumMinutes");
    if (query.competition) appliedFilters.push("competition");
    if (query.season) appliedFilters.push("season");
    if (query.maxAge !== null) appliedFilters.push("maxAge");
    return { ...page, appliedFilters };
  }

  async getPlayersByIds(playerIds: readonly string[], signal?: AbortSignal): Promise<PlayerProfile[]> {
    throwIfAborted(signal);
    const wanted = new Set(playerIds);
    if (!wanted.size) return [];
    return (await this.loadPlayers(false, signal)).filter((player) => wanted.has(player.playerId));
  }

  async getComparisonPlayers(players: readonly PlayerProfile[], signal?: AbortSignal): Promise<PlayerProfile[]> {
    throwIfAborted(signal);
    const keys = new Set(players.map(sourceCompetitionKey).filter((key): key is string => key !== null));
    if (!keys.size) return [];
    return (await this.loadPlayers(false, signal)).filter((player) => {
      const key = sourceCompetitionKey(player);
      return key !== null && keys.has(key);
    });
  }

  async inspectTeam(teamName: string, signal?: AbortSignal): Promise<PlayerProfile[]> {
    throwIfAborted(signal);
    return (await this.loadPlayers(false, signal)).filter((player) => matchesTeam(player, teamName));
  }
}
