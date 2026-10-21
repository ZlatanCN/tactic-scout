import { positionSearchForIntent } from "../candidate-search-intent.js";
import { nextSelectedPositionInvestigation } from "./selected-position-investigation.js";
import type { PlayerRepository } from "../../players/repository.js";
import { isUnderstatFinePositionSearch } from "../../sources/understat/position-evidence.js";
import { canProvideDetailedPositionEvidence } from "../../players/position-evidence.js";
import { type Position } from "../../domain/position-contracts.js";
import { hasAbilityPositionEvidence, playerPositionMatches, positionFamilyFor } from "../../domain/positions.js";
import { normalizeSearchText } from "../../domain/text-matching.js";
import { buildDecisionConstraints, conclusionPlannerOutputFallback, summarizeRequestedCapabilityCoverage } from "../conclusion-policy.js";
import type { ConversationHistoryEntry } from "../planner-context.js";
import { emptyDecision, FinishActionSchema, RecruitmentActionSchema, toolBudgets, type ParsedRecruitmentAction } from "../recruitment-actions.js";
import { candidateMatchesSearchIntentForPositionRetrieval } from "../candidate-search-intent.js";
import { constrainedPositionSearchObservation, discoveredPlayersForConstraint, evaluatedPlayersForConstraint, resolvedCandidateSearchIntent, sampleUnevaluatedCandidates, userMessages } from "./candidate-context.js";
import { broadRoleQuestion, emptyPositionQuestion, playerIdentityClarification, positionLabels, replacementPositionClarification } from "./interaction-policy.js";
import { maxDecisionsPerTurn, type State } from "./state.js";
import { replacementTargetMention } from "../replacement-target.js";
import type { PendingQuestion, UnderstatResearchMode } from "./contracts.js";
import { compileRecruitmentCriteria } from "../criterion-compiler.js";

