import type { RecruitmentPlanner } from "../recruitment/conversation.js";

const fixedMethodologyQuery = "足球球员场上职责与比赛表现指标的评估方法";

/**
 * Evaluation-only baseline: make one generic methodology lookup and one
 * candidate-page request, then use the shared model only for conclusion.
 */
export function createSinglePassInvestigationPlanner(conclusionPlanner: RecruitmentPlanner): RecruitmentPlanner {
  return {
    async decide(input) {
      if (input.decisionMode === "investigate") {
        const completedTools = new Set(input.history
          .filter((entry) => entry.role === "tool")
          .map((entry) => entry.toolName));

        if (!completedTools.has("search_methodology")) {
          return {
            action: "search_methodology",
            targetTeam: input.targetTeam,
            query: fixedMethodologyQuery,
            limit: 4,
          };
        }

        if (!completedTools.has("search_candidates")) {
          return {
            action: "search_candidates",
            targetTeam: input.targetTeam,
            position: input.confirmedPosition,
            playerName: null,
            maxAge: null,
            minimumMinutes: 0,
            competition: null,
            season: null,
            offset: 0,
            limit: 20,
          };
        }
      }

      return conclusionPlanner.decide({ ...input, decisionMode: "conclude" });
    },
  };
}
