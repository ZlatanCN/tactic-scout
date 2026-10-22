import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvidenceRefSchema, type EvidenceRef } from "../domain/evidence.js";
import {
  EvidenceAccessContextSchema,
  EvidenceRetrievalRequestSchema,
  KnowledgeEvidenceBundleSchema,
  KnowledgeEvidenceDocumentInputSchema,
  KnowledgeEvidenceSourceSchema,
  type EvidenceAccessContext,
  type EvidenceRetrievalRequest,
  type KnowledgeEvidenceBundle,
  type KnowledgeEvidenceDocumentInput,
  type KnowledgeEvidenceItem,
  type KnowledgeEvidenceSource,
  type KnowledgeEvidenceType,
} from "./evidence-schemas.js";
import { assertCanIngestDocument, sourceAllowsUrl } from "./permissions.js";
import { EvidenceCatalog, type StoredEvidenceDocument, type StoredSection } from "./evidence-catalog.js";
import { createEvidenceGeneration, EvidenceIndexReader, type EvidenceCandidate, type EvidenceEmbedder } from "./evidence-index.js";
import { ConfiguredGatewayEvidenceReranker, LocalE5EvidenceEmbedder, type EvidenceReranker } from "./evidence-models.js";
import { throwIfAborted } from "../domain/abort.js";
import { firstPartyObservationSourceId } from "./source-ids.js";
import { isAcceptedRagAiPanelReview } from "../evaluation/rag-ai-panel-review.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultCatalogPath = path.join(projectRoot, ".data", "knowledge-evidence", "catalog.sqlite");
const defaultIndexPath = path.join(projectRoot, ".data", "knowledge-evidence", "index");
const defaultRegistryPath = path.join(projectRoot, "data", "knowledge", "sources.json");
const defaultBaselineAcceptancePath = path.join(projectRoot, "data", "knowledge", "evaluation", "hybrid-baseline-acceptance.v1.json");
const defaultAiPanelReviewPath = path.join(projectRoot, "data", "knowledge", "evaluation", "rag-ai-panel-review.v1.json");
const turnBudgetMs = 15_000;
const rerankCandidateLimit = 12;

export interface KnowledgeEvidence {
  reader: {
    retrieve(request: EvidenceRetrievalRequest, context: EvidenceAccessContext, signal?: AbortSignal): Promise<KnowledgeEvidenceBundle>;
    resolve(refs: EvidenceRef[], context: EvidenceAccessContext, signal?: AbortSignal): Promise<KnowledgeEvidenceBundle>;
  };
  admin: {
    registerSource(source: KnowledgeEvidenceSource): Promise<void>;
    registerSources(sources: KnowledgeEvidenceSource[]): Promise<void>;
    publishDocument(document: KnowledgeEvidenceDocumentInput): Promise<{ documentId: string; revisionId: string; generationId: string; indexedChunks: number }>;
    removeDocument(documentId: string): Promise<number>;
    revokeSource(sourceId: string, options?: { eraseStoredContent?: boolean }): Promise<void>;
    sourceHistory(sourceId: string): Promise<Array<{ revision: number; status: "active" | "revoked"; source: KnowledgeEvidenceSource; changedAt: string }>>;
    prepareRuntime(): Promise<{ ready: boolean; generationId: string | null; failureCode: "index_unavailable" | "model_unavailable" | null }>;
    status(): Promise<{ activeSources: number; activeDocuments: number; generationId: string | null; indexedChunks: number; runtimeReady: boolean; evidenceSnapshotHash: string }>;
  };
  close(): Promise<void>;
}

