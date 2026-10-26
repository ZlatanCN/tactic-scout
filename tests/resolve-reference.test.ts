import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolvePlayerReference } from "../src/player-data/resolve-reference.js";

describe("player reference data failures", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();

    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("returns data unavailable when a Reep bridge row has an invalid shape", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "tactiscout-reep-"));
    const understatPath = path.join(directory, "understat.sqlite");
    const fmPath = path.join(directory, "fm.sqlite");
    const identityPath = path.join(directory, "identity.sqlite");
    const understat = new DatabaseSync(understatPath);
    const fm = new DatabaseSync(fmPath);
    const identity = new DatabaseSync(identityPath);

    temporaryDirectories.push(directory);
    understat.exec(
      "CREATE TABLE source_snapshots (kind TEXT, resource_id TEXT, season_start_year INTEGER, payload_json TEXT);"
    );
    understat
      .prepare(
        "INSERT INTO source_snapshots (kind, resource_id, season_start_year, payload_json) VALUES ('league', 'EPL', 2025, ?)"
      )
      .run(
        JSON.stringify({
          players: [
            {
              assists: "1",
              goals: "2",
              id: "understat-source-1",
              key_passes: "4",
              npxG: "1.4",
              player_name: "Harry Kane",
              position: "F",
              shots: "20",
              team_title: "Bayern Munich",
              time: "800",
              xA: "1.0",
              xG: "2.2",
            },
          ],
        })
      );
    fm.exec(
      "CREATE TABLE players (record_id TEXT, name TEXT, payload BLOB);" +
        "CREATE TABLE aliases (record_id TEXT, name TEXT);"
    );
    identity.exec(
      "CREATE TABLE metadata (key TEXT, value TEXT);" +
        "INSERT INTO metadata (key, value) VALUES ('release_stamp', 'test');" +
        "CREATE TABLE bridges (provider TEXT, namespace TEXT, external_id TEXT, canonical_reep_id, redirect_status TEXT);"
    );
    identity
      .prepare(
        "INSERT INTO bridges (provider, namespace, external_id, canonical_reep_id, redirect_status) VALUES ('understat', 'player', 'understat-source-1', 42, 'resolved')"
      )
      .run();
    understat.close();
    fm.close();
    identity.close();

    vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:1234");
    vi.stubEnv("TACTISCOUT_UNDERSTAT_DB_PATH", understatPath);
    vi.stubEnv("TACTISCOUT_FM_PROFILES_PATH", fmPath);
    vi.stubEnv("TACTISCOUT_REEP_IDENTITY_DB_PATH", identityPath);

    expect(resolvePlayerReference("Harry Kane")).toMatchObject({
      mention: "Harry Kane",
      status: "data_unavailable",
    });
  });
});
