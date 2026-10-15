import { useEffect, useState, type ReactNode } from "react";
import { buildEvidenceComparison, toggleComparedPlayer } from "./comparison";
import { MethodologyReferences } from "./MethodologyReferences";
import { shortDatasetId } from "./dataset-label";
import { formatDate } from "./format-date";
import type { CapabilityEvidence, DatasetStatus, PlayerEloSignal, Position, RecruitmentReport, TeamRosterContext } from "../../src/domain/schemas.js";
import { describeDatasetScope } from "../../src/domain/dataset-scope.js";
import { getPeerPercentileUnavailableReason, minimumMinutesForPercentileComparison } from "../../src/domain/evidence-comparison.js";
import { firstPartyObservationSourceId } from "../../src/knowledge/source-ids.js";
import { createRecommendationPresentation, describeEmptyShortlist } from "./report-presentation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CircleHelp, Database, RefreshCw } from "lucide-react";

export type DatasetConnectionStatus = "connecting" | "connected" | "disconnected" | "unavailable";
export type RecruitmentReportPanelAction = "retry_dataset" | "open_observations";

/**
 * The parent owns case state and supplies either the initial data state or the
 * latest complete report. Report mode carries the prior report while waiting or
 * reanalyzing; the panel owns only presentation and comparison selection.
 */
export type RecruitmentReportPanelView =
  | { kind: "empty"; dataset: DatasetStatus | null; datasetLabel: string; connectionStatus: DatasetConnectionStatus; caseStatus?: "ready" | "researching" | "waiting" | "unfinished" }
  | { kind: "report"; report: RecruitmentReport; teamRosterContext: TeamRosterContext | null; reportedAt: string | null; status: "waiting" | "refreshing" | "updating" | "complete"; snapshot: DatasetStatus["snapshot"] };

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
  return <section aria-label="用户要求能力的数据覆盖" className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="m-0 text-sm font-semibold">能力证据覆盖</h3><span className="text-xs text-muted-foreground">按当前已评估样本</span></div>
    <ul className="grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">{report.requestedCapabilityCoverage.map((coverage) => <li className="min-w-0 rounded-lg border bg-card p-3" key={coverage.name}>
      <div className="flex items-start justify-between gap-2"><strong className="text-sm">{coverage.name}</strong><Badge variant={coverage.status === "observed" ? "secondary" : coverage.status === "partial" ? "outline" : "destructive"} className="shrink-0">{statusLabel(coverage.status)}</Badge></div>
      <p className="mb-0 mt-2 text-xs font-medium tabular-nums">{coverage.candidatesWithEvidenceCount} / {coverage.evaluatedCandidateCount} {candidateUnit}有对应统计</p>
      <p className="mb-0 mt-1 text-xs leading-5 text-muted-foreground">{requestedCapabilityCoverageText(coverage)}</p>
    </li>)}</ul>
  </section>;
}

function EmptyReport({ dataset, datasetLabel, connectionStatus, caseStatus = "ready", onRetry }: { dataset: DatasetStatus | null; datasetLabel: string; connectionStatus: DatasetConnectionStatus; caseStatus?: "ready" | "researching" | "waiting" | "unfinished"; onRetry: () => void }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3 p-5 sm:p-6">
        <span className="grid size-10 place-items-center rounded-full bg-secondary text-primary"><CircleHelp aria-hidden="true" /></span>
        <div><Badge variant="secondary">球探报告</Badge>
          <CardTitle className="mt-3 text-xl sm:text-2xl">{caseStatus === "researching" ? "正在调查你的招募需求" : caseStatus === "waiting" ? "补充需求后继续调查" : caseStatus === "unfinished" ? "本轮尚未生成报告" : "先说说你要解决的阵容问题"}</CardTitle>
          <p className="mb-0 mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{caseStatus === "researching" ? "调查已开始。在“球探对话”中查看进展或停止调查；完成后，这里会显示报告。" : caseStatus === "waiting" ? "在“球探对话”中回答问题，继续搜索和比较候选人。" : caseStatus === "unfinished" ? "回到“球探对话”查看提示，补充或修改需求后继续调查。" : "球探会围绕可观察的比赛表现建立能力画像，比较候选人的数据、样本和风险，不会用未经验证的总分替代判断。"}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-5 pb-5 sm:px-6 sm:pb-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Database className="size-4" aria-hidden="true" />当前数据来源：{datasetLabel}</div>
      {dataset ? <DatasetScopeCard
        scope={describeDatasetScope(dataset.mode, undefined, dataset.snapshot)}
        showCoverageState={false}
        snapshot={dataset.snapshot}
      /> : <Alert className="items-center" aria-live="polite">
        <Database aria-hidden="true" />
        <div className="min-w-0"><AlertTitle>{connectionStatus === "connecting" ? "正在读取数据范围" : connectionStatus === "disconnected" ? "无法连接球探服务" : "暂时无法读取数据范围"}</AlertTitle>
          <AlertDescription>{connectionStatus === "connecting" ? "正在连接本地服务并确认可用的数据源。" : connectionStatus === "disconnected" ? "请确认本地球探服务已启动，再重试连接。" : "服务端暂时没有返回数据范围，请检查服务状态后重试。"}</AlertDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={connectionStatus === "connecting"}><RefreshCw aria-hidden="true" />{connectionStatus === "connecting" ? "连接中…" : "重试连接"}</Button>
      </Alert>}
      </CardContent>
    </Card>
  );
}

