import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { KnowledgeEvidenceDocumentInput, KnowledgeEvidenceSource, KnowledgeEvidenceType } from "./evidence-schemas.js";
import { firstPartyObservationSourceId } from "./source-ids.js";

export interface StoredEvidenceDocument {
  revisionId: string;
  logicalId: string;
  sourceId: string;
  corpus: "methodology" | "player_report";
  title: string;
  url: string;
  author: string;
  publisher: string;
  publishedAt: string | null;
  license: string;
  attribution: string;
  entityIds: string[];
  entityNames: string[];
  competition: string | null;
  season: string | null;
  observedFrom: string | null;
  observedTo: string | null;
  sampleSummary: string | null;
  evidenceType: KnowledgeEvidenceType | undefined;
  contentHash: string;
  content: string;
  sections: Array<{ id: string; heading: string | null; kind: "paragraph" | "list_item" | "table"; text: string; locator: string | null }>;
}

export interface StoredSection {
  revisionId: string;
  logicalId: string;
  sourceId: string;
  corpus: "methodology" | "player_report";
  title: string;
  url: string;
  author: string;
  publisher: string;
  publishedAt: string | null;
  license: string;
  attribution: string;
  entityIds: string[];
  entityNames: string[];
  competition: string | null;
  season: string | null;
  observedFrom: string | null;
  observedTo: string | null;
  sampleSummary: string | null;
  evidenceType: KnowledgeEvidenceType | undefined;
  sectionId: string;
  heading: string | null;
  kind: "paragraph" | "list_item" | "table";
  text: string;
  locator: string | null;
}

export interface StoredRerankResult {
  orderedIds: string[];
  lowRelevanceIds: string[];
  inputTokens: number | null;
  outputTokens: number | null;
}

const parseJson = <T>(value: string): T => JSON.parse(value) as T;

export class EvidenceCatalog {
  readonly database: DatabaseSync;
  private closed = false;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_sources (
        source_id TEXT PRIMARY KEY,
        source_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_source_policy_history (
        source_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        source_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
        changed_at TEXT NOT NULL,
        PRIMARY KEY (source_id, revision)
      );
      CREATE TABLE IF NOT EXISTS document_revisions (
        revision_id TEXT PRIMARY KEY,
        logical_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        corpus TEXT NOT NULL CHECK (corpus IN ('methodology', 'player_report')),
        metadata_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        content TEXT,
        status TEXT NOT NULL CHECK (status IN ('staged', 'published', 'retained', 'redacted')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES knowledge_sources(source_id)
      );
      CREATE INDEX IF NOT EXISTS document_revisions_logical_idx ON document_revisions(logical_id, created_at);
      CREATE INDEX IF NOT EXISTS document_revisions_source_idx ON document_revisions(source_id, status);
      CREATE TABLE IF NOT EXISTS evidence_sections (
        revision_id TEXT NOT NULL,
        section_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        heading TEXT,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        locator TEXT,
        PRIMARY KEY (revision_id, section_id),
        FOREIGN KEY (revision_id) REFERENCES document_revisions(revision_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS active_documents (
        logical_id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL,
        FOREIGN KEY (revision_id) REFERENCES document_revisions(revision_id)
      );
      CREATE TABLE IF NOT EXISTS index_generations (
        generation_id TEXT PRIMARY KEY,
        embedding_model TEXT NOT NULL,
        index_path TEXT NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('staged', 'active', 'retained', 'failed')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS turn_budgets (
        turn_id TEXT PRIMARY KEY,
        used_ms INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rerank_calls (
        turn_id TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('reserved', 'completed', 'failed')),
        response_json TEXT,
        failure_code TEXT,
        duration_ms INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureColumn("index_generations", "row_count", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("rerank_calls", "input_tokens", "INTEGER");
    this.ensureColumn("rerank_calls", "output_tokens", "INTEGER");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  hasSource(sourceId: string): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM knowledge_sources WHERE source_id = ?").get(sourceId));
  }

  registerSource(source: KnowledgeEvidenceSource): void {
    this.registerSources([source]);
  }

  registerSources(sources: KnowledgeEvidenceSource[]): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      const register = this.database.prepare(`
        INSERT INTO knowledge_sources (source_id, source_json, status, revision, updated_at)
        VALUES (?, ?, 'active', 1, ?)
        ON CONFLICT(source_id) DO UPDATE SET source_json = excluded.source_json,
          status = 'active', revision = knowledge_sources.revision + 1, updated_at = excluded.updated_at
      `);
      for (const source of sources) {
        register.run(source.id, JSON.stringify(source), now);
        const revision = this.database.prepare("SELECT revision FROM knowledge_sources WHERE source_id = ?").get(source.id) as { revision: number };
        this.database.prepare(`INSERT INTO knowledge_source_policy_history (source_id, revision, source_json, status, changed_at) VALUES (?, ?, ?, 'active', ?)`)
          .run(source.id, revision.revision, JSON.stringify(source), now);
        if (!source.rights.persistentStorage) this.redactSource(source.id);
      }
    });
  }

  source(sourceId: string): KnowledgeEvidenceSource | null {
    const row = this.database.prepare("SELECT source_json FROM knowledge_sources WHERE source_id = ? AND status = 'active'").get(sourceId) as { source_json?: string } | undefined;
    return row?.source_json ? parseJson<KnowledgeEvidenceSource>(row.source_json) : null;
  }

  sources(): KnowledgeEvidenceSource[] {
    const rows = this.database.prepare("SELECT source_json FROM knowledge_sources WHERE status = 'active' ORDER BY source_id").all() as Array<{ source_json: string }>;
    return rows.map(({ source_json }) => parseJson<KnowledgeEvidenceSource>(source_json));
  }

  revokeSource(sourceId: string, eraseStoredContent = false): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      const result = this.database.prepare("UPDATE knowledge_sources SET status = 'revoked', revision = revision + 1, updated_at = ? WHERE source_id = ?").run(now, sourceId);
      if (Number(result.changes) === 0) throw new Error(`来源 ${sourceId} 尚未登记。`);
      const row = this.database.prepare("SELECT revision, source_json FROM knowledge_sources WHERE source_id = ?").get(sourceId) as { revision: number; source_json: string };
      this.database.prepare(`INSERT INTO knowledge_source_policy_history (source_id, revision, source_json, status, changed_at) VALUES (?, ?, ?, 'revoked', ?)`)
        .run(sourceId, row.revision, row.source_json, now);
      if (eraseStoredContent) this.redactSource(sourceId);
    });
  }

