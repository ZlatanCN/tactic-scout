import { z } from "zod/v4";

import {
  createExternalFaultError,
  isTransientNetworkCode,
  maxExternalRequests,
  remainingRequests,
  retryAfterMs,
} from "../fault-tolerance.js";
import type { FaultCategory } from "../fault-tolerance.js";

const apiBaseUrl = "https://v3.football.api-sports.io";
const rosterCacheTtlMs = 7 * 24 * 60 * 60 * 1000;

const apiJsonSchema = z.json();

type ApiJson = z.infer<typeof apiJsonSchema>;

const apiEnvelopeSchema = z.object({
  errors: apiJsonSchema.optional(),
  response: z.array(apiJsonSchema),
});

const apiFailureReasonSchema = z.enum([
  "attempt_limit",
  "configuration",
  "provider",
  "quota",
  "rate_limit",
]);

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
  durationMs?: number;
  message: string;
  providerCode?: string;
  reason: z.infer<typeof apiFailureReasonSchema>;
  remainingRequests?: number;
  requestsUsed?: number;
  retryAfterMs?: number;
  statusCode?: number;
  status: "error";
};

type ApiFootballFailureReason = ApiFootballFailure["reason"];

type ApiFootballResult<Value> =
  | {
      cached?: boolean;
      data: Value;
      durationMs?: number;
      status: "ok";
    }
  | ApiFootballFailure;

type ApiFootballClient = {
  getSquad: (
    teamId: number,
    options?: ApiFootballRequestOptions
  ) => Promise<ApiFootballResult<ApiFootballRoster>>;
  searchTeams: (
    query: string,
    options?: ApiFootballRequestOptions
  ) => Promise<ApiFootballResult<ApiFootballTeam[]>>;
};

