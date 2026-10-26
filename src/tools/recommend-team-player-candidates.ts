import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";

import { readFmRecommendationProfiles } from "../player-data/football-manager.js";
import { recommendTeamPlayers } from "../player-data/recommend-players.js";
import { assertModelProcessingAllowed } from "../player-data/shared.js";
import type {
  TeamIdentity,
  TeamRosterSnapshot,
} from "../team-data/contracts.js";
import { teamRosterCoverage } from "../team-data/roster-coverage.js";

type RecommendTeamPlayerCandidatesInput = {
  includePotential: boolean;
  maxAge: number | null;
  minimumCurrentAbility: number | null;
  minimumPotentialAbility: number | null;
  position: string;
  referenceFmIds: string[];
  referenceMode: "squad" | "named";
  resultLimit: number | null;
  roster: TeamRosterSnapshot;
  team: TeamIdentity;
};

type RecommendTeamPlayerCandidates = (
  input: RecommendTeamPlayerCandidatesInput
) => string | Promise<string>;

const teamIdentitySchema = z.object({
  country: z.string().nullable(),
  id: z.number().int().positive(),
  name: z.string().min(1),
});

const teamRosterSchema = z.object({
  members: z.array(
    z.object({
      apiFootballPlayerId: z.number().int().positive(),
      fmCandidates: z.array(z.object({ fmId: z.string(), name: z.string() })),
      fmId: z.string().nullable(),
      mappingMethod: z.enum(["reep_bridge", "user_confirmation"]).nullable(),
      mappingStatus: z.enum(["pending", "resolved", "no_profile"]),
      name: z.string(),
      position: z.string().nullable(),
    })
  ),
  retrievedAt: z.string(),
  team: teamIdentitySchema,
});

const teamRecommendationInputSchema = z.object({
  includePotential: z.boolean().default(false),
  maxAge: z.number().int().min(1).max(120).nullable().default(null),
  minimumCurrentAbility: z
    .number()
    .int()
    .min(1)
    .max(200)
    .nullable()
    .default(null),
  minimumPotentialAbility: z
    .number()
    .int()
    .min(1)
    .max(200)
    .nullable()
    .default(null),
  position: z.string().min(1),
  referenceFmIds: z.array(z.string()),
  referenceMode: z.enum(["squad", "named"]),
  resultLimit: z.number().int().min(1).max(20).nullable().default(null),
  roster: teamRosterSchema,
  team: teamIdentitySchema,
});

const recommendTeamPlayerCandidates: RecommendTeamPlayerCandidates = (
  input
) => {
  assertModelProcessingAllowed("fm");

  const rosterFmIds = input.roster.members.flatMap((member) =>
    member.fmId === null ? [] : [member.fmId]
  );

  const requestedReferenceFmIds =
    input.referenceMode === "squad" ? rosterFmIds : input.referenceFmIds;

  const source = readFmRecommendationProfiles(
    input.position,
    requestedReferenceFmIds
  );

  const calculation = recommendTeamPlayers(
    {
      excludeFmIds: rosterFmIds,
      includePotential: input.includePotential,
      maxAge: input.maxAge,
      minimumCurrentAbility: input.minimumCurrentAbility,
      minimumPotentialAbility: input.minimumPotentialAbility,
      position: input.position,
      referenceFmIds: requestedReferenceFmIds,
      resultLimit: input.resultLimit ?? 5,
    },
    source
  );

  const coverage = teamRosterCoverage(input.roster);

  if (calculation.status === "team_position_unavailable") {
    return JSON.stringify({
      filters: {
        includePotential: input.includePotential,
        maxAge: input.maxAge,
        minimumCurrentAbility: input.minimumCurrentAbility,
        minimumPotentialAbility: input.minimumPotentialAbility,
        resultLimit: input.resultLimit ?? 5,
      },
      fmSnapshotDate: calculation.snapshotDate,
      position: calculation.position,
      rankingBasis:
        input.referenceMode === "squad"
          ? "equal_weight_mean_of_position_capable_squad_profiles"
          : "named_fm_reference_profile",
      referenceFmIds: [],
      roster: {
        ...coverage,
        retrievedAt: input.roster.retrievedAt,
        source: "API-Football",
      },
      status: calculation.status,
      team: input.team,
    });
  }

  return JSON.stringify({
    filters: {
      includePotential: input.includePotential,
      maxAge: input.maxAge,
      minimumCurrentAbility: input.minimumCurrentAbility,
      minimumPotentialAbility: input.minimumPotentialAbility,
      resultLimit: input.resultLimit ?? 5,
    },
    fmSnapshotDate:
      "snapshotDate" in calculation.recommendation
        ? calculation.recommendation.snapshotDate
        : null,
    position: input.position,
    rankingBasis:
      input.referenceMode === "squad"
        ? "equal_weight_mean_of_position_capable_squad_profiles"
        : "named_fm_reference_profile",
    recommendation: calculation.recommendation,
    referenceFmIds: calculation.referenceFmIds,
    roster: {
      ...coverage,
      retrievedAt: input.roster.retrievedAt,
      source: "API-Football",
    },
    status: calculation.recommendation.status,
    team: input.team,
  });
};

const createRecommendTeamPlayerCandidatesTool = (
  recommend: RecommendTeamPlayerCandidates = recommendTeamPlayerCandidates
) =>
  tool(recommend, {
    description:
      "按已映射的当前球队阵容和明确位置生成 FM 球员推荐；使用队内合格画像的等权均值和现有 RMSE 规则，并排除全部队内球员。",
    name: "recommend_team_player_candidates",
    schema: teamRecommendationInputSchema,
  });

export {
  createRecommendTeamPlayerCandidatesTool,
  recommendTeamPlayerCandidates,
};

export type {
  RecommendTeamPlayerCandidates,
  RecommendTeamPlayerCandidatesInput,
};
