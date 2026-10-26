import { z } from "zod/v4";

const apiBaseUrl = "https://v3.football.api-sports.io";
const rosterCacheTtlMs = 7 * 24 * 60 * 60 * 1000;

const apiJsonSchema = z.json();

type ApiJson = z.infer<typeof apiJsonSchema>;

const apiEnvelopeSchema = z.object({
  errors: apiJsonSchema.optional(),
  response: z.array(apiJsonSchema),
});

const teamSchema = z.object({
  country: z.string().nullable().optional(),
  id: z.number().int().positive(),
  name: z.string().min(1),
});

const teamSearchItemSchema = z.object({ team: teamSchema });

const rosterPlayerSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  position: z.string().nullable().optional(),
});

const squadResponseSchema = z.object({
  players: z.array(rosterPlayerSchema),
  team: teamSchema,
});

type ApiFootballTeam = {
  country: string | null;
  id: number;
  name: string;
};

type ApiFootballRosterPlayer = {
  id: number;
  name: string;
  position: string | null;
};

type ApiFootballRoster = {
  players: ApiFootballRosterPlayer[];
  retrievedAt: string;
  team: ApiFootballTeam;
};

type ApiFootballFailure = {
  message: string;
  reason: "configuration" | "quota" | "provider";
  status: "error";
};

type ApiFootballResult<Value> =
  | { data: Value; status: "ok" }
  | ApiFootballFailure;

type ApiFootballClient = {
  getSquad: (teamId: number) => Promise<ApiFootballResult<ApiFootballRoster>>;
  searchTeams: (query: string) => Promise<ApiFootballResult<ApiFootballTeam[]>>;
};

type CreateApiFootballClientOptions = {
  apiKey?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
};

type RosterCacheEntry = {
  expiresAt: number;
  roster: ApiFootballRoster;
};

const toApiFootballTeam = (
  team: z.output<typeof teamSchema>
): ApiFootballTeam => ({
  country: team.country ?? null,
  id: team.id,
  name: team.name,
});

const failure = (
  reason: ApiFootballFailure["reason"],
  message: string
): ApiFootballFailure => ({ message, reason, status: "error" });

const quotaErrorPatterns = [
  "quota",
  "rate limit",
  "ratelimit",
  "request limit",
  "requests limit",
];

const providerFailure = (errors: ApiJson): ApiFootballFailure => {
  const message = JSON.stringify(errors);
  const lowerMessage = message.toLocaleLowerCase();

  const isQuotaError = quotaErrorPatterns.some((pattern) =>
    lowerMessage.includes(pattern)
  );

  return isQuotaError
    ? failure("quota", "API-Football 请求额度已用完。")
    : failure("provider", `API-Football 返回错误：${message}`);
};

const createApiFootballClient = (
  options: CreateApiFootballClientOptions = {}
): ApiFootballClient => {
  const apiKey = options.apiKey?.trim() ?? "";
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const rosterCache = new Map<number, RosterCacheEntry>();

  const getJson = async (
    path: string
  ): Promise<ApiFootballResult<z.output<typeof apiEnvelopeSchema>>> => {
    if (apiKey.length === 0) {
      return failure(
        "configuration",
        "未配置 API_FOOTBALL_KEY，无法读取球队或阵容。"
      );
    }

    try {
      const response = await fetcher(`${apiBaseUrl}${path}`, {
        headers: { "x-apisports-key": apiKey },
      });

      if (response.status === 429) {
        return failure("quota", "API-Football 请求频率或额度已达上限。");
      }

      if (!response.ok) {
        return failure(
          "provider",
          `API-Football 请求失败（HTTP ${response.status}）。`
        );
      }

      const parsed = apiEnvelopeSchema.safeParse(await response.json());

      if (!parsed.success) {
        return failure("provider", "API-Football 返回的数据格式无法识别。");
      }

      const { errors } = parsed.data;

      if (
        errors !== undefined &&
        errors !== null &&
        JSON.stringify(errors) !== "{}" &&
        JSON.stringify(errors) !== "[]"
      ) {
        return providerFailure(errors);
      }

      return { data: parsed.data, status: "ok" };
    } catch {
      return failure("provider", "无法连接 API-Football，请稍后重试。");
    }
  };

  const searchTeams = async (
    query: string
  ): Promise<ApiFootballResult<ApiFootballTeam[]>> => {
    const normalizedQuery = query.trim();

    if (normalizedQuery.length < 3) {
      return failure("provider", "球队名称至少需要三个字符才能查询。");
    }

    const result = await getJson(
      `/teams?search=${encodeURIComponent(normalizedQuery)}`
    );

    if (result.status === "error") {
      return result;
    }

    const parsedTeams = z
      .array(teamSearchItemSchema)
      .safeParse(result.data.response);

    if (!parsedTeams.success) {
      return failure("provider", "API-Football 返回的球队列表无法识别。");
    }

    const teams = new Map<number, ApiFootballTeam>();

    for (const item of parsedTeams.data) {
      teams.set(item.team.id, toApiFootballTeam(item.team));
    }

    return { data: [...teams.values()], status: "ok" };
  };

  const getSquad = async (
    teamId: number
  ): Promise<ApiFootballResult<ApiFootballRoster>> => {
    const cacheEntry = rosterCache.get(teamId);
    const currentTime = now().getTime();

    if (cacheEntry !== undefined && cacheEntry.expiresAt > currentTime) {
      return { data: cacheEntry.roster, status: "ok" };
    }

    const result = await getJson(`/players/squads?team=${teamId}`);

    if (result.status === "error") {
      return result;
    }

    const parsedSquads = z
      .array(squadResponseSchema)
      .safeParse(result.data.response);

    if (!parsedSquads.success || parsedSquads.data.length !== 1) {
      return failure("provider", "API-Football 返回的球队阵容无法识别。");
    }

    const [squad] = parsedSquads.data;

    if (squad === undefined || squad.team.id !== teamId) {
      return failure("provider", "API-Football 阵容与所选球队不一致。");
    }

    const retrievedAt = now();

    const roster: ApiFootballRoster = {
      players: squad.players.map((player) => ({
        id: player.id,
        name: player.name,
        position: player.position ?? null,
      })),
      retrievedAt: retrievedAt.toISOString(),
      team: toApiFootballTeam(squad.team),
    };

    rosterCache.set(teamId, {
      expiresAt: retrievedAt.getTime() + rosterCacheTtlMs,
      roster,
    });

    return { data: roster, status: "ok" };
  };

  return { getSquad, searchTeams };
};

let defaultClient: ApiFootballClient | null = null;

const getDefaultApiFootballClient = (): ApiFootballClient => {
  defaultClient ??= createApiFootballClient({
    apiKey: process.env.API_FOOTBALL_KEY,
  });

  return defaultClient;
};

const searchApiFootballTeams = async (query: string) =>
  await getDefaultApiFootballClient().searchTeams(query);

const getApiFootballSquad = async (teamId: number) =>
  await getDefaultApiFootballClient().getSquad(teamId);

export { createApiFootballClient, getApiFootballSquad, searchApiFootballTeams };

export type {
  ApiFootballClient,
  ApiFootballFailure,
  ApiFootballResult,
  ApiFootballRoster,
  ApiFootballRosterPlayer,
  ApiFootballTeam,
};