function ReportContentView({ report, teamRosterContext, reportedAt, isWaiting, isRefreshing, isUpdating, snapshot, onOpenObservations }: { report: RecruitmentReport; teamRosterContext: TeamRosterContext | null; reportedAt: string | null; isWaiting: boolean; isRefreshing: boolean; isUpdating: boolean; snapshot: DatasetStatus["snapshot"]; onOpenObservations: () => void }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => setSelectedIds([]), [report]);
  const presentation = createRecommendationPresentation(report.recommendations);
  const emptyShortlist = describeEmptyShortlist(report.searchScopes.length);
  const evidenceBackedRecommendations = presentation.recommendations.filter((item) => item.hasFocusEvidence);
  const backgroundRecommendations = presentation.recommendations.filter((item) => !item.hasFocusEvidence);
  const selectedRecommendations = evidenceBackedRecommendations
    .map((item) => item.recommendation)
    .filter((item) => selectedIds.includes(item.player.playerId));
  const hasFocusEvidence = presentation.focusEvidenceCount > 0;
  const backgroundOnly = report.recommendations.length > 0 && !hasFocusEvidence;
  const comparisonAvailable = hasFocusEvidence;
  const referenceName = report.referenceProfiles[0]?.name;
  const backgroundPosition = report.recommendations[0]
    ? positionLabels[report.recommendations[0].player.position]
    : null;
  const unverifiedCapabilities = report.requestedCapabilityCoverage
    .filter((area) => area.status === "missing" || area.status === "partial")
    .map((area) => area.name);
  const missingCapabilityDescription = backgroundPosition === "门将" && unverifiedCapabilities.includes("门将专项能力")
    ? "扑救、出击或出球等门将专项表现数据"
    : `${unverifiedCapabilities.join("、") || "目标能力"}相关的表现统计`;
  const showObservationNextStep = !isWaiting && !isRefreshing && !isUpdating
    && (report.recommendations.length === 0 || backgroundOnly)
    && report.evidenceCoverage.evaluatedCandidateCount > 0
    && report.requestedCapabilityCoverage.some((coverage) => (
      coverage.evaluatedCandidateCount > 0
      && coverage.candidatesWithEvidenceCount < coverage.evaluatedCandidateCount
    ));

  function toggleRecommendation(playerId: string) {
    setSelectedIds((current) => toggleComparedPlayer(current, playerId));
  }

  const reportBusy = isWaiting || isRefreshing || isUpdating;
  const detailClass = "group border-b border-border";
  const detailSummaryClass = "flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-0 py-4 text-sm font-medium marker:hidden after:text-lg after:font-normal after:text-muted-foreground after:content-['+'] group-open:after:content-['−'] [&::-webkit-details-marker]:hidden";
  const detailBodyClass = "space-y-4 pb-5 [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground";
  return <Card className="min-w-0 gap-0 overflow-visible rounded-none bg-transparent py-0 ring-0">
    <CardHeader className="gap-5 px-0 pb-7">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{report.targetTeam || "球员招募"}{reportedAt ? ` / ${formatDate(reportedAt)}` : ""}</span>
        <span className="inline-flex items-center gap-2"><span className={`size-1.5 rounded-full ${reportBusy ? "bg-amber-600" : "bg-primary"}`} />{isWaiting ? "等待补充" : isRefreshing ? "重新分析中" : isUpdating ? "继续调查中" : "本轮调查完成"}</span>
      </div>
      <div className="space-y-3">
        <h2 id="report-outcome-title" className="m-0 text-3xl font-semibold tracking-tight sm:text-4xl">{report.recommendations.length === 0 ? emptyShortlist.title : backgroundOnly ? "找到球员，尚待核实能力" : <>值得关注的 {evidenceBackedRecommendations.length} 位球员</>}</h2>
        <p className="m-0 max-w-3xl text-sm leading-7 text-muted-foreground">{report.recommendations.length === 0 ? emptyShortlist.summary : backgroundOnly ? `现有记录缺少${missingCapabilityDescription}${referenceName ? `，还不能判断谁适合接替${referenceName}` : ""}。以下仅供补查。` : "按建议考察顺序展示。选择球员，可并排比较本轮重点指标。"}</p>
      </div>
      {reportBusy && <p role="status" className="m-0 border-l-2 border-primary pl-4 text-sm text-muted-foreground">{isWaiting ? "回答对话中的问题后继续；这里保留上一份报告。" : "正在调查，完成后将更新这份报告。"}</p>}
      {unverifiedCapabilities.length > 0 && !backgroundOnly && <p className="m-0 text-xs leading-6 text-muted-foreground"><span className="font-semibold text-foreground">待核实</span>　{unverifiedCapabilities.join("、")}缺少充分的直接证据。</p>}
    </CardHeader>
    <CardContent className="space-y-5 px-0">
      {comparisonAvailable && selectedIds.length > 0 && <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-medium">已选 {selectedIds.length} 人{selectedIds.length === 1 ? "，再选一人开始比较" : ""}</span>{selectedIds.length === 1 && <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>清除选择</Button>}</div>
        {selectedIds.length >= 2 && <CompareRecommendations backgroundOnly={false} recommendations={selectedRecommendations} onClear={() => setSelectedIds([])} />}
      </div>}
      {report.recommendations.length > 0 && <>
        <div className="space-y-4">{evidenceBackedRecommendations.map(({ recommendation, playerId, rank, canCompare }) => <RecommendationCard key={playerId} recommendation={recommendation} backgroundOnly={false} rank={rank ?? 0} selected={selectedIds.includes(playerId)} selectionDisabled={!canCompare || (selectedIds.length >= 3 && !selectedIds.includes(playerId))} comparisonAvailable={canCompare} onToggle={() => toggleRecommendation(playerId)} />)}</div>
        {backgroundRecommendations.length > 0 && <section aria-labelledby="background-candidate-heading" className="space-y-4 pt-3">
          <div><h3 id="background-candidate-heading" className="m-0 text-lg">仅供补查 · {backgroundRecommendations.length} 人</h3><p className="mb-0 mt-2 text-sm text-muted-foreground">缺少本轮重点能力的直接数据，未参与排序或比较。</p></div>
          <div className="space-y-4">{backgroundRecommendations.map(({ recommendation, playerId }) => <RecommendationCard key={playerId} recommendation={recommendation} backgroundOnly={true} rank={0} selected={false} selectionDisabled={true} comparisonAvailable={false} onToggle={() => undefined} />)}</div>
        </section>}
      </>}
      <div className="pt-5"><h3 className="m-0 text-base">调查档案</h3><p className="mb-1 mt-1 text-xs text-muted-foreground">需求、参考球员与数据依据，可按需核对。</p></div>
      <details className={detailClass}><summary className={detailSummaryClass}>引援需求</summary><div className={detailBodyClass}><p>{report.needSummary}</p>{report.capabilityProfile.length > 0 && <p>考察重点：{report.capabilityProfile.join("、")}</p>}</div></details>
      {showObservationNextStep && <Card className="gap-3 border-primary/20 bg-secondary/50 py-4" aria-label="补充比赛观察"><CardContent className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
        <div><strong className="text-sm">有看过这些球员的比赛吗？</strong><p className="mb-0 mt-1 text-xs leading-5 text-muted-foreground">记录具体比赛和你的观察，作为下一步考察线索。它不能替代缺少的专项统计。</p></div>
        <Button type="button" variant="outline" onClick={onOpenObservations}>记录比赛观察</Button>
      </CardContent></Card>}

      {report.referenceProfiles.length > 0 && <details className={detailClass}>
        <summary className={detailSummaryClass}>参考球员资料：{report.referenceProfiles.map((profile) => profile.name).join("、")}（已从候选中排除）</summary>
        <div className={detailBodyClass}><ReferenceProfilesPanel profiles={report.referenceProfiles} />{report.referenceNameSource && <p>姓名来源：<a className="text-primary underline underline-offset-4" href={report.referenceNameSource.url} target="_blank" rel="noreferrer">查看 Wikidata 条目</a></p>}</div>
      </details>}
      <details className={detailClass}><summary className={detailSummaryClass}>需求与证据覆盖</summary><div className={detailBodyClass}><RequestedCapabilityCoverage report={report} /></div></details>
      <details className={detailClass}>
        <summary className={detailSummaryClass}><span>数据与来源依据</span><span className="text-xs font-normal text-muted-foreground">数据范围 · 检索条件 · 指标覆盖 · 外部来源</span></summary>
        <div className={detailBodyClass}>
          <DatasetScopeCard scope={report.datasetScope ?? describeDatasetScope(report.datasetMode)} showCoverageState snapshot={snapshot} showLimitations={false} />
          {report.searchScopes.length > 0 && <section className="space-y-2"><h3 className="m-0 text-sm font-semibold">候选检索范围</h3><p className="m-0">以下是 Agent 实际使用的条件；可继续在对话中补充或纠正。</p><ul className="m-0 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">{report.searchScopes.map((scope, index) => <li key={`${scope.source}-${index}`}><strong className="text-foreground">{scope.source === "user_confirmed" ? "用户确认" : scope.source === "mixed" ? "包含用户确认条件" : "Agent 根据对话解释"}</strong>{" · "}{[
            scope.position ? `位置 ${positionLabels[scope.position]}` : null,
            scope.maxAge !== null ? `${scope.maxAge} 岁及以下` : null,
            scope.minimumMinutes > 0 ? `至少 ${scope.minimumMinutes} 分钟` : null,
            scope.competition ? `赛事 ${scope.competition}` : null,
            scope.season ? `赛季 ${scope.season}` : null,
          ].filter(Boolean).join(" · ") || "未设位置、年龄或赛事赛季限制"}</li>)}</ul></section>}
          <div className="grid gap-3 sm:grid-cols-2">
            <EvidenceNote title="证据覆盖">{report.evidenceCoverage.evidenceAvailability === "experimentally_withheld"
              ? <>本次评测有意屏蔽表现评估器；指标和能力覆盖均未评估。这不代表数据缺失或球员能力为零。</>
              : <>已评估 {report.evidenceCoverage.evaluatedCandidateCount} 个候选组 · {report.evidenceCoverage.evaluatedSourceRecordCount} 条来源记录 · 指标值 {report.evidenceCoverage.availableMetricValues} / {report.evidenceCoverage.expectedMetricValues} 项 · 小样本组 {report.evidenceCoverage.lowSampleCandidates} · 同组比较受限 {report.evidenceCoverage.limitedPeerGroupCandidates}<small className="mt-2 block">无法精确解析身份的来源记录仍各自计为一个候选组；这说明样本覆盖，不代表自然人数或推荐正确率。</small></>}</EvidenceNote>
            <EvidenceNote title="候选身份核验 · Reep">{candidateIdentityCoverageText(report.candidateIdentityCoverage)}<small className="mt-2 block">Reep 只用于精确关联身份。来源表现记录、指标与评分仍分开保留；姓名相同不会触发合并。</small></EvidenceNote>
            <EvidenceNote title="独立外部信号 · PlayerElo">{externalSignalCoverageText(report.externalSignalCoverage)}<small className="mt-2 block">仅作整体表现参考；不进入战术能力评分、候选排序或 Agent 结论。</small></EvidenceNote>
            <EvidenceNote title="跨来源历史表现样本 · Wyscout">{historicalArchiveCoverageText(report.historicalArchiveCoverage)}<small className="mt-2 block">只有 Reep 精确 ID 映射成功才会关联；2017/18 档案仅供纵向背景参考，不进入本轮能力评分、推荐排序或 Agent 结论。</small></EvidenceNote>
          </div>
          {report.historicalArchiveCandidates.length > 0 && <HistoricalArchiveCandidateAppendix candidates={report.historicalArchiveCandidates} />}
          <EvidenceNote title="资料检索"><>
            角色/方法片段 {report.knowledgeCoverage.methodologyChunksRetrieved} 条 · 可展示方法来源 {report.knowledgeCoverage.methodologySources.length} 个{report.knowledgeCoverage.methodologySearchFailed ? "（检索失败）" : ""} · 球员报告 {report.knowledgeCoverage.playerReportChunksRetrieved} 条{report.knowledgeCoverage.playerReportSearchFailed ? "（检索失败）" : report.knowledgeCoverage.playerReportSearchPerformed ? "（已在表现评估后检索）" : "（未检索）"}
            <small className="mt-2 block">外部网页只补充可追溯的定性线索；缺失的统计指标继续显示为未知。未配置 Web Search 时只检索本机资料库。</small>
            {report.knowledgeCoverage.methodologyChunksRetrieved > 0 && report.knowledgeCoverage.methodologySources.length === 0 && <small className="mt-2 block">本轮检索到方法片段，但来源未获准在报告中展示。</small>}
            <MethodologyReferences sources={report.knowledgeCoverage.methodologySources} />
            <small className="mt-2 block">方法资料用于理解角色和评估方法，不是球员表现证据。球员报告只补充定性观察，不直接计入能力评分；关联比赛指标也不代表整条观察已证实。</small>
          </></EvidenceNote>
        </div>
      </details>
      {teamRosterContext && <TeamRosterContextPanel context={teamRosterContext} />}
      {report.limitations.length > 0 && <details className={detailClass}><summary className={detailSummaryClass}>数据范围与风险</summary><ul className="m-0 list-disc space-y-2 border-t p-4 pl-9 text-sm leading-6 text-muted-foreground">{report.limitations.map((limitation, index) => <li key={`${limitation}-${index}`}>{limitation}</li>)}</ul></details>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-primary" />{report.dataSource}</span></div>
    </CardContent>
  </Card>;
}

