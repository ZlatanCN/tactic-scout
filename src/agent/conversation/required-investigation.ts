import type { PlayerRepository } from "../../data/player-repository.js";
import type { Position } from "../../domain/schemas.js";
import { normalizeSearchText } from "../../domain/text-matching.js";
import { requestedCapabilityEvidenceAreas, summarizeRequestedCapabilityCoverage } from "../conclusion-policy.js";
import type { ConversationHistoryEntry } from "../planner-context.js";
import { emptyDecision, FinishActionSchema, RecruitmentActionSchema, toolBudgets, type ParsedRecruitmentAction } from "../recruitment-actions.js";
import { constrainedPositionSearchObservation, discoveredPlayersForConstraint, evaluatedPlayersForConstraint, resolvedCandidateSearchIntent, sampleUnevaluatedCandidates, userMessages } from "./candidate-context.js";
import { broadRoleQuestion, emptyPositionQuestion, positionLabels, replacementPositionClarification } from "./interaction-policy.js";
import { maxDecisionsPerTurn, type State } from "./state.js";
import { replacementTargetMention } from "../replacement-target.js";
import type { UnderstatResearchMode } from "./contracts.js";

interface InvestigationDirective {
  action: ParsedRecruitmentAction;
  message: string;
  suppressedMessage?: string;
  update?: Partial<State>;
  history?: ConversationHistoryEntry[];
}

export function investigationCandidates(state: State) {
  const intent = resolvedCandidateSearchIntent(state);
  const eligibleEvaluatedPlayers = evaluatedPlayersForConstraint(state, intent);
  const unsearchedReportCandidates = Object.values(eligibleEvaluatedPlayers)
    .map(({ player }) => player.name)
    .filter((name) => !state.searchedReportPlayerNames.some((searchedName) => normalizeSearchText(searchedName) === normalizeSearchText(name)));
  return {
    intent,
    eligibleEvaluatedPlayers,
    unsearchedReportCandidates,
    pendingCandidateIds: sampleUnevaluatedCandidates(state),
    confirmedPositionSearchPending: Boolean(intent.position && !constrainedPositionSearchObservation(state)),
  };
}

function reportLookup(state: State, playerNames: string[]) {
  const messages = userMessages(state.history);
  const candidates = Object.values(evaluatedPlayersForConstraint(state));
  const coverage = summarizeRequestedCapabilityCoverage({
    userMessages: messages,
    evaluatedPlayers: candidates,
    candidateIdentityGroups: state.candidateIdentityGroups,
  });
  const gaps = coverage
    .filter((area) => area.status !== "observed")
    .map(({ name }) => name);
  return RecruitmentActionSchema.parse({
    action: "search_player_reports",
    targetTeam: state.targetTeam,
    query: [
      "已评估候选球员的球探报告、比赛观察及可引用的定性证据",
      gaps.length ? `优先补查当前指标未覆盖的能力：${gaps.join("、")}` : "补充已请求能力的可追溯定性观察",
    ].join("；"),
    playerNames: playerNames.slice(0, 10),
    limit: 4,
  });
}

function policyHistory(action: ParsedRecruitmentAction, content: string): ConversationHistoryEntry[] {
  return [{ role: "assistant", content: JSON.stringify(action) }, { role: "tool", toolName: "investigation_policy", content }];
}

