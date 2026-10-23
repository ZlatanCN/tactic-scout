import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { EvidenceRef } from "../domain/evidence.js";
import type { EvidenceSubjectCoverage } from "./evidence-schemas.js";

export const EVIDENCE_INVESTIGATION_LIMITS = {
  durationMs: 30_000,
  gatewayAttempts: 4,
  initialQueries: 3,
  followupQueries: 2,
} as const;

export type EvidenceInvestigationOutcome = {
  status: "found" | "no_relevant_evidence" | "not_covered" | "unavailable";
  failureCode: string | null;
  generationId: string | null;
  rankingMode: "hybrid" | "full_text" | "dense_vector" | "gateway_reranked" | "local_cross_encoder" | "hybrid_degraded" | null;
  candidateCount: number;
  evidenceRefs: EvidenceRef[];
  subjectCoverage: EvidenceSubjectCoverage[];
};

export type EvidenceInvestigationReservation =
  | { kind: "reserved"; investigationId: string; requestHash: string; round: 1 | 2; remainingMs: number; remainingGatewayAttempts: number }
  | { kind: "cached"; investigationId: string; requestHash: string; round: 1 | 2; result: EvidenceInvestigationOutcome }
  | { kind: "unknown"; investigationId: string; requestHash: string; round: 1 | 2 }
  | { kind: "blocked"; investigationId: string; reason: "budget_exhausted" | "query_limit" };

interface InvestigationRow {
  investigation_id: string;
  started_at_ms: number;
  deadline_at_ms: number;
  followup_started: number;
  initial_query_count: number;
  followup_query_count: number;
  gateway_attempts: number;
  status: string;
}

export class EvidenceInvestigationLedger {
  private readonly database: DatabaseSync;
  private readonly now: () => number;
  private readonly durationMs: number;
  private readonly maximumGatewayAttempts: number;
  private closed = false;