export interface KnowledgeEvidenceOptions {
  catalogPath?: string;
  indexPath?: string;
  registryPath?: string;
  baselineAcceptancePath?: string;
  embedder?: EvidenceEmbedder;
  /** Pass null only to deliberately disable gateway reranking (for example, a baseline evaluation). */
  reranker?: EvidenceReranker | null;
  /** Allows the unaccepted hybrid baseline only for requests whose purpose is evaluation. */
  allowUnacceptedHybridEvaluation?: boolean;
  budgetMs?: number;
  reviewPacketPath?: string;
  aiPanelReviewPath?: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function knowledgeEvidenceDocumentId(document: Pick<KnowledgeEvidenceDocumentInput, "sourceId" | "corpus" | "url">): string {
  return digest(`${document.sourceId}\n${document.corpus}\n${document.url}`);
}

function documentRevisionId(document: KnowledgeEvidenceDocumentInput): string {
  return digest(JSON.stringify({ parserVersion: "knowledge-evidence-v1", ...document }));
}

function sourceCanProcess(source: KnowledgeEvidenceSource, destination: EvidenceAccessContext["modelDestination"]): boolean {
  return source.rights.persistentStorage
    && source.rights.aiProcessing
    && source.allowedModelDestinations.includes(destination);
}

function sourceType(evidenceType: KnowledgeEvidenceType | undefined, sourceId: string, corpus: StoredSection["corpus"]): KnowledgeEvidenceType {
  if (evidenceType) return evidenceType;
  if (corpus === "methodology") return "methodology";
  return sourceId === firstPartyObservationSourceId ? "first_party_observation" : "external_report";
}

function failureCode(error: unknown): KnowledgeEvidenceBundle["failureCode"] {
  if (error instanceof Error && /timeout|budget|deadline/i.test(`${error.name} ${error.message}`)) return "budget_exhausted";
  if (error instanceof Error && /reference|hash|revision/i.test(error.message)) return "reference_invalid";
  return "index_unavailable";
}

function bundle(input: Partial<KnowledgeEvidenceBundle> & Pick<KnowledgeEvidenceBundle, "status">): KnowledgeEvidenceBundle {
  return KnowledgeEvidenceBundleSchema.parse({
    evidence: [],
    subjectCoverage: [],
    generationId: null,
    traceId: randomUUID(),
    failureCode: null,
    rankingMode: null,
    rankingDurationMs: null,
    rankingInputTokens: null,
    rankingOutputTokens: null,
    candidateCount: 0,
    budgetMsUsed: 0,
    budgetMsRemaining: turnBudgetMs,
    ...input,
  });
}

function overlapDateRange(document: { observedFrom: string | null; observedTo: string | null }, request: Extract<EvidenceRetrievalRequest, { kind: "player_report" }>): boolean {
  if (!request.sampleFrom && !request.sampleTo) return true;
  if (!document.observedFrom || !document.observedTo) return false;
  return !(request.sampleTo && document.observedFrom > request.sampleTo)
    && !(request.sampleFrom && document.observedTo < request.sampleFrom);
}

function makeItem(input: {
  section: StoredSection;
  source: KnowledgeEvidenceSource;
  text: string;
  ref: EvidenceRef;
  rank: number;
  rankMode: "hybrid" | "gateway_reranked" | "hybrid_degraded";
}): KnowledgeEvidenceItem {
  const { section, source } = input;
  return {
    ref: input.ref,
    text: input.text,
    rank: input.rank,
    rankMode: input.rankMode,
    source: {
      sourceId: source.id,
      sourceName: source.name,
      title: section.title,
      url: section.url,
      author: section.author,
      publisher: section.publisher,
      publishedAt: section.publishedAt,
      license: section.license,
      attribution: section.attribution,
      corpus: section.corpus,
      displayAllowed: source.rights.display,
      sourceType: sourceType(section.evidenceType, source.id, section.corpus),
      subjects: section.entityIds.map((subjectId, index) => ({
        subjectId,
        displayName: section.entityNames[index] ?? subjectId,
        aliases: [],
      })),
      competition: section.competition,
      season: section.season,
      observedFrom: section.observedFrom,
      observedTo: section.observedTo,
      sampleSummary: section.sampleSummary,
      sectionPath: [section.title, ...(section.heading ? [section.heading] : [])],
    },
  };
}

class KnowledgeEvidenceSystem implements KnowledgeEvidence {
  readonly reader: KnowledgeEvidence["reader"];
  readonly admin: KnowledgeEvidence["admin"];
  private readonly catalog: EvidenceCatalog;
  private readonly indexReaders = new Map<string, EvidenceIndexReader>();
  private readonly embedder: EvidenceEmbedder;
  private readonly reranker: EvidenceReranker | undefined;
  private readonly registryPath: string;
  private readonly indexPath: string;
  private readonly maxBudgetMs: number;
  private readonly baselineAcceptancePath: string;
  private readonly reviewPacketPath: string;
  private readonly aiPanelReviewPath: string;
  private readonly allowUnacceptedHybridEvaluation: boolean;
  private readonly initialized: Promise<void>;
  private activeReaderCount = 0;
  private indexMaintenance = false;
  private readerDrain: (() => void) | undefined;
  private readonly waitingReaders: Array<() => void> = [];
  private runtimeReady = false;
  private closed = false;

