import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { inflateRawSync } from "node:zlib";
import { normalizeFmName, parseFmPlayer, type FmPlayerProfile, type FmPositionKey, type FmSnapshotManifest } from "./profile.js";
import { throwIfAborted } from "../../domain/abort.js";
import { FmRoleTemplates, type FmRoleId } from "./role-fit.js";

function decodeProfile(payload: unknown): FmPlayerProfile {
  if (!(payload instanceof Uint8Array)) throw new Error("Invalid FM profile payload.");
  const fields: Record<string, string | null> = JSON.parse(inflateRawSync(payload).toString("utf8"));
  return parseFmPlayer(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ?? ""])));
}

export class FmProfileRepository {
  private readonly database: DatabaseSync;
  readonly manifest: FmSnapshotManifest;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = this.database.prepare("SELECT payload FROM manifest WHERE id=1").get();
      if (!row || typeof row.payload !== "string") throw new Error("FM snapshot manifest missing.");
      this.manifest = JSON.parse(row.payload);
      if (this.manifest.schemaVersion !== 2) throw new Error("Reimport the FM CSV to build the current role-search index.");
    } catch (error) { this.database.close(); throw error; }
  }

  lookupName(name: string, signal?: AbortSignal): FmPlayerProfile[] {
    throwIfAborted(signal);
    const normalized = normalizeFmName(name);
    if (!normalized) return [];
    return this.database.prepare("SELECT p.payload FROM players p JOIN aliases a ON a.record_id=p.record_id WHERE a.name=? ORDER BY p.record_id")
      .all(normalized).map((row) => decodeProfile(row.payload));
  }

  getByRecordId(id: string, signal?: AbortSignal): FmPlayerProfile | null {
    throwIfAborted(signal);
    const row = this.database.prepare("SELECT payload FROM players WHERE record_id=?").get(id);
    return row ? decodeProfile(row.payload) : null;
  }

  getByUniqueId(id: string, signal?: AbortSignal): FmPlayerProfile[] {
    throwIfAborted(signal);
    return this.database.prepare("SELECT payload FROM players WHERE unique_id=? ORDER BY record_id").all(id).map((row) => decodeProfile(row.payload));
  }

  searchCatalog(query: {
    referenceRoles?: Record<string, number>;
    positions?: readonly FmPositionKey[]; roles?: readonly FmRoleId[]; playerName?: string | null;
    bornAfter?: string; excludeRecordIds?: readonly string[]; offset: number; limit: number;
  }, signal?: AbortSignal): { players: FmPlayerProfile[]; total: number; nextOffset: number | null } {
    throwIfAborted(signal);
    if (!Number.isInteger(query.offset) || query.offset < 0 || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200) throw new Error("Invalid FM catalog pagination.");
    if (query.roles?.some((role) => !Object.hasOwn(FmRoleTemplates, role))) throw new Error("Unknown FM role.");
    const conditions: string[] = [], values: SQLInputValue[] = [];
    const placeholders = (items: readonly unknown[]) => items.map(() => "?").join(",");
    if (query.positions?.length) {
      conditions.push(`EXISTS (SELECT 1 FROM positions x WHERE x.record_id=p.record_id AND x.rating>=15 AND x.position IN (${placeholders(query.positions)}))`);
      values.push(...query.positions);
    }
    if (query.playerName) {
      conditions.push("EXISTS (SELECT 1 FROM aliases a WHERE a.record_id=p.record_id AND instr(a.name,?)>0)");
      values.push(normalizeFmName(query.playerName));
    }
    if (query.bornAfter) { conditions.push("p.birth_date>?"); values.push(query.bornAfter); }
    if (query.excludeRecordIds?.length) {
      conditions.push(`p.record_id NOT IN (${placeholders(query.excludeRecordIds)})`); values.push(...query.excludeRecordIds);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const roles = [...new Set(query.roles ?? [])];
    const referenceRoles = Object.entries(query.referenceRoles ?? {}).filter(([role, value]) => Object.hasOwn(FmRoleTemplates, role) && Number.isFinite(value));
    const priority = referenceRoles.length
      ? `-(${referenceRoles.map(() => "COALESCE((SELECT ABS(r.priority-?) FROM role_scores r WHERE r.record_id=p.record_id AND r.role=?),100)").join("+")})/${referenceRoles.length}`
      : roles.length
      ? `(SELECT (COALESCE(SUM(r.priority),0)+50*(${roles.length}-COUNT(*)))/${roles.length} FROM role_scores r WHERE r.record_id=p.record_id AND r.role IN (${placeholders(roles)}))`
      : "(SELECT MAX(r.priority) FROM role_scores r WHERE r.record_id=p.record_id)";
    const total = Number(this.database.prepare(`SELECT COUNT(*) AS count FROM players p ${where}`).get(...values)!.count);
    const rows = this.database.prepare(`SELECT p.payload FROM players p ${where} ORDER BY ${priority} DESC, p.record_id LIMIT ? OFFSET ?`)
      .all(...values, ...(referenceRoles.length ? referenceRoles.flatMap(([role, value]) => [value, role]) : roles), query.limit, query.offset);
    const players = rows.map((row) => decodeProfile(row.payload));
    return { players, total, nextOffset: query.offset + players.length < total ? query.offset + players.length : null };
  }

  search(query: { position: FmPositionKey; minimumRating?: number; offset?: number; limit?: number }, signal?: AbortSignal): { players: FmPlayerProfile[]; total: number; nextOffset: number | null } {
    throwIfAborted(signal);
    const { position, minimumRating = 15, offset = 0, limit = 30 } = query;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100
      || !Number.isInteger(minimumRating) || minimumRating < 1 || minimumRating > 20) throw new Error("Invalid FM query pagination or position threshold.");
    const total = Number(this.database.prepare("SELECT COUNT(*) AS count FROM positions WHERE position=? AND rating>=?").get(position, minimumRating)!.count);
    const rows = this.database.prepare("SELECT p.payload FROM positions r JOIN players p ON r.record_id=p.record_id WHERE r.position=? AND r.rating>=? ORDER BY r.rating DESC, r.record_id LIMIT ? OFFSET ?")
      .all(position, minimumRating, limit, offset);
    const players = rows.map((row) => decodeProfile(row.payload));
    return { players, total, nextOffset: offset + players.length < total ? offset + players.length : null };
  }

  close(): void { this.database.close(); }
}
