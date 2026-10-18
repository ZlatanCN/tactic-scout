import { getPeerPercentileUnavailableReason, minimumMinutesForPercentileComparison } from "../../../../../src/domain/evidence-comparison.js";
import type { CapabilityEvidence } from "../../../../../src/domain/capabilities.js";
import type { RecruitmentReport } from "../../../../../src/domain/reports.js";
import { firstPartyObservationSourceId } from "../../../../../src/knowledge/source-ids.js";
import { formatDate } from "../lib/format-date";
import { Badge } from "@/shared/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
import { UnderstatPlayerResearchPanel } from "./UnderstatResearchPanels";
import { describePositionEvidenceLabel, positionLabels } from "./report-labels";
import { formatMetric, peerComparisonLabel, playerEloIdentityText, sourceSampleLabel } from "./report-evidence-format";
import { AbilityRecommendationCard } from "./AbilityRecommendationCard";

export function RecommendationCard({ recommendation, backgroundOnly, rank, selected, selectionDisabled, comparisonAvailable, onToggle }: {
  recommendation: RecruitmentReport["recommendations"][number];
  backgroundOnly: boolean;
  rank: number;
  selected: boolean;
  selectionDisabled: boolean;
  comparisonAvailable: boolean;
  onToggle: () => void;
}) {
  const { player } = recommendation;
  if (player.abilityProfile) return <AbilityRecommendationCard recommendation={recommendation} rank={rank} selected={selected} selectionDisabled={selectionDisabled} comparisonAvailable={comparisonAvailable} onToggle={onToggle} />;
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
  const positionEvidenceLabel = describePositionEvidenceLabel(player);
  const positionEvidenceIsDirect = player.positionEvidence?.status === "direct";
  return <article className={`min-w-0 rounded-2xl border bg-card p-4 shadow-[0_2px_12px_-8px_rgba(23,58,41,0.18)] sm:p-5 ${selected ? "border-primary ring-1 ring-primary" : "border-border/80"}`} aria-label={backgroundOnly ? player.name : `${rank} ${player.name}`}>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {!backgroundOnly && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-xs font-semibold tabular-nums text-primary" aria-hidden="true">{rank}</span>}
        <div className="min-w-0">
          <h3 className="m-0 break-words text-xl font-semibold tracking-tight sm:text-2xl"><bdi>{player.name}</bdi></h3>
          <p className="mb-0 mt-1.5 break-words text-sm text-muted-foreground">{[player.team, player.competition, player.season].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      {comparisonAvailable && <label className={`inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 self-start rounded-lg border px-3 text-xs font-medium has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ${selected ? "border-primary bg-secondary text-primary" : "border-input bg-card"}`}><input className="size-4 accent-primary" type="checkbox" aria-label={`${selected ? "已加入比较" : "加入比较"}：${player.name}`} checked={selected} disabled={selectionDisabled} onChange={onToggle} /><span>{selected ? "已加入比较" : "加入比较"}</span></label>}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground"><span>{recommendation.matchedPositions?.length ? `位置：${recommendation.matchedPositions.map((position) => positionLabels[position]).join("、")}` : positionLabels[player.position]}</span>{player.age !== null && <span>{player.age} 岁</span>}<span className="tabular-nums">{player.minutes.toLocaleString()} 分钟</span>{positionEvidenceLabel && <Badge variant={positionEvidenceIsDirect ? "secondary" : "outline"} className="font-normal">{positionEvidenceLabel}</Badge>}{lowSample && <Badge variant="outline" className="font-normal">小样本 · 无百分位</Badge>}{backgroundOnly && <Badge variant="outline" className="font-normal">目标能力未核实</Badge>}</div>
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
      {recommendation.understatResearch && <UnderstatPlayerResearchPanel research={recommendation.understatResearch} />}
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