  constructor(options: KnowledgeEvidenceOptions = {}) {
    this.catalog = new EvidenceCatalog(path.resolve(options.catalogPath ?? process.env.TACTISCOUT_KNOWLEDGE_EVIDENCE_DB ?? defaultCatalogPath));
    this.indexPath = path.resolve(options.indexPath ?? process.env.TACTISCOUT_KNOWLEDGE_EVIDENCE_INDEX ?? defaultIndexPath);
    this.registryPath = path.resolve(options.registryPath ?? process.env.TACTISCOUT_KNOWLEDGE_SOURCES_FILE ?? defaultRegistryPath);
    this.embedder = options.embedder ?? new LocalE5EvidenceEmbedder();
    this.reranker = options.reranker === null ? undefined : options.reranker ?? ConfiguredGatewayEvidenceReranker.fromEnvironment();
    this.maxBudgetMs = Math.min(turnBudgetMs, Math.max(1, Math.floor(options.budgetMs ?? turnBudgetMs)));
    this.baselineAcceptancePath = path.resolve(options.baselineAcceptancePath ?? defaultBaselineAcceptancePath);
    this.reviewPacketPath = path.resolve(options.reviewPacketPath ?? path.join(projectRoot, "data", "knowledge", "evaluation", "rag-review-packet.v1.json"));
    this.aiPanelReviewPath = path.resolve(options.aiPanelReviewPath ?? defaultAiPanelReviewPath);
    this.allowUnacceptedHybridEvaluation = options.allowUnacceptedHybridEvaluation ?? false;
    this.initialized = this.importMissingRegistrySources();
    this.reader = {
      retrieve: (request, context, signal) => this.retrieve(request, context, signal),
      resolve: (refs, context, signal) => this.resolve(refs, context, signal),
    };
    this.admin = {
      registerSource: (source) => this.registerSource(source),
      registerSources: (sources) => this.registerSources(sources),
      publishDocument: (document) => this.publishDocument(document),
      removeDocument: (documentId) => this.removeDocument(documentId),
      revokeSource: (sourceId, options) => this.revokeSource(sourceId, options?.eraseStoredContent ?? false),
      sourceHistory: async (sourceId) => { await this.initialized; this.assertOpen(); return this.catalog.sourcePolicyHistory(sourceId); },
      prepareRuntime: () => this.prepareRuntime(),
      status: () => this.status(),
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.initialized.catch(() => undefined);
    await Promise.all([...this.indexReaders.values()].map((reader) => reader.close()));
    this.indexReaders.clear();
    this.catalog.close();
  }

  private async retrieve(unparsedRequest: EvidenceRetrievalRequest, unparsedContext: EvidenceAccessContext, signal?: AbortSignal): Promise<KnowledgeEvidenceBundle> {
    const request = EvidenceRetrievalRequestSchema.parse(unparsedRequest);
    const context = EvidenceAccessContextSchema.parse(unparsedContext);
    await this.initialized;
    this.assertOpen();
    return this.withReadLease(() => this.withTurnBudget(context.turnId, signal, async (workSignal, turnBudget) => {
      const turnStartedAt = performance.now();
      throwIfAborted(workSignal);
      const eligibleSources = this.catalog.sources().filter((source) => source.allowedCorpora.includes(request.kind) && sourceCanProcess(source, context.modelDestination));
      const eligibleIds = eligibleSources.map(({ id }) => id);
      const requestedEntityIds = request.kind === "player_report" ? request.subjects.map(({ subjectId }) => subjectId) : undefined;
      const rawCoverageRows = request.kind === "player_report" && eligibleIds.length
        ? this.catalog.activeRevisionRows("player_report", eligibleIds, requestedEntityIds)
        : [];
      const coverageRows = this.currentUrlPolicyRows(rawCoverageRows, eligibleSources);
      const coveredSubjectIds = new Set(coverageRows.flatMap(({ revision_id }) => this.catalog.sectionsForRevision(revision_id).flatMap((section) => section.entityIds)));
      const subjectCoverageForNoHit = request.kind === "player_report"
        ? request.subjects.map(({ subjectId }) => ({
          subjectId,
          status: coveredSubjectIds.has(subjectId)
            ? "no_relevant_evidence" as const
            : "not_covered" as const,
        }))
        : [];
      const rawRevisionRows = this.catalog.activeRevisionRows(
        request.kind,
        eligibleIds,
        requestedEntityIds,
        request.kind === "player_report" ? { from: request.sampleFrom, to: request.sampleTo, seasons: request.sampleSeasons } : undefined,
      );
      const revisionRows = this.currentUrlPolicyRows(rawRevisionRows, eligibleSources);
      const revisionIds = revisionRows.map(({ revision_id }) => revision_id);
      const generation = this.catalog.currentGeneration();
      if (!revisionIds.length) {
        const status = request.kind === "player_report" && subjectCoverageForNoHit.length && subjectCoverageForNoHit.every((item) => item.status === "not_covered") ? "not_covered" : "no_relevant_evidence";
        return bundle({ status, subjectCoverage: subjectCoverageForNoHit });
      }
      if (!generation) return bundle({ status: "unavailable", failureCode: "index_unavailable" });
      if (generation.embeddingModel !== this.embedder.modelId) return bundle({ status: "unavailable", failureCode: "index_unavailable", generationId: generation.generationId });
      if (!this.runtimeReady) return bundle({ status: "unavailable", failureCode: "model_unavailable", generationId: generation.generationId });

      const queryTexts = [request.query];
      const [queryVector] = await this.embedder.embedMany(queryTexts, "query");
      throwIfAborted(workSignal);
      if (!queryVector) throw new Error("Embedding provider returned no query vector.");
      const index = this.indexReader(generation.generationId, generation.indexPath);
      let candidates = await index.search({ request, revisionIds, queryVector, corpus: request.kind, candidateLimit: rerankCandidateLimit });
      throwIfAborted(workSignal);
      candidates = candidates.filter((candidate) => this.verifyCandidate(candidate, eligibleSources));
      if (!candidates.length) {
        return bundle({ status: subjectCoverageForNoHit.length && subjectCoverageForNoHit.every((item) => item.status === "not_covered") ? "not_covered" : "no_relevant_evidence", subjectCoverage: subjectCoverageForNoHit, generationId: generation.generationId });
      }

      let rankingMode: "hybrid" | "gateway_reranked" | "hybrid_degraded";
      let rankingDurationMs: number | null = null;
      let rankingInputTokens: number | null = null;
      let rankingOutputTokens: number | null = null;
      const retrievedCandidateCount = candidates.length;
      if (this.reranker) {
        const requestHash = digest(JSON.stringify({ query: request.query, candidates: candidates.map(({ id }) => id).sort() }));
        const reservation = this.catalog.reserveRerank(context.turnId, requestHash);
        if (reservation.kind === "cached") {
          try {
            candidates = validateRerankOrder(candidates, reservation.response.orderedIds, reservation.response.lowRelevanceIds);
            rankingMode = "gateway_reranked";
            rankingInputTokens = reservation.response.inputTokens;
            rankingOutputTokens = reservation.response.outputTokens;
          } catch {
            if (!this.canUseHybridBaseline()) return bundle({ status: "unavailable", failureCode: "model_unavailable", generationId: generation.generationId, candidateCount: retrievedCandidateCount });
            rankingMode = "hybrid_degraded";
          }
          if (!candidates.length) return bundle({ status: "no_relevant_evidence", subjectCoverage: subjectCoverageForNoHit, generationId: generation.generationId, rankingMode, candidateCount: retrievedCandidateCount, rankingInputTokens, rankingOutputTokens });
        } else if (reservation.kind === "reserved") {
          const remaining = Math.floor(turnBudget - (performance.now() - turnStartedAt));
          if (remaining <= 0) {
            this.catalog.finishRerank(context.turnId, { failureCode: "budget_exhausted", durationMs: 0 });
            return bundle({ status: "unavailable", failureCode: "budget_exhausted", generationId: generation.generationId, candidateCount: candidates.length });
          }
          const started = performance.now();
          try {
            const ranked = await this.reranker.rerank({ query: request.query, candidates, signal: workSignal, timeoutMs: Math.min(8_000, remaining) });
            throwIfAborted(workSignal);
            rankingInputTokens = ranked.inputTokens;
            rankingOutputTokens = ranked.outputTokens;
            const ordered = validateRerankOrder(candidates, ranked.orderedIds, ranked.lowRelevanceIds ?? []);
            rankingDurationMs = performance.now() - started;
            candidates = ordered;
            this.catalog.finishRerank(context.turnId, {
              response: {
                orderedIds: ranked.orderedIds,
                lowRelevanceIds: ranked.lowRelevanceIds ?? [],
                inputTokens: ranked.inputTokens,
                outputTokens: ranked.outputTokens,
              },
              durationMs: rankingDurationMs,
              inputTokens: ranked.inputTokens,
              outputTokens: ranked.outputTokens,
            });
            rankingMode = "gateway_reranked";
            if (!candidates.length) return bundle({ status: "no_relevant_evidence", subjectCoverage: subjectCoverageForNoHit, generationId: generation.generationId, rankingMode, rankingDurationMs, rankingInputTokens, rankingOutputTokens, candidateCount: retrievedCandidateCount });
          } catch (error) {
            rankingDurationMs = performance.now() - started;
            this.catalog.finishRerank(context.turnId, {
              failureCode: error instanceof Error && /budget|timeout|deadline/i.test(`${error.name} ${error.message}`) ? "budget_exhausted" : "model_unavailable",
              durationMs: rankingDurationMs,
              inputTokens: rankingInputTokens,
              outputTokens: rankingOutputTokens,
            });
            if (!this.canUseHybridBaseline()) {
              return bundle({ status: "unavailable", failureCode: error instanceof Error && /budget|timeout|deadline/i.test(`${error.name} ${error.message}`) ? "budget_exhausted" : "model_unavailable", generationId: generation.generationId, rankingDurationMs, rankingInputTokens, rankingOutputTokens, candidateCount: candidates.length });
            }
            rankingMode = "hybrid_degraded";
          }
        } else {
          if (!this.canUseHybridBaseline()) {
            return bundle({ status: "unavailable", failureCode: reservation.failureCode === "completion_unknown" ? "model_unavailable" : "model_unavailable", generationId: generation.generationId, candidateCount: candidates.length });
          }
          rankingMode = "hybrid_degraded";
        }
      } else if (this.canUseHybridBaseline() || context.purpose === "evaluation" && this.allowUnacceptedHybridEvaluation) {
        rankingMode = "hybrid";
      } else {
        return bundle({ status: "unavailable", failureCode: "model_unavailable", generationId: generation.generationId, candidateCount: candidates.length });
      }

      throwIfAborted(workSignal);
      const evidence = this.itemsFromCandidates(candidates, eligibleSources, rankingMode, request);
      const limited = limitEvidence(evidence, request);
      const returnedSubjectIds = new Set(limited.flatMap((item) => item.source.subjects.map(({ subjectId }) => subjectId)));
      const candidateSubjectIds = new Set(evidence.flatMap((item) => item.source.subjects.map(({ subjectId }) => subjectId)));
      const coverage = request.kind === "player_report"
        ? request.subjects.map(({ subjectId }) => ({
          subjectId,
          status: returnedSubjectIds.has(subjectId)
            ? "found" as const
            : candidateSubjectIds.has(subjectId) || retrievedCandidateCount >= rerankCandidateLimit && coveredSubjectIds.has(subjectId)
              ? "not_processed_due_to_limit" as const
              : coveredSubjectIds.has(subjectId)
                ? "no_relevant_evidence" as const
                : "not_covered" as const,
        }))
        : [];
      return bundle({
        status: limited.length ? "found" : coverage.length && coverage.every((item) => item.status === "not_covered") ? "not_covered" : "no_relevant_evidence",
        evidence: limited,
        subjectCoverage: coverage,
        generationId: generation.generationId,
        rankingMode,
        rankingDurationMs,
        rankingInputTokens,
        rankingOutputTokens,
        candidateCount: candidates.length,
      });
    }));
  }

  private async resolve(unparsedRefs: EvidenceRef[], unparsedContext: EvidenceAccessContext, signal?: AbortSignal): Promise<KnowledgeEvidenceBundle> {
    const refs = unparsedRefs.map((ref) => EvidenceRefSchema.parse(ref));
    const context = EvidenceAccessContextSchema.parse(unparsedContext);
    await this.initialized;
    this.assertOpen();
    return this.withReadLease(() => this.withTurnBudget(context.turnId, signal, async (workSignal) => {
      throwIfAborted(workSignal);
      const evidence: KnowledgeEvidenceItem[] = [];
      let invalidCode: KnowledgeEvidenceBundle["failureCode"] = null;
      for (const [index, ref] of refs.entries()) {
        throwIfAborted(workSignal);
        const section = this.catalog.resolveSection(ref.documentRevisionId, ref.sectionId);
        if (!section) { invalidCode = "reference_invalid"; continue; }
        const source = this.catalog.source(section.sourceId);
        if (!source || !source.rights.persistentStorage || !source.rights.aiProcessing) { invalidCode = "source_revoked"; continue; }
        if (!source.allowedCorpora.includes(section.corpus) || !sourceCanProcess(source, context.modelDestination) || !sourceAllowsUrl(source, section.url)) { invalidCode = "source_revoked"; continue; }
        if (ref.endOffset > section.text.length) { invalidCode = "reference_invalid"; continue; }
        const text = section.text.slice(ref.startOffset, ref.endOffset);
        if (!text || digest(text) !== ref.textHash) { invalidCode = "reference_invalid"; continue; }
        evidence.push(makeItem({ section, source, text, ref, rank: index + 1, rankMode: "hybrid" }));
      }
      if (invalidCode && evidence.length === 0) return bundle({ status: "unavailable", failureCode: invalidCode });
      return bundle({ status: evidence.length ? "found" : "no_relevant_evidence", evidence, failureCode: invalidCode, rankingMode: evidence.length ? "hybrid" : null });
    }));
  }

  private async publishDocument(unparsedDocument: KnowledgeEvidenceDocumentInput): Promise<{ documentId: string; revisionId: string; generationId: string; indexedChunks: number }> {
    const document = KnowledgeEvidenceDocumentInputSchema.parse(unparsedDocument);
    await this.initialized;
    this.assertOpen();
    const source = this.catalog.source(document.sourceId);
    if (!source) throw new Error(`来源 ${document.sourceId} 尚未在权威目录登记；已拒绝发布。`);
    if (!source.allowedModelDestinations.includes("local")) throw new Error(`来源 ${source.id} 未允许本地 embedding，已拒绝发布。`);
    assertCanIngestDocument(source, document);
    if (!sourceAllowsUrl(source, document.url)) throw new Error(`文档 URL 不在来源 ${source.id} 的登记范围内。`);
    const logicalId = knowledgeEvidenceDocumentId(document);
    const revisionId = documentRevisionId(document);
    const contentHash = digest(document.content);
    const storedDocument = this.catalog.stageDocument(document, source, logicalId, revisionId, contentHash);
    try {
      const activeDocuments = this.indexableDocuments(this.catalog.activeDocuments(storedDocument));
      const generation = await createEvidenceGeneration({ rootPath: this.indexPath, documents: activeDocuments, embedder: this.embedder });
      const currentSource = this.catalog.source(document.sourceId);
      if (!currentSource || !sourceCanProcess(currentSource, "local")) throw new Error("来源权限在索引发布前发生变化；暂存版本未激活。");
      this.catalog.publishGeneration({ generationId: generation.generationId, embeddingModel: this.embedder.modelId, indexPath: generation.path, rowCount: generation.rowCount, document: storedDocument });
      this.runtimeReady = true;
      return { documentId: logicalId, revisionId, generationId: generation.generationId, indexedChunks: generation.rowCount };
    } catch (error) {
      this.catalog.failStagedDocument(revisionId);
      throw error;
    }
  }

  private async removeDocument(logicalId: string): Promise<number> {
    await this.initialized;
    this.assertOpen();
    return this.withIndexMaintenance(async () => {
      const removed = this.catalog.removeDocument(logicalId);
      if (removed) {
        try {
          await this.rebuildActiveIndex();
        } catch (error) {
          await this.discardAllDerivedIndexes();
          throw new Error("资料已删除，但派生索引重建失败；旧索引已清除，知识查询暂时不可用。", { cause: error });
        }
      }
      return removed;
    });
  }

  private async status(): Promise<{ activeSources: number; activeDocuments: number; generationId: string | null; indexedChunks: number; runtimeReady: boolean; evidenceSnapshotHash: string }> {
    await this.initialized;
    this.assertOpen();
    const generation = this.catalog.currentGeneration();
    const documents = this.indexableDocuments(this.catalog.activeDocuments());
    return {
      activeSources: this.catalog.sources().length,
      activeDocuments: documents.length,
      generationId: generation?.generationId ?? null,
      indexedChunks: generation?.rowCount ?? 0,
      runtimeReady: this.runtimeReady,
      evidenceSnapshotHash: this.catalog.activeEvidenceSnapshotHash(),
    };
  }

  private async prepareRuntime(): Promise<{ ready: boolean; generationId: string | null; failureCode: "index_unavailable" | "model_unavailable" | null }> {
    await this.initialized;
    this.assertOpen();
    const generation = this.catalog.currentGeneration();
    if (!generation || !this.indexableDocuments(this.catalog.activeDocuments()).length) {
      this.runtimeReady = false;
      return { ready: false, generationId: null, failureCode: "index_unavailable" };
    }
    if (generation.embeddingModel !== this.embedder.modelId) {
      this.runtimeReady = false;
      return { ready: false, generationId: generation.generationId, failureCode: "index_unavailable" };
    }
    try {
      await this.embedder.embedMany(["Prepare the local evidence retriever."], "query");
      await this.indexReader(generation.generationId, generation.indexPath).prepare();
      this.runtimeReady = true;
      return { ready: true, generationId: generation.generationId, failureCode: null };
    } catch {
      this.runtimeReady = false;
      return { ready: false, generationId: generation.generationId, failureCode: "model_unavailable" };
    }
  }

  private async registerSource(unparsedSource: KnowledgeEvidenceSource): Promise<void> {
    await this.registerSources([unparsedSource]);
  }

  private async registerSources(unparsedSources: KnowledgeEvidenceSource[]): Promise<void> {
    await this.initialized;
    this.assertOpen();
    const sources = KnowledgeEvidenceSourceSchema.array().parse(unparsedSources);
    if (!sources.length) return;
    const hasStoredDocuments = sources.some((source) => this.catalog.sourceUsage(source.id).length > 0);
    if (!hasStoredDocuments) {
      this.catalog.registerSources(sources);
      return;
    }
    await this.withIndexMaintenance(async () => {
      this.catalog.registerSources(sources);
      try {
        await this.rebuildActiveIndex();
      } catch (error) {
        await this.discardAllDerivedIndexes();
        throw new Error("来源策略已更新，但派生索引重建失败；旧索引已清除，知识查询暂时不可用。", { cause: error });
      }
    });
  }

  private async revokeSource(sourceId: string, eraseStoredContent: boolean): Promise<void> {
    await this.initialized;
    this.assertOpen();
    const hasStoredDocuments = this.catalog.sourceUsage(sourceId).length > 0;
    if (!hasStoredDocuments) {
      this.catalog.revokeSource(sourceId, eraseStoredContent);
      return;
    }
    await this.withIndexMaintenance(async () => {
      this.catalog.revokeSource(sourceId, eraseStoredContent);
      try {
        await this.rebuildActiveIndex();
      } catch (error) {
        await this.discardAllDerivedIndexes();
        throw new Error("来源撤回已生效，但派生索引重建失败；旧索引已清除，知识查询暂时不可用。", { cause: error });
      }
    });
  }

  private async rebuildActiveIndex(): Promise<void> {
    const documents = this.indexableDocuments(this.catalog.activeDocuments());
    if (!documents.length) {
      this.catalog.clearActiveGeneration();
      this.runtimeReady = false;
      await this.closeIndexReaders();
      await rm(path.join(this.indexPath, "generations"), { recursive: true, force: true });
      return;
    }
    const generation = await createEvidenceGeneration({ rootPath: this.indexPath, documents, embedder: this.embedder });
    this.catalog.activateGeneration({
      generationId: generation.generationId,
      embeddingModel: this.embedder.modelId,
      indexPath: generation.path,
      rowCount: generation.rowCount,
    });
    this.runtimeReady = true;
    await this.closeIndexReaders();
    const generationRoot = path.join(this.indexPath, "generations");
    const entries = await readdir(generationRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== generation.generationId) {
        await rm(path.join(generationRoot, entry.name), { recursive: true, force: true });
      }
    }
  }

