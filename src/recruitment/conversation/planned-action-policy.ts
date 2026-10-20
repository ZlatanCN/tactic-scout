import { positionSearchForIntent } from "../candidate-search-intent.js";
import { playerPositionMatches } from "../../domain/positions.js";
import { isUnderstatFinePositionSearch } from "../../sources/understat/position-evidence.js";
import { buildDecisionConstraints, conclusionPlannerOutputFallback, type RecruitmentExpansionConstraints } from "../conclusion-policy.js";
import { emptyDecision, isToolAction, RecruitmentActionSchema, toolBudgets, type ParsedRecruitmentAction } from "../recruitment-actions.js";
import { applyRecruitmentCandidatePolicy } from "../recruitment-candidate-policy.js";
import type { RecruitmentPlanner } from "../recruitment-planner.js";
import { candidateSearchObservationIndexForIntent, positionEvaluationIsCurrent, discoveredPlayersForConstraint, routeCandidateSearch, userMessages } from "./candidate-context.js";
import type { RecruitmentCandidatePolicyMode, UnderstatResearchMode } from "./contracts.js";
import { asksToRepeatPositionBroadeningQuestion, claimsUnavailablePlayerReports, positionLabels, redundantReplacementRoleQuestion, replacementPositionClarification, unsupportedCurrentAffiliationFeedback } from "./interaction-policy.js";
import { investigationCandidates } from "./required-investigation.js";
import type { State } from "./state.js";

type PlanningMode = Parameters<RecruitmentPlanner["decide"]>[0]["decisionSnapshot"]["caps"]["stage"];

function sectionsForUnderstatInspectionApproval(question: string, reason: string): Array<"positions" | "history" | "recent" | "shotProfile"> {
  const text = `${question} ${reason}`.toLocaleLowerCase();
  const sections: Array<"positions" | "history" | "recent" | "shotProfile"> = [];
  if (/position|位置|角色/.test(text)) sections.push("positions");
  if (/history|历史|赛季|长期/.test(text)) sections.push("history");
  if (/recent|近期|近况|最近/.test(text)) sections.push("recent");
  if (/shot|射门|xg|xa|关键传球|key.?pass|机会质量|进球/.test(text)) sections.push("shotProfile");
  return sections;
}

