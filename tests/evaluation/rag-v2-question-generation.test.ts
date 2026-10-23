import assert from "node:assert/strict";
import test from "node:test";
import type { StoredEvidenceDocument } from "../../src/knowledge/evidence-catalog.js";
import type { KnowledgeEvidence } from "../../src/knowledge/evidence.js";
import type { KnowledgeEvidenceSource } from "../../src/knowledge/evidence-schemas.js";
import { generateRagV2QuestionPack, type RagV2QuestionGenerator } from "../../src/evaluation/rag-v2-question-generation.js";

const source: KnowledgeEvidenceSource = {
  id: "question-generation-source",
  name: "Question generation source",
  publisher: "Example publisher",
  rightsUrl: "https://example.test/terms",
  license: "CC BY 4.0",
  allowedCorpora: ["methodology", "player_report"],
  allowedUrlPrefixes: ["https://journals.plos.org/"],
  rights: { automatedFetch: false, persistentStorage: true, aiProcessing: true, display: true },
  rightsVerifiedAt: "2026-10-22",
  rightsNote: "Fixture source.",
  allowedModelDestinations: ["configured_chat_gateway"],
};

const sourceText = "The midfielder delays pressure before the pass and checks the central lane. This passage describes an observable action in a bounded match sample.";

function documents(sectionCount: number, sourceCount = 6): StoredEvidenceDocument[] {
  return Array.from({ length: sourceCount }, (_, documentIndex) => {
    const sectionSlice = Math.ceil(sectionCount / sourceCount);
    const start = documentIndex * sectionSlice;
    const count = Math.max(0, Math.min(sectionSlice, sectionCount - start));
    return {
      revisionId: String(documentIndex + 1).repeat(64),
      logicalId: "logical-" + documentIndex,
      sourceId: source.id,
      corpus: "methodology",
      title: "Study " + documentIndex,
      url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.00000" + (documentIndex + 1),
      author: "A. Researcher",
      publisher: source.publisher,
      publishedAt: null,
      license: source.license,
      attribution: "Attribution.",
      entityIds: [],
      entityNames: [],
      competition: null,
      season: null,
      observedFrom: null,
      observedTo: null,
      sampleSummary: null,
      evidenceType: "methodology",
      normalizationVersion: "plos-jats-v1",
      contentHash: "c".repeat(64),
      content: Array.from({ length: count }, () => sourceText).join("\n\n"),
      sections: Array.from({ length: count }, (_, sectionIndex) => ({
        id: "s-" + documentIndex + "-" + sectionIndex,
        heading: "Section " + sectionIndex,
        kind: "paragraph" as const,
        text: sourceText + " Marker "
          + String.fromCharCode(97 + Math.floor((start + sectionIndex) / 676))
          + String.fromCharCode(97 + Math.floor((start + sectionIndex) / 26) % 26)
          + String.fromCharCode(97 + ((start + sectionIndex) % 26))
          + " identifies this independent paragraph.",
        locator: "body/p[" + sectionIndex + "]",
      })),
    };
  });
}

function playerReportDocument(): StoredEvidenceDocument {
  return {
    ...documents(1, 1)[0]!,
    logicalId: "player-report-logical",
    corpus: "player_report",
    title: "Study 6 Historical Player Report",
    entityIds: ["Q11571"],
    entityNames: ["Cristiano Ronaldo"],
    evidenceType: "historical_player_analysis",
    sections: [{ id: "player-report", heading: "Historical observations", kind: "paragraph", text: sourceText + " Cristiano Ronaldo was named in the study.", locator: "body/p[1]" }],
  };
}

function systemFixture(input: { documents: StoredEvidenceDocument[]; source?: KnowledgeEvidenceSource }) {
  const docList = input.documents;
  const policy = input.source ?? source;
  return {
    admin: {
      async listActiveDocuments() { return docList; },
      async status() {
        return { evidenceSnapshotHash: "a".repeat(64), activeSources: 1, activeDocuments: docList.length, generationId: "generation", embeddingModelId: "e5", indexedChunks: 100, runtimeReady: true };
      },
      async sourceHistory() {
        return [{ revision: 1, status: "active" as const, source: policy, changedAt: "2026-10-22T00:00:00.000Z" }];
      },
    },
  } as unknown as KnowledgeEvidence;
}