function EvidenceNote({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 rounded-lg border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground"><h3 className="mb-1 mt-0 text-sm font-semibold text-foreground">{title}</h3><div>{children}</div></section>;
}

function ReferenceProfilesPanel({ profiles }: { profiles: RecruitmentReport["referenceProfiles"] }) {
  return <section className="space-y-3" aria-label="参考球员画像">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="m-0 text-sm font-semibold">参考球员画像</h3><p className="mb-0 mt-1 text-xs leading-5 text-muted-foreground">目标球员已排除在候选名单外。这里只展示同来源记录中实际存在的指标。</p></div><Badge variant="outline">不作为候选</Badge></div>
    {profiles.map(profile => <Card className="gap-3 py-4" key={`${profile.playerId}:${profile.source}:${profile.season}`}>
      <CardHeader className="px-4 py-0"><div className="flex flex-wrap items-baseline justify-between gap-2"><CardTitle className="text-base">{profile.name}</CardTitle><span className="text-xs text-muted-foreground">{profile.competition} · {profile.season} · {profile.minutes.toLocaleString()} 分钟</span></div><p className="m-0 text-xs text-muted-foreground">{profile.source}</p></CardHeader>
      <CardContent className="px-4">{profile.metrics.length > 0 ? <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">{profile.metrics.map(metric => <div className="rounded-md bg-muted/70 p-2.5" key={metric.key} title={metric.definition}>
        <dt className="text-xs text-muted-foreground">{metric.label}</dt><dd className="mb-0 mt-1 text-sm font-semibold tabular-nums">{formatMetric(metric.value)} <small className="font-normal text-muted-foreground">{metric.unit}</small></dd>
      </div>)}</dl> : <p className="m-0 text-xs leading-5 text-muted-foreground">本轮没有可直接对应目标能力的参考指标；位置和出场样本只作背景核对。</p>}</CardContent>
    </Card>)}
    <p className="m-0 text-xs text-muted-foreground">数据描述来源记录，不代表完整技术能力、适配分或未来表现。</p>
  </section>;
}