export function enforceInvestigationAction(proposedAction: ParsedRecruitmentAction, state: State, settings: {
  candidatePolicyMode: RecruitmentCandidatePolicyMode;
  enforceCurrentTurnObservation: boolean;
  decisionMode: PlanningMode;
  expansionConstraints?: RecruitmentExpansionConstraints;
  retrievalNeeds?: { methodology: boolean; playerReports: boolean };
  understatResearchMode?: UnderstatResearchMode;
}) {
  const { candidatePolicyMode, enforceCurrentTurnObservation, decisionMode, expansionConstraints } = settings;
  const { intent, unsearchedReportCandidates, eligibleEvaluatedPlayers } = investigationCandidates(state);
  let action: ParsedRecruitmentAction;
  let policyOverrodePlanner = false;
  let candidateSearchCursorAdjustment: State["candidateSearchCursorAdjustment"] = null;
  let candidateSearchExhausted = false;
  action = candidatePolicyMode === "enabled" && proposedAction.action !== "inspect_candidate_group"
    ? applyRecruitmentCandidatePolicy(proposedAction, state)
    : proposedAction;
  const internalResearchApproval = settings.understatResearchMode !== undefined && action.action === "ask_user"
    && /inspect_candidate_group|inspect_player|inspect_match|(?:是否|要不要).{0,20}(?:读取|查看|检查|调查).{0,20}(?:候选|球员|比赛)/i.test(`${action.question} ${action.reason}`)
    ? { question: action.question, reason: action.reason }
    : null;
  if (internalResearchApproval) {
    if (settings.understatResearchMode === "adaptive"
      && state.toolUses.inspect_candidate_group < toolBudgets.inspect_candidate_group) {
      const requestedSections = sectionsForUnderstatInspectionApproval(internalResearchApproval.question, internalResearchApproval.reason);
      const uninspectedCandidates = discoveredPlayersForConstraint(state)
        .filter(({ playerId }) => !state.understatPlayerResearch[playerId])
        .slice(0, 12);
      if (uninspectedCandidates.length >= 2 && requestedSections.length > 0) {
        action = RecruitmentActionSchema.parse({
          action: "inspect_candidate_group",
          targetTeam: state.targetTeam,
          playerIds: uninspectedCandidates.map(({ playerId }) => playerId),
          sections: requestedSections,
        });
        policyOverrodePlanner = true;
      }
    }
    if (action.action === "ask_user") {
      const { pendingCandidateIds } = investigationCandidates(state);
      action = pendingCandidateIds.length > 0
        ? RecruitmentActionSchema.parse({ action: "evaluate_candidates", targetTeam: state.targetTeam, playerIds: pendingCandidateIds })
        : conclusionPlannerOutputFallback(buildDecisionConstraints({
          targetTeam: state.targetTeam,
          brief: state.brief,
          confirmedPosition: state.confirmedPosition,
          confirmedPositions: state.confirmedPositions,
          userMessages: userMessages(state.history),
          evaluatedPlayers: Object.values(eligibleEvaluatedPlayers),
          retrievedKnowledge: Object.values(state.retrievedKnowledge),
        }));
      policyOverrodePlanner = true;
    }
  }
  if (settings.understatResearchMode === "adaptive"
    && (action.action === "ask_user" || action.action === "finish")) {
    const { pendingCandidateIds } = investigationCandidates(state);
    if (pendingCandidateIds.length > 0) {
      action = RecruitmentActionSchema.parse({
        action: "evaluate_candidates",
        targetTeam: state.targetTeam,
        playerIds: pendingCandidateIds,
      });
      policyOverrodePlanner = true;
    }
  }
  if (action.action === "search_candidates" && (intent.positions?.length ?? 0) > 1) {
    action = RecruitmentActionSchema.parse({ ...action, ...positionSearchForIntent(intent),
      maxAge: intent.maxAge, minimumMinutes: intent.minimumMinutes, competition: intent.competition, season: intent.season });
  }
  if (action.action === "search_candidates"
    && intent.replacementRequest
    && intent.position === null
    && action.position === null
    && !intent.allowsAnyPosition) {
    action = replacementPositionClarification(state.targetTeam);
    policyOverrodePlanner = true;
  }
  if (decisionMode === "expand"
    && state.positionBroadeningApproved
    && expansionConstraints
    && asksToRepeatPositionBroadeningQuestion(action)) {
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
  }
  const intentSearchObservationIndex = candidateSearchObservationIndexForIntent(
    intent,
    state.candidateSearchObservations,
    state.candidateSearchScopeChanged ? state.candidateSearchTurnStartIndex : 0,
  );
  const intentSearchIsMissing = enforceCurrentTurnObservation
    && intentSearchObservationIndex === null
    && (state.candidateSearchScopeChanged
      || state.confirmedPosition !== null
      || (intent.replacementRequest && state.replacementReferencePosition !== null)
      || state.candidateSearchObservations.length > 0);
  if (intentSearchIsMissing) {
    if ((settings.retrievalNeeds?.methodology ?? true) && !state.hasSearchedMethodology && action.action !== "search_methodology") {
      action = RecruitmentActionSchema.parse({
        action: "search_methodology",
        targetTeam: state.targetTeam,
        query: intent.position
          ? `${positionLabels[intent.position]}位置的能力画像与可观察比赛表现评估方法`
          : "当前引援需求对应的能力画像与可观察比赛表现评估方法",
        limit: 4,
      });
      policyOverrodePlanner = true;
    } else if ((state.hasSearchedMethodology || settings.retrievalNeeds?.methodology === false)
      && action.action !== "search_methodology"
      && (action.action !== "search_candidates"
        || (!(intent.positions && intent.positions.length > 1) && intent.position !== null && action.position !== intent.position))) {
      action = RecruitmentActionSchema.parse({
        action: "search_candidates",
        targetTeam: state.targetTeam,
        ...positionSearchForIntent(intent),
        maxAge: intent.maxAge,
        minimumMinutes: intent.minimumMinutes,
        competition: intent.competition,
        season: intent.season,
        limit: 20,
      });
      policyOverrodePlanner = true;
    }
  }
  if (action.action === "search_candidates") {
    const cursor = routeCandidateSearch(action, state, enforceCurrentTurnObservation);
    action = cursor.action;
    candidateSearchCursorAdjustment = cursor.requestedOffset === cursor.effectiveOffset
      ? null
      : { requestedOffset: cursor.requestedOffset, effectiveOffset: cursor.effectiveOffset };
    candidateSearchExhausted = cursor.exhausted;
  }
  if (action.action === "inspect_candidate_group") {
    const eligibleIds = discoveredPlayersForConstraint(state).map((player) => player.playerId);
    const pendingPositionIds = action.sections.includes("positions")
      && intent.position && isUnderstatFinePositionSearch(intent.position)
      ? Object.values(state.discoveredPlayers)
        .filter((player) => player.sourceIdentity?.provider === "understat"
          && player.positionEvidence?.targetPosition === intent.position
          && player.positionEvidence.status === "pending")
        .map((player) => player.playerId)
      : [];
    const availableIds = new Set([...eligibleIds, ...pendingPositionIds]);
    const playerIds = [...new Set(action.playerIds)].filter((playerId) => availableIds.has(playerId)).slice(0, 12);
    action = playerIds.length >= 2
      ? RecruitmentActionSchema.parse({ ...action, playerIds })
      : playerIds.length === 1 && pendingPositionIds.includes(playerIds[0]!)
        ? RecruitmentActionSchema.parse({ action: "inspect_player", targetTeam: state.targetTeam, playerId: playerIds[0]!, sections: action.sections })
      : RecruitmentActionSchema.parse({
        action: "evaluate_candidates",
        targetTeam: state.targetTeam,
        playerIds: investigationCandidates(state).pendingCandidateIds,
      });
    policyOverrodePlanner = true;
  }
  if (settings.understatResearchMode && action.action === "search_candidates") {
    if (state.candidateSearchObservations.length === 0) {
      action = RecruitmentActionSchema.parse({ ...action, offset: 0, limit: Math.min(action.limit, 12) });
      policyOverrodePlanner = true;
    } else {
      const pendingPlayerIds = investigationCandidates(state).pendingCandidateIds;
      action = pendingPlayerIds.length
        ? RecruitmentActionSchema.parse({ action: "evaluate_candidates", targetTeam: state.targetTeam, playerIds: pendingPlayerIds })
        : {
          ...emptyDecision(state.targetTeam),
          needSummary: "本次 Understat 消融固定使用同一批首轮候选；当前证据已整理完毕，不再扩展候选页。",
        };
      policyOverrodePlanner = true;
    }
  }
  if (action.action === "evaluate_candidates"
    && action.playerIds.length > 0
    && action.playerIds.every((playerId) => Boolean(state.discoveredPlayers[playerId] && positionEvaluationIsCurrent(state.discoveredPlayers[playerId]!, state.evaluatedPlayers[playerId])))
    && (settings.retrievalNeeds?.playerReports ?? true) && unsearchedReportCandidates.length > 0) {
    action = RecruitmentActionSchema.parse({
      action: "search_player_reports",
      targetTeam: state.targetTeam,
      query: "已评估候选球员的球探报告、比赛观察及可引用的定性证据",
      playerNames: Object.values(eligibleEvaluatedPlayers).map(({ player }) => player.name).slice(0, 10),
      limit: 4,
    });
    policyOverrodePlanner = true;
  }
  const suppressUnderstatDetail = (settings.understatResearchMode === "catalog_only"
    && ["inspect_candidate_group", "inspect_player", "inspect_match"].includes(action.action))
    || (settings.understatResearchMode === "fixed_profile"
      && (action.action === "inspect_player"
        || (action.action === "inspect_candidate_group" && state.toolUses.inspect_candidate_group >= toolBudgets.inspect_candidate_group)))
    || (settings.understatResearchMode !== undefined && action.action === "inspect_match");
  if (suppressUnderstatDetail) {
    const pendingPlayerIds = investigationCandidates(state).pendingCandidateIds;
    action = pendingPlayerIds.length
      ? RecruitmentActionSchema.parse({ action: "evaluate_candidates", targetTeam: state.targetTeam, playerIds: pendingPlayerIds })
      : RecruitmentActionSchema.parse({
        ...emptyDecision(state.targetTeam),
        needSummary: settings.understatResearchMode === "catalog_only"
          ? "目录对照组不读取球员详情；依据已完成的统计评估整理结论。"
          : "固定资料组已完成预注册资料包比较；不继续进行球员或比赛细查。",
      });
    policyOverrodePlanner = true;
  }
  return { action, policyOverrodePlanner, candidateSearchCursorAdjustment, candidateSearchExhausted };
}

