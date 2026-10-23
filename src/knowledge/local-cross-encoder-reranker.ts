import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvidenceCandidate } from "./evidence-index.js";
import type { EvidenceReranker, EvidenceRerankerResult } from "./evidence-models.js";

const defaultModelId = "onnx-community/bge-reranker-v2-m3-ONNX";
const defaultRevision = "6f5ff65298512715a1e669753bc754d2bc8f367b";
const defaultDtype = "q8";
const defaultPairTokenLimit = 512;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bundledLocalModelPath = path.join(projectRoot, ".data", "models", "bge-reranker-v2-m3-onnx");

export interface LocalCrossEncoderPairTokenizer {
  (queries: string[], options: { text_pair: string[]; padding: true; truncation: false; add_special_tokens: true }): unknown;
  encode(query: string, options: { text_pair: string; add_special_tokens: true }): number[];
}

export interface LocalCrossEncoderSequenceClassifier {
  (inputs: unknown): Promise<{ logits?: { data?: ArrayLike<number>; dims?: number[] } }>;
}

export interface LocalCrossEncoderRuntime {
  tokenizer: LocalCrossEncoderPairTokenizer;
  model: LocalCrossEncoderSequenceClassifier;
}

export type LocalCrossEncoderFactory = (input: {
  modelId: string;
  revision: string;
  dtype: string;
}) => Promise<LocalCrossEncoderRuntime>;

async function loadTransformersRuntime(input: { modelId: string; revision: string; dtype: string }): Promise<LocalCrossEncoderRuntime> {
  const { AutoModelForSequenceClassification, AutoTokenizer } = await import("@huggingface/transformers");
  const modelLocation = process.env.TACTISCOUT_LOCAL_RERANKER_MODEL_PATH?.trim()
    || (existsSync(path.join(bundledLocalModelPath, "config.json")) ? bundledLocalModelPath : input.modelId);
  const options = modelLocation === input.modelId ? { revision: input.revision } : { local_files_only: true };
  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(modelLocation, options),
    AutoModelForSequenceClassification.from_pretrained(modelLocation, { ...options, dtype: input.dtype as "q8", device: "cpu" }),
  ]);
  return { tokenizer: tokenizer as unknown as LocalCrossEncoderPairTokenizer, model: model as unknown as LocalCrossEncoderSequenceClassifier };
}

function abortIfNeeded(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("Local reranking was cancelled.");
}

/** Optional multilingual ONNX cross-encoder experiment; never the production default. */
export class LocalCrossEncoderEvidenceReranker implements EvidenceReranker {
  readonly kind = "local" as const;
  readonly modelId: string;
  readonly revision: string;
  readonly dtype: string;
  readonly maximumPairTokens: number;
  private runtimePromise: Promise<LocalCrossEncoderRuntime> | undefined;

  constructor(input: {
    modelId?: string;
    revision?: string;
    dtype?: string;
    maximumPairTokens?: number;
    factory?: LocalCrossEncoderFactory;
  } = {}) {
    this.modelId = input.modelId ?? (process.env.TACTISCOUT_LOCAL_RERANKER_MODEL?.trim() || defaultModelId);
    this.revision = input.revision ?? (process.env.TACTISCOUT_LOCAL_RERANKER_REVISION?.trim() || defaultRevision);
    this.dtype = input.dtype ?? (process.env.TACTISCOUT_LOCAL_RERANKER_DTYPE?.trim() || defaultDtype);
    this.maximumPairTokens = Math.min(defaultPairTokenLimit, Math.max(1, Math.floor(input.maximumPairTokens ?? defaultPairTokenLimit)));
    const factory = input.factory ?? loadTransformersRuntime;
    this.runtimePromise = undefined;
    this.factory = factory;
  }

  private readonly factory: LocalCrossEncoderFactory;

  async prepare(): Promise<void> {
    const runtime = await this.runtime();
    const query = "Warm up the evidence reranker.";
    const passage = "Warm-up inference is not an evaluation question.";
    if (runtime.tokenizer.encode(query, { text_pair: passage, add_special_tokens: true }).length > this.maximumPairTokens) {
      throw new Error("Local cross-encoder warm-up pair exceeds its token limit.");
    }
    const features = runtime.tokenizer([query], {
      text_pair: [passage],
      padding: true,
      truncation: false,
      add_special_tokens: true,
    });
    const output = await runtime.model(features);
    if (!output.logits?.data || output.logits.dims?.[0] !== 1 || output.logits.dims.at(-1) !== 1) {
      throw new Error("Local cross-encoder warm-up returned an unexpected logits shape.");
    }
  }

  async countPairTokens(query: string, passage: string): Promise<number> {
    const runtime = await this.runtime();
    return runtime.tokenizer.encode(query, { text_pair: passage, add_special_tokens: true }).length;
  }

  async rerank(input: { query: string; candidates: EvidenceCandidate[]; signal: AbortSignal; timeoutMs: number }): Promise<EvidenceRerankerResult> {
    abortIfNeeded(input.signal);
    if (input.candidates.length > 12) throw new Error("Local cross-encoder accepts at most 12 evidence passages per batch.");
    const runtime = await this.runtime();
    const tokenCounts = input.candidates.map((candidate) => runtime.tokenizer.encode(input.query, {
      text_pair: candidate.embeddingText,
      add_special_tokens: true,
    }).length);
    const oversized = tokenCounts.find((count) => count > this.maximumPairTokens);
    if (oversized !== undefined) throw new Error("Local cross-encoder pair is " + oversized + " tokens; limit is " + this.maximumPairTokens + ". Candidate was rejected without truncation.");
    abortIfNeeded(input.signal);
    const started = performance.now();
    const features = runtime.tokenizer(
      input.candidates.map(() => input.query),
      {
        text_pair: input.candidates.map(({ embeddingText }) => embeddingText),
        padding: true,
        truncation: false,
        add_special_tokens: true,
      },
    );
    const output = await runtime.model(features);
    // Transformers.js ONNX execution does not expose per-request cancellation. The host checks
    // AbortSignal again before persisting any returned ranking, so late inference is discarded.
    abortIfNeeded(input.signal);
    if (performance.now() - started > input.timeoutMs) {
      const error = new Error("Local cross-encoder exceeded its reserved investigation budget.");
      error.name = "EvidenceBudgetExceededError";
      throw error;
    }
    const logits = output.logits;
    if (!logits?.data || !logits.dims || logits.dims[0] !== input.candidates.length || logits.dims.at(-1) !== 1) {
      throw new Error("Local cross-encoder returned an unexpected logits shape.");
    }
    const orderedIds = input.candidates
      .map((candidate, index) => ({ id: candidate.id, score: Number(logits.data![index]) }))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .map(({ id }) => id);
    return {
      orderedIds,
      // Scores are raw logits; no calibrated rejection threshold is applied.
      inputTokens: tokenCounts.reduce((sum, count) => sum + count, 0),
      outputTokens: null,
    };
  }

  private async runtime(): Promise<LocalCrossEncoderRuntime> {
    this.runtimePromise ??= this.factory({ modelId: this.modelId, revision: this.revision, dtype: this.dtype });
    return this.runtimePromise;
  }
}
