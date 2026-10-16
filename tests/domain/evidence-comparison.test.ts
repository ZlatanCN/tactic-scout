import assert from "node:assert/strict";
import test from "node:test";
import {
  comparePeerPercentile,
  getPeerPercentileUnavailableReason,
  minimumMinutesForPercentileComparison,
} from "../../src/domain/evidence-comparison.js";

test("a low-minute candidate keeps the observed value but receives no peer percentile", () => {
  const result = comparePeerPercentile(16.88, 16, Array.from({ length: 8 }, (_, index) => ({
    value: index + 1,
    minutes: 1200,
  })));

  assert.equal(result.peerPercentile, null);
  assert.equal(result.peerGroupSize, 8);
  assert.equal(result.peerPercentileUnavailableReason, "candidate_low_sample");
});

test("unknown candidate metric minutes never qualify for a percentile", () => {
  const result = comparePeerPercentile(5, null, Array.from({ length: 8 }, (_, index) => ({
    value: index + 1,
    minutes: 1200,
  })));

  assert.equal(result.peerPercentile, null);
  assert.equal(result.peerGroupSize, 8);
  assert.equal(result.peerPercentileUnavailableReason, "candidate_sample_unknown");
});

test("old report snapshots with a stored percentile are hidden when their metric sample is below the boundary", () => {
  assert.equal(getPeerPercentileUnavailableReason({ minutes: 16 }), "candidate_low_sample");
  assert.equal(getPeerPercentileUnavailableReason({ minutes: 1200 }), undefined);
  assert.equal(getPeerPercentileUnavailableReason({ minutes: null }), "candidate_sample_unknown");
  assert.equal(getPeerPercentileUnavailableReason({ minutes: 1200, recordedReason: "insufficient_peer_group" }), "insufficient_peer_group");
});

test("reference percentiles exclude peers below the established sample boundary", () => {
  const result = comparePeerPercentile(5, minimumMinutesForPercentileComparison, [
    { value: 1, minutes: 899 },
    { value: 2, minutes: 900 },
    { value: 3, minutes: 1200 },
    { value: 4, minutes: 1400 },
    { value: 5, minutes: 1800 },
    { value: 6, minutes: 2400 },
    { value: 7, minutes: 2800 },
  ]);

  assert.equal(result.peerGroupSize, 6);
  assert.equal(result.peerPercentile, 67);
  assert.equal(result.peerPercentileUnavailableReason, undefined);
});

test("high-minute candidates do not get a percentile from fewer than five stable peers", () => {
  const result = comparePeerPercentile(5, 1200, [
    { value: 1, minutes: 1200 },
    { value: 2, minutes: 1400 },
    { value: 3, minutes: 1600 },
    { value: 4, minutes: 1800 },
    { value: 100, minutes: 899 },
    { value: 200, minutes: null },
  ]);

  assert.equal(result.peerPercentile, null);
  assert.equal(result.peerGroupSize, 4);
  assert.equal(result.peerPercentileUnavailableReason, "insufficient_peer_group");
});

test("an unreported competition scope blocks percentile comparison even with sufficient minutes", () => {
  assert.equal(getPeerPercentileUnavailableReason({
    minutes: 1800,
    recordedReason: "competition_scope_unreported",
  }), "competition_scope_unreported");
});