  private async discardAllDerivedIndexes(): Promise<void> {
    this.catalog.clearActiveGeneration();
    this.runtimeReady = false;
    await this.closeIndexReaders();
    await rm(path.join(this.indexPath, "generations"), { recursive: true, force: true });
  }

  private async closeIndexReaders(): Promise<void> {
    await Promise.all([...this.indexReaders.values()].map((reader) => reader.close()));
    this.indexReaders.clear();
  }

  private async withReadLease<T>(operation: () => Promise<T>): Promise<T> {
    while (this.indexMaintenance) await new Promise<void>((resolve) => this.waitingReaders.push(resolve));
    this.activeReaderCount += 1;
    try {
      return await operation();
    } finally {
      this.activeReaderCount -= 1;
      if (this.activeReaderCount === 0) this.readerDrain?.();
    }
  }

  private async withIndexMaintenance<T>(operation: () => Promise<T>): Promise<T> {
    this.indexMaintenance = true;
    if (this.activeReaderCount) await new Promise<void>((resolve) => { this.readerDrain = resolve; });
    this.readerDrain = undefined;
    try {
      return await operation();
    } finally {
      this.indexMaintenance = false;
      for (const wake of this.waitingReaders.splice(0)) wake();
    }
  }

  private indexableDocuments(documents: StoredEvidenceDocument[]): StoredEvidenceDocument[] {
    const sources = new Map(this.catalog.sources().map((source) => [source.id, source]));
    return documents.filter((document) => {
      const source = sources.get(document.sourceId);
      return Boolean(source
        && source.allowedCorpora.includes(document.corpus)
        && source.rights.persistentStorage
        && source.rights.aiProcessing
        && source.allowedModelDestinations.includes("local")
        && sourceAllowsUrl(source, document.url));
    });
  }

