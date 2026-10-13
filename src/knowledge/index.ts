import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bool, Field, FixedSizeList, Float32, List, Schema, Utf8 } from "apache-arrow";
import { connect, type Table } from "@lancedb/lancedb";
import { OpenAIEmbeddings } from "@langchain/openai";
import {
  KnowledgeDocumentInputSchema,
  KnowledgeSearchRequestSchema,
  KnowledgeSearchResultSchema,
  KnowledgeSourceSchema,
  KnowledgeStatusSchema,
  KnowledgePermissionError,
  type KnowledgeDocumentInput,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResult,
  type KnowledgeSource,
  type KnowledgeStatus,
} from "./schemas.js";
import { starterKnowledgeDocuments } from "./seed.js";
import { assertCanIngestDocument } from "./permissions.js";
import { knowledgeDocumentId } from "./document-id.js";
import { firstPartyObservationSourceId } from "./source-ids.js";
import { throwIfAborted } from "../domain/abort.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tableName = "knowledge_chunks";
const defaultModelId = "onnx-community/multilingual-e5-base-ONNX";
const localEmbeddingDtype = "q8";
const chunkSize = 900;
const chunkOverlap = 120;
const allowedChunkSearch = "permissionsVerified = true";
const chineseTokenizer = new Intl.Segmenter("zh-CN", { granularity: "word" });
const retrievalStopwords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "data", "do", "for", "football", "from", "how", "in", "is", "it", "match", "metric", "metrics", "of", "on", "or", "performance", "player", "players", "should", "soccer", "team", "the", "to", "what", "when", "where", "which", "who", "why", "with",
  "一个", "一些", "什么", "为什么", "可以", "如何", "怎么", "怎样", "是否", "哪些", "多少", "能", "会", "对", "和", "与", "的", "了", "吗", "呢", "在", "把", "被", "是", "有", "更", "最", "每", "每场", "时候", "时", "才能", "算", "说明", "告诉", "应该", "需要", "现在", "目前", "这", "这两篇", "一名", "名", "个", "数据", "球员", "球队", "俱乐部", "比赛", "足球", "职业", "表现", "指标", "运动员", "运动", "论文", "来源", "研究", "评价", "吗",
]);

interface KnowledgeRow extends Record<string, unknown> {
  id: string;
  documentId: string;
  corpus: "methodology" | "player_report";
  sourceId: string;
  sourceName: string;
  sourcePublisher: string;
  sourceRights: string;
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
  text: string;
  vector: number[];
  embeddingModel: string;
  permissionsVerified: boolean;
  displayAllowed: boolean;
}

export interface KnowledgeRepository {
  search(input: KnowledgeSearchRequest, options?: { signal?: AbortSignal }): Promise<KnowledgeSearchResult[]>;
}

export interface KnowledgeBase extends KnowledgeRepository {
  ingest(input: KnowledgeDocumentInput): Promise<{ documentId: string; chunkCount: number }>;
  removeDocument(documentId: string): Promise<number>;
  purgeSourceData(sourceId: string): Promise<number>;
  status(): Promise<KnowledgeStatus>;
}

export interface MethodologySourceRelevanceSignal {
  sourceId: string;
  maxCosineSimilarity: number;
  maxBm25Score: number;
  maxQueryTermCoverage: number;
  maxQueryTermCoverageAtAcceptedCosine: number;
}

export const methodologyRetrievalPolicy = {
  version: "methodology-rag-v2",
  embeddingModel: "transformers.js:q8:onnx-community/multilingual-e5-base-ONNX",
  minimumSourceCosineSimilarity: 0.812,
  minimumQueryTermCoverageAtAcceptedCosine: 0.5,
  rule: "accept a methodology source only when one indexed chunk meets the pinned-model cosine threshold and the same chunk covers at least the configured share of non-stopword query terms",
} as const;

