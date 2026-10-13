import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { BlindedReviewerPacketSchema } from "../src/domain/shortlist-review.js";
import { exportBlindedReviewPackets } from "../src/evals/blinded-review-packet.js";
import { createShortlistQualityDataset } from "../src/evals/shortlist-evaluation-dataset.js";
import { evaluateShortlistQuality } from "../src/evals/shortlist-quality-evaluation.js";

const firstCandidateId = "wyscout:101:team:7:competition:8:season:2017/18";
const secondCandidateId = "wyscout:202:team:9:competition:8:season:2017/18";

function exportInput() {
  const snapshotJson = JSON.stringify({
    schemaVersion: 1,
    datasetId: "tactiscout-wyscout-v1-example",
    builtAt: "2026-10-09T00:00:00.000Z",
    attribution: "Wyscout Open Data, CC BY 4.0",
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    upstreamSource: {
      name: "Soccer match event dataset",
      publisher: "Wyscout",
      paperUrl: "https://doi.org/10.1038/s41597-019-0247-7",
      acquiredAt: "2019-10-01",
      scope: "2017/18 league season",
    },
    derivation: { ruleset: "tactiscout-wyscout-events-v2", description: "Frozen event-derived metrics." },
    coverage: { competitions: ["League A"], seasons: ["2017/18"] },
    records: [
      {
        playerId: firstCandidateId,
        externalPlayerId: "101",
        name: "Visible Player One",
        team: "Hidden Club One",
        teamId: "7",
        competition: "League A",
        competitionId: "8",
        season: "2017/18",
        ageAtSeasonEnd: 23,
        position: "MID",
        minutes: 900,
        appearanceMatches: 10,
        eventDataComplete: true,
        metrics: [{
          key: "progressivePasses",
          value: 1.4,
          unit: "per90",
          type: "event_derived_estimate",
          definition: "Progressive passes per 90 minutes.",
          sourceField: "pass events; progressive distance rule v2",
          sampleMinutes: 900,
          sampleMatches: 10,
          normalization: "per90",
        }],
      },
      {
        playerId: secondCandidateId,
        externalPlayerId: "202",
        name: "Visible Player Two",
        team: "Hidden Club Two",
        teamId: "9",
        competition: "League A",
        competitionId: "8",
        season: "2017/18",
        ageAtSeasonEnd: null,
        position: "MID",
        minutes: 450,
        appearanceMatches: 5,
        eventDataComplete: true,
        metrics: [],
      },
    ],
  });
  const snapshotSha256 = createHash("sha256").update(snapshotJson).digest("hex");
  return {
    snapshotJson,
    blindingSecret: "test-only-blinding-secret-with-enough-entropy",
    request: {
      queryId: "barcelona-midfielder-v1",
      roleBrief: "为巴萨寻找一名具备向前推进能力的中场。",
      snapshotSha256,
      candidateIds: [firstCandidateId, secondCandidateId],
      metricKeys: ["progressivePasses", "pressures"],
      systemRankings: [{
        systemId: "system-private-name",
        runId: "run-1",
        candidateIds: [firstCandidateId, secondCandidateId],
      }],
    },
  };
}

