import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateRawSync } from "node:zlib";

import { vi } from "vitest";

import type {
  FmRecommendationProfile,
  FmRecommendationReadResult,
} from "../../src/player-data/football-manager.js";
import { positionFeatureMap } from "../../src/player-data/position-features.js";

const temporaryDirectories: string[] = [];
const fixtureBirthDate = "2000-01-01";

const createFmDatabase = (
  profiles: { fmId: string; rating: number }[]
): string => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "tactiscout-recommendation-")
  );

  const databasePath = path.join(directory, "profiles.sqlite");
  const database = new DatabaseSync(databasePath);

  temporaryDirectories.push(directory);
  database.exec(
    "CREATE TABLE manifest (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);" +
      "CREATE TABLE players (record_id TEXT PRIMARY KEY, unique_id TEXT UNIQUE, name TEXT, birth_date TEXT, payload BLOB NOT NULL);" +
      "CREATE TABLE positions (position TEXT NOT NULL, rating INTEGER NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY (position, record_id));"
  );
  database.prepare("INSERT INTO manifest (id, payload) VALUES (1, ?)").run(
    JSON.stringify({
      databaseVersion: "test",
      gameBuild: "test-build",
      inGameDate: "2025-11-23",
      sha256: "fixture-manifest-sha",
    })
  );

  for (const [index, { fmId, rating }] of profiles.entries()) {
    const recordId = `record-${String(index + 1)}`;

    const featureValues = Object.fromEntries(
      positionFeatureMap.stc.features.map((feature, featureIndex) => [
        `raw_attributes_${feature}`,
        40 + ((index + featureIndex) % 50),
      ])
    );

    const payload = {
      ability_current: 120 + index,
      ability_potential: 180 + index,
      birth_date: fixtureBirthDate,
      common_name: `Player ${fmId}`,
      full_name: `Player ${fmId}`,
      natural_positions: "STC",
      unique_id: fmId,
      ...featureValues,
    };

    database
      .prepare(
        "INSERT INTO players (record_id, unique_id, name, birth_date, payload) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        recordId,
        fmId,
        `Player ${fmId}`,
        fixtureBirthDate,
        deflateRawSync(Buffer.from(JSON.stringify(payload)))
      );
    database
      .prepare(
        "INSERT INTO positions (position, rating, record_id) VALUES ('stc', ?, ?)"
      )
      .run(rating, recordId);
  }

  database.close();
  vi.stubEnv("TACTISCOUT_FM_PROFILES_PATH", databasePath);

  return databasePath;
};

const createIdentityDatabase = (
  bridges: { canonicalReepId: string; fmId: string }[]
): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "tactiscout-identity-"));
  const databasePath = path.join(directory, "identity.sqlite");
  const database = new DatabaseSync(databasePath);

  temporaryDirectories.push(directory);
  database.exec(
    "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
      "INSERT INTO metadata (key, value) VALUES ('release_stamp', 'test');" +
      "CREATE TABLE bridges (provider TEXT NOT NULL, namespace TEXT NOT NULL, external_id TEXT NOT NULL, canonical_reep_id TEXT, redirect_status TEXT NOT NULL);"
  );

  const insertBridge = database.prepare(
    "INSERT INTO bridges (provider, namespace, external_id, canonical_reep_id, redirect_status) VALUES ('fm', 'player', ?, ?, 'resolved')"
  );

  for (const { canonicalReepId, fmId } of bridges) {
    insertBridge.run(fmId, canonicalReepId);
  }

  database.close();
  vi.stubEnv("TACTISCOUT_REEP_IDENTITY_DB_PATH", databasePath);

  return databasePath;
};

const understatPlayer = (id: string, name: string, games?: string) => {
  const player = {
    assists: "2",
    goals: "5",
    id,
    key_passes: "3",
    npxG: "4.5",
    player_name: name,
    position: "F",
    shots: "20",
    team_title: "Fixture FC",
    time: "1200",
    xA: "1.2",
    xG: "5.1",
  };

  if (games !== undefined) {
    Object.assign(player, { games });
  }

  return player;
};

const createUnderstatDatabase = (
  players = [
    understatPlayer("selected-player", "Selected Player"),
    understatPlayer("namesake-player", "Same Name"),
  ]
): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "tactiscout-understat-"));
  const databasePath = path.join(directory, "understat.sqlite");
  const database = new DatabaseSync(databasePath);

  temporaryDirectories.push(directory);
  database.exec(
    "CREATE TABLE source_snapshots (kind TEXT NOT NULL, resource_id TEXT NOT NULL, season_start_year INTEGER NOT NULL, payload_json TEXT NOT NULL);"
  );

  const insertSnapshot = database.prepare(
    "INSERT INTO source_snapshots (kind, resource_id, season_start_year, payload_json) VALUES ('league', ?, ?, ?)"
  );

  insertSnapshot.run("EPL", 2024, JSON.stringify({ players }));
  insertSnapshot.run(
    "EPL",
    2025,
    JSON.stringify({
      players: [understatPlayer("selected-player", "Selected Player")],
    })
  );
  database.close();
  vi.stubEnv("TACTISCOUT_UNDERSTAT_DB_PATH", databasePath);
  vi.stubEnv("TACTISCOUT_UNDERSTAT_AI_PROCESSING_ALLOWED", "true");

  return databasePath;
};

const recommendationProfile = (
  fmId: string,
  potentialAbility: number | null
): FmRecommendationProfile => ({
  attributes: Object.fromEntries(
    positionFeatureMap.stc.features.map((feature) => [feature, 50])
  ),
  birthDate: fixtureBirthDate,
  currentAbility: 100,
  fmId,
  name: fmId,
  naturalPositions: "STC",
  positionRating: 20,
  potentialAbility,
  sourceRecordId: `record-${fmId}`,
});

const profileWithAttributes = (
  fmId: string,
  attributeValue: number,
  positionRating = 20
): FmRecommendationProfile => ({
  ...recommendationProfile(fmId, 180),
  attributes: Object.fromEntries(
    positionFeatureMap.stc.features.map((feature) => [feature, attributeValue])
  ),
  positionRating,
});

const recommendationSource = (): FmRecommendationReadResult => ({
  excludedMissingFmIdCandidates: 0,
  gameBuild: "test-build",
  manifestSha256: "fixture-manifest-sha",
  position: "stc",
  profiles: [
    recommendationProfile("reference", 190),
    ...Array.from({ length: 5 }, (_, index) =>
      recommendationProfile(`with-pa-${String(index)}`, 170 + index)
    ),
    ...Array.from({ length: 4 }, (_, index) =>
      recommendationProfile(`missing-pa-${String(index)}`, null)
    ),
  ],
  references: [recommendationProfile("reference", 190)],
  snapshotDate: "2025-11-23",
  status: "ready",
});

const cleanup = () => {
  vi.unstubAllEnvs();

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
};

const playerRecommendationDataTest = {
  cleanup,
  createFmDatabase,
  createIdentityDatabase,
  createUnderstatDatabase,
  profileWithAttributes,
  recommendationProfile,
  recommendationSource,
  understatPlayer,
};

export { playerRecommendationDataTest };