export function acceptsMethodologySourceSignal(signal: MethodologySourceRelevanceSignal, embeddingModel: string): boolean {
  return embeddingModel === methodologyRetrievalPolicy.embeddingModel
    && signal.maxCosineSimilarity >= methodologyRetrievalPolicy.minimumSourceCosineSimilarity
    && signal.maxQueryTermCoverageAtAcceptedCosine >= methodologyRetrievalPolicy.minimumQueryTermCoverageAtAcceptedCosine;
}

interface TextEmbedder {
  readonly modelId: string;
  embed(text: string, kind: "query" | "passage"): Promise<number[]>;
  embedMany?(texts: string[], kind: "query" | "passage"): Promise<number[][]>;
}

class LocalE5Embedder implements TextEmbedder {
  private readonly modelName = process.env.TACTISCOUT_EMBEDDING_MODEL?.trim() || defaultModelId;
  readonly modelId = `transformers.js:${localEmbeddingDtype}:${this.modelName}`;
  private extractorPromise: ReturnType<typeof createExtractor> | undefined;

  async embed(text: string, kind: "query" | "passage"): Promise<number[]> {
    const [vector] = await this.embedMany([text], kind);
    return vector;
  }

  async embedMany(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
    this.extractorPromise ??= createExtractor(this.modelName);
    const extractor = await this.extractorPromise;
    const vectors: number[][] = [];
    const batchSize = 8;
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize).map((text) => `${kind}: ${text}`);
      const output = await extractor(batch, { pooling: "mean", normalize: true });
      const data = output.data as Float32Array;
      const width = output.dims.at(-1) ?? Math.floor(data.length / batch.length);
      for (let index = 0; index < batch.length; index += 1) {
        vectors.push(Array.from(data.slice(index * width, (index + 1) * width)));
      }
    }
    return vectors;
  }
}

class OpenAICompatibleEmbedder implements TextEmbedder {
  readonly model: string;
  readonly modelId: string;
  private client: OpenAIEmbeddings | undefined;

  constructor() {
    this.model = process.env.TACTISCOUT_REMOTE_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
    const configuredBaseUrl = process.env.TACTISCOUT_EMBEDDING_BASE_URL?.trim();
    const endpoint = configuredBaseUrl ? new URL(configuredBaseUrl) : new URL("https://api.openai.com/v1");
    this.modelId = `openai-compatible:${endpoint.origin}${endpoint.pathname.replace(/\/$/, "")}:${this.model}`;
  }

  async embed(text: string, kind: "query" | "passage"): Promise<number[]> {
    const client = this.getClient();
    return kind === "query" ? client.embedQuery(text) : (await client.embedDocuments([text]))[0];
  }

  async embedMany(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
    const client = this.getClient();
    if (kind === "query") return Promise.all(texts.map((text) => client.embedQuery(text)));
    return client.embedDocuments(texts);
  }

  private getClient(): OpenAIEmbeddings {
    if (this.client) return this.client;
    const apiKey = process.env.TACTISCOUT_EMBEDDING_API_KEY?.trim();
    if (!apiKey) throw new Error("远程 embedding 已启用，但缺少 TACTISCOUT_EMBEDDING_API_KEY。");
    const baseURL = process.env.TACTISCOUT_EMBEDDING_BASE_URL?.trim();
    this.client = new OpenAIEmbeddings({
      apiKey,
      model: this.model,
      ...(baseURL ? { configuration: { baseURL } } : {}),
    });
    return this.client;
  }
}

function createConfiguredEmbedder(): TextEmbedder {
  return process.env.TACTISCOUT_EMBEDDING_PROVIDER?.trim() === "openai_compatible"
    ? new OpenAICompatibleEmbedder()
    : new LocalE5Embedder();
}

async function embedMany(embedder: TextEmbedder, texts: string[], kind: "query" | "passage"): Promise<number[][]> {
  if (embedder.embedMany) return embedder.embedMany(texts, kind);
  return Promise.all(texts.map((text) => embedder.embed(text, kind)));
}

