import assert from "node:assert/strict";
import test from "node:test";
import {
  createShortlistReviewSubmission,
  createShortlistReviewWorkspace,
  parseBlindedReviewerPacket,
  type ShortlistReviewStorage,
} from "../../src/domain/shortlist-review.js";

const reviewerPacket = {
  schemaVersion: 2,
  benchmarkId: "human-shortlist-fit-v1",
  packetId: "packet-review-demo",
  roleBrief: "为巴萨寻找一名具备向前推进能力的中场。",
  snapshot: {
    source: "Historical match-event dataset",
    publisher: "Wyscout",
    attribution: "Wyscout Open Data, CC BY 4.0",
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    datasetId: "tactiscout-wyscout-v1-example",
    sha256: "a".repeat(64),
    asOf: "2026-10-09T00:00:00.000Z",
    derivationRuleset: "tactiscout-wyscout-events-v2",
    scope: "2017/18 League A",
  },
  cards: [
    {
      cardId: "card_alpha",
      performances: [{
        position: "MID",
        ageAtSeasonEnd: 23,
        competition: "League A",
        season: "2017/18",
        sampleSize: { minutes: 900, matches: 10 },
        metrics: [{
          key: "progressivePasses",
          status: "observed",
          value: 1.4,
          unit: "per90",
          definition: "Progressive passes per 90 minutes.",
          sourceField: "pass events; progressive distance rule v2",
          sampleSize: { minutes: 900, matches: 10 },
        }],
      }],
    },
    {
      cardId: "card_bravo",
      performances: [{
        position: "MID",
        ageAtSeasonEnd: null,
        competition: "League A",
        season: "2017/18",
        sampleSize: { minutes: 450, matches: 5 },
        metrics: [{
          key: "progressivePasses",
          status: "missing",
          value: null,
          unit: "per90",
          definition: "Progressive passes per 90 minutes.",
          sourceField: "pass events; progressive distance rule v2",
          sampleSize: { minutes: null, matches: null },
        }],
      }],
    },
  ],
  reviewerInstructions: ["按固定需求评估，缺少信息时可以选择 unknown。"],
};

class MemoryStorage implements ShortlistReviewStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("a blind-review submission includes one anonymous rating per packet card", () => {
  const result = createShortlistReviewSubmission({
    packet: reviewerPacket,
    reviewerId: "scout-a",
    ratings: { card_alpha: 3, card_bravo: "unknown" },
  });

  assert.deepEqual(result, {
    schemaVersion: 1,
    benchmarkId: "human-shortlist-fit-v1",
    packetId: "packet-review-demo",
    reviewerId: "scout-a",
    ratings: [
      { cardId: "card_alpha", rating: 3 },
      { cardId: "card_bravo", rating: "unknown" },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /Historical match|Wyscout|League A|progressivePasses|system|player/i);
});

test("a blind-review submission cannot omit a card or rate a card outside the packet", () => {
  assert.throws(() => createShortlistReviewSubmission({
    packet: reviewerPacket,
    reviewerId: "scout-a",
    ratings: { card_alpha: 2 },
  }), /每张卡片都需要评分/);
  assert.throws(() => createShortlistReviewSubmission({
    packet: reviewerPacket,
    reviewerId: "scout-a",
    ratings: { card_alpha: 2, card_bravo: 1, card_hidden: 3 },
  }), /不属于当前评审包/);
});

test("a blind-review draft survives reopening and keeps reviewers isolated", () => {
  const storage = new MemoryStorage();
  const firstWorkspace = createShortlistReviewWorkspace(storage);
  const firstSession = firstWorkspace.open(JSON.stringify(reviewerPacket), "scout-a");

  const ratedSession = firstWorkspace.rate(firstSession, "card_alpha", 2);
  firstWorkspace.rate(ratedSession, "card_bravo", "unknown");

  const reopenedWorkspace = createShortlistReviewWorkspace(storage);
  const reopenedSession = reopenedWorkspace.loadActive();
  assert.ok(reopenedSession);
  assert.equal(reopenedSession.reviewerId, "scout-a");
  assert.deepEqual(reopenedSession.ratings, { card_alpha: 2, card_bravo: "unknown" });
  assert.equal(reopenedWorkspace.createSubmission(reopenedSession).ratings.length, 2);

  const otherReviewer = reopenedWorkspace.open(JSON.stringify(reviewerPacket), "scout-b");
  assert.deepEqual(otherReviewer.ratings, {});
});

test("the blind-review workspace rejects an answer key as reviewer input", () => {
  const workspace = createShortlistReviewWorkspace(new MemoryStorage());
  assert.throws(() => workspace.open(JSON.stringify({
    schemaVersion: 2,
    packetId: "packet-review-demo",
    cards: [{ cardId: "card_alpha", playerName: "Visible Player" }],
  }), "scout-a"), /评审包格式无效/);
});

test("the blind-review packet parser rejects unsupported versions, duplicate cards, and identity fields", () => {
  assert.throws(() => parseBlindedReviewerPacket(JSON.stringify({ ...reviewerPacket, schemaVersion: 3 })), /评审包格式无效/);
  assert.throws(() => parseBlindedReviewerPacket(JSON.stringify({
    ...reviewerPacket,
    cards: [reviewerPacket.cards[0], reviewerPacket.cards[0]],
  })), /重复匿名卡 ID/);
  assert.throws(() => parseBlindedReviewerPacket(JSON.stringify({
    ...reviewerPacket,
    cards: [{ ...reviewerPacket.cards[0], playerName: "A player" }, reviewerPacket.cards[1]],
  })), /评审包格式无效/);
  assert.throws(() => parseBlindedReviewerPacket(JSON.stringify({
    ...reviewerPacket,
    cards: [{
      ...reviewerPacket.cards[0],
      performances: [{
        ...reviewerPacket.cards[0].performances[0],
        metrics: [{ ...reviewerPacket.cards[0].performances[0].metrics[0], value: "not-a-number" }],
      }],
    }, reviewerPacket.cards[1]],
  })), /评审包格式无效/);
});

test("a reviewer can clear the local draft without affecting another reviewer's session", () => {
  const storage = new MemoryStorage();
  const workspace = createShortlistReviewWorkspace(storage);
  const reviewerA = workspace.open(JSON.stringify(reviewerPacket), "scout-a");
  workspace.rate(reviewerA, "card_alpha", 2);
  const reviewerB = workspace.open(JSON.stringify(reviewerPacket), "scout-b");
  workspace.rate(reviewerB, "card_bravo", 1);

  workspace.clear(reviewerB);

  assert.equal(workspace.loadActive(), null);
  assert.deepEqual(workspace.open(JSON.stringify(reviewerPacket), "scout-a").ratings, { card_alpha: 2 });
  assert.deepEqual(workspace.open(JSON.stringify(reviewerPacket), "scout-b").ratings, {});
});