test("blinded review packet keeps source evidence while moving identity and system ranks to the answer key", () => {
  const input = exportInput();
  const result = exportBlindedReviewPackets(input);
  const repeatedResult = exportBlindedReviewPackets(input);
  assert.equal(BlindedReviewerPacketSchema.safeParse(result.reviewerPacket).success, true);
  const packetText = JSON.stringify(result.reviewerPacket);
  const repeatedPacketText = JSON.stringify(repeatedResult.reviewerPacket);
  const firstCard = result.reviewerPacket.cards.find((card) => (
    result.answerKey.cards.find((answer) => answer.cardId === card.cardId)?.sourcePlayerIds.includes(firstCandidateId)
  ));
  const firstAnswer = result.answerKey.cards.find((answer) => answer.sourcePlayerIds.includes(firstCandidateId));

  assert.ok(firstCard);
  assert.ok(firstAnswer);
  assert.equal(result.reviewerPacket.schemaVersion, 2);
  assert.equal(result.answerKey.schemaVersion, 2);
  assert.equal(firstCard.performances[0]?.position, "MID");
  assert.equal(firstCard.performances[0]?.ageAtSeasonEnd, 23);
  assert.equal(firstCard.performances[0]?.competition, "League A");
  assert.equal(firstCard.performances[0]?.season, "2017/18");
  assert.equal(result.reviewerPacket.snapshot.attribution, "Wyscout Open Data, CC BY 4.0");
  assert.equal(result.reviewerPacket.snapshot.sha256, input.request.snapshotSha256);
  assert.equal(result.reviewerPacket.snapshot.asOf, "2026-10-09T00:00:00.000Z");
  assert.deepEqual(firstCard.performances[0]?.sampleSize, { minutes: 900, matches: 10 });
  assert.deepEqual(firstCard.performances[0]?.metrics[0], {
    key: "progressivePasses",
    status: "observed",
    value: 1.4,
    unit: "per90",
    definition: "Progressive passes per 90 minutes.",
    sourceField: "pass events; progressive distance rule v2",
    sampleSize: { minutes: 900, matches: 10 },
  });
  assert.equal(firstCard.performances[0]?.metrics[1]?.status, "missing");
  assert.equal(firstCard.performances[0]?.metrics[1]?.value, null);
  assert.equal(firstCard.performances[0]?.metrics[1]?.unit, null);
  assert.equal(firstAnswer.playerName, "Visible Player One");
  assert.equal(firstAnswer.sourcePlayerIds.length, 1);
  assert.equal(firstAnswer.teamStints[0]?.team, "Hidden Club One");
  assert.equal(firstAnswer.systemRanks[0]?.rank, 1);
  assert.equal(firstAnswer.systemRanks[0]?.systemId, "system-private-name");
  assert.doesNotMatch(packetText, /Visible Player|Hidden Club|wyscout:101|system-private-name|run-1/);
  assert.equal(result.reviewerPacket.cards.length, 2);
  assert.equal(repeatedPacketText, packetText);
});

test("review packet carries the shared 0–3 and unknown rating anchors", () => {
  const { reviewerPacket } = exportBlindedReviewPackets(exportInput());
  const rubricInstructions = reviewerPacket.reviewerInstructions.filter((instruction) => instruction.startsWith("评分锚点："));

  assert.deepEqual(rubricInstructions, [
    "评分锚点：0 = 明确不符：充分且直接的证据表明不满足冻结职责，或违反本次明确的硬条件；缺少或未覆盖的数据不能判 0。",
    "评分锚点：1 = 较弱或部分吻合：证据较弱，或只覆盖职责的一部分。",
    "评分锚点：2 = 有合理证据支持：来源证据合理支持候选具备本次点名的能力或职责，但支持尚未达到 3 分。",
    "评分锚点：3 = 高度符合目标职责：来源证据对本次点名能力或职责提供强而直接的支持。",
    "评分锚点：unknown = 未知：现有材料无法判断适配度，例如缺字段、样本不足、指标与能力不对应或信息含糊；它既不是 0 分，也不表示不适配。",
  ]);
});

test("an exported packet and answer key produce a de-identified evaluable benchmark input", () => {
  const exported = exportBlindedReviewPackets(exportInput());
  const cardIds = exported.reviewerPacket.cards.map(({ cardId }) => cardId);
  const submissions = ["reviewer-a", "reviewer-b"].map((reviewerId) => ({
    schemaVersion: 1,
    benchmarkId: "human-shortlist-fit-v1",
    packetId: exported.reviewerPacket.packetId,
    reviewerId,
    ratings: [
      { cardId: cardIds[0]!, rating: 3 },
      { cardId: cardIds[1]!, rating: 1 },
    ],
  }));
  const adjudications = [
    { cardId: cardIds[0]!, grade: 3 },
    { cardId: cardIds[1]!, grade: 1 },
  ];

  const dataset = createShortlistQualityDataset({
    packet: exported.reviewerPacket,
    answerKey: exported.answerKey,
    submissions,
    adjudications,
  });
  const result = evaluateShortlistQuality(dataset);

  assert.equal(result.status, "evaluable");
  assert.deepEqual(dataset.queries[0]?.candidateIds, cardIds);
  assert.equal(dataset.queries[0]?.systemRankings[0]?.candidateIds.length, 2);
  assert.doesNotMatch(JSON.stringify(dataset), /Visible Player|Hidden Club|wyscout:101/);
  assert.equal(dataset.queries[0]?.systemRankings[0]?.systemId, "system-private-name");
});

