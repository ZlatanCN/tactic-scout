import { recruitmentRetrievalNeeds, type RecruitmentRetrievalMode } from "./retrieval-policy.js";
import { type LangGraphRunnableConfig } from "@langchain/langgraph";
import { type PlayerRepository } from "../../players/repository.js";
import { type PlayerProfile } from "../../domain/players.js";
import { type CandidateIdentityGroup } from "../../players/identity/candidate-groups.js";
import { type RecruitmentExpansionConstraints, buildDecisionConstraints, conclusionPlannerOutputFallback, expansionPlannerFallback } from "../conclusion-policy.js";
import { compactConclusionHistory, compactExpansionHistory } from "../planner-context.js";
import { type ParsedRecruitmentAction, type RecruitmentAction, emptyDecision, RecruitmentActionSchema, toolBudgets } from "../recruitment-actions.js";
import { type RecruitmentPlanner, type RecruitmentPlannerUsageObservation, RecruitmentModelTimeoutError, RecruitmentPlannerOutputError } from "../recruitment-planner.js";
import { candidateIdentityGroupReferencesFor, confirmedPositionSearchObservation, userMessages } from "./candidate-context.js";
import { type RecruitmentAskUserMode, type RecruitmentCandidatePolicyMode, type RecruitmentTraceObserver, type UnderstatResearchMode } from "./contracts.js";
import { actionForAskPolicy, askPolicyDisabledPause, policyBlockReasonCode, questionForAskPolicy } from "./interaction-policy.js";
import { enforceInvestigationAction, investigationActionFeedback } from "./planned-action-policy.js";
import { emitProgress } from "./progress.js";
import { investigationCandidates, nextRequiredInvestigation } from "./required-investigation.js";
import { type State } from "./state.js";

