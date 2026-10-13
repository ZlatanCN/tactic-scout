import { useEffect, useState, type ReactNode } from "react";
import "./ShowcaseLayoutPrototype.css";
import { ShowcaseWorkflowMap } from "./ShowcaseWorkflowMap";

export type ShowcasePrototypeVariant = "a" | "b" | "c";

type JourneyStep = {
  number: string;
  actor: string;
  title: string;
  description: string;
  detail: string;
};

type Metric = { value: string; label: string; note: string };
type Study = { key: string; title: string; takeaway: string; limitation: string; content: ReactNode };
type Run = {
  date: string;
  model: string;
  elapsed: string;
  checkCount: number;
  toolCallCount: number;
  clarificationCount: number;
  evaluatedCount: number;
  matchingCount: number;
  readCount: number;
  methodologyChunks: number;
  playerReportChunks: number;
  leadCount: number;
};

type Props = {
  initialVariant: ShowcasePrototypeVariant;
  run: Run;
  journey: readonly JourneyStep[];
  metrics: readonly Metric[];
  studies: readonly Study[];
};

const variants: { key: ShowcasePrototypeVariant; name: string }[] = [
  { key: "a", name: "结论先行" },
  { key: "b", name: "调查时间线" },
  { key: "c", name: "研究档案" },
];

export function ShowcaseLayoutPrototype({ initialVariant, run, journey, metrics, studies }: Props) {
  const [active, setActive] = useState(initialVariant);
  const [activeStudy, setActiveStudy] = useState(0);

  function selectVariant(next: ShowcasePrototypeVariant) {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
    setActive(next);
    setActiveStudy(0);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const current = variants.findIndex((item) => item.key === active);
      const delta = event.key === "ArrowRight" ? 1 : -1;
      selectVariant(variants[(current + delta + variants.length) % variants.length].key);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  return <div className={`showcase-prototype showcase-prototype-${active}`}>
    {active === "a" && <ShowcaseExecutiveStory run={run} journey={journey} metrics={metrics} studies={studies} />}
    {active === "b" && <TimelineStory run={run} journey={journey} metrics={metrics} studies={studies} activeStudy={activeStudy} setActiveStudy={setActiveStudy} />}
    {active === "c" && <ResearchDossier run={run} journey={journey} metrics={metrics} studies={studies} />}
    <nav className="showcase-prototype-switcher" aria-label="展示布局原型切换器">
      <button type="button" aria-label="上一个布局" onClick={() => selectVariant(variants[(variants.findIndex((item) => item.key === active) + variants.length - 1) % variants.length].key)}>←</button>
      <span><b>{active.toUpperCase()}</b> · {variants.find((item) => item.key === active)?.name}</span>
      <button type="button" aria-label="下一个布局" onClick={() => selectVariant(variants[(variants.findIndex((item) => item.key === active) + 1) % variants.length].key)}>→</button>
    </nav>
  </div>;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="story-eyebrow">{children}</p>;
}

function ProofStamp({ run }: { run: Run }) {
  return <div className="story-proof-stamp"><span>真实 LangGraph 运行</span><strong>{run.checkCount}<i>/{run.checkCount}</i></strong><small>Harness 行为检查通过</small></div>;
}

function RunFacts({ run, metrics }: { run: Run; metrics: readonly Metric[] }) {
  return <div className="story-run-facts">
    <div><span>运行</span><b>{run.date} · {run.model}</b></div>
    {metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><b>{metric.value}</b><small>{metric.note}</small></div>)}
  </div>;
}

function StorySteps({ journey, compact = false }: { journey: readonly JourneyStep[]; compact?: boolean }) {
  return <ol className={`story-steps${compact ? " story-steps-compact" : ""}`}>
    {journey.map((step) => <li key={step.number}>
      <span className="story-step-index">{step.number}</span>
      <div><small>{step.actor}</small><h3>{step.title}</h3><p>{step.description}</p>{!compact && <p className="story-step-detail">{step.detail}</p>}</div>
    </li>)}
  </ol>;
}

