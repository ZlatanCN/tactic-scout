import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createRecruitmentConversation,
  type RecruitmentAction,
  type RecruitmentPlanner,
} from "../../src/recruitment/conversation.js";
import { toPer90 } from "../../src/recruitment/performance-metrics.js";
import { createRepository } from "../../src/sources/registry.js";
import { CuratedDatasetRepository } from "../../src/datasets/curated-repository.js";
import { buildWyscoutDataset } from "../../src/datasets/wyscout-dataset.js";
import { WyscoutPlayerRepository, WyscoutProviderError } from "../../src/sources/wyscout/provider.js";
import type { PlayerRepository } from "../../src/sources/registry.js";

const playerRows = [
  { wyId: 101, firstName: "Ari", lastName: "Sample", shortName2: "A. Sample", role: { name: "Defender" }, birthDate: "1997-07-10", currentTeamId: 10 },
  { wyId: 102, firstName: "Bea", lastName: "Sample", role: { name: "Forward" }, birthDate: "1999-02-01", currentTeamId: 10 },
  { wyId: 201, firstName: "Ari", lastName: "Sample", shortName2: "A. Sample", role: { name: "Midfielder" }, birthDate: "1996-01-01", currentTeamId: 20 },
  { wyId: 202, firstName: "Casey", lastName: "Keeper", role: { name: "Goalkeeper" }, birthDate: "1998-01-01", currentTeamId: 20 },
];

const matchRows = [
  {
    wyId: 1,
    competitionId: 1,
    dateutc: "2017-08-20 15:00:00",
    duration: "Regular",
    teamsData: {
      "10": {
        teamId: 10,
        hasFormation: 1,
        formation: {
          lineup: [{ playerId: 101 }],
          bench: [{ playerId: 102 }],
          substitutions: [{ playerIn: { id: 102 }, playerOut: { id: 101 }, minute: 60 }],
        },
      },
      "20": { teamId: 20, hasFormation: 1, formation: { lineup: [{ playerId: 201 }], bench: [], substitutions: "null" } },
    },
  },
  {
    wyId: 2,
    competitionId: 1,
    dateutc: "2017-08-27 15:00:00",
    duration: "Regular",
    teamsData: {
      "10": { teamId: 10, hasFormation: 1, formation: { lineup: [{ playerId: 101 }], bench: [{ playerId: 102 }], substitutions: [{ playerIn: { id: 102 }, playerOut: { id: 101 }, minute: "90+2" }] } },
      "20": { teamId: 20, hasFormation: 1, formation: { lineup: [{ playerId: 202 }], bench: [], substitutions: [{ playerIn: 0, playerOut: 202, minute: 30 }] } },
    },
  },
  {
    wyId: 3,
    competitionId: 99,
    dateutc: "2018-06-15 15:00:00",
    duration: "Regular",
    teamsData: {
      "10": { teamId: 10, hasFormation: 1, formation: { lineup: [{ playerId: 101 }], bench: [], substitutions: [] } },
      "99": { teamId: 99, hasFormation: 1, formation: { lineup: [], bench: [], substitutions: [] } },
    },
  },
];

