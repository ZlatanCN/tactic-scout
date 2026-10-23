import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../../src/app.js";
import { EvidenceInvestigationLedger } from "../../src/knowledge/evidence-investigation-ledger.js";
import { createRecruitmentConversation, type RecruitmentAction, type RecruitmentPlanner } from "../../src/recruitment/conversation.js";
import type { KnowledgeEvidence } from "../../src/knowledge/evidence.js";
import type { RecruitmentTraceEvent } from "../../src/recruitment/conversation/contracts.js";

const passage = "The study used five folds.";
const ref = {
  documentRevisionId: "a".repeat(64),
  sectionId: "methods",
  startOffset: 0,
  endOffset: passage.length,
  textHash: "b".repeat(64),
};
const evidenceId = createHash("sha256").update(JSON.stringify(ref)).digest("hex");

function parseSseResult(body: string) {
  const data = body.split(/\r?\n/u).find((line) => line.startsWith("data: ") && line.includes('"type":"result"'));
  assert.ok(data);
  return (JSON.parse(data.slice(6)) as { response: unknown }).response;
}

function item() {
  return {
    ref,
    text: passage,
    rank: 1,
    rankMode: "hybrid" as const,
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
      corpus: "methodology" as const,
      displayAllowed: true,
      sourceType: "methodology" as const,
      subjects: [],
      competition: null,
      season: null,
      observedFrom: null,
      observedTo: null,
      sampleSummary: null,
      sectionPath: ["Methods"],
    },
  };
}

test("a knowledge Q&A turn retrieves, answers with exact claim citations, and bypasses recruitment report projection", async () => {
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "How many folds?", additionalQueries: [], limit: 4 },
    {
      action: "finish",
      targetTeam: null,
      needSummary: "回答已完成。",
      capabilityProfile: [],
      recommendations: [],
      limitationKeys: [],
      methodologyClaims: [{
        evidenceIds: [evidenceId],
        claimType: "source_finding",
        summary: passage,
        limitations: [],
      }],
    },
  ];
  const planner: RecruitmentPlanner = {
    requiresGatewayDispatch() { return true; },
    requiresGatewayDispatch(input) {
      return !(input.decisionSnapshot.caps.stage === "investigate"
        && input.history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology"));
    },
    isFinalSynthesis() { return true; },
    async decide(input) {
      const next = actions.shift();
      assert.ok(next, `the knowledge graph must finish after one bounded retrieval round; received ${JSON.stringify(input.history)}`);
      return next;
    },
  };
  const knowledgeEvidence = {
    reader: {
      async retrieve() {
        return {
          status: "found",
          evidence: [item()],
          subjectCoverage: [],
          generationId: "generation-a",
          traceId: "00000000-0000-4000-8000-000000000001",
          failureCode: null,
          rankingMode: "hybrid",
          rankingDurationMs: 1,
          rankingInputTokens: null,
          rankingOutputTokens: null,
          rankingGatewayAttempts: 0,
          candidateCount: 1,
          budgetMsUsed: 1,
          budgetMsRemaining: 29_999,
          subqueryCount: 1,
          unavailableSubqueryCount: 0,
          zeroHitSubqueryCount: 0,
          notCoveredSubqueryCount: 0,
          blockedSubqueryCount: 0,
        };
      },
      async resolve() { return { status: "found", evidence: [item()], subjectCoverage: [] }; },
      async retrieveBatch(requests: unknown[]) {
        assert.equal(requests.length, 1);
        const result = {
          status: "found" as const,
          evidence: [item()],
          subjectCoverage: [],
          generationId: "generation-a",
          traceId: "00000000-0000-4000-8000-000000000001",
          failureCode: null,
          rankingMode: "hybrid" as const,
          rankingDurationMs: 1,
          rankingInputTokens: null,
          rankingOutputTokens: null,
          rankingGatewayAttempts: 0,
          candidateCount: 1,
          budgetMsUsed: 1,
          budgetMsRemaining: 29_999,
          subqueryCount: 1,
          unavailableSubqueryCount: 0,
          zeroHitSubqueryCount: 0,
          notCoveredSubqueryCount: 0,
          blockedSubqueryCount: 0,
        };
        return {
          result,
          queryResults: [result],
        };
      },
    },
    investigations: {
      begin() {},
      finish() {},
      reserveQuery() { return { kind: "reserved", investigationId: "investigation-a", requestHash: "query-a", round: 1, remainingMs: 30_000, remainingGatewayAttempts: 4 }; },
      completeQuery() {},
      failQuery() {},
      markQueryUnknown() {},
      markFollowupStarted() { return false; },
      hasPendingQueries() { return false; },
      snapshot() { return { status: "active", round: 1, initialQueryCount: 0, followupQueryCount: 0, remainingMs: 30_000 }; },
      reserveGatewayAttempt() { return { kind: "reserved", remainingMs: 30_000 }; },
    },
  } as unknown as KnowledgeEvidence;
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "knowledge graph fixture",
      async loadPlayers() { return []; },
    },
    planner,
    knowledgeEvidence,
    evaluationEvidenceScope: () => ({
      corpus: "methodology",
      query: "How many folds?",
      subjects: [],
      sampleSeasons: [],
      knowledgeQa: true,
    }),
  });

  const progressMessages: string[] = [];
  const result = await conversation.turn({
    threadId: "knowledge-qa-graph",
    message: "How many folds?",
    onProgress: (progress) => progressMessages.push(progress.message),
  });

  assert.equal(result.status, "completed");
  assert.equal(result.report, null);
  assert.equal(result.knowledgeAnswer?.status, "answered");
  assert.equal(result.knowledgeAnswer?.claims[0]?.citations[0]?.id, evidenceId);
  assert.doesNotMatch(JSON.stringify(result), /目标画像|候选推荐|Understat/iu);
  assert.ok(progressMessages.some((message) => /原文引用/u.test(message)));
  assert.doesNotMatch(progressMessages.join("\n"), /推荐|候选|球探|Understat/iu);
});

