import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { LocalKnowledgeBase, methodologyRetrievalPolicy } from "../../src/knowledge/index.js";
import { KnowledgePermissionError, type KnowledgeDocumentInput, type KnowledgeSource } from "../../src/knowledge/schemas.js";
import { PlosDiscoveryProvider } from "../../src/knowledge/plos-discovery.js";

const source: KnowledgeSource = {
  id: "test-source",
  name: "Test Source",
  publisher: "Test Publisher",
  rightsUrl: "https://allowed.test/terms",
  license: "CC BY 4.0",
  allowedCorpora: ["player_report"],
  allowedUrlPrefixes: ["https://allowed.test/docs/"],
  rights: { automatedFetch: false, persistentStorage: true, aiProcessing: true, display: true },
  rightsVerifiedAt: "2026-09-29",
  rightsNote: "Test fixture with explicit storage and AI permissions.",
};

const document: KnowledgeDocumentInput = {
  sourceId: source.id,
  corpus: "player_report",
  title: "A player report",
  url: "https://allowed.test/docs/player-1",
  author: "A Scout",
  publisher: source.publisher,
  publishedAt: "2026-09-01",
  license: source.license,
  attribution: "A Scout, Test Source, 2026",
  entityIds: ["player-1"],
  entityNames: ["Jonas Vale"],
  competition: "Open League",
  season: "2025/26",
  acquisition: "manual_import",
  content: "Jonas Vale is observed making frequent forward runs and pressing after losing possession. This is a qualitative report observation, not a measured match statistic.",
};

async function createFixtureBase(tempRoot: string) {
  const registryPath = path.join(tempRoot, "sources.json");
  await writeFile(registryPath, JSON.stringify([source]), "utf8");
  const base = new LocalKnowledgeBase({
    indexPath: path.join(tempRoot, "index"),
    registryPath,
    seedDocuments: [],
    embedder: {
      modelId: "test-embedding",
      async embed(text: string) {
        const value = text.toLocaleLowerCase().includes("pressing") ? 1 : 0.5;
        return [value, 1 - value];
      },
    },
  });
  return { base, registryPath };
}

