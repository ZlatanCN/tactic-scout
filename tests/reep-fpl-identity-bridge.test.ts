import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveHistoricalCandidateIdentity } from "../src/data/historical-archive-enrichment.js";
import type { PlayerDataSourceIdentity } from "../src/domain/schemas.js";
import { importReepRelease } from "../src/identity/import-reep-release.js";
import { ReepIdentityRegistry, type ReepIdentityResolution } from "../src/identity/reep-registry.js";

function resolution(provider: string, namespace: string, externalId: string, reepId: string): ReepIdentityResolution {
  const source = { provider, namespace, externalId };
  return {
    status: "resolved",
    releaseStamp: "20261005T180536Z",
    source,
    reepId,
    matchedBridges: [{ ...source, sourceReepId: reepId, canonicalReepId: reepId, redirectStatus: "resolved", rung: "crosswalk", upstreamStatus: "active" }],
    linkedBridges: [],
  };
}

test("FPL candidates resolve historical identity only through exact provider identifiers", () => {
  const sourceIdentity: PlayerDataSourceIdentity = {
    provider: "fantasy-premier-league",
    playerId: "101",
    retrievedAt: "2026-10-07T05:00:00.000Z",
    providerIdentifiers: [{ provider: "opta", namespace: "person_numeric", externalId: "987654", sourceField: "opta_code" }],
  };
  const bridge = resolution("opta", "person_numeric", "987654", "reep-person-1");
  const registry = {
    resolveSourceProvider: () => ({
      status: "unsupported_provider",
      releaseStamp: "20261005T180536Z",
      source: { provider: "fantasy-premier-league", namespace: "", externalId: "101" },
      matchedBridges: [],
      linkedBridges: [],
    } satisfies ReepIdentityResolution),
    resolveExact: () => bridge,
  };

  assert.deepEqual(resolveHistoricalCandidateIdentity(sourceIdentity, registry), {
    identity: bridge,
    sourceBridge: { provider: "opta", namespace: "person_numeric", externalId: "987654", sourceField: "opta_code" },
  });
});

test("conflicting exact provider identifiers are refused instead of picking one identity", () => {
  const sourceIdentity: PlayerDataSourceIdentity = {
    provider: "fantasy-premier-league",
    playerId: "101",
    retrievedAt: "2026-10-07T05:00:00.000Z",
    providerIdentifiers: [
      { provider: "opta", namespace: "person_numeric", externalId: "987654", sourceField: "opta_code" },
      { provider: "opta", namespace: "person_numeric", externalId: "123456", sourceField: "other_observed_field" },
    ],
  };
  const registry = {
    resolveSourceProvider: () => ({
      status: "unsupported_provider",
      releaseStamp: "20261005T180536Z",
      source: { provider: "fantasy-premier-league", namespace: "", externalId: "101" },
      matchedBridges: [],
      linkedBridges: [],
    } satisfies ReepIdentityResolution),
    resolveExact: (_provider: string, _namespace: string, externalId: string) =>
      resolution("opta", "person_numeric", externalId, externalId === "987654" ? "reep-person-1" : "reep-person-2"),
  };

  assert.equal(resolveHistoricalCandidateIdentity(sourceIdentity, registry), null);
});

test("Reep importer resolves exact Understat candidate IDs to linked Wyscout history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tactiscout-reep-opta-"));
  const bridgesPath = path.join(root, "bridges.csv.gz");
  const redirectsPath = path.join(root, "redirects.csv.gz");
  const outputPath = path.join(root, "identity.sqlite");
  await Promise.all([
    writeFile(bridgesPath, gzipSync(Buffer.from([
      "provider,namespace,external_id,reep_id,rung,upstream_status",
      "opta,person_numeric,987654,reep-person-1,crosswalk,active",
      "wyscout,player,2468,reep-person-1,source_key,active",
      "understat,player,50001,reep-person-2,crosswalk,active",
      "wyscout,player,70001,reep-person-2,source_key,active",
    ].join("\n")))),
    writeFile(redirectsPath, gzipSync(Buffer.from("from_id,to_id,reason\n"))),
  ]);

  try {
    await importReepRelease({ bridgesPath, redirectsPath, releaseStamp: "20261005T180536Z", outputPath });
    const registry = new ReepIdentityRegistry(outputPath);
    try {
      const identity = registry.resolveSourceProvider("understat", "50001");
      assert.equal(identity.status, "resolved");
      assert.equal(identity.reepId, "reep-person-2");
      assert.deepEqual(identity.linkedBridges.map(({ provider, namespace, externalId }) => ({ provider, namespace, externalId })), [
        { provider: "understat", namespace: "player", externalId: "50001" },
        { provider: "wyscout", namespace: "player", externalId: "70001" },
      ]);

      const historicalIdentity = resolveHistoricalCandidateIdentity({
        provider: "understat",
        playerId: "50001",
        retrievedAt: "2026-10-10T00:00:00.000Z",
      }, registry);
      assert.equal(historicalIdentity?.identity.reepId, "reep-person-2");
      assert.deepEqual(historicalIdentity?.sourceBridge, {
        provider: "understat",
        namespace: "player",
        externalId: "50001",
        sourceField: null,
      });
      assert.equal(registry.resolveSourceProvider("american-soccer-analysis", "50001").status, "unsupported_provider");
    } finally {
      registry.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
