import { useEffect, useState, type ChangeEvent } from "react";
import { z } from "zod/v4";
import {
  ShortlistFitGradeSchema,
  type ShortlistReviewGrade,
} from "../../../../../src/domain/shortlist-review.js";
import { shortlistFitRubric } from "../../../../../src/domain/shortlist-fit-rubric.js";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Progress } from "@/shared/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
import {
  createShortlistQualityDataset,
  parseShortlistAdjudicationBundle,
  type ShortlistAdjudicationBundle,
} from "../../../../../src/evaluation/shortlist-evaluation-dataset.js";
import {
  evaluateShortlistQuality,
  ShortlistQualityDatasetSchema,
  type ShortlistQualityEvaluation,
  type ShortlistQualityDataset,
} from "../../../../../src/evaluation/shortlist-quality-evaluation.js";

const activeDraftKey = "tactiscout:shortlist-adjudication:v1:active";
const gradeOptions = shortlistFitRubric.map(({ value, label, detail }) => ({ value, label, help: detail }));

interface AdjudicationDraft {
  schemaVersion: 1;
  bundle: ShortlistAdjudicationBundle;
  grades: Record<string, ShortlistReviewGrade>;
  locked: boolean;
  dataset: ShortlistQualityDataset | null;
}

function draftKey(packetId: string, reviewerIds: string[]): string {
  return `tactiscout:shortlist-adjudication:v1:${encodeURIComponent(packetId)}:${reviewerIds.map(encodeURIComponent).sort().join(":")}`;
}

function parseDraft(value: unknown): AdjudicationDraft {
  const draft = z.object({
    schemaVersion: z.literal(1),
    bundle: z.object({ packet: z.unknown(), submissions: z.unknown() }).strict(),
    grades: z.record(z.string(), ShortlistFitGradeSchema),
    locked: z.boolean(),
    dataset: ShortlistQualityDatasetSchema.nullable(),
  }).strict().parse(value);
  const bundle = parseShortlistAdjudicationBundle(draft.bundle);
  const cardIds = new Set(bundle.packet.cards.map(({ cardId }) => cardId));
  if (Object.keys(draft.grades).some((cardId) => !cardIds.has(cardId))) throw new Error("本机裁决草稿包含其他评审包的卡片。");
  if (draft.dataset && !draft.locked) throw new Error("本机草稿状态无效：评审数据已生成但裁决未锁定。");
  return { ...draft, bundle };
}

function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function gradeLabel(value: ShortlistReviewGrade | undefined): string {
  if (value === undefined) return "未评分";
  return gradeOptions.find(({ value: optionValue }) => optionValue === value)?.label ?? "未知";
}

