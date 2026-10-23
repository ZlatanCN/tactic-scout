import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { RecruitmentConversation } from "../../src/recruitment/conversation.js";
import { createApp } from "../../src/app.js";
import { RecruitmentReportSchema } from "../../src/domain/reports.js";
import type { KnowledgeEvidence } from "../../src/knowledge/evidence.js";

function reportWithTwoExactMethodCitations() {
  return RecruitmentReportSchema.parse({
    targetTeam: null,
    needSummary: "Source-grounded methodology synthesis.",
    capabilityProfile: [],
    evidenceCoverage: {
      evaluatedCandidateCount: 0,
      availableMetricValues: 0,
      expectedMetricValues: 0,
      lowSampleCandidates: 0,
      limitedPeerGroupCandidates: 0,
    },
    searchScopes: [],
    recommendations: [],
    limitations: [],
    dataSource: "Fixture",
    datasetMode: "demo",
    methodologyClaims: [{
      claimId: "claim-001",
      claimType: "cross_source_synthesis",
      summary: "Both methods emphasize explaining observable movement in match context.",
      limitations: ["The sources do not establish a player-specific current-season fact."],
      citations: [
        {
          documentId: "revision-a",
          evidenceRef: { documentRevisionId: "a".repeat(64), sectionId: "sec-a", startOffset: 0, endOffset: 14, textHash: "b".repeat(64) },
          excerpt: "Movement in context.",
          sectionPath: ["Study A", "Methods"],
          source: { sourceId: "source-a", sourceName: "Source A", title: "Study A", url: "https://example.test/a", author: "Author A", publisher: "Journal A", publishedAt: null, license: "CC BY 4.0", attribution: "Author A, Study A." },
        },
        {
          documentId: "revision-b",
          evidenceRef: { documentRevisionId: "c".repeat(64), sectionId: "sec-b", startOffset: 18, endOffset: 35, textHash: "d".repeat(64) },
          excerpt: "Movement within sample.",
          sectionPath: ["Study B", "Discussion"],
          source: { sourceId: "source-b", sourceName: "Source B", title: "Study B", url: "https://example.test/b", author: "Author B", publisher: "Journal B", publishedAt: null, license: "CC BY 4.0", attribution: "Author B, Study B." },
        },
      ],
    }],
  });
}

function parseSseResult(body: string) {
  const data = body.split(/\r?\n/u).find((line) => line.startsWith("data: ") && line.includes('"type":"result"'));
  assert.ok(data);
  const event = JSON.parse(data.slice(6)) as { response: unknown };
  return event.response;
}

test("the ordinary recruitment JSON and SSE transports preserve every methodology citation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rag-v2-report-transport-"));
  const report = reportWithTwoExactMethodCitations();
  const conversation: RecruitmentConversation = {
    async turn(input) {
      return {
        threadId: input.threadId,
        status: "completed",
        message: "本轮调查已完成。",
        question: null,
        report,
      };
    },
  };
  const knowledgeEvidence = {
    admin: {
      async status() { return { generationId: null }; },
    },
    async close() {},
  } as unknown as KnowledgeEvidence;
  const app = createApp({
    recruitmentConversation: conversation,
    knowledgeEvidence,
    checkpointPath: path.join(directory, "checkpoints.sqlite"),
    preferenceStorePath: path.join(directory, "preferences.sqlite"),
    playerObservationsPath: path.join(directory, "observations.sqlite"),
  });
  const caseId = "rag-v2-report-transport-case";
  const payload = { requestId: "cae14f56-13a8-4a1f-8cb0-05a07b5c8001", message: "完成一轮有来源依据的调查。" };
  try {
    const json = await app.inject({ method: "POST", url: "/api/v1/recruitment/cases/" + caseId + "/turns", payload });
    const sse = await app.inject({ method: "POST", url: "/api/v1/recruitment/cases/" + caseId + "/turns/stream", payload });
    assert.equal(json.statusCode, 200);
    assert.equal(sse.statusCode, 200);
    const jsonBody = json.json() as { report: ReturnType<typeof reportWithTwoExactMethodCitations> };
    const sseBody = parseSseResult(sse.body) as { report: ReturnType<typeof reportWithTwoExactMethodCitations> };
    assert.deepEqual(sseBody, jsonBody);
    assert.equal(jsonBody.report.methodologyClaims[0]?.citations.length, 2);
    assert.deepEqual(jsonBody.report.methodologyClaims[0]?.citations.map(({ evidenceRef }) => evidenceRef.documentRevisionId), ["a".repeat(64), "c".repeat(64)]);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
