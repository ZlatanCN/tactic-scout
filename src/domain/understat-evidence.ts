import { z } from "zod/v4";

const NullableSourceTextSchema = z.string().nullable();

const NullableSourceNumberSchema = z.number().finite().nullable();

export const UnderstatPlayerResearchSchema = z.object({
  playerId: z.string().min(1),
  name: z.string().min(1),
  team: z.string().min(1),
  competition: z.string().min(1),
  season: z.string().min(1),
  sourcePlayerId: z.string().regex(/^[1-9]\d{0,14}$/),
  sourceUrl: z.string().url(),
  retrievedAt: z.string().datetime(),
  player: z.object({ id: z.string(), name: z.string(), favoritePosition: NullableSourceTextSchema }),
  lastMatch: z.object({ league: NullableSourceTextSchema, team: NullableSourceTextSchema, season: NullableSourceTextSchema }).nullable(),
  requestedSections: z.array(z.enum(["positions", "history", "recent", "shotProfile", "shots"])),
  availableSections: z.array(z.enum(["positions", "history", "recent", "shotProfile", "shots"])),
  positions: z.array(z.object({
    season: z.string(), code: z.string(), minutes: NullableSourceNumberSchema, games: NullableSourceNumberSchema,
    goals: NullableSourceNumberSchema, shots: NullableSourceNumberSchema, xG: NullableSourceNumberSchema,
    assists: NullableSourceNumberSchema, xA: NullableSourceNumberSchema, keyPasses: NullableSourceNumberSchema,
    npxG: NullableSourceNumberSchema, xGChain: NullableSourceNumberSchema, xGBuildup: NullableSourceNumberSchema,
  })).optional(),
  history: z.array(z.object({
    season: z.string(), team: NullableSourceTextSchema, position: NullableSourceTextSchema,
    games: NullableSourceNumberSchema, minutes: NullableSourceNumberSchema, goals: NullableSourceNumberSchema,
    shots: NullableSourceNumberSchema, xG: NullableSourceNumberSchema, assists: NullableSourceNumberSchema,
    xA: NullableSourceNumberSchema, keyPasses: NullableSourceNumberSchema, npxG: NullableSourceNumberSchema,
    xGChain: NullableSourceNumberSchema, xGBuildup: NullableSourceNumberSchema,
  })).optional(),
  recent: z.array(z.object({
    matchId: z.string(), date: NullableSourceTextSchema, season: NullableSourceTextSchema,
    homeTeam: NullableSourceTextSchema, awayTeam: NullableSourceTextSchema, homeGoals: NullableSourceNumberSchema,
    awayGoals: NullableSourceNumberSchema, position: NullableSourceTextSchema, minutes: NullableSourceNumberSchema,
    goals: NullableSourceNumberSchema, shots: NullableSourceNumberSchema, xG: NullableSourceNumberSchema,
    assists: NullableSourceNumberSchema, xA: NullableSourceNumberSchema, keyPasses: NullableSourceNumberSchema,
    npxG: NullableSourceNumberSchema, xGChain: NullableSourceNumberSchema, xGBuildup: NullableSourceNumberSchema,
  })).optional(),
  shotProfile: z.array(z.object({
    season: z.string(), dimension: z.enum(["situation", "shotZones", "shotTypes"]), category: z.string(),
    goals: NullableSourceNumberSchema, shots: NullableSourceNumberSchema, xG: NullableSourceNumberSchema,
    assists: NullableSourceNumberSchema, keyPasses: NullableSourceNumberSchema, xA: NullableSourceNumberSchema,
    npg: NullableSourceNumberSchema, npxG: NullableSourceNumberSchema, minutes: NullableSourceNumberSchema,
  })).optional(),
  shots: z.array(z.object({
    matchId: z.string(), date: NullableSourceTextSchema, minute: NullableSourceTextSchema,
    result: NullableSourceTextSchema, xG: NullableSourceNumberSchema, sourceX: NullableSourceNumberSchema,
    sourceY: NullableSourceNumberSchema, situation: NullableSourceTextSchema, shotType: NullableSourceTextSchema,
    lastAction: NullableSourceTextSchema, assistedBy: NullableSourceTextSchema,
  })).optional(),
  notes: z.array(z.string()),
});

