import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createKnowledgeEvidence } from "../../src/knowledge/evidence.js";
import type { KnowledgeEvidenceSource } from "../../src/knowledge/evidence-schemas.js";

const source: KnowledgeEvidenceSource = {
  id: "markdown-role-guide",
  name: "Markdown role guide",
  publisher: "TactiScout",
  rightsUrl: "https://tactiscout.local/terms",
  license: "Authored for TactiScout",
  allowedCorpora: ["methodology"],
  allowedUrlPrefixes: ["https://tactiscout.local/knowledge/"],
  rights: { automatedFetch: false, persistentStorage: true, aiProcessing: true, display: true },
  rightsVerifiedAt: "2026-10-22",
  rightsNote: "Project-authored material permitted for local persistence, processing and display.",
  allowedModelDestinations: ["local"],
};

const markdown = `# Midfield role

Compare a player's observable movement with the actual match context.

## Defensive phase

- Check pressure before the pass.
- Record whether the player protects the central lane.

| Evidence | Meaning |
| --- | --- |
| Pressure | Interpret the pass within the match situation |
`;

function fakeEmbedding() {
  return {
    modelId: "test-e5-revision-1",
    async embedMany(texts: string[]) { return texts.map(() => [1, 0]); },
    async countTokens(text: string, kind: "query" | "passage") { return Array.from(`${kind}: ${text}`).length; },
  };
}

function tokenRecordingEmbedding() {
  let maximumPassageTokens = 0;
  return {
    embedder: {
      modelId: "test-e5-token-budget-1",
      async countTokens(text: string, kind: "query" | "passage") {
        return Array.from(`${kind}: ${text}`).length;
      },
      async embedMany(texts: string[], kind: "query" | "passage") {
        if (kind === "passage") {
          for (const text of texts) maximumPassageTokens = Math.max(maximumPassageTokens, Array.from(`${kind}: ${text}`).length);
        }
        return texts.map(() => [1, 0]);
      },
    },
    maximumPassageTokens: () => maximumPassageTokens,
  };
}

