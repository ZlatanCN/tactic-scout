import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";

import {
  readFmProfilesBySourceIds,
  readFmRecommendationProfiles,
} from "../../../src/player-data/football-manager.js";
import {
  searchPlayerRecords,
  searchPlayerRecordsResultSchema,
} from "../../../src/player-data/search-records.js";
import { readUnderstatBySourceIds } from "../../../src/player-data/understat.js";
import { playerRecommendationDataTest } from "../../fixtures/player-recommendation-data.js";

describe("recommendation source record identity and scope", () => {
  afterEach(() => {
    playerRecommendationDataTest.cleanup();
  });

  it("parses the text manifest and reads exact reference and eligible candidate IDs", () => {
    playerRecommendationDataTest.createFmDatabase([
      { fmId: "reference-fm-id", rating: 20 },
      { fmId: "candidate-fm-id", rating: 17 },
      { fmId: "ineligible-fm-id", rating: 14 },
    ]);

    const result = readFmRecommendationProfiles("stc", ["reference-fm-id"]);

    expect(result).toMatchObject({
      gameBuild: "test-build",
      manifestSha256: "fixture-manifest-sha",
      position: "stc",
      snapshotDate: "2025-11-23",
      status: "ready",
    });

    if (result.status !== "ready") {
      throw new Error("Expected the FM fixture to be readable.");
    }

    expect(result.references.map((profile) => profile.fmId)).toStrictEqual([
      "reference-fm-id",
    ]);
    expect(result.profiles.map((profile) => profile.fmId)).toStrictEqual([
      "candidate-fm-id",
      "reference-fm-id",
    ]);
  });

  it("reports a missing reference ID as missing data rather than a database error", () => {
    playerRecommendationDataTest.createFmDatabase([
      { fmId: "candidate-fm-id", rating: 20 },
    ]);

    const result = readFmRecommendationProfiles("stc", ["missing-fm-id"]);

    expect(result.status).toBe("ready");

    if (result.status !== "ready") {
      throw new Error("Expected the FM fixture database to be available.");
    }

    expect(result.references).toStrictEqual([]);
    expect(result.profiles.map((profile) => profile.fmId)).toStrictEqual([
      "candidate-fm-id",
    ]);
  });

  it("reads only the confirmed FM source IDs even when another player has the same name", () => {
    const databasePath = playerRecommendationDataTest.createFmDatabase([
      { fmId: "selected-fm-id", rating: 20 },
      { fmId: "namesake-fm-id", rating: 20 },
    ]);

    const database = new DatabaseSync(databasePath);

    database.prepare("UPDATE players SET name = 'Same Name'").run();
    database.close();

    const result = readFmProfilesBySourceIds(["selected-fm-id"]);

    expect(result.status).toBe("found");

    if (result.status !== "found") {
      throw new Error("Expected the exact FM profile to be found.");
    }

    expect(
      result.records.map((profile) => profile.identitySourceId)
    ).toStrictEqual(["selected-fm-id"]);
  });

  it("prefers a unique ID over an unrelated profile record ID collision", () => {
    const databasePath = playerRecommendationDataTest.createFmDatabase([
      { fmId: "colliding-fm-id", rating: 20 },
      { fmId: "other-fm-id", rating: 20 },
    ]);

    const database = new DatabaseSync(databasePath);
    database
      .prepare("UPDATE players SET record_id = ? WHERE unique_id = ?")
      .run("colliding-fm-id", "other-fm-id");
    database.close();

    const result = readFmProfilesBySourceIds(["colliding-fm-id"]);

    expect(result.status).toBe("found");

    if (result.status !== "found") {
      throw new Error("Expected the FM unique-ID profile to be found.");
    }

    expect(
      result.records.map(({ identitySourceId, sourceRecordId }) => ({
        identitySourceId,
        sourceRecordId,
      }))
    ).toStrictEqual([
      { identitySourceId: "colliding-fm-id", sourceRecordId: "record-1" },
    ]);
  });

  it("reads only the confirmed Understat source ID and requested season", () => {
    playerRecommendationDataTest.createUnderstatDatabase();

    const result = readUnderstatBySourceIds(["selected-player"], 2024);

    expect(result.status).toBe("found");

    if (result.status !== "found") {
      throw new Error("Expected the exact Understat profile to be found.");
    }

    expect(result.records).toMatchObject([
      {
        player: "Selected Player",
        season: "2024/25",
        sourcePlayerId: "selected-player",
      },
    ]);
  });

  it("preserves Understat game counts and explicitly marks missing counts", async () => {
    playerRecommendationDataTest.createUnderstatDatabase([
      playerRecommendationDataTest.understatPlayer(
        "player-with-games",
        "Player With Games",
        "17"
      ),
      playerRecommendationDataTest.understatPlayer(
        "player-without-games",
        "Player Without Games"
      ),
    ]);

    const result = await searchPlayerRecords({
      seasonStartYear: 2024,
      sourceRecords: [
        { provider: "understat", sourceId: "player-with-games" },
        { provider: "understat", sourceId: "player-without-games" },
      ],
    });

    const parsed = searchPlayerRecordsResultSchema.parse(JSON.parse(result));

    if (!("understat" in parsed)) {
      throw new Error("Expected the exact Understat records to be found.");
    }

    const { understat } = parsed;

    if (understat === undefined || understat.status !== "found") {
      throw new Error("Expected the exact Understat records to be found.");
    }

    const appearanceFields = z
      .array(
        z.object({
          appearances: z.number().nullable(),
          sourcePlayerId: z.string(),
        })
      )
      .parse(understat.records);

    expect(appearanceFields).toStrictEqual([
      { appearances: 17, sourcePlayerId: "player-with-games" },
      { appearances: null, sourcePlayerId: "player-without-games" },
    ]);
  });
});