  private async importMissingRegistrySources(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.registryPath, "utf8")) as unknown;
      const sources = KnowledgeEvidenceSourceSchema.array().parse(raw);
      for (const source of sources) if (!this.catalog.hasSource(source.id)) this.catalog.registerSource(source);
    } catch (error) {
      // A missing registry is valid for isolated stores; malformed content is not.
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  private verifyCandidate(candidate: EvidenceCandidate, eligibleSources: KnowledgeEvidenceSource[]): boolean {
    const source = eligibleSources.find(({ id }) => id === candidate.sourceId);
    const section = this.catalog.resolveSection(candidate.revisionId, candidate.sectionId);
    if (!source || !sourceCanProcess(source, "local") || !section || !sourceAllowsUrl(source, section.url) || candidate.endOffset > section.text.length || candidate.startOffset < 0) return false;
    const canonicalText = section.text.slice(candidate.startOffset, candidate.endOffset);
    return canonicalText === candidate.evidenceText && digest(canonicalText) === digest(candidate.evidenceText);
  }

  private itemsFromCandidates(candidates: EvidenceCandidate[], eligibleSources: KnowledgeEvidenceSource[], rankMode: KnowledgeEvidenceItem["rankMode"], request: EvidenceRetrievalRequest): KnowledgeEvidenceItem[] {
    return candidates.flatMap((candidate, rank) => {
      const section = this.catalog.resolveSection(candidate.revisionId, candidate.sectionId);
      const source = this.catalog.source(candidate.sourceId);
      if (!section || !source || !eligibleSources.some(({ id }) => id === source.id) || !sourceCanProcess(source, "local") || !sourceAllowsUrl(source, section.url) || candidate.endOffset > section.text.length) return [];
      if (request.kind === "player_report" && !overlapDateRange(section, request)) return [];
      const text = section.text.slice(candidate.startOffset, candidate.endOffset);
      const ref = EvidenceRefSchema.parse({
        documentRevisionId: candidate.revisionId,
        sectionId: candidate.sectionId,
        startOffset: candidate.startOffset,
        endOffset: candidate.endOffset,
        textHash: digest(text),
      });
      return [makeItem({ section, source, text, ref, rank: rank + 1, rankMode })];
    });
  }

  private indexReader(generationId: string, generationPath: string): EvidenceIndexReader {
    const current = this.indexReaders.get(generationId);
    if (current) return current;
    const reader = new EvidenceIndexReader(generationPath);
    this.indexReaders.set(generationId, reader);
    return reader;
  }

  private currentUrlPolicyRows<T extends { revision_id: string }>(rows: T[], sources: KnowledgeEvidenceSource[]): T[] {
    return rows.filter(({ revision_id }) => {
      const section = this.catalog.sectionsForRevision(revision_id)[0];
      const source = section ? sources.find(({ id }) => id === section.sourceId) : undefined;
      return Boolean(section && source && sourceAllowsUrl(source, section.url));
    });
  }

  private async withTurnBudget(turnId: string, externalSignal: AbortSignal | undefined, operation: (signal: AbortSignal, budgetMs: number) => Promise<KnowledgeEvidenceBundle>): Promise<KnowledgeEvidenceBundle> {
    throwIfAborted(externalSignal);
    const reservation = this.catalog.reserveTurnBudget(turnId, this.maxBudgetMs);
    if (!reservation.reservedMs) return bundle({ status: "unavailable", failureCode: "budget_exhausted", budgetMsUsed: reservation.usedBeforeMs, budgetMsRemaining: 0 });
    const controller = new AbortController();
    let rejectOnAbort: ((reason: unknown) => void) | undefined;
    const onAbort = () => {
      const reason = externalSignal?.reason ?? new DOMException("The operation was aborted", "AbortError");
      controller.abort(reason);
      rejectOnAbort?.(reason);
    };
    externalSignal?.addEventListener("abort", onAbort, { once: true });
    const started = performance.now();
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (wasTimedOut: boolean) => {
      if (settled) return this.catalog.turnBudgetUsed(turnId);
      settled = true;
      return this.catalog.settleTurnBudget(turnId, reservation.usedBeforeMs, reservation.reservedMs, performance.now() - started, wasTimedOut);
    };
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        const error = new Error("The shared retrieval budget was exhausted.");
        error.name = "EvidenceBudgetExceededError";
        controller.abort(error);
        reject(error);
      }, reservation.reservedMs);
    });
    const abortPromise = externalSignal ? new Promise<never>((_resolve, reject) => {
      rejectOnAbort = reject;
      if (externalSignal.aborted) onAbort();
    }) : new Promise<never>(() => undefined);
    try {
      const operationPromise = Promise.resolve().then(() => operation(controller.signal, reservation.reservedMs));
      operationPromise.catch(() => undefined);
      const result = await Promise.race([operationPromise, timeoutPromise, abortPromise]);
      const used = settle(false);
      return KnowledgeEvidenceBundleSchema.parse({
        ...result,
        budgetMsUsed: used,
        budgetMsRemaining: Math.max(0, this.maxBudgetMs - used),
      });
    } catch (error) {
      if (externalSignal?.aborted) throw error;
      const used = settle(timedOut);
      if (timedOut) return bundle({ status: "unavailable", failureCode: "budget_exhausted", budgetMsUsed: used, budgetMsRemaining: Math.max(0, this.maxBudgetMs - used) });
      return bundle({ status: "unavailable", failureCode: failureCode(error), budgetMsUsed: used, budgetMsRemaining: Math.max(0, this.maxBudgetMs - used) });
    } finally {
      if (timer) clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
      if (!settled) settle(timedOut);
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Knowledge evidence system has been closed.");
  }

  private canUseHybridBaseline(): boolean {
    const generationId = this.catalog.currentGeneration()?.generationId;
    return Boolean(generationId && loadHybridBaselineAcceptance({
      filePath: this.baselineAcceptancePath,
      sourceRegistryPath: this.registryPath,
      questionPacketPath: this.reviewPacketPath,
      aiPanelReviewPath: this.aiPanelReviewPath,
      embeddingModelId: this.embedder.modelId,
      generationId,
      evidenceSnapshotHash: this.catalog.activeEvidenceSnapshotHash(),
    }));
  }
}

