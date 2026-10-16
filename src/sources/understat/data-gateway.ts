import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { throwIfAborted, signalWithTimeout } from "../../domain/abort.js";
import { SharedCancellableLoad } from "../shared/cancellable-load.js";
import { UNDERSTAT_PARSER_VERSION } from "./parser-version.js";

const ORIGIN = "https://understat.com";
const ALLOWED_LEAGUES = new Set(["EPL", "La_liga", "Bundesliga", "Serie_A", "Ligue_1"]);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const SNAPSHOT_SCHEMA_VERSION = 1;

export type UnderstatResourceKind = "league" | "player" | "team" | "match";

export interface UnderstatSnapshotKey {
  kind: UnderstatResourceKind;
  resourceId: string;
  seasonStartYear: number | null;
}

export interface UnderstatSnapshot {
  payload: unknown;
  retrievedAt: string;
  schemaVersion: number;
  parserVersion: string;
}

export interface UnderstatSnapshotStore {
  read(key: UnderstatSnapshotKey): UnderstatSnapshot | undefined;
  write(key: UnderstatSnapshotKey, snapshot: UnderstatSnapshot): void;
  close?(): void;
}

export type UnderstatProviderErrorCode =
  | "invalid_configuration"
  | "network"
  | "timeout"
  | "blocked"
  | "rate_limit"
  | "request_failed"
  | "redirect_rejected"
  | "unsupported_scope"
  | "response_too_large"
  | "invalid_response";

export class UnderstatProviderError extends Error {
  constructor(readonly code: UnderstatProviderErrorCode, message: string) {
    super(message);
    this.name = "UnderstatProviderError";
  }
}

export class MemoryUnderstatSnapshotStore implements UnderstatSnapshotStore {
  private readonly snapshots = new Map<string, UnderstatSnapshot>();

  read(key: UnderstatSnapshotKey): UnderstatSnapshot | undefined {
    const value = this.snapshots.get(snapshotKey(key));
    return value ? structuredClone(value) : undefined;
  }

  write(key: UnderstatSnapshotKey, snapshot: UnderstatSnapshot): void {
    this.snapshots.set(snapshotKey(key), structuredClone(snapshot));
  }
}

export class SqliteUnderstatSnapshotStore implements UnderstatSnapshotStore {
  private readonly database: DatabaseSync;

