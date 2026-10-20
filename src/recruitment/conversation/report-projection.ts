import { createCandidateComparison, createReferenceComparisonNotes, reportReferenceProfile } from "../recruitment-comparison.js";
import { type PlayerRepository } from "../../players/repository.js";
import { describeDatasetScope } from "../../domain/dataset-scope.js";
import { minimumMinutesForPercentileComparison } from "../../domain/evidence-comparison.js";
import { hasAbilityPositionEvidence, playerPositionMatches, positionFamilyFor } from "../../domain/positions.js";
import { isUnderstatFinePositionSearch } from "../../sources/understat/position-evidence.js";
import { type CandidateIdentityResolutionStatus } from "../../domain/identity.js";
import { type PlayerProfile } from "../../domain/players.js";
import { type Position } from "../../domain/position-contracts.js";
import { RecruitmentReportSchema } from "../../domain/reports.js";
import { normalizeSearchText } from "../../domain/text-matching.js";
import { summarizeCandidateIdentityGroupReferences, type CandidateIdentityGroup } from "../../players/identity/candidate-groups.js";
import { sourcePlayerKey } from "../../players/identity/source-player-key.js";
import { requestedCapabilityEvidenceAreasForInput } from "../../domain/recruitment-capabilities.js";
import { summarizeRequestedCapabilityCoverage } from "../conclusion-policy.js";
import { collectMethodologySourceReferences } from "../methodology-sources.js";
import { emptyDecision, toolBudgets, type FinishRecruitmentAction } from "../recruitment-actions.js";
import { type RecruitmentEvidenceEvaluator } from "../recruitment-evidence-evaluator.js";
import { candidateIdentityGroupReferencesFor, candidateSearchScopeKey, constrainedPositionSearchObservation, confirmedPositionSearchObservation, discoveredPlayersForConstraint, evaluatedPlayersForConstraint, resolvedCandidateSearchIntent, userMessages } from "./candidate-context.js";
import { candidateMatchesSearchIntentForPositionRetrieval } from "../candidate-search-intent.js";
import { positionLabels } from "./interaction-policy.js";
import { type CandidateSearchObservation, type EvaluatedPlayer, type State } from "./state.js";
import { type Runtime } from "@langchain/langgraph";
import { type RecruitmentRuntimeContext, requireRecruitmentRuntimeContext } from "./runtime-context.js";

const limitationDescriptions = {
  current_roster: "当前数据不能核实目标球队的完整现役阵容。",
  budget: "当前数据不含球队可用预算，预算可行性尚未核实。",
  market_value: "当前数据不含可核验的球员市场估值或转会费。",
  contract: "当前数据不含球员合同、薪资或经纪费用。",
  injury: "当前数据不含伤病史或医疗评估。",
  physical: "当前数据不含身体属性或体能测试结果。",
  potential: "当前数据不能验证球员潜力或未来发展。",
  registration: "当前数据未核验联赛或赛事注册资格。",
  work_permit: "当前数据未核验工作许可或移民资格。",
  other: "有些需求无法由当前数据验证，需要补充来源或人工核实。",
} satisfies Record<Extract<FinishRecruitmentAction["limitationKeys"][number], string>, string>;

function candidateSearchSampleCoverage(observations: CandidateSearchObservation[]): Array<{
  matchingRecordCount: number | null;
  discoveredSourceRecordCount: number;
  nextOffset: number | null;
  positionSearchScope: "exact" | "family";
}> {
  const scopes = new Map<string, {
    matchingRecordCount: number | null;
    nextOffset: number | null;
    sourceRecordIds: Set<string>;
    positionSearchScope: "exact" | "family";
  }>();
  for (const observation of observations) {
    const scopeKey = candidateSearchScopeKey(observation.request);
    const scope = scopes.get(scopeKey) ?? {
      matchingRecordCount: null,
      nextOffset: null,
      sourceRecordIds: new Set<string>(),
      positionSearchScope: "exact",
    };
    if (observation.matchingRecordCount !== null) {
      scope.matchingRecordCount = observation.matchingRecordCount;
    }
    scope.nextOffset = observation.nextOffset;
    if (observation.appliedFilters.includes("positionFamily")) scope.positionSearchScope = "family";
    for (const sourceRecordId of observation.discoveredSourceRecordIds) {
      scope.sourceRecordIds.add(sourceRecordId);
    }
    scopes.set(scopeKey, scope);
  }
  return [...scopes.values()].map(({ matchingRecordCount, nextOffset, sourceRecordIds, positionSearchScope }) => ({
    matchingRecordCount,
    discoveredSourceRecordCount: sourceRecordIds.size,
    nextOffset,
    positionSearchScope,
  }));
}

