import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createKnowledgeEvidence } from "../../src/knowledge/evidence.js";
import type { KnowledgeEvidenceSource } from "../../src/knowledge/evidence-schemas.js";
import { PlosDiscoveryProvider } from "../../src/knowledge/plos-discovery.js";

const doi = "10.1371/journal.pone.0990001";
const articleUrl = `https://journals.plos.org/plosone/article?id=${encodeURIComponent(doi)}`;
const source: KnowledgeEvidenceSource = {
  id: "plos-methods-structured-test",
  name: "PLOS structured test source",
  publisher: "PLOS ONE",
  rightsUrl: articleUrl,
  license: "CC BY 4.0",
  allowedCorpora: ["methodology"],
  allowedUrlPrefixes: [articleUrl],
  allowedModelDestinations: ["local"],
  rights: { automatedFetch: true, persistentStorage: true, aiProcessing: true, display: true },
  rightsVerifiedAt: "2026-10-22",
  rightsNote: "The test article is explicitly permitted for authorized fetch, local processing, storage and display.",
};

const xml = `<?xml version="1.0"?>
<article>
  <front><article-meta>
    <article-id pub-id-type="doi">${doi}</article-id>
    <title-group><article-title>Pass behavior under pressure</article-title></title-group>
    <abstract><p>This article studies how pressure changes passing outcomes.</p></abstract>
  </article-meta></front>
  <body><sec id="results"><title>Results</title>
    <p id="pass-model">The model evaluates passes between two lines and distinguishes progression from a completed pass.</p>
    <sec id="context"><title>Context</title>
      <p id="pressure">High pressure changes the likelihood of a completed pass.</p>
    </sec>
    <table-wrap><table><tr><td>EXCLUDED THIRD PARTY VALUES</td></tr></table></table-wrap>
  </sec></body>
  <back><ref-list><ref>EXCLUDED REFERENCE TEXT</ref></ref-list></back>
</article>`;

function sourceApiResponse() {
  return new Response(JSON.stringify({ response: { docs: [{
    id: doi,
    title_display: "Pass behavior under pressure",
    author_display: ["A. Researcher"],
    publication_date: "2024-06-10",
    copyright: "This article is distributed under the Creative Commons Attribution License.",
    abstract: "This article studies how pressure changes passing outcomes.",
  }] } }), { status: 200, headers: { "content-type": "application/json" } });
}

function fakeEmbedding() {
  return {
    modelId: "test-e5-revision-1",
    async embedMany(texts: string[]) { return texts.map(() => [1, 0]); },
    async countTokens(text: string, kind: "query" | "passage") { return Array.from(`${kind}: ${text}`).length; },
  };
}

test("a registered single-corpus JATS source preserves section paths and returns retrievable cited paragraphs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-plos-structured-"));
  const registryPath = path.join(directory, "sources.json");
  await writeFile(registryPath, JSON.stringify([source]));
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    registryPath,
    embedder: fakeEmbedding(),
    reranker: null,
    allowUnacceptedHybridEvaluation: true,
  });
  const provider = new PlosDiscoveryProvider(async (input) => {
    const requestUrl = new URL(input.toString());
    if (requestUrl.hostname === "api.plos.org") return sourceApiResponse();
    assert.equal(requestUrl.hostname, "journals.plos.org");
    return new Response(xml, { status: 200, headers: { "content-type": "application/xml" } });
  }, 0);

  try {
    const [document] = await provider.fetchRegisteredEvidenceDocuments(doi, { registryPath });
    assert.ok(document);
    assert.equal(document.corpus, "methodology");
    assert.deepEqual(document.sections?.map(({ heading }) => heading), ["Abstract", "Results", "Results / Context"]);
    assert.match(document.sections?.[2]?.locator ?? "", /sec\[@id='results'\].*sec\[@id='context'\].*p\[@id='pressure'\]/u);
    assert.match(document.sections?.[1]?.text ?? "", /two lines and distinguishes progression from a completed pass/u);
    assert.doesNotMatch(document.content, /EXCLUDED THIRD PARTY VALUES|EXCLUDED REFERENCE TEXT/u);

    await system.admin.registerSource(source);
    await system.admin.publishDocument(document);
    const retrieved = await system.reader.retrieve({ kind: "methodology", query: "pressure changes a completed pass", limit: 6 }, {
      turnId: "plos-structured-test-turn-01",
      purpose: "evaluation",
      modelDestination: "local",
    });
    assert.equal(retrieved.status, "found");
    assert.ok(retrieved.evidence.some(({ text, source: attribution }) => text.includes("High pressure") && attribution.sectionPath.includes("Results / Context")));
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});
