import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateRawSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import type {
  FmRecommendationProfile,
  FmRecommendationReadResult,
} from "../src/player-data/football-manager.js";
import {
  readFmProfilesBySourceIds,
  readFmRecommendationProfiles,
} from "../src/player-data/football-manager.js";
import {
  positionFeatureMap,
  positionFeatureMapSha256,
} from "../src/player-data/position-features.js";
import {
  recommendPlayers,
  recommendTeamPlayers,
} from "../src/player-data/recommend-players.js";
import { readUnderstatBySourceIds } from "../src/player-data/understat.js";
import type { TeamRosterSnapshot } from "../src/team-data/contracts.js";
import { recommendPlayerCandidates } from "../src/tools/recommend-player-candidates.js";
import type { RecommendPlayerCandidatesInput } from "../src/tools/recommend-player-candidates.js";
import { recommendTeamPlayerCandidates } from "../src/tools/recommend-team-player-candidates.js";

const temporaryDirectories: string[] = [];

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
      birth_date: "2000-01-01",
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
        "2000-01-01",
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

const understatPlayer = (id: string, name: string) => ({
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
});

const createUnderstatDatabase = (): void => {
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

  insertSnapshot.run(
    "EPL",
    2024,
    JSON.stringify({
      players: [
        understatPlayer("selected-player", "Selected Player"),
        understatPlayer("namesake-player", "Same Name"),
      ],
    })
  );
  insertSnapshot.run(
    "EPL",
    2025,
    JSON.stringify({
      players: [understatPlayer("selected-player", "Selected Player")],
    })
  );
  database.close();
  vi.stubEnv("TACTISCOUT_UNDERSTAT_DB_PATH", databasePath);
};

