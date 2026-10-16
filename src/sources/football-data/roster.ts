import { teamNamesMatch } from "../../domain/team-names.js";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { TeamRosterContextSchema, type TeamRosterContext } from "../../domain/conversation.js";
import type { TeamRosterEnrichmentProvider } from "../thesportsdb/roster.js";

const BASE = "https://api.football-data.org/v4";
const competitions = ["BL1", "PL", "PD", "SA", "FL1"];
const TTL = 24 * 60 * 60 * 1000;

export function createFootballDataRoster(options: { apiKey: string; cacheDirectory?: string }): TeamRosterEnrichmentProvider {
  const directory = options.cacheDirectory ?? ".data/football-data";
  let nextRequestAt = 0;
  let queue: Promise<unknown> = Promise.resolve();
  async function loadTeams(code: string, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const path = join(directory, `${code}.json`);
    try {
      const cached = JSON.parse(await readFile(path, "utf8"));
      if (Date.now() - cached.savedAt < TTL) return { ...cached.payload, localRetrievedAt: new Date(cached.savedAt).toISOString() };
    } catch { /* Missing or invalid cache requires a fresh request. */ }
    const remainingWait = nextRequestAt - Date.now();
    if (remainingWait > 0) await delay(remainingWait, undefined, { signal });
    nextRequestAt = Date.now() + 6500;
    const response = await fetch(`${BASE}/competitions/${code}/teams`, {
      headers: { "X-Auth-Token": options.apiKey, accept: "application/json" },
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    const remaining = response.headers.get("x-requests-available-minute");
    const reset = Number(response.headers.get("x-requestcounter-reset"));
    if (remaining === "0" || response.status === 429) nextRequestAt = Date.now() + (Number.isFinite(reset) && reset > 0 ? reset : 60) * 1000;
    if (!response.ok) throw new Error(response.status === 429 ? "rate_limited" : "http");
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("teams" in payload) || !Array.isArray(payload.teams)) throw new Error("invalid_response");
    await mkdir(directory, { recursive: true });
    await writeFile(`${path}.tmp`, JSON.stringify({ savedAt: Date.now(), payload }), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    return { ...payload, localRetrievedAt: new Date().toISOString() };
  }
  async function lookup(requestedTeam: string, signal?: AbortSignal): Promise<TeamRosterContext> {
    const base = { requestedTeam, matchedTeams: [], team: null, players: [], returnedCount: 0, resultLimit: 100, possiblyTruncated: false, retrievedAt: null, sourceUrl: "https://www.football-data.org", failureKind: null };
    if (!options.apiKey) return TeamRosterContextSchema.parse({ ...base, status: "unavailable", failureKind: "missing_api_key", notice: "football-data.org 未配置 API key。" });
    try {
      for (const code of competitions) {
        const payload = await loadTeams(code, signal) as { localRetrievedAt: string; teams: Array<{ id: number; name: string; shortName?: string; tla?: string; squad?: Array<{ id: number; name: string; position?: string; dateOfBirth?: string; nationality?: string }> }> };
        const matches = payload.teams.filter(t => [t.name, t.shortName, t.tla].some(n => n && teamNamesMatch(n, requestedTeam)));
        if (matches.length !== 1) continue;
        const t = matches[0]!;
        const url = `${BASE}/teams/${t.id}`;
        const players = (t.squad ?? []).slice(0, 100).map(p => ({ id: String(p.id), name: p.name, position: p.position ?? null, dateOfBirth: p.dateOfBirth ?? null, nationality: p.nationality ?? null, url: `${BASE}/persons/${p.id}` }));
        return TeamRosterContextSchema.parse({ ...base, status: "available", team: { id: String(t.id), name: t.name, url }, matchedTeams: [{ id: String(t.id), name: t.name, url }], players, returnedCount: players.length, possiblyTruncated: (t.squad?.length ?? 0) > 100, retrievedAt: payload.localRetrievedAt, notice: `football-data.org ${code} 球队名单提供 ${players.length} 人；24 小时本地缓存。阵容与出生日期是背景资料，不作为能力评分或跨来源身份匹配依据。` });
      }
      return TeamRosterContextSchema.parse({ ...base, status: "not_found", notice: "football-data.org 五大联赛名单中没有唯一匹配球队；不代表球队没有阵容。" });
    } catch (error) {
      signal?.throwIfAborted();
      const kind = error instanceof Error && ["rate_limited", "http", "invalid_response"].includes(error.message) ? error.message : "network";
      return TeamRosterContextSchema.parse({ ...base, status: "unavailable", failureKind: kind, notice: `football-data.org 阵容读取失败（${kind}）；不将查询失败解释为空阵容。` });
    }
  }
  return { lookupTeamRosterSample(teamName, signal) {
    const task = queue.then(() => lookup(teamName, signal));
    queue = task.catch(() => undefined);
    return task;
  } };
}
