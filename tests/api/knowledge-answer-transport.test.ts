import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../../src/app.js";
import { ConversationTurnResponseSchema } from "../../src/domain/conversation.js";
import type { RecruitmentConversation } from "../../src/recruitment/conversation.js";
import type { KnowledgeEvidence } from "../../src/knowledge/evidence.js";

function parseSseResult(body: string) {
  const data = body.split(/\r?\n/u).find((line) => line.startsWith("data: ") && line.includes('"type":"result"'));
  assert.ok(data);
  return (JSON.parse(data.slice(6)) as { response: unknown }).response;
}

test("JSON and SSE preserve a structured knowledge answer without recruitment report fields", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "knowledge-answer-transport-"));
  const knowledgeAnswer = {
    status: "answered" as const,
    claims: [{
      claimId: "claim-1",
      text: "The study used five folds.",
      evidenceIds: ["citation-1"],
      citations: [{
        id: "citation-1",
        evidenceRef: {
          documentRevisionId: "a".repeat(64),
          sectionId: "methods",
          startOffset: 0,
          endOffset: 27,
          textHash: "b".repeat(64),
        },
        excerpt: "The study used five folds.",
        source: {
          sourceId: "source-a",
          sourceName: "Study A",
          title: "Study A",
          url: "https://example.test/study-a",
          author: "Author A",
          publisher: "Journal A",
          publishedAt: null,
          license: "CC BY 4.0",
          attribution: "Author A, Study A.",
        },
      }],
    }],
    missingFacts: [],
    abstentionReason: null,
  };
  const conversation: RecruitmentConversation = {
    async turn(input) {
      return ConversationTurnResponseSchema.parse({
        threadId: input.threadId,
        status: "completed",
        message: "已依据资料回答。",
        question: null,
        report: null,
        knowledgeAnswer,
      });
    },
  };
  const knowledgeEvidence = {
    admin: { async status() { return { generationId: null }; } },
    async close() {},
  } as unknown as KnowledgeEvidence;
  const app = createApp({
    recruitmentConversation: conversation,
    knowledgeEvidence,
    checkpointPath: path.join(directory, "checkpoints.sqlite"),
    preferenceStorePath: path.join(directory, "preferences.sqlite"),
    playerObservationsPath: path.join(directory, "observations.sqlite"),
  });
  const caseId = "knowledge-answer-transport-case";
  const payload = { requestId: "cae14f56-13a8-4a1f-8cb0-05a07b5c8002", message: "The study used how many folds?" };
  try {
    const json = await app.inject({ method: "POST", url: "/api/v1/recruitment/cases/" + caseId + "/turns", payload });
    const sse = await app.inject({ method: "POST", url: "/api/v1/recruitment/cases/" + caseId + "/turns/stream", payload });
    assert.equal(json.statusCode, 200);
    assert.equal(sse.statusCode, 200);
    const jsonBody = json.json() as { report: unknown; knowledgeAnswer: unknown };
    const sseBody = parseSseResult(sse.body) as { report: unknown; knowledgeAnswer: unknown };
    assert.deepEqual(sseBody, jsonBody);
    assert.equal(jsonBody.report, null);
    assert.deepEqual(jsonBody.knowledgeAnswer, knowledgeAnswer);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
