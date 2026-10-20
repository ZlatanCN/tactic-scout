import assert from "node:assert/strict";
import test from "node:test";
import { KnowledgeSearchResultSchema } from "../../src/knowledge/schemas.js";
import { createCaseEvidenceIndex, readCaseEvidence } from "../../src/recruitment/case-evidence.js";
import { buildConclusionCandidateEvidence, buildConclusionEvidenceDirectory, compactConclusionHistory, partitionConclusionCandidatesByIdentity, reduceConclusionHistoryForBudget, selectRelevantDocumentExcerpt } from "../../src/recruitment/planner-context.js";
import type { EvaluatedCandidate } from "../../src/recruitment/recruitment-evidence-evaluator.js";

test("document context selects a complete relevant passage beyond the opening and identifies its source range", () => {
  const relevantPassage = "Player X repeatedly found the progressive passing lane, but his forward pass completion fell under pressure.";
  const text = `${"An irrelevant opening sentence about an unrelated match. ".repeat(25)}${relevantPassage}${" Additional unrelated report details follow. ".repeat(25)}`;
  const excerpt = selectRelevantDocumentExcerpt({
    text,
    title: "Player X scouting report",
    entityNames: ["Player X"],
    matchedCapabilityGaps: ["progressive passing"],
  });

  assert.equal(excerpt.text.includes(relevantPassage), true, "the complete claim and its qualifier should be retained");
  assert.equal(excerpt.text, text.slice(excerpt.startOffset, excerpt.endOffset), "the excerpt must remain a verifiable contiguous source passage");
  assert.ok(excerpt.startOffset > 0);
  assert.equal(excerpt.sourceCharacters, text.length);
  assert.equal(excerpt.strategy, "relevance_window");
});

test("document context keeps late counterevidence when an earlier passage supports the same capability", () => {
  const supportingPassage = "Player X's progressive passing consistently breaks the first line and creates clear access to the final third.";
  const counterevidence = "However, Player X's progressive passing breaks down under pressure, with repeated loose passes that expose his team.";
  const text = `${"An unrelated opening sentence about the squad and match setting. ".repeat(4)}${supportingPassage}${" The report then describes unrelated training observations and match background. ".repeat(28)}${counterevidence}`;
  const excerpt = selectRelevantDocumentExcerpt({
    text,
    title: "Player X scouting report",
    entityNames: ["Player X"],
    matchedCapabilityGaps: ["progressive passing"],
  });

  assert.equal(excerpt.text.includes(counterevidence), true, "late counterevidence about the requested capability must not be hidden by an earlier supporting passage");
  assert.equal(excerpt.text, text.slice(excerpt.startOffset, excerpt.endOffset));
  assert.ok(excerpt.text.length <= 900, "the selected evidence window must stay within the configured character bound");
  assert.ok(excerpt.startOffset > text.indexOf(supportingPassage));
});

