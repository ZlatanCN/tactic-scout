import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createKnowledgeEvidence } from "../../src/knowledge/evidence.js";
import { KnowledgeEvidenceDocumentInputSchema, type KnowledgeEvidenceDocumentInput, type KnowledgeEvidenceSource } from "../../src/knowledge/evidence-schemas.js";
import type { EvidenceReranker } from "../../src/knowledge/evidence-models.js";
import { RagAiPanelReviewSchema } from "../../src/evaluation/rag-ai-panel-review.js";
import { ragReviewQuestionSetSha256 } from "../../src/evaluation/rag-review-packet.js";

const source: KnowledgeEvidenceSource = {
  id: "evidence-test-methods",
  name: "Evidence Test Methods",
  publisher: "Test Publisher",
  rightsUrl: "https://evidence.test/terms",
  license: "CC BY 4.0",
  allowedCorpora: ["methodology"],
  allowedUrlPrefixes: ["https://evidence.test/papers/"],
  rights: { automatedFetch: false, persistentStorage: true, aiProcessing: true, display: true },
  rightsVerifiedAt: "2026-10-21",
  rightsNote: "A test source with explicit permission to store, process, and display the article.",
  allowedModelDestinations: ["local", "configured_chat_gateway"],
};

const document: KnowledgeEvidenceDocumentInput = {
  sourceId: source.id,
  corpus: "methodology",
  title: "Player Role Evidence",
  url: "https://evidence.test/papers/player-role",
  author: "A. Researcher",
  publisher: source.publisher,
  publishedAt: "2026-10-01",
  license: source.license,
  attribution: "A. Researcher, Player Role Evidence, 2026",
  entityIds: [],
  entityNames: [],
  competition: null,
  season: null,
  acquisition: "manual_import",
  content: "A player's role must be interpreted alongside the match sample and the observable evidence that supports the analysis.",
  sections: [{
    id: "section-roles",
    heading: "Player roles",
    kind: "paragraph",
    text: "A player's role must be interpreted alongside the match sample and the observable evidence that supports the analysis.",
    locator: "section-roles/paragraph-1",
  }],
};

test("player report evidence cannot be published without an addressable player identity", () => {
  const result = KnowledgeEvidenceDocumentInputSchema.safeParse({
    ...document,
    corpus: "player_report",
    evidenceType: "first_party_observation",
    entityIds: [],
    entityNames: ["Theo Example"],
  });
  assert.equal(result.success, false);
});

function fakeEmbedding() {
  return {
    modelId: "test-e5-revision-1",
    async embedMany(texts: string[]) {
      return texts.map(() => [1, 0]);
    },
  };
}

const deterministicReranker: EvidenceReranker = {
  async rerank({ candidates }) {
    return { orderedIds: candidates.map(({ id }) => id), inputTokens: null, outputTokens: null };
  },
};