// Deterministic prerequisites run before asking the Planner. This module has no model,
// observer or graph side effects; the node commits the selected directive once.
export function nextRequiredInvestigation(
  state: State,
  source: Pick<PlayerRepository, "mode" | "sourceName">,
  options: { deterministicSearchEnabled?: boolean; retrievalNeeds?: { methodology: boolean; playerReports: boolean }; understatResearchMode?: UnderstatResearchMode } = {},
): InvestigationDirective | null {
  const needsReports = options.retrievalNeeds?.playerReports ?? true;
  const needsMethodology = options.retrievalNeeds?.methodology ?? true;
  const { intent, eligibleEvaluatedPlayers, unsearchedReportCandidates, pendingCandidateIds, confirmedPositionSearchPending } = investigationCandidates(state);
  const understatResearchCandidates = source.mode === "understat"
    ? discoveredPlayersForConstraint(state)
      .filter((player) => !state.understatPlayerResearch[player.playerId])
    : [];
  const terminal = (needSummary: string, responseMessage: string, message: string): InvestigationDirective => ({
    action: { ...emptyDecision(state.targetTeam), needSummary },
    message,
    update: { responseMessage, pendingQuestion: null },
  });
  if (state.sourceAccessFailure) return terminal(
    `${source.sourceName} 当前数据请求被拒绝，本轮无法生成候选名单。`,
    `${source.sourceName} 的数据请求被拒绝（${state.sourceAccessFailure.code === "blocked" ? "HTTP 403" : "HTTP 429"}）。本轮无法读取球员数据；这不代表没有符合条件的球员。`,
    "已确认当前数据源无法访问，正在整理调查结果",
  );
  if (state.candidateSearchFailure && !state.candidateSearchSucceededThisTurn) {
    if (source.mode === "understat" && state.candidateSearchFailure.code === "unsupported_scope" && intent.maxAge !== null) {
      const reason = "Understat 未提供出生日期或年龄，无法核验年龄上限；这不代表没有符合年龄条件的球员。";
      if (state.history.some(({ role, content }) => role === "assistant" && content.includes(reason))) return terminal(
        `已保留 ${intent.maxAge} 岁以下条件，但当前数据无法核验年龄，未生成候选名单。`,
        "已保留你的年龄要求。当前数据无法验证这个条件，本轮先结束；你可以取消年龄限制后继续。",
        "年龄条件仍需保留，正在说明当前数据限制",
      );
      return {
        action: { action: "ask_user", targetTeam: state.targetTeam, question: `当前数据无法确认球员是否 ${intent.maxAge} 岁以下。你愿意取消年龄限制，先按比赛表现寻找中意的球员，还是保留年龄要求并结束本轮？`, reason },
        message: "当前数据无法核验年龄，需要你确认是否取消年龄条件",
        suppressedMessage: "对照组已关闭追问，年龄条件无法核验，已安全暂停",
      };
    }
    if (source.mode === "asa" && ["network", "timeout"].includes(state.candidateSearchFailure.code ?? "")) return terminal(
      `${source.sourceName} 在完成一次有界传输重试后仍无法读取；当前不能确认候选匹配结果。`,
      `${source.sourceName} 暂时无法连接，已停止本轮候选调查；这不代表没有匹配球员。请稍后重新分析。`,
      "ASA 数据请求重试后仍失败，正在如实说明来源状态",
    );
    if (source.mode === "fpl" || source.mode === "premier_league"
      || ((source.mode === "understat" || source.mode === "mosaic") && state.candidateSearchFailure.code !== "unsupported_scope")) return terminal(
        `${source.sourceName} 候选查询未成功，当前无法确认匹配结果。`,
        `${source.sourceName} 候选查询失败，当前无法确认是否有符合条件的球员；这不代表没有匹配球员。请稍后重新分析。`,
        "候选来源查询未成功，正在明确说明匹配情况未知",
      );
  }
  if (intent.replacementRequest && state.targetTeam
    && state.toolUses.inspect_team < toolBudgets.inspect_team
    && state.inspectedReferenceMention !== normalizeSearchText(replacementTargetMention(userMessages(state.history)) ?? "")) {
    const action = RecruitmentActionSchema.parse({ action: "inspect_team", targetTeam: state.targetTeam, teamName: state.targetTeam });
    return { action, message: "正在读取目标球队和参考球员的已有表现，建立替代需求背景", history: policyHistory(action, "替代者任务先读取参考背景；缺失数据不得由模型臆造。") };
  }
  const replacementDiscoveryRecoveryActive = state.policyBlocked && state.policyBlockedRepeatCount >= 2;
  if (replacementDiscoveryRecoveryActive && intent.replacementRequest && state.targetTeam
    && intent.position === null && state.confirmedPosition === null
    && state.candidateSearchObservations.length === 0 && !state.candidateSearchFailure
    && !state.replacementPositionClarificationAsked
    && state.history.some(entry => entry.role === "tool" && entry.toolName === "inspect_team")) {
    const action = replacementPositionClarification(state.targetTeam);
    return {
      action,
      message: "已检查现有阵容和球员数据，但参考球员的位置仍无法可靠确认",
      history: policyHistory(action, "已检查可用阵容和比赛样本，并给 Planner 一次基于足球常识与工具结果识别参考位置的机会；仍无法可靠匹配时，只询问缺失的位置，不发起混合位置候选搜索。"),
      update: { replacementPositionClarificationAsked: true },
    };
  }
  const constrainedPosition = state.confirmedPosition ?? (intent.replacementRequest ? state.replacementReferencePosition : null);
  const constrainedPositionSearch = constrainedPositionSearchObservation(state);
  if (constrainedPosition && constrainedPositionSearch?.matchingRecordCount === 0) {
    if (constrainedPosition === "GK") return terminal(
      "当前来源没有可用的门将候选记录，无法完成门将替代者比较。",
      "当前数据没有返回可评估的门将记录。这不代表市场上没有合适门将；需要补充门将数据后继续。",
      "门将候选数据不足，正在整理来源限制",
    );
    if (state.confirmedPositionNoMatchDeclined || intent.declinedPositionBroadening) return {
      action: emptyPositionConclusion(state.targetTeam, constrainedPosition),
      message: "已按你确认的位置范围整理候选缺口",
      update: { responseMessage: `已保留${positionLabels[constrainedPosition]}范围并结束本轮；报告会说明当前数据中的候选缺口。` },
    };
    if (!state.confirmedPositionNoMatchQuestionAsked) return {
      action: emptyPositionQuestion(state.targetTeam, constrainedPosition, source.mode),
      message: "当前来源没有该位置的候选记录，需要你决定是否扩大范围",
      suppressedMessage: "对照组已关闭 Agent 追问，因不能擅自扩大位置范围而安全暂停",
      update: { confirmedPositionNoMatchQuestionAsked: true },
    };
  }
  if (intent.position === null && !intent.allowsAnyPosition && !intent.replacementRequest
    && !state.roleClarificationAsked && (state.hasSearchedMethodology || !needsMethodology) && Object.keys(eligibleEvaluatedPlayers).length > 0) return {
      action: broadRoleQuestion(state.targetTeam),
      message: "首轮宽范围候选评估已完成，需要你确认场上位置",
      suppressedMessage: "对照组已关闭 Agent 追问，关键职责仍未确认，已安全暂停",
      update: { roleClarificationAsked: true },
    };
  if (options.deterministicSearchEnabled && needsMethodology && !state.hasSearchedMethodology
    && intent.position && state.candidateSearchObservations.length === 0) {
    const action = RecruitmentActionSchema.parse({ action: "search_methodology", targetTeam: state.targetTeam,
      query: `${positionLabels[intent.position]}职责与用户要求的可观察比赛表现指标`, limit: 4 });
    return { action, message: "当前职责需要方法背景，先完成一次必要检索", history: policyHistory(action, "方法检索是本次调查前置步骤，直接执行，不额外请求模型规划。") };
  }
  if (options.deterministicSearchEnabled && (!needsMethodology || state.hasSearchedMethodology) && intent.position && state.candidateSearchObservations.length === 0) {
    const action = RecruitmentActionSchema.parse({ action: "search_candidates", targetTeam: state.targetTeam,
      position: intent.position, playerName: null, maxAge: intent.maxAge, minimumMinutes: intent.minimumMinutes,
      competition: intent.competition, season: intent.season, offset: 0, limit: options.understatResearchMode ? 12 : 20 });
    return { action, message: "需求已有明确位置与可观察指标，直接读取首批候选", history: policyHistory(action, "没有角色解释缺口，跳过固定方法检索与冗余搜索规划；保留后续扩围和追问决策。") };
  }
  // Give the Planner one decision point to compare a bounded Understat cohort
  // before the deterministic evaluator narrows its attention to a single batch.
  if (options.understatResearchMode === "fixed_profile"
    && understatResearchCandidates.length >= 2
    && state.toolUses.inspect_candidate_group < toolBudgets.inspect_candidate_group) {
    const action = RecruitmentActionSchema.parse({
      action: "inspect_candidate_group",
      targetTeam: state.targetTeam,
      playerIds: understatResearchCandidates.slice(0, 12).map(({ playerId }) => playerId),
      sections: ["positions", "history", "recent", "shotProfile"],
    });
    return { action, message: "固定资料组按预注册方案比较位置、赛季趋势、近期表现与射门情境", history: policyHistory(action, "固定组使用预先声明的四组 Understat 资料；不由 Planner 选择字段，也不对决赛候选继续下钻。") };
  }
  if (options.understatResearchMode !== "catalog_only"
    && understatResearchCandidates.length >= 2
    && state.toolUses.inspect_candidate_group < toolBudgets.inspect_candidate_group) return null;
  if (!confirmedPositionSearchPending && pendingCandidateIds.length > 0 && state.toolUses.evaluate_candidates < toolBudgets.evaluate_candidates) {
    if (needsReports && Object.keys(eligibleEvaluatedPlayers).length > 0 && unsearchedReportCandidates.length > 0 && state.toolUses.search_player_reports < toolBudgets.search_player_reports) {
      const action = reportLookup(state, unsearchedReportCandidates);
      return { action, message: "先检索已评估候选的报告资料，再评估当前已发现的下一批候选", history: policyHistory(action, "评估下一批候选前，先完成上一批的报告检索；报告结果不影响统计指标或候选排序。") };
    }
    const action = RecruitmentActionSchema.parse({ action: "evaluate_candidates", targetTeam: state.targetTeam, playerIds: pendingCandidateIds });
    const count = discoveredPlayersForConstraint(state).length;
    return {
      action,
      message: `已发现 ${count} 名符合当前条件的候选，正在评估其中 ${pendingCandidateIds.length} 名未评估球员`,
      history: policyHistory(action, `在 Planner 决定扩展候选范围或结束调查前，先评估已经发现且符合用户条件的候选；每批最多 10 人。当前已发现且符合条件 ${count} 人，本批评估 ${pendingCandidateIds.length} 人。评估预算耗尽时，最终报告必须说明未评估人数。`),
    };
  }
  if (state.decisionSteps >= maxDecisionsPerTurn) {
    const responseMessage = "已完成本轮有限调查。报告会说明当前证据和仍需核实的部分。";
    return { action: emptyDecision(state.targetTeam), message: "本轮决策步数已达到上限，正在整理当前证据", update: { responseMessage, forcedLimitReached: true, decisionSteps: state.decisionSteps, policyBlockedRepeatCount: state.policyBlockedRepeatCount }, history: [{ role: "assistant", content: responseMessage }] };
  }
  if (needsReports && Object.keys(eligibleEvaluatedPlayers).length > 0 && unsearchedReportCandidates.length > 0 && state.toolUses.search_player_reports < toolBudgets.search_player_reports) {
    const action = reportLookup(state, Object.values(eligibleEvaluatedPlayers).map(({ player }) => player.name));
    return { action, message: "候选表现评估已完成，正在补充检索球员报告", history: policyHistory(action, "能力评估后先检索球员报告补充定性观察，再交给 Planner 综合实际指标并生成结论。") };
  }
  return null;
}

function emptyPositionConclusion(targetTeam: string | null, position: Position) {
  return FinishActionSchema.parse({
    ...emptyDecision(targetTeam),
    needSummary: `当前数据源没有找到符合用户确认的${positionLabels[position]}位置范围的候选球员。`,
  });
}