function Boundaries({ run }: { run: Run }) {
  return <aside className="story-boundary">
    <span aria-hidden="true">!</span><div><strong>通过流程检查，不等于推荐质量已验证</strong>
      <p>本次使用 Wyscout 2017/18 历史事件数据，评估 {run.evaluatedCount} 人，报告给出 {run.leadCount} 条后续考察线索。项目尚无可信球探排序标签；{run.checkCount}/{run.checkCount} 只描述这一次运行的行为契约。</p>
    </div>
  </aside>;
}

function StudyDisclosure({ studies }: { studies: readonly Study[] }) {
  return <div className="story-study-list">
    {studies.map((study, index) => <details key={study.key} className="story-study-item">
      <summary><span className="story-study-number">0{index + 1}</span><span><strong>{study.title}</strong><small>{study.takeaway}</small></span><i aria-hidden="true">＋</i></summary>
      <div className="story-study-content"><p className="story-study-limit">{study.limitation}</p>{study.content}</div>
    </details>)}
  </div>;
}

function SourceAndNext({ run }: { run: Run }) {
  return <>
    <section className="story-source">
      <div><Eyebrow>SOURCE & ATTRIBUTION</Eyebrow><strong>历史数据与边界</strong></div>
      <p>球员表现源为 Pappalardo 与 Massucco 发布的 Wyscout Soccer Match Event 数据，涵盖 2017/18 历史赛季，按 CC BY 4.0 署名。页面展示脱敏汇总与安全工具轨迹，不含球员姓名、ID 或隐藏推理。</p>
      <div className="story-source-links"><a href="https://doi.org/10.1038/s41597-019-0247-7" target="_blank" rel="noreferrer">数据论文 ↗</a><a href="https://figshare.com/collections/Soccer_match_event_dataset/4415000" target="_blank" rel="noreferrer">Figshare 数据集 ↗</a><a href="https://figshare.com/articles/dataset/Events/7770599" target="_blank" rel="noreferrer">Events 数据项 ↗</a><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0 ↗</a></div>
    </section>
    <section className="story-next"><div><Eyebrow>CONTINUE WITH A LIVE CASE</Eyebrow><h2>想亲自给 Agent 一个需求？</h2><p>交互调查使用本机 API、Ollama 和所选数据模式；这份页面是历史运行摘要。</p></div><a href="/">打开交互工作台 <span>→</span></a></section>
    <footer className="story-footer">TactiScout · 录制运行 {run.date} · Football scouting research prototype</footer>
  </>;
}

export function ShowcaseExecutiveStory({ run, journey, metrics, studies }: Omit<Props, "initialVariant">) {
  return <>
    <section className="story-executive-hero">
      <div><Eyebrow>真实运行 · 先看结果，再看证据</Eyebrow><h1>让一次引援需求，<em>变成可审阅的调查。</em></h1>
        <p>Agent 先调查候选与证据；职责不清时暂停追问，答复后从同一案件继续。最终只留下来源可查、边界明确的考察线索。</p>
        <div className="story-tags"><span>前锋替代者</span><span>{run.model}</span><span>Wyscout 2017/18 · 历史样本</span></div>
      </div><ProofStamp run={run} />
    </section>
    <RunFacts run={run} metrics={metrics} />
    <section className="story-executive-grid">
      <div className="story-investigation"><header><div><Eyebrow>OBSERVED RUN</Eyebrow><h2>五个关键转折</h2></div><span>{run.elapsed} · {run.toolCallCount} 次工具调用</span></header><StorySteps journey={journey} compact /></div>
      <aside className="story-outcome"><Eyebrow>REPORT SNAPSHOT</Eyebrow><h2>一条线索，留下能力缺口</h2><div className="story-lead"><span>匿名候选 · ATT</span><strong>{run.leadCount} 条后续考察线索</strong><div><b>进球</b><b>关键传球</b></div><p>这些指标不能单独证明射门终结或进攻接应能力。</p></div><dl><div><dt>历史池匹配记录</dt><dd>{run.matchingCount}</dd></div><div><dt>本次实际读取</dt><dd>{run.readCount}</dd></div><div><dt>方法资料 / 球员报告</dt><dd>{run.methodologyChunks} / {run.playerReportChunks}</dd></div></dl></aside>
    </section>
    <Boundaries run={run} />
    <ShowcaseWorkflowMap />
    <section className="story-experiments"><header><div><Eyebrow>MECHANISM EVIDENCE</Eyebrow><h2>核心机制经过整图对照</h2><p>同一 LangGraph 中切换单个机制，保留真实工具和完整报告链路。</p></div><span>细节按需展开</span></header><StudyDisclosure studies={studies} /></section>
    <SourceAndNext run={run} />
  </>;
}