test("conclusion excerpts retain the exact case ref for same-title document chunks", () => {
  const relevantPassage = "Player X repeatedly found the progressive passing lane, but his forward pass completion fell under pressure.";
  const sourceText = `${"An unrelated match detail. ".repeat(60)}${relevantPassage}${" More unrelated match details. ".repeat(60)}`;
  const documents = [
    KnowledgeSearchResultSchema.parse({
      id: "document-chunk-x", documentId: "report-x", corpus: "player_report", text: sourceText,
      title: "Player scouting report", url: "https://example.test/report-x", sourceId: "publisher",
      sourceName: "Report source", publisher: "Publisher", author: "Author", publishedAt: null,
      license: "CC BY", attribution: "Publisher", entityIds: ["player-x"], entityNames: ["Player X"],
      competition: "League", season: "2025/26", matchedCapabilityGaps: ["progressive passing"], displayAllowed: true,
    }),
    KnowledgeSearchResultSchema.parse({
      id: "document-chunk-y", documentId: "report-y", corpus: "player_report", text: sourceText,
      title: "Player scouting report", url: "https://example.test/report-y", sourceId: "publisher",
      sourceName: "Report source", publisher: "Publisher", author: "Author", publishedAt: null,
      license: "CC BY", attribution: "Publisher", entityIds: ["player-y"], entityNames: ["Player Y"],
      competition: "League", season: "2025/26", matchedCapabilityGaps: ["progressive passing"], displayAllowed: true,
    }),
  ];
  const index = createCaseEvidenceIndex({ caseId: "same-title-reports", scopeRevision: "brief-v1", evaluations: [], documents });
  const evidenceRefsByChunkId = new Map(index.directory.flatMap(entry => entry.chunkId ? [[entry.chunkId, entry.ref] as const] : []));
  const compacted = compactConclusionHistory([{
    role: "tool",
    toolName: "search_player_reports",
    content: JSON.stringify({ results: documents }),
  }], undefined, { evidenceRefsByChunkId });
  const results = JSON.parse(compacted[0]!.content).results as Array<{ id: string; evidenceRef?: string; text: string; textExcerpt: { strategy: string; note: string } }>;

  assert.equal(results[0]?.id, "document-chunk-x");
  assert.equal(results[0]?.evidenceRef, evidenceRefsByChunkId.get("document-chunk-x"));
  assert.equal(results[1]?.evidenceRef, evidenceRefsByChunkId.get("document-chunk-y"));
  assert.notEqual(results[0]?.evidenceRef, results[1]?.evidenceRef);
  assert.deepEqual(index.directory.map(({ chunkId, documentId, entityNames }) => ({ chunkId, documentId, entityNames })), [
    { chunkId: "document-chunk-x", documentId: "report-x", entityNames: ["Player X"] },
    { chunkId: "document-chunk-y", documentId: "report-y", entityNames: ["Player Y"] },
  ]);
  assert.ok(results[0]?.text.includes(relevantPassage));
  assert.equal(results[0]?.textExcerpt.strategy, "relevance_window");
  assert.match(results[0]?.textExcerpt.note ?? "", /evidenceRef/);
  assert.equal(readCaseEvidence(index, { refs: [results[0]!.evidenceRef!], fields: ["body"], limit: 4_000 }).results[0]?.content, sourceText);
});

test("conclusion evidence projects every candidate and only requested metrics without turning missing values into zero", () => {
  const candidates: EvaluatedCandidate[] = [
    {
      player: {
        playerId: "candidate-a", name: "Candidate A", team: "Club A", age: 22, position: "CM",
        competition: "League", season: "2026/27", minutes: 1_200, source: "Fixture",
        stats: { goals: 4, assists: 3 },
      },
      evidence: [
        { key: "goals", label: "进球", value: 0.3, unit: "次/90", peerPercentile: 72, peerGroupSize: 10, minutes: 1_200, competition: "League", season: "2026/27", source: "Fixture" },
        { key: "assists", label: "助攻", value: 0, unit: "次/90", peerPercentile: 0, peerGroupSize: 10, minutes: 1_200, competition: "League", season: "2026/27", source: "Fixture" },
        { key: "pressures", label: "施压", value: 9, unit: "次/90", peerPercentile: 80, peerGroupSize: 10, minutes: 1_200, competition: "League", season: "2026/27", source: "Fixture" },
      ],
    },
    {
      player: {
        playerId: "candidate-b", name: "Candidate B", team: "Club B", age: 23, position: "CM",
        competition: "League", season: "2026/27", minutes: 400, source: "Fixture",
        stats: { goals: 1 },
      },
      evidence: [
        { key: "goals", label: "进球", value: 0.2, unit: "次/90", peerPercentile: null, peerGroupSize: 2, peerPercentileUnavailableReason: "candidate_low_sample", minutes: 400, competition: "League", season: "2026/27", source: "Fixture" },
      ],
    },
  ];

  const projected = buildConclusionCandidateEvidence(candidates, ["goals", "assists"], new Map([
    ["candidate-a", "ev.0123456789ab.abcdef012345.player_metrics.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb"],
  ]));

  assert.equal(projected.candidateCount, 2);
  assert.deepEqual(projected.candidates.map(candidate => candidate.playerId), ["candidate-a", "candidate-b"]);
  assert.deepEqual(projected.candidates[0]?.metrics.map(metric => [metric.key, metric.value]), [["goals", 0.3], ["assists", 0]]);
  assert.deepEqual(projected.metricDefinitions, [
    { key: "goals", label: "进球", unit: "次/90" },
    { key: "assists", label: "助攻", unit: "次/90" },
  ]);
  assert.equal(projected.candidates[0]?.metrics.some(metric => metric.key === "pressures"), false);
  assert.deepEqual(projected.candidates[1]?.metrics, [{
    key: "goals", value: 0.2, peerPercentile: null, peerGroupSize: 2,
    peerPercentileUnavailableReason: "candidate_low_sample",
  }]);
  assert.equal(projected.candidates[1]?.minutes, 400, "the candidate sample size stays visible without repeating it in every metric");
  assert.equal(projected.candidates[0]?.metricEvidenceRef, "ev.0123456789ab.abcdef012345.player_metrics.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb");
  assert.equal(JSON.stringify(projected).includes('"value":0'), true);
  assert.equal(JSON.stringify(projected).includes("definition"), false);
});