function TeamRosterContextPanel({ context }: { context: TeamRosterContext }) {
  if (context.status === "not_configured") return null;
  const sourceName = context.sourceUrl.includes("football-data.org") ? "football-data.org" : "TheSportsDB";
  const statusLabel = context.status === "available" ? "已读取阵容" : context.status === "partial" ? "不完整样本"
      : context.status === "empty" ? "无核验名单记录"
        : context.status === "not_found" ? "未找到精确球队"
          : context.status === "ambiguous" ? "球队匹配不唯一"
            : context.failureKind === "cancelled" ? "已停止补充"
              : context.failureKind === "ephemeral_replay" ? "临时资料未重放" : "暂不可用";

  return <Card className="gap-3 border-border bg-muted/30 py-4" aria-label="目标球队背景参考">
    <CardHeader className="px-4 py-0"><div className="flex flex-wrap items-start justify-between gap-3"><div><Badge variant="outline">球队背景参考 · {sourceName}</Badge><CardTitle className="mt-2 text-base">{context.team?.name ?? context.requestedTeam}</CardTitle></div><Badge variant={context.status === "available" ? "secondary" : "outline"}>{statusLabel}</Badge></div></CardHeader>
    <CardContent className="space-y-3 px-4 text-xs leading-5 text-muted-foreground">
      <p className="m-0">{context.notice}</p>
      {context.matchedTeams.length > 1 && <ul className="m-0 list-disc space-y-1 pl-5" aria-label="精确匹配的同名球队">{context.matchedTeams.map((team) => <li key={team.id}><a className="text-primary underline underline-offset-4" href={team.url} target="_blank" rel="noreferrer">{team.name} · ID {team.id}</a></li>)}</ul>}
      {context.team && <div className="space-y-2">
        <div className="flex flex-wrap justify-between gap-2"><a className="text-primary underline underline-offset-4" href={context.team.url} target="_blank" rel="noreferrer">打开球队来源资料</a>{context.status !== "unavailable" && <span>{context.returnedCount} 条球员记录 / 最多显示 {context.resultLimit} 条{context.possiblyTruncated ? " · 可能截断" : ""}</span>}</div>
        {context.players.length > 0 && <details className="rounded-md border bg-background px-3 py-2"><summary className="cursor-pointer font-medium text-foreground">查看 {context.players.length} 条球员记录</summary>
          <ul className="mt-2 space-y-1 border-t pt-2">{context.players.map((player) => <li className="flex flex-wrap justify-between gap-2" key={player.id}><a className="text-primary underline underline-offset-4" href={player.url} target="_blank" rel="noreferrer">{player.name}</a><span>{player.position || "未提供位置"}</span></li>)}</ul>
        </details>}
      </div>}
      <Separator />
      <div className="flex flex-wrap justify-between gap-2"><span>来源：<a className="text-primary underline underline-offset-4" href={context.sourceUrl} target="_blank" rel="noreferrer">{sourceName}</a></span>{context.retrievedAt && <span>读取时间 {formatDate(context.retrievedAt)}</span>}</div>
      <p className="m-0">这项资料用于球队背景调查，不作为能力评分或候选排序依据。名单不能证明球员可转会。</p>
    </CardContent>
  </Card>;
}