function validateRerankOrder(candidates: EvidenceCandidate[], orderedIds: string[], lowRelevanceIds: string[] = []): EvidenceCandidate[] {
  const expected = new Set(candidates.map(({ id }) => id));
  const actual = new Set(orderedIds);
  if (orderedIds.length !== expected.size || actual.size !== orderedIds.length || [...actual].some((id) => !expected.has(id))) {
    throw new Error("Gateway rerank returned an incomplete, duplicated, or unknown evidence candidate ID.");
  }
  const low = new Set(lowRelevanceIds);
  if (low.size !== lowRelevanceIds.length || [...low].some((id) => !expected.has(id))) {
    throw new Error("Gateway rerank returned an incomplete, duplicated, or unknown relevance label ID.");
  }
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return orderedIds.filter((id) => !low.has(id)).map((id) => byId.get(id)!);
}

function limitEvidence(evidence: KnowledgeEvidenceItem[], request: EvidenceRetrievalRequest): KnowledgeEvidenceItem[] {
  if (request.kind === "methodology") return evidence.slice(0, request.limit);
  const counts = new Map<string, number>();
  const result: KnowledgeEvidenceItem[] = [];
  for (const item of evidence) {
    const matchingSubjects = item.source.subjects.map(({ subjectId }) => subjectId).filter((subjectId) => request.subjects.some((subject) => subject.subjectId === subjectId));
    if (!matchingSubjects.length || matchingSubjects.every((subjectId) => (counts.get(subjectId) ?? 0) >= request.perSubjectLimit)) continue;
    for (const subjectId of matchingSubjects) counts.set(subjectId, (counts.get(subjectId) ?? 0) + 1);
    result.push(item);
    if (result.length >= request.limit) break;
  }
  return result;
}

