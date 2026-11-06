import { describe, expect, it } from "vitest";

import { correctTeamRecommendationAnswer } from "../src/recommendation-answer.js";
import type { RecommendTeamPlayerCandidatesInput } from "../src/tools/recommend-team-player-candidates.js";
import { teamRecommendationResult } from "./fixtures/workflow-results.js";

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
});