function TimelineStory({ run, journey, metrics, studies, activeStudy, setActiveStudy }: Omit<Props, "initialVariant"> & { activeStudy: number; setActiveStudy: (index: number) => void }) {
  return <>
    <section className="story-timeline-hero"><Eyebrow>CASE FILE · {run.date} · LOCAL MODEL</Eyebrow><h1>从一句引援需求，到一条可追溯的考察线索。</h1><p>关键不是一轮生成，而是图如何暂停、恢复、调工具并约束结论。</p><div className="story-tags"><span>{run.model}</span><span>Wyscout 2017/18</span><span>{run.elapsed} 端到端</span></div></section>
    <section className="story-timeline-layout"><div className="story-timeline-main"><header><div><Eyebrow>INVESTIGATION TRACE</Eyebrow><h2>调查怎样向前推进</h2></div><ProofStamp run={run} /></header><StorySteps journey={journey} /></div><aside className="story-timeline-rail"><span className="story-rail-kicker">AT A GLANCE</span>{metrics.map((metric) => <div key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span><small>{metric.note}</small></div>)}<Boundaries run={run} /></aside></section>
    <section className="story-tabbed-studies"><header><div><Eyebrow>CONTROLLED MECHANISM CHECKS</Eyebrow><h2>证据按机制浏览</h2><p>配对运行只支持页面明确写出的观察，不代替人工排序质量评估。</p></div></header><div className="story-study-tabs" aria-label="选择机制实验">{studies.map((study, index) => <button key={study.key} type="button" aria-pressed={activeStudy === index} onClick={() => setActiveStudy(index)}>{study.title}</button>)}</div><article className="story-active-study"><div><span>0{activeStudy + 1} / 0{studies.length}</span><h3>{studies[activeStudy].title}</h3><p>{studies[activeStudy].takeaway}</p><small>{studies[activeStudy].limitation}</small></div>{studies[activeStudy].content}</article></section>
    <SourceAndNext run={run} />
  </>;
}

function ResearchDossier({ run, journey, metrics, studies }: Omit<Props, "initialVariant">) {
  return <>
    <section className="story-dossier-heading"><div><Eyebrow>TACTISCOUT · FIELD NOTE 01</Eyebrow><h1>一项球探 Agent，<br /><em>先证明它如何工作。</em></h1><p>本档案把单次完整调查与机制对照分开呈现：前者说明运行发生了什么，后者说明切换某个机制后观察到什么。</p></div><ProofStamp run={run} /></section>
    <RunFacts run={run} metrics={metrics} />
    <div className="story-dossier-rule"><span>01</span><div><Eyebrow>RECORDED INVESTIGATION</Eyebrow><h2>真实案例记录</h2><p>拜仁前锋替代者需求 · {run.evaluatedCount} 人已评估 · {run.leadCount} 条考察线索</p></div></div>
    <div className="story-dossier-case"><StorySteps journey={journey} /><div className="story-dossier-outcome"><strong>报告保留了什么</strong><p>进球与关键传球可见；射门终结与进攻接应缺少直接指标。球员报告语料本轮 0 命中。</p><b>→ 不把邻近指标说成能力证明</b></div></div>
    <div className="story-dossier-rule"><span>02</span><div><Eyebrow>CONTROLLED MECHANISM CHECKS</Eyebrow><h2>消融结果索引</h2><p>按需打开实验协议与实际运行摘要</p></div></div>
    <section className="story-dossier-studies"><div className="story-study-ledger">{studies.map((study, index) => <details key={study.key}><summary><span>0{index + 1}</span><strong>{study.title}</strong><p>{study.takeaway}</p><i aria-hidden="true">+</i></summary><div><p>{study.limitation}</p>{study.content}</div></details>)}</div></section>
    <Boundaries run={run} />
    <SourceAndNext run={run} />
  </>;
}