test("a bounded knowledge investigation performs one follow-up, preserves multi-source citations, and emits independent timing", async () => {
  const secondPassage = "The study also reports a separate validation cohort.";
  const secondRef = {
    documentRevisionId: "c".repeat(64),
    sectionId: "discussion",
    startOffset: 0,
    endOffset: secondPassage.length,
    textHash: "d".repeat(64),
  };
  const secondEvidenceId = createHash("sha256").update(JSON.stringify(secondRef)).digest("hex");
  const firstEvidenceId = evidenceId;
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "How many folds?", additionalQueries: ["Was there validation?"], limit: 4 },
    {
      action: "search_methodology",
      query: "Was there a separate validation cohort?",
      additionalQueries: [],
      limit: 4,
    },
    {
      action: "finish",
      targetTeam: null,
      needSummary: "The sources describe both cross-validation and a separate validation cohort.",
      capabilityProfile: [],
      recommendations: [],
      limitationKeys: [],
      methodologyClaims: [{
        evidenceIds: [firstEvidenceId, secondEvidenceId],
        claimType: "cross_source_synthesis",
        summary: "The methods include cross-validation and a separate validation cohort.",
        limitations: ["This fixture does not establish the cohort size."],
      }],
    },
  ];
  let decisionCalls = 0;
  const planner: RecruitmentPlanner = {
    requiresGatewayDispatch() { return true; },
    isFinalSynthesis() { return true; },
    async decide(input) {
      decisionCalls += 1;
      const next = actions.shift();
      assert.ok(next, `the knowledge graph must finish after its bounded follow-up; received ${JSON.stringify(input.history)}`);
      return next;
    },
  };
  const firstItem = item();
  const secondItem = {
    ...item(),
    ref: secondRef,
    text: secondPassage,
    rankMode: "full_text" as const,
    source: {
      ...item().source,
      sourceId: "source-b",
      sourceName: "Study B",
      title: "Study B",
      url: "https://example.test/study-b",
      author: "Author B",
      publisher: "Journal B",
      attribution: "Author B, Study B.",
      sectionPath: ["Discussion"],
    },
  };
  const rounds: Array<{ initial: number; followup: number }> = [];
  let queryCount = 0;
  let firstBatch = true;
  const reservations: Array<{ round: 1 | 2; requestHash: string }> = [];
  const knowledgeEvidence = {
    reader: {
      async retrieve() {
        return {
          status: "found",
          evidence: [firstItem],
          subjectCoverage: [],
          generationId: "generation-a",
          traceId: "00000000-0000-4000-8000-000000000002",
          failureCode: null,
          rankingMode: "hybrid",
          rankingDurationMs: 1,
          rankingInputTokens: null,
          rankingOutputTokens: null,
          rankingGatewayAttempts: 0,
          candidateCount: 1,
          budgetMsUsed: 1,
          budgetMsRemaining: 29_999,
          subqueryCount: 1,
          unavailableSubqueryCount: 0,
          zeroHitSubqueryCount: 0,
          notCoveredSubqueryCount: 0,
          blockedSubqueryCount: 0,
        };
      },
      async resolve(refs: Array<{ documentRevisionId: string }>) {
        const evidence = refs.map((ref) => ref.documentRevisionId === secondRef.documentRevisionId ? secondItem : firstItem);
        return { status: "found" as const, evidence, subjectCoverage: [] };
      },
      async retrieveBatch(requests: unknown[]) {
        if (firstBatch) {
          firstBatch = false;
          const initial = {
            status: "found" as const,
            evidence: [firstItem],
            subjectCoverage: [],
            generationId: "generation-a",
            traceId: "00000000-0000-4000-8000-000000000002",
            failureCode: null,
            rankingMode: "hybrid" as const,
            rankingDurationMs: 1,
            rankingInputTokens: null,
            rankingOutputTokens: null,
            rankingGatewayAttempts: 0,
            candidateCount: 1,
            budgetMsUsed: 1,
            budgetMsRemaining: 29_999,
            subqueryCount: 2,
            unavailableSubqueryCount: 1,
            zeroHitSubqueryCount: 0,
            notCoveredSubqueryCount: 0,
            blockedSubqueryCount: 0,
          };
          rounds.push({ initial: 2, followup: 0 });
          return { result: initial, queryResults: [initial, { ...initial, status: "no_relevant_evidence", evidence: [], subqueryCount: 1, unavailableSubqueryCount: 0 }] };
        }
        const followup = {
          status: "found" as const,
          evidence: [secondItem],
          subjectCoverage: [],
          generationId: "generation-a",
          traceId: "00000000-0000-4000-8000-000000000003",
          failureCode: null,
          rankingMode: "full_text" as const,
          rankingDurationMs: 1,
          rankingInputTokens: null,
          rankingOutputTokens: null,
          rankingGatewayAttempts: 0,
          candidateCount: 1,
          budgetMsUsed: 1,
          budgetMsRemaining: 28_000,
          subqueryCount: 1,
          unavailableSubqueryCount: 0,
          zeroHitSubqueryCount: 0,
          notCoveredSubqueryCount: 0,
          blockedSubqueryCount: 0,
        };
        rounds.push({ initial: 2, followup: 1 });
        return { result: followup, queryResults: [followup] };
      },
    },
    investigations: {
      begin() {},
      finish() {},
      reserveQuery(_investigationId: string, requestHash: string) {
        queryCount += 1;
        const round: 1 | 2 = queryCount <= 2 ? 1 : 2;
        reservations.push({ round, requestHash });
        const reservation = {
          kind: "reserved" as const,
          investigationId: "investigation-b",
          requestHash,
          round,
          remainingMs: 30_000,
          remainingGatewayAttempts: 4,
        };
        return reservation;
      },
      completeQuery() {},
      failQuery() {},
      markQueryUnknown() {},
      markFollowupStarted() { return false; },
      hasPendingQueries() { return false; },
      snapshot() {
        const followupStarted = reservations.some(({ round }) => round === 2);
        return {
          status: "active" as const,
          round: followupStarted ? 2 as const : 1 as const,
          initialQueryCount: Math.min(2, reservations.filter(({ round }) => round === 1).length),
          followupQueryCount: reservations.filter(({ round }) => round === 2).length,
          remainingMs: 30_000,
        };
      },
      reserveGatewayAttempt() { return { kind: "reserved" as const, remainingMs: 30_000 }; },
    },
  } as unknown as KnowledgeEvidence;
  const trace: RecruitmentTraceEvent[] = [];
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "knowledge graph fixture",
      async loadPlayers() { return []; },
    },
    planner,
    knowledgeEvidence,
    evaluationEvidenceScope: () => ({
      corpus: "methodology",
      query: "How was the study validated?",
      subjects: [],
      sampleSeasons: [],
      knowledgeQa: true,
    }),
    observer(event) { trace.push(event); },
  });

  const result = await conversation.turn({
    threadId: "knowledge-qa-bounded-followup",
    message: "How was the study validated?",
  });

  assert.equal(result.status, "completed");
  assert.equal(result.knowledgeAnswer?.status, "answered");
  assert.equal(result.knowledgeAnswer?.claims[0]?.citations.length, 2);
  assert.deepEqual(result.knowledgeAnswer?.claims[0]?.citations.map(({ source }) => source.sourceId), ["source-a", "source-b"]);
  assert.equal(decisionCalls, 3);
  assert.deepEqual(rounds, [{ initial: 2, followup: 0 }, { initial: 2, followup: 1 }]);
  const generation = trace.find((event) => event.phase === "report_generation");
  assert.ok(generation, JSON.stringify(trace));
  assert.ok(generation && generation.phase === "report_generation");
  assert.ok(Number.isInteger(generation.elapsedMs) && generation.elapsedMs >= 0);
  assert.equal(generation.gatewayAttempts, 1);
  const projection = trace.find((event) => event.phase === "report_projection");
  assert.ok(projection && projection.phase === "report_projection");
  assert.ok(Number.isInteger(projection.elapsedMs) && projection.elapsedMs >= 0);
  assert.equal(projection.citationCount, 2);
  assert.equal(projection.recommendationCount, 0);
});

