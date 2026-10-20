import { AbilityMetricDefinitions } from "../../../../../src/domain/player-abilities.js";
import { useEffect, useState, type ChangeEvent } from "react";
import {
  createShortlistReviewWorkspace,
  type ShortlistReviewGrade,
  type ShortlistReviewSession,
} from "../../../../../src/domain/shortlist-review.js";
import { shortlistFitRubric } from "../../../../../src/domain/shortlist-fit-rubric.js";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Progress } from "@/shared/ui/progress";
import { ProductHeader } from "@/shared/ui/product-header";
import { Upload } from "lucide-react";

const reviewerIdStorageKey = "tactiscout:shortlist-review:v1:reviewer-id";
function newReviewerId(): string {
  return `reviewer-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

function savedReviewerId(): string {
  try {
    const existing = window.localStorage.getItem(reviewerIdStorageKey);
    if (existing) return existing;
    const created = newReviewerId();
    window.localStorage.setItem(reviewerIdStorageKey, created);
    return created;
  } catch {
    return newReviewerId();
  }
}

function formatMetricValue(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function downloadSubmission(session: ShortlistReviewSession, content: string): void {
  const filenamePart = `${session.packet.packetId}-${session.reviewerId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `tactiscout-review-${filenamePart}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ShortlistReviewWorkbench() {
  const [workspace] = useState(() => createShortlistReviewWorkspace({
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  }));
  const [session, setSession] = useState<ShortlistReviewSession | null>(null);
  const [reviewerId, setReviewerId] = useState(savedReviewerId);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const activeSession = workspace.loadActive();
      if (activeSession) {
        setSession(activeSession);
        setReviewerId(activeSession.reviewerId);
        const firstUnrated = activeSession.packet.cards.findIndex(({ cardId }) => (
          !Object.hasOwn(activeSession.ratings, cardId)
        ));
        setActiveCardIndex(firstUnrated < 0 ? 0 : firstUnrated);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法读取本机盲评草稿。");
    }
  }, [workspace]);

  const cardCount = session?.packet.cards.length ?? 0;
  const ratedCount = session ? Object.keys(session.ratings).length : 0;
  const currentCard = session?.packet.cards[activeCardIndex] ?? null;
  const currentRating = currentCard && session ? session.ratings[currentCard.cardId] : undefined;
  const complete = Boolean(session && ratedCount === cardCount);

  async function importPacket(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const importedSession = workspace.open(await file.text(), reviewerId);
      setSession(importedSession);
      const firstUnrated = importedSession.packet.cards.findIndex(({ cardId }) => (
        !Object.hasOwn(importedSession.ratings, cardId)
      ));
      setActiveCardIndex(firstUnrated < 0 ? 0 : firstUnrated);
      setMessage(firstUnrated < 0 ? "已恢复这份评审草稿。" : "评审包已载入；你的评分会自动保存在本机浏览器。 ");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法导入这份评审包。");
      setMessage("");
    } finally {
      event.currentTarget.value = "";
    }
  }

  function rateCurrentCard(rating: ShortlistReviewGrade) {
    if (!session || !currentCard) return;
    try {
      const updated = workspace.rate(session, currentCard.cardId, rating);
      setSession(updated);
      setMessage("评分已保存在本机浏览器。可以继续查看证据或前往下一张卡片。");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "这条评分无法保存。");
    }
  }

  function exportRatings() {
    if (!session) return;
    try {
      const submission = workspace.createSubmission(session);
      downloadSubmission(session, `${JSON.stringify(submission, null, 2)}\n`);
      setMessage("匿名评分文件已导出。先保存并锁定独立评分，再进行身份与排名核对。");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "尚不能导出完整评审结果。");
    }
  }

  function changeReviewer() {
    try {
      workspace.deactivate();
      const nextReviewerId = newReviewerId();
      window.localStorage.setItem(reviewerIdStorageKey, nextReviewerId);
      setSession(null);
      setReviewerId(nextReviewerId);
      setActiveCardIndex(0);
      setMessage("已生成新的本机评审代号。导入同一评审包即可建立彼此隔离的草稿。");
      setError("");
    } catch {
      setError("本机存储暂时不可用，无法切换评审草稿。");
    }
  }

  function clearCurrentReview() {
    if (!session || !window.confirm("清除这份本机评审草稿？已记录的评分将从此浏览器删除。")) return;
    try {
      const nextReviewerId = newReviewerId();
      window.localStorage.setItem(reviewerIdStorageKey, nextReviewerId);
      workspace.clear(session);
      setSession(null);
      setActiveCardIndex(0);
      setReviewerId(nextReviewerId);
      setMessage("本机盲评草稿已清除。评审包与已导出的评分文件不受影响。");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法清除本机盲评草稿。");
    }
  }

  return <div className="min-h-screen bg-background">
    <ProductHeader page="review" />
    <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 max-w-3xl"><Badge variant="secondary">独立评审</Badge><h1 className="mb-0 mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">只看证据，独立判断适配。</h1><p className="mb-0 mt-2 text-sm leading-6 text-muted-foreground">评审包隐藏球员身份、球队、系统排名和模型解释。数据缺失时选“未知”，不要把未知当作不适合。</p></div>

      {!session ? <Card className="mx-auto max-w-2xl">
        <CardHeader><CardTitle>载入匿名评审包</CardTitle><CardDescription>卡片展示冻结职责、能力属性与比赛记录。答案键不是评审材料，导入时会被拒绝。</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <label className="grid gap-1.5 text-sm font-medium" htmlFor="reviewer-id">本机评审代号<span className="text-xs font-normal text-muted-foreground">不要填写姓名或邮箱</span></label>
          <Input id="reviewer-id" value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} maxLength={80} autoComplete="off" />
          <label className="grid min-h-24 cursor-pointer place-items-center gap-1 rounded-lg border border-dashed bg-muted/30 p-4 text-center hover:bg-muted/60">
            <Upload className="size-5 text-primary" aria-hidden="true" /><strong className="text-sm">选择匿名评审包 JSON</strong><span className="text-xs text-muted-foreground">文件只在本机浏览器读取；评分不需要模型或 API。</span>
            <Input id="review-packet-file" className="max-w-64 text-xs" type="file" accept="application/json,.json" onChange={(event) => void importPacket(event)} />
          </label>
          <details className="rounded-lg border px-4 py-3"><summary className="cursor-pointer text-sm font-medium">评审包从哪里来？</summary><div className="mt-3 space-y-2 border-t pt-3 text-xs leading-5 text-muted-foreground">
            <p className="m-0"><strong className="text-foreground">受邀评审者：</strong>向项目维护者索取匿名评审包。你不需要运行 Agent；请勿打开或转发单独保存的答案键。</p>
            <p className="m-0"><strong className="text-foreground">项目维护者：</strong>从通过 Harness 检查的本地运行生成盲评包和独立答案键；运行 <code className="rounded bg-muted px-1 py-0.5">pnpm export:shortlist-review -- --help</code> 查看参数。只把匿名评审包交给评审者，评分完成并锁定后再进行裁决。</p>
          </div></details>
          <p className="m-0 flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-primary" />评分草稿保存在此浏览器；导出前可以关闭页面再回来继续。</p>
        </CardContent>
      </Card> : <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="lg:sticky lg:top-4"><CardHeader><CardTitle>本次评审</CardTitle><CardDescription>匿名候选数据和来源范围</CardDescription></CardHeader><CardContent className="space-y-4">
          <blockquote className="m-0 border-l-2 border-primary/40 pl-3 text-sm leading-6">{session.packet.roleBrief}</blockquote>
          <dl className="m-0 divide-y text-xs">{[
            ["数据来源", `${session.packet.snapshot.source} · ${session.packet.snapshot.publisher}`], ["比赛范围", session.packet.snapshot.scope], ["数据集", session.packet.snapshot.datasetId],
            ["快照时间", new Date(session.packet.snapshot.asOf).toLocaleDateString("zh-CN")], ["评审代号", session.reviewerId], ["候选卡片", `${ratedCount} / ${cardCount} 已评分`],
          ].map(([label, value]) => <div className="grid grid-cols-[78px_minmax(0,1fr)] gap-2 py-2" key={label}><dt className="text-muted-foreground">{label}</dt><dd className="m-0 break-words">{value}</dd></div>)}</dl>
          <Progress value={cardCount ? (ratedCount / cardCount) * 100 : 0} aria-label="匿名候选评审进度" />
          <p className="m-0 text-xs leading-5 text-muted-foreground">{session.packet.snapshot.attribution} · {session.packet.snapshot.license.url ? <a className="text-primary underline underline-offset-4" href={session.packet.snapshot.license.url} target="_blank" rel="noreferrer">{session.packet.snapshot.license.name}</a> : session.packet.snapshot.license.name}</p>
          <details className="rounded-md border px-3 py-2"><summary className="cursor-pointer text-xs font-medium">查看评审说明</summary><ul className="mb-0 mt-2 list-disc space-y-1 border-t pt-2 pl-5 text-xs leading-5 text-muted-foreground">{session.packet.reviewerInstructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ul></details>
          <p className="m-0 text-xs leading-5 text-muted-foreground">评分与匿名卡 ID 仅保存在此浏览器中。每位评审者应使用自己的代号和独立草稿；系统无法验证评审者身份或独立性。</p>
          <div className="grid gap-2"><Button type="button" variant="outline" size="sm" onClick={changeReviewer}>为另一位评审者新建草稿</Button><Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={clearCurrentReview}>清除此浏览器中的当前草稿</Button>
            <label className="grid gap-1 text-xs text-muted-foreground" htmlFor="review-packet-replace">载入另一份评审包<Input id="review-packet-replace" type="file" accept="application/json,.json" onChange={(event) => void importPacket(event)} /></label>
          </div>
        </CardContent></Card>

        <section className="min-w-0 space-y-4" aria-label="匿名候选评分">
          {currentCard && <>
            <div className="flex items-center justify-between gap-3"><div><Badge variant="outline">匿名候选 {String(activeCardIndex + 1).padStart(2, "0")} / {String(cardCount).padStart(2, "0")}</Badge></div><Badge variant={currentRating === undefined ? "outline" : "secondary"}>{currentRating === undefined ? "待评" : "已保存"}</Badge></div>
            <Card className="gap-0">
              <CardHeader><Badge variant="secondary" className="w-fit">冻结来源证据</Badge><CardTitle className="text-lg">候选证据</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {currentCard.performances.map((performance, performanceIndex) => <section className="space-y-3 border-t pt-4" key={`${performance.competition}:${performance.season}:${performanceIndex}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2"><div className="flex flex-wrap items-baseline gap-2"><strong className="text-sm">{performance.competition}</strong><span className="text-xs text-muted-foreground">{performance.season}</span></div><span className="text-xs text-muted-foreground">{performance.position ?? "位置未知"}{performance.ageAtSeasonEnd === null ? " · 年龄未知" : ` · ${performance.ageAtSeasonEnd} 岁`}</span></div>
                  <p className="m-0 text-xs text-muted-foreground">{performance.basis === "ability_profile" ? "职责属性评价，不适用比赛分钟" : `样本：${performance.sampleSize.minutes?.toLocaleString() ?? "未知"} 分钟 · ${performance.sampleSize.matches ?? "未知"} 场`}</p>
                  <div className="grid gap-2 sm:grid-cols-2">{performance.metrics.map((metric) => <article className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border p-3 ${metric.status === "missing" ? "bg-muted/50" : "bg-card"}`} key={metric.key}>
                    <div><strong className="block text-base tabular-nums">{metric.status === "missing" || metric.value === null ? "未提供" : formatMetricValue(metric.value)}</strong><span className="text-[11px] text-muted-foreground">{metric.unit ?? ""}</span></div>
                    <div className="min-w-0 text-xs leading-5"><strong className="block font-semibold">{metric.label ?? AbilityMetricDefinitions.find((definition) => definition.key === metric.key)?.label ?? metric.key}</strong><span className="text-muted-foreground">{metric.definition ?? "暂无指标说明"}</span>{metric.sourceField && <small className="mt-1 block text-[11px] text-muted-foreground">字段：{metric.sourceField}</small>}</div>
                    {metric.status === "missing" && <small className="col-span-2 text-[11px] text-warning">缺少数据不表示能力较差</small>}
                  </article>)}</div>
                </section>)}
                <p className="m-0 break-all border-t pt-3 text-[11px] text-muted-foreground">{session.packet.snapshot.derivationRuleset} · 来源快照 SHA-256 {session.packet.snapshot.sha256.slice(0, 12)}…</p>
              </CardContent>
            </Card>

            <Card><CardHeader><CardTitle className="text-base">这名候选与冻结职责的适配证据有多强？</CardTitle><CardDescription>只按当前需求和来源材料判断。证据不足时选“未知”，不要猜测缺失属性。</CardDescription></CardHeader>
              <CardContent className="space-y-4"><fieldset className="m-0 min-w-0 border-0 p-0"><legend className="sr-only">候选适配评分</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{shortlistFitRubric.map((choice) => <label className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/60 motion-reduce:transition-none ${currentRating === choice.value ? "border-primary bg-secondary" : "bg-card"}`} key={String(choice.value)}>
                  <input className="mt-1 size-4 shrink-0 accent-primary" type="radio" name={`rating-${currentCard.cardId}`} value={String(choice.value)} checked={currentRating === choice.value} onChange={() => rateCurrentCard(choice.value)} />
                  <span><strong className="block text-sm">{choice.label}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{choice.detail}</span></span>
                </label>)}</div>
              </fieldset>
              <details className="rounded-md border px-3 py-2"><summary className="cursor-pointer text-xs font-medium">展开评分锚点</summary><div className="space-y-2 border-t pt-2 text-xs leading-5 text-muted-foreground"><ol className="mb-0 list-decimal space-y-1 pl-5">{shortlistFitRubric.filter(({ value }) => value !== "unknown").map((choice) => <li key={choice.label}><strong className="text-foreground">{choice.label} · {choice.detail}：</strong>{choice.anchor}</li>)}</ol><p className="mb-0"><strong className="text-foreground">未知：</strong>{shortlistFitRubric.find(({ value }) => value === "unknown")?.anchor} 这些等级是本项目尚未校准的主观适配判断，不是球员能力真值，也不由单个统计值自动换算。</p></div></details></CardContent>
            </Card>

            <div className="flex flex-col items-center justify-between gap-3 sm:flex-row"><Button type="button" variant="outline" onClick={() => setActiveCardIndex((index) => Math.max(0, index - 1))} disabled={activeCardIndex === 0}>← 上一张</Button><span className="text-xs text-muted-foreground">{ratedCount} / {cardCount} 张已完成</span>{activeCardIndex < cardCount - 1 ? <Button type="button" onClick={() => setActiveCardIndex((index) => Math.min(cardCount - 1, index + 1))}>下一张 →</Button> : <Button type="button" onClick={() => setActiveCardIndex(0)}>回到第一张 ↺</Button>}</div>
            <Card className="border-primary/20 bg-secondary/40"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><strong className="text-sm">{complete ? "独立评分已完成" : "完成所有候选后导出"}</strong><p className="mb-0 mt-1 text-xs leading-5 text-muted-foreground">{complete ? "导出的文件只包含匿名卡 ID、评审代号和评分。" : `还有 ${cardCount - ratedCount} 张卡片待评；每张都可以选择“未知”。`}</p></div><Button type="button" className="w-full sm:w-auto" onClick={exportRatings} disabled={!complete}>导出匿名评分</Button></CardContent></Card>
          </>}
        </section>
      </div>}

      {error && <Alert variant="destructive" className="mt-4"><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert className="mt-4"><AlertDescription>{message}</AlertDescription></Alert>}
    </main>
    <footer className="mx-auto flex max-w-7xl flex-col gap-1 border-t px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:px-6"><span className="font-medium text-foreground">TactiScout · 独立短名单评审</span><span>匿名证据 · 人工判断</span></footer>
  </div>;
}
