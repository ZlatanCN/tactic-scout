import { type LangGraphRunnableConfig, type Runtime } from "@langchain/langgraph";
import { alignRecommendationEvidenceToRequestedCapabilities, validateConclusion } from "../conclusion-policy.js";
import { userMessages } from "./candidate-context.js";
import { type RecruitmentReviewerMode, type RecruitmentTraceEvent, type RecruitmentTraceObserver } from "./contracts.js";
import { emitProgress } from "./progress.js";
import { type State } from "./state.js";
import { type RecruitmentRuntimeContext, requireRecruitmentRuntimeContext } from "./runtime-context.js";

export function createReviewNode(input: {
  reviewerMode: RecruitmentReviewerMode;
}) {
  const { reviewerMode } = input;
  return (state: State, runtime: Runtime<RecruitmentRuntimeContext>): Partial<State> => {
    const context = requireRecruitmentRuntimeContext(runtime.context);
    const observer = context.observer;
    const config = runtime as LangGraphRunnableConfig;
    const reviewStartedAt = performance.now();
    const recordReview = (event: Omit<Extract<RecruitmentTraceEvent, { phase: "review" }>, "elapsedMs">) => {
      observer?.({ ...event, elapsedMs: Math.round(performance.now() - reviewStartedAt) });
    };
    if (reviewerMode === "bypassed") {
      emitProgress(config, {
        stage: "review",
        status: "notice",
        message: "当前评测实验臂跳过确定性证据复核",
        completedSteps: state.decisionSteps,
      });
      recordReview({ phase: "review", mode: reviewerMode, outcome: "bypassed" });
      return { reviewResult: "bypassed" as const };
    }

    emitProgress(config, { stage: "review", message: "正在核对推荐是否有对应的数据证据", completedSteps: state.decisionSteps });
    const alignment = alignRecommendationEvidenceToRequestedCapabilities({
      action: state.action,
      brief: state.brief,
      userMessages: userMessages(state.history),
      evaluatedPlayers: state.evaluatedPlayers,
    });
    const problems = validateConclusion({
      action: alignment.action,
      brief: state.brief,
      confirmedPosition: state.confirmedPosition,
      confirmedPositions: state.confirmedPositions,
      userMessages: userMessages(state.history),
      evaluatedPlayers: state.evaluatedPlayers,
      retrievedKnowledge: state.retrievedKnowledge,
      candidateIdentityGroups: state.candidateIdentityGroups,
    });
    if (!problems.length) {
      emitProgress(config, {
        stage: "review",
        status: "completed",
        message: alignment.repairedReferenceCount > 0
          ? "已将推荐证据对齐到本轮观察到的相关指标，复核通过"
          : "证据复核通过，推荐内容与本轮已评估资料相符",
        completedSteps: state.decisionSteps,
      });
      recordReview({
        phase: "review",
        mode: reviewerMode,
        outcome: "passed",
        problemCount: 0,
        repairedEvidenceReferenceCount: alignment.repairedReferenceCount,
      });
      return { action: alignment.action, reviewResult: "valid" as const };
    }
    if (state.reviewAttempts < 1) {
      emitProgress(config, {
        stage: "review",
        status: "notice",
        message: "证据复核发现需要补查的部分，Agent 将再调查一次",
        completedSteps: state.decisionSteps,
      });
      recordReview({
        phase: "review",
        mode: reviewerMode,
        outcome: "retry",
        problemCount: problems.length,
        repairedEvidenceReferenceCount: alignment.repairedReferenceCount,
      });
      return {
        action: alignment.action,
        reviewAttempts: state.reviewAttempts + 1,
        reviewResult: "retry" as const,
        history: [{ role: "tool" as const, toolName: "evidence_review", content: JSON.stringify({ problems, recovery: { action: "recompose_report", instruction: "只修复列出的证据或身份问题；使用已经评估的候选和其真实指标，不重复已完成的数据查询。", eligibleCandidates: Object.values(state.evaluatedPlayers).map(({ player, evidence }) => ({ playerId: player.playerId, evidenceKeys: evidence.map(item => item.key) })) } }) }],
      };
    }
    emitProgress(config, {
      stage: "review",
      status: "notice",
      message: "补查后仍存在证据缺口，最终报告会收窄推荐并说明限制",
      completedSteps: state.decisionSteps,
    });
    recordReview({
      phase: "review",
      mode: reviewerMode,
      outcome: "exhausted",
      problemCount: problems.length,
      repairedEvidenceReferenceCount: alignment.repairedReferenceCount,
    });
    const finish = alignment.action;
    if (finish?.action !== "finish") return { action: finish, reviewResult: "exhausted" as const };
    const retained: typeof finish.recommendations = [];
    for (const recommendation of finish.recommendations) {
      const candidateAction = { ...finish, recommendations: [...retained, recommendation], reportObservations: [] };
      if (validateConclusion({ action: candidateAction, confirmedPosition: state.confirmedPosition,
      confirmedPositions: state.confirmedPositions,
        brief: state.brief,
        userMessages: userMessages(state.history), evaluatedPlayers: state.evaluatedPlayers,
        retrievedKnowledge: state.retrievedKnowledge, candidateIdentityGroups: state.candidateIdentityGroups }).length === 0) retained.push(recommendation);
    }
    return { action: { ...finish, recommendations: retained, reportObservations: [],
      needSummary: `${finish.needSummary} 复查后移除未通过证据核验的内容，保留 ${retained.length} 名可核实候选。` }, reviewResult: "exhausted" as const };
  };
}
