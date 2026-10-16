import assert from "node:assert/strict";
import test from "node:test";
import { searchPlayerPage } from "../../src/players/repository.js";
import { canProvideDetailedPositionEvidence } from "../../src/players/position-evidence.js";
import { searchLoadedPlayers } from "../../src/players/search.js";
import { PlayerProfileSchema } from "../../src/domain/players.js";
import { type Position } from "../../src/domain/position-contracts.js";
import { playerPositionMatches, positionMatchesRetrieval } from "../../src/domain/positions.js";

const detailedRoles = ["CB", "FB", "LB", "RB", "LWB", "RWB", "DM", "CM", "AM", "WG", "LW", "RW", "ST"] as const;

test("every detailed role retrieves its broad source category without treating it as a role match", () => {
  const broadGroupFor = (role: typeof detailedRoles[number]) => {
    if (["CB", "FB", "LB", "RB", "LWB", "RWB"].includes(role)) return "DEF" as const;
    if (["DM", "CM", "AM"].includes(role)) return "MID" as const;
    return "ATT" as const;
  };

  for (const role of detailedRoles) {
    const broad = broadGroupFor(role);
    assert.equal(positionMatchesRetrieval(broad, role), true, `${role} should retrieve ${broad} records`);
    assert.equal(playerPositionMatches({ position: broad }, role), false, `${broad} must not qualify as ${role}`);
  }
});

test("13-role position ablation separates strict recall, family recall, and source-evidence qualification", () => {
  const broadGroupFor = (role: typeof detailedRoles[number]) => {
    if (["CB", "FB", "LB", "RB", "LWB", "RWB"].includes(role)) return "DEF" as const;
    if (["DM", "CM", "AM"].includes(role)) return "MID" as const;
    return "ATT" as const;
  };
  const queryFor = (position: Position, positionMatchMode: "exact" | "family") => ({
    playerName: null,
    position,
    maxAge: null,
    minimumMinutes: 0,
    competition: null,
    season: null,
    offset: 0,
    limit: 20,
    positionMatchMode,
  });

  for (const role of detailedRoles) {
    const broadPosition = broadGroupFor(role);
    const player = PlayerProfileSchema.parse({
      playerId: `${role}-broad-only`,
      name: `${role} Broad Record`,
      team: "Harbor City",
      age: 24,
      position: broadPosition,
      competition: "Open League",
      season: "2025/26",
      minutes: 1200,
      stats: {},
      sourceIdentity: { provider: "fixture", playerId: `${role}-broad-only`, retrievedAt: "2026-10-16T00:00:00.000Z" },
      source: "Fixture source",
    });
    const strictMatches = searchLoadedPlayers([player], queryFor(role, "exact")).players;
    const familyMatches = searchLoadedPlayers([player], queryFor(role, "family")).players;
    const qualifiedMatches = familyMatches.filter((candidate) => playerPositionMatches(candidate, role));

    assert.equal(strictMatches.length, 0, `${role}: strict catalog filtering should lose a broad source record`);
    assert.equal(familyMatches.length, 1, `${role}: family retrieval should retain it as a lead`);
    assert.equal(qualifiedMatches.length, 0, `${role}: broad data must not become an exact role candidate`);
  }
});

test("fullback and winger parent labels are retrievable evidence, while sibling roles stay distinct", () => {
  assert.equal(positionMatchesRetrieval("FB", "LB"), true);
  assert.equal(playerPositionMatches({ position: "FB" }, "LB"), false);
  assert.equal(positionMatchesRetrieval("RB", "LB"), false);
  assert.equal(positionMatchesRetrieval("WG", "LW"), true);
  assert.equal(playerPositionMatches({ position: "WG" }, "LW"), false);
  assert.equal(positionMatchesRetrieval("RW", "LW"), false);
});

test("a provider's explicit multi-position samples can satisfy only the observed roles", () => {
  const versatilePlayer = {
    position: "LB" as const,
    sourceIdentity: {
      provider: "statsbomb-open-data",
      positionGroups: ["LB", "CB"] as const,
      positionSamples: [
        { position: "LB" as const, minutes: 45 },
        { position: "CB" as const, minutes: 45 },
      ],
    },
  };
  assert.equal(playerPositionMatches(versatilePlayer, "LB"), true);
  assert.equal(playerPositionMatches(versatilePlayer, "CB"), true);
  assert.equal(playerPositionMatches(versatilePlayer, "RB"), false);
});

test("unknown primary labels do not hide a source's explicit position groups", () => {
  assert.equal(positionMatchesRetrieval("UNKNOWN", "CM", ["MID"]), true);
  assert.equal(positionMatchesRetrieval("UNKNOWN", "CM", ["CM"]), true);
  assert.equal(playerPositionMatches({ position: "UNKNOWN", sourceIdentity: { provider: "statsbomb", positionGroups: ["CM"] } }, "CM"), true);
  assert.equal(playerPositionMatches({ position: "UNKNOWN", sourceIdentity: { provider: "statsbomb", positionGroups: ["MID"] } }, "CM"), false);
});

test("coarse-only providers return broad leads for a detailed query without upgrading them to role evidence", async () => {
  const broadMidfielder = PlayerProfileSchema.parse({
    playerId: "broad-midfielder",
    name: "Broad Midfielder",
    team: "Harbor City",
    age: 24,
    position: "MID",
    competition: "Open League",
    season: "2025/26",
    minutes: 1200,
    stats: {},
    sourceIdentity: {
      provider: "coarse-provider",
      playerId: "broad-midfielder",
      retrievedAt: "2026-10-16T00:00:00.000Z",
    },
    source: "Fixture source",
  });

  for (const mode of ["fpl", "premier_league", "fbref", "wyscout"] as const) {
    const page = await searchPlayerPage({
      mode,
      sourceName: mode,
      async loadPlayers() { return [broadMidfielder]; },
    }, {
      playerName: null,
      position: "CM",
      maxAge: null,
      minimumMinutes: 0,
      competition: null,
      season: null,
      offset: 0,
      limit: 20,
    });

    assert.deepEqual(page.players.map(({ playerId }) => playerId), ["broad-midfielder"], `${mode} should retain a broad-position lead`);
    assert.ok(page.appliedFilters.includes("positionFamily"), `${mode} must disclose family retrieval`);
    assert.equal(playerPositionMatches(page.players[0]!, "CM"), false, `${mode} must not qualify MID as CM`);
  }
});

test("position evidence paging uses the detail each provider can actually report", () => {
  const evidenceRolesByMode = {
    demo: detailedRoles,
    statsbomb: detailedRoles,
    sportmonks: detailedRoles,
    skillcorner: ["CB", "FB", "WG", "ST"],
    asa: ["CB", "FB", "DM", "CM", "AM", "WG", "ST"],
    curated: detailedRoles,
    mosaic: detailedRoles,
  } as const;

  for (const [mode, evidenceRoles] of Object.entries(evidenceRolesByMode)) {
    for (const role of detailedRoles) {
      assert.equal(
        canProvideDetailedPositionEvidence(mode as keyof typeof evidenceRolesByMode, role),
        evidenceRoles.includes(role),
        `${mode} ${role} paging capability should reflect source-native position labels`,
      );
    }
  }
  for (const mode of ["fpl", "premier_league", "fbref", "wyscout", "understat"] as const) {
    for (const role of detailedRoles) {
      assert.equal(canProvideDetailedPositionEvidence(mode, role), false, `${mode} uses a separate or coarse-only investigation path for ${role}`);
    }
  }
});
