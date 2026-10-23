import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EvidenceInvestigationLedger } from "../../src/knowledge/evidence-investigation-ledger.js";

const reference = {
  documentRevisionId: "a".repeat(64),
  sectionId: "section-a",
  startOffset: 0,
  endOffset: 10,
  textHash: "b".repeat(64),
};

test("investigation ledger reuses completed references and preserves two bounded rounds", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rag-investigation-ledger-"));
  const ledger = new EvidenceInvestigationLedger(path.join(directory, "catalog.sqlite"));
  try {
    const first = ledger.begin("stable-turn-id-0001");
    const reservation = ledger.reserveQuery("stable-turn-id-0001", "a".repeat(64));
    assert.equal(reservation.kind, "reserved");
    if (reservation.kind !== "reserved") return;
    assert.equal(reservation.round, 1);
    const outcome = {
      status: "found" as const,
      failureCode: null,
      generationId: "generation-1",
      rankingMode: "hybrid" as const,
      candidateCount: 1,
      evidenceRefs: [reference],
      subjectCoverage: [],
    };
    for (const hash of ["c", "d"]) {
      const initial = ledger.reserveQuery("stable-turn-id-0001", hash.repeat(64));
      assert.equal(initial.kind, "reserved");
    }
    ledger.completeQuery("stable-turn-id-0001", "a".repeat(64), outcome);
    for (const hash of ["c", "d"]) {
      ledger.completeQuery("stable-turn-id-0001", hash.repeat(64), outcome);
    }
    const cached = ledger.reserveQuery("stable-turn-id-0001", "a".repeat(64));
    assert.equal(cached.kind, "cached");
    if (cached.kind === "cached") assert.deepEqual(cached.result.evidenceRefs, [reference]);

    assert.equal(ledger.markFollowupStarted("stable-turn-id-0001"), true);
    const followupOne = ledger.reserveQuery("stable-turn-id-0001", "e".repeat(64));
    const followupTwo = ledger.reserveQuery("stable-turn-id-0001", "f".repeat(64));
    const thirdFollowup = ledger.reserveQuery("stable-turn-id-0001", "0".repeat(64));
    assert.equal(followupOne.kind, "reserved");
    assert.equal(followupTwo.kind, "reserved");
    assert.deepEqual(thirdFollowup, { kind: "blocked", investigationId: "stable-turn-id-0001", reason: "query_limit" });
    assert.equal(ledger.snapshot("stable-turn-id-0001")?.followupQueryCount, 2);
    assert.ok(first.deadlineAtMs - first.startedAtMs <= 30_000);
  } finally {
    ledger.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unknown dispatch result cannot be retried with the same request key", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rag-investigation-unknown-"));
  const ledger = new EvidenceInvestigationLedger(path.join(directory, "catalog.sqlite"));
  try {
    ledger.begin("stable-turn-id-0002");
    const reservation = ledger.reserveQuery("stable-turn-id-0002", "f".repeat(64));
    assert.equal(reservation.kind, "reserved");
    ledger.markQueryUnknown("stable-turn-id-0002", "f".repeat(64), "process_restart");
    assert.equal(ledger.reserveQuery("stable-turn-id-0002", "f".repeat(64)).kind, "unknown");
  } finally {
    ledger.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("planner and reranker reservations share one four-call and thirty-second budget", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rag-investigation-budget-"));
  let clock = 1_000;
  const ledger = new EvidenceInvestigationLedger(path.join(directory, "catalog.sqlite"), {
    now: () => clock,
    durationMs: 100,
    maximumGatewayAttempts: 2,
  });
  try {
    ledger.begin("stable-turn-id-0003");
    assert.equal(ledger.reserveQuery("stable-turn-id-0003", "1".repeat(64)).kind, "reserved");
    assert.equal(ledger.reserveGatewayAttempt("stable-turn-id-0003", "planner", "p1").kind, "reserved");
    assert.equal(ledger.reserveGatewayAttempt("stable-turn-id-0003", "reranker", "r1").kind, "reserved");
    assert.equal(ledger.reserveGatewayAttempt("stable-turn-id-0003", "gap_check", "g1").kind, "blocked");
    clock += 101;
    assert.equal(ledger.reserveQuery("stable-turn-id-0003", "2".repeat(64)).kind, "blocked");
    assert.equal(ledger.snapshot("stable-turn-id-0003")?.status, "budget_exhausted");
  } finally {
    ledger.close();
    await rm(directory, { recursive: true, force: true });
  }
});