const eventRows = [
  { id: 1, matchId: 1, teamId: 10, playerId: 101, eventName: "Pass", subEventName: "Simple pass", matchPeriod: "1H", eventSec: 2, description: "quoted } brace and \\\"text\\\"", tags: [{ id: 1801 }, { id: 302 }] },
  { id: 2, matchId: 1, teamId: 10, playerId: 101, eventName: "Pass", subEventName: "Simple pass", matchPeriod: "1H", eventSec: 5, tags: [{ id: 1802 }] },
  { id: 3, matchId: 1, teamId: 10, playerId: 101, eventName: "Pass", subEventName: "Simple pass", matchPeriod: "2H", eventSec: 3, tags: [{ id: 1801 }, { id: 301 }] },
  { id: 4, matchId: 1, teamId: 10, playerId: 101, eventName: "Shot", subEventName: "Shot", matchPeriod: "2H", eventSec: 9, tags: [{ id: 101 }] },
  { id: 5, matchId: 1, teamId: 10, playerId: 102, eventName: "Pass", subEventName: "Simple pass", matchPeriod: "2H", eventSec: 12, tags: [{ id: 1801 }] },
  { id: 6, matchId: 1, teamId: 20, playerId: 201, eventName: "Pass", subEventName: "Simple pass", matchPeriod: "1H", eventSec: 4, tags: [{ id: 1801 }] },
  { id: 7, matchId: 2, teamId: 10, playerId: 101, eventName: "Pass", subEventName: "Simple pass", matchPeriod: "1H", eventSec: 8, tags: [{ id: 1801 }] },
  { id: 8, matchId: 3, teamId: 10, playerId: 101, eventName: "Shot", subEventName: "Shot", matchPeriod: "1H", eventSec: 8, tags: [{ id: 101 }] },
  { id: 9, matchId: 1, teamId: 10, playerId: 101, eventName: "Free kick", subEventName: "Free kick cross", matchPeriod: "2H", eventSec: 14, tags: [{ id: 302 }] },
  { id: 10, matchId: 1, teamId: 10, playerId: 0, eventName: "Duel", subEventName: "Ground attacking duel", matchPeriod: "2H", eventSec: 15, tags: [] },
  { id: 11, matchId: 1, teamId: 10, playerId: 101, eventName: "Duel", subEventName: "Ground attacking duel", matchPeriod: "2H", eventSec: 16, positions: [{ x: 20, y: 50 }], tags: [{ id: 703 }] },
  { id: 12, matchId: 1, teamId: 10, playerId: 101, eventName: "Duel", subEventName: "Ground attacking duel", matchPeriod: "2H", eventSec: 17, positions: [{ x: 30, y: 50 }], tags: [{ id: 701 }] },
  { id: 13, matchId: 1, teamId: 10, playerId: 101, eventName: "Duel", subEventName: "Ground attacking duel", matchPeriod: "2H", eventSec: 18, positions: [{ x: 40, y: 50 }], tags: [{ id: 702 }] },
];

async function writeFixture(dataDirectory: string, options: { omitEvents?: boolean; malformedEvents?: boolean; mismatchedEventTeam?: boolean; unselectedMalformedEvents?: boolean } = {}): Promise<void> {
  await Promise.all([
    writeFile(path.join(dataDirectory, "competitions.json"), JSON.stringify([
      { wyId: 1, name: "English first division", type: "club", format: "Domestic league" },
      { wyId: 99, name: "World cup 2018", type: "international", format: "International cup" },
    ])),
    writeFile(path.join(dataDirectory, "teams.json"), JSON.stringify([
      { wyId: 10, name: "Synthetic Club" },
      { wyId: 20, name: "Second Synthetic Club" },
      { wyId: 99, name: "Synthetic National Team" },
    ])),
    writeFile(path.join(dataDirectory, "players.json"), JSON.stringify(playerRows)),
    writeFile(path.join(dataDirectory, "matches_England.json"), JSON.stringify(matchRows)),
  ]);
  if (!options.omitEvents) {
    await writeFile(
      path.join(dataDirectory, "events_England.json"),
      options.malformedEvents
        ? "[{\"id\":1,\"matchId\":1,\"teamId\":10,\"playerId\":101,\"eventName\":\"Pass\",\"tags\":[]},]"
        : JSON.stringify(options.mismatchedEventTeam
          ? [...eventRows, { id: 11, matchId: 1, teamId: 99, playerId: 101, eventName: "Pass", tags: [{ id: 1801 }] }]
          : eventRows),
    );
  }
  if (options.unselectedMalformedEvents) {
    await writeFile(path.join(dataDirectory, "events_World_Cup.json"), "this file belongs to an excluded competition");
  }
}