test("the ordinary JSON and SSE application paths suppress a knowledge claim whose final citation was revoked", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "knowledge-qa-application-"));
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "How many folds?", additionalQueries: [], limit: 4 },
    {
      action: "finish",
      targetTeam: null,
      needSummary: "回答已完成。",
      capabilityProfile: [],
      recommendations: [],
      limitationKeys: [],
      methodologyClaims: [{
        evidenceIds: [evidenceId],
        claimType: "source_finding",
        summary: passage,
        limitations: [],
      }],
    },
  ];
  const planner: RecruitmentPlanner = {
    requiresGatewayDispatch(input) {
      return !(input.decisionSnapshot.caps.stage === "investigate"
        && input.history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology"));
    },
    isFinalSynthesis() { return true; },
    async decide() {
      const next = actions.shift();
      assert.ok(next, "the application graph must finish after one bounded retrieval round");
      return next;
    },
  };
  let finalCheck = false;
  const result = {
    status: "found" as const,
    evidence: [item()],
    subjectCoverage: [],
    generationId: "generation-a",
    traceId: "00000000-0000-4000-8000-000000000004",
    failureCode: null,
    rankingMode: "hybrid" as const,
    rankingDurationMs: 1,
    rankingInputTokens: null,
    rankingOutputTokens: null,
    rankingGatewayAttempts: 0,
    candidateCount: 1,
    budgetMsUsed: 1,
    budgetMsRemaining: 29_999,
    subqueryCount: 1,
    unavailableSubqueryCount: 0,
    zeroHitSubqueryCount: 0,
    notCoveredSubqueryCount: 0,
    blockedSubqueryCount: 0,
  };
  const knowledgeEvidence = {
    reader: {
      async retrieve() { return result; },
      async retrieveBatch(requests: unknown[]) {
        return { result, queryResults: requests.map(() => result) };
      },
      async resolve() {
        if (finalCheck) return {
          status: "unavailable" as const,
          evidence: [],
          subjectCoverage: [],
          generationId: "generation-a",
          traceId: "00000000-0000-4000-8000-000000000005",
          failureCode: "source_revoked" as const,
          rankingMode: null,
          rankingDurationMs: null,
          rankingInputTokens: null,
          rankingOutputTokens: null,
          rankingGatewayAttempts: 0,
          subqueryCount: 0,
          unavailableSubqueryCount: 0,
          zeroHitSubqueryCount: 0,
          notCoveredSubqueryCount: 0,
          blockedSubqueryCount: 0,
          candidateCount: 0,
          budgetMsUsed: 1,
          budgetMsRemaining: 29_998,
        };
        return { status: "found" as const, evidence: [item()], subjectCoverage: [] };
      },
    },
    investigations: {
      begin() {},
      finish() {},
      reserveQuery(_investigationId: string, requestHash: string) {
        return { kind: "reserved", investigationId: "investigation-application", requestHash, round: 1, remainingMs: 30_000, remainingGatewayAttempts: 4 };
      },
      completeQuery() {},
      failQuery() {},
      markQueryUnknown() {},
      markFollowupStarted() { return false; },
      hasPendingQueries() { return false; },
      snapshot() { return { status: "active", round: 1, initialQueryCount: 0, followupQueryCount: 0, remainingMs: 30_000 }; },
      reserveGatewayAttempt() { return { kind: "reserved", remainingMs: 30_000 }; },
    },
    admin: {
      async status() {
        return {
          activeSources: 1,
          activeDocuments: 1,
          generationId: "generation-a",
          embeddingModelId: "fixture",
          indexedChunks: 1,
          runtimeReady: true,
          evidenceSnapshotHash: "e".repeat(64),
        };
      },
      async prepareRuntime() { return { ready: true, generationId: "generation-a", failureCode: null }; },
    },
    async close() {},
  } as unknown as KnowledgeEvidence;
  const app = createApp({
    recruitmentConversation: createRecruitmentConversation({
      repository: {
        mode: "demo",
        sourceName: "knowledge application fixture",
        async loadPlayers() { return []; },
      },
      planner,
      knowledgeEvidence,
      evaluationEvidenceScope: () => ({
        corpus: "methodology",
        query: "How many folds?",
        subjects: [],
        sampleSeasons: [],
        knowledgeQa: true,
      }),
    }),
    knowledgeEvidence,
    checkpointPath: path.join(directory, "checkpoints.sqlite"),
    preferenceStorePath: path.join(directory, "preferences.sqlite"),
    playerObservationsPath: path.join(directory, "observations.sqlite"),
  });
  const payload = { requestId: "cae14f56-13a8-4a1f-8cb0-05a07b5c8003", message: "How many folds?" };
  try {
    finalCheck = true;
    const json = await app.inject({ method: "POST", url: "/api/v1/recruitment/cases/knowledge-revocation/turns", payload });
    assert.equal(json.statusCode, 200);
    const jsonBody = json.json() as { report: unknown; knowledgeAnswer?: { status: string; claims: unknown[] } };
    assert.equal(jsonBody.report, null);
    assert.equal(jsonBody.knowledgeAnswer?.status, "abstained");
    assert.deepEqual(jsonBody.knowledgeAnswer?.claims, []);
    assert.doesNotMatch(json.body, /推荐|候选|球探/iu);

    actions.push(
      { action: "search_methodology", query: "How many folds?", additionalQueries: [], limit: 4 },
      {
        action: "finish",
        targetTeam: null,
        needSummary: "回答已完成。",
        capabilityProfile: [],
        recommendations: [],
        limitationKeys: [],
        methodologyClaims: [{
          evidenceIds: [evidenceId],
          claimType: "source_finding",
          summary: passage,
          limitations: [],
        }],
      },
    );
    const sse = await app.inject({ method: "POST", url: "/api/v1/recruitment/cases/knowledge-revocation/turns/stream", payload });
    assert.equal(sse.statusCode, 200);
    const sseBody = parseSseResult(sse.body) as { report: unknown; knowledgeAnswer?: { status: string; claims: unknown[] } };
    assert.equal(sseBody.report, null);
    assert.equal(sseBody.knowledgeAnswer?.status, "abstained");
    assert.deepEqual(sseBody.knowledgeAnswer?.claims, []);
    assert.doesNotMatch(sse.body, /推荐|候选|球探/iu);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the application entry supports a follow-up multi-source partial answer, abstains, and safely resumes after cancelled retrieval", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "knowledge-qa-complete-application-"));
  const secondPassage = "A separate cohort was not reported.";
  const secondRef = {
    documentRevisionId: "c".repeat(64),
    sectionId: "results",
    startOffset: 0,
    endOffset: secondPassage.length,
    textHash: "d".repeat(64),
  };
  const secondEvidenceId = createHash("sha256").update(JSON.stringify(secondRef)).digest("hex");
  const firstItem = item();
  const secondItem = {
    ...item(),
    ref: secondRef,
    text: secondPassage,
    source: {
      ...item().source,
      sourceId: "source-b",
      sourceName: "Study B",
      title: "Study B",
      url: "https://example.test/study-b",
      author: "Author B",
      publisher: "Journal B",
      attribution: "Author B, Study B.",
      sectionPath: ["Results"],
    },
  };
  const firstEvidenceId = evidenceId;
  const investigationLedger = new EvidenceInvestigationLedger(path.join(directory, "investigations.sqlite"));
  let retrievalStartedResolve!: () => void;
  const retrievalStarted = new Promise<void>((resolve) => {
    retrievalStartedResolve = resolve;
  });
  let freshCancelledQueryDispatches = 0;
  const evidenceBundle = (
    status: "found" | "no_relevant_evidence" | "unavailable",
    evidence: ReturnType<typeof item>[],
    failureCode: string | null = null,
  ) => ({
    status,
    evidence,
    subjectCoverage: [],
    generationId: "generation-application",
    traceId: "00000000-0000-4000-8000-000000000007",
    failureCode,
    rankingMode: status === "unavailable" ? null : "hybrid" as const,
    rankingDurationMs: 1,
    rankingInputTokens: null,
    rankingOutputTokens: null,
    rankingGatewayAttempts: 0,
    candidateCount: evidence.length,
    budgetMsUsed: 1,
    budgetMsRemaining: 29_999,
    subqueryCount: 1,
    unavailableSubqueryCount: status === "unavailable" ? 1 : 0,
    zeroHitSubqueryCount: status === "no_relevant_evidence" ? 1 : 0,
    notCoveredSubqueryCount: 0,
    blockedSubqueryCount: 0,
  });
  let cancelledSearchDispatched = false;
  const plannerCalls = new Map<string, number>();
  const knowledgeEvidence = {
    reader: {
      async retrieve() { throw new Error("the application uses bounded batch retrieval"); },
      async retrieveBatch(requests: Array<{ query: string }>, _context: unknown, signal?: AbortSignal, reusedResults?: Array<ReturnType<typeof evidenceBundle> | null>) {
        if (reusedResults?.every((result) => result !== null)) {
          const queryResults = reusedResults as Array<NonNullable<typeof reusedResults[number]>>;
          return { result: queryResults[0]!, queryResults };
        }
        const query = requests[0]?.query ?? "";
        if (query === "cancel-query" && !cancelledSearchDispatched) {
          cancelledSearchDispatched = true;
          freshCancelledQueryDispatches += 1;
          retrievalStartedResolve();
          return new Promise((_resolve, reject) => {
            if (!signal) {
              reject(new Error("the application did not propagate the retrieval signal"));
              return;
            }
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }
        if (query === "cancel-query") {
          freshCancelledQueryDispatches += 1;
          assert.fail("an unknown cancelled retrieval must not be dispatched again");
        }
        const result = query === "study-a-query"
          ? evidenceBundle("found", [firstItem])
          : query === "study-b-followup"
            ? evidenceBundle("found", [secondItem])
            : query === "cancel-query"
              ? evidenceBundle("found", [firstItem])
              : evidenceBundle("no_relevant_evidence", []);
        return { result, queryResults: requests.map(() => result) };
      },
      async resolve(refs: Array<{ documentRevisionId: string }>) {
        const byRevision = new Map([
          [firstItem.ref.documentRevisionId, firstItem],
          [secondItem.ref.documentRevisionId, secondItem],
        ]);
        const evidence = refs.flatMap((ref) => {
          const match = byRevision.get(ref.documentRevisionId);
          return match ? [match] : [];
        });
        return { status: evidence.length === refs.length ? "found" as const : "unavailable" as const, evidence, subjectCoverage: [] };
      },
    },
    investigations: investigationLedger,
    admin: {
      async status() {
        return {
          activeSources: 2,
          activeDocuments: 2,
          generationId: "generation-application",
          embeddingModelId: "fixture",
          indexedChunks: 2,
          runtimeReady: true,
          evidenceSnapshotHash: "f".repeat(64),
        };
      },
      async prepareRuntime() { return { ready: true, generationId: "generation-application", failureCode: null }; },
    },
    async close() { investigationLedger.close(); },
  } as unknown as KnowledgeEvidence;
  const planner: RecruitmentPlanner = {
    requiresGatewayDispatch() { return false; },
    isFinalSynthesis(input) {
      const question = [...input.history].reverse().find((entry) => entry.role === "user")?.content ?? "";
      const priorCalls = plannerCalls.get(question) ?? 0;
      return question.includes("two studies") ? priorCalls >= 2 : priorCalls >= 1;
    },
    async decide(input) {
      const question = [...input.history].reverse().find((entry) => entry.role === "user")?.content ?? "";
      const callNumber = (plannerCalls.get(question) ?? 0) + 1;
      plannerCalls.set(question, callNumber);
      if (question.includes("two studies")) {
        if (callNumber === 1) return { action: "search_methodology", query: "study-a-query", additionalQueries: [], limit: 4 };
        if (callNumber === 2) return { action: "search_methodology", query: "study-b-followup", additionalQueries: [], limit: 4 };
        return {
          action: "finish",
          targetTeam: null,
          needSummary: "The two studies support the methods comparison, but insufficient evidence exists for long-term validation.",
          capabilityProfile: [],
          recommendations: [],
          limitationKeys: [],
          methodologyClaims: [{
            evidenceIds: [firstEvidenceId, secondEvidenceId],
            claimType: "cross_source_synthesis",
            summary: "Study A reports five-fold evaluation, while Study B states that no separate cohort was reported.",
            limitations: ["The sources do not establish long-term validation."],
          }],
        };
      }
      if (question.includes("trial paper")) {
        if (callNumber === 1) return { action: "search_methodology", query: "cancel-query", additionalQueries: [], limit: 4 };
        return {
          action: "finish",
          targetTeam: null,
          needSummary: "资料综合调查已达到安全上限。",
          capabilityProfile: [],
          recommendations: [],
          limitationKeys: [],
          methodologyClaims: [],
        };
      }
      if (callNumber === 1) return { action: "search_methodology", query: "no-evidence-query", additionalQueries: [], limit: 4 };
      return {
        action: "finish",
        targetTeam: null,
        needSummary: "当前资料不足以回答该问题。",
        capabilityProfile: [],
        recommendations: [],
        limitationKeys: [],
        methodologyClaims: [],
      };
    },
  };
  const trace: RecruitmentTraceEvent[] = [];
  const app = createApp({
    recruitmentConversation: createRecruitmentConversation({
      repository: {
        mode: "demo",
        sourceName: "knowledge application fixture",
        async loadPlayers() { return []; },
      },
      planner,
      knowledgeEvidence,
      observer(event) { trace.push(event); },
    }),
    knowledgeEvidence,
    checkpointPath: path.join(directory, "checkpoints.sqlite"),
    preferenceStorePath: path.join(directory, "preferences.sqlite"),
    playerObservationsPath: path.join(directory, "observations.sqlite"),
  });

  const caseId = "knowledge-qa-complete-application";
  const firstRequestId = "cae14f56-13a8-4a1f-8cb0-05a07b5c8010";
  const firstPayload = {
    requestId: firstRequestId,
    message: "According to the two studies, compare their methods and tell me what remains unsupported.",
  };
  try {
    const json = await app.inject({ method: "POST", url: `/api/v1/recruitment/cases/${caseId}/turns`, payload: firstPayload });
    assert.equal(json.statusCode, 200, json.body);
    const jsonBody = json.json() as { report: unknown; knowledgeAnswer?: { status: string; claims: Array<{ citations: Array<{ source: { sourceId: string } }> }>; missingFacts: string[] } };
    assert.equal(jsonBody.report, null);
    assert.equal(jsonBody.knowledgeAnswer?.status, "partial", JSON.stringify({ answer: jsonBody.knowledgeAnswer, trace }));
    assert.deepEqual(jsonBody.knowledgeAnswer?.claims[0]?.citations.map(({ source }) => source.sourceId), ["source-a", "source-b"]);
    assert.equal(jsonBody.knowledgeAnswer?.missingFacts.length, 1);
    assert.deepEqual(trace.filter((event) => event.phase === "tool" && event.toolName === "search_methodology").map((event) => event.phase === "tool" ? event.ragRound : null), [1, 2]);
    assert.ok(trace.some((event) => event.phase === "report_generation"));
    assert.ok(trace.some((event) => event.phase === "report_projection" && event.citationCount === 2));

    const sse = await app.inject({ method: "POST", url: `/api/v1/recruitment/cases/${caseId}/turns/stream`, payload: firstPayload });
    assert.equal(sse.statusCode, 200);
    assert.deepEqual(parseSseResult(sse.body), jsonBody);

    const unsupported = await app.inject({
      method: "POST",
      url: `/api/v1/recruitment/cases/${caseId}/turns`,
      payload: { requestId: "cae14f56-13a8-4a1f-8cb0-05a07b5c8011", expectsExistingState: true, message: "What does the paper say about a completely unsupported topic?" },
    });
    assert.equal(unsupported.statusCode, 200, unsupported.body);
    assert.equal(unsupported.json().knowledgeAnswer.status, "abstained");
    assert.deepEqual(unsupported.json().knowledgeAnswer.claims, []);

    const cancelRequestId = "cae14f56-13a8-4a1f-8cb0-05a07b5c8012";
    const cancelPayload = { requestId: cancelRequestId, expectsExistingState: true, message: "According to the trial paper, what does the study report?" };
    const pendingTurn = app.inject({ method: "POST", url: `/api/v1/recruitment/cases/${caseId}/turns`, payload: cancelPayload });
    await retrievalStarted;
    const cancel = await app.inject({ method: "POST", url: `/api/v1/recruitment/cases/${caseId}/turns/${cancelRequestId}/cancel` });
    assert.deepEqual(cancel.json(), { status: "requested" });
    const cancelled = await pendingTurn;
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json().status, "cancelled");

    const resumed = await app.inject({
      method: "POST",
      url: `/api/v1/recruitment/cases/${caseId}/turns`,
      payload: {
        requestId: "cae14f56-13a8-4a1f-8cb0-05a07b5c8013",
        expectsExistingState: true,
        message: cancelPayload.message,
      },
    });
    assert.equal(resumed.statusCode, 200, resumed.body);
    assert.equal(resumed.json().status, "completed");
    assert.equal(resumed.json().knowledgeAnswer.status, "abstained");
    assert.deepEqual(resumed.json().knowledgeAnswer.claims, []);
    assert.equal(freshCancelledQueryDispatches, 1, "the investigation ledger must not redispatch an unknown cancelled query");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a knowledge Q&A Planner cannot branch into recruitment tools", async () => {
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "What does the study report?", additionalQueries: [], limit: 4 },
    {
      action: "finish",
      targetTeam: null,
      needSummary: "当前资料不足，无法回答。",
      capabilityProfile: [],
      recommendations: [],
      limitationKeys: [],
      methodologyClaims: [],
    },
  ];
  const plannerInputs: Array<{ availableActions: readonly string[]; stage: string }> = [];
  const planner: RecruitmentPlanner = {
    async decide(input) {
      plannerInputs.push({
        availableActions: input.decisionSnapshot.caps.availableActions,
        stage: input.decisionSnapshot.caps.stage,
      });
      const next = actions.shift();
      assert.ok(next);
      return next;
    },
  };
  const conversation = createRecruitmentConversation({
    repository: {
      mode: "demo",
      sourceName: "knowledge routing fixture",
      async loadPlayers() { return []; },
    },
    planner,
    knowledgeEvidence: {
      reader: {
        async retrieve() { throw new Error("the knowledge graph uses batch retrieval"); },
        async retrieveBatch() {
          const result = {
            status: "no_relevant_evidence" as const,
            evidence: [],
            subjectCoverage: [],
            generationId: "generation-routing",
            traceId: "00000000-0000-4000-8000-000000000006",
            failureCode: null,
            rankingMode: "hybrid" as const,
            rankingDurationMs: 1,
            rankingInputTokens: null,
            rankingOutputTokens: null,
            rankingGatewayAttempts: 0,
            candidateCount: 0,
            budgetMsUsed: 1,
            budgetMsRemaining: 29_999,
            subqueryCount: 1,
            unavailableSubqueryCount: 0,
            zeroHitSubqueryCount: 1,
            notCoveredSubqueryCount: 0,
            blockedSubqueryCount: 0,
          };
          return { result, queryResults: [result] };
        },
        async resolve() { throw new Error("no citation was generated"); },
      },
      investigations: {
        begin() {},
        finish() {},
        reserveQuery(_investigationId: string, requestHash: string) {
          return { kind: "reserved", investigationId: "investigation-routing", requestHash, round: 1, remainingMs: 30_000, remainingGatewayAttempts: 4 };
        },
        completeQuery() {},
        failQuery() {},
        markQueryUnknown() {},
        markFollowupStarted() { return false; },
        hasPendingQueries() { return false; },
        snapshot() { return { status: "active", round: 1, initialQueryCount: 0, followupQueryCount: 0, remainingMs: 30_000 }; },
        reserveGatewayAttempt() { return { kind: "reserved", remainingMs: 30_000 }; },
      },
    } as unknown as KnowledgeEvidence,
    evaluationEvidenceScope: () => ({
      corpus: "methodology",
      query: "What does the study report?",
      subjects: [],
      sampleSeasons: [],
      knowledgeQa: true,
    }),
  });

  const result = await conversation.turn({
    threadId: "knowledge-recruitment-boundary",
    message: "What does the study report?",
  });

  assert.equal(result.status, "completed");
  assert.equal(result.report, null);
  assert.equal(result.knowledgeAnswer?.status, "abstained");
  assert.deepEqual(result.knowledgeAnswer?.claims, []);
  assert.equal(actions.length, 0);
  assert.equal(plannerInputs.length, 2);
  assert.equal(plannerInputs[0]?.stage, "investigate");
  for (const input of plannerInputs) {
    assert.deepEqual(input.availableActions, ["search_methodology", "finish"]);
  }
});
