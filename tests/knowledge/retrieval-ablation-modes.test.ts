import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createKnowledgeEvidence } from "../../src/knowledge/evidence.js";
import { EvidenceAccessContextSchema, type KnowledgeEvidenceSource } from "../../src/knowledge/evidence-schemas.js";

const source: KnowledgeEvidenceSource = {
  id: "retrieval-ablation-test-source",
  name: "Retrieval Ablation Test Source",
  publisher: "Test Publisher",
  rightsUrl: "https://ablation.test/terms",
  license: "CC BY 4.0",
  allowedCorpora: ["methodology"],
  allowedUrlPrefixes: ["https://ablation.test/papers/"],
  rights: { automatedFetch: false, persistentStorage: true, aiProcessing: true, display: true },
  rightsVerifiedAt: "2026-10-23",
  rightsNote: "Test-only fixture permits local retrieval and display.",
  allowedModelDestinations: ["local", "configured_chat_gateway"],
};

test("full-text, dense-vector and hybrid retrieval are distinct evaluation-only ablations", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rag-v2-retrieval-ablation-"));
  const evidence = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    embedder: {
      modelId: "test-e5-ablation",
      async embedMany(texts: string[]) {
        return texts.map((text) => text.toLocaleLowerCase().includes("goalkeeper") ? [0, 1] : [1, 0]);
      },
      async countTokens(text: string, kind: "query" | "passage") {
        return `${kind}: ${text}`.trim().split(/\s+/u).length;
      },
    },
    reranker: null,
    allowUnacceptedHybridEvaluation: true,
  });
  try {
    await evidence.admin.registerSource(source);
    await evidence.admin.publishDocument({
      sourceId: source.id,
      corpus: "methodology",
      title: "Retrieval Ablation Fixture",
      url: "https://ablation.test/papers/retrieval-fixture",
      author: "A. Researcher",
      publisher: source.publisher,
      publishedAt: null,
      license: source.license,
      attribution: "A. Researcher, Retrieval Ablation Fixture.",
      entityIds: [],
      entityNames: [],
      competition: null,
      season: null,
      acquisition: "manual_import",
      content: [
        "The midfielder controls tempo with progressive passes.",
        "The goalkeeper claims crosses near the penalty area.",
        "The winger accelerates down the touchline before crossing.",
      ].join("\n\n"),
      sections: [
        { id: "sec-midfield", heading: "Midfield", kind: "paragraph", text: "The midfielder controls tempo with progressive passes." },
        { id: "sec-goalkeeper", heading: "Goalkeeper", kind: "paragraph", text: "The goalkeeper claims crosses near the penalty area." },
        { id: "sec-winger", heading: "Winger", kind: "paragraph", text: "The winger accelerates down the touchline before crossing." },
      ],
    });
    assert.equal((await evidence.admin.prepareRuntime()).ready, true);

    const results = await Promise.all(["full_text", "dense_vector", "hybrid"].map((retrievalMode) => evidence.reader.retrieve(
      { kind: "methodology", query: "goalkeeper claims crosses", limit: 3 },
      {
        turnId: "retrieval-mode-" + retrievalMode,
        purpose: "evaluation",
        modelDestination: "configured_chat_gateway",
        retrievalMode: retrievalMode as "full_text" | "dense_vector" | "hybrid",
      },
    )));

    assert.deepEqual(results.map(({ rankingMode }) => rankingMode), ["full_text", "dense_vector", "hybrid"]);
    assert.ok(results.every(({ status, evidence: items }) => status === "found" && items.length > 0));
    assert.equal(results[0]?.evidence[0]?.text, "The goalkeeper claims crosses near the penalty area.");
    assert.equal(EvidenceAccessContextSchema.safeParse({
      turnId: "not-evaluation-mode",
      purpose: "recruitment",
      modelDestination: "configured_chat_gateway",
      retrievalMode: "full_text",
    }).success, false);
  } finally {
    await evidence.close();
    await rm(directory, { recursive: true, force: true });
  }
});