function HistoricalArchiveCandidateAppendix({ candidates }: { candidates: RecruitmentReport["historicalArchiveCandidates"] }) {
  return <section className="space-y-3">
    <div><h3 className="m-0 text-sm font-semibold">已评估候选的历史样本参考</h3><p className="mb-0 mt-1 text-xs leading-5 text-muted-foreground">下列记录属于本轮已评估候选的 2017/18 历史比赛样本。它们不表示当前效力或当前能力，也不参与本轮评分、Agent 判断或推荐顺序。</p></div>
    <ul className="space-y-2">{candidates.map(({ player, samples }) => <li className="rounded-lg border bg-card p-3" key={player.playerId}>
      <strong className="block text-sm">{player.name}</strong><span className="text-xs text-muted-foreground">当前候选来源：{player.team} · {player.competition} {player.season}</span>
      <details className="mt-2 border-t pt-2"><summary className="cursor-pointer text-xs font-medium">查看 {samples.length} 条 Wyscout 历史样本</summary><ul className="mt-2 space-y-2">{samples.map((sample) => <li className="space-y-1 rounded-md bg-muted/40 p-3" key={`${sample.providerPlayerId}:${sample.competition}:${sample.season}:${sample.team}`}>
        <b className="block text-xs">{sample.season} · {sample.competition} · {sample.team}</b><span className="block text-xs text-muted-foreground">{sample.playerName} · {sample.minutes.toLocaleString()} 分钟</span>
        {sample.metrics.length > 0 && <div className="mt-2 grid gap-2 sm:grid-cols-2">{sample.metrics.map((metric) => <span className="rounded-md border bg-background p-2 text-xs" key={metric.key}>{metric.label} <b>{formatMetric(metric.value)} {metric.unit}</b><small className="mt-1 block leading-5 text-muted-foreground">{metric.definition}</small></span>)}</div>}
        <small className="block break-words text-[11px] leading-5 text-muted-foreground">{sample.identityLink.sourceProvider}:{sample.identityLink.sourcePlayerId}{sample.identityLink.sourceBridge ? ` → ${sample.identityLink.sourceBridge.provider}/${sample.identityLink.sourceBridge.namespace}:${sample.identityLink.sourceBridge.externalId}${sample.identityLink.sourceBridge.sourceField ? ` (${sample.identityLink.sourceBridge.sourceField})` : ""}` : ""} → Reep:{sample.identityLink.reepId} → Wyscout:{sample.providerPlayerId} · release {sample.identityLink.reepReleaseStamp}</small>
        <small className="block text-[11px] leading-5 text-muted-foreground">{sample.attribution} · 许可：<a className="text-primary underline underline-offset-4" href={sample.licenseUrl} target="_blank" rel="noreferrer">{sample.license}</a></small>
        <a className="text-xs text-primary underline underline-offset-4" href={sample.sourceUrl} target="_blank" rel="noreferrer">打开论文与数据集出处</a>
      </li>)}</ul></details>
    </li>)}</ul>
  </section>;
}