test("a large conclusion directory stores metric labels once and keeps every candidate and readable evidence ref", () => {
  const candidates: EvaluatedCandidate[] = Array.from({ length: 60 }, (_, index) => ({
    player: {
      playerId: `candidate-${index}`, name: `Candidate ${index}`, position: "CM", team: "Fixture Club",
      competition: "Fixture League", season: "2026/27", minutes: 1_200, source: "Fixture",
      stats: { goals: index, assists: index / 10 },
    },
    evidence: [
      { key: "goals", label: "进球", value: index / 10, unit: "次/90", peerPercentile: 50, peerGroupSize: 8, minutes: 1_200, competition: "Fixture League", season: "2026/27", source: "Fixture" },
      { key: "assists", label: "助攻", value: index / 100, unit: "次/90", peerPercentile: 40, peerGroupSize: 8, minutes: 1_200, competition: "Fixture League", season: "2026/27", source: "Fixture" },
    ],
  }));
  const refs = new Map(candidates.map((candidate, index) => [candidate.player.playerId,
    `ev.0123456789ab.abcdef012345.player_metrics.${index.toString(16).padStart(16, "0")}.bbbbbbbbbbbbbbbb`,
  ]));
  const compact = buildConclusionCandidateEvidence(candidates, ["goals", "assists"], refs);
  const original = JSON.stringify(candidates.map(candidate => ({ ...candidate.player, metrics: candidate.evidence })));

  assert.equal(compact.candidates.length, 60);
  assert.ok(compact.candidates.every(candidate => candidate.metricEvidenceRef));
  assert.ok(JSON.stringify(compact).length < original.length * 0.75,
    `Expected the complete candidate directory to remove at least 25% of repeated metric metadata (${JSON.stringify(compact).length}/${original.length}).`);
});

test("conclusion batches keep resolved source records for the same candidate together", () => {
  const candidates = ["player-a-source-1", "player-a-source-2", "player-b", "player-c", "player-d", "player-e"]
    .map(playerId => ({ playerId }));
  const batches = partitionConclusionCandidatesByIdentity(candidates, [{
    identityKey: "resolved:player-a", status: "resolved", registryAvailable: true, reepId: "reep-a", releaseStamp: "test",
    recordPlayerIds: ["player-a-source-1", "player-a-source-2"],
  }]);
  const batchFor = (playerId: string) => batches.findIndex(batch => batch.some(candidate => candidate.playerId === playerId));
  assert.notEqual(batchFor("player-a-source-1"), -1);
  assert.equal(batchFor("player-a-source-1"), batchFor("player-a-source-2"));
  assert.deepEqual(batches.flat().map(candidate => candidate.playerId).sort(), candidates.map(candidate => candidate.playerId).sort());
  assert.ok(Math.max(...batches.map(batch => batch.length)) - Math.min(...batches.map(batch => batch.length)) <= 1,
    "resolved identity groups stay together while batches remain balanced by source-record count");
});

test("combined context exposes document refs once and leaves metric refs attached to their candidate", () => {
  const directory = buildConclusionEvidenceDirectory([
    { ref: "metric-ref", kind: "player_metrics", title: "Candidate A", playerId: "candidate-a", availableFields: ["metadata", "body"], contentCharacters: 2_000, source: "Fixture", timeRange: "League · 2026/27" },
    { ref: "report-ref", kind: "player_report", title: "Candidate report", playerId: "candidate-a", chunkId: "chunk-1", documentId: "doc-1", entityNames: ["Candidate A"], availableFields: ["metadata", "body"], contentCharacters: 6_000, source: "Report source", timeRange: "2025/26" },
  ]);
  assert.deepEqual(directory, [{ ref: "report-ref", kind: "player_report", title: "Candidate report", playerId: "candidate-a", chunkId: "chunk-1", documentId: "doc-1", entityNames: ["Candidate A"], source: "Report source", timeRange: "2025/26" }]);
});

