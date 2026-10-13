import { useEffect, useState, type ChangeEvent } from "react";
import { z } from "zod/v4";
import {
  ShortlistFitGradeSchema,
  type ShortlistReviewGrade,
} from "../../src/domain/shortlist-review.js";
import { shortlistFitRubric } from "../../src/domain/shortlist-fit-rubric.js";
import {
  createShortlistQualityDataset,
  parseShortlistAdjudicationBundle,
  type ShortlistAdjudicationBundle,
} from "../../src/evals/shortlist-evaluation-dataset.js";
import {
  evaluateShortlistQuality,
  ShortlistQualityDatasetSchema,
  type ShortlistQualityEvaluation,
  type ShortlistQualityDataset,
} from "../../src/evals/shortlist-quality-evaluation.js";

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

  return <div className="app-shell review-app-shell adjudication-app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="TactiScout 球探工作台首页">
        <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
        <span>TactiScout</span>
      </a>
      <div className="topbar-meta">
        <span className="topbar-caption">独立评审 <span>·</span> 裁决与质量评估</span>
        <a className="text-button" href="/review">打开盲评工作台</a>
      </div>
    </header>

    <main className="main-layout review-layout adjudication-layout">
      <section className="review-intro">
        <div>
          <p className="eyebrow">HUMAN SHORTLIST EVALUATION</p>
          <h1>先看证据，<em>再看排名。</em></h1>
          <p className="intro-copy">独立评分完成后，逐张裁决匿名候选；裁决锁定前不会读取系统答案键。</p>
        </div>
        <div className="review-intro-mark"><span>03</span><span>ADJUDICATE<br />&amp; EVALUATE</span></div>
      </section>

      {!draft ? <section className="review-import-card adjudication-import-card">
        <div className="review-panel-heading"><div><span className="section-kicker">01 / BLIND MATERIALS</span><h2>载入独立评分</h2></div><span className="review-panel-index">A</span></div>
        <p>选择一份原始匿名证据包和至少两份完整评分导出。文件仅在此浏览器处理。</p>
        <label className="field-label" htmlFor="adjudication-packet">匿名评审包 JSON</label>
        <input id="adjudication-packet" className="file-input" type="file" accept="application/json,.json" onChange={(event) => setPacketFile(event.currentTarget.files?.[0] ?? null)} />
        <label className="field-label" htmlFor="adjudication-submissions">独立评分文件 <span className="field-hint">至少两位不同评审者</span></label>
        <input id="adjudication-submissions" className="file-input" type="file" accept="application/json,.json" multiple onChange={(event) => setSubmissionFiles(Array.from(event.currentTarget.files ?? []))} />
        <button type="button" className="submit-button adjudication-load-button" onClick={() => void importBlindMaterials()}>验证并开始盲态裁决 <span aria-hidden="true">→</span></button>
        <div className="review-local-note"><span className="status-dot" />答案键此时不会导入；评分和裁决草稿仅存于本机 localStorage。</div>
      </section> : <>
        <div className="adjudication-steps" aria-label="评测流程">
          <span className="complete">01 <b>独立评分</b></span><i aria-hidden="true" /><span className={draft.locked ? "complete" : "current"}>02 <b>匿名裁决</b></span><i aria-hidden="true" /><span className={draft.dataset ? "complete" : draft.locked ? "current" : "pending"}>03 <b>揭示排名并计算</b></span>
        </div>
        <div className="review-workspace-grid adjudication-workspace-grid">
          <aside className="review-context-panel adjudication-context-panel" aria-label="裁决任务与评测进度">
            <span className="section-kicker">FROZEN QUERY</span>
            <h2>候选需求</h2>
            <blockquote>{packet?.roleBrief}</blockquote>
            <dl className="review-context-list">
              <div><dt>数据集</dt><dd>{packet?.snapshot.datasetId}</dd></div>
              <div><dt>来源与范围</dt><dd>{packet?.snapshot.publisher} · {packet?.snapshot.scope}</dd></div>
              <div><dt>匿名候选</dt><dd>{gradeCount} / {packet?.cards.length} 已裁决</dd></div>
              <div><dt>独立评分</dt><dd>{draft.bundle.submissions.length} 份完整提交</dd></div>
              <div><dt>快照时间</dt><dd>{packet ? new Date(packet.snapshot.asOf).toLocaleDateString("zh-CN") : "—"}</dd></div>
            </dl>
            <div className="review-progress-track" role="progressbar" aria-label="匿名候选裁决进度" aria-valuemin={0} aria-valuemax={packet?.cards.length ?? 0} aria-valuenow={gradeCount}><span style={{ width: `${packet?.cards.length ? (gradeCount / packet.cards.length) * 100 : 0}%` }} /></div>
            <p className="review-source-attribution">{packet?.snapshot.attribution} · 快照 SHA-256 {packet?.snapshot.sha256.slice(0, 12)}…</p>
            <p className="review-private-note">当前页面不显示球员身份、球队、系统名次或模型解释。界面无法验证评审者是否真正独立。</p>
            <button type="button" className="text-button danger-text review-clear-draft" onClick={resetDraft}>清除本机裁决草稿</button>
          </aside>

          <section className="review-card-area adjudication-card-area" aria-label="匿名候选裁决">
            {!draft.locked && currentCard && <>
              <div className="review-card-progress-row"><div><span className="section-kicker">BLIND ADJUDICATION</span><strong>匿名候选 {String(activeCardIndex + 1).padStart(2, "0")} <small>/ {String(packet?.cards.length ?? 0).padStart(2, "0")}</small></strong></div><span className="review-current-state">{draft.grades[currentCard.cardId] === undefined ? "待裁决" : "已保存"}</span></div>
              <article className="review-evidence-card">
                <div className="review-evidence-heading"><div><span className="report-section-label">独立评审原始判断</span><h2>来源证据与评分</h2></div></div>
                <div className="adjudication-reviewer-scores">{draft.bundle.submissions.map((submission, index) => {
                  const score = submission.ratings.find(({ cardId }) => cardId === currentCard.cardId)?.rating;
                  return <div className="adjudication-reviewer-score" key={submission.reviewerId}><span>评审 {index + 1}</span><strong>{gradeLabel(score)}</strong></div>;
                })}</div>
                {currentCard.performances.map((performance, performanceIndex) => <section className="review-performance" key={`${performance.competition}:${performance.season}:${performanceIndex}`}>
                  <div className="review-performance-heading"><div><strong>{performance.competition}</strong><span>{performance.season}</span></div><span>{performance.position ?? "位置未知"}{performance.ageAtSeasonEnd === null ? " · 年龄未知" : ` · ${performance.ageAtSeasonEnd} 岁`}</span></div>
                  <p className="review-sample-size">样本：{performance.sampleSize.minutes.toLocaleString()} 分钟 · {performance.sampleSize.matches} 场</p>
                  <div className="review-metric-list">{performance.metrics.map((metric) => <article className={`review-metric ${metric.status === "missing" ? "review-metric-missing" : ""}`} key={metric.key}>
                    <div className="review-metric-value"><strong>{metric.status === "missing" || metric.value === null ? "未提供" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(metric.value)}</strong><span>{metric.unit ?? ""}</span></div>
                    <div className="review-metric-definition"><span>{metric.definition ?? `指标 ${metric.key}`}</span><small>来源字段：{metric.sourceField ?? "未提供"}</small></div>
                    {metric.status === "missing" && <small className="review-missing-note">缺少数据不表示能力较差</small>}
                  </article>)}</div>
                </section>)}
                <small className="review-card-footer">{packet?.snapshot.derivationRuleset} · 来源快照 SHA-256 {packet?.snapshot.sha256.slice(0, 12)}…</small>
              </article>
              <fieldset className="review-rating-fieldset adjudication-grade-fieldset" disabled={draft.locked}>
                <legend>裁决这名匿名候选的适配证据</legend>
                <p>保留每位评审者的原始分数。不要取平均；证据不足以裁决时选择“未知”。</p>
                <div className="review-rating-options">{gradeOptions.map((option) => <label className={`review-rating-option ${draft.grades[currentCard.cardId] === option.value ? "selected" : ""}`} key={String(option.value)}>
                  <input type="radio" name={`adjudication-${currentCard.cardId}`} value={String(option.value)} checked={draft.grades[currentCard.cardId] === option.value} onChange={() => adjudicate(option.value)} />
                  <span className="review-rating-score">{option.label}</span><span className="review-rating-detail">{option.help}</span>
                </label>)}</div>
                <details className="review-rubric"><summary>展开评分锚点</summary><ol>{shortlistFitRubric.filter(({ value }) => value !== "unknown").map((option) => <li key={option.label}><strong>{option.label} · {option.detail}：</strong>{option.anchor}</li>)}</ol><p><strong>未知：</strong>{shortlistFitRubric.find(({ value }) => value === "unknown")?.anchor} 这些等级是本项目尚未校准的主观适配判断，不是球员能力真值，也不由单个统计值自动换算。</p></details>
              </fieldset>
              <div className="review-card-actions"><button type="button" className="secondary-button" onClick={() => setActiveCardIndex((index) => Math.max(0, index - 1))} disabled={activeCardIndex === 0}>← 上一张</button><span>{gradeCount} / {packet?.cards.length} 张已裁决</span>{activeCardIndex < (packet?.cards.length ?? 0) - 1 ? <button type="button" className="submit-button review-next-button" onClick={() => setActiveCardIndex((index) => Math.min((packet?.cards.length ?? 1) - 1, index + 1))}>下一张 <span aria-hidden="true">→</span></button> : <button type="button" className="submit-button review-next-button" onClick={() => setActiveCardIndex(0)}>回到第一张 <span aria-hidden="true">↺</span></button>}</div>
              <div className="review-export-card"><div><strong>{complete ? "匿名裁决已完成" : "逐张完成独立裁决"}</strong><p>{complete ? "锁定后才会显示答案键载入入口。" : `还有 ${(packet?.cards.length ?? 0) - gradeCount} 张卡片待裁决；未知也是有效判断。`}</p></div><button type="button" className="submit-button" onClick={lockAdjudications} disabled={!complete}>锁定匿名裁决 <span aria-hidden="true">✓</span></button></div>
            </>}

            {draft.locked && !draft.dataset && <section className="adjudication-unlock-card">
              <span className="section-kicker">03 / UNBLIND AFTER LOCK</span>
              <h2>匿名裁决已锁定</h2>
              <p>所有候选已有独立裁决。现在可以载入单独保存的答案键；评测数据集会使用匿名卡 ID，不会带入球员姓名、球队或来源球员 ID。</p>
              <label className="review-file-picker adjudication-key-picker" htmlFor="answer-key-file"><span className="review-file-picker-icon" aria-hidden="true">↥</span><span><strong>载入答案键 JSON</strong><small>只用于按匿名卡 ID 恢复系统名次</small></span><input id="answer-key-file" type="file" accept="application/json,.json" onChange={(event) => void importAnswerKey(event)} /></label>
            </section>}

            {draft.dataset && evaluation && <section className="adjudication-results">
              <div className="adjudication-result-heading"><div><span className="section-kicker">QUERY-SCOPED EVALUATION</span><h2>短名单质量结果</h2></div><span className={`adjudication-status-pill ${evaluation.status}`}>{evaluation.status === "evaluable" ? "可评估" : evaluation.status === "partially_evaluable" ? "部分可评估" : "不可评估"}</span></div>
              <p className="adjudication-result-scope">只适用于「{packet?.roleBrief}」及当前冻结候选池与数据快照，不代表其他需求或完整转会市场。</p>
              {resultQuery && <div className="adjudication-metric-grid">
                <article><span>双人评分覆盖</span><strong>{resultQuery.judgmentCoverage.candidatesWithTwoRatings} / {resultQuery.judgmentCoverage.totalCandidates}</strong><small>每张匿名卡至少两份评分</small></article>
                <article><span>全部类别完全一致</span><strong>{resultQuery.rawPairwiseAgreement.rate === null ? "—" : `${Math.round(resultQuery.rawPairwiseAgreement.rate * 100)}%`}</strong><small>{resultQuery.rawPairwiseAgreement.agreements} / {resultQuery.rawPairwiseAgreement.comparablePairs} 对，含 unknown</small></article>
                <article><span>数值等级完全一致</span><strong>{resultQuery.numericGradeAgreement.rate === null ? "—" : `${Math.round(resultQuery.numericGradeAgreement.rate * 100)}%`}</strong><small>{resultQuery.numericGradeAgreement.agreements} / {resultQuery.numericGradeAgreement.comparablePairs} 个数值评分对</small></article>
                <article><span>双方均选未知</span><strong>{resultQuery.unknownOutcomePairs.bothUnknown}</strong><small>不计入数值等级一致率</small></article>
                <article><span>未知与数值分歧</span><strong>{resultQuery.unknownOutcomePairs.mixedWithNumeric}</strong><small>单独保留，不折算成 0</small></article>
              </div>}
              {resultQuery && <details className="adjudication-disagreement-details">
                <summary>查看评审分布与等级分歧</summary>
                <div className="adjudication-disagreement-content">
                  <p>以下是当前冻结 query 的描述性统计。0–3 是有序类别，等级差距不代表能力差距；unknown 不进入数值表。</p>
                  <div className="adjudication-rating-distributions">
                    {resultQuery.reviewerRatingDistributions.map((distribution, index) => <article key={distribution.reviewerId}>
                      <h3>评审 {index + 1}</h3>
                      <dl>
                        <div><dt>0</dt><dd>{distribution.ratings.grade0}</dd></div>
                        <div><dt>1</dt><dd>{distribution.ratings.grade1}</dd></div>
                        <div><dt>2</dt><dd>{distribution.ratings.grade2}</dd></div>
                        <div><dt>3</dt><dd>{distribution.ratings.grade3}</dd></div>
                        <div><dt>未知</dt><dd>{distribution.ratings.unknown}</dd></div>
                      </dl>
                      <small>{distribution.totalRatings} 张候选卡</small>
                    </article>)}
                  </div>
                  {resultQuery.reviewerPairComparisons.map((comparison) => {
                    const leftReviewerIndex = resultQuery.reviewerRatingDistributions.findIndex(({ reviewerId }) => reviewerId === comparison.reviewerIds[0]) + 1;
                    const rightReviewerIndex = resultQuery.reviewerRatingDistributions.findIndex(({ reviewerId }) => reviewerId === comparison.reviewerIds[1]) + 1;
                    return <section className="adjudication-pair-comparison" key={comparison.reviewerIds.join(":")}>
                      <h3>评审 {leftReviewerIndex} × 评审 {rightReviewerIndex}</h3>
                      <p>{comparison.sharedCandidateCount} 张候选卡有双方评分；其中 {comparison.numericPairs} 对是两边都有 0–3 数值等级。</p>
                      <div className="adjudication-gap-summary">
                        <span>同分 <strong>{comparison.exactAgreements}</strong></span>
                        <span>相差一档 <strong>{comparison.oneGradeApart}</strong></span>
                        <span>相差两档或以上 <strong>{comparison.twoOrMoreGradesApart}</strong></span>
                        <span>双方未知 <strong>{comparison.unknownOutcomePairs.bothUnknown}</strong></span>
                        <span>未知 / 数值 <strong>{comparison.unknownOutcomePairs.mixedWithNumeric}</strong></span>
                      </div>
                      <div className="adjudication-contingency-scroll">
                        <table className="adjudication-contingency-table">
                          <caption>行：评审 {leftReviewerIndex}；列：评审 {rightReviewerIndex}。只计双方都有数值等级的卡片。</caption>
                          <thead><tr><th scope="col">等级</th>{[0, 1, 2, 3].map((grade) => <th scope="col" key={grade}>{grade}</th>)}</tr></thead>
                          <tbody>{comparison.numericGradeContingency.map((row, grade) => <tr key={grade}>
                            <th scope="row">{grade}</th>
                            {row.map((count, column) => <td key={column}>{count}</td>)}
                          </tr>)}</tbody>
                        </table>
                      </div>
                    </section>;
                  })}
                </div>
              </details>}
              <div className="adjudication-system-results"><div className="section-kicker">SYSTEM RANKING</div>{resultQuery?.systems.map((system) => <article className="adjudication-system-row" key={`${system.systemId}:${system.runId}`}><div><strong>{system.systemId}</strong><small>{system.runId} · {system.rankedCandidateCount} 位候选</small></div><span>{system.ndcgAt5 === null ? "—" : system.ndcgAt5.toFixed(4)}</span></article>)}</div>
              {resultQuery && resultQuery.notEvaluableReasons.length > 0 && <div className="adjudication-reasons"><strong>当前不能计算 nDCG 的原因</strong><ul>{resultQuery.notEvaluableReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
              <p className="review-private-note">原始一致率只是本批评审结果的描述，不证明量表可靠或评审者独立。单个 query 的 nDCG 不是普遍推荐准确率；unknown 和缺失标签均未按 0 分处理。</p>
              <div className="adjudication-download-actions"><button type="button" className="secondary-button" onClick={() => downloadJson(`tactiscout-quality-input-${safeFilename}.json`, draft.dataset!)}>下载可复算评测输入 JSON</button><button type="button" className="submit-button" onClick={() => downloadJson(`tactiscout-quality-result-${safeFilename}.json`, evaluation)}>下载评测结果 JSON</button></div>
            </section>}
          </section>
        </div>
      </>}

      {error && <p className="error-message review-message" role="alert">{error}</p>}
      {message && <p className="plan-message review-message" role="status" aria-live="polite">{message}</p>}
    </main>
    <footer className="site-footer"><span>TactiScout <b>·</b> Query-scoped human evaluation</span><span>LOCK RATINGS BEFORE UNBLINDING</span></footer>
  </div>;
}
