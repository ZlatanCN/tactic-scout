import { useEffect, useState } from "react";
import { buildEvidenceComparison, toggleComparedPlayer } from "./comparison";
import { MethodologyReferences } from "./MethodologyReferences";
import { shortDatasetId } from "./dataset-label";
import { formatDate } from "./format-date";
import type { CapabilityEvidence, DatasetStatus, PlayerEloSignal, Position, RecruitmentReport, TeamRosterContext } from "../../src/domain/schemas.js";
import { describeDatasetScope } from "../../src/domain/dataset-scope.js";
import { getPeerPercentileUnavailableReason, minimumMinutesForPercentileComparison } from "../../src/domain/evidence-comparison.js";
import { firstPartyObservationSourceId } from "../../src/knowledge/source-ids.js";

export type DatasetConnectionStatus = "connecting" | "connected" | "disconnected" | "unavailable";
export type RecruitmentReportPanelAction = "retry_dataset" | "open_observations";

/**
 * The parent owns case state and supplies either the initial data state or the
 * latest complete report. Report mode carries the prior report while waiting or
 * reanalyzing; the panel owns only presentation and comparison selection.
 */
export type RecruitmentReportPanelView =
  | { kind: "empty"; dataset: DatasetStatus | null; datasetLabel: string; connectionStatus: DatasetConnectionStatus }
  | { kind: "report"; report: RecruitmentReport; teamRosterContext: TeamRosterContext | null; reportedAt: string | null; status: "waiting" | "refreshing" | "complete"; snapshot: DatasetStatus["snapshot"] };

const positionLabels: Record<Position, string> = {
  GK: "门将", DEF: "后卫（细分位置不限）", CB: "中后卫", FB: "边后卫", LB: "左后卫", RB: "右后卫", LWB: "左翼卫", RWB: "右翼卫",
  MID: "中场（细分位置不限）", DM: "后腰", CM: "中前卫", AM: "前腰", ATT: "前锋（细分位置不限）",
  WG: "边锋", LW: "左边锋", RW: "右边锋", ST: "中锋",
};

function requestedCapabilityCoverageText(coverage: RecruitmentReport["requestedCapabilityCoverage"][number]): string {
  const metricNote = coverage.name === "进球产出"
    ? "进球数只表示产出，不单独证明射门技术或稳定性。"
    : "";
  if (coverage.evaluatedCandidateCount === 0) return "还没有完成候选表现评估。";
  if (coverage.requestedMetricKeys.length === 0) {
    return "当前指标体系没有直接测量项；报告不会拿相似统计代替。";
  }
  if (coverage.status === "missing") {
    return `当前已评估样本没有出现对应指标；这不代表球员不具备该能力。${metricNote}`;
  }
  if (coverage.status === "partial") {
    return `只有部分候选有对应指标；其余候选的这项能力仍未知。${metricNote}`;
  }
  return `所有当前已评估候选都有相关统计；这些仍是表现线索，不是完整能力结论。${metricNote}`;
}

function RequestedCapabilityCoverage({ report }: { report: RecruitmentReport }) {
  if (report.requestedCapabilityCoverage.length === 0) return null;
  const candidateUnit = report.datasetMode === "mosaic" ? "条来源记录" : "名候选";
  const statusLabel = (status: RecruitmentReport["requestedCapabilityCoverage"][number]["status"]) => (
    status === "observed" ? "有数据" : status === "partial" ? "部分覆盖" : "缺少数据"
  );
  return <section className="requested-capability-coverage" aria-label="用户要求能力的数据覆盖">
    <div className="requested-capability-heading"><span className="report-section-label">能力证据覆盖</span><small>按当前已评估样本</small></div>
    <ul className="requested-capability-list">{report.requestedCapabilityCoverage.map((coverage) => <li className={`requested-capability-item coverage-${coverage.status}`} key={coverage.name}>
      <div className="requested-capability-item-heading"><strong>{coverage.name}</strong><span className={`requested-capability-status status-${coverage.status}`}>{statusLabel(coverage.status)}</span></div>
      <p>{coverage.candidatesWithEvidenceCount} / {coverage.evaluatedCandidateCount} {candidateUnit}有对应统计</p>
      <small>{requestedCapabilityCoverageText(coverage)}</small>
    </li>)}</ul>
  </section>;
}

function EmptyReport({ dataset, datasetLabel, connectionStatus, onRetry }: { dataset: DatasetStatus | null; datasetLabel: string; connectionStatus: DatasetConnectionStatus; onRetry: () => void }) {
  return (
    <div className="empty-state report-empty-state">
      <div className="pitch-art" aria-hidden="true"><span className="pitch-circle" /><span className="pitch-dot" /><span className="pitch-line" /></div>
      <span className="section-kicker">02 / SCOUTING REPORT</span>
      <h2>先说说你要解决的<br /><em>阵容问题。</em></h2>
      <p>球探会围绕可观察的比赛表现建立能力画像，比较候选人的数据、样本和风险，不会用未经验证的总分替代判断。</p>
      <div className="empty-data-note"><span className="status-dot" />当前数据来源：{datasetLabel}</div>
      {dataset ? <DatasetScopeCard
        scope={describeDatasetScope(dataset.mode, undefined, dataset.snapshot)}
        showCoverageState={false}
        snapshot={dataset.snapshot}
      /> : <section className={`dataset-connection-card ${connectionStatus === "connecting" ? "dataset-connection-pending" : ""}`} aria-label="球探服务连接状态" role="status" aria-live="polite">
        <div className="dataset-connection-copy">
          <strong>{connectionStatus === "connecting" ? "正在读取数据范围" : connectionStatus === "disconnected" ? "无法连接球探服务" : "暂时无法读取数据范围"}</strong>
          <p>{connectionStatus === "connecting" ? "正在连接本地服务并确认可用的数据源。" : connectionStatus === "disconnected" ? "请确认本地球探服务已启动，再重试连接。" : "服务端暂时没有返回数据范围，请检查服务状态后重试。"}</p>
        </div>
        <button type="button" className="secondary-button dataset-retry-button" onClick={onRetry} disabled={connectionStatus === "connecting"}>{connectionStatus === "connecting" ? "连接中…" : "重试连接"}</button>
      </section>}
      <div className="empty-index"><span>INVESTIGATE</span><i /><span>COMPARE</span><i /><span>EXPLAIN</span></div>
    </div>
  );
}