test("knowledge ingestion rejects unregistered sources and unapproved automated fetching", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-knowledge-policy-"));
  try {
    const { base } = await createFixtureBase(tempRoot);
    await assert.rejects(base.ingest({ ...document, sourceId: "unknown-source" }), KnowledgePermissionError);
    await assert.rejects(base.ingest({ ...document, acquisition: "authorized_fetch" }), /未获准自动抓取/);
    await assert.rejects(base.ingest({ ...document, url: "https://unlisted.test/player-1" }), /URL 不在来源/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("authorized local imports are persisted with provenance and searchable by corpus", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-knowledge-index-"));
  try {
    const { base } = await createFixtureBase(tempRoot);
    const inserted = await base.ingest(document);
    const results = await base.search({ corpus: "player_report", query: "Jonas Vale forward runs", playerNames: ["Jonas Vale"], limit: 3 });
    const status = await base.status();

    assert.equal(inserted.chunkCount, 1);
    assert.equal(results[0]?.sourceId, source.id);
    assert.deepEqual(results[0]?.entityIds, ["player-1"]);
    assert.equal(results[0]?.license, source.license);
    assert.equal(status.playerReportChunks, 1);
    assert.equal(status.embeddingModel, "test-embedding");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("searching an empty corpus returns no matches without initializing the embedder", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-knowledge-empty-corpus-"));
  try {
    const registryPath = path.join(tempRoot, "sources.json");
    await writeFile(registryPath, JSON.stringify([{ ...source, allowedCorpora: ["methodology", "player_report"] }]), "utf8");
    const embedKinds: string[] = [];
    const base = new LocalKnowledgeBase({
      indexPath: path.join(tempRoot, "index"),
      registryPath,
      seedDocuments: [],
      embedder: {
        modelId: "test-embedding",
        async embed(_text: string, kind: "query" | "passage") {
          embedKinds.push(kind);
          if (kind === "query") throw new Error("query embedding should be skipped when the corpus is empty");
          return [1, 0];
        },
      },
    });
    await base.ingest({ ...document, corpus: "methodology" });

    const results = await base.search({
      corpus: "player_report",
      query: "Jonas Vale scouting report",
      playerNames: ["Jonas Vale"],
      limit: 3,
    });

    assert.deepEqual(results, []);
    assert.deepEqual(embedKinds, ["passage"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("methodology retrieval abstains unless calibrated semantic and lexical evidence both pass", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-methodology-abstention-"));
  try {
    const methodologySource: KnowledgeSource = {
      ...source,
      id: "test-methodology-source",
      allowedCorpora: ["methodology"],
    };
    const registryPath = path.join(tempRoot, "sources.json");
    await writeFile(registryPath, JSON.stringify([methodologySource]), "utf8");
    const base = new LocalKnowledgeBase({
      indexPath: path.join(tempRoot, "index"),
      registryPath,
      seedDocuments: [],
      embedder: {
        modelId: methodologyRetrievalPolicy.embeddingModel,
        async embed() { return [1, 0]; },
      },
    });
    const methodologyDocument: KnowledgeDocumentInput = {
      sourceId: methodologySource.id,
      corpus: "methodology",
      title: "Performance analysis methods",
      url: "https://allowed.test/docs/methodology-1",
      author: "A Scout",
      publisher: methodologySource.publisher,
      publishedAt: null,
      license: methodologySource.license,
      attribution: "A Scout, Test Source, 2026",
      entityIds: [],
      entityNames: [],
      competition: null,
      season: null,
      acquisition: "manual_import",
      content: "比赛技术和战术表现指标能帮助球员发展和反馈，但解释指标时需要结合明确的比赛语境。",
    };
    await base.ingest(methodologyDocument);

    const supported = await base.search({
      corpus: "methodology",
      query: "比赛技术和战术指标怎样帮助球员发展？",
      limit: 3,
    });
    const unsupported = await base.search({
      corpus: "methodology",
      query: "这名球员的转会身价和合同到期时间是什么？",
      limit: 3,
    });
    const unsupportedSignal = await base.inspectMethodologySearch({
      corpus: "methodology",
      query: "这名球员的转会身价和合同到期时间是什么？",
      limit: 3,
    });

    assert.equal(supported[0]?.sourceId, methodologySource.id);
    assert.deepEqual(unsupported, []);
    assert.equal(unsupportedSignal[0]?.maxCosineSimilarity, 1);
    assert.equal(unsupportedSignal[0]?.maxQueryTermCoverageAtAcceptedCosine, 0);

    const uncalibratedBase = new LocalKnowledgeBase({
      indexPath: path.join(tempRoot, "uncalibrated-index"),
      registryPath,
      seedDocuments: [],
      embedder: {
        modelId: "uncalibrated-test-embedding",
        async embed() { return [1, 0]; },
      },
    });
    await uncalibratedBase.ingest(methodologyDocument);
    assert.deepEqual(await uncalibratedBase.search({
      corpus: "methodology",
      query: "比赛技术和战术指标怎样帮助球员发展？",
      limit: 3,
    }), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("methodology documents with no player entities can create a LanceDB index", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-knowledge-empty-entities-"));
  try {
    const { base } = await createFixtureBase(tempRoot);
    const inserted = await base.ingest({ ...document, entityIds: [], entityNames: [] });
    assert.equal(inserted.chunkCount, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("an index cannot mix vectors generated by different embedding models", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-knowledge-models-"));
  try {
    const { base, registryPath } = await createFixtureBase(tempRoot);
    await base.ingest(document);
    const incompatibleBase = new LocalKnowledgeBase({
      indexPath: path.join(tempRoot, "index"),
      registryPath,
      seedDocuments: [],
      embedder: {
        modelId: "different-test-embedding",
        async embed() { return [0.2, 0.8]; },
      },
    });

    await assert.rejects(
      incompatibleBase.search({ corpus: "player_report", query: "Jonas Vale report", playerNames: ["Jonas Vale"] }),
      /当前知识索引使用了其他 embedding 模型/,
    );
    await assert.rejects(
      incompatibleBase.ingest({ ...document, title: "A second report", url: "https://allowed.test/docs/player-2" }),
      /当前知识索引使用了其他 embedding 模型/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("updated source permissions immediately restrict documents in the same knowledge-base instance", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-knowledge-revocation-"));
  try {
    const { base, registryPath } = await createFixtureBase(tempRoot);
    await base.ingest(document);
    await writeFile(registryPath, JSON.stringify([{
      ...source,
      allowedCorpora: ["methodology"],
      rights: { ...source.rights, aiProcessing: false },
    }]), "utf8");

    const results = await base.search({ corpus: "player_report", query: "Jonas Vale report", playerNames: ["Jonas Vale"] });
    const status = await base.status();
    assert.deepEqual(results, []);
    assert.equal(status.playerReportChunks, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("a revoked or removed source can be purged from the local LanceDB index", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-knowledge-purge-"));
  try {
    const { base } = await createFixtureBase(tempRoot);
    await base.ingest(document);
    assert.equal(await base.purgeSourceData(source.id), 1);
    assert.equal(await base.purgeSourceData(source.id), 0, "purging a source twice is idempotent");
    assert.equal(await base.purgeSourceData("removed-source"), 0, "an unknown source is a safe no-op");
    assert.deepEqual(await base.search({ corpus: "player_report", query: "Jonas Vale report", playerNames: ["Jonas Vale"] }), []);
    assert.equal((await base.status()).indexedChunks, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("revoked and unregistered seed sources are skipped without restoring content or stopping searches", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-knowledge-seed-revocation-"));
  try {
    const registryPath = path.join(tempRoot, "sources.json");
    await writeFile(registryPath, JSON.stringify([{
      ...source,
      rights: { ...source.rights, persistentStorage: false, aiProcessing: false },
    }]), "utf8");
    const base = new LocalKnowledgeBase({
      indexPath: path.join(tempRoot, "index"),
      registryPath,
      seedDocuments: [document],
      embedder: {
        modelId: "test-embedding",
        async embed() { return [1, 0]; },
      },
    });
    assert.deepEqual(await base.search({ corpus: "player_report", query: "Jonas Vale report", playerNames: ["Jonas Vale"] }), []);
    assert.equal((await base.status()).indexedChunks, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("player report retrieval hard-filters documents by indexed player entity", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-knowledge-entities-"));
  try {
    const { base } = await createFixtureBase(tempRoot);
    await base.ingest(document);
    await base.ingest({
      ...document,
      title: "Another player report",
      url: "https://allowed.test/docs/player-2",
      entityIds: ["player-2"],
      entityNames: ["Marco Silva"],
      content: "Marco Silva is observed making frequent forward runs and pressing after losing possession. This is a qualitative report observation, not a measured match statistic.",
    });

    const results = await base.search({
      corpus: "player_report",
      query: "forward runs and pressing",
      playerNames: ["Jonas Vale"],
      limit: 5,
    });
    const noEntityMatch = await base.search({
      corpus: "player_report",
      query: "forward runs and pressing",
      playerNames: ["Harry Kane"],
      limit: 5,
    });

    await assert.rejects(base.search({
      corpus: "player_report",
      query: "forward runs and pressing",
      playerNames: [],
      limit: 5,
    }), /必须提供至少一个球员实体名称/);

    assert.deepEqual(results.map((result) => result.entityNames), [["Jonas Vale"]]);
    assert.deepEqual(noEntityMatch, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("first-party observation provenance survives retrieval and deleting its document removes it", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-knowledge-authored-observation-"));
  try {
    const observationSource: KnowledgeSource = {
      id: "tactiscout-first-party-observations",
      name: "TactiScout authored observations",
      publisher: "TactiScout and local user",
      rightsUrl: "https://tactiscout.local/privacy/player-observations",
      license: "User-authored, consent-gated local use",
      allowedCorpora: ["player_report"],
      allowedUrlPrefixes: ["https://tactiscout.local/player-observations/"],
      rights: { automatedFetch: false, persistentStorage: true, aiProcessing: true, display: true },
      rightsVerifiedAt: "2026-10-04",
      rightsNote: "Only user-authored observations with explicit consent are indexed.",
    };
    const registryPath = path.join(tempRoot, "sources.json");
    await writeFile(registryPath, JSON.stringify([observationSource]), "utf8");
    const base = new LocalKnowledgeBase({
      indexPath: path.join(tempRoot, "index"),
      registryPath,
      seedDocuments: [],
      embedder: {
        modelId: "test-observation-embedding",
        async embed(text: string) { return text.toLocaleLowerCase().includes("pressing") ? [1, 0] : [0, 1]; },
      },
    });
    const documentId = await base.ingest({
      sourceId: observationSource.id,
      corpus: "player_report",
      title: "Jonas Vale · first-party scouting observation",
      url: "https://tactiscout.local/player-observations/observation-1?revision=1",
      author: "A. Scout",
      publisher: observationSource.publisher,
      publishedAt: "2026-10-04",
      license: observationSource.license,
      attribution: "A. Scout, observed 2026-10-04；参考链接：https://example.test/match-report",
      entityIds: ["sportmonks:123"],
      entityNames: ["Jonas Vale"],
      competition: "Open League",
      season: "2025/26",
      acquisition: "authored",
      content: "The scout observed Jonas Vale receive the ball between the lines, turn under pressure, and carry forward before pressing immediately after a turnover.",
    });
    const results = await base.search({ corpus: "player_report", query: "forward carrying and pressing", playerNames: ["Jonas Vale"] });

    assert.equal(results[0]?.sourceId, observationSource.id);
    assert.equal(results[0]?.author, "A. Scout");
    assert.equal(results[0]?.url, "https://example.test/match-report");
    assert.equal(await base.removeDocument(documentId.documentId), 1);
    assert.equal(await base.removeDocument(documentId.documentId), 0);
    assert.deepEqual(await base.search({ corpus: "player_report", query: "forward carrying and pressing", playerNames: ["Jonas Vale"] }), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("the shipped source registry records its attribution and retrieval permissions", async () => {
  const contents = await readFile(new URL("../../data/knowledge/sources.json", import.meta.url), "utf8");
  const [plosSource] = JSON.parse(contents) as KnowledgeSource[];
  assert.equal(plosSource.id, "plos-soccer-analysis-2024");
  assert.equal(plosSource.license, "CC BY 4.0");
  assert.equal(plosSource.rights.persistentStorage, true);
  assert.equal(plosSource.rights.aiProcessing, true);
  assert.ok(plosSource.rightsNote.includes("API"));
});

test("PLOS discovery returns metadata only and marks only registered article URLs ingestible", async () => {
  const registryPath = fileURLToPath(new URL("../../data/knowledge/sources.json", import.meta.url));
  let requestedUrl: URL | undefined;
  const fetcher: typeof fetch = async (input) => {
    requestedUrl = new URL(input.toString());
    return new Response(JSON.stringify({ response: { docs: [
      {
        id: "10.1371/journal.pone.0298346",
        title_display: "Registered methods paper",
        author_display: ["Davidson", "Barrett"],
        publication_date: "2024-03-07",
        copyright: "Creative Commons Attribution License",
      },
      {
        id: "10.1371/journal.pone.0999999",
        title_display: "Unregistered paper",
        author_display: ["A Researcher"],
        publication_date: "2026-01-01",
        copyright: "Creative Commons Attribution License",
      },
    ] } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const candidates = await new PlosDiscoveryProvider(fetcher).discover("soccer performance analysis", { registryPath, limit: 2 });

  assert.equal(requestedUrl?.hostname, "api.plos.org");
  assert.equal(requestedUrl?.searchParams.get("rows"), "2");
  assert.equal(candidates[0]?.registeredForIngestion, true);
  assert.equal(candidates[1]?.registeredForIngestion, false);
  assert.equal(candidates[0]?.articleUrl, "https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0298346");
});

test("PLOS正文抓取只访问已登记DOI并保留文章署名和许可", async () => {
  let requestCount = 0;
  const fetcher: typeof fetch = async () => {
    requestCount += 1;
    if (requestCount > 1) return new Response(`<article><front><article-meta><article-id pub-id-type="doi">10.1371/journal.pone.0298346</article-id></article-meta></front><body><sec><title>Methods</title><p>Indicators need match context &amp; practitioner interpretation.</p></sec></body></article>`, { status: 200, headers: { "content-type": "application/xml" } });
    return new Response(JSON.stringify({ response: { docs: [{
      id: "10.1371/journal.pone.0298346",
      title_display: "Methods paper",
      author_display: ["Davidson", "Barrett"],
      publication_date: "2024-03-07",
      copyright: "This open access article is distributed under the Creative Commons Attribution License.",
      abstract: "This is a sufficiently long abstract about football performance analysis.",
      body: "<p>Indicators need match context &amp; practitioner interpretation.</p>",
    }] } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const provider = new PlosDiscoveryProvider(fetcher, 0);
  const article = await provider.fetchRegisteredArticle("10.1371/journal.pone.0298346", {
    registryPath: fileURLToPath(new URL("../../data/knowledge/sources.json", import.meta.url)),
  });

  assert.equal(article.acquisition, "authorized_fetch");
  assert.equal(article.corpus, "methodology");
  assert.match(article.content, /Indicators need match context & practitioner interpretation/);
  assert.match(article.attribution, /Davidson, Barrett/);
  assert.equal(requestCount, 2);

  await assert.rejects(provider.fetchRegisteredArticle("10.1371/journal.pone.0999999", {
    registryPath: fileURLToPath(new URL("../../data/knowledge/sources.json", import.meta.url)),
  }), /尚无允许自动抓取/);
  assert.equal(requestCount, 2, "unregistered article should be rejected before requesting its body");
});

test("registered PLOS fetch keeps attributed article prose and excludes figures, tables, supplements, references, and linked third-party material", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-plos-profile-"));
  try {
    const doi = "10.1371/journal.pone.0353239";
    const articleUrl = `https://journals.plos.org/plosone/article?id=${encodeURIComponent(doi)}`;
    const profileSource: KnowledgeSource = {
      ...source,
      id: "plos-player-profile-2026",
      name: "PLOS ONE: Multivariate player profiling",
      publisher: "PLOS ONE",
      rightsUrl: articleUrl,
      license: "CC BY 4.0",
      allowedCorpora: ["methodology"],
      allowedUrlPrefixes: [articleUrl],
      rights: { automatedFetch: true, persistentStorage: true, aiProcessing: true, display: true },
      rightsNote: "Exact article fixture with article-level permission.",
    };
    const registryPath = path.join(tempRoot, "sources.json");
    await writeFile(registryPath, JSON.stringify([profileSource]), "utf8");
    const requestedUrls: URL[] = [];
    const jatsDocument = `<article><front><article-meta><article-id pub-id-type="doi">${doi}</article-id></article-meta></front><body><sec><title>Results</title><p>Profile construction combines multiple offensive and defensive performance indicators to characterize player roles.</p><p>Observed activity volume must be interpreted separately from efficiency when comparing players.</p><fig><caption>FIGURE-ONLY diagram and label.</caption></fig><table-wrap><caption>TABLE-ONLY player values.</caption><table><tr><td>PRIVATE MATCH STATISTICS</td></tr></table></table-wrap><supplementary-material>SUPPLEMENT-ONLY file.</supplementary-material><ref-list><ref>REFERENCE-ONLY citation text.</ref></ref-list><p>Third-party extract: <ext-link xlink:href="https://example.org/licensed">THIRD-PARTY LICENSED TEXT</ext-link></p></sec></body></article>`;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(input.toString());
      requestedUrls.push(url);
      if (url.hostname !== "api.plos.org") return new Response(jatsDocument, { status: 200, headers: { "content-type": "application/xml" } });
      return new Response(JSON.stringify({ response: { docs: [{
        id: doi,
        title_display: "Optimizing football analytics: Dimensionality reduction meets machine learning for offensive and defensive player profiling",
        author_display: ["A. Researcher", "B. Analyst"],
        publication_date: "2026-05-20",
        copyright: "Creative Commons Attribution License",
        abstract: "The paper presents an attributed methodological overview of football player profiles.",
        body: "<body><sec><p>Profile construction combines multiple offensive and defensive performance indicators to characterize player roles.</p><p>Observed activity volume must be interpreted separately from efficiency when comparing players.</p><fig><caption>FIGURE-ONLY diagram and label.</caption></fig><table-wrap><caption>TABLE-ONLY player values.</caption><table><tr><td>PRIVATE MATCH STATISTICS</td></tr></table></table-wrap><supplementary-material>SUPPLEMENT-ONLY file.</supplementary-material><ref-list><ref>REFERENCE-ONLY citation text.</ref></ref-list><p>Third-party extract: <ext-link xlink:href=\"https://example.org/licensed\">THIRD-PARTY LICENSED TEXT</ext-link></p></sec></body>",
      }] } }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const article = await new PlosDiscoveryProvider(fetcher, 0).fetchRegisteredArticle(doi, { registryPath });

    assert.equal(requestedUrls.length, 2);
    assert.equal(requestedUrls[0]?.hostname, "api.plos.org");
    assert.equal(requestedUrls[0]?.searchParams.get("q"), `id:"${doi}"`);
    assert.equal(requestedUrls[1]?.hostname, "journals.plos.org");
    assert.equal(requestedUrls[1]?.pathname, "/plosone/article/file");
    assert.equal(article.sourceId, profileSource.id);
    assert.equal(article.url, articleUrl);
    assert.match(article.content, /Profile construction combines multiple offensive and defensive performance indicators/);
    assert.match(article.content, /activity volume must be interpreted separately from efficiency/);
    assert.doesNotMatch(article.content, /FIGURE-ONLY|TABLE-ONLY|PRIVATE MATCH STATISTICS|SUPPLEMENT-ONLY|REFERENCE-ONLY|THIRD-PARTY LICENSED TEXT|example\.org/);
    assert.match(article.attribution, /A\. Researcher, B\. Analyst/);
    assert.match(article.attribution, /10\.1371\/journal\.pone\.0353239/);
    assert.match(article.attribution, /CC BY 4\.0/);
    assert.match(article.attribution, /excluded/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