function fileHash(filePath: string): string | null {
  try { return createHash("sha256").update(readFileSync(filePath)).digest("hex"); }
  catch { return null; }
}

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function loadHybridBaselineAcceptance(input: {
  filePath: string;
  sourceRegistryPath: string;
  questionPacketPath: string;
  aiPanelReviewPath: string;
  embeddingModelId: string;
  generationId: string;
  evidenceSnapshotHash: string;
}): boolean {
  try {
    const value = JSON.parse(readFileSync(input.filePath, "utf8")) as Record<string, unknown>;
    const packet = JSON.parse(readFileSync(input.questionPacketPath, "utf8")) as {
      packetId?: unknown;
      status?: unknown;
      questions?: unknown;
    };
    const questions = Array.isArray(packet.questions) ? packet.questions : [];
    const reviewRunIds = new Set<string>();
    const reviewRunHashes = new Set<string>();
    const completeHumanReviewPacket = packet.packetId === "dual-rag-review-v1"
      && packet.status === "review_complete"
      && questions.length === 24
      && questions.every((question) => {
        if (!question || typeof question !== "object" || !("review" in question)) return false;
        const review = (question as { review?: unknown }).review;
        if (!review || typeof review !== "object") return false;
        const evaluationRunId = (review as Record<string, unknown>).evaluationRunId;
        const evaluationRunSha256 = (review as Record<string, unknown>).evaluationRunSha256;
        const isCompleteHybridReview = typeof evaluationRunId === "string"
          && evaluationRunId.length > 0
          && typeof evaluationRunSha256 === "string"
          && /^[a-f0-9]{64}$/u.test(evaluationRunSha256)
          && (review as Record<string, unknown>).rankingMode === "hybrid"
          && typeof (review as Record<string, unknown>).answerSupported === "boolean"
          && typeof (review as Record<string, unknown>).citationAccurate === "boolean"
          && typeof (review as Record<string, unknown>).abstentionAppropriate === "boolean"
          && isIsoCalendarDate((review as Record<string, unknown>).reviewedAt);
        if (isCompleteHybridReview) {
          reviewRunIds.add(evaluationRunId);
          reviewRunHashes.add(evaluationRunSha256);
        }
        return isCompleteHybridReview;
      });
    const humanReviewQualified = value.reviewMode === "human"
      && completeHumanReviewPacket
      && reviewRunIds.size === 1
      && reviewRunHashes.size === 1
      && value.evaluationRunId === [...reviewRunIds][0]
      && value.evaluationRunSha256 === [...reviewRunHashes][0];

    let aiPanelReviewQualified = false;
    if (value.reviewMode === "ai_panel") {
      const rawPanel = JSON.parse(readFileSync(input.aiPanelReviewPath, "utf8")) as unknown;
      aiPanelReviewQualified = typeof value.aiPanelReviewSha256 === "string"
        && value.aiPanelReviewSha256 === fileHash(input.aiPanelReviewPath)
        && typeof packet.packetId === "string"
        && typeof value.evaluationRunId === "string"
        && typeof value.evaluationRunSha256 === "string"
        && isAcceptedRagAiPanelReview({
          unparsedReview: rawPanel,
          packet,
          expected: {
            packetId: packet.packetId,
            packetSha256: fileHash(input.questionPacketPath) ?? "",
            sourceRegistrySha256: fileHash(input.sourceRegistryPath) ?? "",
            runId: value.evaluationRunId,
            runSha256: value.evaluationRunSha256,
            generationId: input.generationId,
            evidenceSnapshotHash: input.evidenceSnapshotHash,
            embeddingModelId: input.embeddingModelId,
          },
        });
    }
    return value.status === "accepted"
      && value.eligibleForProductionFallback === true
      && value.corpusPolicyVersion === "dual-evidence-v1"
      && value.baselineId === "lancedb-icu-vector-rrf-v1"
      && value.fullTextTokenizer === "icu"
      && value.fusion === "reciprocal_rank_fusion_k60"
      && value.candidateLimit === rerankCandidateLimit
      && value.embeddingModelId === input.embeddingModelId
      && value.indexGenerationId === input.generationId
      && value.evidenceSnapshotHash === input.evidenceSnapshotHash
      && value.sourceRegistrySha256 === fileHash(input.sourceRegistryPath)
      && value.questionPacketSha256 === fileHash(input.questionPacketPath)
      && value.reviewedQuestions === questions.length
      && value.requiredQuestions === questions.length
      && (humanReviewQualified || aiPanelReviewQualified)
      && typeof value.questionPacketId === "string"
      && value.questionPacketId === "dual-rag-review-v1";
  } catch {
    return false;
  }
}

export function createKnowledgeEvidence(options: KnowledgeEvidenceOptions = {}): KnowledgeEvidence {
  return new KnowledgeEvidenceSystem(options);
}