test("export rejects a snapshot whose raw file hash differs from the frozen request", () => {
  const input = exportInput();
  input.request.snapshotSha256 = "f".repeat(64);

  assert.throws(() => exportBlindedReviewPackets(input), /SHA-256/);
});

test("export rejects a CC BY label with a different license URL", () => {
  const input = exportInput();
  const snapshot = JSON.parse(input.snapshotJson) as { license: { url: string } };
  snapshot.license.url = "https://example.com/terms";
  input.snapshotJson = JSON.stringify(snapshot);
  input.request.snapshotSha256 = createHash("sha256").update(input.snapshotJson).digest("hex");

  assert.throws(() => exportBlindedReviewPackets(input), /CC BY 4.0/);
});

test("export rejects system rankings that refer to candidates outside the frozen pool", () => {
  const input = exportInput();
  input.request.systemRankings[0]!.candidateIds.push("unpooled-candidate");

  assert.throws(() => exportBlindedReviewPackets(input), /候选池之外/);
});

test("export rejects a candidate that is absent from the frozen source snapshot", () => {
  const input = exportInput();
  input.request.candidateIds.push("unobserved-candidate");

  assert.throws(() => exportBlindedReviewPackets(input), /不在快照中/);
});

test("export groups split team records for the same player into one anonymous card without merging metrics", () => {
  const input = exportInput();
  const snapshot = JSON.parse(input.snapshotJson) as { records: Array<{ externalPlayerId: string }> };
  snapshot.records[1]!.externalPlayerId = snapshot.records[0]!.externalPlayerId;
  input.snapshotJson = JSON.stringify(snapshot);
  input.request.snapshotSha256 = createHash("sha256").update(input.snapshotJson).digest("hex");
  input.request.systemRankings[0]!.candidateIds = [firstCandidateId];

  const result = exportBlindedReviewPackets(input);
  assert.equal(result.reviewerPacket.cards.length, 1);
  assert.equal(result.reviewerPacket.cards[0]?.performances.length, 2);
  assert.equal(result.answerKey.cards[0]?.sourcePlayerIds.length, 2);
  assert.equal(result.answerKey.cards[0]?.teamStints.length, 2);
  assert.equal(result.answerKey.cards[0]?.systemRanks[0]?.rank, 1);
  assert.equal(result.reviewerPacket.cards[0]?.performances[0]?.metrics[0]?.value, 1.4);
  assert.equal(result.reviewerPacket.cards[0]?.performances[1]?.metrics[0]?.status, "missing");
});

test("missing candidate metrics retain the snapshot's metric definition without inventing a value", () => {
  const result = exportBlindedReviewPackets(exportInput());
  const secondCard = result.reviewerPacket.cards.find((card) => (
    result.answerKey.cards.find((answer) => answer.cardId === card.cardId)?.sourcePlayerIds.includes(secondCandidateId)
  ));

  assert.ok(secondCard);
  assert.equal(secondCard.performances[0]?.ageAtSeasonEnd, null);
  assert.deepEqual(secondCard.performances[0]?.metrics[0], {
    key: "progressivePasses",
    status: "missing",
    value: null,
    unit: "per90",
    definition: "Progressive passes per 90 minutes.",
    sourceField: "pass events; progressive distance rule v2",
    sampleSize: { minutes: null, matches: null },
  });
});

test("export rejects conflicting source definitions for the same requested metric", () => {
  const input = exportInput();
  const snapshot = JSON.parse(input.snapshotJson) as {
    records: Array<{ metrics: Array<Record<string, unknown>> }>;
  };
  snapshot.records[1]!.metrics.push({
    ...snapshot.records[0]!.metrics[0]!,
    definition: "A conflicting definition for the same source metric.",
  });
  input.snapshotJson = JSON.stringify(snapshot);
  input.request.snapshotSha256 = createHash("sha256").update(input.snapshotJson).digest("hex");

  assert.throws(() => exportBlindedReviewPackets(input), /互相冲突的定义/);
});