type ApiFootballRequestOptions = {
  attempt?: number;
  node?: string;
  requestsBefore?: number;
  runId?: string;
  signal?: AbortSignal;
  threadId?: string;
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

type EnvelopeReadResult =
  | {
      data: z.output<typeof apiEnvelopeSchema>;
      durationMs: number;
      status: "ok";
    }
  | ApiFootballFailure;

const toApiFootballTeam = (
  team: z.output<typeof teamSchema>
): ApiFootballTeam => ({
  country: team.country ?? null,
  id: team.id,
  name: team.name,
});

const failure = (
  reason: ApiFootballFailure["reason"],
  message: string,
  details: Omit<ApiFootballFailure, "message" | "reason" | "status"> = {}
): ApiFootballFailure => ({ message, reason, status: "error", ...details });

const withDuration = (
  result: ApiFootballFailure,
  startedAt: number
): ApiFootballFailure => ({ ...result, durationMs: Date.now() - startedAt });

const apiFootballFailureCategory = (
  reason: ApiFootballFailureReason
): FaultCategory =>
  (
    {
      attempt_limit: "attempt_limit",
      configuration: "configuration",
      provider: "invalid_response",
      quota: "quota",
      rate_limit: "rate_limit",
    } as const
  )[reason];

const quotaErrorPatterns = [
  "quota",
  "rate limit",
  "ratelimit",
  "request limit",
  "requests limit",
];

const safeProviderCodeSchema = z.looseObject({
  code: z.string().optional(),
  errors: apiJsonSchema.optional(),
});

const providerCode = (value: ApiJson): string | undefined => {
  const parsed = safeProviderCodeSchema.safeParse(value);
  let code = parsed.success ? parsed.data.code : undefined;

  if (
    code === undefined &&
    parsed.success &&
    parsed.data.errors !== undefined
  ) {
    const nestedCode = z
      .looseObject({ code: z.string().optional() })
      .safeParse(parsed.data.errors);

    if (nestedCode.success) {
      const { code: nestedProviderCode } = nestedCode.data;
      code = nestedProviderCode;
    }
  }

  return code !== undefined && /^[a-z0-9_-]{1,64}$/iu.test(code)
    ? code
    : undefined;
};

const providerFailure = (errors: ApiJson): ApiFootballFailure => {
  const message = JSON.stringify(errors);
  const lowerMessage = message.toLocaleLowerCase();

  const isQuotaError = quotaErrorPatterns.some((pattern) =>
    lowerMessage.includes(pattern)
  );

  return isQuotaError
    ? failure("quota", "API-Football 请求额度已用完。", {
        providerCode: providerCode(errors),
      })
    : failure("provider", "API-Football 返回了不可用响应。", {
        providerCode: providerCode(errors),
      });
};

const isDailyQuotaError = (value: ApiJson | null): boolean => {
  const message = JSON.stringify(value).toLocaleLowerCase();

  return ["daily", "quota", "requests limit", "insufficient_quota"].some(
    (pattern) => message.includes(pattern)
  );
};

const transientTransportCode = (error: Error): string | null => {
  const parsed = z
    .looseObject({
      cause: z.looseObject({ code: z.string().optional() }).optional(),
      code: z.string().optional(),
    })
    .safeParse(error);

  if (!parsed.success) {
    return null;
  }

  const code = parsed.data.code ?? parsed.data.cause?.code ?? null;

  return isTransientNetworkCode(code) ? code : null;
};

const abortIfCancelled = (signal: AbortSignal | undefined): void => {
  if (signal !== undefined && signal.aborted) {
    throw (
      signal.reason ??
      new DOMException("The operation was aborted.", "AbortError")
    );
  }
};

const fetchApiFootballResponse = async (
  fetcher: typeof fetch,
  url: string,
  apiKey: string,
  requestOptions: ApiFootballRequestOptions,
  requestsUsed: number,
  startedAt: number
): Promise<Response> => {
  try {
    return await fetcher(url, {
      headers: { "x-apisports-key": apiKey },
      signal: requestOptions.signal,
    });
  } catch (error) {
    abortIfCancelled(requestOptions.signal);

    if (!(error instanceof Error)) {
      throw error;
    }

    const code = transientTransportCode(error);

    if (code === null) {
      throw error;
    }

    const category = code === "ETIMEDOUT" ? "timeout" : "network";

    throw createExternalFaultError({
      category,
      durationMs: Date.now() - startedAt,
      message:
        category === "timeout"
          ? "API-Football 请求超时。"
          : "无法连接 API-Football。",
      node: requestOptions.node,
      provider: "api_football",
      requestsUsed,
      retryable: true,
      runId: requestOptions.runId,
      threadId: requestOptions.threadId,
    });
  }
};

const jsonFromResponse = async (
  response: Response,
  signal: AbortSignal | undefined
): Promise<ApiJson | null> => {
  try {
    const parsed = apiJsonSchema.safeParse(await response.json());

    return parsed.success ? parsed.data : null;
  } catch (error) {
    abortIfCancelled(signal);

    return error instanceof SyntaxError
      ? null
      : (() => {
          throw error;
        })();
  }
};

const rateLimitFailure = async (
  response: Response,
  signal: AbortSignal | undefined,
  now: () => Date,
  requestsUsed: number,
  startedAt: number
): Promise<ApiFootballFailure> => {
  const payload = await jsonFromResponse(response, signal);
  abortIfCancelled(signal);

  const remaining = remainingRequests(response.headers);
  const wait = retryAfterMs(response.headers, now().getTime());

  if (remaining === 0 || isDailyQuotaError(payload)) {
    return withDuration(
      failure("quota", "API-Football 每日请求额度已用完。", {
        providerCode: payload === null ? undefined : providerCode(payload),
        remainingRequests: remaining ?? undefined,
        requestsUsed,
        statusCode: 429,
      }),
      startedAt
    );
  }

  if (remaining !== null && remaining > 0 && wait !== null) {
    return withDuration(
      failure("rate_limit", "API-Football 正在短时限流。", {
        providerCode: payload === null ? undefined : providerCode(payload),
        remainingRequests: remaining,
        requestsUsed,
        retryAfterMs: wait,
        statusCode: 429,
      }),
      startedAt
    );
  }

  return withDuration(
    failure("provider", "API-Football 返回了无法确认可重试性的 429 响应。", {
      providerCode: payload === null ? undefined : providerCode(payload),
      remainingRequests: remaining ?? undefined,
      requestsUsed,
      statusCode: 429,
    }),
    startedAt
  );
};

const envelopeFromResponse = async (
  response: Response,
  signal: AbortSignal | undefined,
  requestsUsed: number,
  startedAt: number
): Promise<EnvelopeReadResult> => {
  const payload = await jsonFromResponse(response, signal);
  abortIfCancelled(signal);

  if (payload === null) {
    return withDuration(
      failure("provider", "API-Football 返回了无法解析的数据。", {
        requestsUsed,
        statusCode: response.status,
      }),
      startedAt
    );
  }

  const parsed = apiEnvelopeSchema.safeParse(payload);

  if (!parsed.success) {
    return withDuration(
      failure("provider", "API-Football 返回的数据格式无法识别。", {
        requestsUsed,
        statusCode: response.status,
      }),
      startedAt
    );
  }

  const { errors } = parsed.data;

  if (
    errors !== undefined &&
    errors !== null &&
    JSON.stringify(errors) !== "{}" &&
    JSON.stringify(errors) !== "[]"
  ) {
    return withDuration(
      {
        ...providerFailure(errors),
        requestsUsed,
        statusCode: response.status,
      },
      startedAt
    );
  }

  return {
    data: parsed.data,
    durationMs: Date.now() - startedAt,
    status: "ok",
  };
};

const createApiFootballClient = (
  options: CreateApiFootballClientOptions = {}
): ApiFootballClient => {
  const apiKey = options.apiKey?.trim() ?? "";
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const rosterCache = new Map<number, RosterCacheEntry>();

  const getJson = async (
    path: string,
    requestOptions: ApiFootballRequestOptions = {}
  ): Promise<ApiFootballResult<z.output<typeof apiEnvelopeSchema>>> => {
    const requestsUsed =
      (requestOptions.requestsBefore ?? 0) + (requestOptions.attempt ?? 1);

    if (apiKey.length === 0) {
      return failure(
        "configuration",
        "未配置 API_FOOTBALL_KEY，无法读取球队或阵容。"
      );
    }

    abortIfCancelled(requestOptions.signal);

    if (requestsUsed > maxExternalRequests) {
      return failure("attempt_limit", "API-Football 请求次数已达到本次上限。", {
        requestsUsed: requestsUsed - 1,
      });
    }

    const startedAt = Date.now();

    const response = await fetchApiFootballResponse(
      fetcher,
      `${apiBaseUrl}${path}`,
      apiKey,
      requestOptions,
      requestsUsed,
      startedAt
    );

    abortIfCancelled(requestOptions.signal);

    if (response.status === 429) {
      return await rateLimitFailure(
        response,
        requestOptions.signal,
        now,
        requestsUsed,
        startedAt
      );
    }

    if (response.status >= 500 && response.status <= 599) {
      throw createExternalFaultError({
        category: "server",
        durationMs: Date.now() - startedAt,
        message: `API-Football 服务暂时返回 HTTP ${response.status}。`,
        node: requestOptions.node,
        provider: "api_football",
        requestsUsed,
        retryable: true,
        runId: requestOptions.runId,
        threadId: requestOptions.threadId,
      });
    }

    if (!response.ok) {
      return withDuration(
        failure(
          response.status === 401 || response.status === 403
            ? "configuration"
            : "provider",
          response.status === 401 || response.status === 403
            ? "API-Football 凭据或访问权限无效。"
            : `API-Football 请求失败（HTTP ${response.status}）。`,
          { requestsUsed, statusCode: response.status }
        ),
        startedAt
      );
    }

    return await envelopeFromResponse(
      response,
      requestOptions.signal,
      requestsUsed,
      startedAt
    );
  };

  const searchTeams = async (
    query: string,
    requestOptions?: ApiFootballRequestOptions
  ): Promise<ApiFootballResult<ApiFootballTeam[]>> => {
    const normalizedQuery = query.trim();

    if (normalizedQuery.length < 3) {
      return failure("provider", "球队名称至少需要三个字符才能查询。");
    }

    const result = await getJson(
      `/teams?search=${encodeURIComponent(normalizedQuery)}`,
      requestOptions
    );

    if (result.status === "error") {
      return result;
    }

    const parsedTeams = z
      .array(teamSearchItemSchema)
      .safeParse(result.data.response);

    if (!parsedTeams.success) {
      return failure("provider", "API-Football 返回的球队列表无法识别。", {
        durationMs: result.durationMs,
        requestsUsed:
          (requestOptions?.requestsBefore ?? 0) +
          (requestOptions?.attempt ?? 1),
      });
    }

    const teams = new Map<number, ApiFootballTeam>();

    for (const item of parsedTeams.data) {
      teams.set(item.team.id, toApiFootballTeam(item.team));
    }

    return { data: [...teams.values()], status: "ok" };
  };

  const getSquad = async (
    teamId: number,
    requestOptions?: ApiFootballRequestOptions
  ): Promise<ApiFootballResult<ApiFootballRoster>> => {
    const cacheEntry = rosterCache.get(teamId);
    const currentTime = now().getTime();

    if (cacheEntry !== undefined && cacheEntry.expiresAt > currentTime) {
      return { cached: true, data: cacheEntry.roster, status: "ok" };
    }

    const result = await getJson(
      `/players/squads?team=${teamId}`,
      requestOptions
    );

    if (result.status === "error") {
      return result;
    }

    const parsedSquads = z
      .array(squadResponseSchema)
      .safeParse(result.data.response);

    if (!parsedSquads.success || parsedSquads.data.length !== 1) {
      return failure("provider", "API-Football 返回的球队阵容无法识别。", {
        durationMs: result.durationMs,
        requestsUsed:
          (requestOptions?.requestsBefore ?? 0) +
          (requestOptions?.attempt ?? 1),
      });
    }

    const [squad] = parsedSquads.data;

    if (squad === undefined || squad.team.id !== teamId) {
      return failure("provider", "API-Football 阵容与所选球队不一致。", {
        durationMs: result.durationMs,
        requestsUsed:
          (requestOptions?.requestsBefore ?? 0) +
          (requestOptions?.attempt ?? 1),
      });
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

const searchApiFootballTeams = async (
  query: string,
  requestOptions?: ApiFootballRequestOptions
) => await getDefaultApiFootballClient().searchTeams(query, requestOptions);

const getApiFootballSquad = async (
  teamId: number,
  requestOptions?: ApiFootballRequestOptions
) => await getDefaultApiFootballClient().getSquad(teamId, requestOptions);

export {
  apiFootballFailureCategory,
  createApiFootballClient,
  getApiFootballSquad,
  searchApiFootballTeams,
};

export type {
  ApiFootballClient,
  ApiFootballFailure,
  ApiFootballResult,
  ApiFootballRequestOptions,
  ApiFootballRoster,
  ApiFootballRosterPlayer,
  ApiFootballTeam,
};