function fakeGenerator(calls: { generated: number; verified: number }): RagV2QuestionGenerator {
  return {
    modelId: "configured-gateway-model",
    async generate(input) {
      calls.generated += 1;
      const marker = input.passageText.match(/marker\s+(\w+)/iu)?.[1] ?? input.title;
      const markerCode = [...marker].reduce((value, character) => value * 26 + character.charCodeAt(0), 0);
      const uniqueTerms = `tag ${markerCode} sample ${markerCode + 1_000} trial ${markerCode + 2_000}`;
      return {
        questions: [
          {
            query: `According to ${input.title}, what action does marker ${marker} describe? ${uniqueTerms}`,
            expectedDisposition: "answerable",
            facts: [{ statement: input.passageText, supportPaths: [[{ quote: input.passageText }]] }],
            abstentionBasis: [],
          },
          {
            query: `In ${input.title}, what movement occurs at marker ${marker}, and what match event is dated ${input.unsupportedDate}? ${uniqueTerms}`,
            expectedDisposition: "partial",
            facts: [{ statement: input.passageText, supportPaths: [[{ quote: input.passageText }]] }],
            abstentionBasis: ["No eligible document in the frozen corpus reports a match event on this exact date."],
          },
          {
            query: `What match event does ${input.title} report for marker ${marker} on ${input.unsupportedDate}? ${uniqueTerms}`,
            expectedDisposition: "abstain",
            facts: [],
            abstentionBasis: ["No eligible document in the frozen corpus reports an event on this exact date."],
          },
        ],
      };
    },
    async verifyBatch(input) {
      calls.verified += 1;
      return input.questions.map((question) => {
        const supported = question.expectedDisposition === "partial"
            ? question.facts.length > 0 && question.facts.every(({ supportPaths }) => supportPaths.length > 0) && !input.passageText.includes(input.questions[1]?.query.match(/20\d{2}-\d{2}-\d{2}/u)?.[0] ?? "")
          : question.expectedDisposition === "abstain"
            ? question.facts.length === 0 && !input.passageText.includes(input.questions[2]?.query.match(/20\d{2}-\d{2}-\d{2}/u)?.[0] ?? "")
            : question.facts.length > 0 && question.facts.every(({ supportPaths }) => supportPaths.length > 0);
        return { passed: supported, supportCorrect: supported, scopeCorrect: true, rationale: "The proposed label matches the exact passage." };
      });
    },
  };
}

test("question generation freezes separately checked source-span questions into fact-group splits", async () => {
  const calls = { generated: 0, verified: 0 };
  const result = await generateRagV2QuestionPack({
    evidence: systemFixture({ documents: [...documents(50), playerReportDocument()] }),
    generator: fakeGenerator(calls),
    now: () => new Date("2026-10-22T00:00:00.000Z"),
  });
  assert.equal(result.status, "ready", result.reason ?? "");
  assert.equal(result.candidateSectionCount, 51);
  assert.equal(result.selectedSectionCount, 43);
  assert.equal(result.verifiedQuestionCount, 130);
  assert.equal(calls.generated, 43);
  assert.equal(calls.verified, 43);
  assert.equal(result.validation?.factGroupCount, 42);
  assert.equal(result.validation?.articleCount, 6);
  assert.equal(result.pack?.generationManifest.actualGatewayAttempts, 86);
  assert.equal(result.pack?.generationManifest.corpusWideAbsentDateCount, 43);
  assert.equal(result.pack?.generationManifest.programmaticCrossSourceQuestionCount, 1);
  assert.equal(result.pack?.generationManifest.programmaticQuestionCount, 44);
  assert.equal(result.pack?.generationManifest.seededQuestionCount, 0);
  assert.ok(result.pack?.questions.some(({ corpus }) => corpus === "player_report"));
  assert.ok(result.pack?.questions.some(({ sourceArticleIds }) => sourceArticleIds.length === 2));
  assert.ok(result.pack?.questions.every(({ indexable }) => indexable === false));
  for (const question of result.pack?.questions ?? []) {
    assert.equal(question.split, result.pack?.questions.find((other) => other.factGroupId === question.factGroupId)?.split);
    if (question.expectedDisposition === "partial") assert.ok((question.scopeEvidence[0]?.endOffset ?? 0) > sourceText.length);
  }
});

test("question generation makes model questions self-contained without discarding supported evidence", async () => {
  const calls = { generated: 0, verified: 0 };
  const base = fakeGenerator(calls);
  const generator: RagV2QuestionGenerator = {
    ...base,
    async generate(input) {
      const batch = await base.generate(input);
      const marker = input.passageText.match(/marker\s+(\w+)/iu)?.[1] ?? "unknown";
      return {
        questions: batch.questions.map((question, index) => ({
          ...question,
          query: index === 0
            ? `What action does this passage describe for marker ${marker}?`
            : index === 1
              ? `What movement does the passage describe for marker ${marker}, and what match event occurred on ${input.unsupportedDate}?`
              : `What match event occurred for marker ${marker} on ${input.unsupportedDate}?`,
        })),
      };
    },
  };
  const result = await generateRagV2QuestionPack({
    evidence: systemFixture({ documents: [...documents(50), playerReportDocument()] }),
    generator,
    now: () => new Date("2026-10-22T00:00:00.000Z"),
  });

  assert.equal(result.verifiedQuestionCount, 130, result.reason ?? "");
  assert.ok(result.pack);
  assert.ok(result.pack?.questions.every(({ query, expectedDisposition, corpusWideAbsentDate }) => {
    assert.match(query, /Study \d/u);
    assert.doesNotMatch(query, /\b(?:this|the|supplied) passage\b|(?:本段|此段|这段|该段)/iu);
    if (expectedDisposition === "answerable") return corpusWideAbsentDate === null;
    return Boolean(corpusWideAbsentDate && query.includes(corpusWideAbsentDate));
  }));
});

