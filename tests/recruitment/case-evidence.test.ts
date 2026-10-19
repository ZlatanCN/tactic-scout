import assert from "node:assert/strict";
import test from "node:test";
import { createCaseEvidenceIndex, readCaseEvidence } from "../../src/recruitment/case-evidence.js";

test("case evidence refs read bounded report pages and return an explicit continuation cursor", () => {
  const index = createCaseEvidenceIndex({
    caseId: "case-1",
    turnNumber: 3,
    evaluations: [],
    documents: [{
      id: "knowledge-1", documentId: "doc-1", corpus: "player_report", text: "first paragraph.\n\nsecond paragraph with useful details.",
      title: "Player report", url: "https://example.test/report", sourceId: "source", sourceName: "Source", publisher: "Publisher",
      author: "Author", publishedAt: null, license: "CC BY", attribution: "Source", entityIds: ["player-1"], entityNames: ["Player"],
      competition: "League", season: "2025", displayAllowed: true,
    }],
  });
  const ref = index.directory[0]!.ref;
  const first = readCaseEvidence(index, { refs: [ref], fields: ["body"], limit: 15 });
  assert.equal(first.results[0]?.status, "ok");
  assert.equal(first.results[0]?.content, "first paragraph");
  assert.equal(first.results[0]?.nextCursor, "15");
  const second = readCaseEvidence(index, { refs: [ref], fields: ["body"], cursor: first.results[0]?.nextCursor, limit: 40 });
  assert.match(second.results[0]?.content ?? "", /second paragraph/);
  assert.equal(second.results[0]?.nextCursor, null);
});

test("case evidence refs reject unknown, stale and cross-case references without accessing paths", () => {
  const original = createCaseEvidenceIndex({ caseId: "case-1", turnNumber: 2, evaluations: [], documents: [] });
  const foreign = createCaseEvidenceIndex({ caseId: "case-2", turnNumber: 2, evaluations: [], documents: [] });
  const stale = createCaseEvidenceIndex({ caseId: "case-1", turnNumber: 3, evaluations: [], documents: [] });
  assert.equal(readCaseEvidence(foreign, { refs: ["../.env"] }).results[0]?.status, "not_found");
  const fabricatedForeignRef = `ev.${original.caseKey}.2.player_report.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb`;
  assert.equal(readCaseEvidence(foreign, { refs: [fabricatedForeignRef] }).results[0]?.status, "foreign_case");
  const fabricatedStaleRef = `ev.${stale.caseKey}.2.player_report.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb`;
  assert.equal(readCaseEvidence(stale, { refs: [fabricatedStaleRef] }).results[0]?.status, "stale");
  assert.equal(readCaseEvidence(original, { refs: ["ev.invalid"] }).results[0]?.status, "not_found");
});

test("case evidence directory contains every evaluated candidate and does not merge report evidence into performance stats", () => {
  const index = createCaseEvidenceIndex({
    caseId: "case-1", turnNumber: 1,
    evaluations: [{ player: { playerId: "player-1", name: "Player One", source: "understat", competition: "Bundesliga", season: "2025", minutes: 900 }, evidence: [{ key: "goals", label: "Goals", value: 0, unit: "/90", peerPercentile: null, peerGroupSize: 0, minutes: 900, competition: "Bundesliga", season: "2025", source: "understat" }], roleFits: [] } as never],
    documents: [],
  });
  assert.equal(index.directory.length, 1);
  assert.equal(index.directory[0]?.kind, "player_metrics");
  const result = readCaseEvidence(index, { refs: [index.directory[0]!.ref], fields: ["body"] });
  assert.match(result.results[0]?.content ?? "", /"value":0/);
  assert.doesNotMatch(result.results[0]?.content ?? "", /report|narrative/i);
});