  constructor(databasePath: string, options: { now?: () => number; durationMs?: number; maximumGatewayAttempts?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.durationMs = options.durationMs ?? EVIDENCE_INVESTIGATION_LIMITS.durationMs;
    this.maximumGatewayAttempts = options.maximumGatewayAttempts ?? EVIDENCE_INVESTIGATION_LIMITS.gatewayAttempts;
    if (databasePath !== ":memory:") mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS rag_investigations (investigation_id TEXT PRIMARY KEY, started_at_ms INTEGER NOT NULL, deadline_at_ms INTEGER NOT NULL, followup_started INTEGER NOT NULL DEFAULT 0, initial_query_count INTEGER NOT NULL DEFAULT 0, followup_query_count INTEGER NOT NULL DEFAULT 0, gateway_attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, updated_at_ms INTEGER NOT NULL);" +
      "CREATE TABLE IF NOT EXISTS rag_investigation_queries (investigation_id TEXT NOT NULL, request_hash TEXT NOT NULL, query_id TEXT NOT NULL, round INTEGER NOT NULL, status TEXT NOT NULL, result_json TEXT, failure_code TEXT, reserved_at_ms INTEGER NOT NULL, completed_at_ms INTEGER, PRIMARY KEY (investigation_id, request_hash));" +
      "CREATE INDEX IF NOT EXISTS rag_investigation_queries_turn_idx ON rag_investigation_queries(investigation_id, round, reserved_at_ms);" +
      "CREATE TABLE IF NOT EXISTS rag_investigation_dispatches (investigation_id TEXT NOT NULL, sequence INTEGER NOT NULL, phase TEXT NOT NULL, request_hash TEXT NOT NULL, started_at_ms INTEGER NOT NULL, PRIMARY KEY (investigation_id, sequence));",
    );
    this.database.exec("CREATE UNIQUE INDEX IF NOT EXISTS rag_investigation_dispatch_idempotency_idx ON rag_investigation_dispatches(investigation_id, phase, request_hash);");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  begin(investigationId: string): { investigationId: string; startedAtMs: number; deadlineAtMs: number; elapsedMs: number } {
    this.assertOpen();
    this.beginSync(investigationId);
    const row = this.read(investigationId);
    this.expireIfNeeded(investigationId, row);
    return {
      investigationId,
      startedAtMs: row.started_at_ms,
      deadlineAtMs: row.deadline_at_ms,
      elapsedMs: Math.max(0, this.now() - row.started_at_ms),
    };
  }

  reserveQuery(investigationId: string, requestHash: string): EvidenceInvestigationReservation {
    this.assertOpen();
    this.beginSync(investigationId);
    let result: EvidenceInvestigationReservation = { kind: "blocked", investigationId, reason: "budget_exhausted" };
    this.transaction(() => {
      const row = this.read(investigationId);
      const now = this.now();
      if (row.status !== "active" || now >= row.deadline_at_ms) {
        this.database.prepare("UPDATE rag_investigations SET status = 'budget_exhausted', updated_at_ms = ? WHERE investigation_id = ?").run(now, investigationId);
        result = { kind: "blocked", investigationId, reason: "budget_exhausted" };
        return;
      }
      const existing = this.database.prepare(
        "SELECT query_id, round, status, result_json FROM rag_investigation_queries WHERE investigation_id = ? AND request_hash = ?",
      ).get(investigationId, requestHash) as { query_id: string; round: number; status: string; result_json: string | null } | undefined;
      if (existing) {
        result = existing.status === "completed" && existing.result_json
          ? { kind: "cached", investigationId, requestHash, round: existing.round as 1 | 2, result: JSON.parse(existing.result_json) as EvidenceInvestigationOutcome }
          : { kind: "unknown", investigationId, requestHash, round: existing.round as 1 | 2 };
        return;
      }
      const round: 1 | 2 = row.followup_started ? 2 : 1;
      if ((round === 1 && row.initial_query_count >= EVIDENCE_INVESTIGATION_LIMITS.initialQueries)
        || (round === 2 && row.followup_query_count >= EVIDENCE_INVESTIGATION_LIMITS.followupQueries)) {
        this.database.prepare("UPDATE rag_investigations SET status = 'query_limit', updated_at_ms = ? WHERE investigation_id = ?").run(now, investigationId);
        result = { kind: "blocked", investigationId, reason: "query_limit" };
        return;
      }
      const queryId = createHash("sha256").update(investigationId + "\n" + requestHash + "\n" + now).digest("hex").slice(0, 32);
      this.database.prepare(
        "INSERT INTO rag_investigation_queries (investigation_id, request_hash, query_id, round, status, reserved_at_ms) VALUES (?, ?, ?, ?, 'reserved', ?)",
      ).run(investigationId, requestHash, queryId, round, now);
      const countColumn = round === 1 ? "initial_query_count" : "followup_query_count";
      this.database.prepare("UPDATE rag_investigations SET " + countColumn + " = " + countColumn + " + 1, updated_at_ms = ? WHERE investigation_id = ?")
        .run(now, investigationId);
      result = {
        kind: "reserved",
        investigationId,
        requestHash,
        round,
        remainingMs: Math.max(0, row.deadline_at_ms - now),
        remainingGatewayAttempts: Math.max(0, this.maximumGatewayAttempts - row.gateway_attempts),
      };
    });
    return result;
  }

  markFollowupStarted(investigationId: string): boolean {
    this.assertOpen();
    this.beginSync(investigationId);
    const row = this.read(investigationId);
    const now = this.now();
    if (row.status !== "active" || now >= row.deadline_at_ms || row.initial_query_count < 1 || row.followup_started) return false;
    const completedInitial = this.database.prepare(
      "SELECT COUNT(*) AS count FROM rag_investigation_queries WHERE investigation_id = ? AND round = 1 AND status IN ('completed', 'failed')",
    ).get(investigationId) as { count: number };
    if (completedInitial.count < row.initial_query_count) return false;
    this.database.prepare("UPDATE rag_investigations SET followup_started = 1, updated_at_ms = ? WHERE investigation_id = ?").run(now, investigationId);
    return true;
  }

  reserveGatewayAttempt(investigationId: string, phase: "planner" | "reranker" | "gap_check", requestHash: string): {
    kind: "not_tracking" | "reserved" | "blocked";
    attempts: number;
    remainingMs: number;
  } {
    this.assertOpen();
    let result: { kind: "not_tracking" | "reserved" | "blocked"; attempts: number; remainingMs: number } = {
      kind: "not_tracking",
      attempts: 0,
      remainingMs: this.durationMs,
    };
    this.transaction(() => {
      const row = this.database.prepare("SELECT * FROM rag_investigations WHERE investigation_id = ?").get(investigationId) as InvestigationRow | undefined;
      if (!row) return;
      const now = this.now();
      if (row.status !== "active" || now >= row.deadline_at_ms) {
        this.database.prepare("UPDATE rag_investigations SET status = 'budget_exhausted', updated_at_ms = ? WHERE investigation_id = ?").run(now, investigationId);
        result = { kind: "blocked", attempts: row.gateway_attempts, remainingMs: 0 };
        return;
      }
      const existing = this.database.prepare("SELECT sequence FROM rag_investigation_dispatches WHERE investigation_id = ? AND phase = ? AND request_hash = ?")
        .get(investigationId, phase, requestHash);
      if (existing || row.gateway_attempts >= this.maximumGatewayAttempts) {
        result = { kind: "blocked", attempts: row.gateway_attempts, remainingMs: Math.max(0, row.deadline_at_ms - now) };
        return;
      }
      const sequence = row.gateway_attempts + 1;
      this.database.prepare("INSERT INTO rag_investigation_dispatches (investigation_id, sequence, phase, request_hash, started_at_ms) VALUES (?, ?, ?, ?, ?)")
        .run(investigationId, sequence, phase, requestHash, now);
      this.database.prepare("UPDATE rag_investigations SET gateway_attempts = ?, updated_at_ms = ? WHERE investigation_id = ?")
        .run(sequence, now, investigationId);
      result = { kind: "reserved", attempts: sequence, remainingMs: Math.max(0, row.deadline_at_ms - now) };
    });
    return result;
  }

  completeQuery(investigationId: string, requestHash: string, outcome: EvidenceInvestigationOutcome): void {
    this.assertOpen();
    const now = this.now();
    this.database.prepare(
      "UPDATE rag_investigation_queries SET status = 'completed', result_json = ?, failure_code = ?, completed_at_ms = ? WHERE investigation_id = ? AND request_hash = ? AND status = 'reserved'",
    ).run(JSON.stringify(outcome), outcome.failureCode, now, investigationId, requestHash);
    this.database.prepare("UPDATE rag_investigations SET updated_at_ms = ? WHERE investigation_id = ?").run(now, investigationId);
  }

  markQueryUnknown(investigationId: string, requestHash: string, failureCode: string): void {
    this.assertOpen();
    const now = this.now();
    this.database.prepare(
      "UPDATE rag_investigation_queries SET status = 'failed', failure_code = ?, completed_at_ms = ? WHERE investigation_id = ? AND request_hash = ? AND status = 'reserved'",
    ).run(failureCode, now, investigationId, requestHash);
    this.database.prepare("UPDATE rag_investigations SET updated_at_ms = ? WHERE investigation_id = ?").run(now, investigationId);
  }

  finish(investigationId: string, status: "complete" | "failed" = "complete"): void {
    this.assertOpen();
    this.database.prepare("UPDATE rag_investigations SET status = ?, updated_at_ms = ? WHERE investigation_id = ? AND status = 'active'")
      .run(status, this.now(), investigationId);
  }

  snapshot(investigationId: string) {
    this.assertOpen();
    const row = this.database.prepare("SELECT * FROM rag_investigations WHERE investigation_id = ?").get(investigationId) as InvestigationRow | undefined;
    if (!row) return null;
    this.expireIfNeeded(investigationId, row);
    const current = this.read(investigationId);
    const now = this.now();
    return {
      investigationId,
      elapsedMs: Math.max(0, now - current.started_at_ms),
      remainingMs: Math.max(0, current.deadline_at_ms - now),
      round: current.followup_started ? 2 as const : 1 as const,
      initialQueryCount: current.initial_query_count,
      followupQueryCount: current.followup_query_count,
      gatewayAttempts: current.gateway_attempts,
      status: current.status,
    };
  }

  hasPendingQueries(investigationId: string, round: 1 | 2): boolean {
    this.assertOpen();
    const result = this.database.prepare(
      "SELECT COUNT(*) AS count FROM rag_investigation_queries WHERE investigation_id = ? AND round = ? AND status = 'reserved'",
    ).get(investigationId, round) as { count: number };
    return result.count > 0;
  }

  private beginSync(investigationId: string): void {
    const now = this.now();
    this.database.prepare(
      "INSERT OR IGNORE INTO rag_investigations (investigation_id, started_at_ms, deadline_at_ms, followup_started, initial_query_count, followup_query_count, gateway_attempts, status, updated_at_ms) VALUES (?, ?, ?, 0, 0, 0, 0, 'active', ?)",
    ).run(investigationId, now, now + this.durationMs, now);
  }

  private read(investigationId: string): InvestigationRow {
    const row = this.database.prepare("SELECT * FROM rag_investigations WHERE investigation_id = ?").get(investigationId) as InvestigationRow | undefined;
    if (!row) throw new Error("资料调查账本尚未创建。");
    return row;
  }

  private expireIfNeeded(investigationId: string, row: InvestigationRow): void {
    if (row.status === "active" && this.now() >= row.deadline_at_ms) {
      this.database.prepare("UPDATE rag_investigations SET status = 'budget_exhausted', updated_at_ms = ? WHERE investigation_id = ?").run(this.now(), investigationId);
    }
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.database.exec("COMMIT");
      return value;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Evidence investigation ledger has been closed.");
  }
}
