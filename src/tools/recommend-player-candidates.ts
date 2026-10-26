import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";

import {
  readFmRecommendationProfiles,
  readFmRecommendationReferenceMetadata,
} from "../player-data/football-manager.js";
import {
  recommendPlayers,
  resolveRecommendationPosition,
} from "../player-data/recommend-players.js";
import { assertModelProcessingAllowed } from "../player-data/shared.js";

type RecommendationIdentityGroup = {
  fmIds: string[];
  identityKey: string;
  name: string;
};

type RecommendPlayerCandidatesInput = {
  excludeGroups: RecommendationIdentityGroup[];
  includePotential: boolean;
  maxAge: number | null;
  minimumCurrentAbility: number | null;
  minimumPotentialAbility: number | null;
  position: string | null;
  referenceGroups: RecommendationIdentityGroup[];
  resultLimit: number | null;
};

type RecommendPlayerCandidates = (
  input: RecommendPlayerCandidatesInput
) => string | Promise<string>;

const recommendationIdentityGroupSchema = z.object({
  fmIds: z.array(z.string()),
  identityKey: z.string().min(1),
  name: z.string().min(1),
});

const recommendationToolInputSchema = z.object({
  excludeGroups: z.array(recommendationIdentityGroupSchema).default([]),
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
  position: z
    .enum([
      "amc",
      "aml",
      "amr",
      "dc",
      "dl",
      "dm",
      "dr",
      "gk",
      "mc",
      "ml",
      "mr",
      "stc",
      "sw",
      "wbl",
      "wbr",
    ])
    .nullable()
    .default(null),
  referenceGroups: z.array(recommendationIdentityGroupSchema).min(1),
  resultLimit: z.number().int().min(1).max(20).nullable().default(null),
});

type PositionClarificationResult = {
  commonNaturalPositions: string[];
  positionOptions: string[];
  references: { fmId: string; name: string; naturalPositions: string | null }[];
  status: "position_required";
};

type RecommendationIdentityError = {
  groups: { fmIds: string[]; name: string }[];
  status:
    | "reference_profile_ambiguous"
    | "reference_profile_missing"
    | "excluded_profile_missing";
};

const deduplicateGroups = (
  groups: RecommendationIdentityGroup[]
): RecommendationIdentityGroup[] => {
  const grouped = new Map<string, { fmIds: Set<string>; names: Set<string> }>();

  for (const group of groups) {
    const current = grouped.get(group.identityKey) ?? {
      fmIds: new Set<string>(),
      names: new Set<string>(),
    };

    current.names.add(group.name);

    for (const fmId of group.fmIds) {
      current.fmIds.add(fmId);
    }

    grouped.set(group.identityKey, current);
  }

  return [...grouped.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([identityKey, group]) => ({
      fmIds: [...group.fmIds].toSorted(),
      identityKey,
      name: [...group.names].toSorted()[0] ?? identityKey,
    }));
};

const identityError = (
  groups: RecommendationIdentityGroup[],
  status: RecommendationIdentityError["status"]
): string =>
  JSON.stringify({
    groups: groups.map(({ fmIds, name }) => ({ fmIds, name })),
    status,
  });

const recommendPlayerCandidates: RecommendPlayerCandidates = (input) => {
  assertModelProcessingAllowed("fm");

  const referenceGroups = deduplicateGroups(input.referenceGroups);
  const excludeGroups = deduplicateGroups(input.excludeGroups);

  const referenceGroupsWithoutFm = referenceGroups.filter(
    (group) => group.fmIds.length === 0
  );

  const ambiguousReferenceGroups = referenceGroups.filter(
    (group) => group.fmIds.length > 1
  );

  if (referenceGroupsWithoutFm.length > 0) {
    return identityError(referenceGroupsWithoutFm, "reference_profile_missing");
  }

  if (ambiguousReferenceGroups.length > 0) {
    return identityError(
      ambiguousReferenceGroups,
      "reference_profile_ambiguous"
    );
  }

  const excludedGroupsWithoutFm = excludeGroups.filter(
    (group) => group.fmIds.length === 0
  );

  if (excludedGroupsWithoutFm.length > 0) {
    return identityError(excludedGroupsWithoutFm, "excluded_profile_missing");
  }

  const referenceFmIds = referenceGroups.map((group) => group.fmIds[0] ?? "");
  const excludeFmIds = excludeGroups.flatMap((group) => group.fmIds);
  let { position } = input;

  if (position === null) {
    const metadata = readFmRecommendationReferenceMetadata(referenceFmIds);

    if (metadata.status === "unavailable") {
      return JSON.stringify({
        reason: metadata.reason,
        status: "data_unavailable",
      });
    }

    if (metadata.missingReferenceFmIds.length > 0) {
      return JSON.stringify({
        missingReferenceFmIds: metadata.missingReferenceFmIds,
        status: "insufficient_reference_data",
      });
    }

    const positionResolution = resolveRecommendationPosition(
      null,
      metadata.profiles
    );

    if (positionResolution.status === "position_required") {
      const clarification: PositionClarificationResult = {
        commonNaturalPositions: positionResolution.commonPositions,
        positionOptions: positionResolution.positionOptions,
        references: metadata.profiles.map((profile) => ({
          fmId: profile.fmId,
          name: profile.name,
          naturalPositions: profile.naturalPositions,
        })),
        status: "position_required",
      };

      return JSON.stringify(clarification);
    }

    if (positionResolution.status === "unsupported_position") {
      const { position: unsupportedPosition } = positionResolution;

      return JSON.stringify({
        position: unsupportedPosition,
        status: "unsupported_position",
      });
    }

    const { position: selectedPosition } = positionResolution;
    position = selectedPosition;
  }

  const source = readFmRecommendationProfiles(position, referenceFmIds);

  const result = recommendPlayers(
    {
      excludeFmIds,
      includePotential: input.includePotential,
      maxAge: input.maxAge,
      minimumCurrentAbility: input.minimumCurrentAbility,
      minimumPotentialAbility: input.minimumPotentialAbility,
      position,
      referenceFmIds,
      resultLimit: input.resultLimit ?? 5,
    },
    source
  );

  return JSON.stringify(result);
};

const createRecommendPlayerCandidatesTool = (
  recommend: RecommendPlayerCandidates = recommendPlayerCandidates
) =>
  tool(recommend, {
    description:
      "按已解析 FM 身份查找位置级能力相似球员。多名 reference 会等权平均属性；exclude 从所有名单排除。当前相似名单按 RMSE 排序，高潜名单按 PA 独立排序。",
    name: "recommend_player_candidates",
    schema: recommendationToolInputSchema,
  });

export { createRecommendPlayerCandidatesTool, recommendPlayerCandidates };

export type {
  RecommendPlayerCandidates,
  RecommendPlayerCandidatesInput,
  RecommendationIdentityGroup,
};
