import { ChevronDown, Check, Plus } from "lucide-react";
import type { RecruitmentReport } from "../../../../../src/domain/reports.js";
import { AbilityMetricDefinitions } from "../../../../../src/domain/player-abilities.js";
import type { Position } from "../../../../../src/domain/position-contracts.js";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { abilityGroups, abilityLabels, friendlyMetricLabel, personalityLabels, traitLabels } from "./ability-labels";
import { positionLabels } from "./report-labels";
import { formatMetric } from "./report-evidence-format";
import { ReportEvidenceCitations } from "./ReportEvidenceCitations";

interface Props {
  recommendation: RecruitmentReport["recommendations"][number];
  rank: number;
  selected: boolean;
  selectionDisabled: boolean;
  comparisonAvailable: boolean;
  onToggle: () => void;
}

export function AbilityRecommendationCard({ recommendation, rank, selected, selectionDisabled, comparisonAvailable, onToggle }: Props) {
  const { player } = recommendation;
  const profile = player.abilityProfile!;
  const roles = profile.roles.filter((role) => role.positionCompatible);
  const focusRoles = roles.filter((role) => recommendation.focusEvidenceKeys.some((key) => AbilityMetricDefinitions.some((definition) => definition.key === key && definition.role === role.role)));
  const featured = ((profile.positions.GK ?? 0) >= 15 ? roles : focusRoles.length ? focusRoles : [...roles].sort((a, b) => b.searchPriority - a.searchPriority)).slice(0, 3);
  const relevantAttributes = [...new Set(featured.flatMap((role) => role.attributes.map((attribute) => attribute.key)))];
  const keyAttributes = relevantAttributes.map((key) => ({ key, value: profile.attributes[key]?.display ?? null }))
    .filter((attribute) => attribute.value !== null).sort((a, b) => b.value! - a.value!).slice(0, 4);
  const positions = Object.entries(profile.positions).filter(([, value]) => value! >= 15).sort((a, b) => b[1]! - a[1]!);
  const performance = recommendation.evidence.filter((evidence) => evidence.basis !== "ability_profile");
  const focusedPerformance = performance.filter((evidence) => recommendation.focusEvidenceKeys.includes(evidence.key));
  const relatedMetricKeys = new Set(featured.flatMap((role) => role.performanceMetricKeys ?? []));
  const matchFacts = (focusedPerformance.length ? focusedPerformance : performance.filter((evidence) => relatedMetricKeys.has(evidence.key))).slice(0, 3);
  const metadata = [player.age === null ? null : `${player.age} 岁`, profile.heightCm === null ? null : `${profile.heightCm} cm`,
    profile.leftFoot === null || profile.rightFoot === null ? null : profile.leftFoot >= 15 && profile.rightFoot >= 15 ? "双脚均衡" : profile.leftFoot > profile.rightFoot ? "左脚" : "右脚"].filter(Boolean);
  const tradeoffs = recommendation.tradeoffs.filter((text) => !/事件统计不能替代|每 90 分钟|百分位|来源记录|当前依据不表示/.test(text)).slice(0, 2);
  const comparisons = recommendation.referenceComparisonNotes.filter((text) => !/sourceField|Understat|Wyscout|ASA|StatsBomb/.test(text));

  return <article className={`min-w-0 overflow-hidden rounded-2xl border bg-card shadow-[0_18px_42px_-34px_rgba(0,0,0,0.85)] ${selected ? "border-primary ring-1 ring-primary" : "border-border/80"}`} aria-label={`${rank} ${player.name}`}>
    <div className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-44">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="tabular-nums">候选 {rank}</span><span aria-hidden="true">/</span><span>{positions.slice(0, 3).map(([position]) => positionLabels[position as Position]).join("、") || positionLabels[player.position]}</span></div>
          <h3 className="m-0 break-words text-2xl font-semibold leading-snug tracking-tight sm:text-3xl"><bdi>{player.name}</bdi></h3>
          {metadata.length > 0 && <p className="mb-0 mt-2 text-sm text-muted-foreground">{metadata.join(" · ")}</p>}
          {player.team && <p className="mb-0 mt-1 break-words text-sm text-muted-foreground">{[player.team, player.competition, player.season].filter(Boolean).join(" · ")}</p>}
          {!player.team && <p className="mb-0 mt-1 text-sm text-muted-foreground">现役球队未核实</p>}
        </div>
        {comparisonAvailable && <Button variant={selected ? "secondary" : "outline"} size="sm" className="min-h-10 shrink-0 gap-2" aria-pressed={selected} aria-label={`${selected ? "移出比较" : "加入比较"}：${player.name}`} disabled={selectionDisabled && !selected} onClick={onToggle}>
          {selected ? <Check className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}{selected ? "移出比较" : "加入比较"}
        </Button>}
      </div>

      {(comparisons.length > 0 || recommendation.referenceSimilarity) && <section className="mt-5 text-sm leading-relaxed" aria-label="与参考球员比较">
        <h4 className="mb-1.5 mt-0 text-sm font-semibold">与参考球员相比</h4>
        {recommendation.referenceSimilarity && <p className="mb-2 mt-0 text-xs leading-5 text-muted-foreground">以<bdi>{recommendation.referenceSimilarity.referenceName}</bdi>为参照，{recommendation.referenceSimilarity.ability ? `已比较${recommendation.referenceSimilarity.ability.comparedMetrics}项职责属性` : "暂无可比的职责属性"}；{recommendation.referenceSimilarity.performance ? `${recommendation.referenceSimilarity.performance.comparedMetrics}项比赛指标可在同组比较` : "比赛表现尚不足以作同组比较"}。</p>}
        {comparisons.length > 0 && <ul className="m-0 max-w-prose list-disc space-y-1.5 ps-4 text-pretty text-muted-foreground">{comparisons.slice(0, 3).map(text => <li key={text}>{text}</li>)}</ul>}
      </section>}

      <div className="mt-6 grid gap-5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-label="本次职责适配" className="min-w-0">
          <h4 className="mb-3 mt-0 text-sm font-semibold">本次职责适配</h4>
          <dl className="m-0 space-y-3">{featured.map((role) => <div key={role.role} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5">
            <dt className="text-sm">{role.label}</dt><dd className="m-0 text-sm font-semibold tabular-nums">{role.fit === null ? "资料不全" : <>{Math.round(role.fit)}<span className="ms-1 font-normal text-muted-foreground">/100</span></>}</dd>
            {role.fit !== null && <meter aria-label={`${role.label}适配`} className="col-span-2 h-2 w-full [&::-webkit-meter-bar]:rounded-full [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-muted [&::-webkit-meter-optimum-value]:rounded-full [&::-webkit-meter-optimum-value]:bg-primary" min={0} max={100} value={role.fit}>{Math.round(role.fit)}</meter>}
          </div>)}</dl>
          {featured.length === 0 && <p className="m-0 text-sm text-muted-foreground">现有位置画像尚未覆盖本次职责，可以调整位置继续比较。</p>}
        </section>
        <section className="min-w-0 rounded-xl bg-muted p-4" aria-label="相关能力特点">
          <h4 className="mb-3 mt-0 text-sm font-semibold">相关能力特点</h4>
          <dl className="m-0 space-y-2.5">{keyAttributes.map(({ key, value }) => <div className="flex items-baseline justify-between gap-3 text-sm" key={key}><dt>{abilityLabels[key] ?? key}</dt><dd className="m-0 font-semibold tabular-nums">{value}<span className="ms-1 font-normal text-muted-foreground">/20</span></dd></div>)}</dl>
        </section>
      </div>

      {tradeoffs.length > 0 && <section className="mt-5 text-sm leading-relaxed" aria-label="主要取舍"><h4 className="mb-1.5 mt-0 text-sm font-semibold">主要取舍</h4><ul className="m-0 list-disc space-y-1.5 ps-4 text-muted-foreground">{tradeoffs.map((text) => <li key={text}>{text}</li>)}</ul></section>}
      {matchFacts.length > 0 && <section className="mt-6 border-t pt-4" aria-label="比赛表现"><div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h4 className="m-0 text-sm font-semibold">比赛表现</h4>{player.minutes > 0 && <span className="text-xs text-muted-foreground tabular-nums">{player.minutes.toLocaleString()} 分钟样本</span>}</div><dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-3">{matchFacts.map((evidence) => <div key={evidence.key}><dt className="text-xs leading-relaxed text-muted-foreground">{friendlyMetricLabel(evidence.label)}</dt><dd className="m-0 mt-1 text-xl font-semibold tabular-nums">{formatMetric(evidence.value)}<span className="ms-1.5 text-xs font-normal text-muted-foreground">{evidence.unit}</span></dd></div>)}</dl></section>}
    </div>

      <details className="group border-t">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-medium marker:hidden sm:px-6 [&::-webkit-details-marker]:hidden"><span>查看完整能力与位置</span><ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-open:rotate-180" aria-hidden="true" /></summary>
      <div className="space-y-6 px-5 pb-6 pt-2 sm:px-6">
        <div className="flex flex-wrap gap-2">{positions.map(([position, value]) => <Badge key={position} variant="secondary" className="font-normal">{positionLabels[position as Position]} · {value! >= 18 ? "熟练" : "胜任"}</Badge>)}</div>
        <Tabs defaultValue={positions[0]?.[0] === "GK" ? "goalkeeping" : "technical"}>
          <TabsList className="h-10 w-full">{abilityGroups.map((group) => <TabsTrigger value={group.id} key={group.id} className="min-h-8 px-2">{group.label}</TabsTrigger>)}</TabsList>
          {abilityGroups.map((group) => <TabsContent value={group.id} key={group.id} className="pt-3"><dl className="m-0 grid grid-cols-1 gap-x-8 sm:grid-cols-2">{group.keys.map((key) => <div className="flex items-baseline justify-between gap-4 border-b py-2.5 text-sm" key={key}><dt>{abilityLabels[key]}</dt><dd className="m-0 tabular-nums">{profile.attributes[key]?.display ?? "—"}<span className="ms-1 text-xs text-muted-foreground">/20</span></dd></div>)}</dl></TabsContent>)}
        </Tabs>
        {Object.values(profile.personality).some((value) => value !== null) && <section>
          <h4 className="mb-2 mt-0 text-sm font-semibold">性格参考</h4>
          <dl className="m-0 grid grid-cols-1 gap-x-8 sm:grid-cols-2">{Object.entries(profile.personality).map(([key, value]) => <div key={key} className="flex items-baseline justify-between gap-4 border-b py-2.5 text-sm"><dt>{personalityLabels[key] ?? key}</dt><dd className="m-0 tabular-nums">{value ?? "—"}<span className="ms-1 text-xs text-muted-foreground">/20</span></dd></div>)}</dl>
          <p className="mb-0 mt-2 text-xs leading-relaxed text-muted-foreground">画像中的参考评价，需结合实际观察；不直接计入本次职责分。</p>
        </section>}
        {(profile.currentAbility !== null || (profile.potentialAbility !== null && profile.potentialAbility > 0)) && <section>
          <h4 className="mb-2 mt-0 text-sm font-semibold">整体参考</h4>
          <dl className="m-0 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            {profile.currentAbility !== null && <div><dt className="text-muted-foreground">当前能力</dt><dd className="m-0 mt-1 font-semibold tabular-nums">{profile.currentAbility}<span className="ms-1 font-normal text-muted-foreground">/200</span></dd></div>}
            {profile.potentialAbility !== null && profile.potentialAbility > 0 && <div><dt className="text-muted-foreground">潜力参考</dt><dd className="m-0 mt-1 font-semibold tabular-nums">{profile.potentialAbility}<span className="ms-1 font-normal text-muted-foreground">/200</span></dd></div>}
          </dl><p className="mb-0 mt-2 text-xs leading-relaxed text-muted-foreground">用于比较当前能力与潜力，和职责适配、比赛表现分开看；PA 不保证未来发展。</p>
        </section>}
        {profile.traits.length > 0 && <section><h4 className="mb-2 mt-0 text-sm font-semibold">球员特点</h4><p className="m-0 text-sm leading-relaxed text-muted-foreground">{profile.traits.map(trait => traitLabels[trait] ?? trait.replaceAll("_", " ")).join("、")}</p></section>}
        {recommendation.reportObservations.length > 0 && <section><h4 className="mb-2 mt-0 text-sm font-semibold">补充观察</h4><ul className="m-0 list-disc space-y-3 ps-4 text-sm text-muted-foreground">{recommendation.reportObservations.map((observation, index) => <li key={index}><p>{observation.summary}</p>{observation.claimType === "source_disagreement" && <small className="block">来源观点有差异；此处并列呈现，不做无证据调和。</small>}{observation.limitations.length > 0 && <small className="block">{observation.limitations.join(" · ")}</small>}{observation.source.evidenceType === "historical_player_analysis" && <small className="block">历史研究者分析，不是职业球探报告或当前能力结论。</small>}<ReportEvidenceCitations citations={observation.citations} /></li>)}</ul></section>}
      </div>
    </details>
  </article>;
}