function ReportContentView({ report, teamRosterContext, reportedAt, isWaiting, isRefreshing, snapshot, onOpenObservations }: { report: RecruitmentReport; teamRosterContext: TeamRosterContext | null; reportedAt: string | null; isWaiting: boolean; isRefreshing: boolean; snapshot: DatasetStatus["snapshot"]; onOpenObservations: () => void }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => setSelectedIds([]), [report]);
  const selectedRecommendations = report.recommendations.filter((item) => selectedIds.includes(item.player.playerId));
  const isMosaic = report.datasetMode === "mosaic";
  const showObservationNextStep = !isWaiting && !isRefreshing
    && report.recommendations.length === 0
    && report.evidenceCoverage.evaluatedCandidateCount > 0
    && report.requestedCapabilityCoverage.some((coverage) => (
      coverage.evaluatedCandidateCount > 0
      && coverage.candidatesWithEvidenceCount < coverage.evaluatedCandidateCount
    ));

  function toggleRecommendation(playerId: string) {
    setSelectedIds((current) => toggleComparedPlayer(current, playerId));
  }

  return (
    <div className="report-content">
      <div className="report-title-row">
        <div><span className="section-kicker">02 / SCOUTING REPORT</span><h2>{report.targetTeam || "球员招募"}<span className="heading-tail">候选评估</span></h2></div>
        <span className={`report-status ${isWaiting || isRefreshing ? "report-status-pending" : ""}`}>{isWaiting ? "补充信息中" : isRefreshing ? "正在重新分析" : "已完成一轮评估"}</span>
      </div>
      {isWaiting && <p className="snapshot-warning">正在等待补充信息。下方保留最近一次完整报告，后续调查完成后会更新。</p>}
      {isRefreshing && <p className="snapshot-warning">正在全新案件中重新搜索和评估候选人。下方仍是上次完整报告；新调查完成后才会替换。</p>}
      <section className="need-summary"><span className="report-section-label">需求理解</span><p>{report.needSummary}</p></section>
      {report.capabilityProfile.length > 0 && <section className="capability-profile"><span className="report-section-label">目标能力画像 · Agent 根据需求推导，可继续修正</span><ul>{report.capabilityProfile.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section>}
      <RequestedCapabilityCoverage report={report} />
      <div className="recommendation-heading"><div><span className="report-section-label">后续考察线索</span><p>顺序表示建议优先核实的线索，不是客观能力排名或转会结论；每项依据都来自可观察数据。</p></div><span className="results-count">{String(report.recommendations.length).padStart(2, "0")} <small>{isMosaic ? "条来源线索" : "球员"}</small></span></div>
      {report.recommendations.length ? <>
        <p className="compare-hint">选择 2–3 名球员，并排查看有数据支持的能力维度；缺失项会明确标出。</p>
        <CompareRecommendations recommendations={selectedRecommendations} onClear={() => setSelectedIds([])} />
        <div className="recommendation-list">{report.recommendations.map((recommendation, index) => <RecommendationCard key={recommendation.player.playerId} recommendation={recommendation} rank={index + 1} selected={selectedIds.includes(recommendation.player.playerId)} selectionDisabled={selectedIds.length >= 3 && !selectedIds.includes(recommendation.player.playerId)} onToggle={() => toggleRecommendation(recommendation.player.playerId)} />)}</div>
      </> : <>
        <div className="no-candidates"><span className="no-candidates-mark" aria-hidden="true">∅</span><div><strong>当前证据不足以推荐具体球员</strong><p>Agent 的结论和仍缺少的数据列在下方。你也可以继续补充需求。</p></div></div>
        {showObservationNextStep && <aside className="observation-next-step" aria-label="补充第一方比赛观察">
          <div><strong>如果你看过相关比赛，可以补充第一方观察</strong><p>记录具体比赛和观察情境，作为主观补充线索；它不会填补缺失的客观指标。只有在分别允许本地保存和 AI/RAG 处理后，后续调查才可能检索这条记录。</p></div>
          <button type="button" className="secondary-button observation-next-step-button" onClick={onOpenObservations}>记录第一方观察</button>
        </aside>}
      </>}
      <details className="report-evidence-details">
        <summary><span>数据与来源依据</span><small>数据范围 · 检索条件 · 指标覆盖 · 外部来源</small></summary>
        <div className="report-evidence-details-content">
          <DatasetScopeCard scope={report.datasetScope ?? describeDatasetScope(report.datasetMode)} showCoverageState snapshot={snapshot} showLimitations={false} />
          {report.searchScopes.length > 0 && <section className="search-scope"><span className="report-section-label">候选检索范围</span><p>以下是 Agent 实际使用的条件；可继续在对话中补充或纠正。</p><ul>{report.searchScopes.map((scope, index) => <li key={`${scope.source}-${index}`}><strong>{scope.source === "user_confirmed" ? "用户确认" : scope.source === "mixed" ? "包含用户确认条件" : "Agent 根据对话解释"}</strong>{" · "}{[
            scope.position ? `位置 ${positionLabels[scope.position]}` : null,
            scope.maxAge !== null ? `${scope.maxAge} 岁及以下` : null,
            scope.minimumMinutes > 0 ? `至少 ${scope.minimumMinutes} 分钟` : null,
            scope.competition ? `赛事 ${scope.competition}` : null,
            scope.season ? `赛季 ${scope.season}` : null,
          ].filter(Boolean).join(" · ") || "未设位置、年龄或赛事赛季限制"}</li>)}</ul></section>}
          <section className="evidence-coverage"><span className="report-section-label">证据覆盖</span>{report.evidenceCoverage.evidenceAvailability === "experimentally_withheld"
            ? <p>本次评测有意屏蔽表现评估器；指标和能力覆盖均未评估。这不代表数据缺失或球员能力为零。</p>
            : <><p>已评估 {report.evidenceCoverage.evaluatedCandidateCount} 个候选组 · {report.evidenceCoverage.evaluatedSourceRecordCount} 条来源记录 · 指标值 {report.evidenceCoverage.availableMetricValues} / {report.evidenceCoverage.expectedMetricValues} 项 · 小样本组 {report.evidenceCoverage.lowSampleCandidates} · 同组比较受限 {report.evidenceCoverage.limitedPeerGroupCandidates}</p><small>无法精确解析身份的来源记录仍各自计为一个候选组；这说明样本覆盖，不代表自然人数或推荐正确率。</small></>}</section>
          <section className="external-signal-coverage identity-resolution-coverage"><span className="report-section-label">候选身份核验 · Reep</span><p>{candidateIdentityCoverageText(report.candidateIdentityCoverage)}</p><small>Reep 只用于精确关联身份。来源表现记录、指标与评分仍分开保留；姓名相同不会触发合并。</small></section>
          <section className="external-signal-coverage"><span className="report-section-label">独立外部信号 · PlayerElo</span><p>{externalSignalCoverageText(report.externalSignalCoverage)}</p><small>仅作整体表现参考；不进入战术能力评分、候选排序或 Agent 结论。</small></section>
          <section className="external-signal-coverage historical-archive-coverage"><span className="report-section-label">跨来源历史表现样本 · Wyscout</span><p>{historicalArchiveCoverageText(report.historicalArchiveCoverage)}</p><small>只有 Reep 精确 ID 映射成功才会关联；2017/18 档案仅供纵向背景参考，不进入本轮能力评分、推荐排序或 Agent 结论。</small></section>
          {report.historicalArchiveCandidates.length > 0 && <HistoricalArchiveCandidateAppendix candidates={report.historicalArchiveCandidates} />}
          <section className="knowledge-coverage"><span className="report-section-label">资料检索</span><p>角色/方法片段 {report.knowledgeCoverage.methodologyChunksRetrieved} 条 · 可展示方法来源 {report.knowledgeCoverage.methodologySources.length} 个{report.knowledgeCoverage.methodologySearchFailed ? "（检索失败）" : ""} · 球员报告 {report.knowledgeCoverage.playerReportChunksRetrieved} 条{report.knowledgeCoverage.playerReportSearchFailed ? "（检索失败）" : report.knowledgeCoverage.playerReportSearchPerformed ? "（已在表现评估后检索）" : "（未检索）"}</p>
            {report.knowledgeCoverage.methodologyChunksRetrieved > 0 && report.knowledgeCoverage.methodologySources.length === 0 && <small>本轮检索到方法片段，但来源未获准在报告中展示。</small>}
            <MethodologyReferences sources={report.knowledgeCoverage.methodologySources} />
            <small>方法资料用于理解角色和评估方法，不是球员表现证据。球员报告只补充定性观察，不直接计入能力评分；关联比赛指标也不代表整条观察已证实。</small></section>
        </div>
      </details>
      {teamRosterContext && <TeamRosterContextPanel context={teamRosterContext} />}
      {report.limitations.length > 0 && <details className="caveats-panel" open><summary><span>数据范围与风险</span><span className="details-plus">+</span></summary><ul>{report.limitations.map((limitation, index) => <li key={`${limitation}-${index}`}>{limitation}</li>)}</ul></details>}
      <div className="report-source"><span><i className="status-dot" />{report.dataSource}</span>{reportedAt && <span>报告时间 {formatDate(reportedAt)}</span>}</div>
    </div>
  );
}