async function createExtractor(modelId: string) {
  const { pipeline } = await import("@huggingface/transformers");
  return pipeline("feature-extraction", modelId, { dtype: localEmbeddingDtype });
}

function splitIntoChunks(content: string): string[] {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= chunkSize) return normalized ? [normalized] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    if (end < normalized.length) {
      const sentenceEnd = normalized.lastIndexOf("。", end);
      const englishEnd = normalized.lastIndexOf(". ", end);
      const preferredEnd = Math.max(sentenceEnd, englishEnd < 0 ? -1 : englishEnd + 1);
      if (preferredEnd > start + Math.floor(chunkSize * 0.55)) end = preferredEnd + 1;
    }
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(end - chunkOverlap, start + 1);
  }
  return chunks.filter(Boolean);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function observationReferenceUrl(row: KnowledgeRow): string | undefined {
  if (row.sourceId !== firstPartyObservationSourceId) return undefined;
  const reference = row.attribution.match(/参考链接：https:\/\/[^\s；。]+/u)?.[0]?.slice("参考链接：".length);
  if (!reference) return undefined;
  try {
    return new URL(reference).protocol === "https:" ? reference : undefined;
  } catch {
    return undefined;
  }
}

function tokenize(value: string): string[] {
  return [...chineseTokenizer.segment(value.toLocaleLowerCase())]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment)
    .filter((term) => term.length > 1 && !retrievalStopwords.has(term));
}

function queryTermCoverage(row: KnowledgeRow, queryTerms: string[]): number {
  if (!queryTerms.length) return 0;
  const documentTerms = new Set(tokenize(`${row.title} ${row.text}`));
  const matchedTerms = queryTerms.filter((term) => documentTerms.has(term)).length;
  return matchedTerms / queryTerms.length;
}

function normalizeEntityName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function numberList(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number);
  if (value && typeof value === "object" && "toArray" in value && typeof value.toArray === "function") {
    return Array.from(value.toArray() as Iterable<unknown>, Number);
  }
  if (value && typeof value === "object" && Symbol.iterator in value) return Array.from(value as Iterable<unknown>, Number);
  return [];
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === "object" && "toArray" in value && typeof value.toArray === "function") {
    return Array.from(value.toArray() as Iterable<unknown>, String);
  }
  if (value && typeof value === "object" && Symbol.iterator in value) return Array.from(value as Iterable<unknown>, String);
  return [];
}

function bm25Scores(rows: KnowledgeRow[], query: string): Map<string, number> {
  const queryTerms = [...new Set(tokenize(query))];
  const documents = rows.map((row) => ({ row, terms: tokenize(`${row.title} ${stringList(row.entityNames).join(" ")} ${row.text}`) }));
  const averageLength = documents.reduce((sum, item) => sum + item.terms.length, 0) / Math.max(1, documents.length);
  const scores = new Map<string, number>();
  for (const term of queryTerms) {
    const documentFrequency = documents.filter((item) => item.terms.includes(term)).length;
    const idf = Math.log(1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
    for (const item of documents) {
      const termFrequency = item.terms.filter((word) => word === term).length;
      if (!termFrequency) continue;
      const lengthAdjustment = 1 - 0.75 + 0.75 * (item.terms.length / Math.max(1, averageLength));
      const score = idf * (termFrequency * 2.2) / (termFrequency + 1.2 * lengthAdjustment);
      scores.set(item.row.id, (scores.get(item.row.id) ?? 0) + score);
    }
  }
  return scores;
}

function rankedIds(scores: Map<string, number>): string[] {
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

function reciprocalRankFusion(rankings: string[][]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + index + 1)));
  }
  return scores;
}

function searchFilter(corpus: KnowledgeDocumentInput["corpus"], sourceIds: string[]): string {
  const sourceList = sourceIds.map(sqlString).join(", ");
  return `${allowedChunkSearch} AND corpus = ${sqlString(corpus)} AND sourceId IN (${sourceList})`;
}