test("budget fallback keeps the current dialogue and case evidence while removing replayable search logs", () => {
  const history = [
    { role: "user" as const, content: "为巴萨找一名中卫" },
    { role: "tool" as const, toolName: "search_candidates", content: "large roster result" },
    { role: "tool" as const, toolName: "evaluate_candidates", content: "large evaluation result" },
    { role: "tool" as const, toolName: "inspect_team", content: "current roster context" },
    { role: "tool" as const, toolName: "previous_shortlist", content: "visible shortlist snapshot" },
    { role: "tool" as const, toolName: "read_case_evidence", content: "selected source evidence" },
    { role: "tool" as const, toolName: "read_case_evidence", content: "second page of selected source evidence" },
    { role: "tool" as const, toolName: "search_methodology", content: "methodology result excerpt" },
    { role: "tool" as const, toolName: "search_player_reports", content: "report excerpts" },
    { role: "assistant" as const, content: JSON.stringify({ action: "ask_user", question: "是否限制年龄？" }) },
    { role: "user" as const, content: "不设年龄限制，保留出球能力" },
  ];

  const reduced = reduceConclusionHistoryForBudget(history);

  assert.ok(reduced.length < history.length);
  assert.deepEqual(reduced.filter(entry => entry.role === "user").map(entry => entry.content), ["不设年龄限制，保留出球能力"]);
  assert.ok(reduced.some(entry => entry.role === "tool" && entry.toolName === "previous_shortlist"));
  assert.ok(reduced.some(entry => entry.role === "tool" && entry.toolName === "inspect_team"));
  assert.ok(reduced.some(entry => entry.role === "tool" && entry.toolName === "read_case_evidence"));
  assert.ok(reduced.some(entry => entry.role === "tool" && entry.toolName === "search_player_reports"));
  assert.ok(reduced.some(entry => entry.role === "tool" && entry.toolName === "search_methodology"));
  assert.ok(reduced.some(entry => entry.role === "assistant" && entry.content.includes("是否限制年龄")));
  assert.equal(reduced.some(entry => entry.role === "tool" && ["search_candidates", "evaluate_candidates"].includes(entry.toolName ?? "")), false);

  const evidenceBacked = reduceConclusionHistoryForBudget(history, { evidenceDirectoryAvailable: true, canReadEvidence: true });
  assert.equal(evidenceBacked.filter(entry => entry.role === "tool" && entry.toolName === "read_case_evidence").length, 2);
  assert.equal(evidenceBacked.some(entry => entry.role === "tool" && ["search_methodology", "search_player_reports"].includes(entry.toolName ?? "")), false,
    "a current case evidence directory can replace replaying already retrieved long documents");

  const exhaustedReadBudget = reduceConclusionHistoryForBudget(history, { evidenceDirectoryAvailable: true, canReadEvidence: false });
  assert.equal(exhaustedReadBudget.filter(entry => entry.role === "tool" && entry.toolName === "read_case_evidence").length, 2,
    "all evidence excerpts already read must remain available when the case cannot read more");
  assert.ok(exhaustedReadBudget.some(entry => entry.role === "tool" && entry.toolName === "search_methodology"),
    "methodology evidence must remain when the Planner cannot read it back from its ref");
  assert.ok(exhaustedReadBudget.some(entry => entry.role === "tool" && entry.toolName === "search_player_reports"),
    "report evidence must remain when the Planner cannot read it back from its ref");
});