function TeamRosterContextPanel({ context }: { context: TeamRosterContext }) {
  if (context.status === "not_configured") return null;
  const statusLabel = context.status === "partial" ? "不完整样本"
      : context.status === "empty" ? "无核验名单记录"
        : context.status === "not_found" ? "未找到精确球队"
          : context.status === "ambiguous" ? "球队匹配不唯一"
            : context.failureKind === "cancelled" ? "已停止补充"
              : context.failureKind === "ephemeral_replay" ? "临时资料未重放" : "暂不可用";

  return <aside className={`team-roster-context team-roster-context-${context.status}`} aria-label="目标球队背景参考">
    <div className="team-roster-context-heading">
      <div><span className="report-section-label">球队背景参考 · TheSportsDB</span><strong>{context.team?.name ?? context.requestedTeam}</strong></div>
      <span className="team-roster-context-status">{statusLabel}</span>
    </div>
    <p className="team-roster-context-notice">{context.notice}</p>
    {context.matchedTeams.length > 1 && <ul className="team-roster-match-list" aria-label="精确匹配的同名球队">
      {context.matchedTeams.map((team) => <li key={team.id}><a href={team.url} target="_blank" rel="noreferrer">{team.name} · ID {team.id}</a></li>)}
    </ul>}
    {context.team && <div className="team-roster-context-data">
      <div className="team-roster-context-meta">
        <a href={context.team.url} target="_blank" rel="noreferrer">打开球队来源资料 ↗</a>
        {context.status !== "unavailable" && <span>{context.returnedCount} 条男足核验记录 / 最多显示 {context.resultLimit} 条{context.possiblyTruncated ? " · 可能截断" : ""}</span>}
      </div>
      {context.players.length > 0 && <details className="team-roster-player-details">
        <summary>查看 {context.players.length} 条球员记录</summary>
        <ul className="team-roster-player-list">
          {context.players.map((player) => <li key={player.id}>
            <a href={player.url} target="_blank" rel="noreferrer">{player.name}</a>
            <span>{player.position || "未提供位置"}</span>
          </li>)}
        </ul>
      </details>}
    </div>}
    <div className="team-roster-context-footer">
      <span>来源：<a href={context.sourceUrl} target="_blank" rel="noreferrer">TheSportsDB API 文档 ↗</a></span>
      {context.retrievedAt && <span>读取时间 {formatDate(context.retrievedAt)}</span>}
    </div>
    <small>这项背景资料独立于球探报告，不参与候选搜索、能力评估、排序或 Agent 结论。球员列表不能证明当前注册或可转会状态。</small>
  </aside>;
}