function createKnowledgeSchema(vectorDimension: number): Schema {
  const item = () => new Field("item", new Utf8(), true);
  const stringField = (name: string, nullable = false) => new Field(name, new Utf8(), nullable);
  return new Schema([
    stringField("id"),
    stringField("documentId"),
    stringField("corpus"),
    stringField("sourceId"),
    stringField("sourceName"),
    stringField("sourcePublisher"),
    stringField("sourceRights"),
    stringField("title"),
    stringField("url"),
    stringField("author"),
    stringField("publisher"),
    stringField("publishedAt", true),
    stringField("license"),
    stringField("attribution"),
    new Field("entityIds", new List(item()), false),
    new Field("entityNames", new List(item()), false),
    stringField("competition", true),
    stringField("season", true),
    stringField("text"),
    new Field("vector", new FixedSizeList(vectorDimension, new Field("item", new Float32(), true)), false),
    stringField("embeddingModel"),
    new Field("permissionsVerified", new Bool(), false),
    new Field("displayAllowed", new Bool(), false),
  ]);
}

export class LocalKnowledgeBase implements KnowledgeBase {
  private readonly indexPath: string;
  private readonly registryPath: string;
  private readonly embedder: TextEmbedder;
  private readonly seedDocuments: KnowledgeDocumentInput[];
  private connectionPromise: ReturnType<typeof connect> | undefined;
  private tablePromise: Promise<Table | undefined> | undefined;
  private seedsPromise: Promise<void> | undefined;

  constructor(options: {
    indexPath?: string;
    registryPath?: string;
    embedder?: TextEmbedder;
    seedDocuments?: KnowledgeDocumentInput[];
  } = {}) {
    this.indexPath = path.resolve(options.indexPath ?? process.env.TACTISCOUT_KNOWLEDGE_DIR ?? path.join(projectRoot, ".data", "knowledge"));
    this.registryPath = path.resolve(options.registryPath ?? process.env.TACTISCOUT_KNOWLEDGE_SOURCES_FILE ?? path.join(projectRoot, "data", "knowledge", "sources.json"));
    this.embedder = options.embedder ?? createConfiguredEmbedder();
    this.seedDocuments = options.seedDocuments ?? starterKnowledgeDocuments;
  }

  async ingest(unparsedInput: KnowledgeDocumentInput): Promise<{ documentId: string; chunkCount: number }> {
    const input = KnowledgeDocumentInputSchema.parse(unparsedInput);
    const source = (await this.sources()).find((candidate) => candidate.id === input.sourceId);
    if (!source) throw new KnowledgePermissionError(`来源 ${input.sourceId} 尚未登记；已拒绝入库。`);
    assertCanIngestDocument(source, input);
    await this.assertIndexModelCompatible();

    const documentId = knowledgeDocumentId(input);
    const chunks = splitIntoChunks(input.content);
    const vectors = await embedMany(this.embedder, chunks, "passage");
    const rows: KnowledgeRow[] = [];
    for (const [index, text] of chunks.entries()) {
      const id = createHash("sha256").update(`${documentId}\n${index}\n${text}`).digest("hex");
      rows.push({
        id,
        documentId,
        corpus: input.corpus,
        sourceId: source.id,
        sourceName: source.name,
        sourcePublisher: source.publisher,
        sourceRights: JSON.stringify(source.rights),
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
        text,
        vector: vectors[index],
        embeddingModel: this.embedder.modelId,
        permissionsVerified: true,
        displayAllowed: source.rights.display,
      });
    }
    if (rows.length) await this.addMissingRows(rows);
    return { documentId, chunkCount: rows.length };
  }

