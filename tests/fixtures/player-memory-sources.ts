import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateRawSync } from "node:zlib";

const createPlayerMemorySources = async (directory: string) => {
  const sourceDirectory = path.join(directory, "sources");
  const fmDatabasePath = path.join(sourceDirectory, "fm.sqlite");
  const reepDatabasePath = path.join(sourceDirectory, "reep.sqlite");
  const understatDatabasePath = path.join(sourceDirectory, "understat.sqlite");
  await mkdir(sourceDirectory, { recursive: true });

  const fmDatabase = new DatabaseSync(fmDatabasePath);

  const fmPlayers = [
    {
      birthDate: "1993-07-28",
      fmId: "fm-kane",
      name: "Harry Kane",
      reepId: "canonical:kane",
    },
    {
      birthDate: "2000-07-21",
      fmId: "fm-haaland",
      name: "Erling Haaland",
      reepId: "canonical:haaland",
    },
    {
      birthDate: "1998-12-20",
      fmId: "fm-mbappe",
      name: "Kylian Mbappé",
      reepId: "canonical:mbappe",
    },
  ];

  try {
    fmDatabase.exec(`
      CREATE TABLE manifest (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE players (
        record_id TEXT PRIMARY KEY,
        unique_id TEXT,
        name TEXT,
        birth_date TEXT,
        payload BLOB NOT NULL
      );
      CREATE TABLE aliases (record_id TEXT NOT NULL, name TEXT);
    `);
    fmDatabase.prepare("INSERT INTO manifest (id, payload) VALUES (1, ?)").run(
      JSON.stringify({
        gameBuild: "player-memory-test-build",
        inGameDate: "2025-11-23",
        sha256: "player-memory-test-snapshot",
      })
    );

    const insertPlayer = fmDatabase.prepare(
      "INSERT INTO players (record_id, unique_id, name, birth_date, payload) VALUES (?, ?, ?, ?, ?)"
    );

    const insertAlias = fmDatabase.prepare(
      "INSERT INTO aliases (record_id, name) VALUES (?, ?)"
    );

    for (const [index, player] of fmPlayers.entries()) {
      const recordId = `${player.fmId}-record`;
      const rawAttribute = 12 + index;

      const payload = deflateRawSync(
        Buffer.from(
          JSON.stringify({
            ability_current: rawAttribute * 10,
            ability_potential: rawAttribute * 10 + 15,
            birth_date: player.birthDate,
            common_name: player.name,
            full_name: player.name,
            height_cm: 188,
            name: player.name,
            natural_positions: "STC",
            raw_attributes_acceleration: rawAttribute,
            raw_attributes_decisions: rawAttribute,
            raw_attributes_finishing: rawAttribute,
            raw_attributes_first_touch: rawAttribute,
            raw_attributes_off_the_ball: rawAttribute,
            raw_attributes_pace: rawAttribute,
            raw_attributes_passing: rawAttribute,
            raw_attributes_strength: rawAttribute,
            raw_attributes_technique: rawAttribute,
            raw_attributes_vision: rawAttribute,
            unique_id: player.fmId,
          })
        )
      );

      insertPlayer.run(
        recordId,
        player.fmId,
        player.name,
        player.birthDate,
        payload
      );

      if (player.fmId === "fm-kane" || player.fmId === "fm-haaland") {
        insertAlias.run(recordId, "Kane");
      }
    }
  } finally {
    fmDatabase.close();
  }

  const reepDatabase = new DatabaseSync(reepDatabasePath);

  try {
    reepDatabase.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE bridges (
        provider TEXT NOT NULL,
        namespace TEXT NOT NULL,
        external_id TEXT NOT NULL,
        canonical_reep_id TEXT,
        redirect_status TEXT NOT NULL
      );
    `);
    reepDatabase
      .prepare("INSERT INTO metadata (key, value) VALUES ('release_stamp', ?)")
      .run("player-memory-test-reep-release");

    const insertBridge = reepDatabase.prepare(
      "INSERT INTO bridges (provider, namespace, external_id, canonical_reep_id, redirect_status) VALUES ('fm', 'player', ?, ?, 'resolved')"
    );

    for (const player of fmPlayers) {
      insertBridge.run(player.fmId, player.reepId);
    }
  } finally {
    reepDatabase.close();
  }

  const understatDatabase = new DatabaseSync(understatDatabasePath);

  try {
    understatDatabase.exec(
      "CREATE TABLE source_snapshots (kind TEXT NOT NULL, resource_id TEXT NOT NULL, season_start_year INTEGER NOT NULL, payload_json TEXT NOT NULL)"
    );
    understatDatabase
      .prepare(
        "INSERT INTO source_snapshots (kind, resource_id, season_start_year, payload_json) VALUES ('league', 'Bundesliga', 2025, ?)"
      )
      .run(
        JSON.stringify({
          players: [
            {
              assists: "2",
              games: "12",
              goals: "7",
              id: "understat-mbappe",
              key_passes: "15",
              npxG: "6.1",
              player_name: "Kylian Mbappé",
              position: "F",
              shots: "31",
              team_title: "Fixture FC",
              time: "1000",
              xA: "1.8",
              xG: "7.2",
            },
          ],
        })
      );
  } finally {
    understatDatabase.close();
  }

  return { fmDatabasePath, reepDatabasePath, understatDatabasePath };
};

export { createPlayerMemorySources };
