import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EvidenceCatalog } from "../../src/knowledge/evidence-catalog.js";

test("retired index generations remain until the cross-process reader lease is released", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-evidence-catalog-generation-lease-"));
  const catalog = new EvidenceCatalog(path.join(directory, "catalog.sqlite"));
  const firstGenerationId = "generation-one";
  const secondGenerationId = "generation-two";
  const leaseId = "reader-lease-one";
  try {
    catalog.activateGeneration({
      generationId: firstGenerationId,
      embeddingModel: "fixture-e5",
      indexPath: path.join(directory, "index", firstGenerationId),
      rowCount: 1,
      expectedPreviousGenerationId: null,
    });
    assert.equal(catalog.acquireIndexGenerationLease(firstGenerationId, leaseId, new Date(Date.now() + 60_000).toISOString()), true);

    catalog.activateGeneration({
      generationId: secondGenerationId,
      embeddingModel: "fixture-e5",
      indexPath: path.join(directory, "index", secondGenerationId),
      rowCount: 1,
      expectedPreviousGenerationId: firstGenerationId,
    });

    assert.deepEqual(catalog.retiredGenerationsWithoutLeases(), []);
    assert.equal(catalog.acquireIndexGenerationLease(firstGenerationId, "late-reader", new Date(Date.now() + 60_000).toISOString()), false);

    catalog.releaseIndexGenerationLease(leaseId);
    assert.deepEqual(catalog.retiredGenerationsWithoutLeases().map(({ generationId, indexPath }) => ({ generationId, indexPath })), [{
      generationId: firstGenerationId,
      indexPath: path.join(directory, "index", firstGenerationId),
    }]);
    assert.equal(catalog.forgetRetiredGeneration(firstGenerationId), true);
    assert.deepEqual(catalog.retiredGenerationsWithoutLeases(), []);
  } finally {
    catalog.close();
    await rm(directory, { recursive: true, force: true });
  }
});
