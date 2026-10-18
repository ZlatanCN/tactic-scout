import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PlayerIdentityCandidateSchema, type PlayerIdentityCandidate } from "../../domain/player-identity.js";
import { normalizeSearchText } from "../../domain/text-matching.js";

export interface NameEvidence {
  player: PlayerIdentityCandidate;
  kind: "verified" | "confirmation";
  scopeId: string;
  observedAt: number;
}

/** A small bounded evidence ledger, not a global one-name/one-person dictionary. */
export class NameEvidenceStore {
  constructor(private readonly path: string, private readonly now = Date.now) {}

  private use<T>(run: (database: DatabaseSync) => T): T {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(this.path);
    try {
      chmodSync(this.path, 0o600);
      db.exec("PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS aliases (mention TEXT NOT NULL, identity TEXT NOT NULL, scope TEXT NOT NULL, kind TEXT NOT NULL, observed INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(mention, identity, scope, kind))");
      return run(db);
    } finally { db.close(); }
  }

  lookup(mention: string): NameEvidence[] {
    return this.use(db => db.prepare("SELECT kind, scope, observed, payload FROM aliases WHERE mention=? AND observed>? ORDER BY observed DESC LIMIT 30")
      .all(normalizeSearchText(mention), this.now() - 90 * 86_400_000).flatMap(row => {
        try {
          const player = PlayerIdentityCandidateSchema.parse(JSON.parse(String(row.payload)));
          if (row.kind !== "verified" && row.kind !== "confirmation") return [];
          if (row.kind === "verified" && Number(row.observed) < this.now() - 30 * 86_400_000) return [];
          return [{ player, kind: row.kind, scopeId: String(row.scope), observedAt: Number(row.observed) }];
        } catch { return []; }
      }));
  }

  remember(mention: string, player: PlayerIdentityCandidate, kind: NameEvidence["kind"], scopeId: string): void {
    const parsed = PlayerIdentityCandidateSchema.parse(player);
    if (!normalizeSearchText(mention) || (kind === "confirmation" && !scopeId)) return;
    if (kind === "verified" && (!/^Q\d+$/.test(parsed.entityId) || !parsed.sourceUrl
      || !parsed.names.some(name => normalizeSearchText(name) === normalizeSearchText(mention)))) return;
    this.use(db => {
      db.prepare("INSERT OR REPLACE INTO aliases VALUES (?,?,?,?,?,?)").run(normalizeSearchText(mention), parsed.entityId, scopeId, kind, this.now(), JSON.stringify(parsed));
      db.exec("DELETE FROM aliases WHERE rowid IN (SELECT rowid FROM aliases ORDER BY observed DESC LIMIT -1 OFFSET 5000)");
    });
  }
}