function HistoricalArchiveCandidateAppendix({ candidates }: { candidates: RecruitmentReport["historicalArchiveCandidates"] }) {
  return <section className="historical-archive-candidates">
    <span className="report-section-label">已评估候选的历史样本参考</span>
    <p>下列记录属于本轮已评估候选的 2017/18 历史比赛样本。它们不表示当前效力或当前能力，也不参与本轮评分、Agent 判断或推荐顺序。</p>
    <ul>{candidates.map(({ player, samples }) => <li key={player.playerId}>
      <strong>{player.name}</strong><span>当前候选来源：{player.team} · {player.competition} {player.season}</span>
      <details><summary>查看 {samples.length} 条 Wyscout 历史样本</summary><ul>{samples.map((sample) => <li key={`${sample.providerPlayerId}:${sample.competition}:${sample.season}:${sample.team}`}>
        <b>{sample.season} · {sample.competition} · {sample.team}</b><span>{sample.playerName} · {sample.minutes.toLocaleString()} 分钟</span>
        {sample.metrics.length > 0 && <div className="archive-metrics">{sample.metrics.map((metric) => <span key={metric.key}>{metric.label} <b>{formatMetric(metric.value)} {metric.unit}</b><small>{metric.definition}</small></span>)}</div>}
        <small>{sample.identityLink.sourceProvider}:{sample.identityLink.sourcePlayerId}{sample.identityLink.sourceBridge ? ` → ${sample.identityLink.sourceBridge.provider}/${sample.identityLink.sourceBridge.namespace}:${sample.identityLink.sourceBridge.externalId}${sample.identityLink.sourceBridge.sourceField ? ` (${sample.identityLink.sourceBridge.sourceField})` : ""}` : ""} → Reep:{sample.identityLink.reepId} → Wyscout:{sample.providerPlayerId} · release {sample.identityLink.reepReleaseStamp}</small>
        <small>{sample.attribution} · 许可：<a href={sample.licenseUrl} target="_blank" rel="noreferrer">{sample.license}</a></small>
        <a href={sample.sourceUrl} target="_blank" rel="noreferrer">打开论文与数据集出处</a>
      </li>)}</ul></details>
    </li>)}</ul>
  </section>;
}

