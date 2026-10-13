import { useEffect, useState, type ChangeEvent } from "react";
import {
  createShortlistReviewWorkspace,
  type ShortlistReviewGrade,
  type ShortlistReviewSession,
} from "../../src/domain/shortlist-review.js";
import { shortlistFitRubric } from "../../src/domain/shortlist-fit-rubric.js";

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

  return <div className="app-shell review-app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="TactiScout 球探工作台首页">
        <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
        <span>TactiScout</span>
      </a>
      <div className="topbar-meta">
        <span className="topbar-caption">独立评分 <span>·</span> 盲评工作台</span>
        <a className="text-button" href="/">返回球探工作台</a>
      </div>
    </header>

    <main className="main-layout review-layout">
      <section className="review-intro">
        <div>
          <p className="eyebrow">INDEPENDENT SHORTLIST REVIEW</p>
          <h1>只看比赛证据，<em>独立判断适配。</em></h1>
          <p className="intro-copy">评审包隐藏球员身份、球队、系统排名和模型解释。数据缺失时选“未知”，不要把未知当作不适合。</p>
        </div>
        <div className="review-intro-mark"><span>02</span><span>BLIND<br />REVIEW</span></div>
      </section>

      {!session ? <section className="review-import-card">
        <div className="review-panel-heading"><div><span className="section-kicker">01 / OPEN PACKET</span><h2>载入匿名评审包</h2></div><span className="review-panel-index">A</span></div>
        <p>如果你是受邀评审者，请载入项目方提供的匿名评审包。卡片只展示冻结职责和比赛证据；答案键不是评审材料，导入会被拒绝。</p>
        <label className="field-label" htmlFor="reviewer-id">本机评审代号 <span className="field-hint">不要填写姓名或邮箱</span></label>
        <input id="reviewer-id" className="text-input review-reviewer-id" value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} maxLength={80} autoComplete="off" />
        <label className="review-file-picker" htmlFor="review-packet-file">
          <span className="review-file-picker-icon" aria-hidden="true">↥</span>
          <span><strong>选择匿名评审包 JSON</strong><small>文件只在本机浏览器读取；评分不需要模型或 API。</small></span>
          <input id="review-packet-file" type="file" accept="application/json,.json" onChange={(event) => void importPacket(event)} />
        </label>
        <details className="review-packet-help">
          <summary>评审包从哪里来？</summary>
          <div className="review-packet-help-content">
            <p><strong>受邀评审者：</strong>向项目维护者索取匿名评审包。你不需要运行 Agent；请勿打开或转发单独保存的答案键。</p>
            <p><strong>项目维护者：</strong>从通过 Harness 检查的本地运行生成盲评包和独立答案键；在仓库终端运行 <code>pnpm export:shortlist-review -- --help</code> 查看所需参数。只把匿名评审包交给评审者，评分完成并锁定后再进行裁决。</p>
          </div>
        </details>
        <div className="review-local-note"><span className="status-dot" />评分草稿保存在此浏览器的 localStorage；导出前可以关闭页面再回来继续。</div>
      </section> : <div className="review-workspace-grid">
        <aside className="review-context-panel" aria-label="评审任务与数据来源">
          <span className="section-kicker">FROZEN REVIEW CONTEXT</span>
          <h2>本次评审</h2>
          <blockquote>{session.packet.roleBrief}</blockquote>
          <dl className="review-context-list">
            <div><dt>数据来源</dt><dd>{session.packet.snapshot.source} · {session.packet.snapshot.publisher}</dd></div>
            <div><dt>比赛范围</dt><dd>{session.packet.snapshot.scope}</dd></div>
            <div><dt>数据集</dt><dd>{session.packet.snapshot.datasetId}</dd></div>
            <div><dt>快照时间</dt><dd>{new Date(session.packet.snapshot.asOf).toLocaleDateString("zh-CN")}</dd></div>
            <div><dt>评审代号</dt><dd>{session.reviewerId}</dd></div>
            <div><dt>候选卡片</dt><dd>{ratedCount} / {cardCount} 已评分</dd></div>
          </dl>
          <div className="review-progress-track" role="progressbar" aria-label="匿名候选评审进度" aria-valuemin={0} aria-valuemax={cardCount} aria-valuenow={ratedCount}><span style={{ width: `${cardCount ? (ratedCount / cardCount) * 100 : 0}%` }} /></div>
          <p className="review-source-attribution">{session.packet.snapshot.attribution} · <a href={session.packet.snapshot.license.url} target="_blank" rel="noreferrer">{session.packet.snapshot.license.name}</a></p>
          <details className="review-instructions"><summary>查看评审说明</summary><ul>{session.packet.reviewerInstructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ul></details>
          <p className="review-private-note">评分与匿名卡 ID 仅保存在此浏览器中。每位评审者应使用自己的代号和独立浏览器草稿；系统无法验证评审者身份或独立性。</p>
          <button type="button" className="text-button review-new-reviewer" onClick={changeReviewer}>为另一位评审者新建草稿</button>
          <button type="button" className="text-button danger-text review-clear-draft" onClick={clearCurrentReview}>清除此浏览器中的当前草稿</button>
          <label className="review-replace-file" htmlFor="review-packet-replace">载入另一份评审包<input id="review-packet-replace" type="file" accept="application/json,.json" onChange={(event) => void importPacket(event)} /></label>
        </aside>

        <section className="review-card-area" aria-label="匿名候选评分">
          {currentCard && <>
            <div className="review-card-progress-row"><div><span className="section-kicker">ANONYMOUS PLAYER</span><strong>匿名候选 {String(activeCardIndex + 1).padStart(2, "0")} <small>/ {String(cardCount).padStart(2, "0")}</small></strong></div><span className="review-current-state">{currentRating === undefined ? "待评" : "已保存"}</span></div>
            <article className="review-evidence-card">
              <div className="review-evidence-heading"><div><span className="report-section-label">冻结来源证据</span><h2>比赛表现样本</h2></div></div>
              {currentCard.performances.map((performance, performanceIndex) => <section className="review-performance" key={`${performance.competition}:${performance.season}:${performanceIndex}`}>
                <div className="review-performance-heading"><div><strong>{performance.competition}</strong><span>{performance.season}</span></div><span>{performance.position ?? "位置未知"}{performance.ageAtSeasonEnd === null ? " · 年龄未知" : ` · ${performance.ageAtSeasonEnd} 岁`}</span></div>
                <p className="review-sample-size">样本：{performance.sampleSize.minutes.toLocaleString()} 分钟 · {performance.sampleSize.matches} 场</p>
                <div className="review-metric-list">{performance.metrics.map((metric) => <article className={`review-metric ${metric.status === "missing" ? "review-metric-missing" : ""}`} key={metric.key}>
                  <div className="review-metric-value"><strong>{metric.status === "missing" || metric.value === null ? "未提供" : formatMetricValue(metric.value)}</strong><span>{metric.unit ?? ""}</span></div>
                  <div className="review-metric-definition"><span>{metric.definition ?? `指标 ${metric.key}`}</span><small>来源字段：{metric.sourceField ?? "未提供"}</small></div>
                  {metric.status === "missing" && <small className="review-missing-note">缺少数据不表示能力较差</small>}
                </article>)}</div>
              </section>)}
              <small className="review-card-footer">{session.packet.snapshot.derivationRuleset} · 来源快照 SHA-256 {session.packet.snapshot.sha256.slice(0, 12)}…</small>
            </article>

            <fieldset className="review-rating-fieldset">
              <legend>这名候选与冻结职责的适配证据有多强？</legend>
              <p>只按当前需求和来源材料判断。证据不足时选“未知”，不要猜测缺失属性。</p>
              <div className="review-rating-options">{shortlistFitRubric.map((choice) => <label className={`review-rating-option ${currentRating === choice.value ? "selected" : ""}`} key={String(choice.value)}>
                <input type="radio" name={`rating-${currentCard.cardId}`} value={String(choice.value)} checked={currentRating === choice.value} onChange={() => rateCurrentCard(choice.value)} />
                <span className="review-rating-score">{choice.label}</span><span className="review-rating-detail">{choice.detail}</span>
              </label>)}</div>
              <details className="review-rubric"><summary>展开评分锚点</summary><ol>{shortlistFitRubric.filter(({ value }) => value !== "unknown").map((choice) => <li key={choice.label}><strong>{choice.label} · {choice.detail}：</strong>{choice.anchor}</li>)}</ol><p><strong>未知：</strong>{shortlistFitRubric.find(({ value }) => value === "unknown")?.anchor} 这些等级是本项目尚未校准的主观适配判断，不是球员能力真值，也不由单个统计值自动换算。</p></details>
            </fieldset>

            <div className="review-card-actions"><button type="button" className="secondary-button" onClick={() => setActiveCardIndex((index) => Math.max(0, index - 1))} disabled={activeCardIndex === 0}>← 上一张</button><span>{ratedCount} / {cardCount} 张已完成</span>{activeCardIndex < cardCount - 1 ? <button type="button" className="submit-button review-next-button" onClick={() => setActiveCardIndex((index) => Math.min(cardCount - 1, index + 1))}>下一张 <span aria-hidden="true">→</span></button> : <button type="button" className="submit-button review-next-button" onClick={() => setActiveCardIndex(0)}>回到第一张 <span aria-hidden="true">↺</span></button>}</div>
            <div className="review-export-card"><div><strong>{complete ? "独立评分已完成" : "完成所有候选后导出"}</strong><p>{complete ? "导出的文件只包含匿名卡 ID、评审代号和评分。" : `还有 ${cardCount - ratedCount} 张卡片待评；每张都可以选择“未知”。`}</p></div><button type="button" className="submit-button" onClick={exportRatings} disabled={!complete}>导出匿名评分 <span aria-hidden="true">↓</span></button></div>
          </>}
        </section>
      </div>}

      {error && <p className="error-message review-message" role="alert">{error}</p>}
      {message && <p className="plan-message review-message" role="status" aria-live="polite">{message}</p>}
    </main>
    <footer className="site-footer"><span>TactiScout <b>·</b> Independent shortlist review</span><span>ANONYMOUS EVIDENCE. HUMAN JUDGMENT.</span></footer>
  </div>;
}
