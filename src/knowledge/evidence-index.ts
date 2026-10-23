import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { connect, Index, type Connection, type Table } from "@lancedb/lancedb";
import type { EvidenceRetrievalRequest } from "./evidence-schemas.js";
import type { StoredEvidenceDocument } from "./evidence-catalog.js";

export interface EvidenceEmbedder {
  readonly modelId: string;
  embedMany(texts: string[], kind: "query" | "passage"): Promise<number[][]>;
  countTokens(text: string, kind: "query" | "passage"): Promise<number>;
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
  embeddingText: string;
  embeddingTokens: number;
  evidenceText: string;
  vector: number[];
}

export interface EvidenceCandidate extends EvidenceIndexRow {
  fusedScore: number;
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

function safeBoundary(text: string, index: number): number {
  if (index > 0 && index < text.length) {
    const previous = text.charCodeAt(index - 1);
    const next = text.charCodeAt(index);
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) return index - 1;
  }
  return index;
}

function sentenceBoundary(text: string, start: number, end: number): number | null {
  const floor = start + Math.floor((end - start) * 0.55);
  const candidates = [
    text.lastIndexOf(". ", end), text.lastIndexOf("! ", end), text.lastIndexOf("? ", end),
    text.lastIndexOf("。", end), text.lastIndexOf("！", end), text.lastIndexOf("？", end),
    text.lastIndexOf("\n", end),
  ].filter((index) => index >= floor);
  return candidates.length ? safeBoundary(text, Math.max(...candidates) + 1) : null;
}

async function splitSection(text: string, prefix: string, embedder: EvidenceEmbedder): Promise<Array<{ startOffset: number; endOffset: number; text: string; embeddingTokens: number }>> {
  const chunks: Array<{ startOffset: number; endOffset: number; text: string; embeddingTokens: number }> = [];
  const maximumCharsPerProbe = 2_400;
  const hardTokenLimit = 512;
  const preferredTokenLimit = 448;
  let start = 0;
  while (start < text.length) {
    let low = start + 1;
    let high = Math.min(text.length, start + maximumCharsPerProbe);
    let best = start;
    while (low <= high) {
      const middle = safeBoundary(text, Math.floor((low + high) / 2));
      if (middle <= start) { low = start + 1; continue; }
      const candidate = `${prefix}\n${text.slice(start, middle)}`;
      const tokenCount = await embedder.countTokens(candidate, "passage");
      if (tokenCount <= preferredTokenLimit) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    if (best === start) {
      const next = safeBoundary(text, start + 1);
      const tokenCount = await embedder.countTokens(`${prefix}\n${text.slice(start, next)}`, "passage");
      if (tokenCount > hardTokenLimit) throw new Error("JATS/Markdown 元数据前缀或单个字符已超过 E5 的 512-token 窗口；未发布索引。");
      best = next;
    }

    const boundary = best < text.length ? sentenceBoundary(text, start, best) : null;
    let exactStart = start;
    let exactEnd = boundary ?? best;
    while (exactStart < exactEnd && /\s/u.test(text[exactStart]!)) exactStart += 1;
    while (exactEnd > exactStart && /\s/u.test(text[exactEnd - 1]!)) exactEnd -= 1;
    if (exactEnd <= exactStart) throw new Error("结构化片段无法切成非空 E5 输入；未发布索引。");
    const chunkText = text.slice(exactStart, exactEnd);
    const embeddingTokens = await embedder.countTokens(`${prefix}\n${chunkText}`, "passage");
    if (embeddingTokens > hardTokenLimit) throw new Error(`切块输入 ${embeddingTokens} tokens 超过 E5 的 ${hardTokenLimit}-token 窗口；未发布索引。`);
    chunks.push({ startOffset: exactStart, endOffset: exactEnd, text: chunkText, embeddingTokens });
    if (exactEnd >= text.length) break;

    // Overlap only when a long sentence had to be cut without a natural boundary.
    start = boundary === null ? Math.max(start + 1, exactEnd - 32) : exactEnd;
  }
  return chunks;
}

function retrievalPrefixes(document: StoredEvidenceDocument, section: StoredEvidenceDocument["sections"][number]): { lexical: string; embedding: string } {
  const coreFields = [
    document.title,
    section.heading,
    document.entityNames.join(", "),
    document.competition,
    document.season,
    document.observedFrom && document.observedTo ? `${document.observedFrom}–${document.observedTo}` : null,
  ].filter((value): value is string => Boolean(value?.trim()));
  const embedding = coreFields.join(" | ");
  const lexical = [...coreFields, document.sampleSummary].filter((value): value is string => Boolean(value?.trim())).join(" | ");
  return { lexical, embedding };
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
      const prefixes = retrievalPrefixes(document, section);
      for (const chunk of await splitSection(section.text, prefixes.embedding, input.embedder)) {
        const retrievalText = `${prefixes.lexical}\n${chunk.text}`;
        const embeddingText = `${prefixes.embedding}\n${chunk.text}`;
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
          embeddingText,
          embeddingTokens: chunk.embeddingTokens,
          evidenceText: chunk.text,
        });
        embeddedTexts.push(embeddingText);
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
    queryVector?: number[];
    mode?: "hybrid" | "full_text" | "dense_vector";
    corpus: "methodology" | "player_report";
    candidateLimit?: number;
  }): Promise<EvidenceCandidate[]> {
    if (!input.revisionIds.length) return [];
    const mode = input.mode ?? "hybrid";
    if (mode !== "full_text" && !input.queryVector) throw new Error("Dense retrieval requires a query vector.");
    const table = await this.table();
    const where = `corpus = ${quote(input.corpus)} AND revisionId IN (${input.revisionIds.map(quote).join(",")})`;
    const [vectorRows, lexicalRows] = await Promise.all([
      mode === "full_text"
        ? Promise.resolve([] as EvidenceIndexRow[])
        : table.query().nearestTo(input.queryVector!).where(where).limit(30).toArray() as Promise<EvidenceIndexRow[]>,
      mode === "dense_vector"
        ? Promise.resolve([] as EvidenceIndexRow[])
        : table.search(input.request.query, "fts", ["retrievalText"]).where(where).limit(30).toArray() as Promise<EvidenceIndexRow[]>,
    ]);
    if (mode !== "hybrid") {
      const rows = mode === "dense_vector" ? vectorRows : lexicalRows;
      return rows.slice(0, input.candidateLimit ?? 12).map((row, index) => ({ ...row, fusedScore: 1 / (61 + index) }));
    }
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
