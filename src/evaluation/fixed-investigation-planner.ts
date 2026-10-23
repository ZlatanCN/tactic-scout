import type { RecruitmentPlanner } from "../recruitment/conversation.js";
import { messageForRecruitmentAction } from "../recruitment/recruitment-tools.js";

/**
 * Evaluation-only fixed baseline: search the exact user question once with
 * hybrid retrieval, then use the shared model for the answer without RAG follow-up.
 */
export function createSinglePassInvestigationPlanner(conclusionPlanner: RecruitmentPlanner): RecruitmentPlanner {
  return {
    ...(conclusionPlanner.preflightContext ? {
      preflightContext: (input) => conclusionPlanner.preflightContext!(input),
    } : {}),
    requiresGatewayDispatch(input) {
      if (input.decisionSnapshot.caps.stage !== "investigate") return true;
      const completedTools = new Set(input.history
        .filter((entry) => entry.role === "tool")
        .map((entry) => entry.toolName));
      return completedTools.has("search_methodology");
    },
    isFinalSynthesis(input) {
      return input.decisionSnapshot.caps.stage === "investigate"
        && input.history.some((entry) => entry.role === "tool" && entry.toolName === "search_methodology");
    },
    async decide(input) {
      const snapshot = input.decisionSnapshot;
      if (snapshot.caps.stage === "investigate") {
        const completedTools = new Set(input.history
          .filter((entry) => entry.role === "tool")
          .map((entry) => entry.toolName));

        if (!completedTools.has("search_methodology")) {
          const query = input.history.filter((entry) => entry.role === "user").at(-1)?.content.trim().slice(0, 2_000)
            || "足球球员场上职责与比赛表现指标的评估方法";
          return messageForRecruitmentAction({
            action: "search_methodology",
            targetTeam: snapshot.case.targetTeam,
            query,
            additionalQueries: [],
            limit: 4,
          }, "fixed-investigation-methodology");
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