function DatasetScopeCard({ scope, showCoverageState, snapshot, showLimitations = true }: { scope: RecruitmentReport["datasetScope"] | null; showCoverageState: boolean; snapshot?: DatasetStatus["snapshot"]; showLimitations?: boolean }) {
  if (!scope) {
    return <section className="dataset-scope-card dataset-scope-unavailable" aria-label="数据范围说明"><span className="report-section-label">数据范围</span><p>这份报告没有提供数据范围说明。</p></section>;
  }
  const matchingSnapshot = scope.datasetId === snapshot?.datasetId ? snapshot : undefined;
  return (
    <section className={`dataset-scope-card dataset-scope-${scope.kind}`} aria-label="数据范围说明">
      <div className="dataset-scope-heading"><span className="report-section-label">数据范围</span><strong>{scope.title}</strong></div>
      <p>{scope.summary}</p>
      {scope.datasetId && <p className="dataset-scope-observed">版本信息 <code className="dataset-version" aria-label={`完整数据集标识 ${scope.datasetId}`} title={scope.datasetId}>{shortDatasetId(scope.datasetId)}</code>{scope.datasetBuiltAt ? ` · 构建于 ${formatDate(scope.datasetBuiltAt)}` : ""}</p>}
      {scope.observedCoverage && <p className="dataset-scope-observed">本次读取 {scope.observedCoverage.playerRecordCount.toLocaleString()} 条球员记录 · 赛事 {scope.observedCoverage.competitions.map(datasetCompetitionLabel).join("、") || "未知"} · 赛季 {scope.observedCoverage.seasons.join("、") || "未知"}</p>}
      {matchingSnapshot && <details><summary>查看数据集完整覆盖</summary>
        <p>{matchingSnapshot.playerSeasonRecords.toLocaleString()} 条球员赛季记录 · {matchingSnapshot.uniquePlayers.toLocaleString()} 名不同球员 · {matchingSnapshot.teams.toLocaleString()} 支球队 · {matchingSnapshot.matches.toLocaleString()} 场比赛</p>
        <p>赛事：{matchingSnapshot.competitions.map(datasetCompetitionLabel).join("、")} · 赛季：{matchingSnapshot.seasons.join("、")}</p>
        <ul className="dataset-metric-coverage">{matchingSnapshot.metrics.map((metric) => <li key={metric.key}>{datasetMetricLabel(metric.key)}：{metric.availableRecords.toLocaleString()} / {metric.totalRecords.toLocaleString()} 条 · {Math.round(metric.coverageRatio * 100)}% 可用</li>)}</ul>
      </details>}
      {!scope.observedCoverage && showCoverageState && <p className="dataset-scope-observed">本次数据池覆盖范围未知；具体候选范围需依据已核实的赛事、赛季和球员来源确认。</p>}
      {!scope.observedCoverage && !showCoverageState && <p className="dataset-scope-observed">开始调查后，报告会记录本次实际读取到的赛事、赛季和球员记录数。</p>}
      {showLimitations && <details><summary>这份数据的限制</summary><ul>{scope.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></details>}
    </section>
  );
}

function datasetMetricLabel(key: string): string {
  const labels: Record<string, string> = {
    goals: "进球",
    assists: "助攻",
    keyPasses: "关键传球",
    passesAttempted: "传球尝试",
    passesCompleted: "成功传球",
    wyscoutAccurateProgressivePassesPct: "渐进传球成功率",
    wyscoutClearlyWonGroundDefensiveDuelPct: "明确胜出地面防守对抗占比",
    wyscoutGroundDefensiveDuelsPer90: "地面防守对抗 / 90 分钟",
    wyscoutProgressivePassesPer90: "渐进传球 / 90 分钟",
  };
  return labels[key] ?? key;
}

function datasetCompetitionLabel(name: string): string {
  const labels: Record<string, string> = {
    "English first division": "英超",
    "French first division": "法甲",
    "German first division": "德甲",
    "Italian first division": "意甲",
    "Spanish first division": "西甲",
  };
  return labels[name] ?? name;
}

function CompareRecommendations({ recommendations, onClear }: { recommendations: RecruitmentReport["recommendations"]; onClear: () => void }) {
  if (recommendations.length < 2) {
    return <div className="compare-empty"><span>球员比较</span><p>从推荐名单中选中至少两名候选人；最多可比较三人。</p></div>;
  }
  const metricRows = buildEvidenceComparison(recommendations);
  return (
    <section className="compare-panel" aria-label="推荐球员比较">
      <div className="compare-heading"><div><span className="section-kicker">SIDE BY SIDE</span><h3>能力证据比较</h3></div><button type="button" className="text-button" onClick={onClear}>清除选择</button></div>
      <div className="compare-table-wrap"><table className="compare-table"><thead><tr><th>比较维度</th>{recommendations.map((item) => <th key={item.player.playerId}>{item.player.name}</th>)}</tr></thead><tbody>
        <tr><th scope="row">出场样本</th>{recommendations.map((item) => <td key={item.player.playerId}>{item.player.minutes.toLocaleString()} 分钟</td>)}</tr>
        <tr><th scope="row">赛事 / 赛季</th>{recommendations.map((item) => <td key={item.player.playerId}>{item.player.competition} · {item.player.season}</td>)}</tr>
        <tr><th scope="row">数据来源</th>{recommendations.map((item) => <td key={item.player.playerId}>{item.player.source}</td>)}</tr>
        <tr><th scope="row">样本与数据风险</th>{recommendations.map((item) => <td key={item.player.playerId}>{item.tradeoffs.join("；") || "暂无额外风险提示"}</td>)}</tr>
        {metricRows.map((metric) => <tr key={metric.key}><th scope="row">{metric.label}</th>{recommendations.map((item, index) => {
          const evidence = metric.values[index];
          const comparison = peerComparisonLabel(evidence);
          return <td key={item.player.playerId}>{evidence ? <>{formatMetric(evidence.value)} {evidence.unit}<small className="comparison-cell-detail">{comparison}</small></> : "无数据"}</td>;
        })}</tr>)}
      </tbody></table></div>
    </section>
  );
}

function RecommendationCard({ recommendation, rank, selected, selectionDisabled, onToggle }: {
  recommendation: RecruitmentReport["recommendations"][number];
  rank: number;
  selected: boolean;
  selectionDisabled: boolean;
  onToggle: () => void;
}) {
  const { player } = recommendation;
  const focusEvidence = recommendation.evidence.filter((evidence) => recommendation.focusEvidenceKeys.includes(evidence.key));
  const staleFocusPercentile = focusEvidence.some((evidence) => evidence.peerPercentile !== null
    && getPeerPercentileUnavailableReason({
      minutes: evidence.minutes,
      recordedReason: evidence.peerPercentileUnavailableReason,
    }) !== undefined);
  const evidenceSummary = (evidence: CapabilityEvidence) => (
    `${evidence.label} ${formatMetric(evidence.value)} ${evidence.unit}；${peerComparisonLabel(evidence)}。`
  );
  const rationale = staleFocusPercentile
    ? `本轮重点依据：${focusEvidence.map(evidenceSummary).join(" ")}这表示建议继续研究，不代表已验证适合转会。`
    : recommendation.rationale;
  const strengths = staleFocusPercentile ? focusEvidence.map(evidenceSummary) : recommendation.strengths;
  return (
    <article className="recommendation-card">
      <div className="recommendation-card-heading"><span className="candidate-rank">{String(rank).padStart(2, "0")}</span><div className="candidate-title"><h3>{player.name}</h3><span>{player.team} <i>·</i> {player.competition} {player.season}</span></div></div>
      <div className="candidate-meta"><span>{player.position}</span><span>{player.age === null ? "年龄未知" : `${player.age} 岁`}</span><span>{player.minutes.toLocaleString()} 分钟</span></div>
      <p className="player-provenance">数据来源：{player.source}{player.sourceIdentity?.retrievedAt ? ` · 抓取于 ${formatDate(player.sourceIdentity.retrievedAt)}` : ""}{player.sourceUrl && <> · <a href={player.sourceUrl} target="_blank" rel="noreferrer">查看来源页</a></>}</p>
      {recommendation.identityResolution && <p className="player-provenance identity-resolution-note">{candidateIdentityStatusText(recommendation.identityResolution.status, recommendation.identityResolution.releaseStamp, recommendation.identityResolution.sourceRecordCount)}</p>}
      <label className="compare-select"><input type="checkbox" checked={selected} disabled={selectionDisabled} onChange={onToggle} /><span>加入比较</span></label>
      <p className="recommendation-rationale">{rationale}</p>
      <div className="evidence-columns">
        <div><strong className="evidence-label">重点引用的数据</strong>{strengths.length ? <ul>{strengths.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p>未单独标注</p>}</div>
        <div className="risk-column"><strong className="evidence-label">取舍与待核实</strong>{recommendation.tradeoffs.length ? <ul>{recommendation.tradeoffs.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p>未单独标注</p>}</div>
      </div>
      {recommendation.sourceEvidenceRecords.length > 0 && <section className="identity-linked-evidence"><strong className="evidence-label">同一身份的其他来源记录</strong><p>以下记录通过精确身份映射关联。每条记录单独列出，未将不同来源的指标合并评分。</p><ul>{recommendation.sourceEvidenceRecords.map((record) => <li key={`${record.sourceRecordId}:${record.competition}:${record.season}`}>
        <b>{record.source} · {record.team}</b><span>{record.competition} {record.season} · {record.minutes.toLocaleString()} 分钟 · ID {record.sourceRecordId}</span>
        <small>{record.evaluated ? `来源抓取于 ${record.retrievedAt ? formatDate(record.retrievedAt) : "时间未知"}` : "本轮未单独评估此来源记录"}{record.sourceUrl && <> · <a href={record.sourceUrl} target="_blank" rel="noreferrer">查看来源</a></>}</small>
        {record.evidence.length > 0 && <ul>{record.evidence.map((evidence) => <li key={evidence.key}>{evidence.label} {formatMetric(evidence.value)} {evidence.unit} · {sourceSampleLabel(evidence)}{evidence.sourceField ? ` · ${evidence.sourceField}` : ""}</li>)}</ul>}
      </li>)}</ul></section>}
      {recommendation.externalSignals.map((signal) => <section className="external-player-signal" key={`${signal.provider}-${signal.providerPlayerId}`}>
        <strong className="evidence-label">独立表现参考 · PlayerElo</strong>
        <p><b>Elo {formatMetric(signal.elo)}</b>{signal.earLabel ? ` · ${signal.earLabel}` : ""}</p>
        <small>{[signal.currentTeam ? `来源当前球队：${signal.currentTeam}` : null, signal.currentLeague ? `联赛：${signal.currentLeague}` : null, signal.position ? `位置：${signal.position}` : null].filter(Boolean).join(" · ") || "来源未提供球队或位置"}</small>
        <small>{playerEloIdentityText(signal)} 更新于 {formatDate(signal.retrievedAt)}。</small>
        <a href="https://playerelo.football/" target="_blank" rel="noreferrer">PlayerElo · 模型说明与来源</a>
      </section>)}
      {recommendation.historicalArchiveSamples.length > 0 && <section className="historical-archive-samples">
        <strong className="evidence-label">历史表现样本 · Wyscout Open Data</strong>
        <p>以下是 Reep release {recommendation.historicalArchiveSamples[0]!.identityLink.reepReleaseStamp} 按来源球员 ID 精确关联到的历史记录。该数据代表对应旧赛季，不表示当前效力或当前能力。</p>
        <ul>{recommendation.historicalArchiveSamples.map((sample) => <li key={`${sample.providerPlayerId}:${sample.competition}:${sample.season}:${sample.team}`}>
          <b>{sample.season} · {sample.competition}</b><span>{sample.team} · {sample.minutes.toLocaleString()} 分钟</span>
          {sample.metrics.length > 0 && <div className="archive-metrics">{sample.metrics.map((metric) => <span key={metric.key}>{metric.label} <b>{formatMetric(metric.value)} {metric.unit}</b><small>{metric.definition}</small></span>)}</div>}
          <small>{sample.identityLink.sourceProvider}:{sample.identityLink.sourcePlayerId}{sample.identityLink.sourceBridge ? ` → ${sample.identityLink.sourceBridge.provider}/${sample.identityLink.sourceBridge.namespace}:${sample.identityLink.sourceBridge.externalId}${sample.identityLink.sourceBridge.sourceField ? ` (${sample.identityLink.sourceBridge.sourceField})` : ""}` : ""} → Reep:{sample.identityLink.reepId} → Wyscout:{sample.providerPlayerId} · Reep rung {sample.identityLink.sourceRung ?? "未提供"} → {sample.identityLink.archiveRung ?? "未提供"}</small>
          <small>映射状态 {sample.identityLink.sourceUpstreamStatus ?? "未提供"} → {sample.identityLink.archiveUpstreamStatus ?? "未提供"} · release {sample.identityLink.reepReleaseStamp}</small>
          <small>{sample.attribution}</small>
          <small>许可：<a href={sample.licenseUrl} target="_blank" rel="noreferrer">{sample.license}</a></small>
          <a href={sample.sourceUrl} target="_blank" rel="noreferrer">打开论文与数据集出处</a>
        </li>)}</ul>
      </section>}
      {recommendation.evidence.length > 0 && <div className="evidence-table-wrap"><table className="evidence-table"><thead><tr><th>可观测指标</th><th>数值</th><th>对比组</th><th>来源样本</th></tr></thead><tbody>{recommendation.evidence.map((evidence) => <tr key={evidence.key}><th scope="row">{evidence.label}{recommendation.focusEvidenceKeys.includes(evidence.key) && <small className="focus-evidence-tag">本轮重点</small>}{evidence.definition && <small className="evidence-description">{evidence.definition}</small>}</th><td>{formatMetric(evidence.value)} {evidence.unit}</td><td>{peerComparisonLabel(evidence)}</td><td>{sourceSampleLabel(evidence)}{evidence.sampleAttempts !== undefined && <small>{evidence.sampleAttempts} {evidence.sampleAttemptsLabel ?? "次非点球射门"}</small>}{evidence.sourceField && <small>{evidence.sourceField}</small>}</td></tr>)}</tbody></table></div>}
      {recommendation.reportObservations.length > 0 && <section className="report-observations"><strong className="evidence-label">球员定性观察</strong><ul>{recommendation.reportObservations.map((observation, index) => {
        const firstParty = observation.source.sourceId === firstPartyObservationSourceId;
        const internalObservationUrl = firstParty && new URL(observation.source.url).hostname === "tactiscout.local";
        return <li key={`${observation.source.sourceId}-${index}`}>
          <p>{observation.summary}</p>
          <small>{observation.verificationStatus === "linked_to_match_data" ? `关联比赛数据：${observation.linkedMetricKeys.join("、")}；需人工核实完整语义。` : "当前比赛数据未核实，作为单一来源的定性观点。"}</small>
          {firstParty && <small className="observation-origin">TactiScout 自录观察 · 作者观点，未经独立核实</small>}
          {internalObservationUrl
            ? <small>没有提供外部参考链接；此观察只保存在本机。</small>
            : <a href={observation.source.url} target="_blank" rel="noreferrer">{firstParty ? "打开观察者提供的参考链接" : `${observation.source.title} · ${observation.source.author} · ${observation.source.license}`}</a>}
          <small>{observation.source.attribution}</small>
        </li>;
      })}</ul></section>}
    </article>
  );
}

function formatMetric(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  const formatted = Math.abs(value) < 0.1 ? value.toFixed(4) : value.toFixed(2);
  return formatted.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, ".00");
}

function peerComparisonLabel(evidence: CapabilityEvidence | undefined): string {
  if (!evidence) return "无数据";
  const unavailableReason = getPeerPercentileUnavailableReason({
    minutes: evidence.minutes,
    recordedReason: evidence.peerPercentileUnavailableReason,
  });
  if (unavailableReason === "candidate_sample_unknown") {
    return "指标样本分钟未知，未显示百分位";
  }
  if (unavailableReason === "candidate_low_sample") {
    return evidence.minutes === null
      ? "指标样本分钟未知，未显示百分位"
      : `候选样本 ${Math.round(evidence.minutes)} 分钟，低于 ${minimumMinutesForPercentileComparison} 分钟比较门槛`;
  }
  if (unavailableReason === "insufficient_peer_group") {
    return `达标同组 ${evidence.peerGroupSize} 人，不足 5 人`;
  }
  return evidence.peerPercentile === null
    ? `同组 ${evidence.peerGroupSize} 人，未显示百分位`
    : `同组第 ${evidence.peerPercentile} 百分位 · ${evidence.peerGroupSize} 人`;
}

function sourceSampleLabel(evidence: CapabilityEvidence): string {
  if (evidence.sampleMatches === undefined) return evidence.minutes === null ? "样本分钟未知" : "—";
  const minutes = evidence.minutes === null ? "分钟未知" : `${Math.round(evidence.minutes)} 分钟`;
  return `${evidence.sampleMatches} 场 · ${minutes}`;
}

function candidateIdentityStatusText(
  status: NonNullable<RecruitmentReport["recommendations"][number]["identityResolution"]>["status"],
  releaseStamp: string | null,
  sourceRecordCount: number,
): string {
  if (status === "resolved") return `Reep ${releaseStamp ?? "release 未知"} 已按精确 ID 核验身份；该候选关联 ${sourceRecordCount} 条来源记录。`;
  const labels = {
    not_run: "历史快照未执行身份核验",
    ambiguous: "映射有歧义",
    not_found: "没有精确映射",
    de_corroborated: "身份映射已撤销",
    withheld: "身份记录受限",
    target_not_published: "目标身份未发布",
    unsupported_provider: "来源不受当前身份索引支持",
    registry_unavailable: "本机身份索引不可用",
    missing_source_identity: "来源未提供稳定球员 ID",
  } satisfies Record<Exclude<NonNullable<RecruitmentReport["recommendations"][number]["identityResolution"]>["status"], "resolved">, string>;
  return `${labels[status]}；本条按独立来源记录保留，未按姓名合并。`;
}

function candidateIdentityCoverageText(coverage: RecruitmentReport["candidateIdentityCoverage"]): string {
  if (coverage.sourceRecordCount === 0) return "本轮没有候选来源记录可核验。";
  if (!coverage.registryAvailable) {
    const notRun = coverage.resolutionStatusCounts.find(({ status }) => status === "not_run")?.count ?? 0;
    const missingSourceIds = coverage.resolutionStatusCounts.find(({ status }) => status === "missing_source_identity")?.count ?? 0;
    const unavailableIds = coverage.resolutionStatusCounts.find(({ status }) => status === "registry_unavailable")?.count ?? 0;
    const details = [
      notRun ? `${notRun} 组历史记录未执行身份核验` : null,
      missingSourceIds ? `${missingSourceIds} 组来源记录未提供稳定球员 ID` : null,
      unavailableIds ? `${unavailableIds} 条来源 ID 未能读取 Reep 索引` : null,
    ].filter(Boolean).join("；");
    return `本轮读取 ${coverage.sourceRecordCount} 条来源记录；${details || "身份索引不可用"}，所有记录均保持独立。`;
  }
  const statuses = coverage.resolutionStatusCounts
    .filter(({ status }) => status !== "resolved")
    .map(({ status, count }) => `${count} 组${candidateIdentityStatusText(status, null, 1).split("；")[0]}`)
    .join("、");
  return `Reep ${coverage.releaseStamp ?? "release 未确认"} 将 ${coverage.resolvedSourceRecordCount} 条来源记录归为 ${coverage.resolvedIdentityCount} 个精确身份组；${coverage.unresolvedSourceRecordCount} 条记录未解析并保持独立${statuses ? `（${statuses}）` : ""}。`;
}

function externalSignalCoverageText(coverage: RecruitmentReport["externalSignalCoverage"]): string {
  if (coverage.status === "disabled") {
    return coverage.disabledReason === "api_key_missing"
      ? "未配置服务端 API key，当前未查询。"
      : coverage.disabledReason === "report_display_not_allowed"
        ? "尚未开启报告展示许可，当前未查询。"
        : "尚未开启本机案件与报告快照保留许可，当前未查询。";
  }
  if (coverage.status === "not_run") return "本轮未查询；配置并获准展示后，只会在证据审查通过后核对最终推荐对象。";
  const identityMethods = coverage.directIdentityCandidates + coverage.crosswalkIdentityCandidates > 0
    ? `（来源 ID 直连 ${coverage.directIdentityCandidates} 人，Reep 桥接 ${coverage.crosswalkIdentityCandidates} 人）`
    : "";
  const summary = `${coverage.checkedCandidates} 人可安全精确关联${identityMethods}，已匹配 ${coverage.matchedCandidates} 人；另有 ${coverage.identityUnavailableCandidates} 人无法安全关联`;
  if (coverage.status === "complete") return `${summary}；查询完整。未匹配项不会按零分处理。`;
  if (coverage.status === "partial") return `${summary}；${coverage.failedCandidates} 人查询失败。未匹配项不会按零分处理。`;
  return `${summary}；外部查询失败，未匹配项不会按零分处理。`;
}

function playerEloIdentityText(signal: PlayerEloSignal): string {
  const crosswalk = signal.identityCrosswalk;
  if (signal.identityMatch === "reep_crosswalk" && !crosswalk) {
    return "身份映射出处不完整，无法说明该 PlayerElo 数据对应的来源球员。";
  }
  if (signal.identityMatch === "reep_crosswalk" && crosswalk) {
    const rungDetails = [
      crosswalk.sourceRungs.length ? `来源 rung：${crosswalk.sourceRungs.join("、")}` : null,
      crosswalk.apiFootballRungs.length ? `API-Football rung：${crosswalk.apiFootballRungs.join("、")}` : null,
    ].filter(Boolean).join("；");
    return `经 Reep ${crosswalk.releaseStamp} 桥接：${signal.identitySourceProvider} ID ${signal.identitySourcePlayerId} → ${crosswalk.canonicalId} → API-Football / PlayerElo ID ${signal.providerPlayerId}${rungDetails ? `（${rungDetails}）` : ""}。`;
  }
  return `来源 ${signal.identitySourceProvider} ID ${signal.identitySourcePlayerId} 与 PlayerElo ID ${signal.providerPlayerId} 完全一致。`;
}

function historicalArchiveCoverageText(coverage: RecruitmentReport["historicalArchiveCoverage"]): string {
  if (coverage.status === "disabled") {
    switch (coverage.disabledReason) {
      case "report_display_not_allowed": return "未开启 Wyscout 历史档案的报告展示许可，当前未读取。";
      case "local_retention_not_allowed": return "未开启本机案件与报告快照保留许可，当前未读取。";
      case "reep_index_missing": return "本机未找到 Reep 身份索引；手动导入官方 release 后才能进行精确跨源关联。";
      case "wyscout_archive_missing": return "本机没有可读取的 Wyscout 历史档案文件。";
      case "primary_source_is_archive": return "当前候选本身来自 Wyscout 历史档案；不重复附加同一来源记录。";
      default: return "历史档案当前未启用。";
    }
  }
  if (coverage.status === "not_run") return "本轮未查询；历史样本仅在结论通过证据审查后查询。";
  const summary = `核对 ${coverage.checkedCandidates} 名候选，Reep 映射到 Wyscout ${coverage.mappedCandidates} 人，找到历史样本 ${coverage.matchedCandidates} 人`;
  if (coverage.status === "complete") return `${summary}。`;
  if (coverage.status === "partial") return `${summary}；来源 ID 未映射或本机档案未覆盖的候选会保持缺失。`;
  return `${summary}；本机档案读取失败，未将历史值当作零。`;
}


export function RecruitmentReportPanel({ view, onAction }: {
  view: RecruitmentReportPanelView;
  onAction: (action: RecruitmentReportPanelAction) => void;
}) {
  if (view.kind === "empty") {
    return <EmptyReport
      dataset={view.dataset}
      datasetLabel={view.datasetLabel}
      connectionStatus={view.connectionStatus}
      onRetry={() => onAction("retry_dataset")}
    />;
  }
  return <ReportContentView
    report={view.report}
    teamRosterContext={view.teamRosterContext}
    reportedAt={view.reportedAt}
    isWaiting={view.status === "waiting"}
    isRefreshing={view.status === "refreshing"}
    snapshot={view.snapshot}
    onOpenObservations={() => onAction("open_observations")}
  />;
}