function understatPositionEvidenceSummary(state: State, repository: PlayerRepository): string | null {
  const intent = resolvedCandidateSearchIntent(state);
  const position = intent.position;
  if ((repository.mode !== "understat" && repository.mode !== "mosaic") || !position || !isUnderstatFinePositionSearch(position)) return null;
  const observations = state.candidateSearchObservations.filter((item) => item.request.position === position
    && item.appliedFilters.includes("positionFamily"));
  if (observations.length === 0) return null;
  const candidates = Object.values(state.discoveredPlayers)
    .filter((player) => candidateMatchesSearchIntentForPositionRetrieval(player, intent));
  const understatCandidates = candidates.filter(({ sourceIdentity }) => sourceIdentity?.provider === "understat");
  const count = (status: string) => understatCandidates.filter(({ positionEvidence }) => positionEvidence?.targetPosition === position
    && positionEvidence.status === status).length;
  const direct = count("direct");
  const compatible = count("compatible");
  const notObserved = count("not_observed");
  const unavailable = count("unavailable") + count("pending");
  const scanned = understatCandidates.length;
  const otherSourceCoarseRecords = repository.mode === "mosaic"
    ? candidates.filter((player) => player.sourceIdentity?.provider !== "understat"
      && !playerPositionMatches(player, position)).length
    : 0;
  const latest = observations.at(-1)!;
  const coverageNote = latest.nextOffset !== null
    ? `位置族检索仍有下一页（offset=${latest.nextOffset}），本轮未覆盖全部可检索记录。`
    : unavailable > 0
      ? "部分球员的细分位置详情未返回或尚未核实；这不等于不符合该位置。"
      : otherSourceCoarseRecords > 0
        ? "部分其他来源只有宽位置标签，无法确认具体职责；这不等于球员不适合该位置。"
      : "本轮检索范围内的位置详情已完成核实。";
  return `Understat 位置核实（${positionLabels[position]}）：按${positionLabels[positionFamilyFor(position)]}大类已读取 ${scanned} 条 Understat 来源记录；${direct} 条有直接位置标签，${compatible} 条只有相邻位置标签，${notObserved} 条当前赛季记录未显示对应标签，${unavailable} 条细查未返回或尚未核实。未观察到位置标签不等于球员不会踢该位置。${otherSourceCoarseRecords > 0 ? `另有 ${otherSourceCoarseRecords} 条其他来源记录只有宽位置标签，未计入目标位置候选。` : ""}${coverageNote}`;
}

function finePositionEvidenceSummary(state: State, position: Position): string | null {
  const observations = state.candidateSearchObservations.filter((item) => item.request.position === position
    && item.appliedFilters.includes("positionFamily"));
  if (observations.length === 0) return null;
  const candidates = Object.values(state.discoveredPlayers)
    .filter((player) => candidateMatchesSearchIntentForPositionRetrieval(player, resolvedCandidateSearchIntent(state)));
  const directlyObserved = candidates.filter((player) => playerPositionMatches(player, position)).length;
  const unverified = candidates.filter((player) => player.positionEvidence?.targetPosition === position
    && ["broad_only", "pending", "unavailable"].includes(player.positionEvidence.status)).length;
  if (unverified === 0) return null;
  const latest = observations.at(-1)!;
  const coverage = latest.nextOffset !== null
    ? `来源仍有下一页（offset=${latest.nextOffset}），本轮没有覆盖完位置大类。`
    : "当前已读取范围内没有更多页面。";
  return `细分位置核实（${positionLabels[position]}）：按${positionLabels[positionFamilyFor(position)]}大类召回 ${candidates.length} 条记录，其中 ${directlyObserved} 条有来源位置证据，${unverified} 条只有较宽位置标签或尚未核实；后者只列为待核实线索，不进入目标位置名单。${coverage}`;
}

function positionLeadRecords(state: State): Array<{ player: PlayerProfile; status: "broad_only" | "pending" | "not_observed" | "unavailable" }> {
  const intent = resolvedCandidateSearchIntent(state);
  if (state.confirmedPositions.length > 1) {
    return Object.values(state.discoveredPlayers).filter((player) => candidateMatchesSearchIntentForPositionRetrieval(player, intent)
      && !state.confirmedPositions.some((position) => playerPositionMatches(player, position)))
      .map((player) => ({ player, status: player.positionEvidence?.status === "not_observed" ? "not_observed" as const : player.positionEvidence?.status === "unavailable" ? "unavailable" as const : "broad_only" as const }));
  }
  const position = intent.position;
  if (!position || !isUnderstatFinePositionSearch(position)) return [];
  if (!state.candidateSearchObservations.some((item) => item.request.position === position
    && item.appliedFilters.includes("positionFamily"))) return [];
  return Object.values(state.discoveredPlayers)
    .filter((player) => candidateMatchesSearchIntentForPositionRetrieval(player, intent))
    .flatMap((player) => {
      const evidence = player.positionEvidence;
      if (evidence?.targetPosition !== position
        || (evidence.status !== "broad_only" && evidence.status !== "pending"
          && evidence.status !== "not_observed" && evidence.status !== "unavailable")) return [];
      return [{ player, status: evidence.status }];
    })
    .sort((left, right) => left.player.name.localeCompare(right.player.name) || left.player.playerId.localeCompare(right.player.playerId));
}

function hasLowSampleEvidence({ player, evidence }: EvaluatedPlayer): boolean {
  return (player.eventDataComplete !== false && player.minutes < minimumMinutesForPercentileComparison)
    || evidence.some((item) => item.basis !== "ability_profile" && item.minutes !== null && item.minutes < minimumMinutesForPercentileComparison);
}

function reportNeedSummary(value: string, history: State["history"], recommendationCount: number): string {
  const summary = value.trim();
  if (summary && !/requestedCapabilityCoverage|requestedMetricKeys|observedMetricKeys|nextOffset|playerId|evidenceKeys|search_candidates|evaluate_candidates|Planner|LangGraph|schema|JSON/i.test(summary)
    && !/^(?:false|true|null|undefined|none|n\/a)$/i.test(summary.replace(/[。.!！?？]+$/u, ""))) {
    return summary;
  }
  const request = userMessages(history)[0]?.trim().replace(/\s+/gu, " ");
  const requestExcerpt = request ? Array.from(request).slice(0, 120).join("") : "已确认的引援需求";
  const suffix = request && Array.from(request).length > 120 ? "…" : "";
  const scope = recommendationCount > 0 ? `整理了 ${recommendationCount} 条候选线索` : "完成本轮候选调查";
  return `围绕“${requestExcerpt}${suffix}”${scope}；具体依据与数据缺口见下方。`;
}

