import { z } from "zod/v4";
import { normalizeSearchText } from "../domain/text-matching.js";
import { TeamRosterContextSchema, type TeamRosterContext } from "../domain/schemas.js";

export const THESPORTSDB_SOURCE_URL = "https://www.thesportsdb.com/documentation";
const API_BASE_URL = "https://www.thesportsdb.com/api/v1/json";
const RESULT_LIMIT = 10;
const REQUEST_TIMEOUT_MS = 8_000;

const ProviderIdSchema = z.union([
  z.string().trim().min(1),
  z.number().int().positive().transform(String),
]);

const ProviderTeamSchema = z.object({
  idTeam: ProviderIdSchema,
  strTeam: z.string().trim().min(1),
  strTeamAlternate: z.string().nullable().optional(),
});

const ProviderPlayerSchema = z.object({
  idPlayer: ProviderIdSchema,
  strPlayer: z.string().trim().min(1),
  strPosition: z.string().trim().nullable().optional(),
});

const SearchTeamsResponseSchema = z.object({
  teams: z.array(ProviderTeamSchema).nullable().optional(),
});

const TeamPlayersResponseSchema = z.object({
  player: z.array(ProviderPlayerSchema).nullable().optional(),
});

export type TeamRosterEnrichmentProvider = {
  lookupTeamRosterSample(teamName: string, signal?: AbortSignal): Promise<TeamRosterContext>;
};

type ProviderFailure = Extract<TeamRosterContext["failureKind"], string>;

function sourceUrlForTeam(id: string): string {
  return `https://www.thesportsdb.com/team/${encodeURIComponent(id)}`;
}

function sourceUrlForPlayer(id: string): string {
  return `https://www.thesportsdb.com/player/${encodeURIComponent(id)}`;
}

function emptyContext(input: {
  status: TeamRosterContext["status"];
  requestedTeam: string;
  failureKind?: ProviderFailure | null;
  notice: string;
  matchedTeams?: TeamRosterContext["matchedTeams"];
  team?: TeamRosterContext["team"];
  retrievedAt?: string | null;
}): TeamRosterContext {
  return TeamRosterContextSchema.parse({
    status: input.status,
    requestedTeam: input.requestedTeam,
    matchedTeams: input.matchedTeams ?? [],
    team: input.team ?? null,
    players: [],
    returnedCount: 0,
    resultLimit: RESULT_LIMIT,
    possiblyTruncated: false,
    retrievedAt: input.retrievedAt ?? null,
    sourceUrl: THESPORTSDB_SOURCE_URL,
    failureKind: input.failureKind ?? null,
    notice: input.notice,
  });
}

function exactNameMatches(team: z.infer<typeof ProviderTeamSchema>, requestedName: string): boolean {
  const target = normalizeSearchText(requestedName);
  if (!target) return false;
  const names = [team.strTeam, ...(team.strTeamAlternate ?? "").split(/[;,]/)];
  return names.some((name) => normalizeSearchText(name) === target);
}

function abortReason(signal?: AbortSignal): never {
  if (signal?.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
}

async function getJson(url: URL, signal?: AbortSignal): Promise<
  | { ok: true; value: unknown }
  | { ok: false; kind: ProviderFailure; notice: string }
> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  try {
    const response = await fetch(url, { signal: requestSignal, headers: { accept: "application/json" } });
    if (signal?.aborted) abortReason(signal);
    if (response.status === 429) return { ok: false, kind: "rate_limited", notice: "TheSportsDB 暂时限制了请求频率；没有把失败解释为空阵容。" };
    if (!response.ok) return { ok: false, kind: "http", notice: `TheSportsDB 返回 HTTP ${response.status}；没有把失败解释为空阵容。` };
    try {
      return { ok: true, value: await response.json() };
    } catch {
      if (signal?.aborted) abortReason(signal);
      if (timeoutSignal.aborted) return { ok: false, kind: "timeout", notice: "TheSportsDB 响应读取超时；没有把失败解释为空阵容。" };
      return { ok: false, kind: "invalid_response", notice: "TheSportsDB 返回的内容不是有效 JSON；没有把失败解释为空阵容。" };
    }
  } catch {
    if (signal?.aborted) abortReason(signal);
    if (timeoutSignal.aborted) return { ok: false, kind: "timeout", notice: "TheSportsDB 请求超时；没有把失败解释为空阵容。" };
    return { ok: false, kind: "network", notice: "无法连接 TheSportsDB；没有把失败解释为空阵容。" };
  }
}