export function createPlanningNode(input: {
  deterministicSearchEnabled: boolean;
  retrievalMode: RecruitmentRetrievalMode;
  repository: PlayerRepository;
  planner: RecruitmentPlanner;
  observer: RecruitmentTraceObserver | undefined;
  groupCandidateRecords: (records: readonly PlayerProfile[]) => CandidateIdentityGroup[];
  askUserMode: RecruitmentAskUserMode;
  candidatePolicyMode: RecruitmentCandidatePolicyMode;
  enforceCurrentTurnObservation: boolean;
  understatResearchMode?: UnderstatResearchMode;
}) {
  const { repository, planner, observer, groupCandidateRecords, askUserMode, candidatePolicyMode, enforceCurrentTurnObservation } = input;
  return async (state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> => {
    emitProgress(config, {
      stage: "planning",
      message: state.decisionSteps === 0 ? "正在整理需求并规划调查步骤" : "正在根据已收集的信息规划下一步调查",
      completedSteps: state.decisionSteps,
    });
    const completePlanning = (message: string) => emitProgress(config, {
      stage: "planning",
      status: "completed",
      message,
      completedSteps: state.decisionSteps,
    });
    const retrievalNeeds = recruitmentRetrievalNeeds(state, input.retrievalMode);
    const required = nextRequiredInvestigation(state, repository, { retrievalNeeds, deterministicSearchEnabled: input.deterministicSearchEnabled, understatResearchMode: input.understatResearchMode });
    if (required) {
      const { action } = required;
      const isQuestion = action.action === "ask_user";
      const suppressed = isQuestion && askUserMode === "disabled";
      const pendingQuestion = isQuestion ? required.pendingQuestion ?? questionForAskPolicy(action, askUserMode) : null;
      const effectivePendingQuestion = suppressed ? askPolicyDisabledPause : pendingQuestion;
      observer?.({
        phase: "decision", action: action.action, decisionSource: "policy", elapsedMs: 0, ok: true, policyBlocked: false,
        ...(isQuestion ? { askPolicyOutcome: suppressed ? "suppressed" : "allowed" } : {}), targetTeam: action.targetTeam
      });
      completePlanning(suppressed ? required.suppressedMessage ?? required.message : required.message);
      return {
        action: isQuestion ? actionForAskPolicy(action, askUserMode) : action,
        decisionSteps: state.decisionSteps + 1,
        policyBlocked: false,
        policyBlockedRepeatCount: 0,
        ...(effectivePendingQuestion ? { pendingQuestion: effectivePendingQuestion, responseMessage: effectivePendingQuestion.question } : {}),
        history: required.history ?? [{ role: "assistant", content: suppressed ? JSON.stringify({ action: "ask_user", suppressed: true }) : JSON.stringify(action) }],
        ...required.update,
      };
    }
    const { eligibleEvaluatedPlayers, unsearchedReportCandidates } = investigationCandidates(state);
    const currentTurnCandidateSearches = state.candidateSearchObservations.slice(state.candidateSearchTurnStartIndex);
    const latestCandidatePage = currentTurnCandidateSearches.at(-1)
      ?? (state.positionBroadeningApproved ? confirmedPositionSearchObservation(state) : null);
    const candidatePageNextOffset = latestCandidatePage?.nextOffset ?? null;
    const candidatePageAction = latestCandidatePage?.request ?? null;
    // Report lookup has its own disclosure when capped; it must not block further candidate pages.
    const canExpandCandidates = candidatePageNextOffset !== null
      && candidatePageAction !== null
      && state.toolUses.search_candidates < toolBudgets.search_candidates
      && state.toolUses.evaluate_candidates < toolBudgets.evaluate_candidates
      && input.understatResearchMode === undefined;
    const reportSearchBudgetReached = state.toolUses.search_player_reports >= toolBudgets.search_player_reports;
    const reportsForCurrentCandidatesComplete = state.candidateSearchObservations.length > 0 && (!retrievalNeeds.playerReports || (state.hasSearchedPlayerReports
      && unsearchedReportCandidates.length === 0)
      || reportSearchBudgetReached);
    const decisionMode = reportsForCurrentCandidatesComplete
      ? canExpandCandidates
        ? state.policyBlocked && state.action?.action === "ask_user"
          ? "expand_recovery" as const
          : "expand" as const
        : candidatePageNextOffset === null && state.toolUses.search_candidates < toolBudgets.search_candidates
          ? "reorient" as const
          : "conclude" as const
      : "investigate" as const;
    const decisionConstraints = decisionMode === "investigate" ? undefined : buildDecisionConstraints({
      targetTeam: state.targetTeam,
      confirmedPosition: state.confirmedPosition,
      confirmedPositions: state.confirmedPositions,
      userMessages: userMessages(state.history),
      evaluatedPlayers: Object.values(eligibleEvaluatedPlayers),
      retrievedKnowledge: Object.values(state.retrievedKnowledge),
      candidateIdentityGroups: candidateIdentityGroupReferencesFor(state, groupCandidateRecords),
    });
    const expansionConstraints: RecruitmentExpansionConstraints | undefined = (decisionMode === "expand" || decisionMode === "expand_recovery")
      && candidatePageNextOffset !== null
      && candidatePageAction
      ? {
        targetTeam: state.targetTeam,
        nextOffset: candidatePageNextOffset,
        position: state.confirmedPositions.length > 1 ? null : state.confirmedPosition ?? candidatePageAction.position,
        ...(state.confirmedPositions.length > 1 ? { positions: state.confirmedPositions } : {}),
        playerName: candidatePageAction.playerName,
        maxAge: candidatePageAction.maxAge,
        minimumMinutes: candidatePageAction.minimumMinutes,
        competition: candidatePageAction.competition,
        season: candidatePageAction.season,
      }
      : undefined;
    if (decisionMode === "conclude") {
      emitProgress(config, {
        stage: "synthesizing",
        message: "正在汇总候选证据并整理结论",
        completedSteps: state.decisionSteps,
      });
    }
    const decisionStartedAt = performance.now();
    let action: ParsedRecruitmentAction;
    let proposedAction: ParsedRecruitmentAction;
    let policyOverrodePlanner = false;
    let expansionPlannerTimeoutMs: number | undefined;
    let plannerFallback: "expansion_timeout" | "expansion_output_limit" | "conclusion_timeout" | "conclusion_output_limit" | undefined;
    let plannerTimeoutMs: number | undefined;
    let candidateSearchCursorAdjustment: { requestedOffset: number; effectiveOffset: number } | null = null;
    let candidateSearchExhausted = false;
    const plannerHistory = (decisionMode === "expand" || decisionMode === "expand_recovery"
      ? compactExpansionHistory(state.history, { includeLatestPolicyFeedback: decisionMode === "expand_recovery" })
      : decisionMode === "conclude" || decisionMode === "reorient"
        ? compactConclusionHistory(state.history, decisionConstraints?.requestedCapabilityCoverage, {
          preserveAllMethodology: decisionMode === "reorient",
        })
        : state.history).map((entry) => ({ ...entry }));
    try {
      let modelAction: RecruitmentAction;
      try {
        modelAction = await planner.decide({
          brief: state.brief,
          history: plannerHistory,
          dataMode: repository.mode,
          dataSource: repository.sourceName,
          abilityProfilesEnabled: state.abilityProfilesEnabled,
          targetTeam: state.targetTeam,
          decisionMode,
          confirmedPosition: state.confirmedPosition,
          confirmedPositions: state.confirmedPositions,
          positionBroadeningApproved: state.positionBroadeningApproved,
          ...(config.signal ? { signal: config.signal } : {}),
          ...(decisionConstraints ? { constraints: decisionConstraints } : {}),
          ...(expansionConstraints ? { expansionConstraints } : {}),
          ...(observer ? { onTokenUsage: (usage: RecruitmentPlannerUsageObservation) => observer({ phase: "model_usage", ...usage }) } : {}),
        });
      } catch (error) {
        if (error instanceof RecruitmentModelTimeoutError
          && (decisionMode === "expand" || decisionMode === "expand_recovery")
          && decisionConstraints
          && expansionConstraints) {
          expansionPlannerTimeoutMs = error.timeoutMs;
          plannerFallback = "expansion_timeout";
          modelAction = expansionPlannerFallback({ decisionConstraints, expansionConstraints });
          emitProgress(config, {
            stage: "planning",
            status: "notice",
            message: modelAction.action === "search_candidates"
              ? "扩页模型规划超时，系统按能力证据缺口继续读取精确下一页"
              : "扩页模型规划超时，当前可测能力已有依据，系统开始整理报告",
            completedSteps: state.decisionSteps,
          });
        } else if (error instanceof RecruitmentPlannerOutputError
          && (decisionMode === "expand" || decisionMode === "expand_recovery")
          && error.diagnostics.finishReason === "length"
          && decisionConstraints
          && expansionConstraints) {
          plannerFallback = "expansion_output_limit";
          modelAction = expansionPlannerFallback({ decisionConstraints, expansionConstraints });
          emitProgress(config, {
            stage: "planning",
            status: "notice",
            message: modelAction.action === "search_candidates"
              ? "扩页模型达到输出上限，系统按能力证据缺口继续读取精确下一页"
              : "扩页模型达到输出上限，系统按当前证据整理报告",
            completedSteps: state.decisionSteps,
          });
        } else if (error instanceof RecruitmentModelTimeoutError
          && (decisionMode === "conclude" || decisionMode === "reorient")
          && decisionConstraints) {
          plannerTimeoutMs = error.timeoutMs;
          plannerFallback = "conclusion_timeout";
          modelAction = conclusionPlannerOutputFallback(decisionConstraints, { reason: "timeout" });
          emitProgress(config, {
            stage: "planning",
            status: "notice",
            message: "报告规划超时，系统按已复核的比赛证据整理有限结论",
            completedSteps: state.decisionSteps,
          });
        } else if (error instanceof RecruitmentPlannerOutputError
          && (decisionMode === "conclude" || decisionMode === "reorient")
          && error.diagnostics.finishReason === "length"
          && decisionConstraints) {
          plannerFallback = "conclusion_output_limit";
          modelAction = conclusionPlannerOutputFallback(decisionConstraints);
          emitProgress(config, {
            stage: "planning",
            status: "notice",
            message: "报告模型达到输出上限，系统按已复核的比赛证据整理结论",
            completedSteps: state.decisionSteps,
          });
        } else {
          throw error;
        }
      }
      proposedAction = RecruitmentActionSchema.parse(modelAction);
      const enforced = enforceInvestigationAction(proposedAction, state, { candidatePolicyMode, enforceCurrentTurnObservation, decisionMode, expansionConstraints, retrievalNeeds, understatResearchMode: input.understatResearchMode });
      ({ action, candidateSearchCursorAdjustment, candidateSearchExhausted } = enforced);
      policyOverrodePlanner = enforced.policyOverrodePlanner || Boolean(plannerFallback);
    } catch (error) {
      observer?.({
        phase: "decision",
        action: null,
        decisionSource: "planner",
        proposedAction: null,
        decisionMode,
        elapsedMs: Math.round(performance.now() - decisionStartedAt),
        ok: false,
      });
      throw error;
    }
    const { endedTooEarly, policyFeedback } = investigationActionFeedback(state, proposedAction, action, decisionMode, candidateSearchExhausted, retrievalNeeds);
    let policyReasonCodes = policyFeedback.map(policyBlockReasonCode);
    if (decisionMode === "expand"
      && state.positionBroadeningApproved
      && expansionConstraints
      && action.action === "ask_user"
      && policyFeedback.length > 0) {
      policyReasonCodes = policyFeedback.map(policyBlockReasonCode);
      action = RecruitmentActionSchema.parse({
        action: "search_candidates",
        targetTeam: expansionConstraints.targetTeam,
        position: expansionConstraints.position,
        ...(expansionConstraints.positions ? { positions: expansionConstraints.positions } : {}),
        playerName: expansionConstraints.playerName,
        maxAge: expansionConstraints.maxAge,
        minimumMinutes: expansionConstraints.minimumMinutes,
        competition: expansionConstraints.competition,
        season: expansionConstraints.season,
        offset: expansionConstraints.nextOffset,
        limit: 20,
      });
      policyOverrodePlanner = true;
      policyFeedback.length = 0;
    }
    const blockedByPolicy = policyFeedback.length > 0;
    const askPolicyOutcome = action.action === "ask_user" && !endedTooEarly && !blockedByPolicy
      ? askUserMode === "disabled" ? "suppressed" as const : "allowed" as const
      : undefined;
    const stateAction = askPolicyOutcome === "suppressed" && action.action === "ask_user"
      ? actionForAskPolicy(action, "disabled")
      : action;
    const previousFeedback = state.history.at(-1);
    const sameBlockedAction = blockedByPolicy && state.policyBlocked
      && JSON.stringify(state.action) === JSON.stringify(action)
      && previousFeedback?.role === "tool" && previousFeedback.toolName === "investigation_policy"
      && previousFeedback.content === policyFeedback.join(" ");
    const policyBlockedRepeatCount = blockedByPolicy
      ? sameBlockedAction ? state.policyBlockedRepeatCount + 1 : 1
      : 0;
    const stopRepeatedPolicyAction = sameBlockedAction && state.policyBlockedRepeatCount >= 1;
    observer?.({
      phase: "decision",
      action: action.action,
      decisionSource: policyOverrodePlanner ? "policy" : "planner",
      ...(!plannerFallback ? { proposedAction: proposedAction.action } : {}),
      ...(plannerFallback ? { plannerFallback } : {}),
      decisionMode,
      elapsedMs: Math.round(performance.now() - decisionStartedAt),
      ok: true,
      policyBlocked: blockedByPolicy,
      ...(askPolicyOutcome ? { askPolicyOutcome } : {}),
      ...(policyReasonCodes.length ? { policyReasonCodes } : {}),
      targetTeam: action.action === "inspect_team" ? action.teamName : action.targetTeam ?? state.targetTeam,
    });
    completePlanning(stopRepeatedPolicyAction
      ? "已停止重复的受约束动作，正在审核当前证据"
      : plannerFallback === "expansion_timeout" || plannerFallback === "expansion_output_limit"
        ? action.action === "search_candidates"
          ? "扩页规划未能生成动作，按证据覆盖和原有筛选条件继续调查"
          : "扩页规划未能生成动作，按当前证据覆盖完成调查"
        : plannerFallback === "conclusion_timeout"
          ? "报告规划超时，正在按已复核证据整理有限结论"
          : plannerFallback === "conclusion_output_limit"
            ? "报告模型达到输出上限，正在按已复核证据整理结论"
          : "已完成本步调查决策，正在按用户条件和工具预算继续");
    if (stopRepeatedPolicyAction) {
      const fallback = emptyDecision(state.targetTeam);
      observer?.({
        phase: "decision",
        action: fallback.action,
        decisionSource: "policy",
        elapsedMs: 0,
        ok: true,
        policyBlocked: false,
        targetTeam: fallback.targetTeam,
      });
      return {
        action: fallback,
        decisionSteps: state.decisionSteps + 1,
        policyBlocked: false,
        policyBlockedRepeatCount: 0,
        policyLoopStopped: true,
        history: [
          { role: "assistant" as const, content: JSON.stringify(fallback) },
          { role: "tool" as const, toolName: "investigation_guard", content: "Agent 连续两次重复提出被调查策略拒绝的相同动作；已停止继续调用模型并只报告当前可验证证据。" },
        ],
      };
    }
    return {
      action: stateAction,
      decisionSteps: state.decisionSteps + 1,
      policyBlocked: blockedByPolicy,
      policyBlockedRepeatCount,
      candidateSearchCursorAdjustment,
      ...(action.targetTeam ? { targetTeam: action.targetTeam } : {}),
      ...(action.action === "ask_user" && !endedTooEarly && !blockedByPolicy ? {
        pendingQuestion: questionForAskPolicy(action, askUserMode),
        responseMessage: askUserMode === "disabled" ? askPolicyDisabledPause.question : action.question,
      } : {}),
      history: [
        {
          role: "assistant" as const, content: askPolicyOutcome === "suppressed"
            ? JSON.stringify({ action: "ask_user", suppressed: true })
            : JSON.stringify(action)
        },
        ...(askPolicyOutcome === "suppressed" ? [{
          role: "tool" as const,
          toolName: "ask_policy",
          content: "评测控制组关闭了追问能力；关键需求未解决，因此暂停并且不生成候选名单。",
        }] : []),
        ...(plannerFallback === "expansion_timeout" ? [{
          role: "tool" as const,
          toolName: "investigation_policy",
          content: action.action === "search_candidates"
            ? `扩页 Planner 在 ${Math.round((expansionPlannerTimeoutMs ?? 0) / 1000)} 秒内未返回；依据 requestedCapabilityCoverage 存在可测缺口，LangGraph 按 nextOffset=${expansionConstraints?.nextOffset ?? 0} 和原筛选条件继续一页。`
            : `扩页 Planner 在 ${Math.round((expansionPlannerTimeoutMs ?? 0) / 1000)} 秒内未返回；没有可通过分页补足的能力指标，LangGraph 以当前已验证证据收束。`,
        }] : []),
        ...(plannerFallback === "expansion_output_limit" ? [{
          role: "tool" as const,
          toolName: "investigation_policy",
          content: action.action === "search_candidates"
            ? `扩页 Planner 达到输出长度上限；依据 requestedCapabilityCoverage 存在可测缺口，LangGraph 按 nextOffset=${expansionConstraints?.nextOffset ?? 0} 和原筛选条件继续一页。`
            : "扩页 Planner 达到输出长度上限；没有可通过分页补足的能力指标，LangGraph 以当前已验证证据收束。",
        }] : []),
        ...(plannerFallback === "conclusion_output_limit" ? [{
          role: "tool" as const,
          toolName: "investigation_policy",
          content: "结论 Planner 达到输出长度上限；LangGraph 只保留已评估候选中直接对应用户可测能力的证据，报告模型未能完成的定性描述不予补写。",
        }] : []),
        ...(plannerFallback === "conclusion_timeout" ? [{
          role: "tool" as const,
          toolName: "investigation_policy",
          content: `结论 Planner 在 ${Math.round((plannerTimeoutMs ?? 0) / 1000)} 秒内未返回；LangGraph 只保留已评估候选中直接对应用户可测能力的证据，以当前已复核结果安全收束。`,
        }] : []),
        ...(blockedByPolicy ? [{ role: "tool" as const, toolName: "investigation_policy", content: policyFeedback.join(" ") }] : []),
      ],
    };
  };
}
