import { describe, expect, it } from "vitest";

import { correctTeamRecommendationAnswer } from "../src/recommendation-answer.js";
import type { RecommendTeamPlayerCandidatesInput } from "../src/tools/recommend-team-player-candidates.js";
import {
  recommendationResultData,
  teamRecommendationResult,
} from "./fixtures/workflow-results.js";

const team = { country: "Westreach", id: 10_101, name: "Northvale Athletic" };

const teamInput = (): RecommendTeamPlayerCandidatesInput => ({
  includePotential: false,
  maxAge: null,
  minimumCurrentAbility: null,
  minimumPotentialAbility: null,
  position: "stc",
  referenceFmIds: [],
  referenceMode: "squad",
  resultLimit: 5,
  roster: {
    members: [],
    retrievedAt: "2025-11-20T12:00:00.000Z",
    team,
  },
  team,
});

describe("team recommendation answer correction", () => {
  it("replaces a hallucinated roster retrieval date with the provider timestamp", () => {
    const result = teamRecommendationResult("ready", teamInput());

    const corrected = correctTeamRecommendationAnswer(
      "阵容数据来自 API-Football，获取日期为 2026-11-20；FM 快照日期为 2025-11-23。",
      result
    );

    expect(corrected).toContain("获取时间：2025-11-20T12:00:00.000Z");
    expect(corrected).not.toContain("2026-11-20");
  });

  it("keeps a correctly reported roster retrieval date", () => {
    const result = teamRecommendationResult("ready", teamInput());

    expect(
      correctTeamRecommendationAnswer(
        "阵容来源 API-Football，获取日期 2025年11月20日；FM 快照日期为 2025-11-23。",
        result
      )
    ).toBeNull();
  });

  it("corrects a false count of eligible squad reference profiles", () => {
    const input = {
      ...teamInput(),
      referenceFmIds: ["fm-ref-1", "fm-ref-2"],
      roster: {
        ...teamInput().roster,
        members: [
          {
            apiFootballPlayerId: 1,
            fmCandidates: [],
            fmId: "fm-ref-1",
            mappingMethod: "reep_bridge" as const,
            mappingStatus: "resolved" as const,
            name: "Reference One",
            position: "Attacker",
          },
          {
            apiFootballPlayerId: 2,
            fmCandidates: [],
            fmId: "fm-ref-2",
            mappingMethod: "user_confirmation" as const,
            mappingStatus: "resolved" as const,
            name: "Reference Two",
            position: "Attacker",
          },
        ],
      },
    } satisfies RecommendTeamPlayerCandidatesInput;

    const defaults = recommendationResultData("ready", "stc");

    const result = teamRecommendationResult("ready", input, {
      filterCounts: {
        ...defaults.filterCounts,
        eligiblePositionProfiles: 5,
      },
      referenceFmIds: input.referenceFmIds,
      references: [
        {
          ...defaults.references[0],
          fmId: "fm-ref-1",
          name: "Reference One",
        },
        {
          ...defaults.references[0],
          fmId: "fm-ref-2",
          name: "Reference Two",
        },
      ],
    });

    const answer =
      "阵容数据来自 API-Football，获取时间为 2025-11-20；FM 快照日期为 2025-11-23。球队参考画像由 5 名位置评分合格且目标位置所需属性完整的队内 FM 画像组成。";

    const corrected = correctTeamRecommendationAnswer(answer, result);

    expect(corrected).not.toBeNull();
    expect(corrected).toContain(
      "队内参考画像（已作为参考并从候选中排除；2 人）"
    );
    expect(corrected).not.toContain("参考画像由 5 名");
  });
});