function limitationsFor(
  state: State,
  repository: PlayerRepository,
  action: FinishRecruitmentAction,
  evaluator: RecruitmentEvidenceEvaluator,
): string[] {
  const eligibleEvaluatedPlayers = Object.values(evaluatedPlayersForConstraint(state));
  const requestedEvidenceAreas = requestedCapabilityEvidenceAreasForInput({ brief: state.brief, userMessages: userMessages(state.history) }, resolvedCandidateSearchIntent(state).position, state.abilityProfilesEnabled);
  const limitations = action.limitationKeys.map((key) => limitationDescriptions[key]);
  const identityCoverage = summarizeCandidateIdentityGroupReferences(state.candidateIdentityGroups);
  const identityStatusCount = (status: CandidateIdentityResolutionStatus) => (
    identityCoverage.resolutionStatusCounts.find((item) => item.status === status)?.count ?? 0
  );
  const missingIdentityCount = identityStatusCount("missing_source_identity");
  const unavailableIdentityCount = identityStatusCount("registry_unavailable");
  if (missingIdentityCount > 0) {
    limitations.push(`${missingIdentityCount} 条候选来源记录没有稳定球员 ID，无法进行精确身份关联；这些记录按独立来源记录保留。`);
  }
  if (unavailableIdentityCount > 0) {
    limitations.push(`本机未能读取 Reep 身份索引；${unavailableIdentityCount} 条具备来源 ID 的候选记录未做身份解析，按独立记录保留。`);
  }
  if (identityCoverage.registryAvailable && identityCoverage.unresolvedSourceRecordCount > 0) {
    limitations.push(`Reep release ${identityCoverage.releaseStamp ?? "未确认"} 将 ${identityCoverage.resolvedSourceRecordCount} 条来源记录归为 ${identityCoverage.resolvedIdentityCount} 个精确身份组；另有 ${identityCoverage.unresolvedSourceRecordCount} 条记录未能解析，继续按来源记录分别保留。身份映射不合并指标或评分。`);
  }
  if (state.evidenceEvaluationWithheld) {
    limitations.push("实验对照组有意屏蔽球员表现评估器；当前结果不提供能力指标或百分位，也不代表数据源缺失或球员能力为零。");
  } else {
    for (const area of requestedEvidenceAreas) {
      if (eligibleEvaluatedPlayers.length && eligibleEvaluatedPlayers.every(({ evidence }) => (
        !evidence.some((item) => area.metricKeys.includes(item.key))
      ))) {
        limitations.push(`当前数据没有提供与用户要求的“${area.name}”相对应的可观测指标，无法评估该能力。`);
      }
    }
  }
  for (const coverage of candidateSearchSampleCoverage(state.candidateSearchObservations)) {
    const hasKnownUnobservedRecords = coverage.matchingRecordCount !== null
      && coverage.matchingRecordCount > coverage.discoveredSourceRecordCount;
    if (hasKnownUnobservedRecords || coverage.nextOffset !== null) {
      if (coverage.matchingRecordCount === null) {
        limitations.push(coverage.positionSearchScope === "family"
          ? `来源未提供位置大类的精确总数；Agent 已读取 ${coverage.discoveredSourceRecordCount} 条位置族来源记录，来源仍返回下一页（offset=${coverage.nextOffset}），样本尚未读完。`
          : `当前筛选的匹配总数未知；Agent 已读取 ${coverage.discoveredSourceRecordCount} 条来源记录，来源仍返回下一页（offset=${coverage.nextOffset}），样本尚未读完。`);
        continue;
      }
      limitations.push(state.evidenceEvaluationWithheld
        ? `当前筛选命中 ${coverage.matchingRecordCount} 条候选记录；Agent 读取 ${coverage.discoveredSourceRecordCount} 条来源记录。本实验屏蔽了能力评估，不能据此形成能力比较；本轮也不代表全量市场排名。`
        : coverage.positionSearchScope === "family"
          ? `位置大类检索命中 ${coverage.matchingRecordCount} 条来源记录；Agent 读取 ${coverage.discoveredSourceRecordCount} 条，细分位置是否匹配按来源提供的位置证据判断。本轮是有限样本调查，不代表全量市场排名。`
          : `当前筛选命中 ${coverage.matchingRecordCount} 条候选记录；Agent 读取 ${coverage.discoveredSourceRecordCount} 条来源记录、评估 ${eligibleEvaluatedPlayers.length} 人。本轮是有限样本调查，不代表全量市场排名.`);
    }
  }
  const positionEvidenceSummary = understatPositionEvidenceSummary(state, repository);
  if (positionEvidenceSummary) limitations.push(positionEvidenceSummary);
  const genericPositionEvidenceSummary = resolvedCandidateSearchIntent(state).position
    ? finePositionEvidenceSummary(state, resolvedCandidateSearchIntent(state).position!)
    : null;
  if (genericPositionEvidenceSummary && !positionEvidenceSummary) limitations.push(genericPositionEvidenceSummary);
  const eligibleDiscoveredPlayers = discoveredPlayersForConstraint(state);
  const unevaluatedDiscoveredCount = eligibleDiscoveredPlayers.filter(({ playerId }) => !state.evaluatedPlayers[playerId]).length;
  if (unevaluatedDiscoveredCount > 0) {
    limitations.push(`本轮已发现 ${eligibleDiscoveredPlayers.length} 名符合当前条件的候选，其中 ${unevaluatedDiscoveredCount} 人未完成表现评估；结论只覆盖已评估样本。`);
  }
  if (!state.evidenceEvaluationWithheld && repository.mode === "fbref" && eligibleEvaluatedPlayers.some(({ player }) => player.source.includes("统计页未读取"))) {
    limitations.push("本次有一个或多个补充统计页未能读取；只使用了来源成功返回的字段，缺失指标没有按零值处理。 ");
  }
  if (state.sourceAccessFailure) {
    limitations.push(`${repository.sourceName} 数据源访问失败（${state.sourceAccessFailure.code}）：${state.sourceAccessFailure.message}`);
  }
  if (state.candidateSearchFailure && !state.sourceAccessFailure) {
    const { code, message } = state.candidateSearchFailure;
    limitations.push(`${repository.sourceName} 最近一次候选查询失败${code ? `（${code}）` : ""}：${message} 该失败不能解释为零匹配，不代表没有符合条件的球员。`);
  }
  limitations.push(...describeDatasetScope(repository.mode).limitations);
  const confirmedPositionSearch = state.confirmedPositions.length > 1 ? constrainedPositionSearchObservation(state) : confirmedPositionSearchObservation(state);
  const confirmedPositionLabel = state.confirmedPositions.length ? state.confirmedPositions.map((position) => positionLabels[position]).join("、") : state.confirmedPosition ? positionLabels[state.confirmedPosition] : "";
  if (state.confirmedPosition && confirmedPositionSearch?.matchingRecordCount === 0) {
    limitations.push(`本轮按用户确认的位置（${confirmedPositionLabel}）完成候选检索后，没有找到符合当前筛选条件的球员；没有放宽位置范围。`);
  } else if (state.confirmedPosition && !confirmedPositionSearch && !discoveredPlayersForConstraint(state).length) {
    limitations.push(`本轮尚未完成用户确认位置（${confirmedPositionLabel}）的候选检索；报告没有用其他位置的球员代替。`);
  } else if (state.confirmedPosition && confirmedPositionSearch
    && confirmedPositionSearch.matchingRecordCount === null && !discoveredPlayersForConstraint(state).length) {
    limitations.push(`来源没有提供用户确认位置（${confirmedPositionLabel}）的精确匹配总数；已读取页面未发现候选，不能据此确认没有符合条件的球员。`);
  } else if (state.confirmedPosition && !eligibleEvaluatedPlayers.length) {
    limitations.push(`已找到符合用户确认位置（${confirmedPositionLabel}）的球员，但当前数据不足以完成该位置的可靠评估。`);
  }
  if (!state.evidenceEvaluationWithheld && eligibleEvaluatedPlayers.some(hasLowSampleEvidence)) {
    limitations.push(`部分候选人或指标样本少于 ${minimumMinutesForPercentileComparison} 分钟，单赛季每 90 分钟数据波动较大；这些指标不显示百分位。`);
  }
  if (!state.evidenceEvaluationWithheld && eligibleEvaluatedPlayers.some(({ evidence }) => evidence.some((item) => item.peerPercentileUnavailableReason === "candidate_sample_unknown"))) {
    limitations.push("部分指标来源没有提供样本分钟，无法核实比较门槛，因此不显示这些指标的百分位。");
  }
  if (!state.evidenceEvaluationWithheld && eligibleEvaluatedPlayers.some(({ evidence }) => evidence.some((item) => item.peerPercentileUnavailableReason === "competition_scope_unreported"))) {
    limitations.push("Understat 赛季位置分组指标未提供赛事范围；保留单人观测值，不做同赛事百分位或候选间范围比较。");
  }
  if (eligibleEvaluatedPlayers.some(({ player }) => player.positionEvidence?.provider === "understat"
    && player.positionEvidence.sourceScope === "season_position_aggregate")) {
    limitations.push("Understat 位置标签按赛季与位置分组，未提供赛事拆分；它表示该球员当季有此位置记录，不能确认标签来自当前候选记录所对应的联赛。");
  }
  if (!state.evidenceEvaluationWithheld && eligibleEvaluatedPlayers.some(({ player }) => player.eventDataComplete === false && !player.abilityProfile)) {
    limitations.push("部分球员缺少一场或多场比赛的事件文件；这些球员只作为候选线索，不提供比赛表现指标或推荐依据。");
  }
  if (!state.evidenceEvaluationWithheld && eligibleEvaluatedPlayers.some((candidate) => evaluator.coverage(candidate).hasMissingMetrics)) {
    limitations.push("来源或赛季记录没有提供部分评估指标；这些指标保持暂无数据，不按零值处理，也不参与对应职责的适配计算。");
  }
  if (!state.evidenceEvaluationWithheld && eligibleEvaluatedPlayers.some(({ player }) =>
    player.stats.passesAttempted === 0
    && (player.availableStats === undefined || player.availableStats.includes("passesAttempted"))
  )) {
    limitations.push("部分评估对象没有传球尝试，传球成功率不适用，因此不列入可用指标。");
  }
  if (!state.evidenceEvaluationWithheld && eligibleEvaluatedPlayers.some(({ evidence }) => evidence.some((item) => item.peerPercentileUnavailableReason === "insufficient_peer_group"))) {
    limitations.push(`部分指标达到 ${minimumMinutesForPercentileComparison} 分钟门槛的同位置、同赛事、同赛季比较组不足 5 人；这些维度不显示百分位比较。`);
  }
  if (!state.evidenceEvaluationWithheld) {
    limitations.push("比赛事件指标只能说明可观察到的表现产出，不能代表球员的完整能力或未来表现。");
    if (state.candidateSearchObservations.some(observation => observation.discoveryStrategy)) {
      limitations.push("本轮在同来源、赛事、赛季和位置组内，以明确要求的累计观测表现、指标分母或出场样本发现线索后交错展示，避免仅凭短时间内的高比率优先选人；没有设置额外分钟硬门槛。该顺序不是综合能力、战术适配或跨联赛实力排名。");
    }
  }
  if (state.forcedLimitReached) limitations.push("本轮调查达到安全步数上限，未完成的方向需要用户补充后再继续。");
  if (state.policyLoopStopped) limitations.push("Agent 连续重复提出被调查策略拒绝的相同动作，系统已停止重复调用模型；报告只保留当前可验证证据。");
  if (state.reviewResult === "exhausted") limitations.push("复查后移除了未通过证据核验的内容；名单仅保留通过检查的候选。");
  const unsearchedReportCount = eligibleEvaluatedPlayers
    .filter(({ player }) => !state.searchedReportPlayerNames.some((name) => normalizeSearchText(name) === normalizeSearchText(player.name)))
    .length;
  if (unsearchedReportCount > 0 && state.toolUses.search_player_reports >= toolBudgets.search_player_reports) {
    limitations.push(`本轮球员报告检索预算已用尽；${unsearchedReportCount} 名已评估候选未完成报告检索，相关观察仍需人工补查。`);
  }
  if (state.hasSearchedPlayerReports && !Object.values(state.retrievedKnowledge).some((document) => document.corpus === "player_report")) {
    limitations.push(state.playerReportSearchFailed
      ? "本轮球员报告检索发生错误；未能取得报告层面的定性观察。"
      : "本轮获准索引中没有检索到相关球员报告；报告层面的定性观察仍需人工补查。");
  }
  if (state.methodologySearchFailed) limitations.push("角色/方法资料索引检索发生错误；能力画像只由对话和比赛数据形成。 ".trim());
  return [...new Set(limitations)];
}

