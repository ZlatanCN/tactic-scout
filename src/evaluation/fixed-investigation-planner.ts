import type { RecruitmentPlanner } from "../recruitment/conversation.js";
import { messageForRecruitmentAction } from "../recruitment/recruitment-tools.js";

const fixedMethodologyQuery = "足球球员场上职责与比赛表现指标的评估方法";

/**
 * Evaluation-only baseline: make one generic methodology lookup and one
 * candidate-page request, then use the shared model only for conclusion.
 */
export function createSinglePassInvestigationPlanner(conclusionPlanner: RecruitmentPlanner): RecruitmentPlanner {
  return {
    ...(conclusionPlanner.preflightContext ? {
      preflightContext: (input) => conclusionPlanner.preflightContext!(input),
    } : {}),
    async decide(input) {
      const snapshot = input.decisionSnapshot;
      if (snapshot.caps.stage === "investigate") {
        const completedTools = new Set(input.history
          .filter((entry) => entry.role === "tool")
          .map((entry) => entry.toolName));

        if (!completedTools.has("search_methodology")) {
          return messageForRecruitmentAction({
            action: "search_methodology",
            targetTeam: snapshot.case.targetTeam,
            query: fixedMethodologyQuery,
            limit: 4,
          }, "fixed-investigation-methodology");
        }

        if (!completedTools.has("search_candidates")) {
          return messageForRecruitmentAction({
            action: "search_candidates",
            targetTeam: snapshot.case.targetTeam,
            position: snapshot.case.confirmedPosition,
            playerName: null,
            maxAge: null,
            minimumMinutes: 0,
            competition: null,
            season: null,
            offset: 0,
            limit: 20,
          }, "fixed-investigation-candidates");
        }
      }

      return conclusionPlanner.decide({
        ...input,
        decisionSnapshot: {
          ...snapshot,
          caps: { ...snapshot.caps, stage: "conclude" },
        },
      });
    },
  };
}
