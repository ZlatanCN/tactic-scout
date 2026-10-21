import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { connect, Index, type Connection, type Table } from "@lancedb/lancedb";
import type { EvidenceRetrievalRequest } from "./evidence-schemas.js";
import type { StoredEvidenceDocument } from "./evidence-catalog.js";

export interface EvidenceEmbedder {
  readonly modelId: string;
  embedMany(texts: string[], kind: "query" | "passage"): Promise<number[][]>;
}

interface EvidenceIndexRow {
  id: string;
  revisionId: string;
  sectionId: string;
  startOffset: number;
  endOffset: number;
  sourceId: string;
  corpus: string;
  retrievalText: string;
  evidenceText: string;
  vector: number[];
}

export interface EvidenceCandidate extends EvidenceIndexRow {
  fusedScore: number;
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

function splitSection(text: string): Array<{ startOffset: number; endOffset: number; text: string }> {
  const chunks: Array<{ startOffset: number; endOffset: number; text: string }> = [];
  const target = 1_050;
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + target, text.length);
    if (end < text.length) {
      const searchStart = start + Math.floor(target * 0.55);
      const candidates = [
        text.lastIndexOf(". ", end), text.lastIndexOf("! ", end), text.lastIndexOf("? ", end),
        text.lastIndexOf("。", end), text.lastIndexOf("！", end), text.lastIndexOf("？", end),
        text.lastIndexOf("\n", end),
      ].filter((index) => index >= searchStart);
      if (candidates.length) end = Math.max(...candidates) + 1;
    }
    let exactStart = start;
    let exactEnd = end;
    while (exactStart < exactEnd && /\s/u.test(text[exactStart]!)) exactStart += 1;
    while (exactEnd > exactStart && /\s/u.test(text[exactEnd - 1]!)) exactEnd -= 1;
    if (exactEnd > exactStart) chunks.push({ startOffset: exactStart, endOffset: exactEnd, text: text.slice(exactStart, exactEnd) });
    if (end >= text.length) break;
    start = end;
  }
  return chunks;
}

function retrievalPrefix(document: StoredEvidenceDocument, section: StoredEvidenceDocument["sections"][number]): string {
  const fields = [
    document.title,
    section.heading,
    document.entityNames.join(", "),
    document.competition,
    document.season,
    document.observedFrom && document.observedTo ? `${document.observedFrom}–${document.observedTo}` : null,
    document.sampleSummary,
  ].filter((value): value is string => Boolean(value?.trim()));
  return fields.join(" | ");
}

export async function createEvidenceGeneration(input: {
  rootPath: string;
  generationId?: string;
  documents: StoredEvidenceDocument[];
  embedder: EvidenceEmbedder;
}): Promise<{ generationId: string; path: string; rowCount: number }> {
  const generationId = input.generationId ?? randomUUID();
  const generationPath = path.resolve(input.rootPath, "generations", generationId);
  mkdirSync(path.dirname(generationPath), { recursive: true });
  const embeddedTexts: string[] = [];
  const pendingRows: Array<Omit<EvidenceIndexRow, "vector">> = [];
  for (const document of input.documents) {
    for (const section of document.sections) {
      const prefix = retrievalPrefix(document, section);
      for (const chunk of splitSection(section.text)) {
        const retrievalText = `${prefix}\n${chunk.text}`;
        const id = createHash("sha256")
          .update(`${document.revisionId}\n${section.id}\n${chunk.startOffset}\n${chunk.endOffset}\n${chunk.text}`)
          .digest("hex");
        pendingRows.push({
          id,
          revisionId: document.revisionId,
          sectionId: section.id,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          sourceId: document.sourceId,
          corpus: document.corpus,
          retrievalText,
          evidenceText: chunk.text,
        });
        embeddedTexts.push(retrievalText);
      }
    }
  }
  const vectors = pendingRows.length ? await input.embedder.embedMany(embeddedTexts, "passage") : [];
  if (vectors.length !== pendingRows.length) throw new Error("Embedding provider returned a different number of vectors than passages.");
  if (!pendingRows.length) throw new Error("Cannot publish an empty evidence index generation.");
  const rows: EvidenceIndexRow[] = pendingRows.map((row, index) => ({ ...row, vector: vectors[index]! }));
  const connection = await connect(generationPath);
  try {
    const table = await connection.createTable("evidence_chunks", rows as unknown as Array<Record<string, unknown>>);
    await table.createIndex("retrievalText", {
      config: Index.fts({ baseTokenizer: "icu", withPosition: true, lowercase: true }),
    });
  } finally {
    connection.close();
  }
  return { generationId, path: generationPath, rowCount: rows.length };
}

export class EvidenceIndexReader {
  private connectionPromise: Promise<Connection> | undefined;
  private tablePromise: Promise<Table> | undefined;

  constructor(readonly generationPath: string) {}

  async search(input: {
    request: EvidenceRetrievalRequest;
    revisionIds: readonly string[];
    queryVector: number[];
    corpus: "methodology" | "player_report";
    candidateLimit?: number;
  }): Promise<EvidenceCandidate[]> {
    if (!input.revisionIds.length) return [];
    const table = await this.table();
    const where = `corpus = ${quote(input.corpus)} AND revisionId IN (${input.revisionIds.map(quote).join(",")})`;
    const [vectorRows, lexicalRows] = await Promise.all([
      table.query().nearestTo(input.queryVector).where(where).limit(30).toArray() as Promise<EvidenceIndexRow[]>,
      table.search(input.request.query, "fts", ["retrievalText"]).where(where).limit(30).toArray() as Promise<EvidenceIndexRow[]>,
    ]);
    const scores = new Map<string, number>();
    for (const rows of [vectorRows, lexicalRows]) {
      const unique = new Set<string>();
      rows.forEach((row, index) => {
        if (unique.has(row.id)) return;
        unique.add(row.id);
        scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (60 + index + 1));
      });
    }
    const byId = new Map([...vectorRows, ...lexicalRows].map((row) => [row.id, row]));
    return [...scores.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, input.candidateLimit ?? 12)
      .flatMap(([id, fusedScore]) => {
        const row = byId.get(id);
        return row ? [{ ...row, fusedScore }] : [];
      });
  }

  async close(): Promise<void> {
    const connection = await this.connectionPromise?.catch(() => undefined);
    await connection?.close();
  }

  async prepare(): Promise<void> {
    const table = await this.table();
    await table.query().limit(1).toArray();
  }

  private async table(): Promise<Table> {
    this.connectionPromise ??= connect(this.generationPath);
    this.tablePromise ??= this.connectionPromise.then((connection) => connection.openTable("evidence_chunks"));
    return this.tablePromise;
  }
}