export function createReportProjection(input: {
  candidateComparisonEnabled?: boolean;
  referenceProfileEnabled?: boolean;
}) {
  return (state: State, runtime: Runtime<RecruitmentRuntimeContext>): Partial<State> => {
    const context = requireRecruitmentRuntimeContext(runtime.context);
    const { repository, evidenceEvaluator, candidateIdentityGrouper: groupCandidateRecords } = context;
    if (state.briefFailure) return { report: null, responseMessage: state.briefFailure };
    const action = state.action?.action === "finish" ? state.action : emptyDecision(state.targetTeam);
    const eligibleEvaluatedPlayers = evaluatedPlayersForConstraint(state);
    const candidateIdentityGroups = candidateIdentityGroupReferencesFor(state, groupCandidateRecords);
    const candidateIdentityCoverage = summarizeCandidateIdentityGroupReferences(candidateIdentityGroups);
    const identityGroupForPlayer = (playerId: string) => candidateIdentityGroups.find((group) => group.recordPlayerIds.includes(playerId));
    const discoveredForConstraint = discoveredPlayersForConstraint(state);
    const discoveredForConstraintIds = new Set(discoveredForConstraint.map(({ playerId }) => playerId));
    const evaluatedForConstraintById = new Map(Object.values(eligibleEvaluatedPlayers).map((candidate) => [candidate.player.playerId, candidate]));
    const selectedRecommendations = state.reportFollowupContext?.recommendations ?? action.recommendations;
    const requestedPosition = state.confirmedPositions.length > 1 ? null : resolvedCandidateSearchIntent(state).position;
    const allPositionLeadRecords = positionLeadRecords(state);
    const positionLeads = allPositionLeadRecords.slice(0, 12);
    const requestedEvidenceAreas = requestedCapabilityEvidenceAreasForInput({ brief: state.brief, userMessages: userMessages(state.history) }, requestedPosition, state.abilityProfilesEnabled);
    const backgroundOnly = !state.referenceProfiles.length && requestedEvidenceAreas.every(area => area.metricKeys.length === 0);
    const recommendedIds = new Set(selectedRecommendations.map(({ playerId }) => playerId));
    const adjacentPositionLeadItems = (repository.mode === "understat" || repository.mode === "mosaic") && (requestedPosition || state.confirmedPositions.length > 1)
      ? Object.values(eligibleEvaluatedPlayers)
        .filter(({ player, evidence }) => player.positionEvidence?.provider === "understat"
          && !hasAbilityPositionEvidence(player, player.positionEvidence.targetPosition)
          && (player.positionEvidence.targetPosition === requestedPosition || state.confirmedPositions.includes(player.positionEvidence.targetPosition as typeof state.confirmedPositions[number]))
          && player.positionEvidence.status === "compatible"
          && !recommendedIds.has(player.playerId))
        .slice(0, Math.max(0, 5 - selectedRecommendations.length))
        .map(({ player, evidence }) => ({
          playerId: player.playerId,
          evidenceKeys: requestedEvidenceAreas.flatMap(({ metricKeys }) => metricKeys)
            .filter((key) => evidence.some((item) => item.key === key)),
        }))
      : [];
    const reportRecommendationItems = [...selectedRecommendations, ...adjacentPositionLeadItems];
    const recommendations = reportRecommendationItems
      .filter((item) => Object.hasOwn(eligibleEvaluatedPlayers, item.playerId))
      .map((item) => {
        const evaluated = eligibleEvaluatedPlayers[item.playerId]!;
        const adjacentPositionLead = (repository.mode === "understat" || repository.mode === "mosaic")
          && evaluated.player.positionEvidence?.provider === "understat"
          && !hasAbilityPositionEvidence(evaluated.player, evaluated.player.positionEvidence.targetPosition)
          && (evaluated.player.positionEvidence.targetPosition === requestedPosition || state.confirmedPositions.includes(evaluated.player.positionEvidence.targetPosition as typeof state.confirmedPositions[number]))
          && evaluated.player.positionEvidence.status === "compatible";
        const identityGroup = identityGroupForPlayer(item.playerId);
        const sourceRecordIds = identityGroup?.recordPlayerIds ?? [item.playerId];
        const sourceEvidenceRecords = sourceRecordIds
          .filter((sourceRecordId) => sourceRecordId !== item.playerId && discoveredForConstraintIds.has(sourceRecordId))
          .flatMap((sourceRecordId) => {
            const sourcePlayer = state.discoveredPlayers[sourceRecordId];
            if (!sourcePlayer) return [];
            const sourceEvaluation = evaluatedForConstraintById.get(sourceRecordId);
            return [{
              sourceRecordId: sourcePlayer.sourceIdentity?.playerId ?? sourcePlayer.playerId,
              source: sourcePlayer.source,
              provider: sourcePlayer.sourceIdentity?.provider ?? sourcePlayer.source,
              team: sourcePlayer.team,
              competition: sourcePlayer.competition,
              season: sourcePlayer.season,
              retrievedAt: sourcePlayer.sourceIdentity?.retrievedAt ?? null,
              minutes: sourcePlayer.minutes,
              evaluated: Boolean(sourceEvaluation),
              ...(sourcePlayer.sourceUrl ? { sourceUrl: sourcePlayer.sourceUrl } : {}),
              evidence: sourceEvaluation?.evidence ?? [],
            }];
          });
        const focusEvidence = evaluated.evidence.filter((evidence) => item.evidenceKeys.includes(evidence.key)
          && (!backgroundOnly || (evaluated.player.position !== "GK" && evidence.value !== 0))).slice(0, backgroundOnly ? 3 : undefined);
        const tradeoffs = [
          ...(evaluated.player.positionEvidence?.status === "direct"
            && evaluated.player.positionEvidence.provider !== "understat"
            && evaluated.player.positionEvidence.sampleMinutes !== null
            && evaluated.player.positionEvidence.sampleMinutes < evaluated.player.minutes
            ? [`来源记录其在${positionLabels[evaluated.player.positionEvidence.targetPosition]}位置出场 ${evaluated.player.positionEvidence.sampleMinutes.toLocaleString()} 分钟；其他表现指标按来源整条记录统计，不保证只对应这个位置。`]
            : []),
          ...(adjacentPositionLead
            ? [`当前赛季只观察到相邻位置标签 ${evaluated.player.positionEvidence!.sourceCodes.join(" / ")}；此线索不计入${positionLabels[evaluated.player.positionEvidence!.targetPosition]}名单，也不参与同位置比较。`]
            : []),
          ...((evaluated.player.eventDataComplete !== false && evaluated.player.minutes < minimumMinutesForPercentileComparison)
            || evaluated.evidence.some((evidence) => evidence.basis !== "ability_profile" && evidence.minutes !== null
              && evidence.minutes < minimumMinutesForPercentileComparison)
            ? [`部分出场或指标样本少于 ${minimumMinutesForPercentileComparison} 分钟，每 90 分钟数据可能受小样本影响；对应指标不显示百分位。`]
            : []),
          ...(evaluated.evidence.some((evidence) => evidence.peerPercentileUnavailableReason === "insufficient_peer_group")
            ? [`部分指标达到 ${minimumMinutesForPercentileComparison} 分钟门槛的同位置、同赛事、同赛季比较组不足 5 人，无法显示百分位。`]
            : []),
          ...(evaluated.evidence.some((evidence) => evidence.peerPercentileUnavailableReason === "candidate_sample_unknown")
            ? ["部分指标的来源样本分钟未知，无法核实百分位比较门槛。"]
            : []),
          ...(evaluated.evidence.some((evidence) => evidence.peerPercentileUnavailableReason === "competition_scope_unreported")
            ? ["Understat 位置分组指标没有赛事维度；只保留该球员的观测值，不做同赛事比较。"]
            : []),
          ...requestedEvidenceAreas.flatMap((area) => evaluated.evidence.some((evidence) => area.metricKeys.includes(evidence.key))
            ? []
            : [`该候选缺少用户要求的“${area.name}”对应指标；当前依据不表示其已具备该项能力。`]),
          ...(repository.mode === "demo" ? ["虚构演示数据不能支持真实引援判断。"] : []),
          "事件统计不能替代完整比赛录像、角色背景和球探复核。",
        ];
        return {
          player: evaluated.player,
          ...(evaluated.referenceSimilarity ? { referenceSimilarity: evaluated.referenceSimilarity } : {}),
          ...(evaluated.roleFits ? { roleFits: evaluated.roleFits } : {}),
          ...(state.confirmedPositions.length ? { matchedPositions: state.confirmedPositions.filter((position) => evaluated.player.abilityProfile
            ? playerPositionMatches(evaluated.player, position)
            : evaluated.player.sourceIdentity?.provider === "understat"
              ? evaluated.player.positionEvidenceByPosition?.[position]?.status === "direct"
              : playerPositionMatches(evaluated.player, position)) } : {}),
          comparisonNotes: input.candidateComparisonEnabled === false || backgroundOnly || adjacentPositionLead ? [] : createCandidateComparison(Object.values(eligibleEvaluatedPlayers), item.evidenceKeys)
            .find(candidate => candidate.playerId === item.playerId)?.comparisons
            .filter(comparison => comparison.comparedCandidateCount > 0).slice(0, 3)
            .map(comparison => `${comparison.label} ${comparison.value} ${comparison.unit}；${comparison.key.startsWith("ability") ? "同版能力画像" : "本轮同来源、位置、赛事和赛季"} ${comparison.comparedCandidateCount + 1} 名已评估候选的观测范围为 ${comparison.observedMinimum}–${comparison.observedMaximum}。仅作有限样本比较，不是适配排名。`) ?? [],
          referenceComparisonNotes: input.referenceProfileEnabled === false || backgroundOnly || adjacentPositionLead ? [] : createReferenceComparisonNotes(evaluated, state.referenceProfiles, item.evidenceKeys),
          identityResolution: {
            status: identityGroup?.status ?? "missing_source_identity" as const,
            releaseStamp: identityGroup?.releaseStamp ?? null,
            sourceRecordCount: sourceRecordIds.length,
          },
          sourceEvidenceRecords,
          rationale: adjacentPositionLead
            ? `当前赛季只观察到相邻位置标签 ${evaluated.player.positionEvidence!.sourceCodes.join(" / ")}。${focusEvidence.map((evidence) => evidenceEvaluator.describe(evidence)).join(" ")}这些表现数据只作为相邻位置线索，不能证明符合指定位置。`
            : backgroundOnly
            ? `该记录的位置与出场样本可供继续考察；目标能力尚未核实。${focusEvidence.map(evidence => evidenceEvaluator.describe(evidence)).join(" ")}这些是背景统计，不能证明所需能力，不代表已验证适合转会。`
            : `本轮重点依据：${focusEvidence.map((evidence) => evidenceEvaluator.describe(evidence)).join(" ")}这表示建议继续研究，不代表已验证适合转会。`,
          strengths: focusEvidence.map((evidence) => evidenceEvaluator.describe(evidence)),
          tradeoffs,
          focusEvidenceKeys: focusEvidence.map(evidence => evidence.key),
          evidence: evaluated.evidence,
          externalSignals: state.externalSignals[item.playerId] ? [state.externalSignals[item.playerId]!] : [],
          historicalArchiveSamples: state.historicalArchiveSamplesByPlayerId[item.playerId] ?? [],
          ...(state.understatPlayerResearch[item.playerId] ? { understatResearch: state.understatPlayerResearch[item.playerId] } : {}),
          reportObservations: action.reportObservations.filter((observation) => observation.playerId === item.playerId
            && Object.hasOwn(eligibleEvaluatedPlayers, observation.playerId)).flatMap((observation) => {
              const document = Object.values(state.retrievedKnowledge).find((candidate) => candidate.documentId === observation.documentId);
              if (!document) return [];
              return [{
                summary: observation.summary,
                verificationStatus: observation.linkedMetricKeys.length ? "linked_to_match_data" as const : "unverified" as const,
                linkedMetricKeys: observation.linkedMetricKeys,
                source: {
                  sourceId: document.sourceId,
                  sourceName: document.sourceName,
                  title: document.title,
                  url: document.url,
                  author: document.author,
                  publisher: document.publisher,
                  publishedAt: document.publishedAt,
                  license: document.license,
                  attribution: document.attribution,
                },
              }];
            }),
        };
      });
    const recommendedPlayerIds = new Set(recommendations.map(({ player }) => player.playerId));
    const historicalArchiveCandidates = Object.entries(state.historicalArchiveSamplesByPlayerId).flatMap(([playerId, samples]) => {
      const evaluated = eligibleEvaluatedPlayers[playerId];
      if (!evaluated || recommendedPlayerIds.has(playerId) || samples.length === 0) return [];
      return [{ player: evaluated.player, samples }];
    });
    const retrievedDocuments = Object.values(state.retrievedKnowledge);
    const requestedCapabilityCoverage = summarizeRequestedCapabilityCoverage({
      brief: state.brief,
      userMessages: userMessages(state.history),
      evaluatedPlayers: Object.values(eligibleEvaluatedPlayers),
      candidateIdentityGroups,
    });
    const evaluatedIdentityKeys = new Set(Object.values(eligibleEvaluatedPlayers).map(({ player }) => (
      identityGroupForPlayer(player.playerId)?.identityKey ?? `source:${sourcePlayerKey(player)}`
    )));
    const lowSampleIdentityKeys = new Set(Object.values(eligibleEvaluatedPlayers).filter(hasLowSampleEvidence).map(({ player }) => (
      identityGroupForPlayer(player.playerId)?.identityKey ?? `source:${sourcePlayerKey(player)}`
    )));
    const limitedPeerGroupIdentityKeys = new Set(Object.values(eligibleEvaluatedPlayers).filter((candidate) => candidate.evidence.some(
      (evidence) => evidence.peerPercentileUnavailableReason === "insufficient_peer_group"
        || evidence.peerPercentileUnavailableReason === "competition_scope_unreported",
    )).map(({ player }) => identityGroupForPlayer(player.playerId)?.identityKey ?? `source:${sourcePlayerKey(player)}`));
    const searchScopes = [...new Map(state.candidateSearchObservations.map(({ reportScope }) => (
      [JSON.stringify(reportScope), reportScope] as const
    ))).values()];
    const report = RecruitmentReportSchema.parse({
      ...(state.confirmedPositions.length ? { requestedPositions: state.confirmedPositions, positionCoverage: state.confirmedPositions.map((position) => ({
        position, confirmedCandidates: Object.values(state.discoveredPlayers).filter((player) => candidateMatchesSearchIntentForPositionRetrieval(player, resolvedCandidateSearchIntent(state)) && (hasAbilityPositionEvidence(player, position) || (player.sourceIdentity?.provider === "understat" ? player.positionEvidenceByPosition?.[position]?.status === "direct" : playerPositionMatches(player, position)))).length,
        searched: state.candidateSearchObservations.slice(state.candidateSearchTurnStartIndex).some((observation) => observation.request.position === position || observation.request.positions?.includes(position)),
        hasMore: state.candidateSearchObservations.slice(state.candidateSearchTurnStartIndex).at(-1)?.nextOffset !== null && state.candidateSearchObservations.slice(state.candidateSearchTurnStartIndex).at(-1)?.nextOffset !== undefined,
      })) } : {}),
      targetTeam: action.targetTeam ?? state.targetTeam,
      needSummary: state.candidateSearchFailure && state.candidateSearchFailure.code !== "unsupported_scope" && !state.candidateSearchSucceededThisTurn
        ? `${repository.sourceName} 候选查询最近一次失败，当前无法确认匹配结果。`
        : requestedCapabilityCoverage.length > 0 && requestedCapabilityCoverage.every((area) => area.status === "missing") && recommendations.length > 0
          ? `${reportNeedSummary(action.needSummary, state.history, recommendations.length)} 当前名单仅为基于已有表现数据的待考察线索，用户要求的能力尚未核实。`
          : reportNeedSummary(action.needSummary, state.history, recommendations.length),
      capabilityProfile: action.capabilityProfile,
      referenceProfiles: input.referenceProfileEnabled === false ? [] : state.referenceProfiles.map(profile => {
        const rendered = reportReferenceProfile(profile);
        return backgroundOnly ? { ...rendered, metrics: [] } : rendered;
      }),
      referenceNameSource: state.referenceNameResolution?.status === "resolved"
        ? { entityId: state.referenceNameResolution.player.entityId, url: state.referenceNameResolution.player.sourceUrl,
          mention: state.referenceNameResolution.mention, resolvedName: state.referenceNameResolution.player.preferredName,
          resolutionMethod: state.referenceNameResolution.resolutionMethod,
          performanceRecordStatus: state.referenceProfiles.length ? "observed_in_available_data" : "not_observed_in_team_sample" }
        : null,
      requestedCapabilityCoverage: state.evidenceEvaluationWithheld ? [] : requestedCapabilityCoverage,
      searchScopes,
      evidenceCoverage: (() => {
        const evaluated = Object.values(eligibleEvaluatedPlayers);
        const reportedEvaluations = state.evidenceEvaluationWithheld ? [] : evaluated;
        return {
          evidenceAvailability: state.evidenceEvaluationWithheld ? "experimentally_withheld" : "available",
          evaluatedCandidateCount: state.evidenceEvaluationWithheld ? 0 : evaluatedIdentityKeys.size,
          evaluatedSourceRecordCount: reportedEvaluations.length,
          availableMetricValues: reportedEvaluations.reduce((total, item) => total + item.evidence.length, 0),
          expectedMetricValues: reportedEvaluations.reduce((sum, candidate) => sum + evidenceEvaluator.coverage(candidate).expectedMetricCount, 0),
          lowSampleCandidates: state.evidenceEvaluationWithheld ? 0 : lowSampleIdentityKeys.size,
          limitedPeerGroupCandidates: state.evidenceEvaluationWithheld ? 0 : limitedPeerGroupIdentityKeys.size,
        };
      })(),
      externalSignalCoverage: state.externalSignalCoverage,
      historicalArchiveCoverage: state.historicalArchiveCoverage,
      historicalArchiveCandidates,
      ...(state.understatTeamResearch ? { understatTeamResearch: state.understatTeamResearch } : {}),
      understatMatchResearch: Object.values(state.understatMatchResearch).slice(-3),
      candidateIdentityCoverage,
      knowledgeCoverage: {
        methodologyChunksRetrieved: retrievedDocuments.filter((document) => document.corpus === "methodology").length,
        methodologySearchFailed: state.methodologySearchFailed,
        methodologySources: collectMethodologySourceReferences(retrievedDocuments),
        playerReportSearchPerformed: state.hasSearchedPlayerReports,
        playerReportSearchFailed: state.playerReportSearchFailed,
        playerReportChunksRetrieved: retrievedDocuments.filter((document) => document.corpus === "player_report").length,
      },
      recommendations,
      positionLeads,
      positionLeadCount: allPositionLeadRecords.length,
      limitations: limitationsFor(state, repository, action, evidenceEvaluator),
      dataSource: repository.sourceName,
      datasetMode: repository.mode,
      datasetScope: state.datasetScope ?? describeDatasetScope(repository.mode),
    });
    const responseMessage = state.sourceAccessFailure
      ? `${repository.sourceName} 的数据请求被拒绝（${state.sourceAccessFailure.code === "blocked" ? "HTTP 403" : "HTTP 429"}）。本轮无法读取球员数据；这不代表没有符合条件的球员。`
      : state.candidateSearchFailure?.code === "unsupported_scope" && !state.candidateSearchSucceededThisTurn
        ? state.responseMessage || action.needSummary
      : state.candidateSearchFailure && !state.candidateSearchSucceededThisTurn
        ? `${repository.sourceName} 候选查询最近一次失败，当前无法确认是否有符合条件的球员；这不代表没有匹配球员。`
        : state.responseMessage || (recommendations.length
          ? "已完成一轮调查。名单顺序表示 Agent 建议优先继续考察的顺序，不是经过验证的综合能力排名。"
          : positionLeads.length > 0
            ? `发现 ${allPositionLeadRecords.length} 条${positionLabels[requestedPosition!]}所在位置大类的来源线索，但当前来源没有足够的细分位置证据形成名单。`
            : "已完成一轮调查，但当前证据不足以支持具体候选推荐。");
    return { report, responseMessage, pendingQuestion: null };
  };
}
