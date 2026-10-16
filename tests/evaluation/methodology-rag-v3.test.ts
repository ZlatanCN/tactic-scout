import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MethodologyRelevanceV2DatasetSchema,
  MethodologyRelevanceV3DatasetSchema,
} from "../../src/evaluation/methodology-rag-v2-evaluation.js";

const v2Path = new URL("../../data/evaluations/methodology-rag-v2.json", import.meta.url);
const v3Path = new URL("../../data/evaluations/methodology-rag-v3.json", import.meta.url);

test("methodology RAG v3 is immutable alongside the original v2 data and covers all sources and answerability classes", async () => {
  const [v2Raw, v3Raw] = await Promise.all([
    readFile(v2Path, "utf8").then((value) => JSON.parse(value) as unknown),
    readFile(v3Path, "utf8").then((value) => JSON.parse(value) as unknown),
  ]);
  const v2 = MethodologyRelevanceV2DatasetSchema.parse(v2Raw);
  const v3 = MethodologyRelevanceV3DatasetSchema.parse(v3Raw);

  assert.equal(v2.datasetId, "methodology-rag-v2");
  assert.equal(v3.datasetId, "methodology-rag-v3");
  assert.deepEqual(v3.sourceIds, [
    "plos-soccer-analysis-2024",
    "plos-position-specific-physical-performance-2021",
    "frontiers-positional-role-2022",
  ]);
  for (const split of ["calibration", "heldout"] as const) {
    const queries = v3.queries.filter((query) => query.split === split);
    assert.deepEqual(new Set(queries.map(({ answerability }) => answerability)), new Set(["answerable", "ambiguous", "out_of_scope"]));
    for (const sourceId of v3.sourceIds) {
      assert.ok(queries.some((query) => query.relevantSourceIds.includes(sourceId)), `${split} needs a relevant query for ${sourceId}`);
    }
  }
  const calibrationFamilies = new Set(v3.queries.filter((query) => query.split === "calibration").map(({ queryFamily }) => queryFamily));
  assert.ok(v3.queries.filter((query) => query.split === "heldout").every(({ queryFamily }) => !calibrationFamilies.has(queryFamily)));
});