export type UnderstatPlayerResearch = z.infer<typeof UnderstatPlayerResearchSchema>;

export const UnderstatTeamResearchSchema = z.object({
  team: z.string().min(1), competition: z.string().min(1), season: z.string().min(1), sourceUrl: z.string().url(), retrievedAt: z.string().datetime(),
  recentMatches: z.array(z.object({
    matchId: z.string(), date: NullableSourceTextSchema, status: NullableSourceTextSchema,
    homeTeam: NullableSourceTextSchema, awayTeam: NullableSourceTextSchema,
    homeGoals: NullableSourceNumberSchema, awayGoals: NullableSourceNumberSchema,
    homeXG: NullableSourceNumberSchema, awayXG: NullableSourceNumberSchema, result: NullableSourceTextSchema,
  })),
  statistics: z.array(z.object({
    dimension: z.string(), category: z.string(), shots: NullableSourceNumberSchema, goals: NullableSourceNumberSchema,
    xG: NullableSourceNumberSchema, againstShots: NullableSourceNumberSchema, againstGoals: NullableSourceNumberSchema,
    againstXG: NullableSourceNumberSchema, attempts: NullableSourceNumberSchema, time: NullableSourceNumberSchema,
  })),
  players: z.array(z.object({
    id: z.string(), name: z.string(), position: NullableSourceTextSchema, games: NullableSourceNumberSchema,
    minutes: NullableSourceNumberSchema, goals: NullableSourceNumberSchema, xG: NullableSourceNumberSchema,
    assists: NullableSourceNumberSchema, xA: NullableSourceNumberSchema, shots: NullableSourceNumberSchema,
    keyPasses: NullableSourceNumberSchema, xGChain: NullableSourceNumberSchema, xGBuildup: NullableSourceNumberSchema,
  })),
  notes: z.array(z.string()),
});

export type UnderstatTeamResearch = z.infer<typeof UnderstatTeamResearchSchema>;

export const UnderstatMatchResearchSchema = z.object({
  matchId: z.string(), sourceUrl: z.string().url(), homeTeam: NullableSourceTextSchema, awayTeam: NullableSourceTextSchema,
  date: NullableSourceTextSchema, score: z.object({ home: NullableSourceNumberSchema, away: NullableSourceNumberSchema }),
  rosters: z.array(z.object({
    team: z.enum(["home", "away"]), playerId: NullableSourceTextSchema, name: NullableSourceTextSchema,
    position: NullableSourceTextSchema, positionOrder: NullableSourceNumberSchema, minutes: NullableSourceNumberSchema,
    goals: NullableSourceNumberSchema, ownGoals: NullableSourceNumberSchema, shots: NullableSourceNumberSchema,
    xG: NullableSourceNumberSchema, assists: NullableSourceNumberSchema, xA: NullableSourceNumberSchema,
    keyPasses: NullableSourceNumberSchema, yellowCards: NullableSourceNumberSchema, redCards: NullableSourceNumberSchema,
  })),
  shots: z.array(z.object({
    team: z.enum(["home", "away"]), playerId: NullableSourceTextSchema, player: NullableSourceTextSchema,
    minute: NullableSourceTextSchema, result: NullableSourceTextSchema, xG: NullableSourceNumberSchema,
    sourceX: NullableSourceNumberSchema, sourceY: NullableSourceNumberSchema, situation: NullableSourceTextSchema,
    shotType: NullableSourceTextSchema, lastAction: NullableSourceTextSchema, assistedBy: NullableSourceTextSchema,
  })),
  notes: z.array(z.string()),
});

export type UnderstatMatchResearch = z.infer<typeof UnderstatMatchResearchSchema>;