  async search(unparsedRequest: KnowledgeSearchRequest, options: { signal?: AbortSignal } = {}): Promise<KnowledgeSearchResult[]> {
    const { signal } = options;
    throwIfAborted(signal);
    const request = KnowledgeSearchRequestSchema.parse(unparsedRequest);
    const { results, methodologySignals } = await this.searchWithSignals(request, signal);
    throwIfAborted(signal);
    const acceptedSourceIds = request.corpus === "methodology"
      ? new Set(methodologySignals.filter((signal) => this.acceptsMethodologySignal(signal)).map(({ sourceId }) => sourceId))
      : undefined;
    return results
      .filter((result) => !acceptedSourceIds || acceptedSourceIds.has(result.sourceId))
      .slice(0, request.limit);
  }

  async inspectMethodologySearch(unparsedRequest: KnowledgeSearchRequest): Promise<MethodologySourceRelevanceSignal[]> {
    const request = KnowledgeSearchRequestSchema.parse(unparsedRequest);
    if (request.corpus !== "methodology") throw new Error("方法 RAG 检索诊断只支持 methodology 语料。");
    const { methodologySignals } = await this.searchWithSignals(request);
    return methodologySignals;
  }

  private async searchWithSignals(request: KnowledgeSearchRequest, signal?: AbortSignal): Promise<{
    results: KnowledgeSearchResult[];
    methodologySignals: MethodologySourceRelevanceSignal[];
  }> {
    throwIfAborted(signal);
    await this.ensureSeedDocuments();
    throwIfAborted(signal);
    const table = await this.openTable();
    throwIfAborted(signal);
    if (!table) return { results: [], methodologySignals: [] };
    await this.assertIndexModelCompatible();
    throwIfAborted(signal);
    const sourcesById = new Map((await this.sources()).map((source) => [source.id, source]));
    throwIfAborted(signal);
    const eligibleSourceIds = [...sourcesById.values()]
      .filter((source) => source.allowedCorpora.includes(request.corpus)
        && source.rights.persistentStorage
        && source.rights.aiProcessing)
      .map((source) => source.id);
    if (!eligibleSourceIds.length) return { results: [], methodologySignals: [] };
    const filter = searchFilter(request.corpus, eligibleSourceIds);
    const corpusRows = await table.query().where(filter).toArray() as KnowledgeRow[];
    throwIfAborted(signal);
    if (!corpusRows.length) return { results: [], methodologySignals: [] };

    const requestedPlayerNames = request.playerNames.map(normalizeEntityName).filter(Boolean);
    const allRows = request.corpus === "player_report"
      ? corpusRows.filter((row) => {
        const indexedNames = stringList(row.entityNames).map(normalizeEntityName);
        return requestedPlayerNames.some((name) => indexedNames.includes(name));
      })
      : corpusRows;
    if (!allRows.length) return { results: [], methodologySignals: [] };

    const queryVector = await this.embedder.embed(request.query, "query");
    throwIfAborted(signal);
    const lexicalScores = bm25Scores(allRows, request.query);
    const lexicalRanks = rankedIds(lexicalScores);
    const cosineScores = new Map(allRows.map((row) => [row.id, cosineSimilarity(queryVector, numberList(row.vector))]));
    const queryTerms = [...new Set(tokenize(request.query))];
    const lexicalCoverageById = new Map(allRows.map((row) => [row.id, queryTermCoverage(row, queryTerms)]));
    const vectorRanks = request.corpus === "player_report"
      ? allRows.map((row) => ({ id: row.id, score: cosineScores.get(row.id) ?? Number.NEGATIVE_INFINITY }))
          .sort((left, right) => right.score - left.score)
          .map(({ id }) => id)
      : (await table.query().nearestTo(queryVector).where(filter).limit(Math.max(request.limit * 4, 20)).toArray() as KnowledgeRow[]).map((row) => row.id);
    throwIfAborted(signal);
    const fused = reciprocalRankFusion([lexicalRanks, vectorRanks]);
    for (const row of allRows) {
      const indexedNames = stringList(row.entityNames).map(normalizeEntityName);
      const explicitEntityMatch = requestedPlayerNames.some((name) => indexedNames.includes(name));
      if (explicitEntityMatch) fused.set(row.id, (fused.get(row.id) ?? 0) + 0.02);
    }
    const byId = new Map(allRows.map((row) => [row.id, row]));
    const methodologySignalsBySource = new Map<string, MethodologySourceRelevanceSignal>();
    if (request.corpus === "methodology") {
      for (const row of allRows) {
        const previous = methodologySignalsBySource.get(row.sourceId) ?? {
          sourceId: row.sourceId,
          maxCosineSimilarity: Number.NEGATIVE_INFINITY,
          maxBm25Score: 0,
          maxQueryTermCoverage: 0,
          maxQueryTermCoverageAtAcceptedCosine: 0,
        };
        const cosineSimilarity = cosineScores.get(row.id) ?? Number.NEGATIVE_INFINITY;
        const lexicalCoverage = lexicalCoverageById.get(row.id) ?? 0;
        previous.maxCosineSimilarity = Math.max(previous.maxCosineSimilarity, cosineSimilarity);
        previous.maxBm25Score = Math.max(previous.maxBm25Score, lexicalScores.get(row.id) ?? 0);
        previous.maxQueryTermCoverage = Math.max(previous.maxQueryTermCoverage, lexicalCoverage);
        if (cosineSimilarity >= methodologyRetrievalPolicy.minimumSourceCosineSimilarity) {
          previous.maxQueryTermCoverageAtAcceptedCosine = Math.max(previous.maxQueryTermCoverageAtAcceptedCosine, lexicalCoverage);
        }
        methodologySignalsBySource.set(row.sourceId, previous);
      }
    }
    const results = [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .flatMap(([id]) => {
        const row = byId.get(id);
        const source = row ? sourcesById.get(row.sourceId) : undefined;
        if (!row || !source || !source.allowedCorpora.includes(row.corpus) || !source.rights.aiProcessing || !source.rights.persistentStorage) return [];
        return [KnowledgeSearchResultSchema.parse({
          id: row.id,
          documentId: row.documentId,
          corpus: row.corpus,
          text: row.text,
          title: row.title,
          url: observationReferenceUrl(row) ?? row.url,
          sourceId: row.sourceId,
          sourceName: row.sourceName,
          publisher: row.publisher,
          author: row.author,
          publishedAt: row.publishedAt,
          license: row.license,
          attribution: row.attribution,
          entityIds: stringList(row.entityIds),
          entityNames: stringList(row.entityNames),
          competition: row.competition,
          season: row.season,
          displayAllowed: source.rights.display,
        })];
      });
    return {
      results,
      methodologySignals: [...methodologySignalsBySource.values()].sort((left, right) => right.maxCosineSimilarity - left.maxCosineSimilarity),
    };
  }

  private acceptsMethodologySignal(signal: MethodologySourceRelevanceSignal): boolean {
    return acceptsMethodologySourceSignal(signal, this.embedder.modelId);
  }

  async status(): Promise<KnowledgeStatus> {
    const sources = await this.sources();
    const table = await this.openTable();
    const indexedRows = table ? await table.query().where(allowedChunkSearch).toArray() as KnowledgeRow[] : [];
    const sourcesById = new Map(sources.map((source) => [source.id, source]));
    const rows = indexedRows.filter((row) => {
      const source = sourcesById.get(row.sourceId);
      return source?.allowedCorpora.includes(row.corpus)
        && source.rights.persistentStorage
        && source.rights.aiProcessing;
    });
    return KnowledgeStatusSchema.parse({
      indexedChunks: rows.length,
      methodologyChunks: rows.filter((row) => row.corpus === "methodology").length,
      playerReportChunks: rows.filter((row) => row.corpus === "player_report").length,
      registeredSources: sources.length,
      methodologySourceIds: sources
        .filter((source) => source.allowedCorpora.includes("methodology") && source.rights.persistentStorage && source.rights.aiProcessing)
        .map((source) => source.id)
        .sort(),
      ingestiblePlayerReportSources: sources.filter((source) =>
        source.allowedCorpora.includes("player_report") && source.rights.persistentStorage && source.rights.aiProcessing,
      ).length,
      embeddingModel: this.embedder.modelId,
      indexPath: this.indexPath,
    });
  }

  async purgeSourceData(sourceId: string): Promise<number> {
    const normalizedSourceId = sourceId.trim();
    if (!normalizedSourceId) throw new Error("来源 ID 不能为空。");
    const table = await this.openTable();
    if (!table) return 0;
    const result = await table.delete(`sourceId = ${sqlString(normalizedSourceId)}`);
    return result.numDeletedRows;
  }

  async removeDocument(documentId: string): Promise<number> {
    const normalizedDocumentId = documentId.trim();
    if (!normalizedDocumentId) throw new Error("文档 ID 不能为空。");
    const table = await this.openTable();
    if (!table) return 0;
    const result = await table.delete(`documentId = ${sqlString(normalizedDocumentId)}`);
    return result.numDeletedRows;
  }

  private async sources(): Promise<KnowledgeSource[]> {
    const contents = await readFile(this.registryPath, "utf8");
    return KnowledgeSourceSchema.array().parse(JSON.parse(contents) as unknown);
  }

  private async ensureSeedDocuments(): Promise<void> {
    this.seedsPromise ??= (async () => {
      const sourcesById = new Map((await this.sources()).map((source) => [source.id, source]));
      for (const document of this.seedDocuments) {
        const source = sourcesById.get(document.sourceId);
        if (!source) continue;
        try {
          assertCanIngestDocument(source, document);
        } catch (error) {
          if (error instanceof KnowledgePermissionError) continue;
          throw error;
        }
        await this.ingest(document);
      }
    })();
    await this.seedsPromise;
  }

  private async connection() {
    this.connectionPromise ??= connect(this.indexPath);
    return this.connectionPromise;
  }

  private async openTable() {
    this.tablePromise ??= (async () => {
      const connection = await this.connection();
      const names = await connection.tableNames();
      if (!names.includes(tableName)) return undefined;
      return connection.openTable(tableName);
    })();
    return this.tablePromise;
  }

  private async addMissingRows(rows: KnowledgeRow[]): Promise<void> {
    const connection = await this.connection();
    const table = await this.openTable();
    if (!table) {
      const created = await connection.createTable(tableName, rows, {
        schema: createKnowledgeSchema(rows[0].vector.length),
      });
      this.tablePromise = Promise.resolve(created);
      return;
    }
    if (!rows.length) return;
    const existingRows = await table.query().where(`documentId = ${sqlString(rows[0].documentId)}`).toArray() as KnowledgeRow[];
    const existingIds = new Set(existingRows.map((row) => row.id));
    const missingRows = rows.filter((row) => !existingIds.has(row.id));
    if (missingRows.length) await table.add(missingRows);
  }

  private async assertIndexModelCompatible(): Promise<void> {
    const table = await this.openTable();
    if (!table) return;
    try {
      const mismatchedRows = await table.query()
        .where(`${allowedChunkSearch} AND embeddingModel != ${sqlString(this.embedder.modelId)}`)
        .select(["embeddingModel"])
        .limit(1)
        .toArray() as Array<{ embeddingModel?: string }>;
      if (mismatchedRows.length) {
        throw new Error(`当前知识索引使用了其他 embedding 模型（${mismatchedRows[0]?.embeddingModel ?? "未知"}）。请清空 .data/knowledge 后重新导入资料。`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("当前知识索引使用了其他 embedding 模型")) throw error;
      throw new Error("无法确认知识索引使用的 embedding 模型；为避免混用，请清空 .data/knowledge 后重新导入资料。", { cause: error });
    }
  }
}

export function createLocalKnowledgeBase(options: ConstructorParameters<typeof LocalKnowledgeBase>[0] = {}): KnowledgeBase {
  return new LocalKnowledgeBase(options);
}

export function splitKnowledgeContent(content: string): string[] {
  return splitIntoChunks(content);
}