export function investigationActionFeedback(state: State, proposedAction: ParsedRecruitmentAction, action: ParsedRecruitmentAction, decisionMode: PlanningMode, candidateSearchExhausted: boolean, retrievalNeeds = { methodology: true, playerReports: true }) {
  const { intent, eligibleEvaluatedPlayers, unsearchedReportCandidates } = investigationCandidates(state);
  const hasInspectedReplacementReference = intent.replacementRequest
    && state.history.some(({ role, toolName }) => role === "tool" && toolName === "inspect_team");
  const endedTooEarly = (action.action === "ask_user" || action.action === "finish")
    && !state.hasInvestigated
    && !(action.action === "ask_user" && hasInspectedReplacementReference);
  const affiliationFeedback = unsupportedCurrentAffiliationFeedback(action, state.history);
  const replacementRoleFeedback = redundantReplacementRoleQuestion(action, intent.replacementRequest, state.replacementReferencePosition);
  const policyFeedback = [
    ...(action.action === "ask_user" && action.positionSelection && state.confirmedPositions.length ? ["用户已经在球场上确认位置，继续调查所选位置；不要重复询问位置。"] : []),
    ...(isToolAction(action) && state.toolUses[action.action] >= toolBudgets[action.action]
      ? [action.action === "search_candidates" && Object.keys(state.discoveredPlayers).length > 0
        ? `候选发现已达到本轮上限 ${toolBudgets.search_candidates} 次；已经找到 ${Object.keys(state.discoveredPlayers).length} 名候选。现在必须调用 evaluate_candidates，从已发现的候选 ID 中选择要分析的人；评估完成后检索报告并给出有证据的结论。不要继续搜索候选，也不要在未评估任何人的情况下 finish。`
        : `${action.action} 已达到本轮独立调用上限 ${toolBudgets[action.action]} 次，请改用其他调查动作或完成当前结论。`] : []),
    ...(action.action === "search_candidates" && candidateSearchExhausted
      ? [Object.keys(state.discoveredPlayers).length > 0
        ? "当前这组候选筛选已到最后一页。请从已发现的候选中调用 evaluate_candidates；不要重复搜索此范围，也不要未评估就 finish。"
        : "当前这组候选筛选已到最后一页且没有候选结果。请改用用户允许的其他调查范围，或说明数据覆盖不足；不要重复搜索此范围。"] : []),
    ...(action.action === "evaluate_candidates" && action.playerIds.length > 0
      && action.playerIds.every((playerId) => Boolean(state.discoveredPlayers[playerId] && positionEvaluationIsCurrent(state.discoveredPlayers[playerId]!, state.evaluatedPlayers[playerId])))
      ? [`这些候选人已经完成比赛表现评估；evaluate_candidates 不会重复计算。请调用 search_player_reports 检索定性补充，再完成结论。`] : []),
    ...(action.action === "search_candidates" && retrievalNeeds.methodology && !state.hasSearchedMethodology
      ? ["先调用 search_methodology 检索角色或战术方法资料，再执行结构化候选筛选。"] : []),
    ...(action.action === "search_player_reports" && !Object.keys(eligibleEvaluatedPlayers).length
      ? ["先完成结构化筛选并至少评估一名候选人，再检索球员报告。"] : []),
    ...(action.action === "search_player_reports" && state.hasSearchedPlayerReports && unsearchedReportCandidates.length === 0
      ? ["当前所有已评估候选人都已完成球员报告检索；不要重复调用相同范围，请继续完成报告。"] : []),
    ...(action.action === "finish" && retrievalNeeds.playerReports && Object.keys(eligibleEvaluatedPlayers).length > 0
      && !state.hasSearchedPlayerReports
      && state.toolUses.search_player_reports < toolBudgets.search_player_reports
      ? ["已有比赛数据评估结果；先调用 search_player_reports 检索定性补充，再完成报告。"] : []),
    ...(action.action === "finish" && intent.replacementRequest && state.candidateSearchObservations.length === 0
      && !state.candidateSearchFailure
      ? ["替代者任务尚未成功搜索候选球员；读取目标球队名单不等于候选调查。请先搜索候选，或提出会改变搜索方向的问题，不要直接完成空报告。"] : []),
    ...(endedTooEarly
      ? [action.action === "ask_user" ? "先调查至少一项可用球队或球员数据，再判断是否需要用户补充。" : "先调用数据工具调查现有证据，再提交最终报告。"] : []),
    ...(affiliationFeedback ? [affiliationFeedback] : []),
    ...(replacementRoleFeedback ? [replacementRoleFeedback] : []),
    ...(decisionMode === "expand" && state.positionBroadeningApproved
      && asksToRepeatPositionBroadeningQuestion(action)
      ? ["用户已经同意扩大位置范围；不得重复征求扩围许可。请继续读取当前范围的下一页，或依据现有证据完成报告。"]
      : []),
    ...(state.hasSearchedPlayerReports
      && !Object.values(state.retrievedKnowledge).some((document) => document.corpus === "player_report")
      && claimsUnavailablePlayerReports(action)
      ? ["球员报告检索结果为零；不得声称报告中存在发现、样本或球员资料。请继续使用已验证的比赛数据，或在结论中明确报告资料缺失。"]
      : []),
    ...(action.action === "evaluate_candidates" && state.confirmedPosition
      && !action.playerIds.some((playerId) => {
        const player = state.discoveredPlayers[playerId];
        return Boolean(player && (state.confirmedPositions.length ? state.confirmedPositions : [state.confirmedPosition!]).some((position) => playerPositionMatches(player, position)));
      })
      ? [`用户已确认位置为 ${positionLabels[state.confirmedPosition]}；先按该位置搜索候选人，不能评估其他位置的球员。`] : []),
    ...(proposedAction.action === "finish" && proposedAction.recommendations.length > 0
      && action.action === "finish" && action.recommendations.length === 0 && state.confirmedPosition
      ? [`用户已确认位置为 ${positionLabels[state.confirmedPosition]}，刚才提交的推荐未通过当前需求与证据约束（替代任务须排除参考球员本人）。请继续搜索和评估其他候选人；若确实没有样本，再用空名单并说明数据限制。`] : []),
  ];
  return { endedTooEarly, policyFeedback };
}