  removeDocument(logicalId: string): number {
    let revisionCount = 0;
    this.transaction(() => {
      const revisions = this.database.prepare("SELECT revision_id FROM document_revisions WHERE logical_id = ? AND status != 'redacted'").all(logicalId) as Array<{ revision_id: string }>;
      revisionCount = revisions.length;
      this.database.prepare("DELETE FROM active_documents WHERE logical_id = ?").run(logicalId);
      this.database.prepare("UPDATE document_revisions SET content = NULL, status = 'redacted' WHERE logical_id = ?").run(logicalId);
      this.database.prepare("DELETE FROM evidence_sections WHERE revision_id IN (SELECT revision_id FROM document_revisions WHERE logical_id = ?)").run(logicalId);
    });
    return revisionCount;
  }

  stageDocument(input: KnowledgeEvidenceDocumentInput, source: KnowledgeEvidenceSource, logicalId: string, revisionId: string, contentHash: string): StoredEvidenceDocument {
    const now = new Date().toISOString();
    const sections = input.sections?.map((section) => ({ id: section.id, heading: section.heading, kind: section.kind, text: section.text, locator: section.locator }))
      ?? [{ id: "body", heading: null, kind: "paragraph" as const, text: input.content, locator: null }];
    const metadata = {
      sourceName: source.name,
      title: input.title,
      url: input.url,
      author: input.author,
      publisher: input.publisher,
      publishedAt: input.publishedAt,
      license: input.license,
      attribution: input.attribution,
      entityIds: input.entityIds,
      entityNames: input.entityNames,
      competition: input.competition,
      season: input.season,
      observedFrom: input.observedFrom,
      observedTo: input.observedTo,
      sampleSummary: input.sampleSummary,
      evidenceType: input.evidenceType ?? (input.corpus === "methodology" ? "methodology" : source.id === firstPartyObservationSourceId ? "first_party_observation" : "external_report"),
    };
    this.transaction(() => {
      const existing = this.database.prepare("SELECT status FROM document_revisions WHERE revision_id = ?").get(revisionId) as { status?: string } | undefined;
      if (existing?.status === "redacted") throw new Error("相同原文版本已撤回并清除，不能通过重新发布悄悄恢复。请显式重新核验来源并生成新版本。");
      this.database.prepare(`
        INSERT OR IGNORE INTO document_revisions
          (revision_id, logical_id, source_id, corpus, metadata_json, content_hash, content, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'staged', ?)
      `).run(revisionId, logicalId, source.id, input.corpus, JSON.stringify(metadata), contentHash, input.content, now);
      const insertSection = this.database.prepare(`
        INSERT OR IGNORE INTO evidence_sections (revision_id, section_id, ordinal, heading, kind, text, locator)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      sections.forEach((section, index) => insertSection.run(revisionId, section.id, index, section.heading, section.kind, section.text, section.locator));
    });
    return {
      revisionId, logicalId, sourceId: source.id, corpus: input.corpus, title: input.title, url: input.url,
      author: input.author, publisher: input.publisher, publishedAt: input.publishedAt, license: input.license,
      attribution: input.attribution, entityIds: input.entityIds, entityNames: input.entityNames,
      competition: input.competition, season: input.season, observedFrom: input.observedFrom,
      observedTo: input.observedTo, sampleSummary: input.sampleSummary, contentHash, content: input.content, sections,
      evidenceType: metadata.evidenceType as KnowledgeEvidenceType,
    };
  }

  activeDocuments(override?: StoredEvidenceDocument): StoredEvidenceDocument[] {
    const rows = this.database.prepare(`
      SELECT d.revision_id, d.logical_id, d.source_id, d.corpus, d.metadata_json, d.content_hash, d.content
      FROM active_documents a JOIN document_revisions d ON d.revision_id = a.revision_id
      WHERE d.status IN ('published', 'retained') AND d.content IS NOT NULL
      ORDER BY d.logical_id
    `).all() as Array<Record<string, unknown>>;
    const documents = rows.flatMap((row) => {
      if (override?.logicalId === row.logical_id) return [];
      return [this.hydrateDocument(row)];
    });
    if (override) documents.push(override);
    return documents;
  }

  activeRevisionRows(
    corpus: string,
    sourceIds: readonly string[],
    entityIds?: readonly string[],
    sampleRange?: { from?: string; to?: string; seasons?: readonly string[] },
  ): Array<{ revision_id: string; logical_id: string }> {
    if (!sourceIds.length) return [];
    const placeholders = sourceIds.map(() => "?").join(",");
    const rows = this.database.prepare(`
      SELECT d.revision_id, d.logical_id, d.metadata_json
      FROM active_documents a JOIN document_revisions d ON d.revision_id = a.revision_id
      WHERE d.status IN ('published', 'retained') AND d.content IS NOT NULL AND d.corpus = ? AND d.source_id IN (${placeholders})
    `).all(corpus, ...sourceIds) as Array<{ revision_id: string; logical_id: string; metadata_json: string }>;
    return rows.filter((row) => {
      const metadata = parseJson<{ entityIds: string[]; observedFrom: string | null; observedTo: string | null; season: string | null }>(row.metadata_json);
      if (entityIds && !entityIds.some((entityId) => metadata.entityIds.includes(entityId))) return false;
      if (sampleRange?.seasons?.length && !sampleRange.seasons.includes(metadata.season ?? "")) return false;
      if ((sampleRange?.from || sampleRange?.to)
        && (!metadata.observedFrom || !metadata.observedTo
          || Boolean(sampleRange.from && metadata.observedTo < sampleRange.from)
          || Boolean(sampleRange.to && metadata.observedFrom > sampleRange.to))) return false;
      return true;
    })
      .map(({ revision_id, logical_id }) => ({ revision_id, logical_id }));
  }

  sectionsForRevision(revisionId: string): StoredSection[] {
    const rows = this.database.prepare(`
      SELECT d.revision_id, d.logical_id, d.source_id, d.corpus, d.metadata_json,
             s.section_id, s.heading, s.kind, s.text, s.locator
      FROM document_revisions d JOIN evidence_sections s ON s.revision_id = d.revision_id
      WHERE d.revision_id = ? ORDER BY s.ordinal
    `).all(revisionId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.hydrateSection(row));
  }

  resolveSection(revisionId: string, sectionId: string): StoredSection | null {
    const row = this.database.prepare(`
      SELECT d.revision_id, d.logical_id, d.source_id, d.corpus, d.metadata_json,
             s.section_id, s.heading, s.kind, s.text, s.locator
      FROM document_revisions d JOIN evidence_sections s ON s.revision_id = d.revision_id
      WHERE d.revision_id = ? AND s.section_id = ? AND d.content IS NOT NULL
    `).get(revisionId, sectionId) as Record<string, unknown> | undefined;
    return row ? this.hydrateSection(row) : null;
  }

  currentGeneration(): { generationId: string; embeddingModel: string; indexPath: string; rowCount: number } | null {
    const activeId = this.database.prepare("SELECT value FROM knowledge_metadata WHERE key = 'active_generation'").get() as { value?: string } | undefined;
    if (!activeId?.value) return null;
    const row = this.database.prepare("SELECT generation_id, embedding_model, index_path, row_count FROM index_generations WHERE generation_id = ? AND status = 'active'").get(activeId.value) as { generation_id: string; embedding_model: string; index_path: string; row_count: number } | undefined;
    return row ? { generationId: row.generation_id, embeddingModel: row.embedding_model, indexPath: row.index_path, rowCount: row.row_count } : null;
  }

  publishGeneration(input: { generationId: string; embeddingModel: string; indexPath: string; rowCount: number; document: StoredEvidenceDocument }): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.setActiveGeneration(input, now);
      this.database.prepare("UPDATE document_revisions SET status = 'retained' WHERE logical_id = ? AND status = 'published'").run(input.document.logicalId);
      this.database.prepare("UPDATE document_revisions SET status = 'published' WHERE revision_id = ?").run(input.document.revisionId);
      this.database.prepare(`INSERT INTO active_documents (logical_id, revision_id) VALUES (?, ?)
        ON CONFLICT(logical_id) DO UPDATE SET revision_id = excluded.revision_id`).run(input.document.logicalId, input.document.revisionId);
    });
  }

  activateGeneration(input: { generationId: string; embeddingModel: string; indexPath: string; rowCount: number }): void {
    this.transaction(() => this.setActiveGeneration(input, new Date().toISOString()));
  }

  clearActiveGeneration(): void {
    this.transaction(() => {
      this.database.prepare("UPDATE index_generations SET status = 'retained' WHERE status = 'active'").run();
      this.database.prepare("DELETE FROM knowledge_metadata WHERE key = 'active_generation'").run();
    });
  }

  failStagedDocument(revisionId: string): void {
    this.database.prepare("UPDATE document_revisions SET status = 'staged' WHERE revision_id = ? AND status != 'redacted'").run(revisionId);
  }

  reserveTurnBudget(turnId: string, maximumMs: number): { reservedMs: number; usedBeforeMs: number } {
    let result = { reservedMs: 0, usedBeforeMs: 0 };
    this.transaction(() => {
      const row = this.database.prepare("SELECT used_ms FROM turn_budgets WHERE turn_id = ?").get(turnId) as { used_ms?: number } | undefined;
      const usedBeforeMs = Math.min(maximumMs, Number(row?.used_ms ?? 0));
      const reservedMs = Math.max(0, maximumMs - usedBeforeMs);
      this.database.prepare(`INSERT INTO turn_budgets (turn_id, used_ms, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(turn_id) DO UPDATE SET used_ms = excluded.used_ms, updated_at = excluded.updated_at`)
        .run(turnId, usedBeforeMs + reservedMs, new Date().toISOString());
      result = { reservedMs, usedBeforeMs };
    });
    return result;
  }

  settleTurnBudget(turnId: string, usedBeforeMs: number, reservedMs: number, actualMs: number, timedOut: boolean): number {
    const used = Math.min(reservedMs, Math.max(0, timedOut ? reservedMs : Math.ceil(actualMs)));
    this.database.prepare("UPDATE turn_budgets SET used_ms = ?, updated_at = ? WHERE turn_id = ?")
      .run(Math.min(15_000, usedBeforeMs + used), new Date().toISOString(), turnId);
    return Math.min(15_000, usedBeforeMs + used);
  }

  turnBudgetUsed(turnId: string): number {
    const row = this.database.prepare("SELECT used_ms FROM turn_budgets WHERE turn_id = ?").get(turnId) as { used_ms?: number } | undefined;
    return Number(row?.used_ms ?? 0);
  }

  reserveRerank(turnId: string, requestHash: string): { kind: "reserved" } | { kind: "cached"; response: StoredRerankResult } | { kind: "spent"; failureCode: string | null } {
    let result: ReturnType<EvidenceCatalog["reserveRerank"]> = { kind: "reserved" };
    this.transaction(() => {
      const existing = this.database.prepare("SELECT request_hash, status, response_json, failure_code, input_tokens, output_tokens FROM rerank_calls WHERE turn_id = ?").get(turnId) as { request_hash: string; status: string; response_json: string | null; failure_code: string | null; input_tokens: number | null; output_tokens: number | null } | undefined;
      if (existing) {
        if (existing.request_hash === requestHash && existing.status === "completed" && existing.response_json) {
          const response = parseJson<StoredRerankResult>(existing.response_json);
          result = { kind: "cached", response: { ...response, inputTokens: existing.input_tokens, outputTokens: existing.output_tokens } };
        } else result = { kind: "spent", failureCode: existing.failure_code ?? (existing.status === "reserved" ? "completion_unknown" : "already_used") };
        return;
      }
      this.database.prepare(`INSERT INTO rerank_calls (turn_id, request_hash, status, created_at) VALUES (?, ?, 'reserved', ?)`).run(turnId, requestHash, new Date().toISOString());
    });
    return result;
  }

  finishRerank(turnId: string, input: { response?: StoredRerankResult; failureCode?: string; durationMs: number; inputTokens?: number | null; outputTokens?: number | null }): void {
    this.database.prepare(`UPDATE rerank_calls SET status = ?, response_json = ?, failure_code = ?, duration_ms = ?, input_tokens = ?, output_tokens = ? WHERE turn_id = ?`)
      .run(input.response ? "completed" : "failed", input.response ? JSON.stringify(input.response) : null, input.failureCode ?? null, Math.ceil(input.durationMs), input.inputTokens ?? null, input.outputTokens ?? null, turnId);
  }

  sourceUsage(sourceId: string): Array<{ status: string; revisionId: string }> {
    return this.database.prepare(`SELECT status, revision_id AS revisionId FROM document_revisions WHERE source_id = ? ORDER BY created_at DESC`)
      .all(sourceId) as Array<{ status: string; revisionId: string }>;
  }

  sourcePolicyHistory(sourceId: string): Array<{ revision: number; status: "active" | "revoked"; source: KnowledgeEvidenceSource; changedAt: string }> {
    const rows = this.database.prepare(`
      SELECT revision, status, source_json, changed_at AS changedAt
      FROM knowledge_source_policy_history WHERE source_id = ? ORDER BY revision
    `).all(sourceId) as Array<{ revision: number; status: "active" | "revoked"; source_json: string; changedAt: string }>;
    return rows.map((row) => ({ revision: row.revision, status: row.status, source: parseJson<KnowledgeEvidenceSource>(row.source_json), changedAt: row.changedAt }));
  }

  activeEvidenceSnapshotHash(): string {
    const documents = this.database.prepare(`
      SELECT d.revision_id AS revisionId, d.content_hash AS contentHash
      FROM active_documents a JOIN document_revisions d ON d.revision_id = a.revision_id
      WHERE d.status IN ('published', 'retained') AND d.content IS NOT NULL
      ORDER BY d.revision_id
    `).all();
    const sources = this.database.prepare("SELECT source_id AS sourceId, revision, status, source_json AS sourceJson FROM knowledge_sources ORDER BY source_id").all();
    return createHash("sha256").update(JSON.stringify({ documents, sources })).digest("hex");
  }

  private redactSource(sourceId: string): void {
    this.database.prepare("UPDATE document_revisions SET content = NULL, status = 'redacted' WHERE source_id = ?").run(sourceId);
    this.database.prepare("DELETE FROM evidence_sections WHERE revision_id IN (SELECT revision_id FROM document_revisions WHERE source_id = ?)").run(sourceId);
    this.database.prepare("DELETE FROM active_documents WHERE revision_id IN (SELECT revision_id FROM document_revisions WHERE source_id = ?)").run(sourceId);
  }

  private setActiveGeneration(input: { generationId: string; embeddingModel: string; indexPath: string; rowCount: number }, now: string): void {
    this.database.prepare("UPDATE index_generations SET status = 'retained' WHERE status = 'active'").run();
    this.database.prepare(`INSERT INTO index_generations (generation_id, embedding_model, index_path, row_count, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`)
      .run(input.generationId, input.embeddingModel, input.indexPath, input.rowCount, now);
    this.database.prepare(`INSERT INTO knowledge_metadata (key, value) VALUES ('active_generation', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(input.generationId);
  }

  private hydrateDocument(row: Record<string, unknown>): StoredEvidenceDocument {
    const metadata = parseJson<Record<string, unknown>>(String(row.metadata_json));
    const sections = this.database.prepare("SELECT section_id, heading, kind, text, locator FROM evidence_sections WHERE revision_id = ? ORDER BY ordinal")
      .all(String(row.revision_id)) as Array<Record<string, unknown>>;
    return {
      revisionId: String(row.revision_id), logicalId: String(row.logical_id), sourceId: String(row.source_id),
      corpus: String(row.corpus) as StoredEvidenceDocument["corpus"],
      title: String(metadata.title), url: String(metadata.url), author: String(metadata.author), publisher: String(metadata.publisher),
      publishedAt: metadata.publishedAt === null ? null : String(metadata.publishedAt), license: String(metadata.license),
      attribution: String(metadata.attribution), entityIds: (metadata.entityIds ?? []) as string[], entityNames: (metadata.entityNames ?? []) as string[],
      competition: metadata.competition === null ? null : String(metadata.competition), season: metadata.season === null ? null : String(metadata.season),
      observedFrom: metadata.observedFrom === null ? null : String(metadata.observedFrom), observedTo: metadata.observedTo === null ? null : String(metadata.observedTo),
      sampleSummary: metadata.sampleSummary === null ? null : String(metadata.sampleSummary),
      evidenceType: metadata.evidenceType as KnowledgeEvidenceType,
      contentHash: String(row.content_hash),
      content: String(row.content ?? ""), sections: sections.map((section) => this.sectionFields(section)),
    };
  }

  private hydrateSection(row: Record<string, unknown>): StoredSection {
    const metadata = parseJson<Record<string, unknown>>(String(row.metadata_json));
    return {
      revisionId: String(row.revision_id), logicalId: String(row.logical_id), sourceId: String(row.source_id),
      corpus: String(row.corpus) as StoredSection["corpus"], title: String(metadata.title), url: String(metadata.url),
      author: String(metadata.author), publisher: String(metadata.publisher), publishedAt: metadata.publishedAt === null ? null : String(metadata.publishedAt),
      license: String(metadata.license), attribution: String(metadata.attribution), entityIds: (metadata.entityIds ?? []) as string[],
      entityNames: (metadata.entityNames ?? []) as string[], competition: metadata.competition === null ? null : String(metadata.competition),
      season: metadata.season === null ? null : String(metadata.season), observedFrom: metadata.observedFrom === null ? null : String(metadata.observedFrom),
      observedTo: metadata.observedTo === null ? null : String(metadata.observedTo), sampleSummary: metadata.sampleSummary === null ? null : String(metadata.sampleSummary),
      evidenceType: metadata.evidenceType as KnowledgeEvidenceType,
      sectionId: String(row.section_id), heading: row.heading === null ? null : String(row.heading),
      kind: String(row.kind) as StoredSection["kind"], text: String(row.text), locator: row.locator === null ? null : String(row.locator),
    };
  }

  private sectionFields(row: Record<string, unknown>): StoredEvidenceDocument["sections"][number] {
    return {
      id: String(row.section_id), heading: row.heading === null ? null : String(row.heading),
      kind: String(row.kind) as StoredEvidenceDocument["sections"][number]["kind"], text: String(row.text),
      locator: row.locator === null ? null : String(row.locator),
    };
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private ensureColumn(table: "index_generations" | "rerank_calls", column: string, declaration: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
    if (columns.some((item) => item.name === column)) return;
    this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  }
}