test("conclusion context stores shared candidate metadata once while preserving metric evidence", () => {
  const evaluatedPlayers = Array.from({ length: 30 }, (_, playerIndex) => ({
    playerId: `player-${playerIndex}`,
    name: `Player ${playerIndex}`,
    position: "ATT",
    competition: "Premier League",
    season: "2026/27",
    minutes: 540,
    source: "Fantasy Premier League",
    metrics: Array.from({ length: 8 }, (_, metricIndex) => ({
      key: metricIndex === 0 ? "goals" : metricIndex === 1 ? "assists" : `metric-${metricIndex}`,
      label: `Metric ${metricIndex}`,
      value: metricIndex / 10,
      unit: "per 90",
      peerPercentile: null,
      peerGroupSize: 4,
      peerPercentileUnavailableReason: "candidate_low_sample",
      minutes: 540,
      competition: "Premier League",
      season: "2026/27",
      source: "Fantasy Premier League",
      definition: "A metric definition that is retained for careful interpretation.",
      sampleMatches: 7,
    })),
  }));
  const originalContent = JSON.stringify({ evaluations: evaluatedPlayers, missingPlayerIds: [], note: "Full metric output." });
  const compacted = compactConclusionHistory([
    {
      role: "tool",
      toolName: "search_candidates",
      content: JSON.stringify({
        matchingRecords: 79,
        candidates: evaluatedPlayers.map(({ playerId, name, position, competition, season, minutes }) => ({
          playerId, name, position, competition, season, minutes,
        })),
      }),
    },
    { role: "tool", toolName: "evaluate_candidates", content: originalContent },
  ], [{ requestedMetricKeys: ["goals", "assists"] }]);
  const evaluationEntry = compacted.find((entry) => entry.toolName === "evaluate_candidates");
  const evaluation = JSON.parse(evaluationEntry?.content ?? "{}") as {
    evaluations?: Array<{
      playerId?: string;
      competition?: string;
      season?: string;
      minutes?: number;
      source?: string;
      metrics?: Array<Record<string, unknown>>;
    }>;
  };
  const firstPlayer = evaluation.evaluations?.[0];
  const firstMetric = firstPlayer?.metrics?.[0];

  assert.ok(evaluationEntry);
  assert.ok(evaluationEntry.content.length < originalContent.length * 0.5,
    `Expected at least a 50% reduction, from ${originalContent.length} to ${evaluationEntry.content.length} characters.`);
  assert.equal(firstPlayer?.competition, "Premier League");
  assert.equal(firstPlayer?.season, "2026/27");
  assert.equal(firstPlayer?.minutes, 540);
  assert.equal(firstPlayer?.source, "Fantasy Premier League");
  assert.equal(firstMetric?.key, "goals");
  assert.equal(firstPlayer?.metrics?.length, 2);
  assert.equal(firstMetric?.value, 0);
  assert.equal(firstMetric?.peerPercentileUnavailableReason, "candidate_low_sample");
  assert.equal(firstMetric?.sampleMatches, 7);
  assert.equal(firstMetric?.definition, "A metric definition that is retained for careful interpretation.");
  assert.equal("competition" in (firstMetric ?? {}), false);
  assert.equal("season" in (firstMetric ?? {}), false);
  assert.equal("minutes" in (firstMetric ?? {}), false);
  assert.equal("source" in (firstMetric ?? {}), false);
});

test("ability-profile instructions explicitly distinguish supplied role evidence from match statistics", async () => {
  const { abilityProfileInstructions } = await import("../../src/recruitment/recruitment-planner.js");
  assert.equal(abilityProfileInstructions(false), "");
  const instructions = abilityProfileInstructions(true);
  assert.match(instructions, /basis=ability_profile/);
  assert.match(instructions, /availableStats=\[\]/);
  assert.match(instructions, /不表示零能力/);
  assert.match(instructions, /比赛统计/);
});

test("ability conclusion context retains values and basis without repeating match-only metadata or absent fusion scores", () => {
  const evaluation = { playerId: "profile-1", name: "Fixture player", position: "ST", competition: "", season: "", minutes: 0, source: "fm",
    roleFits: [{ role: "finisher", abilityFit: 82, performanceFit: null, combinedFit: null }, { role: "playmaker", abilityFit: 74, performanceFit: 60, combinedFit: 69 }],
    metrics: [{ key: "abilityFinishing", basis: "ability_profile", value: 82, unit: "/100", definition: "Repeated definition ".repeat(30), minutes: null, peerPercentile: null, peerGroupSize: 0 }],
  };
  const history = [{ role: "tool" as const, toolName: "evaluate_candidates", content: JSON.stringify({ evaluations: [evaluation] }) }];
  const compact = compactConclusionHistory(history, [{ requestedMetricKeys: ["abilityFinishing"] }]);
  const result = JSON.parse(compact[0]!.content);
  const player = result.evaluations[0];
  assert.deepEqual(player.metrics, [{ key: "abilityFinishing", value: 82, unit: "/100", basis: "ability_profile" }]);
  assert.equal(player.playerId, "profile-1");
  assert.equal("minutes" in player, false);
  assert.deepEqual(player.roleFits, []);
  assert.match(result.note, /不.*实战表现/);
  assert.ok(compact[0]!.content.length < history[0]!.content.length / 2);
});