export function ShortlistAdjudicationWorkbench() {
  const [draft, setDraft] = useState<AdjudicationDraft | null>(null);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [packetFile, setPacketFile] = useState<File | null>(null);
  const [submissionFiles, setSubmissionFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [evaluation, setEvaluation] = useState<ShortlistQualityEvaluation | null>(null);

  useEffect(() => {
    try {
      const key = window.localStorage.getItem(activeDraftKey);
      if (!key) return;
      const saved = window.localStorage.getItem(key);
      if (!saved) return;
      const restored = parseDraft(JSON.parse(saved) as unknown);
      setDraft(restored);
      if (restored.dataset) setEvaluation(evaluateShortlistQuality(restored.dataset));
      setMessage(restored.locked ? "已恢复已锁定的本机裁决草稿。" : "已恢复本机盲评裁决草稿。继续完成剩余候选即可。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法读取本机裁决草稿。");
    }
  }, []);

  const packet = draft?.bundle.packet;
  const currentCard = packet?.cards[activeCardIndex] ?? null;
  const gradeCount = draft ? Object.keys(draft.grades).length : 0;
  const complete = Boolean(packet && gradeCount === packet.cards.length);

  function saveDraft(next: AdjudicationDraft) {
    setDraft(next);
    const key = draftKey(next.bundle.packet.packetId, next.bundle.submissions.map(({ reviewerId }) => reviewerId));
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
      window.localStorage.setItem(activeDraftKey, key);
      setError("");
    } catch {
      setError("浏览器无法保存本机草稿。请检查 localStorage 空间和隐私设置后重试。");
    }
  }

  async function importBlindMaterials() {
    if (!packetFile || submissionFiles.length < 2) {
      setError("请选择一份盲评包和至少两份独立评分文件。");
      return;
    }
    try {
      const [packetText, ...submissionTexts] = await Promise.all([
        packetFile.text(),
        ...submissionFiles.map((file) => file.text()),
      ]);
      const bundle = parseShortlistAdjudicationBundle({
        packet: JSON.parse(packetText) as unknown,
        submissions: submissionTexts.map((text) => JSON.parse(text) as unknown),
      });
      const key = draftKey(bundle.packet.packetId, bundle.submissions.map(({ reviewerId }) => reviewerId));
      const stored = window.localStorage.getItem(key);
      if (stored) {
        const restored = parseDraft(JSON.parse(stored) as unknown);
        if (JSON.stringify(restored.bundle) !== JSON.stringify(bundle)) throw new Error("相同评审包与评审代号已存在不同的评分文件；为避免混合版本，请先清除旧草稿。");
        saveDraft(restored);
        setActiveCardIndex(0);
        if (restored.dataset) setEvaluation(evaluateShortlistQuality(restored.dataset));
        setMessage(restored.locked ? "已恢复已锁定的裁决草稿。" : "已恢复这组独立评分的裁决草稿。");
      } else {
        const initialDraft: AdjudicationDraft = {
          schemaVersion: 1,
          bundle,
          grades: {},
          locked: false,
          dataset: null,
        };
        saveDraft(initialDraft);
        setEvaluation(null);
        setActiveCardIndex(0);
        setMessage(`已载入 ${bundle.submissions.length} 份完整盲评。评分代号各不相同；答案键尚未读取。`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法载入盲评材料。");
      setMessage("");
    }
  }

  function adjudicate(grade: ShortlistReviewGrade) {
    if (!draft || !currentCard || draft.locked) return;
    saveDraft({ ...draft, grades: { ...draft.grades, [currentCard.cardId]: grade } });
    setMessage("裁决已保存在本机。原始评审评分保持不变。");
  }

  function lockAdjudications() {
    if (!draft || !complete || draft.locked) return;
    if (!window.confirm("锁定所有匿名卡的裁决？锁定后不能编辑这些分数；之后才会允许载入答案键。")) return;
    saveDraft({ ...draft, locked: true });
    setMessage("裁决已锁定。现在可以单独载入答案键并计算本 query 的评测结果。");
  }

  async function importAnswerKey(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || !draft || !draft.locked) return;
    try {
      const answerKey = JSON.parse(await file.text()) as unknown;
      const dataset = createShortlistQualityDataset({
        packet: draft.bundle.packet,
        submissions: draft.bundle.submissions,
        adjudications: draft.bundle.packet.cards.map(({ cardId }) => ({ cardId, grade: draft.grades[cardId] })),
        answerKey,
      });
      const result = evaluateShortlistQuality(dataset);
      const nextDraft = { ...draft, dataset };
      saveDraft(nextDraft);
      setEvaluation(result);
      setMessage(result.status === "evaluable"
        ? "已计算冻结候选池的 nDCG@5。该分数只适用于此需求、候选池和快照。"
        : "评测数据已生成，但当前 query 不可计算 nDCG；请查看具体覆盖原因，不要把 unknown 当作 0。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "答案键或评测输入无效。");
      setMessage("");
    } finally {
      input.value = "";
    }
  }

  function resetDraft() {
    if (!draft || !window.confirm("清除这组本机评分与裁决草稿？导出的文件不会删除。")) return;
    const key = draftKey(draft.bundle.packet.packetId, draft.bundle.submissions.map(({ reviewerId }) => reviewerId));
    window.localStorage.removeItem(key);
    if (window.localStorage.getItem(activeDraftKey) === key) window.localStorage.removeItem(activeDraftKey);
    setDraft(null);
    setEvaluation(null);
    setMessage("本机裁决草稿已清除。");
    setError("");
  }

  const resultQuery = evaluation?.queries[0];
  const safeFilename = `${packet?.packetId ?? "shortlist"}`.replace(/[^a-zA-Z0-9_-]/g, "-");

  const progressValue = packet?.cards.length ? (gradeCount / packet.cards.length) * 100 : 0;

  return <div className="min-h-screen bg-background">
    <header className="border-b bg-card/90">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <a className="flex items-center gap-2 font-semibold tracking-tight" href="/" aria-label="TactiScout 球探工作台首页">
          <span className="flex h-6 items-end gap-0.5" aria-hidden="true"><span className="h-3 w-1 rounded-t-sm bg-primary/60" /><span className="h-5 w-1 rounded-t-sm bg-primary" /><span className="h-4 w-1 rounded-t-sm bg-primary/80" /></span>
          TactiScout
        </a>
        <div className="flex items-center gap-3 text-sm text-muted-foreground"><span>独立评审 · 裁决与质量评估</span><a className="font-medium text-primary hover:underline" href="/review">打开盲评工作台</a></div>
      </div>
    </header>

    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-7 max-w-3xl space-y-2">
        <Badge variant="secondary">匿名评审流程</Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">先看证据，再看排名。</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">独立评分完成后，逐张裁决匿名候选；裁决锁定前不会读取系统答案键。</p>
      </header>

      {!draft ? <Card className="max-w-3xl">
        <CardHeader><CardTitle>载入独立评分</CardTitle><CardDescription>选择一份原始匿名证据包和至少两份完整评分导出。文件仅在此浏览器处理。</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <label className="grid gap-2 text-sm font-medium" htmlFor="adjudication-packet">匿名评审包 JSON<Input id="adjudication-packet" type="file" accept="application/json,.json" onChange={(event) => setPacketFile(event.currentTarget.files?.[0] ?? null)} /></label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="adjudication-submissions">独立评分文件 <span className="text-xs font-normal text-muted-foreground">至少两位不同评审者</span><Input id="adjudication-submissions" type="file" accept="application/json,.json" multiple onChange={(event) => setSubmissionFiles(Array.from(event.currentTarget.files ?? []))} /></label>
          <Button type="button" onClick={() => void importBlindMaterials()}>验证并开始盲态裁决 →</Button>
          <Alert><AlertDescription>答案键此时不会导入；评分和裁决草稿仅存于本机浏览器。</AlertDescription></Alert>
        </CardContent>
      </Card> : <>
        <div className="mb-6 flex flex-wrap items-center gap-2" aria-label="评测流程">
          <Badge variant="secondary">01 · 独立评分</Badge><span aria-hidden="true" className="text-muted-foreground">→</span>
          <Badge variant={draft.locked ? "secondary" : "default"}>02 · 匿名裁决</Badge><span aria-hidden="true" className="text-muted-foreground">→</span>
          <Badge variant={draft.dataset ? "secondary" : draft.locked ? "default" : "outline"}>03 · 揭示排名并计算</Badge>
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-[19rem_minmax(0,1fr)]">
          <aside className="xl:sticky xl:top-4">
            <Card><CardHeader><Badge variant="outline" className="w-fit">冻结需求</Badge><CardTitle>候选需求</CardTitle><CardDescription>{packet?.roleBrief}</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid gap-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">数据集</dt><dd className="mt-0.5 break-words font-medium">{packet?.snapshot.datasetId}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">来源与范围</dt><dd className="mt-0.5">{packet?.snapshot.publisher} · {packet?.snapshot.scope}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">匿名候选</dt><dd className="mt-0.5 font-medium tabular-nums">{gradeCount} / {packet?.cards.length} 已裁决</dd></div>
                  <div><dt className="text-xs text-muted-foreground">独立评分</dt><dd className="mt-0.5">{draft.bundle.submissions.length} 份完整提交</dd></div>
                  <div><dt className="text-xs text-muted-foreground">快照时间</dt><dd className="mt-0.5">{packet ? new Date(packet.snapshot.asOf).toLocaleDateString("zh-CN") : "—"}</dd></div>
                </dl>
                <div className="space-y-2"><Progress value={progressValue} aria-label="匿名候选裁决进度" /><p className="text-xs text-muted-foreground">已完成 {gradeCount} / {packet?.cards.length} 张</p></div>
                <p className="break-words border-t pt-3 text-xs leading-5 text-muted-foreground">{packet?.snapshot.attribution} · 快照 SHA-256 {packet?.snapshot.sha256.slice(0, 12)}…</p>
                <Alert><AlertDescription>当前页面不显示球员身份、球队、系统名次或模型解释。界面无法验证评审者是否真正独立。</AlertDescription></Alert>
                <Button type="button" variant="destructive" className="w-full" onClick={resetDraft}>清除本机裁决草稿</Button>
              </CardContent>
            </Card>
          </aside>

          <section className="min-w-0 space-y-5" aria-label="匿名候选裁决">
            {!draft.locked && currentCard && <>
              <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-medium text-muted-foreground">匿名裁决</p><h2 className="text-xl font-semibold">候选 {String(activeCardIndex + 1).padStart(2, "0")} <span className="text-sm font-normal text-muted-foreground">/ {String(packet?.cards.length ?? 0).padStart(2, "0")}</span></h2></div><Badge variant={draft.grades[currentCard.cardId] === undefined ? "outline" : "secondary"}>{draft.grades[currentCard.cardId] === undefined ? "待裁决" : "已保存"}</Badge></div>
              <Card><CardHeader><Badge variant="secondary" className="w-fit">独立评审原始判断</Badge><CardTitle>来源证据与评分</CardTitle></CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-2 sm:grid-cols-2">{draft.bundle.submissions.map((submission, index) => {
                    const score = submission.ratings.find(({ cardId }) => cardId === currentCard.cardId)?.rating;
                    return <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm" key={submission.reviewerId}><span className="text-muted-foreground">评审 {index + 1}</span><strong>{gradeLabel(score)}</strong></div>;
                  })}</div>
                  {currentCard.performances.map((performance, performanceIndex) => <section className="space-y-3 border-t pt-4" key={`${performance.competition}:${performance.season}:${performanceIndex}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2"><div className="flex flex-wrap items-baseline gap-2"><strong>{performance.competition}</strong><Badge variant="outline">{performance.season}</Badge></div><span className="text-xs text-muted-foreground">{performance.position ?? "位置未知"}{performance.ageAtSeasonEnd === null ? " · 年龄未知" : ` · ${performance.ageAtSeasonEnd} 岁`}</span></div>
                    <p className="m-0 text-xs text-muted-foreground">样本：{performance.sampleSize.minutes.toLocaleString()} 分钟 · {performance.sampleSize.matches} 场</p>
                    <div className="grid gap-2 sm:grid-cols-2">{performance.metrics.map((metric) => <article className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border p-3 ${metric.status === "missing" ? "bg-muted/60" : "bg-card"}`} key={metric.key}>
                      <div><strong className="block text-base tabular-nums">{metric.status === "missing" || metric.value === null ? "未提供" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(metric.value)}</strong><span className="text-[11px] text-muted-foreground">{metric.unit ?? ""}</span></div>
                      <div className="min-w-0 text-xs leading-5"><span>{metric.definition ?? `指标 ${metric.key}`}</span><small className="mt-1 block text-[11px] text-muted-foreground">来源字段：{metric.sourceField ?? "未提供"}</small></div>
                      {metric.status === "missing" && <small className="col-span-2 text-xs text-amber-900">缺少数据不表示能力较差</small>}
                    </article>)}</div>
                  </section>)}
                  <p className="m-0 break-all border-t pt-3 text-[11px] text-muted-foreground">{packet?.snapshot.derivationRuleset} · 来源快照 SHA-256 {packet?.snapshot.sha256.slice(0, 12)}…</p>
                </CardContent>
              </Card>

              <Card><CardHeader><CardTitle className="text-base">裁决这名匿名候选的适配证据</CardTitle><CardDescription>保留每位评审者的原始分数。不要取平均；证据不足以裁决时选择“未知”。</CardDescription></CardHeader>
                <CardContent className="space-y-4"><fieldset className="m-0 min-w-0 border-0 p-0" disabled={draft.locked}><legend className="sr-only">匿名候选适配评分</legend>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{gradeOptions.map((option) => <label className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 motion-reduce:transition-none ${draft.grades[currentCard.cardId] === option.value ? "border-primary bg-secondary" : "bg-card"}`} key={String(option.value)}>
                    <input className="mt-1 size-4 shrink-0 accent-primary" type="radio" name={`adjudication-${currentCard.cardId}`} value={String(option.value)} checked={draft.grades[currentCard.cardId] === option.value} onChange={() => adjudicate(option.value)} />
                    <span><strong className="block text-sm">{option.label}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.help}</span></span>
                  </label>)}</div>
                </fieldset>
                <details className="rounded-md border px-3 py-2"><summary className="cursor-pointer text-sm font-medium">展开评分锚点</summary><div className="space-y-2 border-t pt-3 text-xs leading-5 text-muted-foreground"><ol className="mb-0 list-decimal space-y-1 pl-5">{shortlistFitRubric.filter(({ value }) => value !== "unknown").map((option) => <li key={option.label}><strong className="text-foreground">{option.label} · {option.detail}：</strong>{option.anchor}</li>)}</ol><p className="mb-0"><strong className="text-foreground">未知：</strong>{shortlistFitRubric.find(({ value }) => value === "unknown")?.anchor} 这些等级是本项目尚未校准的主观适配判断，不是球员能力真值，也不由单个统计值自动换算。</p></div></details></CardContent>
              </Card>

              <div className="flex flex-col items-center justify-between gap-3 sm:flex-row"><Button type="button" variant="outline" onClick={() => setActiveCardIndex((index) => Math.max(0, index - 1))} disabled={activeCardIndex === 0}>← 上一张</Button><span className="text-sm text-muted-foreground">{gradeCount} / {packet?.cards.length} 张已裁决</span>{activeCardIndex < (packet?.cards.length ?? 0) - 1 ? <Button type="button" onClick={() => setActiveCardIndex((index) => Math.min((packet?.cards.length ?? 1) - 1, index + 1))}>下一张 →</Button> : <Button type="button" onClick={() => setActiveCardIndex(0)}>回到第一张 ↺</Button>}</div>
              <Card className="border-primary/20 bg-secondary/40"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><strong className="text-sm">{complete ? "匿名裁决已完成" : "逐张完成独立裁决"}</strong><p className="mb-0 mt-1 text-xs leading-5 text-muted-foreground">{complete ? "锁定后才会显示答案键载入入口。" : `还有 ${(packet?.cards.length ?? 0) - gradeCount} 张卡片待裁决；未知也是有效判断。`}</p></div><Button type="button" className="w-full sm:w-auto" onClick={lockAdjudications} disabled={!complete}>锁定匿名裁决</Button></CardContent></Card>
            </>}

            {draft.locked && !draft.dataset && <Card><CardHeader><Badge variant="secondary" className="w-fit">裁决已锁定</Badge><CardTitle>载入答案键</CardTitle><CardDescription>所有候选已有独立裁决。现在载入单独保存的答案键；评测数据集只使用匿名卡 ID，不会带入球员姓名、球队或来源球员 ID。</CardDescription></CardHeader><CardContent><label className="grid max-w-xl gap-2 text-sm font-medium" htmlFor="answer-key-file">答案键 JSON<Input id="answer-key-file" type="file" accept="application/json,.json" onChange={(event) => void importAnswerKey(event)} /></label></CardContent></Card>}

            {draft.dataset && evaluation && <section className="space-y-5">
              <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><Badge variant="secondary">单条需求评测</Badge><CardTitle className="mt-2">短名单质量结果</CardTitle></div><Badge variant={evaluation.status === "evaluable" ? "default" : "outline"}>{evaluation.status === "evaluable" ? "可评估" : evaluation.status === "partially_evaluable" ? "部分可评估" : "不可评估"}</Badge></div><CardDescription>只适用于「{packet?.roleBrief}」及当前冻结候选池与数据快照，不代表其他需求或完整转会市场。</CardDescription></CardHeader>
                {resultQuery && <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <MetricCard label="双人评分覆盖" value={`${resultQuery.judgmentCoverage.candidatesWithTwoRatings} / ${resultQuery.judgmentCoverage.totalCandidates}`} note="每张匿名卡至少两份评分" />
                  <MetricCard label="全部类别完全一致" value={resultQuery.rawPairwiseAgreement.rate === null ? "—" : `${Math.round(resultQuery.rawPairwiseAgreement.rate * 100)}%`} note={`${resultQuery.rawPairwiseAgreement.agreements} / ${resultQuery.rawPairwiseAgreement.comparablePairs} 对，含 unknown`} />
                  <MetricCard label="数值等级完全一致" value={resultQuery.numericGradeAgreement.rate === null ? "—" : `${Math.round(resultQuery.numericGradeAgreement.rate * 100)}%`} note={`${resultQuery.numericGradeAgreement.agreements} / ${resultQuery.numericGradeAgreement.comparablePairs} 个数值评分对`} />
                  <MetricCard label="双方均选未知" value={String(resultQuery.unknownOutcomePairs.bothUnknown)} note="不计入数值等级一致率" />
                  <MetricCard label="未知与数值分歧" value={String(resultQuery.unknownOutcomePairs.mixedWithNumeric)} note="单独保留，不折算成 0" />
                </CardContent>}
              </Card>

              {resultQuery && <details className="rounded-lg border bg-card"><summary className="cursor-pointer px-4 py-3 text-sm font-medium">查看评审分布与等级分歧</summary><div className="space-y-5 border-t p-4">
                <p className="m-0 text-sm leading-6 text-muted-foreground">以下是当前冻结 query 的描述性统计。0–3 是有序类别，等级差距不代表能力差距；unknown 不进入数值表。</p>
                <div className="grid gap-3 sm:grid-cols-2">{resultQuery.reviewerRatingDistributions.map((distribution, index) => <Card key={distribution.reviewerId}><CardHeader className="p-4"><CardTitle className="text-sm">评审 {index + 1}</CardTitle></CardHeader><CardContent className="space-y-2 p-4 pt-0"><dl className="grid grid-cols-5 gap-2 text-center text-xs">{(["grade0", "grade1", "grade2", "grade3", "unknown"] as const).map((key, gradeIndex) => <div key={key} className="rounded-md bg-muted p-2"><dt className="text-muted-foreground">{gradeIndex === 4 ? "未知" : gradeIndex}</dt><dd className="mt-1 font-semibold tabular-nums">{distribution.ratings[key]}</dd></div>)}</dl><p className="m-0 text-xs text-muted-foreground">{distribution.totalRatings} 张候选卡</p></CardContent></Card>)}</div>
                {resultQuery.reviewerPairComparisons.map((comparison) => {
                  const leftReviewerIndex = resultQuery.reviewerRatingDistributions.findIndex(({ reviewerId }) => reviewerId === comparison.reviewerIds[0]) + 1;
                  const rightReviewerIndex = resultQuery.reviewerRatingDistributions.findIndex(({ reviewerId }) => reviewerId === comparison.reviewerIds[1]) + 1;
                  return <Card key={comparison.reviewerIds.join(":")}><CardHeader><CardTitle className="text-base">评审 {leftReviewerIndex} × 评审 {rightReviewerIndex}</CardTitle><CardDescription>{comparison.sharedCandidateCount} 张候选卡有双方评分；其中 {comparison.numericPairs} 对是两边都有 0–3 数值等级。</CardDescription></CardHeader><CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">{[["同分", comparison.exactAgreements], ["相差一档", comparison.oneGradeApart], ["相差两档或以上", comparison.twoOrMoreGradesApart], ["双方未知", comparison.unknownOutcomePairs.bothUnknown], ["未知 / 数值", comparison.unknownOutcomePairs.mixedWithNumeric]].map(([label, value]) => <div className="rounded-md border p-2" key={String(label)}><span className="block text-muted-foreground">{label}</span><strong className="mt-1 block tabular-nums">{value}</strong></div>)}</div>
                    <div className="overflow-x-auto"><Table><caption className="p-2 text-left text-xs text-muted-foreground">行：评审 {leftReviewerIndex}；列：评审 {rightReviewerIndex}。只计双方都有数值等级的卡片。</caption><TableHeader><TableRow><TableHead>等级</TableHead>{[0, 1, 2, 3].map((grade) => <TableHead key={grade}>{grade}</TableHead>)}</TableRow></TableHeader><TableBody>{comparison.numericGradeContingency.map((row, grade) => <TableRow key={grade}><TableHead>{grade}</TableHead>{row.map((count, column) => <TableCell key={column}>{count}</TableCell>)}</TableRow>)}</TableBody></Table></div>
                  </CardContent></Card>;
                })}
              </div></details>}

              <Card><CardHeader><Badge variant="outline" className="w-fit">系统排序</Badge><CardTitle className="text-base">各系统 nDCG@5</CardTitle></CardHeader><CardContent className="space-y-2">{resultQuery?.systems.map((system) => <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3" key={`${system.systemId}:${system.runId}`}><div className="min-w-0"><strong className="break-all text-sm">{system.systemId}</strong><p className="m-0 text-xs text-muted-foreground">{system.runId} · {system.rankedCandidateCount} 位候选</p></div><strong className="font-mono tabular-nums">{system.ndcgAt5 === null ? "—" : system.ndcgAt5.toFixed(4)}</strong></div>)}</CardContent></Card>
              {resultQuery && resultQuery.notEvaluableReasons.length > 0 && <Alert variant="destructive"><AlertDescription><strong>当前不能计算 nDCG 的原因</strong><ul className="mb-0 mt-2 list-disc space-y-1 pl-5">{resultQuery.notEvaluableReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></AlertDescription></Alert>}
              <Alert><AlertDescription>原始一致率只是本批评审结果的描述，不证明量表可靠或评审者独立。单个 query 的 nDCG 不是普遍推荐准确率；unknown 和缺失标签均未按 0 分处理。</AlertDescription></Alert>
              <div className="flex flex-col gap-2 sm:flex-row"><Button type="button" variant="outline" onClick={() => downloadJson(`tactiscout-quality-input-${safeFilename}.json`, draft.dataset!)}>下载可复算评测输入 JSON</Button><Button type="button" onClick={() => downloadJson(`tactiscout-quality-result-${safeFilename}.json`, evaluation)}>下载评测结果 JSON</Button></div>
            </section>}
          </section>
        </div>
      </>}

      {error && <Alert variant="destructive" className="mt-5"><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert className="mt-5"><AlertDescription>{message}</AlertDescription></Alert>}
    </main>
    <footer className="mx-auto flex max-w-7xl flex-col gap-1 border-t px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:px-6"><span className="font-medium text-foreground">TactiScout · 单条需求人工评估</span><span>先锁定匿名裁决，再载入答案键</span></footer>
  </div>;
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return <Card><CardHeader className="gap-2 p-4"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl tabular-nums">{value}</CardTitle></CardHeader><CardContent className="p-4 pt-0 text-xs text-muted-foreground">{note}</CardContent></Card>;
}
