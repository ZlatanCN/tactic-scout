import type { PlayerRecommendation } from "../../src/domain/schemas.js";

export function describeEmptyShortlist(recordedSearchScopeCount: number): { title: string; summary: string } {
  if (recordedSearchScopeCount === 0) {
    return {
      title: "本轮还没有可核验的候选结果",
      summary: "当前报告没有记录到已完成的候选查询；这和查询成功后没有匹配结果是两种情况。先查看数据来源状态与本轮限制，再决定是否继续调查。",
    };
  }
  return {
    title: "本轮没有形成候选名单",
    summary: "报告记录了本轮候选查询范围，但没有形成可进一步核查的候选名单。该结果只反映本次数据源和已执行范围，不能代表整个转会市场。展开候选检索范围查看实际条件；也可以在对话中调整需求后继续调查。",
  };
}

export type PresentedRecommendation = {
  recommendation: PlayerRecommendation;
  playerId: string;
  hasFocusEvidence: boolean;
  canCompare: boolean;
  rank: number | null;
};

export function createRecommendationPresentation(recommendations: PlayerRecommendation[]): {
  recommendations: PresentedRecommendation[];
  focusEvidenceCount: number;
  backgroundOnlyCount: number;
} {
  let focusEvidenceCount = 0;
  let backgroundOnlyCount = 0;

  const presented = recommendations.map((recommendation) => {
    const evidenceKeys = new Set(recommendation.evidence.map((evidence) => evidence.key));
    const hasFocusEvidence = recommendation.focusEvidenceKeys.some((key) => evidenceKeys.has(key));
    if (hasFocusEvidence) focusEvidenceCount++;
    else backgroundOnlyCount++;

    return {
      recommendation,
      playerId: recommendation.player.playerId,
      hasFocusEvidence,
      canCompare: hasFocusEvidence,
      rank: hasFocusEvidence ? focusEvidenceCount : null,
    };
  });

  return { recommendations: presented, focusEvidenceCount, backgroundOnlyCount };
}
