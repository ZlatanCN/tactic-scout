import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SqliteUnderstatSnapshotStore, UnderstatDataGateway } from "../../src/sources/understat/data-gateway.js";
import { UNDERSTAT_PARSER_VERSION } from "../../src/sources/understat/parser-version.js";

test("reuses a raw SQLite snapshot after reopening the database", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "tactiscout-understat-"));
  const databasePath = path.join(directory, "snapshots.sqlite");
  let requestCount = 0;
  const payload = { players: [{ id: "7", goals: 0, xA: null }] };
  try {
    const firstStore = new SqliteUnderstatSnapshotStore(databasePath);
    const firstGateway = new UnderstatDataGateway({
      snapshotStore: firstStore,
      fetchImpl: async () => {
        requestCount += 1;
        return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
      },
      now: () => new Date("2026-10-15T10:00:00.000Z"),
    });
    const first = await firstGateway.get("league", "EPL", 2026);
    firstStore.close?.();

    const secondStore = new SqliteUnderstatSnapshotStore(databasePath);
    const secondGateway = new UnderstatDataGateway({
      snapshotStore: secondStore,
      fetchImpl: async () => {
        requestCount += 1;
        throw new Error("fresh persisted snapshots must not issue a request");
      },
      now: () => new Date("2026-10-15T10:01:00.000Z"),
    });
    const second = await secondGateway.get("league", "EPL", 2026);
    secondStore.close?.();

    assert.deepEqual(second.payload, payload);
    assert.equal(second.retrievedAt, first.retrievedAt);
    assert.equal(requestCount, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migrates older snapshot databases and persists parser version metadata", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "tactiscout-understat-migration-"));
  const databasePath = path.join(directory, "snapshots.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(
    "CREATE TABLE source_snapshots (" +
    "kind TEXT NOT NULL, resource_id TEXT NOT NULL, season_start_year INTEGER NOT NULL, " +
    "payload_json TEXT NOT NULL, retrieved_at TEXT NOT NULL, schema_version INTEGER NOT NULL, " +
    "PRIMARY KEY (kind, resource_id, season_start_year));" +
    "INSERT INTO source_snapshots VALUES ('player', '7', -1, '{\"player\":{\"id\":\"7\"}}', '2026-10-15T10:00:00.000Z', 1);",
  );
  legacy.close();

  try {
    const firstStore = new SqliteUnderstatSnapshotStore(databasePath);
    const key = { kind: "player" as const, resourceId: "7", seasonStartYear: null };
    const oldSnapshot = firstStore.read(key);
    assert.equal(oldSnapshot?.parserVersion, "unknown", "legacy snapshots must be clearly marked until refreshed");
    const gateway = new UnderstatDataGateway({
      snapshotStore: firstStore,
      fetchImpl: async () => { throw new Error("a parser upgrade should replay the fresh raw snapshot without network access"); },
      now: () => new Date("2026-10-15T10:01:00.000Z"),
    });
    assert.deepEqual((await gateway.get("player", "7", null)).payload, { player: { id: "7" } });
    firstStore.close?.();

    const reopened = new SqliteUnderstatSnapshotStore(databasePath);
    assert.equal(reopened.read(key)?.parserVersion, UNDERSTAT_PARSER_VERSION);
    reopened.close?.();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an explicit refresh replaces the persisted Understat snapshot", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "tactiscout-understat-refresh-"));
  const databasePath = path.join(directory, "snapshots.sqlite");
  let requestCount = 0;
  try {
    const store = new SqliteUnderstatSnapshotStore(databasePath);
    const gateway = new UnderstatDataGateway({
      snapshotStore: store,
      fetchImpl: async () => {
        requestCount += 1;
        return new Response(JSON.stringify({ version: requestCount }), { status: 200, headers: { "content-type": "application/json" } });
      },
      now: () => new Date("2026-10-15T10:00:00.000Z"),
    });

    assert.deepEqual((await gateway.get("league", "EPL", 2026)).payload, { version: 1 });
    assert.deepEqual((await gateway.get("league", "EPL", 2026, { refresh: true })).payload, { version: 2 });
    store.close?.();

    const reopened = new SqliteUnderstatSnapshotStore(databasePath);
    assert.deepEqual(reopened.read({ kind: "league", resourceId: "EPL", seasonStartYear: 2026 })?.payload, { version: 2 });
    reopened.close?.();
    assert.equal(requestCount, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