export function createTheSportsDbRosterEnrichment(options: {
  apiKey: string;
  paidUseAllowed?: boolean;
  fetchEnabled?: boolean;
}): TeamRosterEnrichmentProvider {
  return {
    async lookupTeamRosterSample(teamName, signal) {
      const requestedTeam = teamName.trim();
      const apiKey = options.apiKey.trim();
      if (!options.fetchEnabled) return emptyContext({
        status: "not_configured",
        requestedTeam,
        failureKind: "disabled",
        notice: "TheSportsDB 球队背景查询尚未启用。",
      });
      if (!apiKey) return emptyContext({
        status: "unavailable",
        requestedTeam,
        failureKind: "missing_api_key",
        notice: "TheSportsDB 已启用，但服务端没有配置 API key。",
      });
      if (process.env.NODE_ENV === "production" && !options.paidUseAllowed) return emptyContext({
        status: "unavailable",
        requestedTeam,
        failureKind: "paid_plan_required",
        notice: "TheSportsDB 免费 key 仅供开发项目使用；线上查询需要配置已获许可的付费计划。",
      });
      if (!normalizeSearchText(requestedTeam)) return emptyContext({
        status: "not_found",
        requestedTeam,
        notice: "目标球队名称无法用于 TheSportsDB 精确匹配。",
      });

      const searchUrl = new URL(`${API_BASE_URL}/${encodeURIComponent(apiKey)}/searchteams.php`);
      searchUrl.searchParams.set("t", requestedTeam);
      const searchResult = await getJson(searchUrl, signal);
      if (!searchResult.ok) return emptyContext({
        status: "unavailable",
        requestedTeam,
        failureKind: searchResult.kind,
        notice: searchResult.notice,
      });

      const parsedSearch = SearchTeamsResponseSchema.safeParse(searchResult.value);
      if (!parsedSearch.success) return emptyContext({
        status: "unavailable",
        requestedTeam,
        failureKind: "invalid_response",
        notice: "TheSportsDB 球队搜索响应缺少预期字段；没有把失败解释为空阵容。",
      });

      const exactMatches = [...new Map((parsedSearch.data.teams ?? [])
        .filter((team) => exactNameMatches(team, requestedTeam))
        .map((team) => [team.idTeam, team])).values()];
      const matchReferences = exactMatches.slice(0, 5).map((team) => ({
        id: team.idTeam,
        name: team.strTeam,
        url: sourceUrlForTeam(team.idTeam),
      }));
      const retrievedAt = new Date().toISOString();
      if (exactMatches.length === 0) return emptyContext({
        status: "not_found",
        requestedTeam,
        retrievedAt,
        notice: "TheSportsDB 没有返回名称完全匹配的球队；未查询球员列表。",
      });
      if (exactMatches.length > 1) return emptyContext({
        status: "ambiguous",
        requestedTeam,
        matchedTeams: matchReferences,
        retrievedAt,
        notice: "TheSportsDB 返回多个同名球队；为避免串队，没有选择其中任何一队。",
      });

      const [matchedTeam] = exactMatches;
      const rosterUrl = new URL(`${API_BASE_URL}/${encodeURIComponent(apiKey)}/lookup_all_players.php`);
      rosterUrl.searchParams.set("id", matchedTeam.idTeam);
      const rosterResult = await getJson(rosterUrl, signal);
      if (!rosterResult.ok) return emptyContext({
        status: "unavailable",
        requestedTeam,
        matchedTeams: matchReferences,
        team: matchReferences[0],
        retrievedAt: new Date().toISOString(),
        failureKind: rosterResult.kind,
        notice: rosterResult.notice,
      });

      const parsedRoster = TeamPlayersResponseSchema.safeParse(rosterResult.value);
      if (!parsedRoster.success) return emptyContext({
        status: "unavailable",
        requestedTeam,
        matchedTeams: matchReferences,
        team: matchReferences[0],
        retrievedAt: new Date().toISOString(),
        failureKind: "invalid_response",
        notice: "TheSportsDB 球员列表响应缺少预期字段；没有把失败解释为空阵容。",
      });

      const rawPlayers = parsedRoster.data.player ?? [];
      const validPlayers = rawPlayers.flatMap((player) => {
        const parsed = ProviderPlayerSchema.safeParse(player);
        return parsed.success ? [parsed.data] : [];
      });
      if (rawPlayers.length > 0 && validPlayers.length === 0) return emptyContext({
        status: "unavailable",
        requestedTeam,
        matchedTeams: matchReferences,
        team: matchReferences[0],
        retrievedAt: new Date().toISOString(),
        failureKind: "invalid_response",
        notice: "TheSportsDB 球员记录没有可用的 ID 和姓名字段；没有把失败解释为空阵容。",
      });

      const players = [...new Map(validPlayers.map((player) => [player.idPlayer, player])).values()]
        .slice(0, RESULT_LIMIT)
        .map((player) => ({
          id: player.idPlayer,
          name: player.strPlayer,
          position: player.strPosition?.trim() || null,
          url: sourceUrlForPlayer(player.idPlayer),
        }));
      const possiblyTruncated = rawPlayers.length >= RESULT_LIMIT;
      const notice = players.length === 0
        ? "TheSportsDB 没有返回球员记录；这不证明球队当前没有注册球员。该列表只覆盖提供方记录的第一球队归属，完整性和更新时间均未验证。"
        : `仅供球队背景参考：TheSportsDB 列出球员的第一球队归属，不能证明当前注册、可转会状态或完整阵容；更新时间与覆盖完整性未验证。${possiblyTruncated ? "本次结果达到免费接口每队 10 条上限，列表可能被截断。" : "即使少于 10 人，也不能据此认定阵容完整。"}${validPlayers.length < rawPlayers.length ? "部分缺少稳定 ID 或姓名的记录已省略。" : ""}`;

      return TeamRosterContextSchema.parse({
        status: players.length === 0 ? "empty" : "partial",
        requestedTeam,
        matchedTeams: matchReferences,
        team: { ...matchReferences[0] },
        players,
        returnedCount: rawPlayers.length,
        resultLimit: RESULT_LIMIT,
        possiblyTruncated,
        retrievedAt: new Date().toISOString(),
        sourceUrl: THESPORTSDB_SOURCE_URL,
        failureKind: null,
        notice,
      });
    },
  };
}
