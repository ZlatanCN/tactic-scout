import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceCandidate } from "../../src/knowledge/evidence-index.js";
import {
  LocalCrossEncoderEvidenceReranker,
  type LocalCrossEncoderPairTokenizer,
} from "../../src/knowledge/local-cross-encoder-reranker.js";

function candidate(id: string, passage: string): EvidenceCandidate {
  return {
    id,
    revisionId: "revision",
    sectionId: "section",
    startOffset: 0,
    endOffset: passage.length,
    sourceId: "source",
    corpus: "methodology",
    retrievalText: passage,
    embeddingText: passage,
    embeddingTokens: 10,
    evidenceText: passage,
    vector: [1, 0],
    fusedScore: 0.01,
  };
}

function tokenizerForTest(): LocalCrossEncoderPairTokenizer {
  const tokenizer = ((queries: string[], options: { text_pair: string[] }) => ({ queries, passages: options.text_pair })) as unknown as LocalCrossEncoderPairTokenizer;
  tokenizer.encode = (query, options) => Array.from(query + options.text_pair).map((_char, index) => index);
  return tokenizer;
}

test("local cross-encoder ranks a bounded batch by raw pair logits without truncation", async () => {
  const reranker = new LocalCrossEncoderEvidenceReranker({
    modelId: "fixture/model",
    revision: "f".repeat(40),
    dtype: "q8",
    factory: async () => ({
      tokenizer: tokenizerForTest(),
      model: async () => ({ logits: { data: new Float32Array([-2, 4]), dims: [2, 1] } }),
    }),
  });
  const result = await reranker.rerank({
    query: "midfield pressure",
    candidates: [candidate("low", "irrelevant"), candidate("high", "pressure response")],
    signal: new AbortController().signal,
    timeoutMs: 1_000,
  });
  assert.deepEqual(result.orderedIds, ["high", "low"]);
  assert.equal(result.inputTokens,
    Array.from("midfield pressure").length + Array.from("irrelevant").length
    + Array.from("midfield pressure").length + Array.from("pressure response").length);
  assert.equal(result.outputTokens, null);
});

test("local cross-encoder rejects overlength pairs before inference instead of silently truncating", async () => {
  let modelCalled = false;
  const reranker = new LocalCrossEncoderEvidenceReranker({
    maximumPairTokens: 16,
    factory: async () => ({
      tokenizer: tokenizerForTest(),
      model: async () => {
        modelCalled = true;
        return { logits: { data: new Float32Array([1]), dims: [1, 1] } };
      },
    }),
  });
  await assert.rejects(reranker.rerank({
    query: "query",
    candidates: [candidate("large", "long".repeat(20))],
    signal: new AbortController().signal,
    timeoutMs: 1_000,
  }), /without truncation/iu);
  assert.equal(modelCalled, false);
});

test("late local inference is discarded after cancellation", async () => {
  const controller = new AbortController();
  const reranker = new LocalCrossEncoderEvidenceReranker({
    factory: async () => ({
      tokenizer: tokenizerForTest(),
      model: async () => {
        controller.abort(new Error("cancelled"));
        return { logits: { data: new Float32Array([1]), dims: [1, 1] } };
      },
    }),
  });
  await assert.rejects(reranker.rerank({
    query: "query",
    candidates: [candidate("a", "passage")],
    signal: controller.signal,
    timeoutMs: 1_000,
  }), /cancelled/u);
});