test("publishing Markdown preserves headings, list items, table labels and resolvable source passages", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-markdown-ingest-"));
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    embedder: fakeEmbedding(),
    reranker: null,
    allowUnacceptedHybridEvaluation: true,
  });
  try {
    await system.admin.registerSource(source);
    const metadata = {
      sourceId: source.id,
      corpus: "methodology" as const,
      title: "Midfield role",
      url: "https://tactiscout.local/knowledge/midfield-role.md",
      author: "TactiScout project authors",
      publisher: source.publisher,
      publishedAt: null,
      license: source.license,
      attribution: "Project-authored Markdown role guide.",
      entityIds: [],
      entityNames: [],
      competition: null,
      season: null,
      acquisition: "authored" as const,
      sampleSummary: null,
      observedFrom: null,
      observedTo: null,
    };
    const published = await system.admin.publishMarkdownDocument({ metadata, markdown });
    assert.ok(published.revisionId);

    const repeated = await system.admin.publishMarkdownDocument({ metadata, markdown: markdown + "\n" });
    assert.equal(repeated.revisionId, published.revisionId, "raw formatting changes with identical normalized blocks do not create an evidence revision");
    assert.equal(repeated.generationId, published.generationId, "a no-op import does not rebuild the active retrieval index");
    const acquisitions = await system.admin.documentAcquisitionHistory(published.documentId);
    assert.deepEqual(new Set(acquisitions.map(({ sourcePayloadSha256 }) => sourcePayloadSha256)), new Set([
      createHash("sha256").update(markdown).digest("hex"),
      createHash("sha256").update(markdown + "\n").digest("hex"),
    ]));
    assert.ok(acquisitions.every(({ normalizationVersion }) => normalizationVersion === "markdown-gfm-v1"));

    const result = await system.reader.retrieve({ kind: "methodology", query: "pressure before the pass central lane", limit: 6 }, {
      turnId: "markdown-role-test-turn-01",
      purpose: "evaluation",
      modelDestination: "local",
    });
    assert.equal(result.status, "found");
    const pressure = result.evidence.find(({ text }) => text.includes("Check pressure before the pass"));
    assert.ok(pressure);
    assert.equal(pressure.source.sectionPath.at(-1), "Midfield role / Defensive phase");
    assert.ok(result.evidence.some(({ text }) => text.includes("Evidence: Pressure") && text.includes("Meaning")));
    const resolved = await system.reader.resolve([pressure.ref], {
      turnId: "markdown-role-test-turn-02",
      purpose: "reporting",
      modelDestination: "local",
    });
    assert.equal(resolved.status, "found");
    assert.equal(resolved.evidence[0]?.text, "Check pressure before the pass.");
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Markdown imports reject raw HTML rather than interpreting embedded markup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-markdown-html-"));
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    embedder: fakeEmbedding(),
    reranker: null,
    allowUnacceptedHybridEvaluation: true,
  });
  try {
    await system.admin.registerSource(source);
    await assert.rejects(system.admin.publishMarkdownDocument({
      metadata: {
        sourceId: source.id,
        corpus: "methodology",
        title: "Unsafe Markdown",
        url: "https://tactiscout.local/knowledge/unsafe.md",
        author: "TactiScout project authors",
        publisher: source.publisher,
        publishedAt: null,
        license: source.license,
        attribution: "Project-authored fixture.",
        entityIds: [],
        entityNames: [],
        competition: null,
        season: null,
        acquisition: "authored",
        sampleSummary: null,
        observedFrom: null,
        observedTo: null,
      },
      markdown: "<script>Do not index executable markup.</script>",
    }), /raw HTML/iu);
    assert.equal((await system.admin.status()).activeDocuments, 0);
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("long passages are split at safe boundaries within the embedding tokenizer budget and remain fully citable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-markdown-token-budget-"));
  const recording = tokenRecordingEmbedding();
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    embedder: recording.embedder,
    reranker: null,
    allowUnacceptedHybridEvaluation: true,
  });
  const longText = Array.from({ length: 170 }, (_, index) => `边锋回撤参与防守转换，第${index + 1}次观察。`).join("");
  try {
    await system.admin.registerSource(source);
    await system.admin.publishMarkdownDocument({
      metadata: {
        sourceId: source.id,
        corpus: "methodology",
        title: "Long Role Evidence",
        url: "https://tactiscout.local/knowledge/long-role.md",
        author: "TactiScout project authors",
        publisher: source.publisher,
        publishedAt: null,
        license: source.license,
        attribution: "Project-authored long passage fixture.",
        entityIds: [],
        entityNames: [],
        competition: null,
        season: null,
        acquisition: "authored",
        sampleSummary: null,
        observedFrom: null,
        observedTo: null,
      },
      markdown: `# Long Role Evidence\n\n${longText}`,
    });
    assert.ok(recording.maximumPassageTokens() > 0, "the model tokenizer is used to size passage inputs");
    assert.ok(recording.maximumPassageTokens() <= 512);

    const references = new Map<string, { start: number; end: number }>();
    for (let index = 1; index <= 170; index += 15) {
      const result = await system.reader.retrieve({ kind: "methodology", query: `第${index}次观察`, limit: 6 }, {
        turnId: `markdown-token-budget-turn-${String(index).padStart(3, "0")}`,
        purpose: "evaluation",
        modelDestination: "local",
      });
      assert.equal(result.status, "found");
      for (const { ref } of result.evidence) {
        references.set(`${ref.startOffset}:${ref.endOffset}`, { start: ref.startOffset, end: ref.endOffset });
      }
    }
    const spans = [...references.values()].sort((left, right) => left.start - right.start);
    let coveredEnd = 0;
    for (const span of spans) {
      assert.ok(span.start <= coveredEnd, "neighboring retrieved spans overlap or meet without dropping source text");
      coveredEnd = Math.max(coveredEnd, span.end);
    }
    assert.ok(coveredEnd >= longText.length);
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});