async function buildCuratedFixtureRepository(
  dataDirectory: string,
  extraEventRows: Array<Record<string, unknown>> = [],
): Promise<{ repository: CuratedDatasetRepository; datasetId: string }> {
  await writeFixture(dataDirectory);
  if (extraEventRows.length > 0) {
    const eventsPath = path.join(dataDirectory, "events_England.json");
    const events = JSON.parse(await readFile(eventsPath, "utf8")) as unknown[];
    await writeFile(eventsPath, JSON.stringify([...events, ...extraEventRows]));
  }
  await writeFile(path.join(dataDirectory, "provenance.json"), JSON.stringify({
    dataset: "Soccer match event dataset",
    publisher: "Pappalardo et al.",
    publicationDoi: "10.1038/s41597-019-0247-7",
    retrievedAt: "2026-10-06",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    scope: "Synthetic fixture for the Wyscout data-to-report integration test.",
    items: [{ name: "synthetic fixture", url: "https://example.invalid/fixture", file: "events_England.json", sha256: "fixture-only" }],
  }));
  const built = await buildWyscoutDataset({
    sourceDirectory: dataDirectory,
    outputDirectory: path.join(dataDirectory, "snapshots"),
    now: () => new Date("2026-10-06T00:00:00.000Z"),
  });
  return {
    repository: new CuratedDatasetRepository({ filePath: built.latestPath, allowModelProcessing: true }),
    datasetId: built.snapshot.datasetId,
  };
}

async function runAttackingDuelRequest(repository: PlayerRepository, threadId: string, recommendPlayer = true) {
  const playerId = "wyscout:101:team:10:competition:1:season:2017/18";
  const actions: RecruitmentAction[] = [
    { action: "search_methodology", query: "边后卫进攻一对一对抗" },
    { action: "search_candidates", position: "DEF", minimumMinutes: 0, limit: 10 },
    { action: "evaluate_candidates", playerIds: [playerId] },
    {
      action: "finish",
      targetTeam: "Current Synthetic Club",
      needSummary: "寻找进攻一对一对抗有依据的边后卫。",
      capabilityProfile: ["进攻一对一对抗"],
      recommendations: recommendPlayer
        ? [{ playerId, evidenceKeys: ["wyscoutGroundAttackingDuelsPer90", "wyscoutExplicitlyWonGroundAttackingDuelSharePct"] }]
        : [],
      limitationKeys: [],
    },
  ];
  const planner: RecruitmentPlanner = {
    async decide() {
      const action = actions.shift();
      assert.ok(action, "the case should finish after the scripted evidence path");
      return action;
    },
  };
  const conversation = createRecruitmentConversation({
    repository,
    planner,
    knowledgeBase: { async search() { return []; } },
  });
  return conversation.turn({
    threadId,
    message: "为 Current Synthetic Club 找一个后卫，重点看进攻一对一对抗。",
  });
}

function makeRepository(dataDirectory: string, allowModelProcessing = true, competitionIds?: string[]): WyscoutPlayerRepository {
  return new WyscoutPlayerRepository({ dataDirectory, allowModelProcessing, competitionIds });
}