const recommendationProfile = (
  fmId: string,
  potentialAbility: number | null
): FmRecommendationProfile => ({
  attributes: Object.fromEntries(
    positionFeatureMap.stc.features.map((feature) => [feature, 50])
  ),
  birthDate: "2000-01-01",
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

describe("player recommendation data invariants", () => {
  afterEach(() => {
    vi.unstubAllEnvs();

    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("parses the text manifest and reads exact reference and eligible candidate IDs", () => {
    createFmDatabase([
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
    createFmDatabase([{ fmId: "candidate-fm-id", rating: 20 }]);

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
    const databasePath = createFmDatabase([
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

  it("reads only the confirmed Understat source ID and requested season", () => {
    createUnderstatDatabase();

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

  it("counts all complete profiles missing PA before truncating the high-potential list", () => {
    const result = recommendPlayers(
      {
        includePotential: true,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referenceFmIds: ["reference"],
        resultLimit: 1,
      },
      recommendationSource()
    );

    expect(result.status).toBe("ready");

    if (result.status !== "ready") {
      throw new Error("Expected recommendation profiles to be rankable.");
    }

    expect({
      currentTop: result.currentCandidates[0]?.fmId,
      missingPotentialCount:
        result.filterCounts.excludedMissingPotentialForPotentialList,
      potentialCount: result.potentialCandidates?.length,
      potentialTop: result.potentialCandidates?.[0]?.fmId,
    }).toStrictEqual({
      currentTop: "missing-pa-0",
      missingPotentialCount: 4,
      potentialCount: 1,
      potentialTop: "with-pa-4",
    });
  });

  it("builds the team profile from position-capable squad members and excludes the whole squad", () => {
    const teamA = profileWithAttributes("team-a", 40);
    const teamB = profileWithAttributes("team-b", 60, 15);
    const teamLowRated = profileWithAttributes("team-low", 85, 14);
    const outsideNearest = profileWithAttributes("outside-nearest", 50);
    const outsideNext = profileWithAttributes("outside-next", 51);

    const source: FmRecommendationReadResult = {
      excludedMissingFmIdCandidates: 0,
      gameBuild: "test-build",
      manifestSha256: "fixture-manifest-sha",
      position: "stc",
      profiles: [teamA, teamB, teamLowRated, outsideNearest, outsideNext],
      references: [teamA, teamB, teamLowRated],
      snapshotDate: "2025-11-23",
      status: "ready",
    };

    const calculation = recommendTeamPlayers(
      {
        excludeFmIds: ["team-a", "team-b", "team-low"],
        includePotential: false,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referenceFmIds: ["team-a", "team-b", "team-low"],
        resultLimit: 5,
      },
      source
    );

    expect(calculation.status).toBe("calculated");

    if (calculation.status !== "calculated") {
      throw new Error("Expected the team position profile to be calculable.");
    }

    expect(calculation.referenceFmIds).toStrictEqual(["team-a", "team-b"]);
    expect(calculation.recommendation.status).toBe("ready");

    if (calculation.recommendation.status !== "ready") {
      throw new Error("Expected the synthetic candidate profiles to rank.");
    }

    expect({
      candidateIds: calculation.recommendation.currentCandidates.map(
        (candidate) => candidate.fmId
      ),
      referenceMean: calculation.recommendation.referenceMeanAttributes,
    }).toMatchObject({
      candidateIds: ["outside-nearest", "outside-next"],
      referenceMean: Object.fromEntries(
        positionFeatureMap.stc.features.map((feature) => [feature, 50])
      ),
    });
  });

  it("requires at least one team profile with a qualifying rating and complete features", () => {
    const lowRated = profileWithAttributes("team-low", 45, 14);

    const incomplete = {
      ...profileWithAttributes("team-incomplete", 55),
      attributes: {
        ...profileWithAttributes("team-incomplete", 55).attributes,
        pace: null,
      },
    };

    const source: FmRecommendationReadResult = {
      excludedMissingFmIdCandidates: 0,
      gameBuild: "test-build",
      manifestSha256: "fixture-manifest-sha",
      position: "stc",
      profiles: [recommendationProfile("candidate", 175)],
      references: [lowRated, incomplete],
      snapshotDate: "2025-11-23",
      status: "ready",
    };

    const calculation = recommendTeamPlayers(
      {
        excludeFmIds: ["team-low", "team-incomplete"],
        includePotential: false,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referenceFmIds: ["team-low", "team-incomplete"],
        resultLimit: 5,
      },
      source
    );

    expect(calculation).toStrictEqual({
      position: "stc",
      snapshotDate: "2025-11-23",
      status: "team_position_unavailable",
    });
  });

  it("accepts one qualifying squad profile as a team reference", () => {
    const reference = profileWithAttributes("only-team-member", 44, 15);

    const source: FmRecommendationReadResult = {
      excludedMissingFmIdCandidates: 0,
      gameBuild: "test-build",
      manifestSha256: "fixture-manifest-sha",
      position: "stc",
      profiles: [reference, recommendationProfile("outside-player", 175)],
      references: [reference],
      snapshotDate: "2025-11-23",
      status: "ready",
    };

    const calculation = recommendTeamPlayers(
      {
        excludeFmIds: ["only-team-member"],
        includePotential: false,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referenceFmIds: ["only-team-member"],
        resultLimit: 5,
      },
      source
    );

    expect(calculation.status).toBe("calculated");

    if (calculation.status !== "calculated") {
      throw new Error("One eligible squad profile should define the target.");
    }

    expect(calculation.referenceFmIds).toStrictEqual(["only-team-member"]);
    expect(calculation.recommendation.status).toBe("ready");
  });

  it("returns team identity, mapping coverage, source dates, filters, and ranked candidates", async () => {
    createFmDatabase([
      { fmId: "team-reference", rating: 20 },
      { fmId: "team-low-rated", rating: 14 },
      { fmId: "outside-candidate", rating: 20 },
    ]);
    vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:1234");

    const roster: TeamRosterSnapshot = {
      members: [
        {
          apiFootballPlayerId: 8101,
          fmCandidates: [],
          fmId: "team-reference",
          mappingMethod: "reep_bridge",
          mappingStatus: "resolved",
          name: "Reference Player",
          position: "Attacker",
        },
        {
          apiFootballPlayerId: 8102,
          fmCandidates: [],
          fmId: "team-low-rated",
          mappingMethod: "user_confirmation",
          mappingStatus: "resolved",
          name: "Low Rated Player",
          position: "Attacker",
        },
      ],
      retrievedAt: "2026-10-26T10:00:00.000Z",
      team: { country: "England", id: 42, name: "Arsenal" },
    };

    const resultJson = await recommendTeamPlayerCandidates({
      includePotential: false,
      maxAge: 30,
      minimumCurrentAbility: 120,
      minimumPotentialAbility: null,
      position: "stc",
      referenceFmIds: [],
      referenceMode: "squad",
      resultLimit: 3,
      roster,
      team: roster.team,
    });

    const result = z
      .object({
        filters: z.object({
          maxAge: z.number().nullable(),
          minimumCurrentAbility: z.number().nullable(),
          minimumPotentialAbility: z.number().nullable(),
          resultLimit: z.number(),
        }),
        fmSnapshotDate: z.string().nullable(),
        position: z.string(),
        rankingBasis: z.string(),
        recommendation: z.object({
          currentCandidates: z.array(z.object({ fmId: z.string() })),
          referenceMeanAttributes: z.record(z.string(), z.number()),
          status: z.string(),
        }),
        referenceFmIds: z.array(z.string()),
        roster: z.object({
          mappedMembers: z.number(),
          noLocalProfileMembers: z.number(),
          reepBridgeMappings: z.number(),
          retrievedAt: z.string(),
          source: z.string(),
          totalMembers: z.number(),
          userConfirmedMappings: z.number(),
        }),
        status: z.string(),
        team: z.object({
          country: z.string().nullable(),
          id: z.number(),
          name: z.string(),
        }),
      })
      .parse(JSON.parse(resultJson));

    expect(result).toMatchObject({
      filters: {
        maxAge: 30,
        minimumCurrentAbility: 120,
        minimumPotentialAbility: null,
        resultLimit: 3,
      },
      fmSnapshotDate: "2025-11-23",
      position: "stc",
      rankingBasis: "equal_weight_mean_of_position_capable_squad_profiles",
      recommendation: {
        currentCandidates: [{ fmId: "outside-candidate" }],
        status: "ready",
      },
      referenceFmIds: ["team-reference"],
      roster: {
        mappedMembers: 2,
        noLocalProfileMembers: 0,
        reepBridgeMappings: 1,
        retrievedAt: roster.retrievedAt,
        source: "API-Football",
        totalMembers: 2,
        userConfirmedMappings: 1,
      },
      status: "ready",
      team: roster.team,
    });
    expect(result.recommendation.referenceMeanAttributes).toMatchObject(
      Object.fromEntries(
        positionFeatureMap.stc.features.map((feature, index) => [
          feature,
          40 + index,
        ])
      )
    );
  });

  it("merges FM IDs across repeated groups for the same identity", async () => {
    createFmDatabase([{ fmId: "selected-fm-id", rating: 20 }]);
    vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:1234");

    const input: RecommendPlayerCandidatesInput = {
      excludeGroups: [],
      includePotential: false,
      maxAge: null,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: null,
      referenceGroups: [
        { fmIds: [], identityKey: "same-person", name: "Selected Player" },
        {
          fmIds: ["selected-fm-id"],
          identityKey: "same-person",
          name: "Selected Player",
        },
      ],
      resultLimit: 5,
    };

    const resultJson = await recommendPlayerCandidates(input);
    const parsedResult: unknown = JSON.parse(resultJson);

    const result = z
      .object({
        referenceFmIds: z.array(z.string()).optional(),
        status: z.string(),
      })
      .parse(parsedResult);

    expect(result).toMatchObject({
      referenceFmIds: ["selected-fm-id"],
      status: "no_candidates",
    });
  });

  it("keeps the TypeScript feature map synchronized with the frozen experiment registry", () => {
    const featureMapPath = path.resolve(
      import.meta.dirname,
      "../.scratch/player-recommendation/position-feature-map.json"
    );

    const bytes = readFileSync(featureMapPath);
    const parsed: unknown = JSON.parse(bytes.toString("utf-8"));

    const featureRegistry = z
      .object({
        positions: z.record(
          z.string(),
          z.object({
            groups: z.record(z.string(), z.array(z.string())),
          })
        ),
      })
      .parse(parsed);

    const runtimeMap = Object.fromEntries(
      Object.entries(featureRegistry.positions).map(
        ([position, definition]) => [
          position,
          {
            features: Object.values(definition.groups).flat(),
            groups: definition.groups,
          },
        ]
      )
    );

    const digest = createHash("sha256").update(bytes).digest("hex");

    expect(positionFeatureMap).toStrictEqual(runtimeMap);
    expect(digest).toBe(positionFeatureMapSha256);
  });
});
