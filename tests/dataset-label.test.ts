import assert from "node:assert/strict";
import test from "node:test";
import { shortDatasetId } from "../web/src/dataset-label.js";

test("shows the snapshot schema and derived metric ruleset as separate versions", () => {
  assert.equal(
    shortDatasetId("tactiscout-wyscout-v1-401a88b80cc2-tactiscout-wyscout-events-v2"),
    "格式 v1 · 指标规则 events v2 · 401a88b80cc2",
  );
});

test("keeps the historical ruleset version visible", () => {
  assert.equal(
    shortDatasetId("tactiscout-wyscout-v1-401a88b80cc2-tactiscout-wyscout-events-v1"),
    "格式 v1 · 指标规则 events v1 · 401a88b80cc2",
  );
});

test("falls back to the full identifier when it has no recognized version metadata", () => {
  assert.equal(shortDatasetId("custom-dataset"), "custom-dataset");
});