  constructor(databasePath = process.env.TACTISCOUT_UNDERSTAT_DB_PATH ?? ".data/understat/understat.sqlite") {
    const absolutePath = path.resolve(databasePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    this.database = new DatabaseSync(absolutePath);
    this.database.exec(
      "PRAGMA journal_mode = WAL;" +
      "PRAGMA busy_timeout = 5000;" +
      "CREATE TABLE IF NOT EXISTS source_snapshots (" +
      "kind TEXT NOT NULL CHECK (kind IN ('league', 'player', 'team', 'match'))," +
      "resource_id TEXT NOT NULL," +
      "season_start_year INTEGER NOT NULL," +
      "payload_json TEXT NOT NULL," +
      "retrieved_at TEXT NOT NULL," +
      "schema_version INTEGER NOT NULL," +
      "parser_version TEXT NOT NULL DEFAULT 'unknown'," +
      "PRIMARY KEY (kind, resource_id, season_start_year)" +
      ");" +
      "CREATE INDEX IF NOT EXISTS source_snapshots_retrieved_at ON source_snapshots (retrieved_at);",
    );
    const columns = this.database.prepare("PRAGMA table_info(source_snapshots)").all() as Array<{ name: string }>;
    if (!columns.some(({ name }) => name === "parser_version")) {
      this.database.exec("ALTER TABLE source_snapshots ADD COLUMN parser_version TEXT NOT NULL DEFAULT 'unknown';");
    }
  }

  read(key: UnderstatSnapshotKey): UnderstatSnapshot | undefined {
    const row = this.database.prepare(
      "SELECT payload_json AS payloadJson, retrieved_at AS retrievedAt, schema_version AS schemaVersion, parser_version AS parserVersion " +
      "FROM source_snapshots WHERE kind = ? AND resource_id = ? AND season_start_year = ?",
    ).get(key.kind, key.resourceId, key.seasonStartYear ?? -1) as {
      payloadJson: string;
      retrievedAt: string;
      schemaVersion: number;
      parserVersion: string;
    } | undefined;
    if (!row) return undefined;
    try {
      return {
        payload: JSON.parse(row.payloadJson) as unknown,
        retrievedAt: row.retrievedAt,
        schemaVersion: row.schemaVersion,
        parserVersion: row.parserVersion,
      };
    } catch {
      this.database.prepare(
        "DELETE FROM source_snapshots WHERE kind = ? AND resource_id = ? AND season_start_year = ?",
      ).run(key.kind, key.resourceId, key.seasonStartYear ?? -1);
      return undefined;
    }
  }

  write(key: UnderstatSnapshotKey, snapshot: UnderstatSnapshot): void {
    const payloadJson = JSON.stringify(snapshot.payload);
    if (typeof payloadJson !== "string") {
      throw new UnderstatProviderError("invalid_response", "Understat 返回了不能保存的快照数据。");
    }
    this.database.prepare(
      "INSERT INTO source_snapshots (kind, resource_id, season_start_year, payload_json, retrieved_at, schema_version, parser_version) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(kind, resource_id, season_start_year) DO UPDATE SET " +
      "payload_json = excluded.payload_json, retrieved_at = excluded.retrieved_at, schema_version = excluded.schema_version, parser_version = excluded.parser_version",
    ).run(key.kind, key.resourceId, key.seasonStartYear ?? -1, payloadJson, snapshot.retrievedAt, snapshot.schemaVersion, snapshot.parserVersion);
  }

  close(): void {
    this.database.close();
  }
}

function snapshotKey(key: UnderstatSnapshotKey): string {
  return JSON.stringify([key.kind, key.resourceId, key.seasonStartYear]);
}

interface ResourceRequest {
  key: UnderstatSnapshotKey;
  endpoint: string;
  sourcePage: string;
}

function validateSeason(seasonStartYear: number): void {
  if (!Number.isSafeInteger(seasonStartYear) || seasonStartYear < 1992 || seasonStartYear > 2100) {
    throw new UnderstatProviderError("invalid_configuration", "Understat 赛季年份无效。");
  }
}

function requestFor(kind: UnderstatResourceKind, resourceId: string, seasonStartYear: number | null): ResourceRequest {
  if (kind === "league") {
    if (!ALLOWED_LEAGUES.has(resourceId) || seasonStartYear === null) {
      throw new UnderstatProviderError("unsupported_scope", "Understat 只支持配置中的五大联赛赛季目录。");
    }
    validateSeason(seasonStartYear);
    return {
      key: { kind, resourceId, seasonStartYear },
      endpoint: ORIGIN + "/getLeagueData/" + resourceId + "/" + seasonStartYear,
      sourcePage: ORIGIN + "/league/" + resourceId + "/" + seasonStartYear,
    };
  }
  if (kind === "player") {
    if (seasonStartYear !== null) throw new UnderstatProviderError("invalid_configuration", "Understat 球员快照不能附带赛季主键。");
    if (!/^[1-9]\d{0,14}$/.test(resourceId)) throw new UnderstatProviderError("unsupported_scope", "Understat 球员 ID 无效。");
    return { key: { kind, resourceId, seasonStartYear: null }, endpoint: ORIGIN + "/getPlayerData/" + resourceId, sourcePage: ORIGIN + "/player/" + resourceId };
  }
  if (kind === "match") {
    if (seasonStartYear !== null) throw new UnderstatProviderError("invalid_configuration", "Understat 比赛快照不能附带赛季主键。");
    if (!/^[1-9]\d{0,14}$/.test(resourceId)) throw new UnderstatProviderError("unsupported_scope", "Understat 比赛 ID 无效。");
    return { key: { kind, resourceId, seasonStartYear: null }, endpoint: ORIGIN + "/getMatchData/" + resourceId, sourcePage: ORIGIN + "/match/" + resourceId };
  }
  if (seasonStartYear === null) throw new UnderstatProviderError("invalid_configuration", "Understat 球队快照必须附带赛季年份。");
  validateSeason(seasonStartYear);
  if (!resourceId.trim() || resourceId.length > 120 || /[\u0000-\u001f\u007f/\\]/u.test(resourceId)) {
    throw new UnderstatProviderError("unsupported_scope", "Understat 球队标识无效。");
  }
  const teamPath = encodeURIComponent(resourceId);
  return { key: { kind, resourceId, seasonStartYear }, endpoint: ORIGIN + "/getTeamData/" + teamPath + "/" + seasonStartYear, sourcePage: ORIGIN + "/team/" + teamPath + "/" + seasonStartYear };
}

async function readBoundedBody(response: Response, signal?: AbortSignal): Promise<string> {
  if (!response.body) throw new UnderstatProviderError("invalid_response", "Understat 接口没有返回响应内容。");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const result = await reader.read();
      throwIfAborted(signal);
      if (result.done) break;
      length += result.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new UnderstatProviderError("response_too_large", "Understat 响应超过 5 MiB 上限。");
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (error instanceof UnderstatProviderError) throw error;
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new UnderstatProviderError(timeout ? "timeout" : "network", "Understat 响应读取" + (timeout ? "超时。" : "失败。"));
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export interface UnderstatDataGatewayOptions {
  fetchImpl?: typeof fetch;
  snapshotStore?: UnderstatSnapshotStore;
  cacheTtlMs?: number;
  now?: () => Date;
}

export class UnderstatDataGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly snapshotStore: UnderstatSnapshotStore;
  private readonly cacheTtlMs: number;
  private readonly now: () => Date;
  private readonly inFlight = new Map<string, SharedCancellableLoad<UnderstatSnapshot>>();

  constructor(options: UnderstatDataGatewayOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.snapshotStore = options.snapshotStore ?? new MemoryUnderstatSnapshotStore();
    this.cacheTtlMs = options.cacheTtlMs ?? 30 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 0) {
      throw new UnderstatProviderError("invalid_configuration", "Understat 缓存时间必须是非负毫秒数。");
    }
  }

