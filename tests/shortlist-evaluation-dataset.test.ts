import assert from "node:assert/strict";
import test from "node:test";
import { createShortlistQualityDataset } from "../src/evals/shortlist-evaluation-dataset.js";
import { evaluateShortlistQuality } from "../src/evals/shortlist-quality-evaluation.js";

const packet = {
  schemaVersion: 2,
  benchmarkId: "human-shortlist-fit-v1",
  packetId: "packet_benchmark_01",
  roleBrief: "为巴萨寻找具备向前推进能力的中场。",
  snapshot: {
    source: "Historical event data",
    publisher: "Wyscout",
    attribution: "Wyscout Open Data, CC BY 4.0",
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    datasetId: "wyscout-example-v1",
    sha256: "a".repeat(64),
    asOf: "2026-10-09T00:00:00.000Z",
    derivationRuleset: "events-v2",
    scope: "League A, 2017/18",
  },
  cards: ["card_alpha", "card_bravo", "card_charlie"].map((cardId) => ({
    cardId,
    performances: [{
      position: "MID",
      ageAtSeasonEnd: 23,
      competition: "League A",
      season: "2017/18",
      sampleSize: { minutes: 900, matches: 10 },
      metrics: [],
    }],
  })),
  reviewerInstructions: ["按冻结职责判断适配；证据不足时选择 unknown。"],
};

const answerKey = {
  schemaVersion: 2,
  packetId: packet.packetId,
  queryId: "barcelona-midfielder-v1",
  snapshotSha256: packet.snapshot.sha256,
  cards: [
    { cardId: "card_alpha", sourcePlayerIds: ["private-player-1"], externalPlayerId: "hidden-1", playerName: "Hidden One", teamStints: [], systemRanks: [{ systemId: "system-good", runId: "run-a", rank: 1 }, { systemId: "system-reversed", runId: "run-b", rank: 3 }] },
    { cardId: "card_bravo", sourcePlayerIds: ["private-player-2"], externalPlayerId: "hidden-2", playerName: "Hidden Two", teamStints: [], systemRanks: [{ systemId: "system-good", runId: "run-a", rank: 2 }, { systemId: "system-reversed", runId: "run-b", rank: 2 }] },
    { cardId: "card_charlie", sourcePlayerIds: ["private-player-3"], externalPlayerId: "hidden-3", playerName: "Hidden Three", teamStints: [], systemRanks: [{ systemId: "system-good", runId: "run-a", rank: 3 }, { systemId: "system-reversed", runId: "run-b", rank: 1 }] },
  ],
};

const submissions = [
  {
    schemaVersion: 1,
    benchmarkId: "human-shortlist-fit-v1",
    packetId: packet.packetId,
    reviewerId: "reviewer-a",
    ratings: [
      { cardId: "card_alpha", rating: 3 },
      { cardId: "card_bravo", rating: 1 },
      { cardId: "card_charlie", rating: 0 },
    ],
  },
  {
    schemaVersion: 1,
    benchmarkId: "human-shortlist-fit-v1",
    packetId: packet.packetId,
    reviewerId: "reviewer-b",
    ratings: [
      { cardId: "card_alpha", rating: 3 },
      { cardId: "card_bravo", rating: 2 },
      { cardId: "card_charlie", rating: 0 },
    ],
  },
];

const adjudications = [
  { cardId: "card_alpha", grade: 3 },
  { cardId: "card_bravo", grade: 2 },
  { cardId: "card_charlie", grade: 0 },
];

test("creates a schema-valid, de-identified quality dataset from locked blind reviews", () => {
  const dataset = createShortlistQualityDataset({ packet, answerKey, submissions, adjudications });
  const result = evaluateShortlistQuality(dataset);

  assert.equal(dataset.queries[0]?.queryId, "barcelona-midfielder-v1");
  assert.deepEqual(dataset.queries[0]?.candidateIds, ["card_alpha", "card_bravo", "card_charlie"]);
  assert.deepEqual(dataset.queries[0]?.systemRankings.map(({ candidateIds }) => candidateIds), [
    ["card_alpha", "card_bravo", "card_charlie"],
    ["card_charlie", "card_bravo", "card_alpha"],
  ]);
  assert.equal(dataset.queries[0]?.ratings.length, 6);
  assert.doesNotMatch(JSON.stringify(dataset), /private-player|Hidden One|Hidden Two|Hidden Three|externalPlayerId|teamStints/);
  assert.equal(result.status, "evaluable");
  assert.equal(result.queries[0]?.systems[0]?.ndcgAt5, 1);
  assert.equal(result.queries[0]?.systems[1]?.ndcgAt5, 0.6064);
});

test("requires two distinct reviewers with a complete rating for every anonymous card", () => {
  assert.throws(() => createShortlistQualityDataset({ packet, answerKey, submissions: [submissions[0]], adjudications }), /至少需要两位不同评审者/);
  assert.throws(() => createShortlistQualityDataset({ packet, answerKey, submissions: [submissions[0], { ...submissions[1], reviewerId: "reviewer-a" }], adjudications }), /评审代号必须互不相同/);
  assert.throws(() => createShortlistQualityDataset({ packet, answerKey, submissions: [submissions[0], { ...submissions[1], ratings: submissions[1]!.ratings.slice(0, 2) }], adjudications }), /未覆盖全部匿名卡/);
});

test("rejects answer keys and submissions from another packet or snapshot", () => {
  assert.throws(() => createShortlistQualityDataset({ packet, answerKey: { ...answerKey, packetId: "different-packet" }, submissions, adjudications }), /答案键与盲评包不匹配/);
  assert.throws(() => createShortlistQualityDataset({ packet, answerKey, submissions: [{ ...submissions[0], packetId: "different-packet" }, submissions[1]], adjudications }), /评分文件与盲评包不匹配/);
  assert.throws(() => createShortlistQualityDataset({ packet, answerKey: { ...answerKey, snapshotSha256: "b".repeat(64) }, submissions, adjudications }), /快照哈希与盲评包不匹配/);
});

test("requires a complete adjudication for every card and preserves unknown as unknown", () => {
  assert.throws(() => createShortlistQualityDataset({ packet, answerKey, submissions, adjudications: adjudications.slice(0, 2) }), /裁决必须覆盖全部匿名卡/);

  const dataset = createShortlistQualityDataset({
    packet,
    answerKey,
    submissions,
    adjudications: [...adjudications.slice(0, 2), { cardId: "card_charlie", grade: "unknown" }],
  });
  const charlie = dataset.queries[0]?.adjudications.find(({ candidateId }) => candidateId === "card_charlie");
  const result = evaluateShortlistQuality(dataset);

  assert.deepEqual(charlie, { candidateId: "card_charlie", grade: "unknown" });
  assert.equal(result.status, "not_evaluable");
  assert.ok(result.queries[0]?.notEvaluableReasons.includes("unresolved_adjudicated_grades"));
  assert.ok(result.queries[0]?.systems.every(({ ndcgAt5 }) => ndcgAt5 === null));
});
