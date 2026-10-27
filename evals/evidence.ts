import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateRawSync } from "node:zlib";

import type {
  DeclaredEvaluationDataFault,
  EvaluationEvidenceBundle,
} from "./contracts.js";

type PreparedEvidenceBundle = {
  bundleId: string;
  bundleHash: string;
  databases: {
    fm: string;
    identity: string;
    understat: string;
  };
  origin: "real" | "synthetic" | "mixed";
};

const sha256 = (filePath: string): string =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const writeFmDatabase = (
  databasePath: string,
  bundle: EvaluationEvidenceBundle
): void => {
  const database = new DatabaseSync(databasePath);

  try {
    database.exec(
      "CREATE TABLE manifest (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);" +
        "CREATE TABLE players (record_id TEXT PRIMARY KEY, unique_id TEXT UNIQUE, name TEXT, birth_date TEXT, payload BLOB NOT NULL);" +
        "CREATE TABLE aliases (record_id TEXT NOT NULL, name TEXT NOT NULL);" +
        "CREATE TABLE positions (position TEXT NOT NULL, rating INTEGER NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY (position, record_id));"
    );
    database
      .prepare("INSERT INTO manifest (id, payload) VALUES (1, ?)")
      .run(JSON.stringify(bundle.fm.manifest));

    const insertPlayer = database.prepare(
      "INSERT INTO players (record_id, unique_id, name, birth_date, payload) VALUES (?, ?, ?, ?, ?)"
    );

    const insertAlias = database.prepare(
      "INSERT INTO aliases (record_id, name) VALUES (?, ?)"
    );

    const insertPosition = database.prepare(
      "INSERT INTO positions (position, rating, record_id) VALUES (?, ?, ?)"
    );

    for (const player of bundle.fm.players) {
      insertPlayer.run(
        player.recordId,
        player.uniqueId,
        player.name,
        player.birthDate,
        deflateRawSync(Buffer.from(JSON.stringify(player.payload), "utf-8"))
      );

      for (const alias of player.aliases) {
        insertAlias.run(player.recordId, alias);
      }
    }

    for (const position of bundle.fm.positions) {
      insertPosition.run(position.position, position.rating, position.recordId);
    }
  } finally {
    database.close();
  }
};

const writeUnderstatDatabase = (
  databasePath: string,
  bundle: EvaluationEvidenceBundle
): void => {
  const database = new DatabaseSync(databasePath);

  try {
    database.exec(
      "CREATE TABLE source_snapshots (kind TEXT NOT NULL, resource_id TEXT NOT NULL, captured_at TEXT NOT NULL, parser_version TEXT NOT NULL, schema_version INTEGER NOT NULL, season_start_year INTEGER NOT NULL, payload_json TEXT NOT NULL);"
    );

    const insertSnapshot = database.prepare(
      "INSERT INTO source_snapshots (kind, resource_id, captured_at, parser_version, schema_version, season_start_year, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    for (const snapshot of bundle.understat.snapshots) {
      insertSnapshot.run(
        snapshot.kind,
        snapshot.resourceId,
        snapshot.capturedAt,
        snapshot.parserVersion,
        snapshot.schemaVersion,
        snapshot.seasonStartYear,
        JSON.stringify({ players: snapshot.players })
      );
    }
  } finally {
    database.close();
  }
};

const writeIdentityDatabase = (
  databasePath: string,
  bundle: EvaluationEvidenceBundle,
  malformedBridge: boolean
): void => {
  const database = new DatabaseSync(databasePath);

  try {
    database.exec(
      `CREATE TABLE metadata (key TEXT NOT NULL, value TEXT NOT NULL);` +
        `CREATE TABLE bridges (provider TEXT NOT NULL, namespace TEXT NOT NULL, external_id TEXT NOT NULL, canonical_reep_id ${
          malformedBridge ? "" : "TEXT"
        }, redirect_status TEXT NOT NULL);`
    );
    database
      .prepare("INSERT INTO metadata (key, value) VALUES ('release_stamp', ?)")
      .run(bundle.identity.releaseStamp);

    const insertBridge = database.prepare(
      "INSERT INTO bridges (provider, namespace, external_id, canonical_reep_id, redirect_status) VALUES (?, 'player', ?, ?, ?)"
    );

    for (const [index, bridge] of bundle.identity.bridges.entries()) {
      const canonicalReepId =
        malformedBridge && index === 0 ? 42 : bridge.canonicalReepId;

      insertBridge.run(
        bridge.provider,
        bridge.externalId,
        canonicalReepId,
        bridge.redirectStatus
      );
    }
  } finally {
    database.close();
  }
};

const prepareEvidenceBundle = (
  bundle: EvaluationEvidenceBundle,
  workspaceDirectory: string,
  declaredFaults: DeclaredEvaluationDataFault[] = []
): PreparedEvidenceBundle => {
  if (declaredFaults.length > 0 && bundle.origin !== "synthetic") {
    throw new Error(
      "Declared local data faults are permitted only for synthetic evidence."
    );
  }

  const faultSuffix =
    declaredFaults.length === 0 ? "" : `-fault-${declaredFaults.join("-")}`;

  const bundleDirectory = path.join(
    workspaceDirectory,
    bundle.bundleId + faultSuffix
  );

  mkdirSync(bundleDirectory, { recursive: true });

  const databases = {
    fm: path.join(bundleDirectory, "fm.sqlite"),
    identity: path.join(bundleDirectory, "identity.sqlite"),
    understat: path.join(bundleDirectory, "understat.sqlite"),
  };

  const faultSet = new Set(declaredFaults);

  if (!faultSet.has("fm_snapshot_missing")) {
    writeFmDatabase(databases.fm, bundle);
  }

  if (!faultSet.has("understat_snapshot_missing")) {
    writeUnderstatDatabase(databases.understat, bundle);
  }

  writeIdentityDatabase(
    databases.identity,
    bundle,
    faultSet.has("reep_bridge_malformed")
  );

  const bundleHash = createHash("sha256")
    .update(
      existsSync(databases.fm) ? sha256(databases.fm) : "declared-missing:fm"
    )
    .update(
      existsSync(databases.understat)
        ? sha256(databases.understat)
        : "declared-missing:understat"
    )
    .update(sha256(databases.identity))
    .digest("hex");

  return {
    bundleHash,
    bundleId: bundle.bundleId,
    databases,
    origin: bundle.origin,
  };
};

export { prepareEvidenceBundle };

export type { PreparedEvidenceBundle };