  async get(kind: UnderstatResourceKind, resourceId: string, seasonStartYear: number | null, options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<UnderstatSnapshot> {
    throwIfAborted(options.signal);
    const request = requestFor(kind, resourceId, seasonStartYear);
    const persisted = this.snapshotStore.read(request.key);
    const retrievedAt = persisted ? Date.parse(persisted.retrievedAt) : Number.NaN;
    const isFresh = persisted !== undefined && Number.isFinite(retrievedAt)
      && this.now().getTime() - retrievedAt < this.cacheTtlMs;
    if (!options.refresh && isFresh && persisted.schemaVersion === SNAPSHOT_SCHEMA_VERSION) {
      // Snapshots contain raw source JSON, so a parser upgrade can replay the cached payload
      // without a network request. Persist the parser version that will interpret this payload.
      if (persisted.parserVersion !== UNDERSTAT_PARSER_VERSION) {
        const upgraded = { ...persisted, parserVersion: UNDERSTAT_PARSER_VERSION };
        this.snapshotStore.write(request.key, upgraded);
        return structuredClone(upgraded);
      }
      return structuredClone(persisted);
    }

    const key = snapshotKey(request.key);
    let load = this.inFlight.get(key);
    if (!load) {
      load = new SharedCancellableLoad(async (signal) => {
        const snapshot = await this.request(request, signal);
        this.snapshotStore.write(request.key, snapshot);
        return snapshot;
      });
      this.inFlight.set(key, load);
      void load.promise.finally(() => {
        if (this.inFlight.get(key) === load) this.inFlight.delete(key);
      }).catch(() => undefined);
    }
    return structuredClone(await load.subscribe(options.signal));
  }

  close(): void {
    this.snapshotStore.close?.();
  }

  private async request(request: ResourceRequest, signal: AbortSignal): Promise<UnderstatSnapshot> {
    let response: Response;
    try {
      response = await this.fetchImpl(request.endpoint, {
        headers: {
          accept: "application/json",
          "x-requested-with": "XMLHttpRequest",
          referer: request.sourcePage,
        },
        signal: signalWithTimeout(signal, REQUEST_TIMEOUT_MS),
        redirect: "manual",
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : error;
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new UnderstatProviderError(timeout ? "timeout" : "network", "Understat " + request.key.kind + " 请求" + (timeout ? "超时；" : "失败；") + "未尝试备用域名或代理。");
    }
    if (response.status >= 300 && response.status < 400) throw new UnderstatProviderError("redirect_rejected", "Understat " + request.key.kind + " 接口返回重定向，已停止请求。");
    if (response.status === 401 || response.status === 403) throw new UnderstatProviderError("blocked", "Understat " + request.key.kind + " 接口拒绝访问（HTTP " + response.status + "）。");
    if (response.status === 429) throw new UnderstatProviderError("rate_limit", "Understat " + request.key.kind + " 接口触发限流（HTTP 429）；本次未重试。");
    if (!response.ok) throw new UnderstatProviderError("request_failed", "Understat " + request.key.kind + " 接口返回 HTTP " + response.status + "。");
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (!new Set(["application/json", "text/javascript", "application/javascript"]).has(contentType)) {
      throw new UnderstatProviderError("invalid_response", "Understat " + request.key.kind + " 接口没有返回 JSON。");
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new UnderstatProviderError("response_too_large", "Understat 响应超过 5 MiB 上限。");
    let payload: unknown;
    try {
      payload = JSON.parse(await readBoundedBody(response, signal)) as unknown;
    } catch (error) {
      if (error instanceof UnderstatProviderError) throw error;
      throw new UnderstatProviderError("invalid_response", "Understat " + request.key.kind + " 返回了无法解析的 JSON。");
    }
    if (payload === null || typeof payload !== "object") throw new UnderstatProviderError("invalid_response", "Understat " + request.key.kind + " 返回的数据结构为空或无效。");
    return {
      payload,
      retrievedAt: this.now().toISOString(),
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      parserVersion: UNDERSTAT_PARSER_VERSION,
    };
  }
}