test("Wyscout repository streams local event JSON and maps only source-supported league evidence", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-wyscout-"));
  try {
    await writeFixture(dataDirectory, { unselectedMalformedEvents: true });

    const players = await makeRepository(dataDirectory).loadPlayers();
    const ariAtSyntheticClub = players.find(({ externalPlayerId, team }) => externalPlayerId === "101" && team === "Synthetic Club");
    const ariAtOtherClub = players.find(({ externalPlayerId, team }) => externalPlayerId === "201" && team === "Second Synthetic Club");

    assert.equal(players.length, 4);
    assert.ok(ariAtSyntheticClub);
    assert.equal(ariAtSyntheticClub.name, "Ari Sample");
    assert.equal(ariAtSyntheticClub.position, "DEF");
    assert.equal(ariAtSyntheticClub.age, 20);
    assert.equal(ariAtSyntheticClub.ageVerifiedAt, "2018-06-30");
    assert.equal(ariAtSyntheticClub.season, "2017/18");
    assert.equal(ariAtSyntheticClub.minutes, 150);
    assert.equal(ariAtSyntheticClub.stats.goals, 1);
    assert.equal(ariAtSyntheticClub.stats.assists, 1);
    assert.equal(ariAtSyntheticClub.stats.passesAttempted, 4);
    assert.equal(ariAtSyntheticClub.stats.passesCompleted, 3);
    assert.equal(ariAtSyntheticClub.stats.shotAssists, 0);
    assert.equal(ariAtSyntheticClub.stats.keyPasses, 2);
    assert.deepEqual(ariAtSyntheticClub.availableStats, ["goals", "assists", "passesAttempted", "passesCompleted", "keyPasses"]);
    assert.equal(toPer90(ariAtSyntheticClub).shotAssists, null);
    assert.equal(toPer90(ariAtSyntheticClub).keyPasses, 1.2);
    assert.equal(ariAtSyntheticClub.sourceIdentity?.provider, "wyscout-open-data");
    assert.equal(ariAtSyntheticClub.sourceIdentity?.playerId, "101");
    assert.equal(ariAtSyntheticClub.sourceIdentity?.isCurrentSeason, false);
    assert.match(ariAtSyntheticClub.source, /CC BY 4\.0/);
    assert.ok(ariAtOtherClub);
    assert.equal(ariAtOtherClub.position, "MID");
    assert.equal(ariAtOtherClub.name, ariAtSyntheticClub.name);
    assert.notEqual(ariAtOtherClub.playerId, ariAtSyntheticClub.playerId);
    const goalkeeper = players.find(({ externalPlayerId }) => externalPlayerId === "202");
    assert.ok(goalkeeper);
    assert.equal(goalkeeper.minutes, 30, "an unassigned incoming ID should still retain the known outgoing player's minutes");
    assert.equal(goalkeeper.eventDataComplete, true, "match event availability should not require the player to have a linked event");
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("Wyscout rejects events whose known team did not participate in the referenced match", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-wyscout-team-match-"));
  try {
    await writeFixture(dataDirectory, { mismatchedEventTeam: true });

    await assert.rejects(
      makeRepository(dataDirectory).loadPlayers(),
      (error: unknown) => error instanceof WyscoutProviderError
        && error.code === "invalid_source_data"
        && /team ID 99, which did not participate in match 1/.test(error.message),
    );
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("Wyscout repository is selected by environment and model processing requires explicit opt-in", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-wyscout-config-"));
  const names = [
    "TACTISCOUT_DATA_MODE",
    "TACTISCOUT_WYSCOUT_DIR",
    "TACTISCOUT_WYSCOUT_AI_PROCESSING_ALLOWED",
    "TACTISCOUT_WYSCOUT_COMPETITION_IDS",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.TACTISCOUT_DATA_MODE = "wyscout";
    process.env.TACTISCOUT_WYSCOUT_DIR = dataDirectory;
    process.env.TACTISCOUT_WYSCOUT_AI_PROCESSING_ALLOWED = "false";
    process.env.TACTISCOUT_WYSCOUT_COMPETITION_IDS = "1,2";
    assert.throws(() => createRepository(), (error: unknown) =>
      error instanceof WyscoutProviderError && error.code === "invalid_configuration",
    );

    process.env.TACTISCOUT_WYSCOUT_AI_PROCESSING_ALLOWED = "true";
    await writeFixture(dataDirectory);
    const repository = createRepository();
    assert.equal(repository.mode, "wyscout");
    assert.equal((await repository.loadPlayers()).length, 4, "the configured local data directory should be used");
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Wyscout model processing is disabled until the operator opts in", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-wyscout-"));
  try {
    await assert.rejects(
      async () => new WyscoutPlayerRepository({ dataDirectory, allowModelProcessing: false }),
      (error: unknown) => error instanceof WyscoutProviderError && error.code === "invalid_configuration",
    );
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("Wyscout source text decodes literal Unicode escapes in names and labels", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-wyscout-unicode-"));
  try {
    await writeFixture(dataDirectory);

    const players = JSON.parse(await readFile(path.join(dataDirectory, "players.json"), "utf8")) as Array<Record<string, unknown>>;
    const teams = JSON.parse(await readFile(path.join(dataDirectory, "teams.json"), "utf8")) as Array<Record<string, unknown>>;
    const competitions = JSON.parse(await readFile(path.join(dataDirectory, "competitions.json"), "utf8")) as Array<Record<string, unknown>>;
    const [firstPlayer] = players;
    const [firstTeam] = teams;
    const [firstCompetition] = competitions;
    assert.ok(firstPlayer);
    assert.ok(firstTeam);
    assert.ok(firstCompetition);
    firstPlayer.firstName = String.raw`R\u00e9mi`;
    firstTeam.name = String.raw`Cl\u00e9ment FC`;
    firstCompetition.name = String.raw`Ligue d\u2019\u00e9t\u00e9`;
    await Promise.all([
      writeFile(path.join(dataDirectory, "players.json"), JSON.stringify(players)),
      writeFile(path.join(dataDirectory, "teams.json"), JSON.stringify(teams)),
      writeFile(path.join(dataDirectory, "competitions.json"), JSON.stringify(competitions)),
    ]);

    const profiles = await makeRepository(dataDirectory).loadPlayers();
    const player = profiles.find(({ playerId }) => playerId === "wyscout:101:team:10:competition:1:season:2017/18");
    assert.equal(player?.name, "Rémi Sample");
    assert.equal(player?.team, "Clément FC");
    assert.equal(player?.competition, "Ligue d’été");
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("Wyscout repository distinguishes missing and malformed event files from an empty pool", async () => {
  const missingDirectory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-wyscout-"));
  const malformedDirectory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-wyscout-"));
  const validEmptyDirectory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-wyscout-"));
  try {
    await writeFixture(missingDirectory, { omitEvents: true });
    await writeFixture(malformedDirectory, { malformedEvents: true });
    await writeFixture(validEmptyDirectory);

    await assert.rejects(makeRepository(missingDirectory).loadPlayers(), (error: unknown) =>
      error instanceof WyscoutProviderError && error.code === "missing_file",
    );
    await assert.rejects(makeRepository(malformedDirectory).loadPlayers(), (error: unknown) =>
      error instanceof WyscoutProviderError && error.code === "invalid_json",
    );
    assert.deepEqual(await makeRepository(validEmptyDirectory, true, ["unknown-competition"]).loadPlayers(), []);
  } finally {
    await Promise.all([
      rm(missingDirectory, { recursive: true, force: true }),
      rm(malformedDirectory, { recursive: true, force: true }),
      rm(validEmptyDirectory, { recursive: true, force: true }),
    ]);
  }
});

test("Wyscout evidence is available to the LangGraph investigation with historical caveats", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-wyscout-"));
  try {
    await writeFixture(dataDirectory);
    const repository = makeRepository(dataDirectory);
    const playerId = "wyscout:101:team:10:competition:1:season:2017/18";
    const actions: RecruitmentAction[] = [
      { action: "search_methodology", query: "边后卫传球与进攻表现" },
      { action: "search_candidates", position: "DEF", minimumMinutes: 0, limit: 10 },
      { action: "evaluate_candidates", playerIds: [playerId] },
      { action: "search_player_reports", query: "Ari Sample 球探报告", playerNames: ["Ari Sample"] },
      {
        action: "finish",
        targetTeam: "Current Synthetic Club",
        needSummary: "比较后卫的历史比赛证据。",
        capabilityProfile: ["传球与进攻参与"],
        recommendations: [{ playerId, evidenceKeys: ["goals"] }],
        limitationKeys: [],
      },
    ];
    const planner: RecruitmentPlanner = {
      async decide() {
        const action = actions.shift();
        assert.ok(action, "the case should finish after the scripted evidence path");
        return action;
      },
    };
    const conversation = createRecruitmentConversation({
      repository,
      planner,
      knowledgeBase: { async search() { return []; } },
    });

    const response = await conversation.turn({ threadId: "wyscout-history", message: "为 Current Synthetic Club 找一个后卫" });

    assert.equal(response.status, "completed", response.message);
    assert.equal(response.report?.recommendations[0]?.player.name, "Ari Sample");
    assert.equal(response.report?.recommendations[0]?.player.age, 20);
    assert.equal(response.report?.recommendations[0]?.player.sourceIdentity?.isCurrentSeason, false);
    assert.ok(response.report?.recommendations[0]?.player.source.includes("2017/18"));
    assert.ok(response.report?.limitations.some((item) => /2017\/18.*历史/.test(item)));
    assert.ok(response.report?.limitations.some((item) => /不是现役球员池/.test(item)));
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("a built Wyscout dataset carries source-labelled attacking-duel evidence through LangGraph into the report", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-wyscout-duels-"));
  try {
    const { repository, datasetId } = await buildCuratedFixtureRepository(dataDirectory);
    const response = await runAttackingDuelRequest(repository, "wyscout-attacking-duel-history");

    assert.equal(response.status, "completed");
    const recommendation = response.report?.recommendations[0];
    assert.ok(recommendation);
    assert.deepEqual(recommendation.evidence.map(({ key }) => key).filter((key) => [
      "wyscoutGroundAttackingDuelsPer90",
      "wyscoutExplicitlyWonGroundAttackingDuelSharePct",
    ].includes(key)), [
      "wyscoutGroundAttackingDuelsPer90",
      "wyscoutExplicitlyWonGroundAttackingDuelSharePct",
    ]);
    const duelRate = recommendation.evidence.find(({ key }) => key === "wyscoutGroundAttackingDuelsPer90");
    const wonShare = recommendation.evidence.find(({ key }) => key === "wyscoutExplicitlyWonGroundAttackingDuelSharePct");
    assert.equal(duelRate?.value, 1.8);
    assert.ok(Math.abs((wonShare?.value ?? 0) - 33.3333) < 0.0001);
    assert.equal(wonShare?.sampleAttempts, 3);
    assert.equal(wonShare?.sampleAttemptsLabel, "次已分类进攻对抗");
    assert.equal(recommendation.player.sourceIdentity?.isCurrentSeason, false);
    assert.equal(recommendation.player.datasetId, datasetId);
    assert.ok(wonShare?.definition?.includes("702（中性）"));
    assert.ok(wonShare?.sourceField?.includes("Ground attacking duel"));
    assert.ok(response.report?.limitations.some((item) => /不是现役球员池/.test(item)));
    assert.equal(response.report?.requestedCapabilityCoverage.find(({ name }) => name === "进攻一对一对抗")?.status, "observed");
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("the LangGraph report leaves unclassified attacking duels unavailable", async () => {
  const invalidOutcomes = [
    { label: "accuracy is not an outcome", tags: [{ id: 1801 }] },
    { label: "contradictory outcomes", tags: [{ id: 701 }, { id: 703 }] },
  ];
  for (const [index, invalidOutcome] of invalidOutcomes.entries()) {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-wyscout-unclassified-"));
    try {
      const { repository } = await buildCuratedFixtureRepository(dataDirectory, [{
        id: 14 + index,
        matchId: 1,
        teamId: 10,
        playerId: 101,
        eventName: "Duel",
        subEventName: "Ground attacking duel",
        matchPeriod: "2H",
        eventSec: 19 + index,
        tags: invalidOutcome.tags,
      }]);
      const response = await runAttackingDuelRequest(repository, `wyscout-attacking-duel-invalid-${index}`, false);

      assert.equal(response.status, "completed", invalidOutcome.label);
      assert.equal(response.report?.recommendations.length, 0, invalidOutcome.label);
      assert.equal(response.report?.requestedCapabilityCoverage.find(({ name }) => name === "进攻一对一对抗")?.status, "missing", invalidOutcome.label);
      assert.ok(response.report?.limitations.some((item) => item.includes("进攻一对一对抗") && item.includes("没有提供")), invalidOutcome.label);
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }
});