function DatasetScopeCard({ scope, showCoverageState, snapshot, showLimitations = true }: { scope: RecruitmentReport["datasetScope"] | null; showCoverageState: boolean; snapshot?: DatasetStatus["snapshot"]; showLimitations?: boolean }) {
  if (!scope) {
    return <Card size="sm" className="border-dashed"><CardContent className="space-y-1 p-3"><Badge variant="outline">数据范围</Badge><p className="m-0 text-xs text-muted-foreground">这份报告没有提供数据范围说明。</p></CardContent></Card>;
  }
  const matchingSnapshot = scope.datasetId === snapshot?.datasetId ? snapshot : undefined;
  return (
    <Card size="sm" className="gap-3 bg-muted/30 py-3" aria-label="数据范围说明">
      <CardHeader className="space-y-2 px-3 py-0"><Badge variant={scope.kind === "fictional_demo" ? "outline" : "secondary"} className="w-fit">数据范围</Badge><CardTitle className="text-sm">{scope.title}</CardTitle><p className="m-0 text-xs leading-5 text-muted-foreground">{scope.summary}</p></CardHeader>
      <CardContent className="space-y-2 px-3 text-xs leading-5 text-muted-foreground">
        {scope.datasetId && <p className="m-0">版本信息 <code className="rounded bg-background px-1 py-0.5 font-mono" aria-label={`完整数据集标识 ${scope.datasetId}`} title={scope.datasetId}>{shortDatasetId(scope.datasetId)}</code>{scope.datasetBuiltAt ? ` · 构建于 ${formatDate(scope.datasetBuiltAt)}` : ""}</p>}
        {scope.observedCoverage && <p className="m-0">本次读取 {scope.observedCoverage.playerRecordCount.toLocaleString()} 条球员记录 · 赛事 {scope.observedCoverage.competitions.map(datasetCompetitionLabel).join("、") || "未知"} · 赛季 {scope.observedCoverage.seasons.join("、") || "未知"}</p>}
        {matchingSnapshot && <details className="rounded-md border bg-background px-3 py-2"><summary className="cursor-pointer font-medium text-foreground">查看数据集完整覆盖</summary>
          <p className="mb-0 mt-2">{matchingSnapshot.playerSeasonRecords.toLocaleString()} 条球员赛季记录 · {matchingSnapshot.uniquePlayers.toLocaleString()} 名不同球员 · {matchingSnapshot.teams.toLocaleString()} 支球队 · {matchingSnapshot.matches.toLocaleString()} 场比赛</p>
          <p className="mb-0 mt-1">赛事：{matchingSnapshot.competitions.map(datasetCompetitionLabel).join("、")} · 赛季：{matchingSnapshot.seasons.join("、")}</p>
          <ul className="mt-2 grid list-none grid-cols-1 gap-1 p-0 sm:grid-cols-2">{matchingSnapshot.metrics.map((metric) => <li className="rounded bg-muted/60 px-2 py-1" key={metric.key}>{datasetMetricLabel(metric.key)}：{metric.availableRecords.toLocaleString()} / {metric.totalRecords.toLocaleString()} 条 · {Math.round(metric.coverageRatio * 100)}% 可用</li>)}</ul>
        </details>}
        {!scope.observedCoverage && showCoverageState && <p className="m-0">本次数据池覆盖范围未知；具体候选范围需依据已核实的赛事、赛季和球员来源确认。</p>}
        {!scope.observedCoverage && !showCoverageState && <p className="m-0">开始调查后，报告会记录本次实际读取到的赛事、赛季和球员记录数。</p>}
        {showLimitations && <details className="rounded-md border bg-background px-3 py-2"><summary className="cursor-pointer font-medium text-foreground">这份数据的限制</summary><ul className="mb-0 mt-2 list-disc space-y-1 pl-5">{scope.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></details>}
      </CardContent>
    </Card>
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

function CompareRecommendations({ recommendations, backgroundOnly, onClear }: { recommendations: RecruitmentReport["recommendations"]; backgroundOnly: boolean; onClear: () => void }) {
  if (recommendations.length < 2) {
    return null;
  }
  const focusKeys = new Set<string>(recommendations.flatMap(recommendation => recommendation.focusEvidenceKeys));
  const metricRows = buildEvidenceComparison(recommendations).filter(metric => focusKeys.has(metric.key));
  return <Card size="sm" className="gap-0 overflow-hidden py-0" aria-label="推荐球员比较">
    <CardHeader className="flex flex-row items-center justify-between gap-3 px-4 py-3"><CardTitle className="text-sm">{backgroundOnly ? metricRows.length ? "背景数据对照" : "位置与样本对照" : "能力证据比较"}</CardTitle><Button type="button" variant="ghost" size="sm" onClick={onClear}>清除选择</Button></CardHeader>
    {backgroundOnly && <p className="mx-4 my-0 text-xs text-muted-foreground">当前缺少可直接验证目标能力的指标；这些记录和背景统计不能作为适配结论。</p>}
    <CardContent className="px-0 pb-0"><p className="mx-4 mb-3 mt-0 text-xs leading-5 text-muted-foreground">数值按来源原样对照；不同联赛的表现不能直接视为能力高低。样本与口径见球员详情。</p><div className="max-w-full overflow-x-auto overscroll-x-contain">
      <Table className="min-w-[520px] text-xs">
        <TableHeader><TableRow><TableHead>比较维度</TableHead>{recommendations.map((item) => <TableHead className="min-w-32" key={item.player.playerId}>{item.player.name}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          <TableRow><TableHead scope="row">出场样本</TableHead>{recommendations.map((item) => <TableCell key={item.player.playerId}>{item.player.minutes.toLocaleString()} 分钟</TableCell>)}</TableRow>
          <TableRow><TableHead scope="row">赛事 / 赛季</TableHead>{recommendations.map((item) => <TableCell key={item.player.playerId}>{item.player.competition} · {item.player.season}</TableCell>)}</TableRow>
          <TableRow><TableHead scope="row">数据来源</TableHead>{recommendations.map((item) => <TableCell key={item.player.playerId}>{item.player.source}</TableCell>)}</TableRow>

          {metricRows.map((metric) => <TableRow key={metric.key}><TableHead scope="row">{metric.label}</TableHead>{recommendations.map((item, index) => {
            const evidence = metric.values[index];
            const comparison = evidence?.peerPercentile !== null && evidence?.peerPercentile !== undefined && getPeerPercentileUnavailableReason({ minutes: evidence.minutes, recordedReason: evidence.peerPercentileUnavailableReason }) === undefined ? `同组百分位 ${evidence.peerPercentile}` : "无可用百分位";
            return <TableCell key={item.player.playerId}>{evidence ? <>{formatMetric(evidence.value)} {evidence.unit}<small className="mt-1 block whitespace-normal leading-5 text-muted-foreground">{comparison}</small></> : "无数据"}</TableCell>;
          })}</TableRow>)}
        </TableBody>
      </Table>
    </div></CardContent>
  </Card>;
}

function RecommendationCard({ recommendation, backgroundOnly, rank, selected, selectionDisabled, comparisonAvailable, onToggle }: {
  recommendation: RecruitmentReport["recommendations"][number];
  backgroundOnly: boolean;
  rank: number;
  selected: boolean;
  selectionDisabled: boolean;
  comparisonAvailable: boolean;
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
  const lowSample = player.minutes < minimumMinutesForPercentileComparison || focusEvidence.some(evidence => evidence.minutes !== null && evidence.minutes < minimumMinutesForPercentileComparison);
  return <article className={`min-w-0 rounded-2xl border bg-card p-5 sm:p-6 ${selected ? "border-primary ring-1 ring-primary" : "border-border"}`} aria-label={backgroundOnly ? player.name : `${rank} ${player.name}`}>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 className="m-0 break-words text-2xl font-semibold tracking-tight sm:text-[28px]">{player.name}</h3>
        <p className="mb-0 mt-1.5 break-words text-sm text-muted-foreground">{player.team}<span className="mx-2 text-border">/</span>{player.competition} {player.season}</p>
      </div>
      {comparisonAvailable && <label className={`inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 self-start rounded-lg border px-3 text-xs font-medium has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ${selected ? "border-primary bg-secondary text-primary" : "border-input bg-card"}`}><input className="size-4 accent-primary" type="checkbox" aria-label={`${selected ? "已加入比较" : "加入比较"}：${player.name}`} checked={selected} disabled={selectionDisabled} onChange={onToggle} /><span>{selected ? "已加入比较" : "加入比较"}</span></label>}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{positionLabels[player.position]}</span>{player.age !== null && <span>{player.age} 岁</span>}<span>{player.minutes.toLocaleString()} 分钟出场</span>{lowSample && <span className="rounded bg-muted px-2 py-0.5 font-medium text-foreground">小样本 · 无百分位</span>}{backgroundOnly && <span>目标能力未核实</span>}</div>
    {!backgroundOnly && focusEvidence.length > 0 && <dl className="mb-0 mt-5 grid grid-cols-2 gap-x-6 gap-y-5 border-t pt-4 sm:grid-cols-3 lg:grid-cols-4">{focusEvidence.slice(0, 4).map(evidence => <div key={evidence.key}><dt className="text-xs leading-5 text-muted-foreground">{evidence.label}</dt><dd className="m-0 mt-1 text-[28px] font-medium leading-tight tracking-tight tabular-nums">{formatMetric(evidence.value)}<span className="mt-1 block whitespace-nowrap text-xs font-normal tracking-normal text-muted-foreground sm:ml-1.5 sm:mt-0 sm:inline">{evidence.unit}</span></dd></div>)}</dl>}

    <details className="group mt-5 border-t pt-4"><summary className="flex min-h-8 cursor-pointer list-none items-center justify-between text-sm font-medium marker:hidden [&::-webkit-details-marker]:hidden"><span>考察详情与数据依据</span><span className="text-lg text-muted-foreground group-open:rotate-45" aria-hidden="true">＋</span></summary>
      <div className="mt-4 space-y-4">
      <p className="m-0 text-xs leading-6 text-muted-foreground">{player.source}{player.sourceIdentity?.retrievedAt ? `，读取于 ${formatDate(player.sourceIdentity.retrievedAt)}` : ""}{player.sourceUrl && <>。<a className="text-primary underline underline-offset-4" href={player.sourceUrl} target="_blank" rel="noreferrer">查看来源</a></>}{player.age === null && "。年龄未提供。"}</p>
      {!backgroundOnly && (recommendation.comparisonNotes ?? []).length > 0 && <section className="text-sm" aria-label="本轮候选比较"><h4 className="mb-2 mt-0 font-semibold">与其他候选比较</h4><ul className="m-0 list-disc space-y-2 pl-5 text-muted-foreground">{recommendation.comparisonNotes.map((note, index) => <li key={index}>{note}</li>)}</ul></section>}
      {!backgroundOnly && recommendation.referenceComparisonNotes.length > 0 && <section className="text-sm" aria-label="与参考球员数据对照"><h4 className="mb-2 mt-0 font-semibold">与参考球员比较</h4><ul className="m-0 list-disc space-y-2 pl-5 text-muted-foreground">{recommendation.referenceComparisonNotes.map((note, index) => <li key={index}>{note}</li>)}</ul></section>}
      {recommendation.tradeoffs.length > 0 && <section className="text-sm"><h4 className="mb-2 mt-0 font-semibold">取舍与待核实</h4><ul className="m-0 list-disc space-y-2 pl-5 text-muted-foreground">{recommendation.tradeoffs.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
      {recommendation.sourceEvidenceRecords.length > 0 && <details className="mt-3 rounded-lg border"><summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold">同一身份的其他来源记录 · {recommendation.sourceEvidenceRecords.length}</summary><div className="space-y-2 border-t p-3"><p className="m-0 text-xs leading-5 text-muted-foreground">以下记录通过精确身份映射关联。每条记录单独列出，未将不同来源的指标合并评分。</p>{recommendation.sourceEvidenceRecords.map((record) => <section className="rounded-md bg-muted/40 p-3" key={`${record.sourceRecordId}:${record.competition}:${record.season}`}>
        <b className="block text-xs">{record.source} · {record.team}</b><span className="block text-xs text-muted-foreground">{record.competition} {record.season} · {record.minutes.toLocaleString()} 分钟 · ID {record.sourceRecordId}</span>
        <small className="mt-1 block text-[11px] leading-5 text-muted-foreground">{record.evaluated ? `来源抓取于 ${record.retrievedAt ? formatDate(record.retrievedAt) : "时间未知"}` : "本轮未单独评估此来源记录"}{record.sourceUrl && <> · <a className="text-primary underline underline-offset-4" href={record.sourceUrl} target="_blank" rel="noreferrer">查看来源</a></>}</small>
        {record.evidence.length > 0 && <ul className="mb-0 mt-2 list-disc pl-5 text-xs leading-5">{record.evidence.map((evidence) => <li key={evidence.key}>{evidence.label} {formatMetric(evidence.value)} {evidence.unit} · {sourceSampleLabel(evidence)}{evidence.sourceField ? ` · ${evidence.sourceField}` : ""}</li>)}</ul>}
      </section>)}</div></details>}
      {recommendation.externalSignals.map((signal) => <section className="mt-3 rounded-lg border bg-card p-3 text-xs leading-5" key={`${signal.provider}-${signal.providerPlayerId}`}>
        <strong className="block font-semibold">独立表现参考 · PlayerElo</strong>
        <p className="mb-1 mt-2"><b>Elo {formatMetric(signal.elo)}</b>{signal.earLabel ? ` · ${signal.earLabel}` : ""}</p>
        <small className="block text-muted-foreground">{[signal.currentTeam ? `来源当前球队：${signal.currentTeam}` : null, signal.currentLeague ? `联赛：${signal.currentLeague}` : null, signal.position ? `位置：${signal.position}` : null].filter(Boolean).join(" · ") || "来源未提供球队或位置"}</small>
        <small className="block text-muted-foreground">{playerEloIdentityText(signal)} 更新于 {formatDate(signal.retrievedAt)}。</small>
        <a className="text-primary underline underline-offset-4" href="https://playerelo.football/" target="_blank" rel="noreferrer">PlayerElo · 模型说明与来源</a>
      </section>)}
      {recommendation.historicalArchiveSamples.length > 0 && <details className="mt-3 rounded-lg border"><summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold">历史表现样本 · Wyscout Open Data</summary>
        <div className="space-y-3 border-t p-3"><p className="m-0 text-xs leading-5 text-muted-foreground">以下是 Reep release {recommendation.historicalArchiveSamples[0]!.identityLink.reepReleaseStamp} 按来源球员 ID 精确关联到的历史记录。该数据代表对应旧赛季，不表示当前效力或当前能力。</p>
        {recommendation.historicalArchiveSamples.map((sample) => <section className="space-y-2 rounded-md bg-muted/40 p-3" key={`${sample.providerPlayerId}:${sample.competition}:${sample.season}:${sample.team}`}>
          <b className="block text-xs">{sample.season} · {sample.competition} · {sample.team} · {sample.minutes.toLocaleString()} 分钟</b>
          {sample.metrics.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{sample.metrics.map((metric) => <span className="rounded border bg-background p-2 text-xs" key={metric.key}>{metric.label} <b>{formatMetric(metric.value)} {metric.unit}</b><small className="mt-1 block leading-5 text-muted-foreground">{metric.definition}</small></span>)}</div>}
          <small className="block break-words text-[11px] leading-5 text-muted-foreground">{sample.identityLink.sourceProvider}:{sample.identityLink.sourcePlayerId}{sample.identityLink.sourceBridge ? ` → ${sample.identityLink.sourceBridge.provider}/${sample.identityLink.sourceBridge.namespace}:${sample.identityLink.sourceBridge.externalId}${sample.identityLink.sourceBridge.sourceField ? ` (${sample.identityLink.sourceBridge.sourceField})` : ""}` : ""} → Reep:{sample.identityLink.reepId} → Wyscout:{sample.providerPlayerId} · Reep rung {sample.identityLink.sourceRung ?? "未提供"} → {sample.identityLink.archiveRung ?? "未提供"}</small>
          <small className="block break-words text-[11px] leading-5 text-muted-foreground">映射状态 {sample.identityLink.sourceUpstreamStatus ?? "未提供"} → {sample.identityLink.archiveUpstreamStatus ?? "未提供"} · release {sample.identityLink.reepReleaseStamp}</small>
          <small className="block text-[11px] leading-5 text-muted-foreground">{sample.attribution} · 许可：<a className="text-primary underline underline-offset-4" href={sample.licenseUrl} target="_blank" rel="noreferrer">{sample.license}</a></small>
          <a className="text-xs text-primary underline underline-offset-4" href={sample.sourceUrl} target="_blank" rel="noreferrer">打开论文与数据集出处</a>
        </section>)}</div>
      </details>}
      {recommendation.evidence.length > 0 && <details className="mt-3 rounded-lg border"><summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold">{backgroundOnly ? "查看来源中的其他统计（不代表目标能力）" : "查看完整指标与分析"}</summary><div className="space-y-3 border-t p-3">{!backgroundOnly && <p className="m-0 text-sm leading-6 text-muted-foreground">{rationale}</p>}<div className="max-w-full overflow-x-auto overscroll-x-contain"><Table className="min-w-[680px] text-xs"><TableHeader><TableRow><TableHead>可观测指标</TableHead><TableHead>数值</TableHead><TableHead>对比组</TableHead><TableHead>来源样本</TableHead></TableRow></TableHeader><TableBody>{recommendation.evidence.map((evidence) => <TableRow key={evidence.key}><TableHead className="whitespace-normal" scope="row">{evidence.label}{recommendation.focusEvidenceKeys.includes(evidence.key) && <Badge variant="secondary" className="ml-1.5 align-middle">本轮重点</Badge>}{evidence.definition && <details className="mt-1 max-w-64 font-normal"><summary className="cursor-pointer text-xs text-muted-foreground">指标口径</summary><p className="mb-0 mt-1 whitespace-normal text-xs leading-5 text-muted-foreground">{evidence.definition}</p></details>}</TableHead><TableCell className="whitespace-nowrap tabular-nums">{formatMetric(evidence.value)} {evidence.unit}</TableCell><TableCell className="whitespace-normal">{peerComparisonLabel(evidence)}</TableCell><TableCell className="whitespace-normal">{sourceSampleLabel(evidence)}{evidence.sampleAttempts !== undefined && <small className="mt-1 block text-muted-foreground">{evidence.sampleAttempts} {evidence.sampleAttemptsLabel ?? "次非点球射门"}</small>}{evidence.sourceField && <small className="mt-1 block text-muted-foreground">{evidence.sourceField}</small>}</TableCell></TableRow>)}</TableBody></Table></div></div></details>}
      {recommendation.reportObservations.length > 0 && <details className="mt-3 rounded-lg border"><summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold">球员定性观察 · {recommendation.reportObservations.length}</summary><ul className="m-0 list-none space-y-3 border-t p-3">{recommendation.reportObservations.map((observation, index) => {
        const firstParty = observation.source.sourceId === firstPartyObservationSourceId;
        const internalObservationUrl = firstParty && new URL(observation.source.url).hostname === "tactiscout.local";
        return <li className="space-y-1 text-xs leading-5" key={`${observation.source.sourceId}-${index}`}>
          <p className="m-0 text-sm">{observation.summary}</p>
          <small className="block text-muted-foreground">{observation.verificationStatus === "linked_to_match_data" ? `关联比赛数据：${observation.linkedMetricKeys.join("、")}；需人工核实完整语义。` : "当前比赛数据未核实，作为单一来源的定性观点。"}</small>
          {firstParty && <small className="block text-muted-foreground">TactiScout 自录观察 · 作者观点，未经独立核实</small>}
          {internalObservationUrl
            ? <small className="block text-muted-foreground">没有提供外部参考链接；此观察只保存在本机。</small>
            : <a className="text-primary underline underline-offset-4" href={observation.source.url} target="_blank" rel="noreferrer">{firstParty ? "打开观察者提供的参考链接" : `${observation.source.title} · ${observation.source.author} · ${observation.source.license}`}</a>}
          <small className="block text-muted-foreground">{observation.source.attribution}</small>
        </li>;
      })}</ul></details>}
      </div>
    </details>
  </article>;
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
  sourceRecordCount: number,
): string {
  if (status === "resolved") return `球员身份已按来源 ID 核对；本轮关联 ${sourceRecordCount} 条来源记录。`;
  const labels = {
    not_run: "尚未核对不同来源中的球员身份",
    ambiguous: "不同来源的身份无法确认，资料未合并",
    not_found: "没有找到精确身份匹配，按单条来源记录保留",
    de_corroborated: "来源身份信息不一致，资料未合并",
    withheld: "来源没有提供可用于核对的身份资料",
    target_not_published: "身份索引中没有这名球员",
    unsupported_provider: "这个数据源暂不支持身份核对",
    registry_unavailable: "身份核对暂时不可用",
    missing_source_identity: "数据源未提供球员 ID，无法核对身份",
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
    .map(({ status, count }) => `${count} 组${candidateIdentityStatusText(status, 1).split("；")[0]}`)
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
      caseStatus={view.caseStatus}
      onRetry={() => onAction("retry_dataset")}
    />;
  }
  return <ReportContentView
    report={view.report}
    teamRosterContext={view.teamRosterContext}
    reportedAt={view.reportedAt}
    isWaiting={view.status === "waiting"}
    isRefreshing={view.status === "refreshing"}
    isUpdating={view.status === "updating"}
    snapshot={view.snapshot}
    onOpenObservations={() => onAction("open_observations")}
  />;
}