test("question generation reuses same-snapshot same-model verified seeds for short source documents", async () => {
  const docs = [...documents(50), playerReportDocument()];
  const initialCalls = { generated: 0, verified: 0 };
  const initial = await generateRagV2QuestionPack({
    evidence: systemFixture({ documents: docs }),
    generator: fakeGenerator(initialCalls),
    now: () => new Date("2026-10-22T00:00:00.000Z"),
  });
  assert.equal(initial.status, "ready", initial.reason ?? "");
  const replayCalls = { generated: 0, verified: 0 };
  const replay = await generateRagV2QuestionPack({
    evidence: systemFixture({ documents: docs }),
    generator: fakeGenerator(replayCalls),
    seedPacket: { sourceSnapshotHash: initial.pack!.sourceSnapshotHash, questions: initial.pack!.questions },
    now: () => new Date("2026-10-22T00:00:01.000Z"),
  });

  assert.equal(replay.status, "ready", replay.reason ?? "");
  assert.ok((replay.pack?.generationManifest.seededQuestionCount ?? 0) > 0);
  assert.ok(replayCalls.generated < replay.selectedSectionCount);
  assert.ok(replay.pack?.questions.some(({ corpus }) => corpus === "player_report"));
});

test("whole-packet seed migration preserves the verified methodology split and generates the missing player-report corpus", async () => {
  const docs = [...documents(50), playerReportDocument()];
  const initialCalls = { generated: 0, verified: 0 };
  const initial = await generateRagV2QuestionPack({
    evidence: systemFixture({ documents: docs }),
    generator: fakeGenerator(initialCalls),
    now: () => new Date("2026-10-22T00:00:00.000Z"),
  });
  assert.equal(initial.status, "ready", initial.reason ?? "");
  const methodologySeeds = initial.pack!.questions.filter(({ corpus, provenance }) => corpus === "methodology" && provenance.label === "synthetic_ai_checked");
  const replayCalls = { generated: 0, verified: 0 };
  const replay = await generateRagV2QuestionPack({
    evidence: systemFixture({ documents: docs }),
    generator: fakeGenerator(replayCalls),
    seedPacket: { sourceSnapshotHash: initial.pack!.sourceSnapshotHash, questions: methodologySeeds },
    importAllSeedQuestions: true,
    now: () => new Date("2026-10-22T00:00:01.000Z"),
  });

  assert.equal(replay.status, "ready", replay.reason ?? "");
  assert.equal(replay.selectedSectionCount, 1);
  assert.equal(replay.actualGatewayAttempts, 2);
  assert.equal(replayCalls.generated, 1);
  assert.equal(replay.pack?.generationManifest.seededQuestionCount, methodologySeeds.length);
  assert.ok(replay.pack?.questions.some(({ corpus }) => corpus === "player_report"));
});

test("question generation respects source model-destination policy before sending text to the gateway", async () => {
  const calls = { generated: 0, verified: 0 };
  const localOnly = { ...source, allowedModelDestinations: ["local" as const] };
  const result = await generateRagV2QuestionPack({
    evidence: systemFixture({ documents: documents(40), source: localOnly }),
    generator: fakeGenerator(calls),
  });
  assert.equal(result.status, "not_ready");
  assert.equal(calls.generated, 0);
  assert.equal(calls.verified, 0);
});

test("question generation requires the independent aiProcessing permission before sending article text", async () => {
  const calls = { generated: 0, verified: 0 };
  const policy = { ...source, rights: { ...source.rights, aiProcessing: false } };
  const result = await generateRagV2QuestionPack({
    evidence: systemFixture({ documents: documents(40), source: policy }),
    generator: fakeGenerator(calls),
  });
  assert.equal(result.status, "not_ready");
  assert.equal(calls.generated, 0);
  assert.equal(calls.verified, 0);
});

test("question generation performs call-budget preflight before any gateway dispatch", async () => {
  const calls = { generated: 0, verified: 0 };
  await assert.rejects(generateRagV2QuestionPack({
    evidence: systemFixture({ documents: documents(510) }),
    generator: fakeGenerator(calls),
    maximumGatewayCalls: 85,
  }), /未派发模型请求/u);
  assert.equal(calls.generated, 0);
  assert.equal(calls.verified, 0);
});

test("question generation stops after the first shared gateway failure and reports a safe category", async () => {
  const calls = { generated: 0, verified: 0 };
  const generator = fakeGenerator(calls);
  const failingGenerator: RagV2QuestionGenerator = {
    ...generator,
    async generate() {
      calls.generated += 1;
      throw Object.assign(new Error("private provider details"), { status: 429 });
    },
  };
  const result = await generateRagV2QuestionPack({
    evidence: systemFixture({ documents: documents(40) }),
    generator: failingGenerator,
  });

  assert.equal(result.status, "not_ready");
  assert.match(result.reason ?? "", /gateway_rate_limited/u);
  assert.doesNotMatch(result.reason ?? "", /private provider details/u);
  assert.equal(result.actualGatewayAttempts, 1);
  assert.equal(calls.generated, 1);
  assert.equal(calls.verified, 0);
});