test("a method passage remains exactly resolvable after the index store is reopened", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-evidence-ref-"));
  const paths = {
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
  };

  try {
    const first = createKnowledgeEvidence({ ...paths, embedder: fakeEmbedding(), reranker: deterministicReranker });
    await first.admin.registerSource(source);
    await first.admin.publishDocument(document);

    const result = await first.reader.retrieve(
      { kind: "methodology", query: "如何结合比赛样本理解球员职责？" },
      { turnId: "evidence-test-turn-0001", purpose: "recruitment", modelDestination: "configured_chat_gateway" },
    );
    assert.equal(result.status, "found");
    assert.equal(result.evidence[0]?.text, document.content);
    assert.equal(result.evidence[0]?.source.author, document.author);
    const [ref] = result.evidence.map(({ ref: evidenceRef }) => evidenceRef);
    assert.ok(ref);

    await first.close();
    const reopened = createKnowledgeEvidence({ ...paths, embedder: fakeEmbedding(), reranker: deterministicReranker });
    try {
      const beforePreparation = await reopened.reader.retrieve(
        { kind: "methodology", query: "如何结合比赛样本理解球员职责？" },
        { turnId: "evidence-test-turn-preflight", purpose: "recruitment", modelDestination: "configured_chat_gateway" },
      );
      assert.equal(beforePreparation.status, "unavailable");
      assert.equal(beforePreparation.failureCode, "model_unavailable");
      const preparation = await reopened.admin.prepareRuntime();
      assert.equal(preparation.ready, true);
      const resolved = await reopened.reader.resolve([ref], {
        turnId: "evidence-test-turn-0002",
        purpose: "recruitment",
        modelDestination: "configured_chat_gateway",
      });
      assert.equal(resolved.status, "found");
      assert.equal(resolved.evidence[0]?.text, document.content);
      assert.deepEqual(resolved.evidence[0]?.ref, ref);
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resolving a stable citation enforces a source revocation made after retrieval", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-evidence-revocation-"));
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    embedder: fakeEmbedding(),
    reranker: deterministicReranker,
  });
  try {
    await system.admin.registerSource(source);
    await system.admin.publishDocument(document);
    const access = { turnId: "evidence-revoke-turn-01", purpose: "reporting" as const, modelDestination: "configured_chat_gateway" as const };
    const retrieved = await system.reader.retrieve({ kind: "methodology", query: "理解球员职责和比赛样本" }, access);
    assert.equal(retrieved.status, "found");
    await system.admin.revokeSource(source.id);
    const resolved = await system.reader.resolve([retrieved.evidence[0]!.ref], {
      ...access,
      turnId: "evidence-revoke-turn-02",
    });
    assert.equal(resolved.status, "unavailable");
    assert.equal(resolved.failureCode, "source_revoked");
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a narrower current URL policy removes stored passages from retrieval and citation resolution", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-evidence-url-scope-"));
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    embedder: fakeEmbedding(),
    reranker: deterministicReranker,
  });
  try {
    await system.admin.registerSource(source);
    await system.admin.publishDocument(document);
    const access = { turnId: "evidence-url-scope-turn-01", purpose: "recruitment" as const, modelDestination: "configured_chat_gateway" as const };
    const retrieved = await system.reader.retrieve({ kind: "methodology", query: "球员职责和比赛样本" }, access);
    assert.equal(retrieved.status, "found");
    await system.admin.registerSource({ ...source, allowedUrlPrefixes: ["https://evidence.test/papers/revoked/"] });
    const excluded = await system.reader.retrieve({ kind: "methodology", query: "球员职责和比赛样本" }, {
      ...access,
      turnId: "evidence-url-scope-turn-02",
    });
    assert.equal(excluded.status, "no_relevant_evidence");
    const resolved = await system.reader.resolve([retrieved.evidence[0]!.ref], {
      ...access,
      turnId: "evidence-url-scope-turn-03",
    });
    assert.equal(resolved.status, "unavailable");
    assert.equal(resolved.failureCode, "source_revoked");
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a revoked source stays inactive after closing and reopening the evidence catalog", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-evidence-revoke-reopen-"));
  const paths = { catalogPath: path.join(directory, "catalog.sqlite"), indexPath: path.join(directory, "index") };
  let system = createKnowledgeEvidence({ ...paths, embedder: fakeEmbedding(), reranker: deterministicReranker });
  let evidenceRef;
  try {
    await system.admin.registerSource(source);
    await system.admin.publishDocument(document);
    const result = await system.reader.retrieve({ kind: "methodology", query: "球员职责和比赛样本" }, {
      turnId: "evidence-revoke-reopen-turn-01",
      purpose: "recruitment",
      modelDestination: "configured_chat_gateway",
    });
    assert.equal(result.status, "found");
    evidenceRef = result.evidence[0]!.ref;
    await system.admin.revokeSource(source.id);
    await system.close();

    system = createKnowledgeEvidence({ ...paths, embedder: fakeEmbedding(), reranker: deterministicReranker });
    const afterRestart = await system.reader.resolve([evidenceRef], {
      turnId: "evidence-revoke-reopen-turn-02",
      purpose: "reporting",
      modelDestination: "configured_chat_gateway",
    });
    assert.equal(afterRestart.status, "unavailable");
    assert.equal(afterRestart.failureCode, "source_revoked");
    const query = await system.reader.retrieve({ kind: "methodology", query: "球员职责和比赛样本" }, {
      turnId: "evidence-revoke-reopen-turn-03",
      purpose: "recruitment",
      modelDestination: "configured_chat_gateway",
    });
    assert.equal(query.status, "no_relevant_evidence");
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a local-only player observation is retrievable locally and excluded from the configured chat gateway", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-evidence-local-only-"));
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    embedder: fakeEmbedding(),
    reranker: deterministicReranker,
  });
  const localSource: KnowledgeEvidenceSource = {
    ...source,
    id: "tactiscout-first-party-observations",
    name: "Local player notes",
    allowedCorpora: ["player_report"],
    allowedUrlPrefixes: ["https://evidence.test/observations/"],
    allowedModelDestinations: ["local"],
  };
  const localDocument: KnowledgeEvidenceDocumentInput = {
    ...document,
    sourceId: localSource.id,
    corpus: "player_report",
    url: "https://evidence.test/observations/alex-vale",
    entityIds: ["understat:42"],
    entityNames: ["Alex Vale"],
    season: "2017/18",
    content: "The observer noted that Alex Vale checks his shoulder before receiving and turns into open space when the pressing defender closes.",
    sections: [{
      id: "observation-1",
      heading: "Observed receiving action",
      kind: "paragraph",
      text: "The observer noted that Alex Vale checks his shoulder before receiving and turns into open space when the pressing defender closes.",
      locator: "match/observation-1",
    }],
  };
  try {
    await system.admin.registerSource(localSource);
    await system.admin.publishDocument(localDocument);
    const local = await system.reader.retrieve({
      kind: "player_report",
      query: "receiving under pressure",
      subjects: [{ subjectId: "understat:42", displayName: "Alex Vale" }],
    }, { turnId: "evidence-local-turn-01", purpose: "reporting", modelDestination: "local" });
    assert.equal(local.status, "found");
    assert.equal(local.evidence[0]?.source.sourceType, "first_party_observation");
    const outOfRange = await system.reader.retrieve({
      kind: "player_report",
      query: "receiving under pressure",
      subjects: [{ subjectId: "understat:42", displayName: "Alex Vale" }],
      sampleSeasons: ["2020/21"],
    }, { turnId: "evidence-local-turn-outside-sample", purpose: "reporting", modelDestination: "local" });
    assert.equal(outOfRange.status, "no_relevant_evidence");
    assert.equal(outOfRange.subjectCoverage[0]?.status, "no_relevant_evidence");
    const remote = await system.reader.retrieve({
      kind: "player_report",
      query: "receiving under pressure",
      subjects: [{ subjectId: "understat:42", displayName: "Alex Vale" }],
    }, { turnId: "evidence-local-turn-02", purpose: "reporting", modelDestination: "configured_chat_gateway" });
    assert.equal(remote.status, "not_covered");
    assert.equal(remote.evidence.length, 0);
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a malformed gateway ranking fails closed and the same turn never sends a second rerank", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-evidence-rerank-"));
  let rerankCalls = 0;
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    embedder: fakeEmbedding(),
    reranker: {
      async rerank({ candidates }) {
        rerankCalls += 1;
        return { orderedIds: candidates.slice(1).map(({ id }) => id), inputTokens: 100, outputTokens: 20 };
      },
    },
  });
  try {
    await system.admin.registerSource(source);
    await system.admin.publishDocument(document);
    const access = { turnId: "evidence-rerank-turn-01", purpose: "recruitment" as const, modelDestination: "configured_chat_gateway" as const };
    const first = await system.reader.retrieve({ kind: "methodology", query: "结合比赛样本理解球员职责" }, access);
    assert.equal(first.status, "unavailable");
    assert.equal(first.failureCode, "model_unavailable");
    const retried = await system.reader.retrieve({ kind: "methodology", query: "another query for the same turn" }, access);
    assert.equal(retried.status, "unavailable");
    assert.equal(rerankCalls, 1);
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a valid gateway relevance label can reject every weak candidate without returning it as evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-evidence-low-rerank-"));
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    embedder: fakeEmbedding(),
    reranker: {
      async rerank({ candidates }) {
        return {
          orderedIds: candidates.map(({ id }) => id),
          lowRelevanceIds: candidates.map(({ id }) => id),
          inputTokens: 100,
          outputTokens: 20,
        };
      },
    },
  });
  try {
    await system.admin.registerSource(source);
    await system.admin.publishDocument(document);
    const result = await system.reader.retrieve({ kind: "methodology", query: "球员职责与比赛样本" }, {
      turnId: "evidence-low-rerank-turn-01",
      purpose: "recruitment",
      modelDestination: "configured_chat_gateway",
    });
    assert.equal(result.status, "no_relevant_evidence");
    assert.equal(result.rankingMode, "gateway_reranked");
    assert.equal(result.evidence.length, 0);
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("gateway failure falls back only when a matching human-reviewed baseline acceptance record exists", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-evidence-baseline-gate-"));
  const acceptancePath = path.join(directory, "baseline-acceptance.json");
  const registryPath = fileURLToPath(new URL("../../data/knowledge/sources.json", import.meta.url));
  const reviewPacketPath = fileURLToPath(new URL("../../data/knowledge/evaluation/rag-review-packet.v1.json", import.meta.url));
  const reviewPacket = JSON.parse(await readFile(reviewPacketPath, "utf8")) as {
    packetId: string;
    status: string;
    questions: Array<{ review: Record<string, unknown> }>;
  };
  const completedReviewPacketPath = path.join(directory, "review-packet.json");
  await writeFile(completedReviewPacketPath, JSON.stringify({
    ...reviewPacket,
    status: "review_complete",
    questions: reviewPacket.questions.map((question) => ({
      ...question,
      review: { answerSupported: true, citationAccurate: true, abstentionAppropriate: true, reviewerNotes: null, reviewedAt: "2026-10-21", evaluationRunId: "hybrid-baseline-run-001", evaluationRunSha256: "c".repeat(64), rankingMode: "hybrid" },
    })),
  }));
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    registryPath,
    baselineAcceptancePath: acceptancePath,
    reviewPacketPath: completedReviewPacketPath,
    embedder: fakeEmbedding(),
    reranker: { async rerank() { throw new Error("gateway offline"); } },
  });
  try {
    await system.admin.registerSource(source);
    await system.admin.publishDocument(document);
    const status = await system.admin.status();
    await writeFile(acceptancePath, JSON.stringify({
      status: "accepted",
      reviewMode: "human",
      eligibleForProductionFallback: true,
      corpusPolicyVersion: "dual-evidence-v1",
      baselineId: "lancedb-icu-vector-rrf-v1",
      fullTextTokenizer: "icu",
      fusion: "reciprocal_rank_fusion_k60",
      candidateLimit: 12,
      embeddingModelId: "test-e5-revision-1",
      indexGenerationId: status.generationId,
      evidenceSnapshotHash: status.evidenceSnapshotHash,
      sourceRegistrySha256: createHash("sha256").update(await readFile(registryPath)).digest("hex"),
      questionPacketSha256: createHash("sha256").update(await readFile(completedReviewPacketPath)).digest("hex"),
      reviewedQuestions: 24,
      requiredQuestions: 24,
      questionPacketId: "dual-rag-review-v1",
      evaluationRunId: "hybrid-baseline-run-001",
      evaluationRunSha256: "c".repeat(64),
    }));
    const result = await system.reader.retrieve({ kind: "methodology", query: "球员职责和比赛样本" }, {
      turnId: "evidence-baseline-gate-turn-01",
      purpose: "recruitment",
      modelDestination: "configured_chat_gateway",
    });
    assert.equal(result.status, "found");
    assert.equal(result.rankingMode, "hybrid_degraded");
    assert.ok(result.evidence.length > 0);
    await system.admin.registerSource({ ...source, rightsNote: source.rightsNote + " Updated policy revision." });
    const staleAcceptance = await system.reader.retrieve({ kind: "methodology", query: "球员职责和比赛样本" }, {
      turnId: "evidence-baseline-gate-turn-02",
      purpose: "recruitment",
      modelDestination: "configured_chat_gateway",
    });
    assert.equal(staleAcceptance.status, "unavailable");
    assert.equal(staleAcceptance.failureCode, "model_unavailable");
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unaccepted hybrid baseline can run for evaluation but stays unavailable to production requests", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-evidence-hybrid-eval-"));
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    registryPath: path.join(directory, "missing-sources.json"),
    baselineAcceptancePath: path.join(directory, "pending-acceptance.json"),
    reviewPacketPath: path.join(directory, "pending-review.json"),
    embedder: fakeEmbedding(),
    reranker: null,
    allowUnacceptedHybridEvaluation: true,
  });
  try {
    await system.admin.registerSource(source);
    await system.admin.publishDocument(document);
    const evaluationResult = await system.reader.retrieve({ kind: "methodology", query: "球员职责和比赛样本" }, {
      turnId: "evidence-hybrid-eval-turn-01",
      purpose: "evaluation",
      modelDestination: "configured_chat_gateway",
    });
    assert.equal(evaluationResult.status, "found");
    assert.equal(evaluationResult.rankingMode, "hybrid");

    const productionResult = await system.reader.retrieve({ kind: "methodology", query: "球员职责和比赛样本" }, {
      turnId: "evidence-hybrid-prod-turn-01",
      purpose: "recruitment",
      modelDestination: "configured_chat_gateway",
    });
    assert.equal(productionResult.status, "unavailable");
    assert.equal(productionResult.failureCode, "model_unavailable");
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an accepted AI panel review can authorize hybrid fallback only when its run and corpus pins match", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-evidence-ai-panel-gate-"));
  const acceptancePath = path.join(directory, "baseline-acceptance.json");
  const panelPath = path.join(directory, "ai-panel-review.json");
  const registryPath = path.join(directory, "sources.json");
  const reviewPacketPath = fileURLToPath(new URL("../../data/knowledge/evaluation/rag-review-packet.v1.json", import.meta.url));
  const packetText = await readFile(reviewPacketPath, "utf8");
  const packet = JSON.parse(packetText) as { packetId: string; questions: Array<{ id: string }> };
  const registryText = `${JSON.stringify([source])}\n`;
  await writeFile(registryPath, registryText);
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    registryPath,
    baselineAcceptancePath: acceptancePath,
    reviewPacketPath,
    aiPanelReviewPath: panelPath,
    embedder: fakeEmbedding(),
    reranker: { async rerank() { throw new Error("gateway offline"); } },
  });
  try {
    await system.admin.registerSource(source);
    await system.admin.publishDocument(document);
    const status = await system.admin.status();
    const reviewers = ["panel-a", "panel-b", "panel-c"].map((id) => ({
      id,
      kind: "ai_subagent" as const,
      isolatedContext: true as const,
      initialRoundBlind: true as const,
      sawExpectedAnswerOutline: false as const,
      sawAnonymizedPeerRationalesInDiscussion: true as const,
    }));
    const vote = (reviewerId: string) => ({
      reviewerId,
      answerSupported: "yes" as const,
      citationAccurate: "yes" as const,
      abstentionAppropriate: "yes" as const,
      rationale: "Verified against the supplied passage and stable reference.",
    });
    const panel = RagAiPanelReviewSchema.parse({
      schemaVersion: "rag-ai-panel-review-v1",
      reviewMode: "blind_ai_panel",
      createdAt: "2026-10-22T00:00:00.000Z",
      reviewers,
      discussionRoundComplete: true,
      packet: {
        packetId: packet.packetId,
        sha256: createHash("sha256").update(packetText).digest("hex"),
        questionSetSha256: ragReviewQuestionSetSha256(packet),
        questionCount: packet.questions.length,
        completeQuestionSet: true,
      },
      sourceRegistrySha256: createHash("sha256").update(registryText).digest("hex"),
      evaluation: {
        runId: "ai-panel-baseline-run-001",
        runSha256: "d".repeat(64),
        rankingMode: "hybrid",
        generationId: status.generationId,
        evidenceSnapshotHash: status.evidenceSnapshotHash,
        embeddingModelId: "test-e5-revision-1",
      },
      questions: packet.questions.map(({ id }) => ({
        questionId: id,
        initialReviews: reviewers.map(({ id }) => vote(id)),
        finalReviews: reviewers.map(({ id }) => vote(id)),
        consensus: {
          answerSupported: "yes",
          citationAccurate: "yes",
          abstentionAppropriate: "yes",
          outcome: "pass",
          rationale: "All three reviewers agreed after discussion.",
        },
      })),
      panelDecision: "accepted",
      decisionRationale: "All 24 questions passed all three criteria in the complete panel review.",
    });
    const panelText = `${JSON.stringify(panel, null, 2)}\n`;
    await writeFile(panelPath, panelText);
    await writeFile(acceptancePath, JSON.stringify({
      status: "accepted",
      reviewMode: "ai_panel",
      eligibleForProductionFallback: true,
      corpusPolicyVersion: "dual-evidence-v1",
      baselineId: "lancedb-icu-vector-rrf-v1",
      fullTextTokenizer: "icu",
      fusion: "reciprocal_rank_fusion_k60",
      candidateLimit: 12,
      embeddingModelId: "test-e5-revision-1",
      indexGenerationId: status.generationId,
      evidenceSnapshotHash: status.evidenceSnapshotHash,
      sourceRegistrySha256: createHash("sha256").update(registryText).digest("hex"),
      questionPacketSha256: createHash("sha256").update(packetText).digest("hex"),
      aiPanelReviewSha256: createHash("sha256").update(panelText).digest("hex"),
      reviewedQuestions: 24,
      requiredQuestions: 24,
      questionPacketId: packet.packetId,
      evaluationRunId: "ai-panel-baseline-run-001",
      evaluationRunSha256: "d".repeat(64),
    }));

    const result = await system.reader.retrieve({ kind: "methodology", query: "球员职责和比赛样本" }, {
      turnId: "evidence-ai-panel-gate-turn-01",
      purpose: "recruitment",
      modelDestination: "configured_chat_gateway",
    });
    assert.equal(result.status, "found");
    assert.equal(result.rankingMode, "hybrid_degraded");
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared turn budget returns while local embedding continues and spends the remaining budget", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-evidence-budget-"));
  let delayEmbedding = false;
  let queryEmbeddingCalls = 0;
  const system = createKnowledgeEvidence({
    catalogPath: path.join(directory, "catalog.sqlite"),
    indexPath: path.join(directory, "index"),
    reranker: deterministicReranker,
    budgetMs: 25,
    embedder: {
      modelId: "test-e5-revision-1",
      async embedMany(texts, kind) {
        if (kind === "query") {
          queryEmbeddingCalls += 1;
          if (delayEmbedding) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return texts.map(() => [1, 0]);
      },
    },
  });
  try {
    await system.admin.registerSource(source);
    await system.admin.publishDocument(document);
    delayEmbedding = true;
    const started = performance.now();
    const result = await system.reader.retrieve({ kind: "methodology", query: "理解球员职责" }, {
      turnId: "evidence-budget-turn-01",
      purpose: "recruitment",
      modelDestination: "configured_chat_gateway",
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.failureCode, "budget_exhausted");
    assert.ok(performance.now() - started < 80);
    assert.equal(result.budgetMsRemaining, 0);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const retried = await system.reader.retrieve({ kind: "methodology", query: "another query" }, {
      turnId: "evidence-budget-turn-01",
      purpose: "recruitment",
      modelDestination: "configured_chat_gateway",
    });
    assert.equal(retried.failureCode, "budget_exhausted");
    assert.equal(queryEmbeddingCalls, 1);
  } finally {
    await system.close();
    await rm(directory, { recursive: true, force: true });
  }
});