export interface InvestigationDirective {
  action: ParsedRecruitmentAction;
  message: string;
  suppressedMessage?: string;
  pendingQuestion?: PendingQuestion;
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
    brief: state.brief,
    userMessages: messages,
    evaluatedPlayers: candidates,
    includeAbilityProfiles: state.abilityProfilesEnabled,
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

function candidatesAwaitingUnderstatPositionEvidence(state: State, position: Position) {
  return Object.values(state.discoveredPlayers).filter((player) => {
    if (player.sourceIdentity?.provider !== "understat") return false;
    if (hasAbilityPositionEvidence(player, position)) return false;
    if (!candidateMatchesSearchIntentForPositionRetrieval(player, resolvedCandidateSearchIntent(state))) return false;
    const evidence = player.positionEvidence;
    return evidence?.targetPosition !== position || evidence.status === "pending";
  });
}

// Deterministic prerequisites run before asking the Planner. This module has no model,
// observer or graph side effects; the node commits the selected directive once.
export function nextRequiredInvestigation(
  state: State,
  source: PlayerRepository,
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
  if (state.briefFailure) return terminal(
    "需求尚未可靠理解。",
    state.briefFailure,
    "需求理解未完成，可重试或补充描述",
  );
  const compiledCriteria = compileRecruitmentCriteria(state.brief, {
    abilityProfilesEnabled: source.supportsAbilityProfiles ?? false,
    verifiedProfileLinksAvailable: source.supportsVerifiedAbilityProfileLinks ?? false,
    targetTeam: state.targetTeam,
  });
  const unsupportedRequired = compiledCriteria.unsupportedRequired;
  if (unsupportedRequired?.length) {
    const requirement = unsupportedRequired.map(item => item.quote).join("；");
    const fmOnly = unsupportedRequired.every(item => ["heightCm", "potentialAbility", "currentAbility", "fmAttribute"].includes(item.field));
    const fields = new Set(unsupportedRequired.map(item => item.field));
    const unsupportedReason = fmOnly
      ? !source.supportsAbilityProfiles
        ? "当前数据源没有可用的 FM 球员画像。"
        : state.targetTeam && !source.supportsVerifiedAbilityProfileLinks
          ? "FM 独立画像没有当前俱乐部信息，且当前没有可用的精确身份桥接到带现役球队的表现记录。"
          : "当前范围没有可验证的 FM 字段覆盖。"
      : fields.size === 1 && fields.has("position") && unsupportedRequired.length > 1
        ? "多项岗位条件要求同时成立，但当前检索只能核验一组可选位置。"
        : fields.size === 1 && fields.has("position")
          ? "当前检索不能可靠执行这项位置条件。"
          : fields.size === 1 && fields.has("capability")
            ? "这类定性能力没有统一的硬筛阈值；当前只能按可观测比赛证据比较，不能保证逐人判定达标。"
            : fields.size === 1 && fields.has("competition") && unsupportedRequired.length > 1
              ? "当前查询无法同时核验这几项赛事条件。"
      : "这项条件当前没有可验证的筛选或核验字段。";
    const questionKey = JSON.stringify(unsupportedRequired.map(item => [item.field, item.operator, item.value, item.unit, item.quote]).sort());
    const nextStep = fmOnly
      ? "你可以把它改为偏好，只在有对应 FM 画像的球员中排序；也可以保留硬要求并暂停推荐。"
      : "你可以移除这项硬条件后继续筛选其他可核验要求；也可以保留硬要求并暂停推荐。";
    if (state.unsupportedConstraintQuestionKey === questionKey) return terminal("必要条件尚无法核验。",
      `${unsupportedReason}目前无法核验“${requirement}”，因此没有把任何球员作为满足这些硬要求的推荐。${nextStep}`, "保留暂不可核验的硬要求，本轮已暂停推荐");
    return { action: { action: "ask_user", targetTeam: state.targetTeam,
      question: `${unsupportedReason}“${requirement}”会改变候选资格。${nextStep}`,
      reason: "硬条件只有在逐个候选取得对应数据时才能判定满足。" }, message: "需要确认如何处理暂时无法核验的硬要求",
      update: { unsupportedConstraintQuestionKey: questionKey } };
  }
  if (state.brief?.unresolved[0]) {
    const clarification = state.brief.unresolved[0];
    return { action: { action: "ask_user", targetTeam: state.targetTeam, question: clarification.question, reason: clarification.impact,
      ...(clarification.topic === "position" ? { positionSelection: { highlight: null } } : {}) },
      message: "有一项会影响找人方向的需求需要确认" };
  }
  if (state.brief?.referencePlayer && state.inspectedReferenceMention && state.referenceNameResolution?.status === "resolved" && !state.referenceProfiles.length) {
    return terminal("已确认参考身份，但缺少可比较的球员画像。", `已确认你说的是${state.referenceNameResolution.player.preferredName}，但当前资料中没有他的可用画像，暂时无法可靠寻找相似球员。你可以补充希望保留的位置和特点，再按这些要求找人。`, "身份已确认，缺少参考画像");
  }
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
    return terminal(
        `${source.sourceName} 候选查询未成功，当前无法确认匹配结果。`,
      `${source.sourceName} 候选查询最近一次失败，当前无法确认是否有符合条件的球员；这不代表没有匹配球员。请稍后重试。`,
        "候选来源查询未成功，正在明确说明匹配情况未知",
      );
  }
  if (!state.brief && intent.replacementRequest && state.targetTeam
    && state.toolUses.inspect_team < toolBudgets.inspect_team
    && state.inspectedReferenceMention !== normalizeSearchText(replacementTargetMention(userMessages(state.history)) ?? "")) {
    const action = RecruitmentActionSchema.parse({ action: "inspect_team", targetTeam: state.targetTeam, teamName: state.targetTeam });
    return { action, message: "正在读取目标球队和参考球员的已有表现，建立替代需求背景", history: policyHistory(action, "替代者任务先读取参考背景；缺失数据不得由模型臆造。") };
  }
  const identityResolution = state.referenceNameResolution;
  if (intent.replacementRequest && identityResolution && identityResolution.status !== "resolved") {
    const rawMention = state.brief?.referencePlayer?.value ?? replacementTargetMention(userMessages(state.history)) ?? identityResolution.mention;
    const pendingQuestion = playerIdentityClarification(identityResolution, rawMention);
    const action = RecruitmentActionSchema.parse({ action: "ask_user", targetTeam: state.targetTeam,
      question: pendingQuestion.question, reason: pendingQuestion.reason });
    return {
      action,
      pendingQuestion,
      message: "需要先确认参考球员身份，避免错误排除本人或套用错误位置",
      history: policyHistory(action, "参考身份不确定；暂停候选搜索。只允许用户确认已验证候选或补充线索，不按搜索排名自行选择。"),
    };
  }
  const replacementDiscoveryRecoveryActive = state.policyBlocked && state.policyBlockedRepeatCount >= 2;
  if (state.policyBlocked && state.action?.action === "ask_user"
    && intent.replacementRequest && intent.position !== null
    && state.candidateSearchObservations.length === 0 && !state.candidateSearchFailure) {
    const action = RecruitmentActionSchema.parse({
      action: "search_candidates",
      targetTeam: state.targetTeam,
      ...positionSearchForIntent(intent),
      playerName: null,
      maxAge: intent.maxAge,
      ...(intent.minAge == null ? {} : { minAge: intent.minAge }),
      agePreference: intent.agePreference ?? null,
      ...(intent.fmCriteria?.length ? { fmCriteria: [...intent.fmCriteria] } : {}),
      minimumMinutes: intent.minimumMinutes,
      competition: intent.competition,
      season: intent.season,
      offset: 0,
      limit: 20,
    });
    return {
      action,
      message: `参考位置已确认，按${positionLabels[intent.position]}范围继续寻找候选`,
      history: policyHistory(action, "Planner 提出的角色追问与已核实参考位置重复；继续按来源位置执行候选检索，不再重复询问。"),
    };
  }
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
  if (!state.confirmedPositions.length && intent.position && ["DEF", "MID", "ATT", "FB", "WG"].includes(intent.position)
    && state.confirmedPosition === null && !intent.replacementRequest
    && new Set(Object.values(eligibleEvaluatedPlayers).map(({ player }) => player.position)
      .filter((position) => position !== "UNKNOWN" && position !== intent.position && positionFamilyFor(position) === intent.position)).size > 1
    && !state.roleClarificationAsked) {
    return { action: broadRoleQuestion(state.targetTeam, intent.position), message: "需要确认具体补强区域", update: { roleClarificationAsked: true } };
  }
  const selectedPositionStep = nextSelectedPositionInvestigation(state, source);
  if (selectedPositionStep) return selectedPositionStep;
  const constrainedPosition = state.confirmedPosition ?? (intent.replacementRequest ? state.replacementReferencePosition : null);
  const constrainedPositionSearch = constrainedPositionSearchObservation(state);
  const understatFinePosition = state.confirmedPositions.length < 2 && (source.mode === "understat" || source.mode === "mosaic")
    && intent.position !== null && isUnderstatFinePositionSearch(intent.position)
    ? intent.position
    : null;
  if (understatFinePosition && constrainedPositionSearch?.appliedFilters.includes("positionFamily")
    && constrainedPositionSearch.matchingRecordCount === 0) {
    const sourceLabel = source.mode === "mosaic" ? "当前多来源候选池" : "Understat 当前赛季位置族检索";
    const userSourceLabel = source.mode === "mosaic" ? "当前多来源候选池" : "Understat 球员池";
    return terminal(
    `${sourceLabel}没有返回${positionLabels[understatFinePosition]}所在大类的球员记录。`,
    `${userSourceLabel}没有返回相关位置大类的记录；这不代表整个市场没有合适球员。`,
    `${source.mode === "mosaic" ? "多来源候选池" : "Understat"}当前位置大类没有来源记录，正在说明数据范围`,
  );
  }
  if (understatFinePosition && constrainedPositionSearch?.appliedFilters.includes("positionFamily")) {
    const pendingPositionEvidence = candidatesAwaitingUnderstatPositionEvidence(state, understatFinePosition);
    const canInspectPositionEvidence = !pendingPositionEvidence.length
      || Boolean(pendingPositionEvidence.length >= 2 && source.inspectCandidateGroup
        && state.toolUses.inspect_candidate_group < toolBudgets.inspect_candidate_group)
      || Boolean(source.inspectPlayer && state.toolUses.inspect_player < toolBudgets.inspect_player);
    if (pendingPositionEvidence.length > 0) {
      if (pendingPositionEvidence.length >= 2 && source.inspectCandidateGroup
        && state.toolUses.inspect_candidate_group < toolBudgets.inspect_candidate_group) {
        const action = RecruitmentActionSchema.parse({
          action: "inspect_candidate_group",
          targetTeam: state.targetTeam,
          playerIds: pendingPositionEvidence.slice(0, 12).map(({ playerId }) => playerId),
          sections: ["positions"],
        });
        return { action, message: `按当前赛季位置记录核实 ${pendingPositionEvidence.length} 名${positionLabels[understatFinePosition]}候选`, history: policyHistory(action, "位置族召回只用于发现；在读取候选的当前赛季位置标签前，不将大类位置当作细分位置命中。") };
      }
      if (source.inspectPlayer && pendingPositionEvidence.length === 1
        && state.toolUses.inspect_player < toolBudgets.inspect_player) {
        const candidate = pendingPositionEvidence[0]!;
        const action = RecruitmentActionSchema.parse({ action: "inspect_player", targetTeam: state.targetTeam, playerId: candidate.playerId, sections: ["positions"] });
        return { action, message: `按当前赛季位置记录核实${candidate.name}的${positionLabels[understatFinePosition]}出场`, history: policyHistory(action, "细分位置查询需要候选自身的赛季位置记录；单条候选使用单人细查接口。") };
      }
      if (source.inspectPlayer && state.toolUses.inspect_player < toolBudgets.inspect_player) {
        const candidate = pendingPositionEvidence[0]!;
        const action = RecruitmentActionSchema.parse({ action: "inspect_player", targetTeam: state.targetTeam, playerId: candidate.playerId, sections: ["positions"] });
        return { action, message: `按当前赛季位置记录核实${candidate.name}的${positionLabels[understatFinePosition]}出场`, history: policyHistory(action, "批量细查不可用或本轮预算已满；改用有界的单人位置细查。") };
      }
    }

    const roleLeads = discoveredPlayersForConstraint(state, intent);
    const verifiedCandidates = roleLeads.filter((player) => hasAbilityPositionEvidence(player, understatFinePosition) || (player.sourceIdentity?.provider === "understat"
      ? player.positionEvidence?.targetPosition === understatFinePosition && player.positionEvidence.status === "direct"
      : playerPositionMatches(player, understatFinePosition)));
    const adjacentRoleLeads = roleLeads.filter((player) => player.positionEvidence?.targetPosition === understatFinePosition
      && player.positionEvidence.status === "compatible");
    const hasMorePositionCandidates = constrainedPositionSearch.nextOffset !== null;
    const positionSearchBudgetAvailable = state.toolUses.search_candidates < toolBudgets.search_candidates;
    if (pendingPositionEvidence.length === 0 && verifiedCandidates.length < 5
      && hasMorePositionCandidates && positionSearchBudgetAvailable) {
      const action = RecruitmentActionSchema.parse({
        ...constrainedPositionSearch.request,
        offset: constrainedPositionSearch.nextOffset!,
        limit: Math.min(12, constrainedPositionSearch.request.limit),
      });
      return { action, message: `已核实 ${verifiedCandidates.length} 名${positionLabels[understatFinePosition]}候选；继续读取来源下一页补足比较样本`, history: policyHistory(action, `位置族检索仍有下一页；逐批核实至多 ${toolBudgets.search_candidates * 12} 名来源记录，或先获得 5 名有位置证据的候选。必须使用来源返回的游标 ${constrainedPositionSearch.nextOffset}。`) };
    }

    const hasUnverifiedTail = pendingPositionEvidence.length > 0 && !canInspectPositionEvidence;
    const searchFinished = !hasMorePositionCandidates || !positionSearchBudgetAvailable;
    if (verifiedCandidates.length === 0 && adjacentRoleLeads.length === 0 && pendingPositionEvidence.length > 0
      && !canInspectPositionEvidence) return terminal(
      `${source.mode === "mosaic" ? "多来源候选池" : "Understat"}已返回 ${pendingPositionEvidence.length} 条待核实的${positionLabels[understatFinePosition]}候选，但当前仓库没有可用的赛季位置细查接口。`,
      `当前数据接口无法核验这些候选是否踢${positionLabels[understatFinePosition]}；这不代表市场上没有合适球员。报告会将其列为待核实，不会把大类位置当作命中。`,
      "当前来源未提供细分位置核验接口，正在说明证据限制",
    );
    if (verifiedCandidates.length === 0 && adjacentRoleLeads.length === 0 && pendingPositionEvidence.length === 0 && searchFinished) {
      const sourceLabel = source.mode === "mosaic" ? "当前多来源候选池" : "Understat";
      return terminal(
        `${sourceLabel}本轮已读取 ${Object.values(state.discoveredPlayers).filter((player) => candidateMatchesSearchIntentForPositionRetrieval(player, intent)).length} 条位置族候选记录，但没有取得支持${positionLabels[understatFinePosition]}的细分位置证据。`,
        `当前数据没有足够的${positionLabels[understatFinePosition]}位置证据形成推荐；这不代表市场上没有合适球员。报告会列出已调查范围和未核实限制。`,
        "细分位置证据调查已完成，正在说明覆盖与缺口",
      );
    }
    if (verifiedCandidates.length === 0 && adjacentRoleLeads.length === 0 && hasUnverifiedTail) {
      return terminal(
        `Understat 本轮位置细查预算已用尽；已有 ${Object.values(state.discoveredPlayers).filter((player) => candidateMatchesSearchIntentForPositionRetrieval(player, intent)).length} 条位置族记录，部分位置证据仍未核实。`,
        `本轮位置细查已达到调查上限，不能据此判断没有${positionLabels[understatFinePosition]}候选。报告会标出待核实数量。`,
        "位置细查达到本轮预算，正在整理当前证据",
      );
    }
  }
  if (state.confirmedPositions.length < 2 && constrainedPosition && constrainedPositionSearch?.matchingRecordCount === 0) {
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
      ...positionSearchForIntent(intent), playerName: null, maxAge: intent.maxAge, minimumMinutes: intent.minimumMinutes,
      ...(intent.minAge == null ? {} : { minAge: intent.minAge }), ...(intent.fmCriteria?.length ? { fmCriteria: intent.fmCriteria } : {}),
      ...(intent.agePreference ? { agePreference: intent.agePreference } : {}),
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
    && pendingCandidateIds.length > 0
    && !pendingCandidateIds.some((id) => state.discoveredPlayers[id]?.abilityProfile)
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
  if (understatFinePosition && constrainedPositionSearch?.appliedFilters.includes("positionFamily")) {
    const pendingPositionEvidence = candidatesAwaitingUnderstatPositionEvidence(state, understatFinePosition);
    const canInspectPositionEvidence = !pendingPositionEvidence.length
      || Boolean(source.inspectCandidateGroup && state.toolUses.inspect_candidate_group < toolBudgets.inspect_candidate_group)
      || Boolean(source.inspectPlayer && state.toolUses.inspect_player < toolBudgets.inspect_player);
    const hasUnevaluatedReports = needsReports && Object.keys(eligibleEvaluatedPlayers).length > 0
      && unsearchedReportCandidates.length > 0
      && state.toolUses.search_player_reports < toolBudgets.search_player_reports;
    const inspectionCapabilityExists = Boolean(source.inspectCandidateGroup || source.inspectPlayer);
    if (pendingPositionEvidence.length > 0 && !canInspectPositionEvidence && pendingCandidateIds.length === 0 && !hasUnevaluatedReports
      && (inspectionCapabilityExists || Object.keys(eligibleEvaluatedPlayers).length === 0)) {
      const action = conclusionPlannerOutputFallback(buildDecisionConstraints({
        targetTeam: state.targetTeam,
        brief: state.brief,
        includeAbilityProfiles: state.abilityProfilesEnabled,
        confirmedPosition: state.confirmedPosition ?? understatFinePosition,
        userMessages: userMessages(state.history),
        evaluatedPlayers: Object.values(eligibleEvaluatedPlayers),
        retrievedKnowledge: Object.values(state.retrievedKnowledge),
        candidateIdentityGroups: state.candidateIdentityGroups,
      }));
      return {
        action,
        message: "细分位置核验达到本轮上限，正在依据已核实候选形成有限结论",
        history: policyHistory(action, "位置细查预算已耗尽；只允许使用已经核实目标位置且完成评估的候选。报告必须说明仍有位置证据待核实，不能继续扩页或用未核实记录凑名单。"),
      };
    }
  }
  const finePosition = state.confirmedPositions.length < 2 && intent.position && isUnderstatFinePositionSearch(intent.position) ? intent.position : null;
  if (finePosition && !understatFinePosition && constrainedPositionSearch?.appliedFilters.includes("positionFamily")
    && canProvideDetailedPositionEvidence(source.mode, finePosition)) {
    const verifiedCandidates = discoveredPlayersForConstraint(state, intent).filter((player) => playerPositionMatches(player, finePosition));
    const hasMorePositionCandidates = constrainedPositionSearch.nextOffset !== null;
    const positionSearchBudgetAvailable = state.toolUses.search_candidates < toolBudgets.search_candidates;
    if (verifiedCandidates.length < 5 && hasMorePositionCandidates && positionSearchBudgetAvailable) {
      const action = RecruitmentActionSchema.parse({
        ...constrainedPositionSearch.request,
        offset: constrainedPositionSearch.nextOffset!,
        limit: Math.min(12, constrainedPositionSearch.request.limit),
      });
      return {
        action,
        message: `已找到 ${verifiedCandidates.length} 名有来源位置证据的${positionLabels[finePosition]}球员；继续读取位置族下一页`,
        history: policyHistory(action, `来源具备细分位置字段，继续按服务端游标 ${constrainedPositionSearch.nextOffset} 有界读取位置族记录；只有${positionLabels[finePosition]}的来源位置证据才能进入候选评估。宽位置记录只保留为未核实线索。最多读取 ${toolBudgets.search_candidates} 页，或先获得 5 名位置证据明确的球员。`),
      };
    }
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
